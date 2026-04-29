#!/usr/bin/env python3
"""
Stramark — Auto-sync Protokol from Gmail (invoice/finance@levelupvn.com).

Searches for euShipments COD Payment Protocol emails, downloads XLSX attachments,
runs cross-check verification, and sends Discord notifications.

Usage:
    python sync/stramark/protokol_email_sync.py              # Sync new emails
    python sync/stramark/protokol_email_sync.py --dry-run     # Preview only
    python sync/stramark/protokol_email_sync.py --days 30     # Override lookback
    python sync/stramark/protokol_email_sync.py --reprocess   # Re-check already processed
"""

import argparse
import base64
import io
import json
import logging
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# Force UTF-8 on Windows
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("protokol_email_sync")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "sync" / "stramark"))

# ── Config ────────────────────────────────────────────────────────────────────

CREDENTIALS_FILE = ROOT / "config" / "manual_data" / "client_secret_178422801328-760qj2adakk48a96oft4usveb80hrvrd.apps.googleusercontent.com.json"
TOKEN_FILE = ROOT / "config" / "gmail_token_invoice.json"
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
]

# Stramark client IDs to filter
STRAMARK_CLIENT_IDS = ["3282", "3248"]

# Gmail search queries for each document type
GMAIL_QUERY_PROTOKOL = 'subject:"COD Payment Protocol"'
GMAIL_QUERY_INVOICE = 'subject:"Invoice" subject:"InOut Trade"'

# Label to mark processed emails
PROCESSED_LABEL = "stramark-protokol-synced-v2"


# ═══════════════════════════════════════════════════════════════════════════════
# Gmail Service
# ═══════════════════════════════════════════════════════════════════════════════

def get_gmail_service():
    """Get authenticated Gmail API service."""
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    if not TOKEN_FILE.exists():
        log.error(f"Token file not found: {TOKEN_FILE}")
        log.error("Run: python sync/stramark/gmail_auth_invoice.py")
        sys.exit(1)

    creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        with open(TOKEN_FILE, "w") as f:
            f.write(creds.to_json())

    return build("gmail", "v1", credentials=creds)


def ensure_label(service, label_name: str) -> str:
    """Get or create a Gmail label. Returns label ID."""
    results = service.users().labels().list(userId="me").execute()
    for label in results.get("labels", []):
        if label["name"] == label_name:
            return label["id"]

    # Create label
    body = {"name": label_name, "labelListVisibility": "labelShow", "messageListVisibility": "show"}
    created = service.users().labels().create(userId="me", body=body).execute()
    log.info(f"Created Gmail label: {label_name}")
    return created["id"]


def search_emails(service, query: str, days: int = 14, reprocess: bool = False):
    """Search Gmail for Protokol emails.

    Note: We do NOT filter by processed label because Gmail filter rules may
    auto-apply the label to new emails, causing them to be skipped.
    Deduplication happens at the parser level (by protocol_number + client_id).
    """
    full_query = f"{query} newer_than:{days}d"

    log.info(f"Gmail search: {full_query}")
    results = service.users().messages().list(userId="me", q=full_query, maxResults=50).execute()
    messages = results.get("messages", [])
    log.info(f"Found {len(messages)} emails")
    return messages


def get_message(service, msg_id: str):
    """Get full message with attachments."""
    return service.users().messages().get(userId="me", id=msg_id, format="full").execute()


def get_attachment(service, msg_id: str, attachment_id: str) -> bytes:
    """Download attachment content."""
    att = service.users().messages().attachments().get(
        userId="me", messageId=msg_id, id=attachment_id
    ).execute()
    return base64.urlsafe_b64decode(att["data"])


def mark_processed(service, msg_id: str, label_id: str):
    """Add processed label to email."""
    service.users().messages().modify(
        userId="me", id=msg_id,
        body={"addLabelIds": [label_id]}
    ).execute()


# ═══════════════════════════════════════════════════════════════════════════════
# Email Processing
# ═══════════════════════════════════════════════════════════════════════════════

def extract_attachments(service, message) -> tuple:
    """Extract XLSX and PDF attachments from email.

    Returns (xlsx_list, pdf_list) where each is list of (filename, bytes).
    """
    xlsx_files = []
    pdf_files = []
    msg_id = message["id"]

    def walk_parts(parts):
        for part in parts:
            filename = part.get("filename", "")
            if "body" in part:
                att_id = part["body"].get("attachmentId")
                if att_id:
                    if filename.lower().endswith(".xlsx"):
                        data = get_attachment(service, msg_id, att_id)
                        xlsx_files.append((filename, data))
                    elif filename.lower().endswith(".pdf"):
                        data = get_attachment(service, msg_id, att_id)
                        pdf_files.append((filename, data))
            if "parts" in part:
                walk_parts(part["parts"])

    payload = message.get("payload", {})
    if "parts" in payload:
        walk_parts(payload["parts"])

    return xlsx_files, pdf_files


def is_stramark_protokol(filename: str) -> bool:
    """Check if filename is a Stramark Protokol (by client ID)."""
    m = re.search(r"Protokol-\d+-(\d+)", filename, re.IGNORECASE)
    if not m:
        return False
    client_id = m.group(1)
    return client_id in STRAMARK_CLIENT_IDS


def get_email_subject(message) -> str:
    """Extract subject from email headers."""
    headers = message.get("payload", {}).get("headers", [])
    for h in headers:
        if h["name"].lower() == "subject":
            return h["value"]
    return ""


def get_email_date(message) -> str:
    """Extract date from email headers."""
    headers = message.get("payload", {}).get("headers", [])
    for h in headers:
        if h["name"].lower() == "date":
            return h["value"]
    return ""


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def classify_email(subject: str) -> str:
    """Classify email type from subject line."""
    subj_lower = subject.lower()
    if "invoice" in subj_lower and "inout" in subj_lower:
        return "invoice"
    if "compensation" in subj_lower or "deduction" in subj_lower:
        return "compensation"
    if "payment protocol" in subj_lower or "изплащане" in subj_lower:
        return "protokol"
    return "unknown"


def main():
    parser = argparse.ArgumentParser(description="Auto-sync Protokol + Invoice from Gmail")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, don't process")
    parser.add_argument("--days", type=int, default=14, help="Lookback days (default: 14)")
    parser.add_argument("--reprocess", action="store_true", help="Re-check already processed emails")
    parser.add_argument("--skip-discord", action="store_true", help="Skip Discord notification")
    parser.add_argument("--json-output", action="store_true", help="Output results as JSON")
    args = parser.parse_args()

    # Connect to Gmail
    log.info("Connecting to Gmail...")
    service = get_gmail_service()

    # Search for BOTH Protokol and Invoice emails
    all_messages = []
    for query in [GMAIL_QUERY_PROTOKOL, GMAIL_QUERY_INVOICE]:
        msgs = search_emails(service, query, days=args.days, reprocess=args.reprocess)
        all_messages.extend(msgs)

    # Deduplicate by message ID
    seen_ids = set()
    messages = []
    for m in all_messages:
        if m["id"] not in seen_ids:
            seen_ids.add(m["id"])
            messages.append(m)

    if not messages:
        log.info("No new emails found.")
        if args.json_output:
            print(json.dumps({"synced": 0, "protocols": [], "invoices": []}))
        return

    # Get/create processed label
    label_id = ensure_label(service, PROCESSED_LABEL)

    results = []
    invoice_results = []
    synced_count = 0

    for msg_ref in messages:
        msg_id = msg_ref["id"]
        message = get_message(service, msg_id)
        subject = get_email_subject(message)
        email_date = get_email_date(message)
        email_type = classify_email(subject)
        log.info(f"\n[{email_type.upper()}] {subject}")
        log.info(f"  Date: {email_date}")

        # Extract attachments
        xlsx_attachments, pdf_attachments = extract_attachments(service, message)
        log.info(f"  Attachments: {len(xlsx_attachments)} XLSX, {len(pdf_attachments)} PDF files")

        # ── INVOICE emails ──
        if email_type == "invoice":
            for pdf_fn, pdf_bytes in pdf_attachments:
                if not pdf_fn.lower().startswith("inv-"):
                    continue
                log.info(f"  Processing invoice: {pdf_fn}")
                if args.dry_run:
                    invoice_results.append({"filename": pdf_fn, "status": "dry-run"})
                    continue
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False, prefix="inv_") as tmp:
                    tmp.write(pdf_bytes)
                    tmp_path = tmp.name
                try:
                    from protokol_parser import parse_invoice_pdf
                    inv_data = parse_invoice_pdf(tmp_path, pdf_fn)
                    # Save to proposals
                    from payment_verification import load_proposals, save_proposals
                    proposals = load_proposals()
                    if "invoices" not in proposals:
                        proposals["invoices"] = []
                    # Upsert by invoice_number
                    proposals["invoices"] = [i for i in proposals["invoices"] if i.get("invoice_number") != inv_data["invoice_number"]]
                    proposals["invoices"].insert(0, inv_data)
                    save_proposals(proposals)
                    invoice_results.append({"filename": pdf_fn, "invoice_number": inv_data["invoice_number"], "total_eur": inv_data["total_eur"], "status": "synced"})
                    synced_count += 1
                except Exception as e:
                    log.error(f"  Invoice parse error: {e}")
                    invoice_results.append({"filename": pdf_fn, "status": "error", "error": str(e)})
                finally:
                    try: os.unlink(tmp_path)
                    except OSError: pass
            if not args.dry_run:
                mark_processed(service, msg_id, label_id)
            continue

        # ── COMPENSATION emails: also find + parse "Protocol for compensation" PDF ──
        if email_type == "compensation":
            for pdf_fn, pdf_bytes in pdf_attachments:
                # Look for compensation summary: either "Protocol for compensation" PDF
                # or the Protokol PDF itself (which has compensation page at end)
                is_comp_pdf = "compensation" in pdf_fn.lower() or "deduction" in pdf_fn.lower()
                # Also try Stramark Protokol PDFs from compensation emails
                if not is_comp_pdf and is_stramark_protokol(pdf_fn):
                    is_comp_pdf = True
                if is_comp_pdf:
                    log.info(f"  Processing compensation: {pdf_fn}")
                    if not args.dry_run:
                        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False, prefix="comp_") as tmp:
                            tmp.write(pdf_bytes)
                            tmp_path = tmp.name
                        try:
                            from protokol_parser import parse_compensation_pdf
                            from payment_verification import load_proposals, save_proposals
                            comp_data = parse_compensation_pdf(tmp_path, pdf_fn)
                            # Save compensation data — will be linked to protocol later
                            proposals = load_proposals()
                            if "compensations" not in proposals:
                                proposals["compensations"] = []
                            proposals["compensations"] = [c for c in proposals["compensations"] if c.get("protocol_number") != comp_data["protocol_number"]]
                            proposals["compensations"].insert(0, comp_data)
                            # Also update matching protocol entries with compensation info
                            for proto in proposals.get("protocols", []):
                                if proto["protocol_number"] == comp_data["protocol_number"]:
                                    proto["payout_type"] = "compensation"
                                    proto["cod_gross_eur"] = comp_data["cod_gross_eur"]
                                    proto["deductions"] = comp_data["invoices_deducted"]
                                    proto["total_deductions_eur"] = comp_data["total_deductions_eur"]
                                    proto["net_paid_eur"] = comp_data["net_paid_eur"]
                            save_proposals(proposals)
                            synced_count += 1
                        except Exception as e:
                            log.error(f"  Compensation parse error: {e}")
                        finally:
                            try: os.unlink(tmp_path)
                            except OSError: pass
            # Fall through to also process COD Protokol attachments in same email

        # ── PROTOKOL + COMPENSATION: process COD AWB files ──
        stramark_files = [(fn, fb) for fn, fb in xlsx_attachments if is_stramark_protokol(fn)]
        skipped_files = [(fn, fb) for fn, fb in xlsx_attachments if not is_stramark_protokol(fn)]
        for fn, _ in skipped_files:
            log.info(f"  Skip: {fn} (not Stramark)")

        # Deduplicate by protocol_number + client_id (keep EN variant, skip BG duplicate)
        # Note: same protocol_number with different client_ids are SEPARATE protocols
        seen_keys = set()
        deduped_files = []
        # Sort so -en files come first (preferred)
        stramark_files.sort(key=lambda x: (0 if "-en" in x[0].lower() else 1))
        for fn, fb in stramark_files:
            m = re.search(r"Protokol-(\d+)-(\d+)", fn)
            # Key = protocol_number + client_id (e.g., "43299-3282" vs "43299-3248")
            proto_key = f"{m.group(1)}-{m.group(2)}" if m else fn
            if proto_key in seen_keys:
                log.info(f"  Skip: {fn} (duplicate variant)")
                continue
            seen_keys.add(proto_key)
            deduped_files.append((fn, fb))

        # Also check for PDF-only Stramark protokols (no XLSX available)
        xlsx_proto_keys = set()
        for fn, _ in deduped_files:
            m = re.search(r"Protokol-(\d+)-(\d+)", fn)
            if m:
                xlsx_proto_keys.add(f"{m.group(1)}-{m.group(2)}")

        for pdf_fn, pdf_bytes in pdf_attachments:
            if not is_stramark_protokol(pdf_fn):
                continue
            m = re.search(r"Protokol-(\d+)-(\d+)", pdf_fn)
            if not m:
                continue
            pdf_key = f"{m.group(1)}-{m.group(2)}"
            if pdf_key not in xlsx_proto_keys:
                # PDF exists but no XLSX — use PDF as fallback
                log.info(f"  PDF fallback: {pdf_fn} (no XLSX found)")
                deduped_files.append((pdf_fn, pdf_bytes))

        for filename, file_bytes in deduped_files:
            log.info(f"  Processing: {filename}")

            if args.dry_run:
                log.info(f"  [DRY-RUN] Would process {filename}")
                results.append({"filename": filename, "status": "dry-run"})
                continue

            # Write file to temp
            suffix = ".pdf" if filename.lower().endswith(".pdf") else ".xlsx"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False, prefix="protokol_") as tmp:
                tmp.write(file_bytes)
                tmp_path = tmp.name

            # Also save companion PDF (for EUR extraction)
            pdf_name = re.sub(r"-en\.xlsx$", ".pdf", filename, flags=re.IGNORECASE)
            pdf_name = re.sub(r"\.xlsx$", ".pdf", pdf_name, flags=re.IGNORECASE)
            tmp_pdf_path = os.path.join(os.path.dirname(tmp_path), pdf_name)
            for pdf_fn, pdf_bytes in pdf_attachments:
                if pdf_fn == pdf_name:
                    with open(tmp_pdf_path, "wb") as pf:
                        pf.write(pdf_bytes)
                    break

            try:
                from protokol_parser import parse_protokol
                from payment_verification import cross_check, load_proposals, upsert_protocol, save_proposals, send_discord

                # Parse (auto-detects XLSX or PDF)
                protocol_data = parse_protokol(tmp_path, filename)
                log.info(f"  Parsed: {protocol_data['totals']['awb_count']} AWBs, "
                         f"RON {protocol_data['totals']['total_amount_ron']:,.2f}")

                # Cross-check
                from google.cloud import bigquery
                bq_key_path = ROOT / "bigquery_key.json"
                if bq_key_path.exists():
                    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(bq_key_path)
                bq_client = bigquery.Client(project="levelup-465304")

                verification = cross_check(protocol_data, bq_client)
                log.info(f"  Matched: {verification['matched_count']}, "
                         f"Anomalies: {verification['anomaly_count']}")

                # Save proposals
                proposals = load_proposals()
                entry = upsert_protocol(proposals, protocol_data, verification, filename)
                # Fill protocol_date from email if parser didn't find it
                if not entry.get("protocol_date") and email_date:
                    from email.utils import parsedate_to_datetime
                    try:
                        entry["protocol_date"] = parsedate_to_datetime(email_date).strftime("%Y-%m-%d")
                    except Exception:
                        entry["protocol_date"] = email_date[:10]
                # Set payout_type based on email classification
                if email_type == "compensation":
                    entry["payout_type"] = "compensation"
                elif not entry.get("payout_type"):
                    entry["payout_type"] = "gross"

                # Capture newness flag before save_proposals strips it
                is_new_protocol = bool(entry.get("_is_new"))

                save_proposals(proposals)

                # Discord — only for NEW protocols (not re-processed)
                if not args.skip_discord and is_new_protocol:
                    send_discord(
                        protocol_data["protocol_number"], protocol_data, verification,
                        email_msg_id=msg_id,
                        paid_eur=entry.get("paid_eur"),
                        payout_type=entry.get("payout_type", "gross"),
                        net_paid_eur=entry.get("net_paid_eur"),
                        total_deductions_eur=entry.get("total_deductions_eur"),
                    )
                elif not args.skip_discord:
                    log.info(f"  Skip Discord (protocol already processed): #{protocol_data['protocol_number']}")

                results.append({
                    "filename": filename,
                    "protocol_number": protocol_data["protocol_number"],
                    "awb_count": protocol_data["totals"]["awb_count"],
                    "matched": verification["matched_count"],
                    "anomalies": verification["anomaly_count"],
                    "status": entry["verification_status"],
                })
                synced_count += 1

            except Exception as e:
                log.error(f"  Error processing {filename}: {e}")
                results.append({"filename": filename, "status": "error", "error": str(e)})
            finally:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                try:
                    os.unlink(tmp_pdf_path)
                except OSError:
                    pass

        # Mark email as processed
        if not args.dry_run:
            mark_processed(service, msg_id, label_id)
            log.info(f"  Marked as processed")

    # Final pass: link compensation data to protocol entries
    from payment_verification import load_proposals, save_proposals
    proposals = load_proposals()
    compensations = proposals.get("compensations", [])
    if compensations:
        linked = 0
        for comp in compensations:
            comp_num = comp.get("protocol_number")
            if not comp_num:
                continue
            for proto in proposals.get("protocols", []):
                if proto["protocol_number"] == comp_num:
                    proto["payout_type"] = "compensation"
                    proto["cod_gross_eur"] = comp.get("cod_gross_eur")
                    proto["deductions"] = comp.get("invoices_deducted", [])
                    proto["total_deductions_eur"] = comp.get("total_deductions_eur")
                    proto["net_paid_eur"] = comp.get("net_paid_eur")
                    linked += 1
        if linked:
            save_proposals(proposals)
            log.info(f"Linked compensation data to {linked} protocol entries")

    # Summary
    log.info(f"\n{'='*60}")
    log.info(f"SYNC COMPLETE — {synced_count} documents processed")
    log.info(f"  Protocols: {len(results)}, Invoices: {len(invoice_results)}")
    log.info(f"{'='*60}")

    if args.json_output:
        print(json.dumps({"synced": synced_count, "protocols": results, "invoices": invoice_results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
