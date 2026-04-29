"""
AUUS1 Ads Sync — v3 (Standalone)
Syncs Facebook Ads data from Meta API → BigQuery fb_ads_data + fb_adset_data

Usage:
  python scripts/sync_auus1_ads.py             # Default: last 1 day
  python scripts/sync_auus1_ads.py --days 30   # Backfill 30 days
  python scripts/sync_auus1_ads.py --test       # Test connections only
"""
import os, sys, json, io, time, logging, argparse, requests
from datetime import datetime, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.path.join(PROJECT_DIR, 'bigquery_key.json')
sys.stdout.reconfigure(encoding='utf-8')

from dotenv import load_dotenv
load_dotenv(os.path.join(PROJECT_DIR, '.env'))

from google.cloud import bigquery

# ═══ Config ═══
P = 'levelup-465304'
DS = 'AUUS1_Dataset'
# Use AUUS1-specific token (long-lived, never expires)
# Fallback to root META_ACCESS_TOKEN if AUUS1 token not set
FB_TOKEN = os.environ.get('AUUS1_META_ACCESS_TOKEN', '') or os.environ.get('META_ACCESS_TOKEN', '')
# Active accounts only (removed dead: act_773109749037011)
# Note: act_2002604803685498 (AU) and act_2026217937936451 (US phụ) may need separate token with ads_read permission
FB_AD_ACCOUNTS = ['act_900537852593889', 'act_2002604803685498', 'act_2026217937936451']
FB_API_VERSION = 'v21.0'

# Logging
log_dir = os.path.join(PROJECT_DIR, 'logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, f'auus1_ads_sync_{datetime.now().strftime("%Y%m%d_%H%M")}.log')
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.FileHandler(log_file, encoding='utf-8'), logging.StreamHandler(sys.stdout)])
log = logging.getLogger('auus1_ads_sync')
client = bigquery.Client(project=P)
sync_time = datetime.utcnow().isoformat()


def delete_date_range(table_name, since, until):
    """Delete rows in date range before re-inserting."""
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
        log.error("META_ACCESS_TOKEN not set in .env!")
        return 0, 0

    today = datetime.utcnow().strftime('%Y-%m-%d')
    since = (datetime.utcnow() - timedelta(days=days_back)).strftime('%Y-%m-%d')
    time_range = json.dumps({'since': since, 'until': today})
    all_ads, all_adsets = [], []

    for account_id in FB_AD_ACCOUNTS:
        log.info(f"  Fetching {account_id} ({since} → {today})...")
        acct_short = account_id.replace('act_', '')

        # Ad-level insights
        try:
            resp = requests.get(f'https://graph.facebook.com/{FB_API_VERSION}/{account_id}/insights',
                params={
                    'level': 'ad',
                    'fields': 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,clicks,ctr,cpc,frequency,actions,action_values,cost_per_action_type',
                    'time_range': time_range,
                    'time_increment': '1',
                    'access_token': FB_TOKEN,
                    'limit': '500',
                }, timeout=60)
            data = resp.json()
            if 'error' in data:
                log.error(f"  FB error ({account_id}): {data['error'].get('message','')[:200]}")
                continue
            rows = data.get('data', [])
            # Paginate
            while 'paging' in data and 'next' in data['paging']:
                resp = requests.get(data['paging']['next'], timeout=60)
                data = resp.json()
                rows.extend(data.get('data', []))

            for r in rows:
                actions = r.get('actions', [])
                action_values = r.get('action_values', [])
                purchases = sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'purchase')
                purchase_value = sum(float(a.get('value', 0)) for a in action_values if a.get('action_type') == 'purchase')
                messages = sum(int(a.get('value', 0)) for a in actions if a.get('action_type') in ('onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.messaging_first_reply'))
                link_clicks = sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'link_click')

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
                    'purchase_value': purchase_value,
                    'messaging_conversations_started': messages,
                    'ctr': float(r.get('ctr', 0)),
                    'cpc': float(r.get('cpc', 0)),
                    'frequency': float(r.get('frequency', 0)),
                    'date': str(r.get('date_start', '')),
                    'account_id': int(acct_short),  # BQ column is INT64
                    'sync_time': sync_time,
                })
            log.info(f"    Ad insights: {len(rows)} rows")
        except Exception as e:
            log.error(f"    Ad error: {e}")

        # Adset-level insights
        try:
            resp2 = requests.get(f'https://graph.facebook.com/{FB_API_VERSION}/{account_id}/insights',
                params={
                    'level': 'adset',
                    'fields': 'adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,clicks',
                    'time_range': time_range,
                    'time_increment': '1',
                    'access_token': FB_TOKEN,
                    'limit': '500',
                }, timeout=60)
            data2 = resp2.json()
            if 'error' in data2:
                log.error(f"  FB adset error ({account_id}): {data2['error'].get('message','')[:200]}")
                continue
            rows2 = data2.get('data', [])
            while 'paging' in data2 and 'next' in data2['paging']:
                resp2 = requests.get(data2['paging']['next'], timeout=60)
                data2 = resp2.json()
                rows2.extend(data2.get('data', []))
            for r in rows2:
                all_adsets.append({
                    'adset_id': str(r.get('adset_id', '')),
                    'adset_name': str(r.get('adset_name', '')),
                    'campaign_id': str(r.get('campaign_id', '')),
                    'campaign_name': str(r.get('campaign_name', '')),
                    'spend': float(r.get('spend', 0)),
                    'impressions': int(r.get('impressions', 0)),
                    'reach': int(r.get('reach', 0)),
                    'clicks': int(r.get('clicks', 0)),
                    'date': str(r.get('date_start', '')),
                    'account_id': int(acct_short),  # BQ column is INT64
                    'sync_time': sync_time,
                })
            log.info(f"    Adset insights: {len(rows2)} rows")
        except Exception as e:
            log.error(f"    Adset error: {e}")
        time.sleep(1)

    # Upload ads data
    if all_ads:
        delete_date_range('fb_ads_data', since, today)
        ndjson = '\n'.join(json.dumps(r, ensure_ascii=False) for r in all_ads)
        jc = bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
            autodetect=True,
        )
        client.load_table_from_file(
            io.BytesIO(ndjson.encode('utf-8')), f'{P}.{DS}.fb_ads_data', job_config=jc
        ).result()
        log.info(f"  fb_ads_data: {len(all_ads)} rows MERGED ({since} → {today})")
    else:
        log.warning("  No ad rows fetched!")

    if all_adsets:
        delete_date_range('fb_adset_data', since, today)
        ndjson2 = '\n'.join(json.dumps(r, ensure_ascii=False) for r in all_adsets)
        jc2 = bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
            autodetect=True,
        )
        client.load_table_from_file(
            io.BytesIO(ndjson2.encode('utf-8')), f'{P}.{DS}.fb_adset_data', job_config=jc2
        ).result()
        log.info(f"  fb_adset_data: {len(all_adsets)} rows MERGED ({since} → {today})")

    return len(all_ads), len(all_adsets)


def main():
    parser = argparse.ArgumentParser(description='AUUS1 Ads Sync v3')
    parser.add_argument('--days', type=int, default=1, help='Days back for ads (default: 1)')
    parser.add_argument('--test', action='store_true', help='Test connections only')
    args = parser.parse_args()

    start = datetime.now()
    log.info("═" * 60)
    log.info("AUUS1 ADS SYNC v3 — Standalone")
    log.info(f"Ad Accounts: {FB_AD_ACCOUNTS}")
    log.info(f"Days back: {args.days}")
    log.info("═" * 60)

    if args.test:
        log.info("Testing BQ connection...")
        for row in client.query(f'SELECT COUNT(*) c FROM `{P}.{DS}.fb_ads_data`'):
            log.info(f"  fb_ads_data: {row.c} rows")
        log.info("Testing FB token...")
        r = requests.get(f'https://graph.facebook.com/{FB_API_VERSION}/me',
            params={'access_token': FB_TOKEN}, timeout=10)
        result = r.json()
        log.info(f"  FB: {r.status_code} — {result.get('name', result.get('error',{}).get('message','?'))}")
        return

    ads, adsets = sync_fb_ads(days_back=args.days)
    elapsed = (datetime.now() - start).total_seconds()
    log.info(f"\n✅ DONE — {ads} ads, {adsets} adsets | {elapsed:.0f}s")


if __name__ == '__main__':
    main()
