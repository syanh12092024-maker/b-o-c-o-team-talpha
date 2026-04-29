#!/usr/bin/env python3
"""
T1 Auto Status Sync: euShipments → POS Cake

Quy tắc cập nhật trạng thái:
┌──────────────────────────────────────────────────────────────────────┐
│ euShipments Status         │ Type     │ POS Status    │ POS Code   │
├────────────────────────────┼──────────┼───────────────┼────────────┤
│ Delivered                  │ Outgoing │ Đã nhận       │ 3          │
│ Delivered                  │ Incoming │ Đã hoàn       │ 5          │
│ Returned                   │ *        │ Đang hoàn     │ 4          │
│ On delivery / Warehouse    │ *        │ Đã gửi hàng   │ 9          │
│ In the office / Scanned    │          │               │            │
│ Waybill (còn lại)          │          │               │            │
└──────────────────────────────────────────────────────────────────────┘

Data Sources (in priority order):
  1. euShipments API (AWB tracking / order detail)
  2. CSV export from euShipments panel (fallback)

Workflow:
1. Lấy danh sách fulfillment_orders từ BigQuery (có AWB + clientReference)
2. Với mỗi order: lấy status từ euShipments (API hoặc CSV)
3. Map status + type → POS status code theo quy tắc
4. Gọi Pancake POS API cập nhật trạng thái đơn
5. Cập nhật BigQuery fulfillment_orders.status
6. Log kết quả

Usage:
    python auto_status_sync.py                          # Sync via API
    python auto_status_sync.py --dry-run                # Chỉ kiểm tra, không cập nhật
    python auto_status_sync.py --from-csv data.csv      # Sync từ CSV export
"""

import csv
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
import yaml
from google.cloud import bigquery

# ──────────────────────────────────────────
# Setup
# ──────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("fulfillment.status_sync")

PROJECT_ROOT = Path(__file__).parent.parent.parent
CONFIG_PATH = PROJECT_ROOT / "config" / "projects" / "t1.yaml"

# Load config
with open(CONFIG_PATH, encoding="utf-8") as f:
    CFG = yaml.safe_load(f)

# POS Cake config
POS_API_BASE = CFG["pancake"]["api_url"]
POS_API_TOKEN = CFG["pancake"]["api_token"]
POS_SHOP_ID = CFG["pancake"]["page_ids"][0]

# BigQuery config
GCP_PROJECT = CFG["bigquery"]["project_gcp"]
DATASET = CFG["bigquery"]["dataset"]
DS = f"{GCP_PROJECT}.{DATASET}"

# BigQuery credentials
BQ_KEY_PATH = PROJECT_ROOT / "bigquery_key_t1.json"
if BQ_KEY_PATH.exists():
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(BQ_KEY_PATH)

# euShipments (3PL) config
FFM_CFG = CFG.get("fulfillment", {})
TPL_API_BASE = FFM_CFG.get("api_url", "")
TPL_API_TOKEN = FFM_CFG.get("api_token", "")
TPL_SENDER_ID = FFM_CFG.get("sender_id", 0)

# Discord
DISCORD_WEBHOOK_ALERT = os.getenv("DISCORD_WEBHOOK_ALERT", "")

# ──────────────────────────────────────────
# Status Mapping Constants
# ──────────────────────────────────────────

# POS Cake status codes (from sync_pancake_orders.py)
POS_STATUS = {
    "da_nhan":     3,    # Đã nhận (tiền) — Delivered Outgoing
    "dang_hoan":   4,    # Đang hoàn — Returned
    "da_hoan":     5,    # Đã hoàn — Delivered Incoming (return completed)
    "da_gui_hang": 9,    # Đã gửi hàng — On delivery / In transit
}

# euShipments status → POS mapping
# Status names from euShipments tracking API (case-insensitive matching)
EU_STATUS_DELIVERED = ["delivered", "доставена"]
EU_STATUS_RETURNED = ["returned", "върната"]
EU_STATUS_IN_TRANSIT = [
    "on delivery", "on_delivery",
    "warehouse oradea", "warehouse",
    "in the office", "in_the_office",
    "scanned waybill", "scanned_waybill", "scanned",
    "in transit", "in_transit",
    "shipped", "picked up", "picked_up",
    "at courier", "at_courier",
    "processing", "accepted",
]

# euShipments shipment type
EU_TYPE_OUTGOING = ["outgoing", "out"]
EU_TYPE_INCOMING = ["incoming", "in", "return"]


def normalize_eu_status(status_str: str) -> str:
    """Normalize euShipments status string for matching."""
    return (status_str or "").strip().lower()


def normalize_eu_type(type_str: str) -> str:
    """Normalize euShipments shipment type string for matching."""
    return (type_str or "").strip().lower()


def map_eu_to_pos_status(eu_status: str, eu_type: str) -> tuple:
    """
    Map euShipments status + type to POS Cake status code.

    Returns: (pos_status_code, pos_status_name, action_description)
             or (None, None, None) if no mapping found.
    """
    status = normalize_eu_status(eu_status)
    shipment_type = normalize_eu_type(eu_type)

    # Rule 1: Delivered + Outgoing → Đã nhận (3)
    if any(s in status for s in EU_STATUS_DELIVERED):
        if any(t in shipment_type for t in EU_TYPE_OUTGOING):
            return POS_STATUS["da_nhan"], "Đã nhận", "Delivered (Outgoing) → Đã nhận"

        # Rule 2: Delivered + Incoming → Đã hoàn (5)
        if any(t in shipment_type for t in EU_TYPE_INCOMING):
            return POS_STATUS["da_hoan"], "Đã hoàn", "Delivered (Incoming/Return) → Đã hoàn"

        # Delivered without type → default to Đã nhận (Outgoing most common)
        return POS_STATUS["da_nhan"], "Đã nhận", "Delivered (unknown type) → Đã nhận"

    # Rule 3: Returned → Đang hoàn (4)
    if any(s in status for s in EU_STATUS_RETURNED):
        return POS_STATUS["dang_hoan"], "Đang hoàn", "Returned → Đang hoàn"

    # Rule 4: On delivery / Warehouse / In the office / Scanned Waybill → Đã gửi hàng (9)
    if any(s in status for s in EU_STATUS_IN_TRANSIT):
        return POS_STATUS["da_gui_hang"], "Đã gửi hàng", "In transit → Đã gửi hàng"

    return None, None, None


# ──────────────────────────────────────────
# euShipments API Functions
# ──────────────────────────────────────────

def tpl_headers() -> dict:
    return {
        "Authorization": f"Bearer {TPL_API_TOKEN}",
        "Content-Type": "application/json",
    }


def get_tracking_status(awb: str) -> dict:
    """
    Get tracking/status info for a shipment via euShipments API.
    Returns: dict with status, type, events, etc.
    """
    url = f"{TPL_API_BASE}/fulfilment/get-awb-status"
    params = {"awb": awb}

    try:
        resp = requests.get(url, headers=tpl_headers(), params=params, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            return data if data else {}
        else:
            log.warning(f"  Tracking API {resp.status_code} for AWB {awb}: {resp.text[:200]}")
            return {}
    except Exception as e:
        log.error(f"  Tracking API error for AWB {awb}: {e}")
        return {}


def get_order_detail(order_id) -> dict:
    """
    Get order detail from euShipments to obtain status + type.
    """
    url = f"{TPL_API_BASE}/fulfilment/get-order"
    params = {"orderId": order_id}

    try:
        resp = requests.get(url, headers=tpl_headers(), params=params, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            return data if data else {}
        else:
            # Try POST
            resp2 = requests.post(url, headers=tpl_headers(),
                                  json={"orderId": order_id}, timeout=30)
            if resp2.status_code == 200:
                return resp2.json() or {}
            log.warning(f"  Order detail API error for order {order_id}: {resp.status_code}")
            return {}
    except Exception as e:
        log.error(f"  Order detail API error for order {order_id}: {e}")
        return {}


def extract_status_from_tracking(tracking_data: dict) -> tuple:
    """
    Extract current status and type from euShipments tracking response.

    The tracking response can have various structures. We try multiple
    known field names.

    Returns: (status_str, type_str)
    """
    if not tracking_data:
        return "", ""

    # Direct fields
    status = (
        tracking_data.get("status") or
        tracking_data.get("STATUS") or
        tracking_data.get("statusName") or
        tracking_data.get("STATUS_NAME") or
        tracking_data.get("currentStatus") or
        tracking_data.get("lastStatus") or
        ""
    )

    shipment_type = (
        tracking_data.get("type") or
        tracking_data.get("TYPE") or
        tracking_data.get("shipmentType") or
        tracking_data.get("SHIPMENT_TYPE") or
        tracking_data.get("orderType") or
        ""
    )

    # If tracking has events array, get latest event status
    events = (
        tracking_data.get("events") or
        tracking_data.get("EVENTS") or
        tracking_data.get("history") or
        tracking_data.get("tracking") or
        []
    )

    if events and isinstance(events, list) and len(events) > 0:
        latest = events[-1] if isinstance(events[-1], dict) else events[0]
        if not status:
            status = (
                latest.get("status") or latest.get("STATUS") or
                latest.get("statusName") or latest.get("event") or ""
            )
        if not shipment_type:
            shipment_type = (
                latest.get("type") or latest.get("TYPE") or
                latest.get("shipmentType") or ""
            )

    # Nested data structure
    if isinstance(tracking_data.get("data"), dict):
        nested = tracking_data["data"]
        if not status:
            status = nested.get("status") or nested.get("statusName") or ""
        if not shipment_type:
            shipment_type = nested.get("type") or nested.get("shipmentType") or ""

    return str(status), str(shipment_type)


def extract_status_from_order(order_data: dict) -> tuple:
    """
    Extract status and type from euShipments order detail response.
    Returns: (status_str, type_str)
    """
    if not order_data:
        return "", ""

    status = (
        order_data.get("status") or
        order_data.get("STATUS") or
        order_data.get("statusName") or
        order_data.get("STATUS_NAME") or
        ""
    )

    shipment_type = (
        order_data.get("type") or
        order_data.get("TYPE") or
        order_data.get("shipmentType") or
        order_data.get("SHIPMENT_TYPE") or
        ""
    )

    return str(status), str(shipment_type)


# ──────────────────────────────────────────
# POS Cake API Functions
# ──────────────────────────────────────────

def update_pos_order_status(order_id: str, new_status: int) -> bool:
    """
    Update order status on Pancake POS.

    PUT /shops/{SHOP_ID}/orders/{ORDER_ID}
    Body: { "status": <code> }

    Returns: True if successful
    """
    url = f"{POS_API_BASE}/shops/{POS_SHOP_ID}/orders/{order_id}"
    params = {"api_key": POS_API_TOKEN}
    payload = {"status": new_status}

    try:
        resp = requests.put(url, params=params, json=payload, timeout=30)

        if resp.status_code in [200, 201, 204]:
            log.info(f"  ✅ POS updated: order {order_id} → status {new_status}")
            return True
        else:
            log.error(
                f"  ❌ POS update failed: order {order_id} → "
                f"HTTP {resp.status_code}: {resp.text[:200]}"
            )
            return False
    except Exception as e:
        log.error(f"  ❌ POS update error for order {order_id}: {e}")
        return False


# ──────────────────────────────────────────
# BigQuery Functions
# ──────────────────────────────────────────

def get_active_fulfillment_orders(client: bigquery.Client) -> list:
    """
    Get all fulfillment orders that need status checking.
    Only orders with tpl_order_id and AWB, not yet in terminal state.
    """
    query = f"""
    SELECT
        pos_order_id,
        tpl_order_id,
        COALESCE(awb, '') as awb,
        status,
        COALESCE(recipient_name, '') as recipient_name,
        COALESCE(recipient_city, '') as recipient_city,
        COALESCE(cod_amount, 0) as cod_amount
    FROM `{DS}.fulfillment_orders`
    WHERE tpl_order_id IS NOT NULL
      AND status NOT IN ('delivered_confirmed', 'returned_confirmed',
                         'cancelled', 'validation_failed')
    ORDER BY created_at DESC
    """

    try:
        result = client.query(query).result()
        orders = [dict(row) for row in result]
        log.info(f"  Found {len(orders)} active fulfillment orders to check")
        return orders
    except Exception as e:
        log.error(f"  Could not fetch active orders: {e}")
        return []


def update_fulfillment_status(client: bigquery.Client, pos_order_id: str,
                               new_status: str, eu_status: str,
                               eu_type: str):
    """Update status in BigQuery fulfillment_orders."""
    query = f"""
    UPDATE `{DS}.fulfillment_orders`
    SET status = @new_status,
        last_status_update = CURRENT_TIMESTAMP(),
        error_message = CONCAT(
            COALESCE(error_message, ''),
            ' | ', @update_note
        )
    WHERE pos_order_id = @pos_order_id
    """

    update_note = (
        f"[{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}] "
        f"euShipments: {eu_status}/{eu_type} → POS: {new_status}"
    )

    try:
        client.query(query, job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("new_status", "STRING", new_status),
                bigquery.ScalarQueryParameter("update_note", "STRING", update_note),
                bigquery.ScalarQueryParameter("pos_order_id", "STRING", pos_order_id),
            ]
        )).result()
        log.info(f"  BQ updated: {pos_order_id} → {new_status}")
    except Exception as e:
        log.error(f"  BQ update error for {pos_order_id}: {e}")


# ──────────────────────────────────────────
# Discord Alert
# ──────────────────────────────────────────

def alert_discord(message: str, is_error: bool = False):
    """Send alert to Discord webhook."""
    if not DISCORD_WEBHOOK_ALERT:
        return

    emoji = "🔴" if is_error else "📦"
    payload = {"content": f"{emoji} **[T1 Status Sync]** {message}"}

    try:
        requests.post(DISCORD_WEBHOOK_ALERT, json=payload, timeout=10)
    except Exception:
        pass


# ──────────────────────────────────────────
# CSV Import (Fallback when API unavailable)
# ──────────────────────────────────────────

def load_csv_data(csv_path: str) -> dict:
    """
    Load euShipments export CSV and build lookup by clientReference / Ref. number.

    Expected CSV columns (flexible matching):
    - Ref. number / Reference / Client Reference / clientReference
    - Status / Статус
    - Type / Тип / Shipment Type
    - AWB / Tracking Number

    Returns: dict mapping ref_number → {"status": ..., "type": ..., "awb": ...}
    """
    lookup = {}
    csv_file = Path(csv_path)

    if not csv_file.exists():
        log.error(f"CSV file not found: {csv_path}")
        return lookup

    log.info(f"  Loading CSV: {csv_path}")

    # Try different encodings
    for encoding in ['utf-8', 'utf-8-sig', 'cp1251', 'latin1']:
        try:
            with open(csv_file, encoding=encoding, newline='') as f:
                # Auto-detect delimiter
                sample = f.read(2000)
                f.seek(0)
                dialect = csv.Sniffer().sniff(sample, delimiters=',;\t')
                reader = csv.DictReader(f, dialect=dialect)

                # Map various column name variants
                for row in reader:
                    # Find ref number column
                    ref = ""
                    for col in ["Ref. number", "Reference", "Client Reference",
                                "clientReference", "Ref", "REF", "Референция",
                                "Ref Number", "ReferenceNumber"]:
                        if col in row and row[col]:
                            ref = row[col].strip()
                            break

                    if not ref:
                        # Try first column as fallback
                        first_key = list(row.keys())[0] if row else ""
                        ref = row.get(first_key, "").strip()

                    if not ref:
                        continue

                    # Find status column
                    status = ""
                    for col in ["Status", "STATUS", "Статус", "status",
                                "Shipment Status", "Order Status"]:
                        if col in row and row[col]:
                            status = row[col].strip()
                            break

                    # Find type column
                    shipment_type = ""
                    for col in ["Type", "TYPE", "Тип", "type",
                                "Shipment Type", "Order Type"]:
                        if col in row and row[col]:
                            shipment_type = row[col].strip()
                            break

                    # Find AWB column
                    awb = ""
                    for col in ["AWB", "Tracking Number", "Tracking",
                                "AWB Number", "Waybill", "tracking_number"]:
                        if col in row and row[col]:
                            awb = row[col].strip()
                            break

                    lookup[ref] = {
                        "status": status,
                        "type": shipment_type,
                        "awb": awb,
                    }

                log.info(f"  Loaded {len(lookup)} shipments from CSV")
                log.info(f"  CSV columns: {list(reader.fieldnames or [])}")

                # Log status distribution
                status_dist = {}
                for v in lookup.values():
                    s = v["status"]
                    status_dist[s] = status_dist.get(s, 0) + 1
                log.info(f"  Status distribution: {status_dist}")

                return lookup

        except (UnicodeDecodeError, csv.Error):
            continue
        except Exception as e:
            log.error(f"  CSV parse error ({encoding}): {e}")
            continue

    log.error(f"  Could not parse CSV with any encoding")
    return lookup


# ──────────────────────────────────────────
# Main Orchestration
# ──────────────────────────────────────────

def main():
    dry_run = "--dry-run" in sys.argv

    # Parse --from-csv argument
    csv_path = None
    if "--from-csv" in sys.argv:
        idx = sys.argv.index("--from-csv")
        if idx + 1 < len(sys.argv):
            csv_path = sys.argv[idx + 1]

    csv_data = {}
    if csv_path:
        csv_data = load_csv_data(csv_path)
        if not csv_data:
            log.error("  CSV không có data hoặc parse lỗi. Thoát.")
            return

    log.info("=" * 60)
    log.info("  T1 Auto Status Sync: euShipments → POS Cake")
    log.info(f"  Mode: {'DRY RUN (kiểm tra, không cập nhật)' if dry_run else 'LIVE'}")
    if csv_data:
        log.info(f"  Data source: CSV ({len(csv_data)} shipments)")
    else:
        log.info(f"  Data source: euShipments API")
    log.info("=" * 60)

    # 1. Lấy danh sách orders cần check từ BigQuery
    log.info("\n📋 Step 1: Lấy danh sách fulfillment orders...")
    bq_client = bigquery.Client(project=GCP_PROJECT)
    orders = get_active_fulfillment_orders(bq_client)

    if not orders:
        log.info("  Không có orders cần check. Thoát.")
        return

    # 2. Check status từng order
    log.info(f"\n🔍 Step 2: Kiểm tra status cho {len(orders)} orders...")

    stats = {
        "total": len(orders),
        "checked": 0,
        "updated": 0,
        "no_change": 0,
        "no_status": 0,
        "errors": 0,
    }

    update_log = []

    for i, order in enumerate(orders, 1):
        pos_id = order["pos_order_id"]
        tpl_id = order["tpl_order_id"]
        awb = order["awb"]
        current_status = order["status"]

        log.info(f"\n--- [{i}/{len(orders)}] POS:{pos_id} | 3PL:{tpl_id} | AWB:{awb} ---")
        log.info(f"  Current status: {current_status}")

        # 2a. Try CSV data first (if loaded)
        eu_status = ""
        eu_type = ""

        client_ref = f"{FFM_CFG.get('client_reference_prefix', 'T1')}-{pos_id}"

        if csv_data:
            # Look up by clientReference (T1-300, etc.)
            csv_entry = csv_data.get(client_ref) or csv_data.get(pos_id) or csv_data.get(str(tpl_id))
            if csv_entry:
                eu_status = csv_entry["status"]
                eu_type = csv_entry["type"]
                # Update AWB in BQ if we got it from CSV
                if csv_entry.get("awb") and not awb:
                    awb = csv_entry["awb"]
                    log.info(f"  CSV → AWB: {awb}")
                log.info(f"  CSV data: status='{eu_status}', type='{eu_type}'")
            else:
                log.info(f"  ⚠ Not found in CSV (tried: {client_ref}, {pos_id}, {tpl_id})")
                stats["no_status"] += 1
                continue

        # 2b. If no CSV, try euShipments API
        if not csv_data:
            if awb:
                tracking = get_tracking_status(awb)
                eu_status, eu_type = extract_status_from_tracking(tracking)
                log.info(f"  Tracking response: status='{eu_status}', type='{eu_type}'")

                if tracking:
                    log.info(f"  Raw tracking keys: {list(tracking.keys())}")
                    log.info(f"  Raw tracking: {json.dumps(tracking, default=str)[:300]}")

            # Fallback: order detail
            if not eu_status and tpl_id:
                log.info(f"  No tracking status, trying order detail...")
                detail = get_order_detail(tpl_id)
                eu_status, eu_type = extract_status_from_order(detail)
                log.info(f"  Order detail: status='{eu_status}', type='{eu_type}'")

                if detail:
                    log.info(f"  Raw detail keys: {list(detail.keys())}")
                    log.info(f"  Raw detail: {json.dumps(detail, default=str)[:300]}")

        stats["checked"] += 1

        if not eu_status:
            log.info(f"  ⚠ Không lấy được status từ euShipments")
            stats["no_status"] += 1
            continue

        # 3. Map euShipments status → POS status
        pos_code, pos_name, action_desc = map_eu_to_pos_status(eu_status, eu_type)

        if pos_code is None:
            log.info(f"  ⚠ Status '{eu_status}' (type: '{eu_type}') chưa có mapping → bỏ qua")
            stats["no_change"] += 1
            continue

        log.info(f"  📌 Mapping: {action_desc}")
        log.info(f"  → POS status: {pos_code} ({pos_name})")

        # Check if status actually changed
        # Map current BQ status to comparable format
        bq_to_pos_name = {
            "created": "Mới",
            "processing": "Đang xử lý",
            "shipped": "Đã gửi hàng",
            "delivered": "Đã nhận",
            "returned": "Đang hoàn",
            "returned_confirmed": "Đã hoàn",
            "delivered_confirmed": "Đã nhận (xác nhận)",
        }

        # Map pos_code to BQ status for comparison
        pos_code_to_bq = {
            3: "delivered",           # Đã nhận
            4: "returned",            # Đang hoàn
            5: "returned_confirmed",  # Đã hoàn
            9: "shipped",             # Đã gửi hàng
        }

        new_bq_status = pos_code_to_bq.get(pos_code, "unknown")

        if current_status == new_bq_status:
            log.info(f"  ✓ Status không thay đổi ({current_status}) → bỏ qua")
            stats["no_change"] += 1
            continue

        # 4. Update POS Cake
        if dry_run:
            log.info(f"  🏃 DRY RUN — sẽ cập nhật POS {pos_id}: {current_status} → {new_bq_status} ({pos_name})")
            stats["updated"] += 1
            update_log.append({
                "pos_id": pos_id, "tpl_id": tpl_id,
                "eu_status": eu_status, "eu_type": eu_type,
                "from": current_status, "to": new_bq_status,
                "pos_code": pos_code, "pos_name": pos_name,
            })
            continue

        pos_ok = update_pos_order_status(pos_id, pos_code)

        if pos_ok:
            # 5. Update BigQuery
            update_fulfillment_status(
                bq_client, pos_id, new_bq_status, eu_status, eu_type
            )
            stats["updated"] += 1
            update_log.append({
                "pos_id": pos_id, "tpl_id": tpl_id,
                "eu_status": eu_status, "eu_type": eu_type,
                "from": current_status, "to": new_bq_status,
                "pos_code": pos_code, "pos_name": pos_name,
            })
        else:
            stats["errors"] += 1

        # Rate limiting — don't hammer APIs
        time.sleep(0.5)

    # 6. Summary
    log.info("\n" + "=" * 60)
    log.info("  📊 STATUS SYNC SUMMARY")
    log.info(f"  Total orders checked:    {stats['total']}")
    log.info(f"  ✅ Status checked:        {stats['checked']}")
    log.info(f"  🔄 Updated:              {stats['updated']}")
    log.info(f"  ✓ No change:             {stats['no_change']}")
    log.info(f"  ⚠ No euShipments status: {stats['no_status']}")
    log.info(f"  ❌ Errors:                {stats['errors']}")
    log.info("=" * 60)

    if update_log:
        log.info("\n  📝 Update Details:")
        log.info("  " + "-" * 80)
        log.info(f"  {'POS ID':<12} {'3PL ID':<10} {'euStatus':<15} {'Type':<10} {'From':<12} → {'To':<12} {'POS'}")
        log.info("  " + "-" * 80)
        for u in update_log:
            log.info(
                f"  {u['pos_id']:<12} {u['tpl_id']:<10} "
                f"{u['eu_status']:<15} {u['eu_type']:<10} "
                f"{u['from']:<12} → {u['to']:<12} {u['pos_name']}"
            )
        log.info("  " + "-" * 80)

    # Discord notification
    if stats["updated"] > 0:
        alert_discord(
            f"Đã cập nhật {stats['updated']} đơn:\n"
            + "\n".join(
                f"  • POS `{u['pos_id']}`: {u['from']} → {u['to']} ({u['pos_name']})"
                for u in update_log[:10]
            )
        )

    if stats["errors"] > 0:
        alert_discord(
            f"⚠ {stats['errors']} đơn lỗi khi cập nhật POS. Kiểm tra log.",
            is_error=True
        )


if __name__ == "__main__":
    main()
