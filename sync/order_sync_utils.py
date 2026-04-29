"""
Shared utilities for incremental order sync across all projects.
Strategy: Smart Stop + DELETE-by-ID + APPEND (replaces WRITE_TRUNCATE).

Usage in project sync scripts:
    from sync.order_sync_utils import get_last_sync_ts, upsert_orders, should_stop_fetching
"""
import io, json, logging

log = logging.getLogger(__name__)


def get_last_sync_ts(client, project_id, dataset, table='sale_order'):
    """Query BQ for MAX(updated_at) — used as stop condition for incremental fetch.
    Returns ISO timestamp string or None if table is empty/missing."""
    try:
        q = f"SELECT MAX(updated_at) as last_ts FROM `{project_id}.{dataset}.{table}`"
        rows = list(client.query(q).result())
        ts = rows[0].last_ts if rows else None
        if ts:
            log.info(f"  Last sync timestamp: {ts}")
        else:
            log.info(f"  No existing data — will do full fetch")
        return ts
    except Exception as e:
        log.info(f"  Could not get last sync ts ({e}) — full fetch")
        return None


def should_stop_fetching(orders, last_sync_ts):
    """Check if ALL orders on this page are older than last sync.
    Orders are sorted newest-first by POS API.
    Returns True if we can stop fetching (all orders already synced)."""
    if not last_sync_ts or not orders:
        return False
    # All orders on this page have updated_at <= last_sync_ts
    for o in orders:
        updated = o.get('updated_at', '')
        if updated > last_sync_ts:
            return False  # At least one newer order — keep fetching
    return True


def upsert_orders(client, project_id, dataset, all_orders, all_items, order_schema, item_schema):
    """DELETE existing rows by ID, then APPEND new rows (upsert pattern).
    This replaces WRITE_TRUNCATE and preserves historical data.
    
    Args:
        client: BigQuery client
        project_id: BQ project ID
        dataset: BQ dataset name
        all_orders: list of order dicts
        all_items: list of item dicts
        order_schema: list of bigquery.SchemaField for sale_order
        item_schema: list of bigquery.SchemaField for order_items
    """
    from google.cloud import bigquery

    if not all_orders:
        log.info("  No orders to upsert")
        return

    # 1. Delete existing orders by ID
    order_ids = list(set(str(o['id']) for o in all_orders))
    # BQ IN clause has a limit of ~10000 items, batch if needed
    batch_size = 5000
    for i in range(0, len(order_ids), batch_size):
        batch = order_ids[i:i + batch_size]
        ids_str = ','.join(f"'{oid}'" for oid in batch)
        
        # Delete from sale_order
        try:
            q1 = f"DELETE FROM `{project_id}.{dataset}.sale_order` WHERE id IN ({ids_str})"
            job1 = client.query(q1)
            job1.result()
            log.info(f"  Deleted {job1.num_dml_affected_rows} existing orders (batch {i//batch_size + 1})")
        except Exception as e:
            log.warning(f"  Delete sale_order batch failed (table may not exist): {e}")

        # Delete from order_items
        try:
            q2 = f"DELETE FROM `{project_id}.{dataset}.order_items` WHERE order_id IN ({ids_str})"
            job2 = client.query(q2)
            job2.result()
            log.info(f"  Deleted {job2.num_dml_affected_rows} existing items (batch {i//batch_size + 1})")
        except Exception as e:
            log.warning(f"  Delete order_items batch failed: {e}")

    # 2. Append new orders
    ndjson = '\n'.join(json.dumps(r, ensure_ascii=False) for r in all_orders)
    job = client.load_table_from_file(
        io.BytesIO(ndjson.encode('utf-8')),
        f'{project_id}.{dataset}.sale_order',
        job_config=bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
            schema=order_schema))
    job.result()
    log.info(f"  sale_order: {len(all_orders)} rows UPSERTED")

    # 3. Append new items
    if all_items:
        ndjson2 = '\n'.join(json.dumps(r, ensure_ascii=False) for r in all_items)
        job2 = client.load_table_from_file(
            io.BytesIO(ndjson2.encode('utf-8')),
            f'{project_id}.{dataset}.order_items',
            job_config=bigquery.LoadJobConfig(
                source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
                write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
                schema=item_schema))
        job2.result()
        log.info(f"  order_items: {len(all_items)} rows UPSERTED")
