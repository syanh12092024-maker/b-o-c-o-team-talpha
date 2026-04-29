"""
BigQuery operations for FFM sync — table management, queries, upsert.

Source of Truth: sync/stramark/bq_operations.py
Created: 2026-03-09 (extracted from eu_shipment_sync.py)
"""

import os
import logging
from pathlib import Path
from datetime import datetime, timezone

from google.cloud import bigquery

logger = logging.getLogger(__name__)


def init_bigquery(bq_key_path, gcp_project):
    """Initialize BigQuery client."""
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(bq_key_path)
    return bigquery.Client(project=gcp_project)


def ensure_table_exists(bq_client, project_root):
    """Create ffm_shipments table if it does not exist.

    Skips DDL if table already exists to avoid BQ sandbox billing errors
    on CREATE TABLE IF NOT EXISTS with expiration settings.
    """
    from google.cloud.exceptions import NotFound
    try:
        bq_client.get_table("levelup-465304.STRAMARK_Dataset.ffm_shipments")
        logger.info("ffm_shipments table already exists, skipping DDL")
        return True
    except NotFound:
        pass
    except Exception as e:
        logger.warning(f"Table check error (non-fatal): {e}")

    sql_path = project_root / "sql" / "stramark" / "create_ffm_shipments.sql"
    if not sql_path.exists():
        logger.error(f"Table DDL not found: {sql_path}")
        return False

    with open(sql_path, "r", encoding="utf-8") as f:
        sql = f.read()

    sql_clean = "\n".join(
        l for l in sql.split("\n") if not l.strip().startswith("--")
    )

    try:
        bq_client.query(sql_clean).result()
        logger.info("ffm_shipments table created")
        return True
    except Exception as e:
        logger.error(f"Table creation error: {e}")
        return False


def get_orders_needing_sync(
    bq_client, gcp_project, bq_dataset, bq_table,
    limit=None, resync_all=False,
):
    """Get POS order IDs that need FFM data sync.

    Returns orders that went through 3PL (status after TCE export).
    Excludes orders already synced with terminal status unless resync_all.
    """
    if resync_all:
        where_clause = """
            WHERE o.status_name IN ('packing', 'pending', 'shipped', 'delivered',
                                     'received_money', 'returning', 'returned')
        """
    else:
        # Only skip orders already at TRUE terminal status (Delivered/Returned)
        # Orders at Warehouse/Shipped/Processing should be re-synced for status updates
        where_clause = f"""
            WHERE o.status_name IN ('packing', 'pending', 'shipped', 'delivered',
                                     'received_money', 'returning', 'returned')
              AND o.order_id NOT IN (
                  SELECT DISTINCT pos_order_id
                  FROM `{bq_table}`
                  WHERE pos_order_id IS NOT NULL
                    AND status IN ('Delivered', 'Returned')
              )
        """

    limit_clause = f"LIMIT {limit}" if limit else ""

    sql = f"""
        SELECT DISTINCT
            CAST(o.order_id AS STRING) AS order_id,
            o.order_date,
            o.status_name
        FROM `{gcp_project}.{bq_dataset}.vw_fact_orders` o
        {where_clause}
        ORDER BY o.order_date DESC
        {limit_clause}
    """

    try:
        rows = list(bq_client.query(sql).result())
        logger.info(f"Found {len(rows)} orders needing FFM sync")
        return rows
    except Exception as e:
        logger.error(f"Query error: {e}")
        return []


def upsert_ffm_records(bq_client, bq_table, records, dry_run=False):
    """Upsert FFM records into BigQuery using MERGE statement.

    V4 FIX: Added payout_date field to schema and insert.
    """
    if not records:
        logger.info("No records to upsert")
        return 0

    if dry_run:
        logger.info(f"[DRY RUN] Would upsert {len(records)} records:")
        for r in records[:5]:
            logger.info(
                f"  AWB={r['awb']} | POS={r['pos_order_id']} | "
                f"Cost={r['price_incl_vat']:.2f} EUR | Status={r['status']} | "
                f"Return={r['is_return_shipment']}"
            )
        if len(records) > 5:
            logger.info(f"  ... and {len(records) - 5} more")
        return len(records)

    # Build temp table and MERGE
    gcp_project = bq_table.split(".")[0]
    bq_dataset = bq_table.split(".")[1]
    temp_table_id = f"{gcp_project}.{bq_dataset}._ffm_sync_staging"

    schema = [
        bigquery.SchemaField("awb", "STRING"),
        bigquery.SchemaField("ref_number", "STRING"),
        bigquery.SchemaField("pos_order_id", "STRING"),
        bigquery.SchemaField("ffm_partner", "STRING"),
        bigquery.SchemaField("client_id", "STRING"),
        bigquery.SchemaField("status", "STRING"),
        bigquery.SchemaField("price_excl_vat", "FLOAT64"),
        bigquery.SchemaField("price_incl_vat", "FLOAT64"),
        bigquery.SchemaField("vat_rate", "FLOAT64"),
        bigquery.SchemaField("currency", "STRING"),
        bigquery.SchemaField("is_return_shipment", "BOOLEAN"),
        bigquery.SchemaField("original_order_id", "STRING"),
        bigquery.SchemaField("cod_amount", "FLOAT64"),
        bigquery.SchemaField("payout_date", "TIMESTAMP"),
        bigquery.SchemaField("payout_number", "STRING"),
        bigquery.SchemaField("created_date", "TIMESTAMP"),
        bigquery.SchemaField("delivered_date", "TIMESTAMP"),
        bigquery.SchemaField("returned_date", "TIMESTAMP"),
        bigquery.SchemaField("raw_response", "STRING"),
        bigquery.SchemaField("synced_at", "TIMESTAMP"),
        bigquery.SchemaField("sync_source", "STRING"),
    ]

    now = datetime.now(timezone.utc).isoformat()
    rows_to_insert = []
    for r in records:
        row = {
            "awb": r["awb"],
            "ref_number": r.get("ref_number"),
            "pos_order_id": r.get("pos_order_id"),
            "ffm_partner": r.get("ffm_partner", "euShipments"),
            "client_id": r.get("client_id"),
            "status": r.get("status"),
            "price_excl_vat": r.get("price_excl_vat"),
            "price_incl_vat": r.get("price_incl_vat"),
            "vat_rate": r.get("vat_rate", 0.20),
            "currency": r.get("currency", "EUR"),
            "is_return_shipment": r.get("is_return_shipment", False),
            "original_order_id": r.get("original_order_id"),
            "cod_amount": r.get("cod_amount"),
            "payout_date": r.get("payout_date"),
            "payout_number": r.get("payout_number"),
            "created_date": r.get("created_date"),
            "delivered_date": r.get("delivered_date"),
            "returned_date": r.get("returned_date"),
            "raw_response": r.get("raw_response"),
            "synced_at": now,
            "sync_source": "api",
        }
        rows_to_insert.append(row)

    job_config = bigquery.LoadJobConfig(
        schema=schema,
        write_disposition="WRITE_TRUNCATE",
    )

    try:
        job = bq_client.load_table_from_json(
            rows_to_insert, temp_table_id, job_config=job_config
        )
        job.result()
        logger.info(f"Loaded {len(rows_to_insert)} rows to staging table")

        merge_sql = f"""
            MERGE `{bq_table}` AS target
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
                payout_date = source.payout_date,
                payout_number = source.payout_number,
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
                payout_date, payout_number, created_date, delivered_date, returned_date,
                raw_response, synced_at, sync_source
            ) VALUES (
                source.awb, source.ref_number, source.pos_order_id,
                source.ffm_partner, source.client_id,
                source.status, source.price_excl_vat, source.price_incl_vat,
                source.vat_rate, source.currency,
                source.is_return_shipment, source.original_order_id,
                source.cod_amount, source.payout_date, source.payout_number,
                source.created_date, source.delivered_date,
                source.returned_date,
                source.raw_response, source.synced_at, source.sync_source
            )
        """
        bq_client.query(merge_sql).result()
        logger.info(f"✓ Merged {len(rows_to_insert)} records into {bq_table}")

        bq_client.delete_table(temp_table_id, not_found_ok=True)
        return len(rows_to_insert)

    except Exception as e:
        logger.error(f"Upsert error: {e}")
        bq_client.delete_table(temp_table_id, not_found_ok=True)
        return 0
