"""
TCE Sync — Parse TCE Deviz PDFs and sync fulfillment costs to BigQuery.

Usage:
    python sync/stramark/tce_sync.py                    # Full sync
    python sync/stramark/tce_sync.py --dry-run           # Parse only, no BQ write
    python sync/stramark/tce_sync.py --folder path/to/pdfs  # Custom folder

Source of Truth: sync/stramark/tce_sync.py
Created: 2026-03-06
"""
import os
import sys
import io
import json
import logging
import argparse
from datetime import datetime, timezone
from pathlib import Path

# Force UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ═══ Configuration ═══
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BQ_KEY_PATH = PROJECT_ROOT / "bigquery_key.json"
LOG_DIR = PROJECT_ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)

GCP_PROJECT = "levelup-465304"
BQ_DATASET = "STRAMARK_Dataset"
BQ_TABLE = f"{GCP_PROJECT}.{BQ_DATASET}.ffm_shipments"

DEFAULT_PDF_FOLDER = PROJECT_ROOT / "config" / "manual_data" / "TCE Factură"

# ═══ Logging ═══
log_filename = LOG_DIR / f"tce_sync_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(log_filename, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)


# ═══ BigQuery Operations ═══

def init_bigquery():
    """Initialize BigQuery client."""
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(BQ_KEY_PATH)
    from google.cloud import bigquery
    return bigquery.Client(project=GCP_PROJECT)


def upsert_tce_records(bq_client, records, dry_run=False):
    """Upsert TCE records into BigQuery using MERGE.

    Reuses the same ffm_shipments table and schema as EU Shipment sync.
    Key difference: ffm_partner='TCE', sync_source='pdf'.
    """
    if not records:
        logger.info("No records to upsert")
        return 0

    if dry_run:
        logger.info(f"[DRY RUN] Would upsert {len(records)} records:")
        for r in records[:10]:
            logger.info(f"  AWB={r['awb']} | POS={r['pos_order_id'] or 'N/A'} | "
                        f"Cost={r['price_excl_vat']:.2f}+VAT={r['price_incl_vat']:.2f} EUR | "
                        f"Return={r['is_return_shipment']}")
        if len(records) > 10:
            logger.info(f"  ... and {len(records) - 10} more")
        return len(records)

    from google.cloud import bigquery as bq

    temp_table_id = f"{GCP_PROJECT}.{BQ_DATASET}._tce_sync_staging"

    # Schema matches ffm_shipments exactly
    schema = [
        bq.SchemaField("awb", "STRING"),
        bq.SchemaField("ref_number", "STRING"),
        bq.SchemaField("pos_order_id", "STRING"),
        bq.SchemaField("ffm_partner", "STRING"),
        bq.SchemaField("client_id", "STRING"),
        bq.SchemaField("status", "STRING"),
        bq.SchemaField("price_excl_vat", "FLOAT64"),
        bq.SchemaField("price_incl_vat", "FLOAT64"),
        bq.SchemaField("vat_rate", "FLOAT64"),
        bq.SchemaField("currency", "STRING"),
        bq.SchemaField("is_return_shipment", "BOOLEAN"),
        bq.SchemaField("original_order_id", "STRING"),
        bq.SchemaField("cod_amount", "FLOAT64"),
        bq.SchemaField("created_date", "TIMESTAMP"),
        bq.SchemaField("delivered_date", "TIMESTAMP"),
        bq.SchemaField("returned_date", "TIMESTAMP"),
        bq.SchemaField("raw_response", "STRING"),
        bq.SchemaField("synced_at", "TIMESTAMP"),
        bq.SchemaField("sync_source", "STRING"),
    ]

    now = datetime.now(timezone.utc).isoformat()
    rows_to_insert = []
    for r in records:
        row = {
            "awb": r["awb"],
            "ref_number": r.get("ref_number"),
            "pos_order_id": r.get("pos_order_id"),
            "ffm_partner": r.get("ffm_partner", "TCE"),
            "client_id": r.get("client_id"),
            "status": r.get("status"),
            "price_excl_vat": r.get("price_excl_vat"),
            "price_incl_vat": r.get("price_incl_vat"),
            "vat_rate": r.get("vat_rate", 0.21),
            "currency": r.get("currency", "EUR"),
            "is_return_shipment": r.get("is_return_shipment", False),
            "original_order_id": r.get("original_order_id"),
            "cod_amount": r.get("cod_amount"),
            "created_date": r.get("created_date"),
            "delivered_date": r.get("delivered_date"),
            "returned_date": r.get("returned_date"),
            "raw_response": r.get("raw_response"),
            "synced_at": now,
            "sync_source": r.get("sync_source", "pdf"),
        }
        rows_to_insert.append(row)

    job_config = bq.LoadJobConfig(
        schema=schema,
        write_disposition="WRITE_TRUNCATE",
    )

    try:
        # Load into staging
        job = bq_client.load_table_from_json(
            rows_to_insert, temp_table_id, job_config=job_config
        )
        job.result()
        logger.info(f"Loaded {len(rows_to_insert)} rows to staging table")

        # MERGE into main table
        merge_sql = f"""
            MERGE `{BQ_TABLE}` AS target
            USING `{temp_table_id}` AS source
            ON target.awb = source.awb
            WHEN MATCHED THEN UPDATE SET
                ref_number = source.ref_number,
                pos_order_id = source.pos_order_id,
                ffm_partner = source.ffm_partner,
                client_id = source.client_id,
                status = source.status,
                price_excl_vat = source.price_excl_vat,
                price_incl_vat = source.price_incl_vat,
                vat_rate = source.vat_rate,
                currency = source.currency,
                is_return_shipment = source.is_return_shipment,
                original_order_id = source.original_order_id,
                cod_amount = source.cod_amount,
                created_date = source.created_date,
                delivered_date = source.delivered_date,
                returned_date = source.returned_date,
                raw_response = source.raw_response,
                synced_at = source.synced_at,
                sync_source = source.sync_source
            WHEN NOT MATCHED THEN INSERT (
                awb, ref_number, pos_order_id, ffm_partner, client_id,
                status, price_excl_vat, price_incl_vat, vat_rate, currency,
                is_return_shipment, original_order_id, cod_amount,
                created_date, delivered_date, returned_date,
                raw_response, synced_at, sync_source
            ) VALUES (
                source.awb, source.ref_number, source.pos_order_id,
                source.ffm_partner, source.client_id,
                source.status, source.price_excl_vat, source.price_incl_vat,
                source.vat_rate, source.currency,
                source.is_return_shipment, source.original_order_id, source.cod_amount,
                source.created_date, source.delivered_date, source.returned_date,
                source.raw_response, source.synced_at, source.sync_source
            )
        """
        bq_client.query(merge_sql).result()
        logger.info(f"✓ Merged {len(rows_to_insert)} records into {BQ_TABLE}")

        # Clean up staging
        bq_client.delete_table(temp_table_id, not_found_ok=True)
        return len(rows_to_insert)

    except Exception as e:
        logger.error(f"Upsert error: {e}")
        bq_client.delete_table(temp_table_id, not_found_ok=True)
        return 0


# ═══ Main Sync Logic ═══

def scan_deviz_folder(folder_path):
    """Find all Deviz_*.pdf files in the folder."""
    folder = Path(folder_path)
    if not folder.exists():
        logger.error(f"Folder not found: {folder}")
        return []

    pdfs = sorted(folder.glob("Deviz_*.pdf"))
    logger.info(f"Found {len(pdfs)} Deviz PDFs in {folder}")
    return pdfs


def sync_tce_costs(folder_path=None, dry_run=False):
    """Main entrypoint: parse all Deviz PDFs → filter → MERGE to BigQuery.

    Returns:
        dict with summary stats
    """
    # Add project root to path for imports
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))

    from sync.stramark.tce_pdf_parser import (
        parse_deviz_pdf,
        filter_stramark_orders,
        normalize_to_ffm_schema,
    )

    folder = Path(folder_path) if folder_path else DEFAULT_PDF_FOLDER

    logger.info("═" * 60)
    logger.info("  TCE PDF Sync")
    logger.info(f"  Source: {folder}")
    logger.info(f"  Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    logger.info(f"  Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info("═" * 60)

    # Step 1: Scan folder
    pdf_files = scan_deviz_folder(folder)
    if not pdf_files:
        logger.warning("No Deviz PDFs found. Nothing to sync.")
        return {"total_parsed": 0}

    # Step 2: Parse all PDFs
    all_rows = []
    parse_errors = 0
    for pdf_path in pdf_files:
        try:
            rows = parse_deviz_pdf(pdf_path)
            all_rows.extend(rows)
        except Exception as e:
            logger.error(f"Failed to parse {pdf_path.name}: {e}")
            parse_errors += 1

    logger.info(f"\nTotal rows parsed across {len(pdf_files)} PDFs: {len(all_rows)}")

    # Step 3: Filter Stramark orders only
    logger.info("\nFiltering Stramark (Aurelia Wear) orders...")
    stramark_rows = filter_stramark_orders(all_rows)
    forward_count = sum(1 for r in stramark_rows if not r.get("is_return", False))
    return_count = sum(1 for r in stramark_rows if r.get("is_return", False))
    logger.info(f"  Stramark orders: {len(stramark_rows)} total "
                f"(Forward: {forward_count}, Returns: {return_count})")

    if not stramark_rows:
        logger.warning("No Stramark orders found after filtering.")
        return {"total_parsed": len(all_rows), "stramark_orders": 0}

    # Step 4: Normalize to schema
    logger.info("\nNormalizing to ffm_shipments schema...")
    records, unmatched_info = normalize_to_ffm_schema(stramark_rows)

    # Step 5: Deduplicate by AWB
    seen_awbs = set()
    unique_records = []
    duplicates = 0
    for r in records:
        if r["awb"] not in seen_awbs:
            seen_awbs.add(r["awb"])
            unique_records.append(r)
        else:
            duplicates += 1

    if duplicates > 0:
        logger.info(f"  Removed {duplicates} duplicate AWBs (appearing in multiple Deviz files)")

    logger.info(f"  Unique records ready for sync: {len(unique_records)}")

    # Step 6: Calculate totals
    total_cost_excl_vat = sum(r["price_excl_vat"] for r in unique_records)
    total_cost_incl_vat = sum(r["price_incl_vat"] for r in unique_records)
    forward_cost = sum(r["price_incl_vat"] for r in unique_records if not r["is_return_shipment"])
    return_cost = sum(r["price_incl_vat"] for r in unique_records if r["is_return_shipment"])

    logger.info(f"\n{'─' * 50}")
    logger.info(f"  COST SUMMARY")
    logger.info(f"{'─' * 50}")
    logger.info(f"  Forward cost: {forward_cost:.2f} EUR (incl. 21% VAT)")
    logger.info(f"  Return cost:  {return_cost:.2f} EUR (incl. 21% VAT)")
    logger.info(f"  Total cost:   {total_cost_incl_vat:.2f} EUR (incl. 21% VAT)")
    logger.info(f"  Total excl:   {total_cost_excl_vat:.2f} EUR (excl. VAT)")

    # Step 7: Unmatched returns warning
    if unmatched_info["count"] > 0:
        logger.warning(f"\n⚠️  UNMATCHED RETURNS WARNING")
        logger.warning(f"  Count: {unmatched_info['count']} return orders cannot be matched to POS orders")
        logger.warning(f"  Cost (excl VAT): {unmatched_info['total_cost_excl_vat']:.2f} EUR")
        logger.warning(f"  Cost (incl VAT): {unmatched_info['total_cost_incl_vat']:.2f} EUR")
        logger.warning(f"  These costs ARE included in the total but pos_order_id is NULL")

    # Step 8: Upsert to BigQuery
    if dry_run:
        merged = upsert_tce_records(None, unique_records, dry_run=True)
    else:
        logger.info("\nInitializing BigQuery...")
        bq_client = init_bigquery()
        merged = upsert_tce_records(bq_client, unique_records, dry_run=False)

    # Summary
    summary = {
        "pdf_files": len(pdf_files),
        "total_parsed": len(all_rows),
        "stramark_forward": forward_count,
        "stramark_return": return_count,
        "duplicates_removed": duplicates,
        "unique_records": len(unique_records),
        "merged": merged,
        "total_cost_excl_vat": round(total_cost_excl_vat, 2),
        "total_cost_incl_vat": round(total_cost_incl_vat, 2),
        "unmatched_returns": unmatched_info["count"],
        "unmatched_returns_cost": round(unmatched_info["total_cost_incl_vat"], 2),
        "parse_errors": parse_errors,
    }

    logger.info(f"\n{'═' * 60}")
    logger.info(f"  TCE SYNC COMPLETE")
    logger.info(f"  PDFs processed: {summary['pdf_files']}")
    logger.info(f"  Records merged: {summary['merged']}")
    logger.info(f"  Parse errors: {summary['parse_errors']}")
    logger.info(f"  Log file: {log_filename}")
    logger.info(f"{'═' * 60}")

    return summary


# ═══ CLI Entrypoint ═══

def main():
    parser = argparse.ArgumentParser(description="TCE PDF Sync — Parse Deviz PDFs to BigQuery")
    parser.add_argument("--dry-run", action="store_true", help="Parse only, don't write to BigQuery")
    parser.add_argument("--folder", type=str, default=None,
                        help=f"Path to folder with Deviz PDFs (default: {DEFAULT_PDF_FOLDER})")
    args = parser.parse_args()

    summary = sync_tce_costs(folder_path=args.folder, dry_run=args.dry_run)

    # Print machine-readable summary to stdout
    if summary:
        logger.info(f"\nJSON Summary: {json.dumps(summary, indent=2)}")


if __name__ == "__main__":
    main()
