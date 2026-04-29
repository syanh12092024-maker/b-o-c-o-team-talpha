#!/usr/bin/env python3
"""
Sync Pancake POS Orders -> BigQuery T1_Dataset.
Pulls all orders from Pancake POS API and inserts into sale_order + order_items tables.
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
import yaml
from google.cloud import bigquery

# Setup
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("sync.pancake")

PROJECT_ROOT = Path(__file__).parent.parent.parent
CONFIG_PATH = PROJECT_ROOT / "config" / "projects" / "t1.yaml"

# Load config
with open(CONFIG_PATH, encoding="utf-8") as f:
    CFG = yaml.safe_load(f)

# Load .env file
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


def _resolve_env(val):
    """Resolve ${ENV_VAR} placeholders in YAML values."""
    if isinstance(val, str) and val.startswith("${") and val.endswith("}"):
        env_key = val[2:-1]
        return os.environ.get(env_key, val)
    return val


API_TOKEN = _resolve_env(CFG["pancake"]["api_token"])
SHOP_ID = CFG["pancake"]["page_ids"][0]
API_BASE = CFG["pancake"]["api_url"]
GCP_PROJECT = CFG["bigquery"]["project_gcp"]
DATASET = CFG["bigquery"]["dataset"]
DS = f"{GCP_PROJECT}.{DATASET}"

# ─── Currency conversion ───
# RON (LEI) → EUR fixed exchange rate
# 1 RON ≈ 0.20 EUR (approximate rate March 2026)
RON_TO_EUR = 0.20

# Currencies that need conversion to EUR
RON_ALIASES = {"RON", "ron", "LEI", "lei", "Lei", "Leu", "leu"}

# Pancake POS status mapping — matched to POS UI tabs
# See: POS > Đơn hàng tabs (Tất cả / Mới / Đã xác nhận / ...)
STATUS_MAP = {
    0: "new",               # Mới
    1: "confirmed",         # Đã xác nhận
    2: "waiting_stock",     # Chờ hàng
    3: "received",          # Đã nhận (tiền) — chờ đối soát, NOT real revenue
    4: "returning",         # Đang hoàn
    5: "returned",          # Đã hoàn
    6: "canceled",          # Đã hủy
    7: "waiting_ship",      # Chờ chuyển hàng
    8: "packing",           # Đang đóng hàng
    9: "shipped",           # Đã gửi hàng
    10: "exchanging",       # Đang đổi
    11: "exchanged",        # Đã đổi
    12: "partial_return",   # Hoàn một phần
    16: "paid",             # ĐÃ THU TIỀN — REAL REVENUE ✅
}


def fetch_all_orders():
    """Fetch all orders from Pancake POS API with pagination."""
    all_orders = []
    page = 1
    total_pages = 1

    while page <= total_pages and page <= 50:
        url = f"{API_BASE}/shops/{SHOP_ID}/orders"
        params = {"api_key": API_TOKEN, "page": page, "limit": 100}

        log.info(f"Fetching page {page}/{total_pages}...")
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        orders = data.get("data", [])
        all_orders.extend(orders)
        total_pages = data.get("total_pages", 1)

        log.info(f"  Got {len(orders)} orders (total so far: {len(all_orders)})")
        page += 1

    return all_orders


def _safe_str(val, default=""):
    """Convert any value to string, serializing dicts/lists to JSON."""
    if val is None:
        return default
    if isinstance(val, (dict, list)):
        return json.dumps(val, ensure_ascii=False)
    return str(val)


def _safe_float(val, default=0.0):
    """Safely convert to float."""
    try:
        return float(val or default)
    except (TypeError, ValueError):
        return default


def _safe_int(val, default=0):
    """Safely convert to int."""
    try:
        return int(val or default)
    except (TypeError, ValueError):
        return default


def _currency_multiplier(currency_str: str) -> float:
    """Get multiplier to convert from the given currency to EUR.
    Returns 1.0 for EUR (no conversion), RON_TO_EUR for RON/LEI."""
    if currency_str in RON_ALIASES:
        return RON_TO_EUR
    return 1.0  # Default: assume EUR


def transform_order(o):
    """Transform a Pancake order to BQ sale_order row.
    All monetary fields are normalized to EUR for consistent reporting."""
    now = datetime.now(timezone.utc).isoformat()
    status = _safe_int(o.get("status", 0))
    items = o.get("items", []) or []

    # Extract address parts
    addr = o.get("shipping_address", "")
    if isinstance(addr, dict):
        province = addr.get("province", "")
        district = addr.get("district", "")
        addr_str = json.dumps(addr, ensure_ascii=False)
    else:
        province = _safe_str(o.get("shipping_province", ""))
        district = _safe_str(o.get("shipping_district", ""))
        addr_str = _safe_str(addr)

    # ─── Currency conversion: RON/LEI → EUR ───
    raw_currency = _safe_str(o.get("order_currency", "EUR"))
    multiplier = _currency_multiplier(raw_currency)
    is_converted = multiplier != 1.0

    # Original values (in original currency)
    raw_total_price = _safe_float(o.get("total_price"))
    raw_cod = _safe_float(o.get("cod"))
    raw_prepaid = _safe_float(o.get("prepaid"))
    raw_total_after_disc = _safe_float(o.get("total_price_after_sub_discount"))
    raw_discount = _safe_float(o.get("total_discount"))
    raw_shipping = _safe_float(o.get("shipping_fee"))
    raw_partner_fee = _safe_float(o.get("partner_fee"))
    raw_return_fee = _safe_float(o.get("return_fee"))

    if is_converted:
        log.info(
            f"  💱 Order {o.get('id')}: Converting {raw_currency} → EUR "
            f"(rate {multiplier}, total_price {raw_total_price} → {raw_total_price * multiplier:.0f})"
        )

    return {
        "id": _safe_str(o.get("id")),
        "system_id": o.get("system_id"),
        "shop_id": str(SHOP_ID),
        "shop_name": "T1",
        "project_id": "t1",
        "status": status,
        "status_name": STATUS_MAP.get(status, "unknown"),
        # Monetary fields — normalized to EUR
        "cod": raw_cod * multiplier,
        "prepaid": raw_prepaid * multiplier,
        "total_price": raw_total_price * multiplier,
        "total_price_after_sub_discount": raw_total_after_disc * multiplier,
        "total_discount": raw_discount * multiplier,
        "shipping_fee": raw_shipping * multiplier,
        "partner_fee": raw_partner_fee * multiplier,
        "return_fee": raw_return_fee * multiplier,
        # Original currency tracking
        "order_currency": "EUR",  # After conversion, everything is EUR
        "original_currency": raw_currency or "EUR",
        "currency_rate": multiplier,
        # Non-monetary fields
        "total_quantity": _safe_int(o.get("total_quantity")),
        "items_length": len(items),
        "bill_full_name": _safe_str(o.get("bill_full_name")),
        "bill_phone_number": _safe_str(o.get("bill_phone_number")),
        "bill_email": _safe_str(o.get("bill_email")),
        "customer_id": _safe_str(o.get("customer_id")),
        "customer_name": _safe_str(o.get("customer_name")),
        "shipping_address": addr_str,
        "shipping_province": province,
        "shipping_district": district,
        "marketer": _safe_str(o.get("marketer")),
        "pke_mkter": _safe_str(o.get("pke_mkter")),
        "creator": _safe_str(o.get("creator")),
        "ad_id": _safe_str(o.get("ad_id")),
        "adset_id": _safe_str(o.get("adset_id")),
        "ads_source": _safe_str(o.get("ads_source")),
        "p_utm_source": _safe_str(o.get("p_utm_source")),
        "p_utm_campaign": _safe_str(o.get("p_utm_campaign")),
        "p_utm_medium": _safe_str(o.get("p_utm_medium")),
        "p_utm_content": _safe_str(o.get("p_utm_content")),
        "p_utm_term": _safe_str(o.get("p_utm_term")),
        "p_utm_id": _safe_str(o.get("p_utm_id")),
        "order_sources_name": _safe_str(o.get("order_sources_name")),
        "page_id": _safe_str(o.get("page_id")),
        "conversation_id": _safe_str(o.get("conversation_id")),
        "post_id": _safe_str(o.get("post_id")),
        "is_livestream": bool(o.get("is_livestream", False)),
        "is_live_shopping": bool(o.get("is_live_shopping", False)),
        "partner": _safe_str(o.get("partner")),
        "tracking_link": _safe_str(o.get("tracking_link")),
        "inserted_at": _safe_str(o.get("inserted_at")),
        "updated_at": _safe_str(o.get("updated_at")),
        "time_send_partner": _safe_str(o.get("time_send_partner")),
        "note": _safe_str(o.get("note"))[:500],
        "tags": _safe_str(o.get("tags")),
        "sync_time": now,
    }


def transform_item(order, item):
    """Transform a Pancake order item to BQ order_items row.
    Prices are converted to EUR using order-level currency."""
    now = datetime.now(timezone.utc).isoformat()
    vi = item.get("variation_info", {}) or {}

    # Apply same currency conversion as order
    raw_currency = _safe_str(order.get("order_currency", "EUR"))
    multiplier = _currency_multiplier(raw_currency)

    return {
        "item_id": str(item.get("id", "")),
        "order_id": str(order.get("id", "")),
        "order_system_id": order.get("system_id"),
        "shop_id": str(SHOP_ID),
        "shop_name": "T1",
        "project_id": "t1",
        "product_id": str(item.get("product_id", "") or ""),
        "variation_id": str(item.get("variation_id", "") or vi.get("id", "")),
        "product_name": item.get("product_name", "") or vi.get("name", ""),
        "variation_name": vi.get("name", ""),
        "barcode": vi.get("barcode", ""),
        "quantity": int(item.get("quantity", 1) or 1),
        "return_quantity": int(item.get("return_quantity", 0) or 0),
        "returned_count": int(item.get("returned_count", 0) or 0),
        "returning_quantity": int(item.get("returning_quantity", 0) or 0),
        "retail_price": float(vi.get("retail_price", 0) or 0) * multiplier,
        "discount_each_product": float(item.get("discount_each_product", 0) or 0) * multiplier,
        "avg_imported_price": float(vi.get("average_imported_price", 0) or 0) * multiplier,
        "order_inserted_at": order.get("inserted_at", ""),
        "sync_time": now,
    }


def insert_to_bq(client, table_name, rows):
    """Insert rows using batch load (WRITE_TRUNCATE) to avoid streaming buffer issues."""
    import io
    import json as json_mod

    table_id = f"{DS}.{table_name}"
    total = len(rows)

    job_config = bigquery.LoadJobConfig(
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
    )

    ndjson = "\n".join(json_mod.dumps(r) for r in rows)
    job = client.load_table_from_file(
        io.BytesIO(ndjson.encode("utf-8")),
        table_id,
        job_config=job_config,
    )
    job.result()  # Wait for completion

    log.info(f"  Batch loaded {total} rows to {table_name} (WRITE_TRUNCATE)")
    return 0


def main():
    log.info("=" * 50)
    log.info("  Pancake POS -> BigQuery Sync (T1)")
    log.info("=" * 50)

    # 1. Fetch orders
    orders = fetch_all_orders()
    log.info(f"Total orders fetched: {len(orders)}")

    if not orders:
        log.warning("No orders found. Exiting.")
        return

    # 2. Transform
    sale_rows = []
    item_rows = []
    for o in orders:
        sale_rows.append(transform_order(o))
        for item in o.get("items", []):
            item_rows.append(transform_item(o, item))

    log.info(f"Transformed: {len(sale_rows)} orders, {len(item_rows)} items")

    # 3. Dedup — remove duplicate order IDs (keep latest by sync_time)
    seen_orders = {}
    for r in sale_rows:
        seen_orders[r["id"]] = r  # Last wins
    dedup_count = len(sale_rows) - len(seen_orders)
    sale_rows = list(seen_orders.values())
    if dedup_count > 0:
        log.info(f"  Dedup: removed {dedup_count} duplicate orders")
    log.info(f"After dedup: {len(sale_rows)} unique orders")

    # Dedup items by item_id
    seen_items = {}
    for r in item_rows:
        seen_items[r["item_id"]] = r
    item_dedup = len(item_rows) - len(seen_items)
    item_rows = list(seen_items.values())
    if item_dedup > 0:
        log.info(f"  Dedup: removed {item_dedup} duplicate items")

    # 4. Safety check + Batch load (WRITE_TRUNCATE = atomic replace)
    client = bigquery.Client(project=GCP_PROJECT)

    # Safety guard: abort if new data is <50% of existing to prevent wipe on API failure
    try:
        existing = list(client.query(f"SELECT COUNT(*) cnt FROM `{DS}.sale_order`").result())[0].cnt
        if existing > 0 and len(sale_rows) < existing * 0.5:
            log.error(f"SAFETY ABORT: API returned {len(sale_rows)} orders but BQ has {existing}. Possible API failure.")
            return
    except Exception:
        pass  # Table might not exist yet

    log.info("Batch loading to BigQuery (WRITE_TRUNCATE)...")
    insert_to_bq(client, "sale_order", sale_rows)
    insert_to_bq(client, "order_items", item_rows)

    log.info("=" * 50)
    log.info(f"  DONE: {len(sale_rows)} orders, {len(item_rows)} items synced (deduped)")
    log.info("=" * 50)


if __name__ == "__main__":
    main()
