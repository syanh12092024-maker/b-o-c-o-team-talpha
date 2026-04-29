"""
AUUS1 Full Sync — N8N-Free Edition v2
Replaces: [AUU] 02 Ads Sync + [AUU] 06 Auto Dedup + Order Sync

Features:
  - FB Ads sync (2 ad accounts) — DELETE+APPEND (no dupes)
  - Order sync (2 shops: US + AU) — WRITE_TRUNCATE (full reload)
  - Discord notification on completion

Usage:
  python auus1_sync.py            # Full sync (ads + orders)
  python auus1_sync.py --ads      # Ads only
  python auus1_sync.py --orders   # Orders only
  python auus1_sync.py --test     # Test connections
  python auus1_sync.py --days 7   # Ads backfill 7 days
"""
import os, sys, json, io, time, logging, argparse, requests
from datetime import datetime, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.path.join(PROJECT_DIR, 'bigquery_key.json')
sys.stdout.reconfigure(encoding='utf-8')

from dotenv import load_dotenv
load_dotenv(os.path.join(PROJECT_DIR, '.env'))

from google.cloud import bigquery

# Dynamic config — reads from config/ad_accounts.json
import sys as _sys
_sys.path.insert(0, str(PROJECT_DIR))
from sync.config_loader import get_active_account_ids, get_access_token
from sync.order_sync_utils import get_last_sync_ts, should_stop_fetching, upsert_orders

P = 'levelup-465304'
DS = 'AUUS1_Dataset'
FB_TOKEN = get_access_token('auus1') or os.environ.get('AUUS1_META_ACCESS_TOKEN', '')
FB_AD_ACCOUNTS = get_active_account_ids('auus1') or ['act_2002604803685498', 'act_2026217937936451', 'act_900537852593889']
FB_API_VERSION = 'v21.0'
DISCORD_WEBHOOK = os.environ.get('DISCORD_WEBHOOK_ETL', '')

# POS API — 2 shops (shop_ids discovered via local API call 2026-03-01)
POS_API_URL = "https://pos.pages.fm/api/v1"
POS_SHOPS = [
    {"key": os.environ.get("AUUS1_POSCAKE_US_KEY", ""), "label": "US", "shop_id": "100197417"},
    {"key": os.environ.get("AUUS1_POSCAKE_AU_KEY", ""), "label": "AU", "shop_id": "1328333296"},
]

# Logging
log_file = os.path.join(PROJECT_DIR, 'logs', f'auus1_sync_{datetime.now().strftime("%Y%m%d_%H%M")}.log')
os.makedirs(os.path.dirname(log_file), exist_ok=True)
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.FileHandler(log_file, encoding='utf-8'), logging.StreamHandler(sys.stdout)])
log = logging.getLogger('auus1_sync')
client = bigquery.Client(project=P)
sync_time = datetime.utcnow().isoformat()

# Status mapping (same as STRAMARK for Poscake)
STATUS_CATEGORY_MAP = {
    'delivered':      ('GIAO_THANH_CONG', 'da_nhan'),
    'received_money': ('GIAO_THANH_CONG', 'da_thu_tien'),
    'packing':        ('DANG_GIAO',       'dang_dong_hang'),
    'pending':        ('DANG_GIAO',       'cho_chuyen_hang'),
    'shipped':        ('DANG_GIAO',       'da_gui_hang'),
    'returning':      ('DON_HOAN',        'dang_hoan'),
    'returned':       ('DON_HOAN',        'da_hoan'),
    'canceled':       ('HUY',             'da_huy'),
    'new':            ('DON_THO',         'moi'),
    'submitted':      ('DA_XAC_NHAN',     'da_xac_nhan'),
    'waitting':       ('CHO_HANG',        'cho_hang'),
    'ordered':        ('DA_DAT_HANG',     'da_dat_hang'),
}


# ═══════════════════════════════════════════════════
# ORDER SYNC — Fetch from Poscake API (US + AU shops)
# Strategy: WRITE_TRUNCATE → zero duplicates
# ═══════════════════════════════════════════════════

def discover_shop_id(api_key: str) -> str:
    """Auto-discover shop_id from API key."""
    try:
        resp = requests.get(f"{POS_API_URL}/shops",
            params={"api_key": api_key}, timeout=15)
        data = resp.json()
        shops = data.get('data', [])
        if shops:
            return str(shops[0].get('id', ''))
    except Exception as e:
        log.warning(f"  Shop ID discovery failed: {e}")
    return ""


def fetch_orders_from_shop(api_key: str, shop_label: str, shop_id: str = "", last_sync_ts=None):
    """Fetch orders from a single Poscake shop (incremental with Smart Stop)."""
    if not shop_id:
        shop_id = discover_shop_id(api_key)
    if not shop_id:
        log.error(f"  Cannot discover shop_id for {shop_label}")
        return [], []

    log.info(f"  Fetching {shop_label} orders (shop={shop_id})...")
    all_orders = []
    all_items = []
    page = 1

    while True:
        try:
            resp = requests.get(
                f"{POS_API_URL}/shops/{shop_id}/orders",
                params={"api_key": api_key, "page": page, "per_page": 10},
                timeout=30
            )
            data = resp.json()
        except Exception as e:
            log.error(f"  Fetch page {page} failed ({shop_label}): {e}")
            break

        orders = data.get('data', [])
        if not orders:
            break
        if should_stop_fetching(orders, last_sync_ts):
            log.info(f"  Smart Stop at page {page} for {shop_label}: all orders older than last sync")
            break

        for o in orders:
            # Map marketer
            marketer_raw = o.get('marketer')
            if isinstance(marketer_raw, dict):
                marketer_str = json.dumps(marketer_raw, ensure_ascii=False)
            else:
                marketer_str = str(marketer_raw or '')

            order_row = {
                'id': str(o.get('id', '')),
                'shop_id': str(o.get('shop_id', shop_id)),
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
                'order_currency': str(o.get('order_currency', 'USD')),
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
                'shop_label': shop_label,  # US or AU
            }
            all_orders.append(order_row)

            for item in (o.get('items', []) or []):
                item_row = {
                    'item_id': str(item.get('id', '')),
                    'order_id': str(o.get('id', '')),
                    'shop_id': str(o.get('shop_id', shop_id)),
                    'shop_name': str(o.get('shop_name', '')),
                    'project_id': f'auus1_{shop_label.lower()}',
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
                }
                all_items.append(item_row)

        if page % 50 == 0:
            log.info(f"    Page {page}: {len(all_orders)} orders, {len(all_items)} items")

        if len(orders) < 10:
            break
        page += 1
        time.sleep(0.3)

    log.info(f"  {shop_label}: {len(all_orders)} orders, {len(all_items)} items")
    return all_orders, all_items


def sync_all_orders(last_sync_ts=None):
    """Fetch orders from ALL shops and upsert to BQ."""
    all_orders = []
    all_items = []

    for shop in POS_SHOPS:
        if not shop["key"]:
            log.warning(f"  Skipping {shop['label']} — no API key")
            continue
        orders, items = fetch_orders_from_shop(shop["key"], shop["label"], shop.get("shop_id", ""), last_sync_ts=last_sync_ts)
        all_orders.extend(orders)
        all_items.extend(items)

    if all_orders:
        upsert_orders(client, P, DS, all_orders, all_items, ORDER_SCHEMA, ITEM_SCHEMA)
    else:
        log.warning("  No orders fetched from any shop!")

    return len(all_orders), len(all_items)


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
    bigquery.SchemaField('shop_label', 'STRING'),
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


# ═══════════════════════════════════════════════════
# FB ADS SYNC — DELETE date range + APPEND (no dupes)
# ═══════════════════════════════════════════════════

def delete_date_range(table_name, since, until):
    """Delete rows in date range before re-inserting (MERGE strategy)."""
    q = f"DELETE FROM `{P}.{DS}.{table_name}` WHERE date >= '{since}' AND date <= '{until}'"
    try:
        job = client.query(q)
        job.result()
        log.info(f"  Deleted {table_name} rows for {since} → {until} ({job.num_dml_affected_rows} rows)")
    except Exception as e:
        log.warning(f"  Delete {table_name} failed (table may not exist yet): {e}")


def sync_fb_ads(days_back=1):
    """Sync Facebook Ads → BigQuery fb_ads_data + fb_adset_data.
    Strategy: DELETE date range + APPEND (preserves historical data).
    """
    if not FB_TOKEN:
        log.error("AUUS1_META_ACCESS_TOKEN not set!")
        return 0, 0

    today = datetime.utcnow().strftime('%Y-%m-%d')
    since = (datetime.utcnow() - timedelta(days=days_back)).strftime('%Y-%m-%d')
    time_range = json.dumps({'since': since, 'until': today})
    all_ads, all_adsets = [], []

    for account_id in FB_AD_ACCOUNTS:
        log.info(f"  Fetching {account_id} ({since} → {today})...")
        acct_short = account_id.replace('act_', '')

        # Ad-level
        try:
            resp = requests.get(f'https://graph.facebook.com/{FB_API_VERSION}/{account_id}/insights',
                params={'level': 'ad', 'fields': 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,clicks,cpm,ctr,cpc,frequency,actions,action_values,cost_per_action_type',
                    'time_range': time_range, 'time_increment': '1', 'access_token': FB_TOKEN, 'limit': '500'}, timeout=60)
            data = resp.json()
            if 'error' in data:
                log.error(f"  FB error: {data['error'].get('message','')[:200]}")
                continue
            rows = data.get('data', [])
            while 'paging' in data and 'next' in data['paging']:
                resp = requests.get(data['paging']['next'], timeout=60)
                data = resp.json()
                rows.extend(data.get('data', []))

            for r in rows:
                actions = r.get('actions', [])
                action_values = r.get('action_values', [])
                purchases = sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'purchase')
                purchase_value = sum(float(a.get('value', 0)) for a in action_values if a.get('action_type') == 'purchase')
                atc = sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'add_to_cart')
                ic = sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'initiate_checkout')
                leads = sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'lead')
                messages = sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'onsite_conversion.messaging_conversation_started_7d')

                all_ads.append({
                    'ad_id': str(r.get('ad_id', '')), 'ad_name': str(r.get('ad_name', '')),
                    'adset_id': str(r.get('adset_id', '')), 'adset_name': str(r.get('adset_name', '')),
                    'campaign_id': str(r.get('campaign_id', '')), 'campaign_name': str(r.get('campaign_name', '')),
                    'spend': float(r.get('spend', 0)), 'impressions': int(r.get('impressions', 0)),
                    'reach': int(r.get('reach', 0)), 'clicks': int(r.get('clicks', 0)),
                    'purchases': purchases, 'purchase_value': purchase_value,
                    'add_to_cart': atc, 'initiate_checkout': ic,
                    'leads': float(leads), 'messaging_conversations_started': messages,
                    'cpm': float(r.get('cpm', 0)),
                    'ctr': float(r.get('ctr', 0)), 'cpc': float(r.get('cpc', 0)),
                    'frequency': float(r.get('frequency', 0)),
                    'date': str(r.get('date_start', '')), 'account_id': acct_short,
                    'sync_time': sync_time,
                })
            log.info(f"    Ad insights: {len(rows)} rows")
        except Exception as e:
            log.error(f"    Ad error: {e}")

        # Adset-level
        try:
            resp2 = requests.get(f'https://graph.facebook.com/{FB_API_VERSION}/{account_id}/insights',
                params={'level': 'adset', 'fields': 'adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,clicks,cpm,ctr,cpc,frequency,actions,action_values',
                    'time_range': time_range, 'time_increment': '1', 'access_token': FB_TOKEN, 'limit': '500'}, timeout=60)
            data2 = resp2.json()
            if 'error' in data2:
                log.error(f"  FB adset error: {data2['error'].get('message','')[:200]}")
                continue
            rows2 = data2.get('data', [])
            while 'paging' in data2 and 'next' in data2['paging']:
                resp2 = requests.get(data2['paging']['next'], timeout=60)
                data2 = resp2.json()
                rows2.extend(data2.get('data', []))
            for r in rows2:
                a2 = r.get('actions', []); av2 = r.get('action_values', [])
                all_adsets.append({
                    'adset_id': str(r.get('adset_id', '')), 'adset_name': str(r.get('adset_name', '')),
                    'campaign_id': str(r.get('campaign_id', '')), 'campaign_name': str(r.get('campaign_name', '')),
                    'spend': float(r.get('spend', 0)), 'impressions': int(r.get('impressions', 0)),
                    'reach': int(r.get('reach', 0)), 'clicks': int(r.get('clicks', 0)),
                    'cpm': float(r.get('cpm', 0)), 'ctr': float(r.get('ctr', 0)),
                    'cpc': float(r.get('cpc', 0)), 'frequency': float(r.get('frequency', 0)),
                    'purchases': sum(int(a.get('value', 0)) for a in a2 if a.get('action_type') == 'purchase'),
                    'purchase_value': sum(float(a.get('value', 0)) for a in av2 if a.get('action_type') == 'purchase'),
                    'leads': sum(int(a.get('value', 0)) for a in a2 if a.get('action_type') == 'lead'),
                    'messaging_conversations_started': sum(int(a.get('value', 0)) for a in a2 if a.get('action_type') == 'onsite_conversion.messaging_conversation_started_7d'),
                    'date': str(r.get('date_start', '')), 'account_id': acct_short, 'sync_time': sync_time,
                })
            log.info(f"    Adset insights: {len(rows2)} rows")
        except Exception as e:
            log.error(f"    Adset error: {e}")
        time.sleep(1)

    # Upload ads
    if all_ads:
        delete_date_range('fb_ads_data', since, today)
        ndjson = '\n'.join(json.dumps(r, ensure_ascii=False) for r in all_ads)
        jc = bigquery.LoadJobConfig(source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND, autodetect=True)
        client.load_table_from_file(io.BytesIO(ndjson.encode('utf-8')), f'{P}.{DS}.fb_ads_data', job_config=jc).result()
        log.info(f"  fb_ads_data: {len(all_ads)} rows MERGED ({since} → {today})")

    if all_adsets:
        delete_date_range('fb_adset_data', since, today)
        ndjson2 = '\n'.join(json.dumps(r, ensure_ascii=False) for r in all_adsets)
        jc2 = bigquery.LoadJobConfig(source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND, autodetect=True)
        client.load_table_from_file(io.BytesIO(ndjson2.encode('utf-8')), f'{P}.{DS}.fb_adset_data', job_config=jc2).result()
        log.info(f"  fb_adset_data: {len(all_adsets)} rows MERGED ({since} → {today})")

    return len(all_ads), len(all_adsets)


# ═══════════════════════════════════════════════════
# CAMPAIGN BUDGET SYNC
# ═══════════════════════════════════════════════════

def sync_campaign_data():
    """Sync campaign budgets từ Meta API → fb_campaign_data (daily_budget cho PacingCalculator)."""
    if not FB_TOKEN:
        log.error("AUUS1_META_ACCESS_TOKEN not set!")
        return 0
    all_campaigns = []
    for account_id in FB_AD_ACCOUNTS:
        acct_short = account_id.replace('act_', '')
        try:
            resp = requests.get(
                f'https://graph.facebook.com/{FB_API_VERSION}/{account_id}/campaigns',
                params={'fields': 'id,name,status,effective_status,daily_budget,lifetime_budget,budget_remaining,objective,start_time,stop_time',
                        'effective_status': '["ACTIVE","PAUSED","ARCHIVED"]', 'limit': '500', 'access_token': FB_TOKEN},
                timeout=60)
            data = resp.json()
            if 'error' in data:
                log.error(f"  Campaign API error {account_id}: {data['error'].get('message','')}")
                continue
            rows = data.get('data', [])
            while 'paging' in data and 'next' in data.get('paging', {}):
                resp = requests.get(data['paging']['next'], timeout=60); data = resp.json(); rows.extend(data.get('data', []))
            for r in rows:
                all_campaigns.append({
                    'campaign_id': str(r.get('id', '')), 'campaign_name': str(r.get('name', '')),
                    'status': str(r.get('status', '')), 'effective_status': str(r.get('effective_status', '')),
                    'daily_budget': float(r.get('daily_budget') or 0) / 100,
                    'lifetime_budget': float(r.get('lifetime_budget') or 0) / 100,
                    'budget_remaining': float(r.get('budget_remaining') or 0) / 100,
                    'objective': str(r.get('objective', '')),
                    'start_time': str(r.get('start_time', '') or ''), 'stop_time': str(r.get('stop_time', '') or ''),
                    'account_id': acct_short, 'sync_time': sync_time,
                })
            log.info(f"    Campaigns {account_id}: {len(rows)} rows")
        except Exception as e:
            log.error(f"    Campaign error {account_id}: {e}")
    if not all_campaigns:
        return 0
    import io as _io
    ndjson = '\n'.join(json.dumps(r, ensure_ascii=False) for r in all_campaigns)
    jc = bigquery.LoadJobConfig(source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        schema=[
            bigquery.SchemaField('campaign_id', 'STRING'), bigquery.SchemaField('campaign_name', 'STRING'),
            bigquery.SchemaField('status', 'STRING'), bigquery.SchemaField('effective_status', 'STRING'),
            bigquery.SchemaField('daily_budget', 'FLOAT64'), bigquery.SchemaField('lifetime_budget', 'FLOAT64'),
            bigquery.SchemaField('budget_remaining', 'FLOAT64'), bigquery.SchemaField('objective', 'STRING'),
            bigquery.SchemaField('start_time', 'STRING'), bigquery.SchemaField('stop_time', 'STRING'),
            bigquery.SchemaField('account_id', 'STRING'), bigquery.SchemaField('sync_time', 'STRING'),
        ])
    client.load_table_from_file(_io.BytesIO(ndjson.encode('utf-8')), f'{P}.{DS}.fb_campaign_data', job_config=jc).result()
    log.info(f"fb_campaign_data: {len(all_campaigns)} campaigns synced")
    return len(all_campaigns)


# DISCORD NOTIFICATION
# ═══════════════════════════════════════════════════

def send_discord_report(results, elapsed):
    if not DISCORD_WEBHOOK: return
    icon = '✅' if not results.get('errors') else '⚠️'
    embed = {'title': f'{icon} AUUS1 Sync Report', 'color': 0x2ECC71 if not results.get('errors') else 0xE74C3C,
        'fields': [
            {'name': '📦 Orders', 'value': str(results.get('orders', 0)), 'inline': True},
            {'name': '📋 Items', 'value': str(results.get('items', 0)), 'inline': True},
            {'name': '📊 Ads', 'value': str(results.get('ads', 0)), 'inline': True},
            {'name': '📈 Adsets', 'value': str(results.get('adsets', 0)), 'inline': True},
            {'name': '⏱️', 'value': f'{elapsed:.0f}s', 'inline': True},
        ],
        'footer': {'text': f'AUUS1 Python Sync v2 | {datetime.now().strftime("%Y-%m-%d %H:%M")}'}}
    if results.get('errors'):
        embed['fields'].append({'name': '❌ Errors', 'value': '\n'.join(results['errors'][:5]), 'inline': False})
    try: requests.post(DISCORD_WEBHOOK, json={'embeds': [embed]}, timeout=10)
    except: pass


# ═══════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='AUUS1 Full Sync v2')
    parser.add_argument('--ads', action='store_true', help='Sync FB Ads only')
    parser.add_argument('--orders', action='store_true', help='Sync Orders only')
    parser.add_argument('--test', action='store_true', help='Test connections')
    parser.add_argument('--full', action='store_true', help='Force full re-fetch')
    parser.add_argument('--days', type=int, default=1, help='Days back for ads')
    args = parser.parse_args()

    start = datetime.now()
    run_all = not (args.ads or args.orders)
    results = {'errors': []}

    log.info("═" * 60)
    log.info("AUUS1 SYNC v2 — Python (N8N-Free)")
    log.info(f"Mode: {'FULL' if run_all else 'PARTIAL'} | Incremental: {not args.full}")
    log.info("═" * 60)

    if args.test:
        log.info("Testing BQ...")
        for row in client.query(f'SELECT COUNT(*) c FROM `{P}.{DS}.sale_order`'):
            log.info(f"  sale_order: {row.c} rows")
        log.info("Testing FB...")
        r = requests.get(f'https://graph.facebook.com/{FB_API_VERSION}/me', params={'access_token': FB_TOKEN}, timeout=10)
        log.info(f"  FB: {r.status_code} — {r.json().get('name', r.json().get('error',{}).get('message','?'))}")
        log.info("Testing POS API...")
        for shop in POS_SHOPS:
            if shop["key"]:
                sid = discover_shop_id(shop["key"])
                log.info(f"  {shop['label']}: shop_id={sid}")
        return

    # Step 1: Orders
    if run_all or args.orders:
        log.info("\n[1/2] Syncing Orders (US + AU)...")
        try:
            last_ts = None if args.full else get_last_sync_ts(client, P, DS)
            orders, items = sync_all_orders(last_sync_ts=last_ts)
            results['orders'] = orders
            results['items'] = items
        except Exception as e:
            log.error(f"  Orders failed: {e}")
            results['errors'].append(str(e))

    # Step 2: FB Ads
    if run_all or args.ads:
        log.info(f"\n[2/3] Syncing FB Ads (last {args.days} days)...")
        try:
            ads, adsets = sync_fb_ads(days_back=args.days)
            results['ads'] = ads
            results['adsets'] = adsets
        except Exception as e:
            log.error(f"  Ads failed: {e}")
            results['errors'].append(str(e))

    # Step 3: Campaign Budgets
    if run_all or args.ads:
        log.info("\n[3/3] Syncing campaign budgets (daily_budget)...")
        try:
            results['campaigns'] = sync_campaign_data()
        except Exception as e:
            log.error(f"  Campaign sync failed: {e}")
            results['errors'].append(str(e))

    elapsed = (datetime.now() - start).total_seconds()
    log.info(f"\nDONE — {results} | {elapsed:.0f}s")
    send_discord_report(results, elapsed)


if __name__ == '__main__':
    main()
