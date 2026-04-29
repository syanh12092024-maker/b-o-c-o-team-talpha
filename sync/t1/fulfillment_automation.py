#!/usr/bin/env python3
"""
T1 Fulfillment Automation: POS Cake → euShipments (3PL).

Workflow:
1. Poll POS Cake for orders with status=8 (packing / đang đóng hàng)
2. Filter orders not yet sent to 3PL
3. Validate address + phone number (Slovakia market)
4. Check 3PL stock availability
5. Create fulfillment order via euShipments API
6. Update POS status → shipped (2)
7. Log to BigQuery fulfillment_orders table
8. Alert Discord on errors

Usage:
    python fulfillment_automation.py              # Normal run
    python fulfillment_automation.py --dry-run    # Validate only, no 3PL calls
    python fulfillment_automation.py --test       # Use euShipments test mode

Market: Slovakia (SK) | Courier: Slovakia GLS (ID 741) | Currency: EUR
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone, date
from pathlib import Path

import requests
import yaml
from google.cloud import bigquery

from validators import validate_order, normalize_phone

# ──────────────────────────────────────────
# Setup
# ──────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("fulfillment.automation")

PROJECT_ROOT = Path(__file__).parent.parent.parent
CONFIG_PATH = PROJECT_ROOT / "config" / "projects" / "t1.yaml"

# Load config
with open(CONFIG_PATH, encoding="utf-8") as f:
    CFG = yaml.safe_load(f)

def _resolve_env(val):
    """Resolve ${ENV_VAR} placeholders in YAML values."""
    if isinstance(val, str) and val.startswith("${") and val.endswith("}"):
        env_key = val[2:-1]
        return os.environ.get(env_key, val)
    return val

# POS Cake config
POS_API_BASE = CFG["pancake"]["api_url"]
POS_API_TOKEN = _resolve_env(CFG["pancake"]["api_token"])
POS_SHOP_ID = CFG["pancake"]["page_ids"][0]

# BigQuery config
GCP_PROJECT = CFG["bigquery"]["project_gcp"]
DATASET = CFG["bigquery"]["dataset"]
DS = f"{GCP_PROJECT}.{DATASET}"

# BigQuery credentials — use explicit key file
BQ_KEY_PATH = PROJECT_ROOT / "bigquery_key_t1.json"
if BQ_KEY_PATH.exists():
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(BQ_KEY_PATH)

# Fulfillment (3PL) config
FFM_CFG = CFG.get("fulfillment", {})
TPL_API_BASE = FFM_CFG.get("api_url", "")
TPL_API_TOKEN = _resolve_env(FFM_CFG.get("api_token", ""))
TPL_SENDER_ID = FFM_CFG.get("sender_id", 0)
TPL_COURIER_ID = FFM_CFG.get("default_courier_id", 741)  # Slovakia GLS
TPL_TEST_MODE = FFM_CFG.get("test_mode", True)
TPL_WAREHOUSE = FFM_CFG.get("warehouse", "HelpShip Oradea")
CLIENT_REF_PREFIX = FFM_CFG.get("client_reference_prefix", "T1")

# Load .env file manually
ENV_PATH = PROJECT_ROOT / ".env"
if ENV_PATH.exists():
    with open(ENV_PATH, encoding="utf-8") as ef:
        for line in ef:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                key, val = key.strip(), val.strip()
                if key and val and key not in os.environ:
                    os.environ[key] = val

# Discord
DISCORD_WEBHOOK_ALERT = os.getenv("DISCORD_WEBHOOK_ALERT", "")

# Status constants
STATUS_PACKING = 8    # Trigger: đang đóng hàng
STATUS_SHIPPED = 9    # Target: đã gửi hàng

# ──────────────────────────────────────────
# POS Cake API Functions
# ──────────────────────────────────────────

def fetch_packing_orders() -> list:
    """Fetch all orders with status=8 (packing) from POS Cake."""
    all_orders = []
    page = 1
    total_pages = 1

    while page <= total_pages and page <= 50:
        url = f"{POS_API_BASE}/shops/{POS_SHOP_ID}/orders"
        params = {
            "api_key": POS_API_TOKEN,
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

        log.info(f"  Got {len(orders)} packing orders (total: {len(all_orders)})")
        page += 1

    return all_orders


# ──────────────────────────────────────────
# BigQuery Functions
# ──────────────────────────────────────────

def get_existing_fulfillment_ids(client: bigquery.Client) -> set:
    """Get set of POS order IDs already sent to 3PL."""
    try:
        query = f"SELECT pos_order_id FROM `{DS}.fulfillment_orders`"
        result = client.query(query).result()
        return {row.pos_order_id for row in result}
    except Exception as e:
        log.warning(f"Could not fetch existing fulfillment IDs: {e}")
        return set()


def save_fulfillment_order(client: bigquery.Client, record: dict):
    """Insert a fulfillment order record to BigQuery."""
    table_id = f"{DS}.fulfillment_orders"
    errors = client.insert_rows_json(table_id, [record])
    if errors:
        log.error(f"BQ insert error: {errors}")
    else:
        log.info(f"  Saved fulfillment order {record['pos_order_id']} to BQ")


def save_validation_failure(client: bigquery.Client, order_id: str,
                            errors: list, warnings: list):
    """Log validation failure to BigQuery for tracking."""
    record = {
        "pos_order_id": str(order_id),
        "tpl_order_id": None,
        "courier_name": "",
        "courier_id": TPL_COURIER_ID,
        "warehouse": TPL_WAREHOUSE,
        "status": "validation_failed",
        "error_message": "; ".join(errors),
        "warnings": "; ".join(warnings) if warnings else "",
        "is_test": TPL_TEST_MODE,
        "shop_id": str(POS_SHOP_ID),
        "project_id": "t1",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        table_id = f"{DS}.fulfillment_orders"
        client.insert_rows_json(table_id, [record])
    except Exception as e:
        log.warning(f"Could not save validation failure: {e}")


# ──────────────────────────────────────────
# 3PL (euShipments) API Functions
# ──────────────────────────────────────────

def tpl_headers() -> dict:
    """Get authorization headers for euShipments API."""
    return {
        "Authorization": f"Bearer {TPL_API_TOKEN}",
        "Content-Type": "application/json",
    }


def check_3pl_stock() -> dict:
    """
    Get product availability from 3PL warehouse.
    Returns: dict mapping refNumber → available quantity.
    """
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


def map_pos_sku_to_3pl(barcode: str, product_name: str = "") -> str:
    """
    Map POS product to euShipments refNumber.
    
    euShipments uses product name/SKU (e.g. 'MK01TITANIUM') as refNumber,
    NOT the POS barcode (e.g. '1-1').
    
    Priority: product_name from variation_info > barcode
    """
    # Use product name (SKU) as refNumber — this is what euShipments expects
    sku = product_name.strip() if product_name else ""
    if sku:
        return sku
    # Fallback to barcode if no product name
    if barcode:
        return barcode.strip()
    return ""


def create_3pl_order(order: dict, items: list, test_mode: bool = True) -> dict:
    """
    Create fulfillment order via euShipments API.

    POS Cake data quirks:
    - shipping_address is a dict: {"address": "Street, ZIP City, Country", ...}
    - post_code, city, province fields are all null
    - COD is stored in cents (3200 = 32.00 EUR)
    - Phone: local format (0908...) needs +421 prefix

    Returns: API response dict
    """
    import re

    # 1. Recipient name & phone
    phone = normalize_phone(order.get("bill_phone_number", ""))
    name = order.get("bill_full_name", "") or order.get("customer_name", "")

    # 2. Address parsing — POS stores everything in shipping_address.address
    addr = order.get("shipping_address", "") or order.get("bill_address", "")
    street = ""
    city = ""
    zip_code = ""

    if isinstance(addr, dict):
        full_addr = addr.get("address", "") or addr.get("full_address", "") or ""

        # POS has TWO address formats:
        # Format A: "Street, ZIP City, Country" (e.g. "Ševčenkova 7, 036 01 Martin, Slovakia")
        # Format B: "ZIP | Region | City | Street, ZIP City, Country" (pipe-separated)
        #           e.g. "93037 | Trnavský kraj | Lehnice | Lehnice 446, 93037 Lehnice, Slovakia"

        # Detect pipe-separated format and extract last segment
        if "|" in full_addr:
            pipe_parts = [p.strip() for p in full_addr.split("|")]
            # Last part is: "Lehnice 446, 93037 Lehnice, Slovakia"
            last_part = pipe_parts[-1]
            # City is typically the 3rd segment (index 2)
            if len(pipe_parts) >= 3:
                city = pipe_parts[2].strip()
            # ZIP is typically the 1st segment
            if len(pipe_parts) >= 1 and re.match(r"^\d{3}\s?\d{2}$", pipe_parts[0].strip()):
                zip_code = pipe_parts[0].strip()
            # Street from last part: everything before first comma
            street = last_part.split(",")[0].strip()
            log.info(f"  Pipe-separated address detected: street='{street}', city='{city}', zip='{zip_code}'")
        else:
            # Standard format: "Street, ZIP City, Country"
            # Extract ZIP code (Slovak format: XXX XX or XXXXX)
            zip_match = re.search(r"\b(\d{3}\s?\d{2})\b", full_addr)
            if zip_match:
                zip_code = zip_match.group(1)

            # Extract city: text after ZIP before comma/country
            city_match = re.search(r"\d{3}\s?\d{2}\s+([A-Za-zÀ-žĀ-ž\s\-]+)", full_addr)
            if city_match:
                city = city_match.group(1).strip().rstrip(",").strip()
                for country_name in ["Slovakia", "Slovensko", "SK"]:
                    if city.lower().endswith(country_name.lower()):
                        city = city[:-(len(country_name))].strip().rstrip(",").strip()

            # Extract street: everything before the ZIP code
            if zip_match:
                street_part = full_addr[:zip_match.start()].strip().rstrip(",").strip()
                street = street_part if street_part else full_addr
            else:
                street = full_addr

        # Fallback: try POS dict fields
        if not city:
            city = (addr.get("province_name", "") or addr.get("city", "") or "").strip()
        if not zip_code:
            zip_code = (addr.get("post_code", "") or "").strip()
    else:
        # String address
        street = str(addr)
        zip_match = re.search(r"\b(\d{3}\s?\d{2})\b", street)
        if zip_match:
            zip_code = zip_match.group(1)
            city_match = re.search(r"\d{3}\s?\d{2}\s+([A-Za-zÀ-žĀ-ž\s\-]+)", street)
            if city_match:
                city = city_match.group(1).strip().rstrip(",").strip()

    # Fallback: try top-level POS fields
    if not city:
        city = (order.get("shipping_province", "") or order.get("bill_city", "") or "").strip()
    if not zip_code:
        zip_code = (order.get("bill_zipcode", "") or order.get("shipping_zipcode", "") or "").strip()

    # 3. Apply AI-corrected values (from sk_address_db fuzzy matching)
    city = order.get("_corrected_city", city) or city
    zip_code = order.get("_corrected_zip", zip_code) or zip_code

    log.info(f"  Parsed address: street='{street}', city='{city}', zip='{zip_code}'")

    # 4. Build products list — use product name/SKU as euShipments refNumber
    products = []
    for item in items:
        vi = item.get("variation_info", {}) or {}
        barcode = vi.get("barcode", "") or item.get("barcode", "")
        prod_name_sku = vi.get("name", "") or item.get("product_name", "")
        sku = map_pos_sku_to_3pl(barcode, prod_name_sku)
        qty = int(item.get("quantity", 1) or 1)
        if sku:
            products.append({"refNumber": sku, "qty": qty})

    # 5. COD amount — POS stores in cents (3200 = 32.00 EUR)
    cod_raw = float(order.get("cod", 0) or 0)
    cod_amount = cod_raw / 100.0  # Convert cents to EUR
    order_currency = order.get("order_currency", "EUR") or "EUR"

    log.info(f"  COD: {cod_raw} (raw) → {cod_amount:.2f} {order_currency}")

    # Build product names/info strings for AWB
    product_names = []
    product_infos = []
    for item in items:
        vi = item.get("variation_info", {}) or {}
        prod_name = vi.get("name", "") or item.get("product_name", "") or "Product"
        product_names.append(prod_name)
        product_infos.append(vi.get("display_id", "") or vi.get("barcode", "") or "")

    # 6. Build euShipments API payload (matching SOP + official docs v1.2)
    # SOP Fixed fields: weight=1, width/height/length=10, parcels=1
    total_qty = sum(p["qty"] for p in products) if products else 1

    payload = {
        "testMode": 0,  # Production mode (per euShipments support)
        "senderId": TPL_SENDER_ID,
        "courierId": TPL_COURIER_ID,
        "waybillAvailableDate": date.today().isoformat(),
        "serviceName": "crossborder",
        "recipient": {
            "name": name,
            "countryIsoCode": "SK",
            "cityName": city,
            "zipCode": zip_code.replace(" ", ""),
            "streetName": street,
            "phoneNumber": phone,
            "email": order.get("bill_email", "") or order.get("customer_email", "") or "",
        },
        "awb": {
            "referenceNumber": str(order.get('id', '')),  # Just order number, no prefix
            "bankRepayment": f"{cod_amount:.2f}",
            "products": " ".join(product_names) if product_names else "Product",
            "fragile": 0,
            "piecesInPack": total_qty,
            "parcels": 1,               # SOP: Number of Packages = 1
            "envelopes": 0,             # Required by API
            "totalWeight": 1,           # SOP: Weight = 1
            "width": 10,                # SOP: Width = 10
            "height": 10,               # SOP: Height = 10
            "length": 10,               # SOP: Length = 10
            "insurance": 0,
            "preview": 0,
            "saturdayDelivery": 0,
            "contents": FFM_CFG.get("default_shipment_content", "Bransoletka"),
            "productsInfo": ",".join(product_infos) if product_infos else "",
        },
        "products": products,
        "customsData": {
            "dutyPaymentInfo": "DDU",
            "customsValue": f"{cod_amount:.2f}",
        },
        "clientReference": str(order.get('id', '')),  # Just order number, no prefix
    }

    log.info(f"  Creating 3PL order: {json.dumps(payload, ensure_ascii=False, indent=2)}")

    url = f"{TPL_API_BASE}/fulfilment/create-order"
    resp = requests.post(url, headers=tpl_headers(), json=payload, timeout=30)

    # Log response BEFORE raise_for_status so we can see 400 error details
    log.info(f"  API Response: {resp.status_code} | {resp.text[:500]}")

    if resp.status_code != 200:
        error_detail = resp.text[:500]
        log.error(f"  ❌ euShipments API error {resp.status_code}: {error_detail}")
        raise requests.exceptions.HTTPError(
            f"{resp.status_code}: {error_detail}", response=resp
        )

    # Response: {"orderId": 74578, "error": false, "code": 200}
    try:
        result = resp.json()
        log.info(f"  ✅ Order created! orderId={result.get('orderId')}")
        return result
    except Exception:
        return {"error": False, "orderId": f"HTTP-{resp.status_code}", "code": resp.status_code}


# ──────────────────────────────────────────
# Discord Alert
# ──────────────────────────────────────────

def alert_discord(message: str, is_error: bool = True):
    """Send alert to Discord webhook."""
    if not DISCORD_WEBHOOK_ALERT:
        log.warning(f"Discord webhook not configured. Message: {message}")
        return

    emoji = "🔴" if is_error else "⚠️"
    payload = {
        "content": f"{emoji} **[T1 Fulfillment]** {message}",
    }

    try:
        resp = requests.post(DISCORD_WEBHOOK_ALERT, json=payload, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        log.error(f"Discord alert failed: {e}")


# ──────────────────────────────────────────
# Main Orchestration
# ──────────────────────────────────────────

def main():
    """Main fulfillment automation flow."""
    dry_run = "--dry-run" in sys.argv
    use_test = "--test" in sys.argv or TPL_TEST_MODE

    log.info("=" * 60)
    log.info("  T1 Fulfillment Automation")
    log.info(f"  Mode: {'DRY RUN (validate only)' if dry_run else 'LIVE'}")
    log.info(f"  3PL Test Mode: {use_test}")
    log.info(f"  Market: Slovakia (SK) | Courier ID: {TPL_COURIER_ID}")
    log.info("=" * 60)

    # Validate config
    if not dry_run:
        if not TPL_API_BASE or not TPL_API_TOKEN:
            log.error("❌ 3PL API chưa cấu hình! Kiểm tra t1.yaml → fulfillment section.")
            log.error("   Chạy với --dry-run để chỉ validate addresses.")
            return
        if not TPL_SENDER_ID:
            log.error("❌ sender_id chưa cấu hình! Kiểm tra t1.yaml → fulfillment.sender_id")
            return

    # 1. Fetch packing orders from POS Cake
    log.info("\n📋 Step 1: Fetching packing orders (status=8)...")
    orders = fetch_packing_orders()
    log.info(f"   Found {len(orders)} orders with status=packing")

    if not orders:
        log.info("   No packing orders found. Exiting.")
        return

    # 2. Filter orders not yet sent to 3PL
    log.info("\n🔍 Step 2: Filtering new orders...")
    bq_client = bigquery.Client(project=GCP_PROJECT)
    existing_ids = get_existing_fulfillment_ids(bq_client)
    new_orders = [o for o in orders if str(o.get("id", "")) not in existing_ids]

    log.info(f"   {len(orders)} total packing → {len(new_orders)} new (not in fulfillment_orders)")

    if not new_orders:
        log.info("   All packing orders already processed. Exiting.")
        return

    # 3. Validate + process each order
    log.info(f"\n✅ Step 3: Validating & processing {len(new_orders)} orders...")

    # Pre-load 3PL stock once (not per order)
    stock = {}
    if not dry_run:
        log.info("\n📦 Step 3a: Loading 3PL stock...")
        try:
            stock = check_3pl_stock()
            log.info(f"   Loaded {len(stock)} SKUs from 3PL warehouse")
        except Exception as e:
            log.warning(f"   ⚠️ Could not load 3PL stock: {e}")
            log.warning("   Will proceed without stock check")

    stats = {"total": len(new_orders), "valid": 0, "invalid": 0,
             "created": 0, "failed": 0, "skipped": 0, "out_of_stock": 0,
             "corrected": 0}

    for i, order in enumerate(new_orders, 1):
        order_id = order.get("id", "UNKNOWN")
        log.info(f"\n--- Order {i}/{len(new_orders)}: {order_id} ---")

        # 3a. Validate address + phone (with AI auto-correction)
        result = validate_order(order)

        # Apply AI corrections to order data
        if result.corrections:
            stats["corrected"] += 1
            correction_msg = []
            for key, fix in result.corrections.items():
                correction_msg.append(
                    f"  🔧 {key}: '{fix['original']}' → '{fix['corrected']}'"
                )
            log.info(f"   AI Corrections applied:\n" + "\n".join(correction_msg))

            # Apply city correction to order for 3PL submission
            if "city" in result.corrections:
                corrected_city = result.corrections["city"]["corrected"]
                # Update order data for downstream use
                order["_corrected_city"] = corrected_city

            # Apply ZIP correction
            if "zip" in result.corrections:
                corrected_zip = result.corrections["zip"]["corrected"]
                order["_corrected_zip"] = corrected_zip
            elif "zip_format" in result.corrections:
                order["_corrected_zip"] = result.corrections["zip_format"]["corrected"]

        if not result.is_valid:
            stats["invalid"] += 1
            error_msg = (
                f"Đơn `{order_id}` validation FAILED:\n"
                + "\n".join(f"  • {e}" for e in result.errors)
            )
            log.warning(f"   ❌ {error_msg}")

            # Alert Discord
            alert_discord(error_msg)

            # Save failure record to BQ
            save_validation_failure(bq_client, order_id, result.errors, result.warnings)

            # STOP — need manual fix
            log.warning(f"   ⏹ Đơn {order_id} dừng lại — cần sửa thủ công")
            continue

        stats["valid"] += 1

        if result.warnings:
            log.info(f"   ⚠️ Warnings: {result.warnings}")

        # If dry run, skip actual 3PL creation
        if dry_run:
            log.info(f"   🏃 DRY RUN — skipping stock check & 3PL order creation")
            stats["skipped"] += 1
            continue

        # 3b. MANDATORY: Check 3PL stock before creating order
        items = order.get("items", []) or []
        stock_ok = True

        if stock:
            for item in items:
                vi = item.get("variation_info", {}) or {}
                barcode = vi.get("barcode", "") or item.get("barcode", "")
                sku = map_pos_sku_to_3pl(barcode)
                qty_needed = int(item.get("quantity", 1) or 1)
                avail = stock.get(sku, -1)  # -1 = SKU not found

                if avail == 0:
                    stock_ok = False
                    alert_discord(
                        f"🚫 **HẾT HÀNG** SKU `{sku}` cho đơn `{order_id}`. "
                        f"Cần nhập thêm hàng vào kho HelpShip Oradea."
                    )
                    log.error(f"   ❌ OUT OF STOCK: SKU '{sku}' avail=0")
                elif avail > 0 and avail < qty_needed:
                    stock_ok = False
                    alert_discord(
                        f"⚠️ **KHÔNG ĐỦ HÀNG** SKU `{sku}` cho đơn `{order_id}`: "
                        f"cần {qty_needed}, kho còn {avail}"
                    )
                    log.error(
                        f"   ❌ INSUFFICIENT STOCK: SKU '{sku}' "
                        f"need={qty_needed}, avail={avail}"
                    )
                elif avail == -1:
                    log.warning(f"   ⚠️ SKU '{sku}' not found in 3PL — check mapping")
                    # Don't block - SKU might have different naming
                else:
                    log.info(f"   ✅ SKU '{sku}': avail={avail}, need={qty_needed}")

            if not stock_ok:
                stats["out_of_stock"] += 1
                save_validation_failure(
                    bq_client, order_id,
                    ["Hết hàng / không đủ tồn kho trong 3PL"],
                    ["Check stock trước khi retry"]
                )
                log.warning(f"   ⏹ Đơn {order_id} dừng — hết hàng trong kho 3PL")
                continue
        else:
            log.warning("   ⚠️ Stock data not available — skipping stock check")

        # 3c. Create 3PL order (with corrected address data)
        try:
            tpl_result = create_3pl_order(order, items, test_mode=use_test)

            if tpl_result.get("error") is False or tpl_result.get("error") is None:
                tpl_order_id = tpl_result.get("orderId")
                log.info(f"   ✅ 3PL order created: {tpl_order_id}")
                stats["created"] += 1

                # Save to BigQuery
                now = datetime.now(timezone.utc).isoformat()
                corrected_city = order.get(
                    "_corrected_city",
                    order.get("shipping_province", "")
                )
                record = {
                    "pos_order_id": str(order_id),
                    "tpl_order_id": tpl_order_id,
                    "courier_name": "Slovakia GLS",
                    "courier_id": TPL_COURIER_ID,
                    "warehouse": TPL_WAREHOUSE,
                    "recipient_name": order.get("bill_full_name", ""),
                    "recipient_phone": normalize_phone(order.get("bill_phone_number", "")),
                    "recipient_city": corrected_city,
                    "recipient_country": "SK",
                    "cod_amount": float(order.get("cod", 0) or 0),
                    "items_count": len(items),
                    "status": "created",
                    "is_test": use_test,
                    "shop_id": str(POS_SHOP_ID),
                    "project_id": "t1",
                    "created_at": now,
                    "error_message": "",
                }
                save_fulfillment_order(bq_client, record)

            else:
                error_msg = tpl_result.get("error", "Unknown error")
                log.error(f"   ❌ 3PL order failed: {error_msg}")
                stats["failed"] += 1
                alert_discord(f"3PL order failed for `{order_id}`: {error_msg}")

        except Exception as e:
            log.error(f"   ❌ 3PL API error: {e}")
            stats["failed"] += 1
            alert_discord(f"3PL API error for `{order_id}`: {str(e)}")

    # 4. Summary
    log.info("\n" + "=" * 60)
    log.info("  📊 SUMMARY")
    log.info(f"  Total packing orders:  {stats['total']}")
    log.info(f"  ✅ Valid:               {stats['valid']}")
    log.info(f"  ❌ Invalid (stopped):   {stats['invalid']}")
    log.info(f"  🔧 AI corrected:       {stats['corrected']}")
    log.info(f"  📦 Out of stock:       {stats['out_of_stock']}")
    log.info(f"  🚚 3PL created:        {stats['created']}")
    log.info(f"  💥 3PL failed:         {stats['failed']}")
    log.info(f"  🏃 Skipped (dry-run):  {stats['skipped']}")
    log.info("=" * 60)

    # Alert summary to Discord if any issues
    if stats["invalid"] > 0 or stats["failed"] > 0 or stats["out_of_stock"] > 0:
        alert_discord(
            f"Kết quả sync: {stats['created']} đơn tạo thành công, "
            f"{stats['invalid']} đơn lỗi validation, "
            f"{stats['out_of_stock']} đơn hết hàng, "
            f"{stats['failed']} đơn lỗi 3PL, "
            f"{stats['corrected']} đơn AI sửa địa chỉ. Kiểm tra log.",
            is_error=(stats["invalid"] > 0)
        )


if __name__ == "__main__":
    main()
