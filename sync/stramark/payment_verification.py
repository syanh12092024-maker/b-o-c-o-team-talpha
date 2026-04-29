#!/usr/bin/env python3
"""
Stramark Payment Verification: Cross-check Protokol XLSX against BQ ffm_shipments.

3-Layer Verification:
  Layer 1 (API): payout_date from euShipments API (already exists)
  Layer 2 (Protokol): Parse XLSX, cross-check AWBs (this script)
  Layer 3 (Human): 2-person approval on dashboard

Usage:
    python payment_verification.py --file Protokol-43472-3282.xlsx
    python payment_verification.py --file Protokol-43472-3282.xlsx --dry-run
    python payment_verification.py --file Protokol-43472-3282.xlsx --skip-discord
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
log = logging.getLogger("payment_verification")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = PROJECT_ROOT / "config" / "projects" / "stramark.yaml"
PROPOSALS_PATH = PROJECT_ROOT / "data" / "stramark" / "payment_verification_proposals.json"

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

# ── Config ──
STRAMARK_CLIENT_IDS = ["3282", "3248"]
DISCORD_WEBHOOK = os.getenv("DISCORD_WEBHOOK_RECONCILIATION", os.getenv("DISCORD_WEBHOOK_ALERT", ""))
GCP_PROJECT = os.getenv("GCP_PROJECT", "levelup-465304")
BQ_DATASET = "STRAMARK_Dataset"
BQ_TABLE_FFM = f"{GCP_PROJECT}.{BQ_DATASET}.ffm_shipments"

AMOUNT_TOLERANCE = 0.01  # Allow rounding differences

# EU Shipment API config
TPL_API_BASE = os.getenv("STRAMARK_FFM_API_BASE", "https://api1.inout.bg/api/v1")
TPL_API_TOKEN = os.getenv("STRAMARK_FFM_API_TOKEN_2", "")


# ═══════════════════════════════════════════════════════════════════════════════
# COD Cross-Check via API
# ═══════════════════════════════════════════════════════════════════════════════

def cod_cross_check(bq_client, limit=100):
    """Cross-check delivered orders: BQ status vs euShipments API COD status.

    For each delivered order with a POS order ID:
      - Call check-cod-by-order API
      - Compare: API says Paid? BQ has payout_date? Protokol received?

    Returns summary + per-order details.
    """
    from eu_shipment_client import EUShipmentClient

    # Get delivered orders from BQ — mix of paid and unpaid for comprehensive check
    half = max(limit // 2, 10)
    query = f"""
        (SELECT pos_order_id, awb, cod_amount, payout_date, payout_number, status, client_id
         FROM `{BQ_TABLE_FFM}`
         WHERE is_return_shipment = FALSE AND status = 'Delivered'
           AND pos_order_id IS NOT NULL AND payout_date IS NULL
         ORDER BY created_date DESC LIMIT {half})
        UNION ALL
        (SELECT pos_order_id, awb, cod_amount, payout_date, payout_number, status, client_id
         FROM `{BQ_TABLE_FFM}`
         WHERE is_return_shipment = FALSE AND status = 'Delivered'
           AND pos_order_id IS NOT NULL AND payout_date IS NOT NULL
         ORDER BY payout_date DESC LIMIT {half})
    """
    rows = list(bq_client.query(query).result())
    log.info(f"COD cross-check: {len(rows)} delivered orders to check")

    if not rows:
        return {"checked": 0, "items": [], "summary": {}}

    # Create API clients for both accounts (3282=new, 3248=old)
    token_new = os.getenv("STRAMARK_FFM_API_TOKEN_2", "")
    token_old = os.getenv("STRAMARK_FFM_API_TOKEN", "")
    clients = {}
    if token_new:
        clients["3282"] = EUShipmentClient(TPL_API_BASE, token_new, "3282")
    if token_old:
        clients["3248"] = EUShipmentClient(TPL_API_BASE, token_old, "3248")

    if not clients:
        log.error("No API tokens configured")
        return {"checked": 0, "items": [], "summary": {}}

    items = []
    stats = {"paid_matched": 0, "paid_no_doc": 0, "pending": 0, "no_data": 0, "mismatch": 0}

    for row in rows:
        pos_id = row.pos_order_id
        # Use the correct client based on client_id
        client_id = row.client_id or "3282"
        api_client = clients.get(client_id) or clients.get("3282")
        cod_resp = api_client.check_cod(pos_id)
        # Fallback: try other client if empty response
        if (not cod_resp or cod_resp == {}) and len(clients) > 1:
            other_client = next((c for cid, c in clients.items() if cid != client_id), None)
            if other_client:
                cod_resp = other_client.check_cod(pos_id)

        item = {
            "pos_order_id": pos_id,
            "awb": str(row.awb),
            "cod_amount": float(row.cod_amount) if row.cod_amount else 0,
            "client_id": row.client_id,
            "bq_payout_date": str(row.payout_date) if row.payout_date else None,
            "bq_payout_number": row.payout_number,
            "api_payed_date": None,
            "api_payed_number": None,
            "cod_status": "no_data",
        }

        if cod_resp and cod_resp.get("awbNumber"):
            api_paid = cod_resp.get("payedDate")
            api_paid_num = cod_resp.get("payedNumber")
            item["api_payed_date"] = api_paid
            item["api_payed_number"] = str(api_paid_num) if api_paid_num else None

            if api_paid:
                # API says Paid
                if row.payout_date:
                    item["cod_status"] = "paid_matched"
                    stats["paid_matched"] += 1
                else:
                    item["cod_status"] = "paid_no_bq"
                    stats["mismatch"] += 1
            else:
                # API says Pending (not yet paid)
                if row.payout_date:
                    item["cod_status"] = "bq_paid_api_pending"
                    stats["mismatch"] += 1
                else:
                    item["cod_status"] = "pending"
                    stats["pending"] += 1
        elif cod_resp == {}:
            item["cod_status"] = "no_data"
            stats["no_data"] += 1
        else:
            item["cod_status"] = "api_error"
            stats["no_data"] += 1

        items.append(item)

    return {
        "checked": len(items),
        "summary": stats,
        "items": items,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Cross-Check Engine (Protokol vs BQ)
# ═══════════════════════════════════════════════════════════════════════════════

def cross_check(protocol_data: dict, bq_client) -> dict:
    """Cross-check parsed Protokol data against BQ ffm_shipments.

    Returns verification report with per-item match status and anomalies.
    """
    items = protocol_data["items"]
    protocol_number = protocol_data["protocol_number"]
    awbs = [item["awb"] for item in items]

    if not awbs:
        return {
            "matched_count": 0,
            "anomaly_count": 0,
            "anomalies": [],
            "items_checked": [],
        }

    # Batch query BQ for all AWBs
    awb_list = ", ".join(f"'{a}'" for a in awbs)
    query = f"""
        SELECT awb, cod_amount, payout_date, payout_number, status, pos_order_id
        FROM `{BQ_TABLE_FFM}`
        WHERE awb IN ({awb_list})
    """

    try:
        rows = list(bq_client.query(query).result())
        bq_lookup = {str(row.awb): row for row in rows}
    except Exception as e:
        log.error(f"BQ query failed: {e}")
        bq_lookup = {}

    matched = 0
    anomalies = []
    items_checked = []

    for item in items:
        awb = item["awb"]
        bq_row = bq_lookup.get(awb)

        check_result = {
            "awb": awb,
            "receiver": item["receiver"],
            "protokol_amount": item["amount_ron"],
            "protokol_counted": item["counted_ron"],
            "pos_order_id": item.get("pos_order_id"),
            "bq_cod_amount": None,
            "bq_status": None,
            "bq_payout_date": None,
            "match_status": "matched",
        }

        if bq_row is None:
            # Rule a: AWB in Protokol but NOT in BQ — try fallback match
            # Match by receiver name + COD amount against POS orders
            fallback_matched = False
            receiver = item.get("receiver", "").strip()
            amount = item.get("amount_ron")
            if receiver and amount:
                try:
                    fallback_query = f"""
                        SELECT CAST(order_id AS STRING) as order_id, bill_full_name, cod, status_name
                        FROM `{BQ_DATASET}.vw_fact_orders`
                        WHERE LOWER(bill_full_name) = LOWER('{receiver.replace("'", "''")}')
                          AND CAST(cod AS FLOAT64) = {amount}
                        LIMIT 3
                    """
                    fb_rows = list(bq_client.query(fallback_query).result())
                    if len(fb_rows) == 1:
                        # Exact 1 match — high confidence
                        fb = fb_rows[0]
                        check_result["pos_order_id"] = fb.order_id
                        check_result["bq_cod_amount"] = float(fb.cod) if fb.cod else None
                        check_result["bq_status"] = fb.status_name
                        check_result["match_status"] = "matched_by_name"
                        fallback_matched = True
                        matched += 1
                        log.info(f"  Fallback match: AWB {awb} → POS #{fb.order_id} (by name: {receiver})")
                    elif len(fb_rows) > 1:
                        # Multiple matches — flag for manual review
                        check_result["match_status"] = "unknown_awb_multiple_candidates"
                        pos_ids = [r.order_id for r in fb_rows]
                        anomalies.append({
                            "awb": awb,
                            "type": "unknown_awb",
                            "detail": f"AWB not in BQ, fallback found multiple POS candidates: {pos_ids}",
                        })
                except Exception as e:
                    log.warning(f"  Fallback match failed for AWB {awb}: {e}")

            if not fallback_matched and check_result["match_status"] != "unknown_awb_multiple_candidates":
                check_result["match_status"] = "unknown_awb"
                anomalies.append({
                    "awb": awb,
                    "type": "unknown_awb",
                    "detail": "AWB not found in BQ ffm_shipments, fallback match failed",
                })
        else:
            check_result["bq_cod_amount"] = float(bq_row.cod_amount) if bq_row.cod_amount else None
            check_result["bq_status"] = bq_row.status
            check_result["bq_payout_date"] = str(bq_row.payout_date) if bq_row.payout_date else None
            check_result["pos_order_id"] = check_result["pos_order_id"] or bq_row.pos_order_id

            # Rule c: Amount mismatch
            if check_result["bq_cod_amount"] is not None and item["amount_ron"] is not None:
                diff = abs(item["amount_ron"] - check_result["bq_cod_amount"])
                if diff > AMOUNT_TOLERANCE:
                    check_result["match_status"] = "amount_mismatch"
                    anomalies.append({
                        "awb": awb,
                        "type": "amount_mismatch",
                        "protokol_amount": item["amount_ron"],
                        "bq_amount": check_result["bq_cod_amount"],
                        "diff": round(diff, 2),
                    })

            # Rule d: Count mismatch (Protokol internal)
            if (item["amount_ron"] is not None and item["counted_ron"] is not None
                    and abs(item["amount_ron"] - item["counted_ron"]) > AMOUNT_TOLERANCE):
                if check_result["match_status"] == "matched":
                    check_result["match_status"] = "count_mismatch"
                anomalies.append({
                    "awb": awb,
                    "type": "count_mismatch",
                    "amount": item["amount_ron"],
                    "counted": item["counted_ron"],
                })

            # Rule f: API not updated
            if bq_row.payout_date is None and bq_row.payout_number is None:
                if check_result["match_status"] == "matched":
                    check_result["match_status"] = "api_not_updated"
                anomalies.append({
                    "awb": awb,
                    "type": "api_not_updated",
                    "detail": "Protokol exists but API payout_date is NULL",
                })

        if check_result["match_status"] == "matched":
            matched += 1

        items_checked.append(check_result)

    # Rule b: AWBs in BQ with same payout_number but NOT in Protokol
    missing_from_protokol = []
    if protocol_number:
        try:
            missing_query = f"""
                SELECT awb, cod_amount, pos_order_id
                FROM `{BQ_TABLE_FFM}`
                WHERE payout_number = '{protocol_number}'
                AND awb NOT IN ({awb_list})
            """
            missing_rows = list(bq_client.query(missing_query).result())
            for row in missing_rows:
                missing_from_protokol.append({
                    "awb": str(row.awb),
                    "type": "missing_from_protokol",
                    "bq_cod_amount": float(row.cod_amount) if row.cod_amount else None,
                    "pos_order_id": row.pos_order_id,
                })
                anomalies.append({
                    "awb": str(row.awb),
                    "type": "missing_from_protokol",
                    "detail": f"In BQ (payout_number={protocol_number}) but not in Protokol",
                })
        except Exception as e:
            log.warning(f"Missing-from-protokol check failed: {e}")

    return {
        "matched_count": matched,
        "anomaly_count": len(set(a["awb"] for a in anomalies)),
        "anomalies": anomalies,
        "missing_from_protokol": missing_from_protokol,
        "items_checked": items_checked,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Proposals File Management
# ═══════════════════════════════════════════════════════════════════════════════

def load_proposals() -> dict:
    """Load existing proposals from JSON file."""
    if PROPOSALS_PATH.exists():
        try:
            with open(PROPOSALS_PATH, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"protocols": []}


def save_proposals(data: dict):
    """Save proposals to JSON file."""
    PROPOSALS_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Strip transient flags before saving
    for p in data.get("protocols", []):
        p.pop("_is_new", None)
    tmp_path = PROPOSALS_PATH.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)
    tmp_path.replace(PROPOSALS_PATH)
    log.info(f"Saved proposals to {PROPOSALS_PATH}")


def upsert_protocol(data: dict, protocol_data: dict, verification: dict, filename: str):
    """Add or update a protocol in the proposals file.

    Sets entry['_is_new'] = True if this is a first-time entry, False if it replaces
    an existing one. Callers can use this to decide whether to send Discord notification.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    protocol_number = protocol_data["protocol_number"]
    client_id = protocol_data.get("client_id")

    # Check if protocol already exists before removing
    existing = [
        p for p in data["protocols"]
        if p["protocol_number"] == protocol_number and p.get("client_id") == client_id
    ]
    is_new = len(existing) == 0

    # Remove existing entry for this protocol+client combo (idempotent)
    data["protocols"] = [
        p for p in data["protocols"]
        if not (p["protocol_number"] == protocol_number and p.get("client_id") == client_id)
    ]

    status = "verified" if verification["anomaly_count"] == 0 else "anomaly"

    entry = {
        "protocol_number": protocol_number,
        "client_id": protocol_data["client_id"],
        "protocol_date": protocol_data["protocol_date"],
        "source_filename": filename,
        "uploaded_at": now_iso,
        "awb_count": protocol_data["totals"]["awb_count"],
        "total_amount_ron": protocol_data["totals"]["total_amount_ron"],
        "paid_eur": protocol_data.get("paid_eur"),
        "exchange_rate": protocol_data.get("exchange_rate"),
        "matched_count": verification["matched_count"],
        "anomaly_count": verification["anomaly_count"],
        "anomalies": verification["anomalies"][:50],  # Cap at 50 for readability
        "items": verification["items_checked"],
        "missing_from_protokol": verification.get("missing_from_protokol", []),
        "verification_status": status,
        "confirmed_by_1": None,
        "confirmed_at_1": None,
        "confirmed_by_2": None,
        "confirmed_at_2": None,
    }

    # Attach preserved confirmation fields from existing entry (if any)
    if existing:
        prev = existing[0]
        for k in ("confirmed_by_1", "confirmed_at_1", "confirmed_by_2", "confirmed_at_2",
                 "transaction_id_1", "transaction_id_2", "disputed_by", "dispute_reason",
                 "payout_type", "pos_check", "pos_updated_at"):
            if prev.get(k) is not None:
                entry[k] = prev[k]
        # If previously confirmed, keep that status even if re-parsed
        if prev.get("verification_status") in ("confirmed", "disputed"):
            entry["verification_status"] = prev["verification_status"]

    entry["_is_new"] = is_new

    data["protocols"].insert(0, entry)  # Newest first
    return entry


# ═══════════════════════════════════════════════════════════════════════════════
# Discord Notification
# ═══════════════════════════════════════════════════════════════════════════════

def send_discord(protocol_number: str, protocol_data: dict, verification: dict,
                 email_msg_id: str = None, paid_eur: float = None,
                 payout_type: str = "gross", net_paid_eur: float = None,
                 total_deductions_eur: float = None):
    """Send verification report to Discord reconciliation channel.

    Designed to match the team's existing reporting format:
    - Date + EUR amount header (NET if compensation, GROSS otherwise)
    - Link to email/Protokol file
    - Dashboard link for review
    """
    if not DISCORD_WEBHOOK:
        log.warning("No Discord webhook configured, skipping notification")
        return

    anomaly_count = verification["anomaly_count"]
    matched = verification["matched_count"]
    total = protocol_data["totals"]["awb_count"]
    total_ron = protocol_data["totals"]["total_amount_ron"]
    client_id = protocol_data.get("client_id") or "-"
    protocol_date = protocol_data.get("protocol_date") or "-"

    # EUR amount — show NET for compensation, GROSS otherwise
    is_compensation = payout_type == "compensation" and net_paid_eur is not None
    if is_compensation:
        eur_display = f"NET EUR {net_paid_eur:,.2f}"
    elif paid_eur:
        eur_display = f"EUR {paid_eur:,.2f}"
    else:
        eur_display = f"RON {total_ron:,.2f}"

    # Gmail link to original email
    email_link = ""
    if email_msg_id:
        email_link = f"https://mail.google.com/mail/u/0/#inbox/{email_msg_id}"

    # Status
    if anomaly_count == 0:
        color = 0x10B981  # Green
        status_emoji = "\u2705"
        status_text = "Verified"
    else:
        color = 0xF59E0B  # Amber
        status_emoji = "\u26A0\uFE0F"
        status_text = f"{anomaly_count} Anomalies"

    # Build message content
    date_display = protocol_date
    content_lines = [
        f"**{date_display}. EU Shipment doi soat {eur_display}**",
    ]

    # Embed with details
    desc_lines = [
        f"{status_emoji} **Status:** {status_text}",
        f"\U0001F4E6 **AWBs:** {total} | Matched: {matched} | Anomalies: {anomaly_count}",
    ]

    # Show COD breakdown for compensation
    if is_compensation:
        desc_lines.append(f"\U0001F4B0 **COD Gross:** EUR {paid_eur:,.2f}" if paid_eur else f"\U0001F4B0 **COD:** RON {total_ron:,.2f}")
        desc_lines.append(f"\U0001F4C9 **Can tru:** -EUR {total_deductions_eur:,.2f}" if total_deductions_eur else "")
        desc_lines.append(f"\U0001F4B5 **Thuc nhan:** **{eur_display}**")
    else:
        desc_lines.append(f"\U0001F4B0 **COD:** RON {total_ron:,.2f} | **Paid:** {eur_display}")

    desc_lines.append(f"\U0001F3E2 **Client:** {client_id}")

    # Add email link
    if email_link:
        desc_lines.append(f"\n\U0001F4CE [Xem Protokol trong Email]({email_link})")

    # Add anomaly details if any
    if anomaly_count > 0:
        desc_lines.append(f"\n**Anomalies:**")
        for a in verification["anomalies"][:5]:
            desc_lines.append(f"  \u2022 `{a['awb']}` — {a['type']}")
        if anomaly_count > 5:
            desc_lines.append(f"  ... va {anomaly_count - 5} don nua")

    # Dashboard link
    dashboard_url = "http://164.68.101.179:3000/stramark"
    desc_lines.append(f"\n\U0001F449 [Mo dashboard de duyet]({dashboard_url})")

    embed = {
        "title": f"Protokol #{protocol_number}",
        "description": "\n".join(desc_lines),
        "color": color,
        "footer": {"text": f"Stramark Financial Control | Client {client_id}"},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    payload = {
        "content": "\n".join(content_lines),
        "embeds": [embed],
    }

    try:
        resp = requests.post(DISCORD_WEBHOOK, json=payload, timeout=15)
        if resp.status_code in (200, 204):
            log.info("Discord notification sent")
        else:
            log.warning(f"Discord returned {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log.warning(f"Discord notification failed: {e}")


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Payment Verification — Cross-check Protokol vs BQ")
    parser.add_argument("--file", help="Path to Protokol XLSX/PDF file")
    parser.add_argument("--cod-check", action="store_true", help="Run COD cross-check via API (no file needed)")
    parser.add_argument("--cod-limit", type=int, default=100, help="Max orders to check COD status (default: 100)")
    parser.add_argument("--dry-run", action="store_true", help="Log only, don't write proposals or BQ")
    parser.add_argument("--skip-discord", action="store_true", help="Skip Discord notification")
    parser.add_argument("--json-output", action="store_true", help="Output result as JSON to stdout")
    args = parser.parse_args()

    # COD Cross-Check mode
    if args.cod_check:
        return run_cod_check(args)

    if not args.file:
        parser.error("--file is required (unless using --cod-check)")

    filepath = Path(args.file)
    if not filepath.exists():
        log.error(f"File not found: {filepath}")
        sys.exit(1)

    # Step 1: Parse Protokol
    from protokol_parser import parse_protokol
    log.info(f"Parsing {filepath.name}...")
    protocol_data = parse_protokol(str(filepath), filepath.name)

    if not protocol_data["items"]:
        log.error("No items parsed from Protokol")
        sys.exit(1)

    # Filter by Stramark client IDs
    client_id = protocol_data.get("client_id")
    if client_id and client_id not in STRAMARK_CLIENT_IDS:
        log.warning(f"Client ID {client_id} is not Stramark ({STRAMARK_CLIENT_IDS}), proceeding anyway")

    # Step 2: Cross-check against BQ
    log.info("Cross-checking against BigQuery...")
    try:
        from google.cloud import bigquery
        bq_key = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if not bq_key:
            bq_key_path = PROJECT_ROOT / "bigquery_key.json"
            if bq_key_path.exists():
                os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(bq_key_path)
        bq_client = bigquery.Client(project=GCP_PROJECT)
    except Exception as e:
        log.error(f"Cannot connect to BigQuery: {e}")
        if args.dry_run:
            log.info("Dry-run mode: continuing without BQ")
            verification = {
                "matched_count": 0,
                "anomaly_count": 0,
                "anomalies": [],
                "items_checked": [{"awb": i["awb"], "match_status": "no_bq"} for i in protocol_data["items"]],
            }
        else:
            sys.exit(1)
    else:
        verification = cross_check(protocol_data, bq_client)

    # Step 3: Report
    log.info(f"\n{'='*60}")
    log.info(f"VERIFICATION REPORT — Protokol #{protocol_data['protocol_number']}")
    log.info(f"{'='*60}")
    log.info(f"  AWBs in Protokol:  {protocol_data['totals']['awb_count']}")
    log.info(f"  Matched:           {verification['matched_count']}")
    log.info(f"  Anomalies:         {verification['anomaly_count']}")
    log.info(f"  Total COD:         RON {protocol_data['totals']['total_amount_ron']:,.2f}")

    if verification["anomalies"]:
        log.info(f"\n  Anomaly details:")
        for a in verification["anomalies"][:10]:
            extra = ""
            if "protokol_amount" in a:
                extra = f" (Protokol={a.get('protokol_amount')}, BQ={a.get('bq_amount')})"
            log.info(f"    AWB {a['awb']}: {a['type']} — {a.get('detail', '')}{extra}")
        if len(verification["anomalies"]) > 10:
            log.info(f"    ... and {len(verification['anomalies']) - 10} more")

    # Step 4: Save proposals
    if not args.dry_run:
        proposals = load_proposals()
        entry = upsert_protocol(proposals, protocol_data, verification, filepath.name)
        save_proposals(proposals)
        log.info(f"Status: {entry['verification_status']}")
    else:
        log.info("[DRY-RUN] Proposals not saved")

    # Step 5: Discord
    if not args.skip_discord and not args.dry_run:
        send_discord(protocol_data["protocol_number"], protocol_data, verification)

    # Step 6: JSON output (for API route consumption)
    if args.json_output:
        output = {
            "protocol_number": protocol_data["protocol_number"],
            "client_id": protocol_data["client_id"],
            "protocol_date": protocol_data["protocol_date"],
            "awb_count": protocol_data["totals"]["awb_count"],
            "total_amount_ron": protocol_data["totals"]["total_amount_ron"],
            "matched_count": verification["matched_count"],
            "anomaly_count": verification["anomaly_count"],
            "verification_status": "verified" if verification["anomaly_count"] == 0 else "anomaly",
        }
        print(json.dumps(output, ensure_ascii=False))

    log.info("Done.")


def run_cod_check(args):
    """Run COD cross-check: BQ delivered orders vs euShipments API."""
    log.info("COD Cross-Check: BQ vs euShipments API")

    try:
        from google.cloud import bigquery
        bq_key_path = PROJECT_ROOT / "bigquery_key.json"
        if bq_key_path.exists():
            os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", str(bq_key_path))
        bq_client = bigquery.Client(project=GCP_PROJECT)
    except Exception as e:
        log.error(f"Cannot connect to BigQuery: {e}")
        sys.exit(1)

    result = cod_cross_check(bq_client, limit=args.cod_limit)

    log.info(f"\n{'='*60}")
    log.info(f"COD CROSS-CHECK REPORT")
    log.info(f"{'='*60}")
    log.info(f"  Checked:          {result['checked']}")
    log.info(f"  Paid (matched):   {result['summary'].get('paid_matched', 0)}")
    log.info(f"  Pending:          {result['summary'].get('pending', 0)}")
    log.info(f"  Mismatch:         {result['summary'].get('mismatch', 0)}")
    log.info(f"  No data:          {result['summary'].get('no_data', 0)}")

    # Show mismatches
    mismatches = [i for i in result["items"] if i["cod_status"] in ("paid_no_bq", "bq_paid_api_pending")]
    if mismatches:
        log.info(f"\n  Mismatches:")
        for m in mismatches[:10]:
            log.info(f"    POS={m['pos_order_id']} AWB={m['awb']} status={m['cod_status']} "
                     f"api_paid={m['api_payed_date'] or '-'} bq_paid={m['bq_payout_date'] or '-'}")

    # Save to proposals
    if not args.dry_run:
        proposals = load_proposals()
        proposals["cod_cross_check"] = {
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "checked": result["checked"],
            "summary": result["summary"],
            "items": result["items"],
        }
        save_proposals(proposals)

    if args.json_output:
        print(json.dumps({
            "checked": result["checked"],
            "summary": result["summary"],
        }, ensure_ascii=False))

    log.info("Done.")


if __name__ == "__main__":
    main()
