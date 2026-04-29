"""
STRAMARK Full Sync — N8N-Free Edition
Replaces all N8N workflows with Python:
  [STR] 01 Order Sync      → fetch_all_orders() + upload_to_bq()
  [STR] 02 Ads Sync         → sync_fb_ads()
  [STR] 03 Merge & Dedup    → run_merge_dedup()
  + Product COGS, Stock, Discord notifications

Usage:
  python stramark_sync.py           # Full sync
  python stramark_sync.py --ads     # Ads only
  python stramark_sync.py --orders  # Orders only
  python stramark_sync.py --test    # Dry run
"""
import os, sys, json, io, time, logging, argparse
from datetime import datetime, timedelta

# Setup
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.path.join(PROJECT_DIR, 'bigquery_key.json')
sys.stdout.reconfigure(encoding='utf-8')

# Load .env
from dotenv import load_dotenv
load_dotenv(os.path.join(PROJECT_DIR, '.env'))

import requests
from google.cloud import bigquery

sys.path.insert(0, str(PROJECT_DIR))
from sync.order_sync_utils import get_last_sync_ts, should_stop_fetching, upsert_orders

# Config
API_URL = "https://pos.pages.fm/api/v1"
API_KEY = os.environ.get("POSCAKE_API_KEY", "")
SHOP_ID = os.environ.get("POSCAKE_SHOP_ID", "1635307570")
P = 'levelup-465304'
DS = 'STRAMARK_Dataset'

# Logging
log_file = os.path.join(PROJECT_DIR, 'logs', f'stramark_sync_{datetime.now().strftime("%Y%m%d_%H%M")}.log')
os.makedirs(os.path.dirname(log_file), exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(log_file, encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
log = logging.getLogger('stramark_sync')

client = bigquery.Client(project=P)
sync_time = datetime.utcnow().isoformat()

# ═══ STATUS MAPPING (from stramark.yaml SOP) ═══
# POS status_name → (category, sub)
STATUS_CATEGORY_MAP = {
    'delivered':      ('GIAO_THANH_CONG', 'da_nhan'),
    'received_money': ('GIAO_THANH_CONG', 'da_thu_tien'),
    'packing':        ('DANG_GIAO',       'dang_dong_hang'),
    'pending':        ('DANG_GIAO',       'cho_chuyen_hang'),
    'shipped':        ('DANG_GIAO',       'da_gui_hang'),
    'returning':      ('DON_HOAN',        'dang_hoan'),
    'returned':       ('DON_HOAN',        'da_hoan'),
    'canceled':       ('HUY',             'da_huy'),
    # 'removed' = POS status code 7 (đơn bị xoá) — observed in backfill 2026-04-08
    'removed':        ('HUY',             'da_xoa'),
    'new':            ('DON_THO',         'moi'),
    'submitted':      ('DA_XAC_NHAN',     'da_xac_nhan'),
    'waitting':       ('CHO_HANG',        'cho_hang'),
    'ordered':        ('DA_DAT_HANG',     'da_dat_hang'),
}


# Status names that are NOT terminal — these orders may still change in POS
# and must be refreshed by pass-2 (refresh_non_terminal_orders).
# Terminal statuses (won't change): delivered, received_money, returned, canceled
NON_TERMINAL_STATUSES = (
    'new', 'submitted', 'waitting', 'ordered',
    'pending', 'packing', 'shipped', 'returning',
)


def _parse_order(o):
    """Convert one POS API order dict → (order_row, item_rows) ready for BQ.

    Extracted from fetch_all_orders so it can be reused by:
      - fetch_all_orders (pass-1, list endpoint)
      - refresh_non_terminal_orders (pass-2, single-order endpoint)
    """
    marketer_raw = o.get('marketer')
    if isinstance(marketer_raw, dict):
        marketer_str = json.dumps(marketer_raw, ensure_ascii=False)
    else:
        marketer_str = str(marketer_raw or '')

    order_row = {
        'id': str(o.get('id', '')),
        'shop_id': str(o.get('shop_id', SHOP_ID)),
        'status': str(o.get('status', 0)),
        'status_name': str(o.get('status_name', '')),
        'total_price': float(o.get('total_price', 0) or 0),
        'shipping_fee': float(o.get('shipping_fee', 0) or 0),
        'cod': float(o.get('cod', 0) or 0),
        'total_discount': float(o.get('total_discount', 0) or 0),
        'partner_fee': float(o.get('partner_fee', 0) or 0),
        'return_fee': float(o.get('return_fee', 0) or 0),
        'surcharge': float(o.get('surcharge', 0) or 0),
        'money_to_collect': float(o.get('money_to_collect', 0) or 0),
        'total_quantity': str(o.get('total_quantity', 0) or 0),
        'marketer': marketer_str,
        'ad_id': str(o.get('ad_id', '') or ''),
        'adset_id': str(o.get('adset_id', '') or ''),
        'ads_source': str(o.get('ads_source', '') or ''),
        'page_id': str(o.get('page_id', '') or ''),
        'post_id': str(o.get('post_id', '') or ''),
        'p_utm_source': str(o.get('p_utm_source', '') or ''),
        'p_utm_campaign': str(o.get('p_utm_campaign', '') or ''),
        'p_utm_medium': str(o.get('p_utm_medium', '') or ''),
        'p_utm_content': str(o.get('p_utm_content', '') or ''),
        'p_utm_term': str(o.get('p_utm_term', '') or ''),
        'p_utm_id': str(o.get('p_utm_id', '') or ''),
        'order_currency': str(o.get('order_currency', 'RON')),
        'customer_id': str((o.get('customer') or {}).get('id', '')),
        'customer_name': str((o.get('customer') or {}).get('name', '')),
        'bill_full_name': str(o.get('bill_full_name', '') or ''),
        'bill_phone_number': str(o.get('bill_phone_number', '') or ''),
        'shipping_address': str((o.get('shipping_address') or {}).get('full_address', '') or ''),
        'shipping_province': str((o.get('shipping_address') or {}).get('province_name', '') or ''),
        'shipping_district': str((o.get('shipping_address') or {}).get('district_name', '') or ''),
        'partner': str(o.get('partner', '') or ''),
        'warehouse_id': str(o.get('warehouse_id', '') or ''),
        'tracking_link': str(o.get('tracking_link', '') or ''),
        'inserted_at': str(o.get('inserted_at', '') or ''),
        'updated_at': str(o.get('updated_at', '') or ''),
        'time_send_partner': str(o.get('time_send_partner', '') or ''),
        'estimate_delivery_date': str(o.get('estimate_delivery_date', '') or ''),
        'note': str(o.get('note', '') or ''),
        'tags': str(o.get('tags', '') or ''),
        'order_link': str(o.get('order_link', '') or ''),
        'sync_time': sync_time,
        'status_category': STATUS_CATEGORY_MAP.get(str(o.get('status_name', '')), ('UNKNOWN', 'unknown'))[0],
        'status_sub': STATUS_CATEGORY_MAP.get(str(o.get('status_name', '')), ('UNKNOWN', 'unknown'))[1],
    }

    item_rows = []
    for item in (o.get('items', []) or []):
        item_rows.append({
            'item_id': str(item.get('id', '')),
            'order_id': str(o.get('id', '')),
            'shop_id': str(o.get('shop_id', SHOP_ID)),
            'shop_name': str(o.get('shop_name', '')),
            'project_id': 'stramark',
            'product_id': str(item.get('product_id', '')),
            'variation_id': str(item.get('variation_id', '')),
            'product_name': str(item.get('product_name', '') or ''),
            'variation_name': str(item.get('variation_name', '') or ''),
            'barcode': str(item.get('barcode', '') or ''),
            'quantity': int(item.get('quantity', 0) or 0),
            'return_quantity': int(item.get('return_quantity', 0) or 0),
            'returned_count': int(item.get('returned_count', 0) or 0),
            'returning_quantity': int(item.get('returning_quantity', 0) or 0),
            'retail_price': float(item.get('retail_price', 0) or 0),
            'discount_each_product': float(item.get('discount_each_product', 0) or 0),
            'total_discount': float(item.get('total_discount', 0) or 0),
            'same_price_discount': float(item.get('same_price_discount', 0) or 0),
            'avg_imported_price': float(item.get('avg_imported_price', 0) or 0),
            'is_bonus_product': str(item.get('is_bonus_product', 'false')),
            'is_composite': str(item.get('is_composite', 'false')),
            'is_wholesale': str(item.get('is_wholesale', 'false')),
            'order_inserted_at': str(o.get('inserted_at', '') or ''),
            'sync_time': sync_time,
        })

    return order_row, item_rows


def fetch_all_orders(last_sync_ts=None):
    """Fetch orders from Poscake API (10 per page). Smart Stop with incremental.

    NOTE: Smart Stop only catches NEW orders / NEW updates. It cannot catch
    delayed status updates on older pages because POS sorts by id, not
    updated_at. See refresh_non_terminal_orders() for the pass-2 fix.
    """
    all_orders = []
    all_items = []
    page = 1

    while True:
        try:
            resp = requests.get(
                f"{API_URL}/shops/{SHOP_ID}/orders",
                params={"api_key": API_KEY, "page": page, "per_page": 10},
                timeout=30
            )
            data = resp.json()
        except Exception as e:
            log.error(f"Fetch page {page} failed: {e}")
            break

        orders = data.get('data', [])
        if not orders:
            break
        if should_stop_fetching(orders, last_sync_ts):
            log.info(f"  Smart Stop at page {page}: all orders older than last sync")
            break

        for o in orders:
            order_row, item_rows = _parse_order(o)
            all_orders.append(order_row)
            all_items.extend(item_rows)

        if page % 50 == 0:
            log.info(f"Page {page}: {len(all_orders)} orders, {len(all_items)} items")

        if len(orders) < 10:
            break
        page += 1
        time.sleep(0.3)

    return all_orders, all_items


def fetch_orders_by_ids(order_ids):
    """Pass-2: re-fetch specific orders by ID via single-order endpoint.

    Used by refresh_non_terminal_orders() to fix the Smart Stop bug where
    delayed status updates on older orders are missed because POS sorts the
    list endpoint by id (not updated_at), causing should_stop_fetching to
    bail out on the wrong page.

    Returns (order_rows, item_rows) — same shape as fetch_all_orders.
    """
    all_orders = []
    all_items = []
    fetched = 0
    not_found = 0

    for oid in order_ids:
        try:
            resp = requests.get(
                f"{API_URL}/shops/{SHOP_ID}/orders/{oid}",
                params={"api_key": API_KEY},
                timeout=30,
            )
            if resp.status_code == 404:
                not_found += 1
                continue
            d = resp.json()
        except Exception as e:
            log.warning(f"  Re-fetch order {oid} failed: {e}")
            continue

        if not d.get('success', True):
            not_found += 1
            continue

        o = d.get('data') or d
        if not o or not o.get('id'):
            not_found += 1
            continue

        order_row, item_rows = _parse_order(o)
        all_orders.append(order_row)
        all_items.extend(item_rows)
        fetched += 1

        if fetched % 25 == 0:
            log.info(f"  Re-fetched {fetched}/{len(order_ids)} orders")

        time.sleep(0.15)  # gentle on POS API

    log.info(f"  Re-fetched {fetched} orders, {not_found} not found / failed (of {len(order_ids)} requested)")
    return all_orders, all_items


def get_non_terminal_order_ids(days_back=30):
    """Query BQ for IDs of orders still in non-terminal status within last N days.

    These are the orders Smart Stop is missing — POS may have updated their
    status, but our list-endpoint scan stopped before reaching them.
    """
    statuses_sql = ', '.join(f"'{s}'" for s in NON_TERMINAL_STATUSES)
    q = f"""
        SELECT id
        FROM `{P}.{DS}.sale_order`
        WHERE status_name IN ({statuses_sql})
          AND DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at))
              >= DATE_SUB(CURRENT_DATE(), INTERVAL {days_back} DAY)
        ORDER BY CAST(id AS INT64) DESC
    """
    try:
        rows = list(client.query(q).result())
        ids = [str(r.id) for r in rows]
        log.info(f"  Found {len(ids)} non-terminal orders in last {days_back} days")
        return ids
    except Exception as e:
        log.error(f"  get_non_terminal_order_ids failed: {e}")
        return []


def get_order_ids_by_date_range(since_date, until_date=None):
    """Backfill helper: return all order IDs created between two dates.

    Used for one-time --backfill runs to fix historical data poisoned by
    the Smart Stop bug. until_date defaults to today.
    """
    if until_date is None:
        until_date = datetime.utcnow().strftime('%Y-%m-%d')
    q = f"""
        SELECT id
        FROM `{P}.{DS}.sale_order`
        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at))
              BETWEEN '{since_date}' AND '{until_date}'
        ORDER BY CAST(id AS INT64) DESC
    """
    try:
        rows = list(client.query(q).result())
        ids = [str(r.id) for r in rows]
        log.info(f"  Found {len(ids)} orders inserted between {since_date} and {until_date}")
        return ids
    except Exception as e:
        log.error(f"  get_order_ids_by_date_range failed: {e}")
        return []


def refresh_non_terminal_orders(days_back=30, dry_run=False):
    """Pass-2 sync: re-fetch every non-terminal order in last N days by ID.

    Fixes the Smart Stop bug in fetch_all_orders where POS list endpoint is
    sorted by id (not updated_at), so delayed status updates on older orders
    are missed.
    """
    log.info(f"\n[Pass-2] Refreshing non-terminal orders (last {days_back} days)...")
    ids = get_non_terminal_order_ids(days_back=days_back)
    if not ids:
        log.info("  No non-terminal orders to refresh")
        return {'refreshed': 0, 'requested': 0}

    if dry_run:
        log.info(f"  DRY-RUN: would refresh {len(ids)} orders (first 5: {ids[:5]})")
        return {'refreshed': 0, 'requested': len(ids), 'dry_run': True}

    orders, items = fetch_orders_by_ids(ids)
    if orders:
        upsert_orders(client, P, DS, orders, items, ORDER_SCHEMA, ITEM_SCHEMA)
        log.info(f"  Pass-2 upserted {len(orders)} orders, {len(items)} items")

    return {'refreshed': len(orders), 'requested': len(ids), 'items': len(items)}


def backfill_orders(since_date, until_date=None, dry_run=False):
    """One-time backfill: re-fetch every order in date range, regardless of status.

    Use this once to fix historical data poisoned by the Smart Stop bug
    (e.g. orders that have been delivered for days but BQ still shows pending).
    """
    log.info(f"\n[Backfill] Re-fetching orders from {since_date} to {until_date or 'today'}...")
    ids = get_order_ids_by_date_range(since_date, until_date)
    if not ids:
        log.info("  No orders in date range")
        return {'refreshed': 0, 'requested': 0}

    if dry_run:
        log.info(f"  DRY-RUN: would refresh {len(ids)} orders (first 5: {ids[:5]})")
        return {'refreshed': 0, 'requested': len(ids), 'dry_run': True}

    orders, items = fetch_orders_by_ids(ids)
    if orders:
        upsert_orders(client, P, DS, orders, items, ORDER_SCHEMA, ITEM_SCHEMA)
        log.info(f"  Backfill upserted {len(orders)} orders, {len(items)} items")

    return {'refreshed': len(orders), 'requested': len(ids), 'items': len(items)}


# ═══ POS API FIELD MAPPING (Poscake / Pancake) ═══
# CRITICAL: Poscake uses DIFFERENT field names than expected!
# Cost/Price:   variant.average_imported_price (NOT imported_price, NOT avg_imported_price)
# Stock:        variant.variations_warehouses[].actual_remain_quantity (NOT stock_quantity)
# All prices:   In bani (RON × 100). Divide by 100 for RON.
# ═══════════════════════════════════════════════════


def fetch_product_cogs():
    """Fetch product cost prices from Product API.
    
    POS field: variant.average_imported_price (in bani = RON × 100)
    NOT: imported_price, avg_imported_price, cost_price (these are 0 or missing)
    """
    cogs_map = {}  # variation_id -> cost in bani
    page = 1
    
    while True:
        try:
            resp = requests.get(
                f"{API_URL}/shops/{SHOP_ID}/products",
                params={"api_key": API_KEY, "page": page, "per_page": 50},
                timeout=30
            )
            data = resp.json()
        except Exception as e:
            log.error(f"Product API page {page}: {e}")
            break
        
        products = data.get('data', [])
        if not products:
            break
        
        for p in products:
            variants = p.get('variants') or p.get('variations') or []
            for v in variants:
                vid = str(v.get('id', ''))
                # CORRECT field: average_imported_price (bani)
                vcost = float(v.get('average_imported_price') or v.get('last_imported_price') or 0)
                if vcost > 0:
                    cogs_map[vid] = vcost
        
        if len(products) < 50:
            break
        page += 1
        time.sleep(0.3)
    
    log.info(f"Product COGS: {len(cogs_map)} variations with cost data")
    return cogs_map


def sync_product_stock():
    """Sync product stock from POS -> BigQuery product_stock table.
    
    POS field: variant.variations_warehouses[].actual_remain_quantity
    NOT: stock_quantity (always None)
    """
    all_stock = []
    page = 1
    
    while True:
        try:
            resp = requests.get(
                f"{API_URL}/shops/{SHOP_ID}/products",
                params={"api_key": API_KEY, "page": page, "per_page": 50},
                timeout=30
            )
            data = resp.json()
        except Exception as e:
            log.error(f"Stock sync page {page}: {e}")
            break
        
        products = data.get('data', [])
        if not products:
            break
        
        for p in products:
            pid = str(p.get('id', ''))
            pname = str(p.get('name', ''))
            pcode = str(p.get('custom_id', '') or '')
            variants = p.get('variants') or p.get('variations') or []
            for v in variants:
                vid = str(v.get('id', ''))
                vname = str(v.get('display_id', '') or v.get('name', '') or '')
                retail = float(v.get('retail_price', 0) or 0)
                avg_cost = float(v.get('average_imported_price', 0) or 0)
                
                # CORRECT field: variations_warehouses[].actual_remain_quantity
                total_qty = 0
                total_pending = 0
                total_returning = 0
                pos_selling_avg = 0.0
                for wh in (v.get('variations_warehouses') or []):
                    total_qty += int(wh.get('actual_remain_quantity', 0) or 0)
                    total_pending += int(wh.get('pending_quantity', 0) or 0)
                    total_returning += int(wh.get('returning_quantity', 0) or 0)
                    pos_selling_avg += float(wh.get('selling_avg', 0) or 0)

                all_stock.append({
                    'product_id': pid, 'variation_id': vid,
                    'product_code': pcode, 'product_name': pname,
                    'variation_name': vname,
                    'quantity_on_hand': total_qty,
                    'pending_quantity': total_pending,
                    'returning_quantity': total_returning,
                    'selling_avg': round(pos_selling_avg, 2),
                    'retail_price': round(retail / 100, 2),
                    'avg_cost': round(avg_cost / 100, 2),
                    'stock_value': round(total_qty * avg_cost / 100, 2),
                    'status': 'in_stock' if total_qty > 0 else 'out_of_stock',
                    'warehouse_count': len(v.get('variations_warehouses') or []),
                    'sync_time': sync_time,
                })
        
        if len(products) < 50:
            break
        page += 1
        time.sleep(0.3)
    
    if not all_stock:
        log.warning("No stock data to sync")
        return
    
    # Upload to BigQuery
    ndjson = '\n'.join(json.dumps(r, ensure_ascii=False) for r in all_stock)
    job_config = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        schema=[
            bigquery.SchemaField('product_id', 'STRING'),
            bigquery.SchemaField('variation_id', 'STRING'),
            bigquery.SchemaField('product_code', 'STRING'),
            bigquery.SchemaField('product_name', 'STRING'),
            bigquery.SchemaField('variation_name', 'STRING'),
            bigquery.SchemaField('quantity_on_hand', 'INT64'),
            bigquery.SchemaField('pending_quantity', 'INT64'),
            bigquery.SchemaField('returning_quantity', 'INT64'),
            bigquery.SchemaField('selling_avg', 'FLOAT64'),
            bigquery.SchemaField('retail_price', 'FLOAT64'),
            bigquery.SchemaField('avg_cost', 'FLOAT64'),
            bigquery.SchemaField('stock_value', 'FLOAT64'),
            bigquery.SchemaField('status', 'STRING'),
            bigquery.SchemaField('warehouse_count', 'INT64'),
            bigquery.SchemaField('sync_time', 'STRING'),
        ]
    )
    load_job = client.load_table_from_file(
        io.BytesIO(ndjson.encode('utf-8')),
        f'{P}.{DS}.product_stock',
        job_config=job_config
    )
    load_job.result()
    
    in_stock = sum(1 for s in all_stock if s['quantity_on_hand'] > 0)
    total_qty = sum(s['quantity_on_hand'] for s in all_stock)
    log.info(f"Stock synced: {len(all_stock)} variants, {in_stock} in stock, {total_qty} total units")


def sync_product_cogs_table(cogs_map):
    """Upload product_cogs table to BigQuery from cogs_map."""
    if not cogs_map:
        return
    
    rows = []
    for vid, cost_raw in cogs_map.items():
        rows.append({
            'variation_id': vid,
            'cost_raw': cost_raw,
            'cost_ron': round(cost_raw / 100, 2),
            'source': 'pos_api',
            'sync_time': sync_time,
        })
    
    ndjson = '\n'.join(json.dumps(r) for r in rows)
    job_config = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        schema=[
            bigquery.SchemaField('variation_id', 'STRING'),
            bigquery.SchemaField('cost_raw', 'FLOAT64'),
            bigquery.SchemaField('cost_ron', 'FLOAT64'),
            bigquery.SchemaField('source', 'STRING'),
            bigquery.SchemaField('sync_time', 'STRING'),
        ]
    )
    load_job = client.load_table_from_file(
        io.BytesIO(ndjson.encode('utf-8')),
        f'{P}.{DS}.product_cogs',
        job_config=job_config
    )
    load_job.result()
    log.info(f"product_cogs synced: {len(rows)} variations with cost data")


ORDER_SCHEMA = [
    bigquery.SchemaField('id', 'STRING'), bigquery.SchemaField('shop_id', 'STRING'),
    bigquery.SchemaField('status', 'STRING'), bigquery.SchemaField('status_name', 'STRING'),
    bigquery.SchemaField('total_price', 'FLOAT64'), bigquery.SchemaField('shipping_fee', 'FLOAT64'),
    bigquery.SchemaField('cod', 'FLOAT64'), bigquery.SchemaField('total_discount', 'FLOAT64'),
    bigquery.SchemaField('partner_fee', 'FLOAT64'), bigquery.SchemaField('return_fee', 'FLOAT64'),
    bigquery.SchemaField('surcharge', 'FLOAT64'), bigquery.SchemaField('money_to_collect', 'FLOAT64'),
    bigquery.SchemaField('total_quantity', 'STRING'), bigquery.SchemaField('marketer', 'STRING'),
    bigquery.SchemaField('ad_id', 'STRING'), bigquery.SchemaField('adset_id', 'STRING'),
    bigquery.SchemaField('ads_source', 'STRING'), bigquery.SchemaField('page_id', 'STRING'),
    bigquery.SchemaField('post_id', 'STRING'), bigquery.SchemaField('p_utm_source', 'STRING'),
    bigquery.SchemaField('p_utm_campaign', 'STRING'), bigquery.SchemaField('p_utm_medium', 'STRING'),
    bigquery.SchemaField('p_utm_content', 'STRING'), bigquery.SchemaField('p_utm_term', 'STRING'),
    bigquery.SchemaField('p_utm_id', 'STRING'), bigquery.SchemaField('order_currency', 'STRING'),
    bigquery.SchemaField('customer_id', 'STRING'), bigquery.SchemaField('customer_name', 'STRING'),
    bigquery.SchemaField('bill_full_name', 'STRING'), bigquery.SchemaField('bill_phone_number', 'STRING'),
    bigquery.SchemaField('shipping_address', 'STRING'), bigquery.SchemaField('shipping_province', 'STRING'),
    bigquery.SchemaField('shipping_district', 'STRING'), bigquery.SchemaField('partner', 'STRING'),
    bigquery.SchemaField('warehouse_id', 'STRING'), bigquery.SchemaField('tracking_link', 'STRING'),
    bigquery.SchemaField('inserted_at', 'STRING'), bigquery.SchemaField('updated_at', 'STRING'),
    bigquery.SchemaField('time_send_partner', 'STRING'), bigquery.SchemaField('estimate_delivery_date', 'STRING'),
    bigquery.SchemaField('note', 'STRING'), bigquery.SchemaField('tags', 'STRING'),
    bigquery.SchemaField('order_link', 'STRING'), bigquery.SchemaField('sync_time', 'STRING'),
    bigquery.SchemaField('status_category', 'STRING'), bigquery.SchemaField('status_sub', 'STRING'),
]
ITEM_SCHEMA = [
    bigquery.SchemaField('item_id', 'STRING'), bigquery.SchemaField('order_id', 'STRING'),
    bigquery.SchemaField('shop_id', 'STRING'), bigquery.SchemaField('shop_name', 'STRING'),
    bigquery.SchemaField('project_id', 'STRING'), bigquery.SchemaField('product_id', 'STRING'),
    bigquery.SchemaField('variation_id', 'STRING'), bigquery.SchemaField('product_name', 'STRING'),
    bigquery.SchemaField('variation_name', 'STRING'), bigquery.SchemaField('barcode', 'STRING'),
    bigquery.SchemaField('quantity', 'INT64'), bigquery.SchemaField('return_quantity', 'INT64'),
    bigquery.SchemaField('returned_count', 'INT64'), bigquery.SchemaField('returning_quantity', 'INT64'),
    bigquery.SchemaField('retail_price', 'FLOAT64'), bigquery.SchemaField('discount_each_product', 'FLOAT64'),
    bigquery.SchemaField('total_discount', 'FLOAT64'), bigquery.SchemaField('same_price_discount', 'FLOAT64'),
    bigquery.SchemaField('avg_imported_price', 'FLOAT64'), bigquery.SchemaField('is_bonus_product', 'STRING'),
    bigquery.SchemaField('is_composite', 'STRING'), bigquery.SchemaField('is_wholesale', 'STRING'),
    bigquery.SchemaField('order_inserted_at', 'STRING'), bigquery.SchemaField('sync_time', 'STRING'),
]


# ═══════════════════════════════════════════════════════════
# NEW: FB ADS SYNC (replaces [STR] 02 Ads Sync N8N workflow)
# ═══════════════════════════════════════════════════════════

# Dynamic config — reads from config/ad_accounts.json
import sys as _sys
_sys.path.insert(0, str(PROJECT_DIR))
from sync.config_loader import get_active_account_ids, get_access_token

FB_TOKEN = get_access_token('stramark') or os.environ.get('META_ACCESS_TOKEN', '')
FB_AD_ACCOUNTS = get_active_account_ids('stramark') or ['act_817501334775697', 'act_1369010934859968', 'act_1528285295107514']
FB_API_VERSION = 'v21.0'

def delete_date_range(table_name, since, until, account_id=None):
    """Delete rows in date range before re-inserting (MERGE strategy).

    If account_id is provided, only delete that account's data (safe per-account sync).
    """
    if account_id:
        q = f"DELETE FROM `{P}.{DS}.{table_name}` WHERE date >= '{since}' AND date <= '{until}' AND account_id = '{account_id}'"
    else:
        q = f"DELETE FROM `{P}.{DS}.{table_name}` WHERE date >= '{since}' AND date <= '{until}'"
    try:
        job = client.query(q)
        job.result()
        acct_label = f" (account {account_id})" if account_id else ""
        log.info(f"  Deleted {table_name} rows for {since} → {until}{acct_label} ({job.num_dml_affected_rows} rows)")
    except Exception as e:
        log.warning(f"  Delete {table_name} failed (table may not exist yet): {e}")


def sync_fb_ads(days_back=1):
    """Sync Facebook Ads data → BigQuery fb_ads_data + fb_adset_data.
    
    Strategy: DELETE date range + APPEND (preserves historical data).
    Source: graph.facebook.com/v21.0/{account}/insights
    """
    if not FB_TOKEN:
        log.error("META_ACCESS_TOKEN not set in .env!")
        return 0, 0
    
    today = datetime.utcnow().strftime('%Y-%m-%d')
    since = (datetime.utcnow() - timedelta(days=days_back)).strftime('%Y-%m-%d')
    time_range = json.dumps({'since': since, 'until': today})
    
    all_ads = []
    all_adsets = []
    # Track per-account results: only DELETE data for accounts that returned data
    acct_ads_ok = {}    # {acct_short: [rows]} — accounts with successful ad fetch
    acct_adsets_ok = {} # {acct_short: [rows]} — accounts with successful adset fetch
    failed_accounts = []

    for account_id in FB_AD_ACCOUNTS:
        log.info(f"  Fetching ads for {account_id} ({since} → {today})...")
        acct_short = account_id.replace('act_', '')
        
        # ── Ad-level insights ──
        try:
            resp = requests.get(
                f'https://graph.facebook.com/{FB_API_VERSION}/{account_id}/insights',
                params={
                    'level': 'ad',
                    'fields': 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,clicks,actions,cpm,ctr,cpc,frequency,cost_per_action_type',
                    'time_range': time_range,
                    'time_increment': '1',
                    'access_token': FB_TOKEN,
                    'limit': '500',
                },
                timeout=60
            )
            data = resp.json()
            
            if 'error' in data:
                log.error(f"  FB API error: {data['error'].get('message', '')}")
                failed_accounts.append(acct_short)
                log.warning(f"    ⚠ Account {acct_short} ads failed — existing BQ data will be PRESERVED")
                continue
            
            rows = data.get('data', [])
            # Handle pagination
            while 'paging' in data and 'next' in data['paging']:
                resp = requests.get(data['paging']['next'], timeout=60)
                data = resp.json()
                rows.extend(data.get('data', []))
            
            for r in rows:
                # Extract action metrics from actions array
                purchases = 0
                leads = 0
                messages = 0
                add_to_cart = 0
                if r.get('actions'):
                    for a in r['actions']:
                        at = a.get('action_type', '')
                        val = int(a.get('value', 0))
                        if at == 'purchase':
                            purchases = val
                        elif at == 'lead':
                            leads = val
                        elif at == 'onsite_conversion.messaging_conversation_started_7d':
                            messages = val
                        elif at == 'add_to_cart':
                            add_to_cart = val
                
                all_ads.append({
                    'ad_id': str(r.get('ad_id', '')),
                    'ad_name': str(r.get('ad_name', '')),
                    'adset_id': str(r.get('adset_id', '')),
                    'adset_name': str(r.get('adset_name', '')),
                    'campaign_id': str(r.get('campaign_id', '')),
                    'campaign_name': str(r.get('campaign_name', '')),
                    'spend': float(r.get('spend', 0)),
                    'impressions': int(r.get('impressions', 0)),
                    'reach': int(r.get('reach', 0)),
                    'clicks': int(r.get('clicks', 0)),
                    'purchases': purchases,
                    'leads': leads,
                    'messaging_conversations_started': messages,
                    'add_to_cart': add_to_cart,
                    'cpm': float(r.get('cpm', 0)),
                    'ctr': float(r.get('ctr', 0)),
                    'cpc': float(r.get('cpc', 0)),
                    'frequency': float(r.get('frequency', 0)),
                    'date': str(r.get('date_start', '')),
                    'account_id': acct_short,
                    'sync_time': sync_time,
                })
            
            acct_ads_ok[acct_short] = len(rows)
            log.info(f"    Ad insights: {len(rows)} rows")
        except Exception as e:
            log.error(f"    Ad insights error: {e}")
            failed_accounts.append(acct_short)
            log.warning(f"    ⚠ Account {acct_short} ads failed — existing BQ data will be PRESERVED")

        # ── Adset-level insights ──
        try:
            resp2 = requests.get(
                f'https://graph.facebook.com/{FB_API_VERSION}/{account_id}/insights',
                params={
                    'level': 'adset',
                    'fields': 'adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,clicks,cpm,ctr,cpc,frequency,actions,action_values',
                    'time_range': time_range,
                    'time_increment': '1',
                    'access_token': FB_TOKEN,
                    'limit': '500',
                },
                timeout=60
            )
            data2 = resp2.json()

            if 'error' in data2:
                log.error(f"  FB Adset API error: {data2['error'].get('message', '')}")
                # Adset failed but ads may have succeeded — don't add to failed_accounts
                continue

            rows2 = data2.get('data', [])
            while 'paging' in data2 and 'next' in data2['paging']:
                resp2 = requests.get(data2['paging']['next'], timeout=60)
                data2 = resp2.json()
                rows2.extend(data2.get('data', []))

            for r in rows2:
                actions2 = r.get('actions', [])
                action_values2 = r.get('action_values', [])
                purchases2 = sum(int(a.get('value', 0)) for a in actions2 if a.get('action_type') == 'purchase')
                purchase_value2 = sum(float(a.get('value', 0)) for a in action_values2 if a.get('action_type') == 'purchase')
                leads2 = sum(int(a.get('value', 0)) for a in actions2 if a.get('action_type') == 'lead')
                messages2 = sum(int(a.get('value', 0)) for a in actions2 if a.get('action_type') == 'onsite_conversion.messaging_conversation_started_7d')
                all_adsets.append({
                    'adset_id': str(r.get('adset_id', '')),
                    'adset_name': str(r.get('adset_name', '')),
                    'campaign_id': str(r.get('campaign_id', '')),
                    'campaign_name': str(r.get('campaign_name', '')),
                    'spend': float(r.get('spend', 0)),
                    'impressions': int(r.get('impressions', 0)),
                    'reach': int(r.get('reach', 0)),
                    'clicks': int(r.get('clicks', 0)),
                    'cpm': float(r.get('cpm', 0)),
                    'ctr': float(r.get('ctr', 0)),
                    'cpc': float(r.get('cpc', 0)),
                    'frequency': float(r.get('frequency', 0)),
                    'purchases': purchases2,
                    'purchase_value': purchase_value2,
                    'leads': leads2,
                    'messaging_conversations_started': messages2,
                    'date': str(r.get('date_start', '')),
                    'account_id': acct_short,
                    'sync_time': sync_time,
                })

            acct_adsets_ok[acct_short] = len(rows2)
            log.info(f"    Adset insights: {len(rows2)} rows")
        except Exception as e:
            log.error(f"    Adset insights error: {e}")

        time.sleep(1)  # Rate limit

    # ── Upload to BigQuery — PER-ACCOUNT DELETE + APPEND ──
    # Only delete data for accounts that returned data successfully.
    # Failed accounts keep their existing BQ data intact.

    ads_schema = [
        bigquery.SchemaField('ad_id', 'STRING'), bigquery.SchemaField('ad_name', 'STRING'),
        bigquery.SchemaField('adset_id', 'STRING'), bigquery.SchemaField('adset_name', 'STRING'),
        bigquery.SchemaField('campaign_id', 'STRING'), bigquery.SchemaField('campaign_name', 'STRING'),
        bigquery.SchemaField('spend', 'FLOAT64'), bigquery.SchemaField('impressions', 'INT64'),
        bigquery.SchemaField('reach', 'INT64'), bigquery.SchemaField('clicks', 'INT64'),
        bigquery.SchemaField('purchases', 'INT64'), bigquery.SchemaField('leads', 'FLOAT64'),
        bigquery.SchemaField('messaging_conversations_started', 'INT64'), bigquery.SchemaField('add_to_cart', 'INT64'),
        bigquery.SchemaField('cpm', 'FLOAT64'), bigquery.SchemaField('ctr', 'FLOAT64'),
        bigquery.SchemaField('cpc', 'FLOAT64'), bigquery.SchemaField('frequency', 'FLOAT64'),
        bigquery.SchemaField('date', 'STRING'),
        bigquery.SchemaField('account_id', 'STRING'), bigquery.SchemaField('sync_time', 'STRING'),
    ]
    adset_schema = [
        bigquery.SchemaField('adset_id', 'STRING'), bigquery.SchemaField('adset_name', 'STRING'),
        bigquery.SchemaField('campaign_id', 'STRING'), bigquery.SchemaField('campaign_name', 'STRING'),
        bigquery.SchemaField('spend', 'FLOAT64'), bigquery.SchemaField('impressions', 'INT64'),
        bigquery.SchemaField('reach', 'INT64'), bigquery.SchemaField('clicks', 'INT64'),
        bigquery.SchemaField('date', 'STRING'), bigquery.SchemaField('account_id', 'STRING'),
        bigquery.SchemaField('sync_time', 'STRING'),
    ]

    if failed_accounts:
        log.warning(f"  ⚠ Failed accounts (data preserved): {failed_accounts}")

    # Per-account DELETE: only remove data for accounts that returned new data
    for acct_short in acct_ads_ok:
        delete_date_range('fb_ads_data', since, today, account_id=acct_short)
    for acct_short in acct_adsets_ok:
        delete_date_range('fb_adset_data', since, today, account_id=acct_short)

    # Bulk INSERT all fetched data
    if all_ads:
        ndjson = '\n'.join(json.dumps(r, ensure_ascii=False) for r in all_ads)
        job_config = bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
            schema=ads_schema,
        )
        load_job = client.load_table_from_file(
            io.BytesIO(ndjson.encode('utf-8')), f'{P}.{DS}.fb_ads_data', job_config=job_config
        )
        load_job.result()
        log.info(f"fb_ads_data: {len(all_ads)} rows MERGED ({since} → {today})")

    if all_adsets:
        ndjson2 = '\n'.join(json.dumps(r, ensure_ascii=False) for r in all_adsets)
        job_config2 = bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
            schema=[
                bigquery.SchemaField('adset_id', 'STRING'), bigquery.SchemaField('adset_name', 'STRING'),
                bigquery.SchemaField('campaign_id', 'STRING'), bigquery.SchemaField('campaign_name', 'STRING'),
                bigquery.SchemaField('spend', 'FLOAT64'), bigquery.SchemaField('impressions', 'INT64'),
                bigquery.SchemaField('reach', 'INT64'), bigquery.SchemaField('clicks', 'INT64'),
                bigquery.SchemaField('cpm', 'FLOAT64'), bigquery.SchemaField('ctr', 'FLOAT64'),
                bigquery.SchemaField('cpc', 'FLOAT64'), bigquery.SchemaField('frequency', 'FLOAT64'),
                bigquery.SchemaField('purchases', 'INT64'), bigquery.SchemaField('purchase_value', 'FLOAT64'),
                bigquery.SchemaField('leads', 'INT64'), bigquery.SchemaField('messaging_conversations_started', 'INT64'),
                bigquery.SchemaField('date', 'STRING'), bigquery.SchemaField('account_id', 'STRING'),
                bigquery.SchemaField('sync_time', 'STRING'),
            ]
        )
        load_job2 = client.load_table_from_file(
            io.BytesIO(ndjson2.encode('utf-8')), f'{P}.{DS}.fb_adset_data', job_config=job_config2
        )
        load_job2.result()
        log.info(f"fb_adset_data: {len(all_adsets)} rows MERGED ({since} → {today})")

    return len(all_ads), len(all_adsets)


# ═══════════════════════════════════════════════════════════
# CAMPAIGN BUDGET SYNC (fetch daily_budget từ Campaign API)
# ═══════════════════════════════════════════════════════════

def sync_campaign_data():
    """Sync campaign budgets từ Meta API → fb_campaign_data.

    Gọi Campaign API (không phải Insights) để lấy daily_budget/lifetime_budget.
    CMO PacingCalculator dùng daily_budget để tính pacing ratio.
    """
    if not FB_TOKEN:
        log.error("META_ACCESS_TOKEN not set!")
        return 0

    all_campaigns = []

    for account_id in FB_AD_ACCOUNTS:
        log.info(f"  Fetching campaign budgets for {account_id}...")
        acct_short = account_id.replace('act_', '')
        url = f'https://graph.facebook.com/{FB_API_VERSION}/{account_id}/campaigns'
        params = {
            'fields': 'id,name,status,effective_status,daily_budget,lifetime_budget,budget_remaining,objective,start_time,stop_time',
            'effective_status': '["ACTIVE","PAUSED","ARCHIVED"]',
            'limit': '500',
            'access_token': FB_TOKEN,
        }
        try:
            resp = requests.get(url, params=params, timeout=60)
            data = resp.json()
            if 'error' in data:
                log.error(f"  Campaign API error: {data['error'].get('message', '')}")
                continue

            rows = data.get('data', [])
            while 'paging' in data and 'next' in data.get('paging', {}):
                resp = requests.get(data['paging']['next'], timeout=60)
                data = resp.json()
                rows.extend(data.get('data', []))

            for r in rows:
                all_campaigns.append({
                    'campaign_id': str(r.get('id', '')),
                    'campaign_name': str(r.get('name', '')),
                    'status': str(r.get('status', '')),
                    'effective_status': str(r.get('effective_status', '')),
                    # Meta trả về đơn vị cents (USD) hoặc minor currency — chia 100 để ra đơn vị chính
                    'daily_budget': float(r.get('daily_budget') or 0) / 100,
                    'lifetime_budget': float(r.get('lifetime_budget') or 0) / 100,
                    'budget_remaining': float(r.get('budget_remaining') or 0) / 100,
                    'objective': str(r.get('objective', '')),
                    'start_time': str(r.get('start_time', '') or ''),
                    'stop_time': str(r.get('stop_time', '') or ''),
                    'account_id': acct_short,
                    'sync_time': sync_time,
                })

            log.info(f"    Campaigns: {len(rows)} rows")
        except Exception as e:
            log.error(f"    Campaign fetch error for {account_id}: {e}")

    if not all_campaigns:
        log.warning("No campaign data synced")
        return 0

    # WRITE_TRUNCATE — thay toàn bộ snapshot (campaigns thay đổi budget không tạo row mới)
    ndjson = '\n'.join(json.dumps(r, ensure_ascii=False) for r in all_campaigns)
    job_config = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        schema=[
            bigquery.SchemaField('campaign_id', 'STRING'),
            bigquery.SchemaField('campaign_name', 'STRING'),
            bigquery.SchemaField('status', 'STRING'),
            bigquery.SchemaField('effective_status', 'STRING'),
            bigquery.SchemaField('daily_budget', 'FLOAT64'),
            bigquery.SchemaField('lifetime_budget', 'FLOAT64'),
            bigquery.SchemaField('budget_remaining', 'FLOAT64'),
            bigquery.SchemaField('objective', 'STRING'),
            bigquery.SchemaField('start_time', 'STRING'),
            bigquery.SchemaField('stop_time', 'STRING'),
            bigquery.SchemaField('account_id', 'STRING'),
            bigquery.SchemaField('sync_time', 'STRING'),
        ]
    )
    load_job = client.load_table_from_file(
        io.BytesIO(ndjson.encode('utf-8')),
        f'{P}.{DS}.fb_campaign_data',
        job_config=job_config
    )
    load_job.result()
    log.info(f"fb_campaign_data: {len(all_campaigns)} campaigns synced (TRUNCATE)")
    return len(all_campaigns)


# ═══════════════════════════════════════════════════════════
# NEW: DISCORD NOTIFICATION (replaces N8N error monitor)
# ═══════════════════════════════════════════════════════════

DISCORD_WEBHOOK = os.environ.get('DISCORD_WEBHOOK_ETL', '')

def send_discord_report(results: dict, elapsed: float):
    """Send sync summary to Discord."""
    if not DISCORD_WEBHOOK:
        log.warning("No Discord webhook configured")
        return
    
    status_icon = '✅' if not results.get('errors') else '⚠️'
    
    embed = {
        'title': f'{status_icon} STRAMARK Sync Report',
        'color': 0x2ECC71 if not results.get('errors') else 0xE74C3C,
        'fields': [
            {'name': '📦 Orders', 'value': str(results.get('orders', 0)), 'inline': True},
            {'name': '📋 Items', 'value': str(results.get('items', 0)), 'inline': True},
            {'name': '💰 COGS', 'value': str(results.get('cogs', 0)), 'inline': True},
            {'name': '📊 Ads', 'value': str(results.get('ads', 0)), 'inline': True},
            {'name': '📈 Adsets', 'value': str(results.get('adsets', 0)), 'inline': True},
            {'name': '📦 Stock', 'value': str(results.get('stock', 'N/A')), 'inline': True},
            {'name': '⏱️ Time', 'value': f'{elapsed:.0f}s', 'inline': True},
        ],
        'footer': {'text': f'AGENT-V2 Python Sync | {datetime.now().strftime("%Y-%m-%d %H:%M")}'}
    }
    
    if results.get('errors'):
        embed['fields'].append({
            'name': '❌ Errors',
            'value': '\n'.join(results['errors'][:5]),
            'inline': False
        })
    
    try:
        requests.post(DISCORD_WEBHOOK, json={'embeds': [embed]}, timeout=10)
        log.info("Discord notification sent")
    except Exception as e:
        log.error(f"Discord send failed: {e}")


# ═══════════════════════════════════════════════════════════
# MAIN — Unified orchestrator
# ═══════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='STRAMARK Full Sync')
    parser.add_argument('--ads', action='store_true', help='Sync FB Ads only')
    parser.add_argument('--orders', action='store_true', help='Sync Orders only (pass-1 incremental + pass-2 refresh)')
    parser.add_argument('--stock', action='store_true', help='Sync Stock only')
    parser.add_argument('--test', action='store_true', help='Dry run — check connections only')
    parser.add_argument('--full', action='store_true', help='Force full re-fetch (ignore incremental)')
    parser.add_argument('--days', type=int, default=1, help='Days back for ads (default: 1)')
    # Pass-2: re-fetch non-terminal orders by ID (fixes Smart Stop bug)
    parser.add_argument('--refresh-pending', action='store_true',
                        help='Pass-2 only: re-fetch non-terminal orders by ID (catches delayed status updates Smart Stop misses)')
    parser.add_argument('--refresh-days', type=int, default=30,
                        help='Pass-2 lookback window in days (default: 30)')
    parser.add_argument('--no-pass2', action='store_true',
                        help='Skip pass-2 when running --orders (only do incremental fetch)')
    # One-time backfill for historical data poisoned by Smart Stop bug
    parser.add_argument('--backfill', metavar='YYYY-MM-DD',
                        help='Backfill: re-fetch ALL orders inserted since this date')
    parser.add_argument('--backfill-until', metavar='YYYY-MM-DD',
                        help='Backfill end date (default: today)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Dry run for --refresh-pending / --backfill (counts only, no API/BQ writes)')
    args = parser.parse_args()
    
    start = datetime.now()
    run_all = not (args.ads or args.orders or args.stock)
    results = {'errors': []}
    
    log.info("═" * 60)
    log.info("STRAMARK FULL SYNC — AGENT-V2 (N8N-Free)")
    log.info(f"Mode: {'FULL' if run_all else 'PARTIAL'} | Incremental: {not args.full}")
    log.info("═" * 60)
    
    if args.test:
        log.info("Testing BigQuery connection...")
        q = client.query(f'SELECT COUNT(*) as cnt FROM `{P}.{DS}.sale_order`')
        for row in q:
            log.info(f"  sale_order: {row.cnt} rows")
        log.info("Testing FB API connection...")
        r = requests.get(f'https://graph.facebook.com/{FB_API_VERSION}/me',
                        params={'access_token': FB_TOKEN}, timeout=10)
        log.info(f"  FB API: {r.status_code} — {r.json().get('name', r.json().get('error', {}).get('message', '?'))}")
        log.info("All connections OK")
        return

    # ═══ Standalone --backfill mode (one-time historical fix) ═══
    if args.backfill:
        log.info(f"\n[Backfill mode] since={args.backfill} until={args.backfill_until or 'today'}")
        try:
            r = backfill_orders(args.backfill, args.backfill_until, dry_run=args.dry_run)
            results['backfill'] = r
        except Exception as e:
            log.error(f"  Backfill failed: {e}")
            results['errors'].append(f'Backfill: {e}')
        elapsed = (datetime.now() - start).total_seconds()
        log.info(f"\nBackfill complete in {elapsed:.0f}s — results: {results}")
        return

    # ═══ Standalone --refresh-pending mode (pass-2 only) ═══
    if args.refresh_pending:
        log.info(f"\n[Refresh-pending mode] days_back={args.refresh_days}")
        try:
            r = refresh_non_terminal_orders(days_back=args.refresh_days, dry_run=args.dry_run)
            results['refresh_pending'] = r
        except Exception as e:
            log.error(f"  Refresh-pending failed: {e}")
            results['errors'].append(f'RefreshPending: {e}')
        elapsed = (datetime.now() - start).total_seconds()
        log.info(f"\nRefresh-pending complete in {elapsed:.0f}s — results: {results}")
        return

    # ═══ Step 1: Orders + Items (Pass-1 incremental) ═══
    if run_all or args.orders:
        log.info("\n[1/6] Fetching orders from Poscake (Pass-1 incremental)...")
        try:
            last_ts = None if args.full else get_last_sync_ts(client, P, DS)
            all_orders, all_items = fetch_all_orders(last_sync_ts=last_ts)
            log.info(f"  Fetched: {len(all_orders)} orders, {len(all_items)} items")
            results['orders'] = len(all_orders)
            results['items'] = len(all_items)

            if all_orders:
                # Step 2: COGS
                log.info("\n[2/6] Fetching product COGS...")
                cogs_map = fetch_product_cogs()
                results['cogs'] = len(cogs_map)

                if cogs_map:
                    enriched = 0
                    for item in all_items:
                        vid = item.get('variation_id', '')
                        pid = item.get('product_id', '')
                        if item['avg_imported_price'] == 0:
                            cost = cogs_map.get(vid) or cogs_map.get(pid)
                            if cost and cost > 0:
                                item['avg_imported_price'] = cost
                                enriched += 1
                    log.info(f"  Enriched {enriched} items with COGS")

                # Step 3: Upload orders (incremental upsert)
                log.info("\n[3/6] Uploading orders to BigQuery...")
                upsert_orders(client, P, DS, all_orders, all_items, ORDER_SCHEMA, ITEM_SCHEMA)

                # Step 4: COGS table
                log.info("\n[4/6] Syncing product_cogs table...")
                try:
                    sync_product_cogs_table(cogs_map)
                except Exception as e:
                    log.error(f"  product_cogs failed: {e}")
                    results['errors'].append(f'COGS: {e}')

            # Pass-2: refresh non-terminal orders to catch delayed status updates
            # that Smart Stop in Pass-1 misses (POS sorts list by id, not updated_at).
            if not args.no_pass2:
                try:
                    p2 = refresh_non_terminal_orders(days_back=args.refresh_days)
                    results['pass2'] = p2
                except Exception as e:
                    log.error(f"  Pass-2 refresh failed: {e}")
                    results['errors'].append(f'Pass2: {e}')
        except Exception as e:
            log.error(f"  Orders sync failed: {e}")
            results['errors'].append(f'Orders: {e}')
    
    # ═══ Step 5: Stock ═══
    if run_all or args.stock:
        log.info("\n[5/6] Syncing product stock...")
        try:
            sync_product_stock()
            results['stock'] = 'OK'
        except Exception as e:
            log.error(f"  Stock sync failed: {e}")
            results['errors'].append(f'Stock: {e}')
    
    # ═══ Step 6: FB Ads ═══
    if run_all or args.ads:
        log.info(f"\n[6/7] Syncing FB Ads (last {args.days} days)...")
        try:
            ads_count, adsets_count = sync_fb_ads(days_back=args.days)
            results['ads'] = ads_count
            results['adsets'] = adsets_count
        except Exception as e:
            log.error(f"  FB Ads sync failed: {e}")
            results['errors'].append(f'Ads: {e}')

    # ═══ Step 7: Campaign Budgets ═══
    if run_all or args.ads:
        log.info("\n[7/7] Syncing campaign budgets (daily_budget)...")
        try:
            campaigns_count = sync_campaign_data()
            results['campaigns'] = campaigns_count
        except Exception as e:
            log.error(f"  Campaign sync failed: {e}")
            results['errors'].append(f'Campaigns: {e}')
    
    # ═══ Summary + Discord ═══
    elapsed = (datetime.now() - start).total_seconds()
    log.info("\n" + "═" * 60)
    log.info("SYNC COMPLETE")
    log.info(f"  Results: {results}")
    log.info(f"  Errors: {len(results['errors'])}")
    log.info(f"  Time: {elapsed:.0f}s")
    log.info("═" * 60)
    
    # Send Discord notification
    send_discord_report(results, elapsed)


if __name__ == '__main__':
    main()
