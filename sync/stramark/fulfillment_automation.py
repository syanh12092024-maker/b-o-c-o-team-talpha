#!/usr/bin/env python3
"""
Stramark Fulfillment Automation: POS Cake → euShipments (Multi-Country).

Workflow:
1. Poll POS Cake for orders with status=8 (packing)
2. Detect country from order tags (no tag=RO, Slovakia, Bulgaria, Croatia)
3. Filter orders not yet sent to 3PL (check BigQuery)
4. Validate address + phone per country profile
5. Check 3PL stock availability
6. Create fulfillment order via euShipments API (auto courier per country)
7. Log to BigQuery fulfillment_orders table
8. Alert Discord on errors

Usage:
    python fulfillment_automation.py                    # Normal run
    python fulfillment_automation.py --dry-run           # Validate only
    python fulfillment_automation.py --filter-country SK  # Only Slovakia orders
    python fulfillment_automation.py --test               # euShipments test mode

Markets: RO (Cargus) | SK (GLS) | BG (Express One) | HR (DPD)
"""

import io
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone, date
from pathlib import Path

import requests
import yaml
from google.cloud import bigquery

# Force UTF-8 on Windows
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ──────────────────────────────────────────
# Setup
# ──────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("fulfillment.automation")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = PROJECT_ROOT / "config" / "projects" / "stramark.yaml"

# Load config
with open(CONFIG_PATH, encoding="utf-8") as f:
    CFG = yaml.safe_load(f)


def _resolve_env(val):
    """Resolve ${ENV_VAR} placeholders."""
    if isinstance(val, str) and val.startswith("${") and val.endswith("}"):
        return os.environ.get(val[2:-1], val)
    return val


# Load .env
for env_file in [PROJECT_ROOT / ".env", PROJECT_ROOT / ".env.ffm"]:
    if env_file.exists():
        with open(env_file, encoding="utf-8") as ef:
            for line in ef:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    key, val = key.strip(), val.strip()
                    if key and val and key not in os.environ:
                        os.environ[key] = val

# POS Cake config
POS_CFG = CFG.get("poscake", {})
POS_API_BASE = (POS_CFG.get("shops", [{}])[0].get("api_url", "")
                or "https://pos.pages.fm/api/v1")
POS_API_KEY = _resolve_env(
    POS_CFG.get("shops", [{}])[0].get("api_key", "")
) or os.getenv("POSCAKE_API_KEY", "")
POS_SHOP_ID = (POS_CFG.get("shop_ids", [""])[0]
               or os.getenv("POSCAKE_SHOP_ID", "1635307570"))

# BigQuery config
BQ_CFG = CFG.get("bigquery", {})
GCP_PROJECT = BQ_CFG.get("project_gcp", "levelup-465304")
DATASET = BQ_CFG.get("dataset", "STRAMARK_Dataset")
DS = f"{GCP_PROJECT}.{DATASET}"

BQ_KEY_PATH = PROJECT_ROOT / "bigquery_key.json"
if BQ_KEY_PATH.exists():
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(BQ_KEY_PATH)

# Fulfillment (3PL) config
FFM_CFG = CFG.get("fulfillment", {})
TPL_API_BASE = FFM_CFG.get("api_url", "https://api1.inout.bg/api/v1")
# Use account 2 (new, active from 2026-02-27)
TPL_API_TOKEN = (os.getenv("STRAMARK_FFM_API_TOKEN_2")
                 or os.getenv("STRAMARK_FFM_API_TOKEN")
                 or _resolve_env(FFM_CFG.get("api_token", "")))
TPL_SENDER_ID = int(os.getenv("EU_SHIPMENT_CLIENT_ID_NEW",
                               str(FFM_CFG.get("company_id", 3282))))
TPL_WAREHOUSE = FFM_CFG.get("warehouse_primary", {}).get("name", "HelpShip Oradea")
CLIENT_REF_PREFIX = FFM_CFG.get("client_reference_prefix", "STR")

# Discord
DISCORD_WEBHOOK = os.getenv("DISCORD_WEBHOOK_ALERT", "")

# Status trigger
STATUS_PACKING = FFM_CFG.get("trigger_status", 8)

# ──────────────────────────────────────────
# Import validators (same directory)
# ──────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent))
from fulfillment_validators import (
    detect_country, normalize_phone, validate_order, parse_address,
    COUNTRY_PROFILES, CountryProfile,
)


# ══════════════════════════════════════════════════════════════════════════════
# POS Cake API
# ══════════════════════════════════════════════════════════════════════════════

def fetch_packing_orders() -> list:
    """Fetch all orders with status=packing from POS Cake."""
    all_orders = []
    page = 1
    total_pages = 1

    while page <= total_pages and page <= 50:
        url = f"{POS_API_BASE}/shops/{POS_SHOP_ID}/orders"
        params = {
            "api_key": POS_API_KEY,
            "page": page,
            "limit": 100,
            "status": STATUS_PACKING,
        }
        log.info(f"Fetching packing orders page {page}/{total_pages}...")
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        orders = data.get("data", [])
        all_orders.extend(orders)
        total_pages = data.get("total_pages", 1)
        log.info(f"  Got {len(orders)} orders (total: {len(all_orders)})")
        page += 1

    return all_orders


# ══════════════════════════════════════════════════════════════════════════════
# BigQuery Functions
# ══════════════════════════════════════════════════════════════════════════════

def get_existing_fulfillment_ids(client: bigquery.Client) -> set:
    """Get set of POS order IDs already successfully sent to 3PL (skip these)."""
    try:
        query = (f"SELECT pos_order_id FROM `{DS}.fulfillment_orders` "
                 f"WHERE status IN ('created', 'shipped', 'delivered', 'returning', 'returned')")
        result = client.query(query).result()
        return {row.pos_order_id for row in result}
    except Exception as e:
        log.warning(f"Could not fetch existing fulfillment IDs: {e}")
        return set()


def get_retryable_failed_orders(client: bigquery.Client, max_retries: int = 3) -> dict:
    """
    Get orders that failed and can be retried.
    Returns: dict mapping pos_order_id → retry_count.
    Only retries orders failed < max_retries times, and not older than 48h.
    """
    try:
        query = f"""
        SELECT pos_order_id,
               COUNT(*) as attempt_count,
               MAX(created_at) as last_attempt
        FROM `{DS}.fulfillment_orders`
        WHERE status IN ('failed', 'validation_failed')
          AND TIMESTAMP(created_at) > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 48 HOUR)
        GROUP BY pos_order_id
        HAVING attempt_count < {max_retries}
        """
        result = client.query(query).result()
        retryable = {row.pos_order_id: row.attempt_count for row in result}
        if retryable:
            log.info(f"  Found {len(retryable)} retryable failed orders")
        return retryable
    except Exception as e:
        log.warning(f"Could not fetch retryable orders: {e}")
        return {}


def clear_failed_record(client: bigquery.Client, pos_order_id: str):
    """Delete old failed record so a new attempt can be inserted."""
    try:
        query = (f"DELETE FROM `{DS}.fulfillment_orders` "
                 f"WHERE pos_order_id = @oid AND status IN ('failed', 'validation_failed')")
        client.query(query, job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("oid", "STRING", pos_order_id),
            ]
        )).result()
    except Exception as e:
        log.warning(f"Could not clear failed record {pos_order_id}: {e}")


def save_fulfillment_order(client: bigquery.Client, record: dict):
    """Insert a fulfillment order record to BigQuery."""
    table_id = f"{DS}.fulfillment_orders"
    errors = client.insert_rows_json(table_id, [record])
    if errors:
        log.error(f"BQ insert error: {errors}")
    else:
        log.info(f"  Saved fulfillment order {record['pos_order_id']} to BQ")


def save_validation_failure(client: bigquery.Client, order_id: str,
                            country_code: str, errors: list, warnings: list):
    """Log validation failure to BigQuery."""
    record = {
        "pos_order_id": str(order_id),
        "tpl_order_id": None,
        "courier_name": "",
        "warehouse": TPL_WAREHOUSE,
        "status": "validation_failed",
        "error_message": "; ".join(errors),
        "warnings": "; ".join(warnings) if warnings else "",
        "recipient_country": country_code,
        "is_test": False,
        "shop_id": str(POS_SHOP_ID),
        "project_id": "stramark",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        table_id = f"{DS}.fulfillment_orders"
        client.insert_rows_json(table_id, [record])
    except Exception as e:
        log.warning(f"Could not save validation failure: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# euShipments API
# ══════════════════════════════════════════════════════════════════════════════

def tpl_headers() -> dict:
    return {
        "Authorization": f"Bearer {TPL_API_TOKEN}",
        "Content-Type": "application/json",
    }


def check_3pl_stock() -> dict:
    """Get product availability from 3PL warehouse."""
    url = f"{TPL_API_BASE}/fulfilment/get-prod-avails"
    resp = requests.get(url, headers=tpl_headers(), timeout=30)
    resp.raise_for_status()
    stock = {}
    for item in resp.json():
        ref = item.get("REFERENCE_NUMBER", "")
        qty = item.get("AVAIL_QTY", 0)
        if ref:
            stock[ref] = qty
    log.info(f"  3PL stock: {len(stock)} SKUs loaded")
    return stock


def create_3pl_order(order: dict, items: list, country: CountryProfile) -> dict:
    """Create fulfillment order on euShipments for the detected country."""

    phone = normalize_phone(order.get("bill_phone_number", ""), country)
    name = order.get("bill_full_name", "") or order.get("customer_name", "")

    # Parse address
    raw_addr = order.get("shipping_address", "") or ""
    if isinstance(raw_addr, dict):
        full_addr = raw_addr.get("address", "") or raw_addr.get("full_address", "") or ""
    else:
        full_addr = str(raw_addr)

    # Use pre-parsed values if available (from validator)
    street = order.get("_parsed_street", "")
    city = order.get("_parsed_city", "")
    zip_code = order.get("_parsed_zip", "")

    if not street:
        parsed = parse_address(full_addr, country)
        street = parsed["street"]
        city = city or parsed["city"]
        zip_code = zip_code or parsed["zip_code"]

    # Fallbacks
    if not city:
        city = (order.get("shipping_province", "")
                or order.get("bill_city", "") or "").strip()
    if not zip_code:
        zip_code = (order.get("bill_zipcode", "")
                    or order.get("shipping_zipcode", "") or "").strip()

    # Products — use display_id as SKU (matches euShipments REF_NUMBER)
    # POS Cake: vi.display_id = "D04-VERDE" → euShipments: REF_NUMBER = "D04-VERDE"
    products = []
    product_names = []
    for item in items:
        vi = item.get("variation_info", {}) or {}
        sku = (vi.get("display_id", "") or vi.get("product_display_id", "")
               or vi.get("barcode", "") or item.get("barcode", "") or "Product")
        display_name = vi.get("name", "") or item.get("product_name", "") or sku
        qty = int(item.get("quantity", 1) or 1)
        products.append({"refNumber": sku, "qty": qty})
        product_names.append(display_name)

    # COD — POS stores in cents
    cod_raw = float(order.get("cod", 0) or 0)
    cod_amount = cod_raw / 100.0

    order_id = str(order.get("id", ""))
    total_qty = sum(p["qty"] for p in products) if products else 1

    payload = {
        "testMode": 0,
        "senderId": TPL_SENDER_ID,
        "courierId": country.default_courier_id,
        "waybillAvailableDate": date.today().isoformat(),
        "serviceName": "crossborder",
        "recipient": {
            "name": name,
            "countryIsoCode": country.code,
            "cityName": city,
            "zipCode": zip_code.replace(" ", ""),
            "streetName": street,
            "phoneNumber": phone,
            "email": order.get("bill_email", "") or order.get("customer_email", "") or "",
        },
        "awb": {
            "referenceNumber": order_id,
            "bankRepayment": f"{cod_amount:.2f}",
            "products": " ".join(product_names) or "Product",
            "fragile": 0,
            "piecesInPack": total_qty,
            "parcels": 1,
            "envelopes": 0,
            "totalWeight": 1,
            "width": 10,
            "height": 10,
            "length": 10,
            "insurance": 0,
            "preview": 0,
            "saturdayDelivery": 0,
            "contents": FFM_CFG.get("default_shipment_content", "Clothing / Fashion"),
            "productsInfo": ",".join(product_names) or "",
        },
        "products": products,
        "customsData": {
            "dutyPaymentInfo": "DDU",
            "customsValue": f"{cod_amount:.2f}",
        },
        "clientReference": f"{CLIENT_REF_PREFIX}-{order_id}",
    }

    log.info(f"  Creating 3PL order: {country.flag} {country.name} "
             f"| Courier: {country.courier_name} (id={country.default_courier_id})")
    log.info(f"  Recipient: {name}, {city}, {country.code} | COD: {cod_amount:.2f} {country.currency}")

    url = f"{TPL_API_BASE}/fulfilment/create-order"
    resp = requests.post(url, headers=tpl_headers(), json=payload, timeout=30)

    log.info(f"  API Response: {resp.status_code} | {resp.text[:500]}")

    if resp.status_code != 200:
        raise requests.exceptions.HTTPError(
            f"{resp.status_code}: {resp.text[:500]}", response=resp
        )

    try:
        result = resp.json()
        log.info(f"  Order created: orderId={result.get('orderId')}")
        return result
    except Exception:
        return {"error": False, "orderId": f"HTTP-{resp.status_code}"}


# ══════════════════════════════════════════════════════════════════════════════
# Discord Alert
# ══════════════════════════════════════════════════════════════════════════════

def alert_discord(message: str, is_error: bool = True):
    if not DISCORD_WEBHOOK:
        log.warning(f"Discord not configured. Msg: {message}")
        return
    emoji = "\U0001f534" if is_error else "\u26a0\ufe0f"
    try:
        requests.post(DISCORD_WEBHOOK,
                      json={"content": f"{emoji} **[Stramark FFM]** {message}"},
                      timeout=10)
    except Exception as e:
        log.error(f"Discord alert failed: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Stramark Fulfillment Automation")
    parser.add_argument("--dry-run", action="store_true", help="Validate only")
    parser.add_argument("--test", action="store_true", help="euShipments test mode")
    parser.add_argument("--filter-country", type=str, default="ALL",
                        help="Filter by country code: RO, SK, BG, HR, or ALL")
    args = parser.parse_args()

    dry_run = args.dry_run
    filter_country = args.filter_country.upper()

    log.info("=" * 60)
    log.info("  Stramark Fulfillment Automation (Multi-Country)")
    log.info(f"  Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    log.info(f"  Filter: {filter_country}")
    log.info(f"  Sender ID: {TPL_SENDER_ID}")
    log.info(f"  Markets: RO(Cargus) | SK(GLS) | BG(ExpressOne) | HR(DPD)")
    log.info("=" * 60)

    # Validate config
    if not dry_run:
        if not TPL_API_BASE or not TPL_API_TOKEN:
            log.error("3PL API not configured! Check stramark.yaml + .env")
            return
        if not POS_API_KEY:
            log.error("POS API key not configured! Check .env POSCAKE_API_KEY")
            return

    # 1. Fetch packing orders
    log.info("\nStep 1: Fetching packing orders (status=8)...")
    orders = fetch_packing_orders()
    log.info(f"   Found {len(orders)} orders")

    if not orders:
        log.info("   No packing orders. Done.")
        return

    # 2. Filter already processed + find retryable failed orders
    log.info("\nStep 2: Filtering new orders + checking retryable...")
    bq_client = bigquery.Client(project=GCP_PROJECT)
    existing_ids = get_existing_fulfillment_ids(bq_client)
    retryable = get_retryable_failed_orders(bq_client, max_retries=3)

    new_orders = [o for o in orders if str(o.get("id", "")) not in existing_ids]
    # Also include POS orders whose previous attempt failed (retry)
    retry_orders = [o for o in orders
                    if str(o.get("id", "")) in retryable
                    and str(o.get("id", "")) not in {str(n.get("id", "")) for n in new_orders}]

    if retry_orders:
        log.info(f"   {len(retry_orders)} failed orders eligible for retry")
        for ro in retry_orders:
            oid = str(ro.get("id", ""))
            attempts = retryable.get(oid, 0)
            log.info(f"     Retry: {oid} (attempt {attempts + 1}/3)")
            clear_failed_record(bq_client, oid)
        new_orders.extend(retry_orders)

    log.info(f"   {len(orders)} packing -> {len(new_orders)} to process "
             f"({len(new_orders) - len(retry_orders)} new + {len(retry_orders)} retry)")

    if not new_orders:
        log.info("   All already processed. Done.")
        return

    # 3. Pre-load stock
    stock = {}
    if not dry_run:
        log.info("\nStep 3a: Loading 3PL stock...")
        try:
            stock = check_3pl_stock()
        except Exception as e:
            log.warning(f"   Could not load stock: {e}")

    # 4. Process
    log.info(f"\nStep 3: Processing {len(new_orders)} orders...")

    stats = {
        "total": 0, "valid": 0, "invalid": 0,
        "created": 0, "failed": 0, "skipped": 0, "out_of_stock": 0,
    }
    by_country: dict = {}

    for i, order in enumerate(new_orders, 1):
        order_id = order.get("id", "UNKNOWN")
        country = detect_country(order)

        # Country filter
        if filter_country != "ALL" and country.code != filter_country:
            continue

        stats["total"] += 1
        if country.code not in by_country:
            by_country[country.code] = {"total": 0, "created": 0, "failed": 0}
        by_country[country.code]["total"] += 1

        log.info(f"\n--- [{i}/{len(new_orders)}] Order {order_id} "
                 f"| {country.flag} {country.name} ---")

        # Validate
        result = validate_order(order)

        if not result.is_valid:
            stats["invalid"] += 1
            log.warning(f"   VALIDATION FAILED: {result.errors}")
            alert_discord(f"Order `{order_id}` ({country.name}) validation failed: "
                          + "; ".join(result.errors))
            save_validation_failure(bq_client, order_id, country.code,
                                   result.errors, result.warnings)
            continue

        stats["valid"] += 1

        if dry_run:
            log.info(f"   DRY RUN — {country.flag} {country.name} | "
                     f"{country.courier_name} | skip")
            stats["skipped"] += 1
            continue

        # Stock check
        items = order.get("items", []) or []
        if stock:
            stock_ok = True
            for item in items:
                vi = item.get("variation_info", {}) or {}
                sku = vi.get("name", "") or item.get("product_name", "")
                qty_needed = int(item.get("quantity", 1) or 1)
                avail = stock.get(sku, -1)
                if avail == 0:
                    stock_ok = False
                    alert_discord(f"OUT OF STOCK: SKU `{sku}` for order `{order_id}`")
                elif 0 < avail < qty_needed:
                    stock_ok = False
                    alert_discord(f"LOW STOCK: SKU `{sku}` need={qty_needed} avail={avail}")
            if not stock_ok:
                stats["out_of_stock"] += 1
                continue

        # Create 3PL order
        try:
            tpl_result = create_3pl_order(order, items, country)

            if tpl_result.get("error") is False or tpl_result.get("error") is None:
                tpl_order_id = tpl_result.get("orderId")
                stats["created"] += 1
                by_country[country.code]["created"] += 1

                now = datetime.now(timezone.utc).isoformat()
                record = {
                    "pos_order_id": str(order_id),
                    "tpl_order_id": tpl_order_id,
                    "courier_name": country.courier_name,
                    "courier_id": country.default_courier_id,
                    "warehouse": TPL_WAREHOUSE,
                    "recipient_name": order.get("bill_full_name", ""),
                    "recipient_phone": normalize_phone(
                        order.get("bill_phone_number", ""), country),
                    "recipient_city": order.get("_parsed_city", ""),
                    "recipient_country": country.code,
                    "cod_amount": float(order.get("cod", 0) or 0),
                    "items_count": len(items),
                    "status": "created",
                    "is_test": args.test,
                    "shop_id": str(POS_SHOP_ID),
                    "project_id": "stramark",
                    "created_at": now,
                    "error_message": "",
                }
                save_fulfillment_order(bq_client, record)
            else:
                stats["failed"] += 1
                by_country[country.code]["failed"] += 1
                alert_discord(f"3PL order failed for `{order_id}`: {tpl_result}")

        except Exception as e:
            stats["failed"] += 1
            by_country[country.code]["failed"] += 1
            log.error(f"   3PL API error: {e}")
            alert_discord(f"3PL API error for `{order_id}` ({country.name}): {e}")

    # Summary
    log.info("\n" + "=" * 60)
    log.info("  SUMMARY")
    log.info(f"  Total:        {stats['total']}")
    log.info(f"  Valid:        {stats['valid']}")
    log.info(f"  Invalid:      {stats['invalid']}")
    log.info(f"  Created:      {stats['created']}")
    log.info(f"  Failed:       {stats['failed']}")
    log.info(f"  Skipped:      {stats['skipped']}")
    log.info(f"  Out of stock: {stats['out_of_stock']}")
    for code, cs in by_country.items():
        p = COUNTRY_PROFILES.get(code)
        flag = p.flag if p else code
        log.info(f"  {flag} {code}: {cs['total']} total, "
                 f"{cs['created']} created, {cs['failed']} failed")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
