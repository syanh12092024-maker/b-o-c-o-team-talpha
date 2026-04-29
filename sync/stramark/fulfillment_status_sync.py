#!/usr/bin/env python3
"""
Stramark Auto Status Sync: euShipments → POS Cake (Multi-Country).

Status mapping (verified from real API data 2026-03-19):
┌─────────────────────────────────┬────────────────┬──────────────────────┐
│ euShipments Last Status         │ POS Status     │ Nghĩa                │
├─────────────────────────────────┼────────────────┼──────────────────────┤
│ Delivered                       │ delivered      │ KH đã nhận           │
│ Product returned to stock       │ returned       │ Đã hoàn (nhập kho)   │
│ Returned to Warehouse           │ returning      │ Đang hoàn (về kho)   │
│ Returned / Returning            │ returning      │ Đang hoàn            │
│ On delivery / In transit /      │ shipped        │ Đang vận chuyển      │
│   In the office / Warehouse ... │                │                      │
│   Scanned Waybill / Picked up / │                │                      │
│   Unsuccessful delivery attempt │                │                      │
└─────────────────────────────────┴────────────────┴──────────────────────┘

Usage:
    python fulfillment_status_sync.py                # Sync via API
    python fulfillment_status_sync.py --dry-run      # Check only
    python fulfillment_status_sync.py --from-csv X   # From CSV export
"""

import csv
import io
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

# Force UTF-8 on Windows
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("fulfillment.status_sync")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = PROJECT_ROOT / "config" / "projects" / "stramark.yaml"

with open(CONFIG_PATH, encoding="utf-8") as f:
    CFG = yaml.safe_load(f)

# Load .env files
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

# POS Cake
POS_CFG = CFG.get("poscake", {})
POS_API_BASE = (POS_CFG.get("shops", [{}])[0].get("api_url", "")
                or "https://pos.pages.fm/api/v1")
POS_API_KEY = os.getenv("POSCAKE_API_KEY", "")
POS_SHOP_ID = POS_CFG.get("shop_ids", ["1635307570"])[0]

# BigQuery
GCP_PROJECT = CFG["bigquery"]["project_gcp"]
DATASET = CFG["bigquery"]["dataset"]
DS = f"{GCP_PROJECT}.{DATASET}"

BQ_KEY_PATH = PROJECT_ROOT / "bigquery_key.json"
if BQ_KEY_PATH.exists():
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(BQ_KEY_PATH)

# euShipments
FFM_CFG = CFG.get("fulfillment", {})
TPL_API_BASE = FFM_CFG.get("api_url", "https://api1.inout.bg/api/v1")
TPL_API_TOKEN = (os.getenv("STRAMARK_FFM_API_TOKEN_2")
                 or os.getenv("STRAMARK_FFM_API_TOKEN") or "")
TPL_SENDER_ID = int(os.getenv("EU_SHIPMENT_CLIENT_ID_NEW", "3282"))

# Discord
DISCORD_WEBHOOK = os.getenv("DISCORD_WEBHOOK_ALERT", "")

# ──────────────────────────────────────────
# Status Mapping
# ──────────────────────────────────────────

# POS Cake uses string status names for Stramark (not numeric like T1)
POS_STATUS_MAP = {
    "delivered":  "delivered",    # KH da nhan hang
    "returning":  "returning",   # Dang hoan
    "returned":   "returned",    # Da hoan (nhap kho)
    "shipped":    "shipped",     # Dang van chuyen
}

# Mapping based on LAST status from orders-history (exact match, lowercased)
EU_STATUS_DELIVERED = ["delivered"]
EU_STATUS_RETURNED_FINAL = ["product returned to stock", "returned to stock", "returned to sender"]
EU_STATUS_RETURNING = ["returned to warehouse", "returned", "returning", "return in progress"]
EU_STATUS_SHIPPED = [
    "on delivery", "in transit", "in the office",
    "warehouse oradea", "scanned waybill", "picked up",
    "unsuccessful delivery attempt",
]


def map_eu_to_pos(eu_status: str, eu_type: str = ""):
    """Map euShipments last status → POS Cake status string.

    Uses exact last-status matching (no type/Tel needed).
    """
    s = (eu_status or "").strip().lower()

    if s in EU_STATUS_DELIVERED:
        return "delivered", "Delivered -> Da nhan"

    if s in EU_STATUS_RETURNED_FINAL:
        return "returned", "Product returned to stock -> Da hoan"

    if s in EU_STATUS_RETURNING:
        return "returning", f"{eu_status} -> Dang hoan"

    if s in EU_STATUS_SHIPPED:
        return "shipped", f"{eu_status} -> Da gui hang"

    return None, None


# ──────────────────────────────────────────
# API Helpers
# ──────────────────────────────────────────

def tpl_headers():
    return {"Authorization": f"Bearer {TPL_API_TOKEN}", "Content-Type": "application/json"}


def get_tracking_status(awb: str) -> dict:
    try:
        resp = requests.get(f"{TPL_API_BASE}/fulfilment/get-awb-status",
                            headers=tpl_headers(), params={"awb": awb}, timeout=30)
        return resp.json() if resp.status_code == 200 else {}
    except Exception as e:
        log.error(f"  Tracking error AWB {awb}: {e}")
        return {}


def get_order_detail(order_id) -> dict:
    try:
        resp = requests.get(f"{TPL_API_BASE}/fulfilment/get-order",
                            headers=tpl_headers(), params={"orderId": order_id}, timeout=30)
        return resp.json() if resp.status_code == 200 else {}
    except Exception as e:
        log.error(f"  Order detail error {order_id}: {e}")
        return {}


def extract_status(data: dict) -> tuple:
    """Extract (status, type) from euShipments response."""
    if not data:
        return "", ""
    status = (data.get("status") or data.get("STATUS") or
              data.get("statusName") or data.get("STATUS_NAME") or "")
    stype = (data.get("type") or data.get("TYPE") or
             data.get("shipmentType") or data.get("SHIPMENT_TYPE") or "")

    # Check nested events
    events = data.get("events") or data.get("history") or data.get("tracking") or []
    if events and isinstance(events, list):
        latest = events[-1] if isinstance(events[-1], dict) else {}
        if not status:
            status = latest.get("status") or latest.get("statusName") or ""
        if not stype:
            stype = latest.get("type") or latest.get("shipmentType") or ""

    if isinstance(data.get("data"), dict):
        nested = data["data"]
        if not status:
            status = nested.get("status") or nested.get("statusName") or ""
        if not stype:
            stype = nested.get("type") or nested.get("shipmentType") or ""

    return str(status), str(stype)


def update_pos_status(order_id: str, new_status: str) -> bool:
    """Update POS Cake order status (Stramark uses string status)."""
    url = f"{POS_API_BASE}/shops/{POS_SHOP_ID}/orders/{order_id}"
    try:
        resp = requests.put(url, params={"api_key": POS_API_KEY},
                            json={"status": new_status}, timeout=30)
        if resp.status_code in (200, 201, 204):
            log.info(f"  POS updated: {order_id} -> {new_status}")
            return True
        log.error(f"  POS update failed: {order_id} HTTP {resp.status_code}")
        return False
    except Exception as e:
        log.error(f"  POS update error {order_id}: {e}")
        return False


# ──────────────────────────────────────────
# BigQuery
# ──────────────────────────────────────────

def get_active_orders(client: bigquery.Client) -> list:
    query = f"""
    SELECT pos_order_id, tpl_order_id, COALESCE(awb, '') as awb,
           status, recipient_country
    FROM `{DS}.fulfillment_orders`
    WHERE tpl_order_id IS NOT NULL
      AND status NOT IN ('delivered', 'returned', 'cancelled', 'validation_failed')
    ORDER BY created_at DESC
    """
    try:
        return [dict(row) for row in client.query(query).result()]
    except Exception as e:
        log.error(f"BQ query error: {e}")
        return []


def update_bq_status(client: bigquery.Client, pos_order_id: str,
                     new_status: str, eu_status: str, eu_type: str):
    note = (f"[{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}] "
            f"euShipments: {eu_status}/{eu_type} -> POS: {new_status}")
    try:
        client.query(f"""
        UPDATE `{DS}.fulfillment_orders`
        SET status = @new_status,
            last_status_update = CURRENT_TIMESTAMP(),
            error_message = CONCAT(COALESCE(error_message, ''), ' | ', @note)
        WHERE pos_order_id = @pos_order_id
        """, job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("new_status", "STRING", new_status),
            bigquery.ScalarQueryParameter("note", "STRING", note),
            bigquery.ScalarQueryParameter("pos_order_id", "STRING", pos_order_id),
        ])).result()
    except Exception as e:
        log.error(f"BQ update error {pos_order_id}: {e}")


# ──────────────────────────────────────────
# CSV Import (fallback)
# ──────────────────────────────────────────

def load_csv_data(csv_path: str) -> dict:
    lookup = {}
    p = Path(csv_path)
    if not p.exists():
        log.error(f"CSV not found: {csv_path}")
        return lookup

    for enc in ["utf-8", "utf-8-sig", "cp1251", "latin1"]:
        try:
            with open(p, encoding=enc, newline="") as f:
                sample = f.read(2000)
                f.seek(0)
                dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
                reader = csv.DictReader(f, dialect=dialect)
                for row in reader:
                    ref = ""
                    for col in ["Ref. number", "Reference", "Client Reference",
                                "clientReference", "Ref"]:
                        if col in row and row[col]:
                            ref = row[col].strip()
                            break
                    if not ref:
                        continue
                    status = ""
                    for col in ["Status", "STATUS", "status"]:
                        if col in row and row[col]:
                            status = row[col].strip()
                            break
                    stype = ""
                    for col in ["Type", "TYPE", "type", "Shipment Type"]:
                        if col in row and row[col]:
                            stype = row[col].strip()
                            break
                    lookup[ref] = {"status": status, "type": stype}
                log.info(f"  CSV loaded: {len(lookup)} shipments")
                return lookup
        except Exception:
            continue
    return lookup


# ──────────────────────────────────────────
# Main
# ──────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Stramark Status Sync")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--from-csv", type=str, default=None)
    args = parser.parse_args()

    csv_data = load_csv_data(args.from_csv) if args.from_csv else {}

    log.info("=" * 60)
    log.info("  Stramark Status Sync: euShipments -> POS Cake")
    log.info(f"  Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    log.info(f"  Source: {'CSV' if csv_data else 'API'}")
    log.info("=" * 60)

    bq_client = bigquery.Client(project=GCP_PROJECT)
    orders = get_active_orders(bq_client)
    log.info(f"  {len(orders)} active fulfillment orders")

    if not orders:
        return

    stats = {"checked": 0, "updated": 0, "no_change": 0, "errors": 0}
    updates = []
    prefix = FFM_CFG.get("client_reference_prefix", "STR")

    for i, order in enumerate(orders, 1):
        pos_id = order["pos_order_id"]
        tpl_id = order["tpl_order_id"]
        awb = order["awb"]
        current = order["status"]

        log.info(f"\n[{i}/{len(orders)}] POS:{pos_id} | 3PL:{tpl_id} | AWB:{awb}")

        eu_status, eu_type = "", ""

        if csv_data:
            ref = f"{prefix}-{pos_id}"
            entry = csv_data.get(ref) or csv_data.get(pos_id) or csv_data.get(str(tpl_id))
            if entry:
                eu_status, eu_type = entry["status"], entry["type"]
            else:
                continue
        else:
            if awb:
                data = get_tracking_status(awb)
                eu_status, eu_type = extract_status(data)
            if not eu_status and tpl_id:
                data = get_order_detail(tpl_id)
                eu_status, eu_type = extract_status(data)

        stats["checked"] += 1

        if not eu_status:
            log.info(f"  No euShipments status")
            continue

        new_status, desc = map_eu_to_pos(eu_status, eu_type)
        if not new_status:
            log.info(f"  Status '{eu_status}' no mapping")
            stats["no_change"] += 1
            continue

        if current == new_status:
            stats["no_change"] += 1
            continue

        log.info(f"  {current} -> {new_status} ({desc})")

        if args.dry_run:
            stats["updated"] += 1
            updates.append(f"{pos_id}: {current} -> {new_status}")
            continue

        if update_pos_status(pos_id, new_status):
            update_bq_status(bq_client, pos_id, new_status, eu_status, eu_type)
            stats["updated"] += 1
            updates.append(f"{pos_id}: {current} -> {new_status}")
        else:
            stats["errors"] += 1

        time.sleep(0.5)

    log.info("\n" + "=" * 60)
    log.info(f"  Checked: {stats['checked']} | Updated: {stats['updated']} "
             f"| No change: {stats['no_change']} | Errors: {stats['errors']}")
    log.info("=" * 60)

    if updates and DISCORD_WEBHOOK:
        try:
            msg = f"Status sync: {stats['updated']} updated\n" + \
                  "\n".join(f"  {u}" for u in updates[:15])
            requests.post(DISCORD_WEBHOOK,
                          json={"content": f"\U0001f4e6 **[Stramark Sync]** {msg}"},
                          timeout=10)
        except Exception:
            pass


if __name__ == "__main__":
    main()
