#!/usr/bin/env python3
"""
Stramark Status Audit: Cross-check ALL POS orders vs euShipments (last N days).

Finds mismatched statuses and writes proposals to a JSON file for human approval
via the dashboard UI. Does NOT auto-update POS — only proposes changes.

Usage:
    python status_audit.py                # Full audit, write proposals
    python status_audit.py --dry-run      # Log only, don't write proposals
    python status_audit.py --days 60      # Override 30-day window
"""

import argparse
import io
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
import yaml

# Force UTF-8 on Windows
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("status_audit")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = PROJECT_ROOT / "config" / "projects" / "stramark.yaml"
PROPOSALS_PATH = PROJECT_ROOT / "data" / "stramark" / "status_audit_proposals.json"

with open(CONFIG_PATH, encoding="utf-8") as f:
    CFG = yaml.safe_load(f)

# Load .env files
for env_file in [PROJECT_ROOT / ".env", PROJECT_ROOT / ".env.ffm", PROJECT_ROOT / "dashboard-ui" / ".env.local"]:
    if env_file.exists():
        with open(env_file, encoding="utf-8") as ef:
            for line in ef:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    key, val = key.strip(), val.strip()
                    if key and val and key not in os.environ:
                        os.environ[key] = val

# ── Config ──
POS_CFG = CFG.get("poscake", {})
POS_API_BASE = POS_CFG.get("shops", [{}])[0].get("api_url", "") or "https://pos.pages.fm/api/v1"
POS_API_KEY = os.getenv("POSCAKE_API_KEY", "")
POS_SHOP_ID = POS_CFG.get("shop_ids", ["1635307570"])[0]

FFM_CFG = CFG.get("fulfillment", {})
EU_API_BASE = FFM_CFG.get("api_url", "https://api1.inout.bg/api/v1")
EU_API_TOKEN = os.getenv("STRAMARK_FFM_API_TOKEN_2") or os.getenv("STRAMARK_FFM_API_TOKEN", "")

DISCORD_WEBHOOK = os.getenv("DISCORD_WEBHOOK_ALERT", "")

# ── Status Mapping (same as fulfillment_status_sync.py) ──
EU_STATUS_DELIVERED = ["delivered"]
EU_STATUS_RETURNED_FINAL = ["product returned to stock", "returned to stock", "returned to sender"]
EU_STATUS_RETURNING = ["returned to warehouse", "returned", "returning", "return in progress"]
EU_STATUS_SHIPPED = [
    "on delivery", "in transit", "in the office",
    "warehouse oradea", "scanned waybill", "picked up",
    "unsuccessful delivery attempt",
]

LABEL_MAP = {
    "delivered": "KH da nhan hang",
    "returned": "Da hoan (nhap kho)",
    "returning": "Dang hoan ve kho",
    "shipped": "Dang van chuyen",
}

# ── Status Hierarchy (POS status is irreversible) ──
# Two branches after "shipped": delivered path and returning path
STATUS_LEVEL = {
    "new": 0, "submitted": 1, "confirmed": 1, "waitting": 2,
    "packing": 3, "pending": 3, "ordered": 4,
    "shipped": 5,
    "delivered": 6, "received_money": 7,
    "returning": 6, "returned": 7,
    "canceled": -1,
}

# Branches: delivered/received_money vs returning/returned are NOT interchangeable
DELIVER_BRANCH = {"shipped", "delivered", "received_money"}
RETURN_BRANCH = {"shipped", "returning", "returned"}


def map_eu_to_pos(eu_status: str) -> tuple:
    """Map euShipments last status → expected POS status + label."""
    s = (eu_status or "").strip().lower()
    if s in EU_STATUS_DELIVERED:
        return "delivered", LABEL_MAP["delivered"]
    if s in EU_STATUS_RETURNED_FINAL:
        return "returned", LABEL_MAP["returned"]
    if s in EU_STATUS_RETURNING:
        return "returning", LABEL_MAP["returning"]
    if s in EU_STATUS_SHIPPED:
        return "shipped", LABEL_MAP["shipped"]
    return None, None


def is_valid_transition(current: str, proposed: str) -> bool:
    """Check if proposed status is a valid forward transition from current."""
    cur = current.strip().lower()
    prop = proposed.strip().lower()

    cur_level = STATUS_LEVEL.get(cur)
    prop_level = STATUS_LEVEL.get(prop)

    if cur_level is None or prop_level is None:
        return False
    if prop_level <= cur_level:
        return False

    # Prevent cross-branch: can't go from returning→delivered or delivered→returning
    # "shipped" is neutral — allowed to transition to either branch
    if cur != "shipped":
        if cur in RETURN_BRANCH and prop in DELIVER_BRANCH:
            return False
        if cur in DELIVER_BRANCH and prop in RETURN_BRANCH:
            return False

    return True


# ── POS API ──

def _fetch_pages_for_status(status_code: int, cutoff: datetime) -> list:
    """Fetch all pages for a single POS status code."""
    orders = []
    page = 1
    while page <= 30:
        try:
            resp = requests.get(
                f"{POS_API_BASE}/shops/{POS_SHOP_ID}/orders",
                params={"api_key": POS_API_KEY, "status": status_code,
                        "page": page, "limit": 50},
                timeout=30,
            )
            if resp.status_code != 200:
                break

            data = resp.json().get("data", [])
            if not data:
                break

            for o in data:
                oid = str(o.get("id", ""))
                if not oid:
                    continue

                inserted = o.get("inserted_at", "")
                if inserted:
                    try:
                        dt = datetime.fromisoformat(inserted.replace("Z", "+00:00"))
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        if dt < cutoff:
                            continue
                    except (ValueError, TypeError):
                        pass

                status_name = (o.get("status_name") or "").strip().lower()
                if not status_name:
                    status_name = str(o.get("status", "")).strip().lower()

                orders.append({
                    "id": oid,
                    "status_name": status_name,
                    "inserted_at": inserted,
                })

            page += 1
        except Exception as e:
            log.error(f"  POS fetch error status={status_code} page={page}: {e}")
            break

    return orders


def fetch_all_pos_orders(days: int) -> list:
    """Fetch ALL POS orders in parallel across status codes, filter by last N days."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Stramark numeric codes: 0=new, 1=submitted, 2=shipped, 3=delivered,
    # 4=returning, 5=returned, 6=canceled, 8=packing, 9=pending
    POS_STATUSES = [0, 1, 2, 3, 4, 5, 6, 8, 9]

    seen = set()
    all_orders = []

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(_fetch_pages_for_status, sc, cutoff): sc
                   for sc in POS_STATUSES}
        for future in as_completed(futures):
            for o in future.result():
                if o["id"] not in seen:
                    seen.add(o["id"])
                    all_orders.append(o)

    return all_orders


# ── euShipments API ──

def batch_query_eu(order_ids: list) -> dict:
    """Query euShipments orders-history in batches, return {refNum: {status, awb, date}}."""
    headers = {"Authorization": f"Bearer {EU_API_TOKEN}", "Content-Type": "application/json"}
    result = {}
    BATCH = 50

    for i in range(0, len(order_ids), BATCH):
        batch = order_ids[i:i + BATCH]
        try:
            resp = requests.post(
                f"{EU_API_BASE}/fulfilment/orders-history",
                headers=headers,
                json={"testMode": False, "orders": [{"refNum": r} for r in batch]},
                timeout=30,
            )
            if resp.status_code != 200:
                log.warning(f"  euShipments batch {i // BATCH + 1}: HTTP {resp.status_code}")
                continue

            for item in resp.json():
                ref = item.get("refNum", "")
                err = item.get("error")
                awb = item.get("awb", "")
                events = item.get("statusesHistory", [])

                if err:
                    result[ref] = {"status": None, "error": err, "awb": awb}
                elif events:
                    last = events[-1]
                    result[ref] = {
                        "status": last.get("STATUS", ""),
                        "error": None,
                        "awb": awb,
                        "date": last.get("DATE", ""),
                    }
                else:
                    result[ref] = {"status": None, "error": "no events", "awb": awb}

        except Exception as e:
            log.error(f"  euShipments batch error: {e}")

        time.sleep(0.5)

    return result


# ── Proposals File ──

def load_proposals() -> dict:
    """Load existing proposals from JSON file."""
    if PROPOSALS_PATH.exists():
        try:
            with open(PROPOSALS_PATH, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"lastAuditAt": None, "lastAuditStats": {}, "proposals": []}


def save_proposals(data: dict):
    """Atomically write proposals to JSON file."""
    PROPOSALS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = PROPOSALS_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(PROPOSALS_PATH)


# ── Main ──

def main():
    parser = argparse.ArgumentParser(description="Stramark Status Audit")
    parser.add_argument("--dry-run", action="store_true", help="Log only, don't write proposals")
    parser.add_argument("--days", type=int, default=30, help="Number of days to audit (default: 30)")
    args = parser.parse_args()

    now_vn = datetime.now(timezone(timedelta(hours=7)))
    now_iso = now_vn.isoformat()

    log.info("=" * 60)
    log.info("  Stramark Status Audit: POS vs euShipments")
    log.info(f"  Mode: {'DRY RUN' if args.dry_run else 'WRITE PROPOSALS'}")
    log.info(f"  Window: last {args.days} days")
    log.info(f"  Time: {now_vn.strftime('%Y-%m-%d %H:%M %Z')}")
    log.info("=" * 60)

    # 1. Fetch POS orders
    log.info("  Fetching POS orders...")
    pos_orders = fetch_all_pos_orders(args.days)
    log.info(f"  Found {len(pos_orders)} POS orders in last {args.days} days")

    if not pos_orders:
        log.info("  No orders to audit.")
        return

    # 2. Query euShipments
    order_ids = [o["id"] for o in pos_orders]
    log.info(f"  Querying euShipments for {len(order_ids)} orders...")
    eu_map = batch_query_eu(order_ids)

    found_on_eu = sum(1 for v in eu_map.values() if not v.get("error"))
    log.info(f"  euShipments: {found_on_eu} found, {len(eu_map) - found_on_eu} errors/not found")


    # 3. Compare and find mismatches
    stats = {"total": len(pos_orders), "on_eu": found_on_eu, "matched": 0,
             "mismatched": 0, "ignored": 0, "invalid_transition": 0}
    new_proposals = []

    for order in pos_orders:
        oid = order["id"]
        pos_status = order["status_name"]
        eu_info = eu_map.get(oid)

        if not eu_info or eu_info.get("error"):
            continue

        eu_status = eu_info["status"]
        expected, label = map_eu_to_pos(eu_status)

        if not expected:
            stats["ignored"] += 1
            continue

        if pos_status == expected:
            stats["matched"] += 1
            continue

        # Check if this is a valid forward transition
        if not is_valid_transition(pos_status, expected):
            stats["invalid_transition"] += 1
            log.info(f"  #{oid}: {pos_status} -> {expected} INVALID (not forward), skip")
            continue

        stats["mismatched"] += 1
        proposal = {
            "id": f"audit-{int(now_vn.timestamp())}-{oid}",
            "posOrderId": oid,
            "currentPosStatus": pos_status,
            "euLastStatus": eu_status,
            "euLastDate": eu_info.get("date", ""),
            "proposedPosStatus": expected,
            "label": f"{eu_status} -> {label}",
            "awb": eu_info.get("awb", ""),
            "createdAt": now_iso,
            "status": "pending",
            "reviewedBy": None,
            "reviewedAt": None,
            "executeResult": None,
        }
        new_proposals.append(proposal)
        log.info(f"  #{oid}: POS={pos_status} | EU=\"{eu_status}\" | Propose: {expected}")

    # 4. Summary
    log.info("")
    log.info("=" * 60)
    log.info(f"  AUDIT SUMMARY")
    log.info(f"  Total POS orders:     {stats['total']}")
    log.info(f"  Found on euShipments: {stats['on_eu']}")
    log.info(f"  Status matched (OK):  {stats['matched']}")
    log.info(f"  EU status ignored:    {stats['ignored']}")
    log.info(f"  Invalid transitions:  {stats['invalid_transition']}")
    log.info(f"  NEW PROPOSALS:        {stats['mismatched']}")
    log.info("=" * 60)

    if args.dry_run:
        log.info("  DRY RUN — proposals not saved.")
        return

    # 5. Merge with existing proposals
    existing = load_proposals()

    # Only keep NEW proposals — old pending proposals are replaced entirely
    # (if an order was fixed since last audit, its old proposal is dropped)
    new_order_ids = {p["posOrderId"] for p in new_proposals}
    matched_ids = {o["id"] for o in pos_orders if eu_map.get(o["id"]) and not eu_map[o["id"]].get("error")
                   and map_eu_to_pos(eu_map[o["id"]].get("status", ""))[0] == o["status_name"]}
    # Remove old pending proposals for orders that are now matched or re-audited
    pending = [p for p in existing.get("proposals", [])
               if p.get("status") == "pending"
               and p["posOrderId"] not in new_order_ids
               and p["posOrderId"] not in matched_ids]
    pending_map = {p["posOrderId"]: p for p in pending}
    for p in new_proposals:
        pending_map[p["posOrderId"]] = p

    # Keep non-pending (approved/rejected) for history (last 100)
    history = [p for p in existing.get("proposals", []) if p.get("status") != "pending"]
    history = history[-100:]

    all_proposals = list(pending_map.values()) + history

    save_data = {
        "lastAuditAt": now_iso,
        "lastAuditStats": stats,
        "proposals": all_proposals,
    }
    save_proposals(save_data)
    log.info(f"  Saved {len(pending_map)} pending proposals to {PROPOSALS_PATH}")

    # 6. Discord notification
    if new_proposals and DISCORD_WEBHOOK:
        try:
            lines = [f"  #{p['posOrderId']}: {p['currentPosStatus']} -> {p['proposedPosStatus']}"
                     for p in new_proposals[:10]]
            msg = (f"\U0001f50d **[Stramark Audit]** {len(new_proposals)} don bi lech trang thai\n"
                   + "\n".join(lines))
            if len(new_proposals) > 10:
                msg += f"\n  ... va {len(new_proposals) - 10} don nua"
            msg += "\n\U0001f449 Vao dashboard Fulfillment tab de duyet"
            requests.post(DISCORD_WEBHOOK, json={"content": msg}, timeout=10)
        except Exception:
            pass


if __name__ == "__main__":
    main()
