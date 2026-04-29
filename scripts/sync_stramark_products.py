"""
sync_stramark_products.py — Sync product_template từ Poscake → BigQuery (STRAMARK)

Strategy: MERGE (upsert by id) — an toàn, không xóa sản phẩm cũ
          Chạy daily hoặc on-demand khi thêm sản phẩm mới

Usage:
  python scripts/sync_stramark_products.py           # Sync + upsert vào BQ
  python scripts/sync_stramark_products.py --dry-run # In ra danh sách sản phẩm, không ghi BQ
"""
import os, sys, json, logging, argparse, requests
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.path.join(PROJECT_DIR, 'bigquery_key.json')
sys.stdout.reconfigure(encoding='utf-8')

from dotenv import load_dotenv
load_dotenv(os.path.join(PROJECT_DIR, '.env'))

# ═══ Config ═══
P          = 'levelup-465304'
DS         = 'STRAMARK_Dataset'
POS_URL    = 'https://pos.pages.fm/api/v1'
POS_KEY    = os.environ.get('POSCAKE_API_KEY', '')
SHOP_ID    = '1635307570'
DISCORD    = os.environ.get('DISCORD_WEBHOOK_ETL', '')

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)])
log = logging.getLogger('sync_products')


# ═══════════════════════════════════════════════════
# POSCAKE — Fetch all product templates
# GET /product/templates?api_key=...&shop_id=...&page=...
# ═══════════════════════════════════════════════════

def fetch_all_products() -> list[dict]:
    """Fetch toàn bộ products từ Poscake, tự xử lý pagination."""
    products = []
    page = 1
    while True:
        resp = requests.get(
            f'{POS_URL}/shops/{SHOP_ID}/products',
            params={'api_key': POS_KEY, 'page': page, 'per_page': 100},
            timeout=30
        )
        resp.raise_for_status()
        data = resp.json()

        items = data.get('data', [])
        if not items:
            break

        products.extend(items)
        total_pages = data.get('total_pages', 1)
        log.info(f'  Page {page}/{total_pages}: {len(items)} products (total: {len(products)})')

        if page >= total_pages:
            break
        page += 1

    return products


def transform(raw: dict, sync_time: str) -> dict:
    """Map Poscake fields → BigQuery product_template schema."""
    return {
        'id':           str(raw.get('id', '') or ''),
        'name':         str(raw.get('name', '') or ''),
        'custom_id':    str(raw.get('custom_id', '') or '') or None,
        'barcode':      str(raw.get('barcode', '') or '') or None,
        'category':     json.dumps(raw.get('categories', [])) if raw.get('categories') else None,
        'retail_price': str(raw.get('retail_price', '') or '') or None,
        'imported_price': str(raw.get('imported_price', '') or '') or None,
        'shop_id':      str(SHOP_ID),
        'project_id':   'STRAMARK',
        'type':         str(raw.get('type', '') or '') or None,
        'is_activated': str(raw.get('is_activated', '') or '') or None,
        'is_hidden':    str(raw.get('is_hidden', '') or '') or None,
        'created_at':   str(raw.get('created_at', '') or '') or None,
        'sync_time':    sync_time,
        'shop_name':    'EU',
        'image':        str(raw.get('image', '') or '') or None,
    }


# ═══════════════════════════════════════════════════
# BIGQUERY — Upsert via temp table + MERGE
# ═══════════════════════════════════════════════════

def upsert_to_bq(rows: list[dict], client) -> int:
    """Streaming insert chỉ các sản phẩm MỚI vào product_template.

    Note: BigQuery sandbox mode không cho phép DML (MERGE/UPDATE/INSERT)
    cũng như load jobs vào tables không có partition expiration. Streaming
    insert (insert_rows_json) là cách duy nhất hoạt động trong free tier.

    Trade-off: Không thể UPDATE sản phẩm đã tồn tại — chỉ INSERT sản phẩm mới.
    Nếu cần update (tên/giá thay đổi), phải enable billing và dùng MERGE.
    """
    # 1. Query existing IDs để tìm sản phẩm mới
    existing_query = f'SELECT id FROM `{P}.{DS}.product_template`'
    existing_ids = {row.id for row in client.query(existing_query).result()}
    log.info(f'  Existing in BQ: {len(existing_ids)} products')

    new_rows = [r for r in rows if r['id'] not in existing_ids]
    if not new_rows:
        log.info('  No new products to insert — all synced')
        return 0

    log.info(f'  New products to insert: {len(new_rows)}')

    # 2. Streaming insert vào table (sandbox-compatible)
    table = client.get_table(f'{P}.{DS}.product_template')
    errors = client.insert_rows_json(table, new_rows)

    if errors:
        log.error(f'  Streaming insert errors: {errors}')
        return 0

    for r in new_rows:
        log.info(f"  ✓ Inserted: {r['custom_id'] or '(no code)':<10} | {r['name']}")

    return len(new_rows)


def notify_discord(inserted: int, total: int, dry_run: bool):
    if not DISCORD:
        return
    status = '🔍 DRY RUN' if dry_run else '✅ SYNC OK'
    msg = {
        'content': (
            f'**[STRAMARK] Product Sync — {status}**\n'
            f'Poscake → BigQuery `product_template`\n'
            f'Total: **{total}** products | New: **{inserted}** inserted\n'
            f'`{datetime.now().strftime("%Y-%m-%d %H:%M")}`'
        )
    }
    try:
        requests.post(DISCORD, json=msg, timeout=10)
    except Exception:
        pass


# ═══════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Fetch & print, không ghi BQ')
    args = parser.parse_args()

    log.info('=== STRAMARK Product Sync ===')
    log.info(f'Shop: {SHOP_ID} | Dry run: {args.dry_run}')

    # 1. Fetch từ Poscake
    log.info('Fetching products from Poscake...')
    raw_products = fetch_all_products()
    log.info(f'Total fetched: {len(raw_products)} products')

    if not raw_products:
        log.warning('Không có sản phẩm nào từ Poscake — kiểm tra API key')
        return

    # 2. Transform
    sync_time = datetime.now(timezone.utc).isoformat()
    rows = [transform(p, sync_time) for p in raw_products]

    # 3. Print (dry-run hoặc verbose)
    log.info('Products:')
    for r in rows:
        log.info(f"  {r['custom_id'] or '(no code)':<12} | {r['id']} | {r['name']}")

    if args.dry_run:
        log.info('DRY RUN — không ghi vào BigQuery')
        notify_discord(0, len(rows), dry_run=True)
        return

    # 4. Upsert vào BigQuery
    from google.cloud import bigquery
    client = bigquery.Client(project=P)
    log.info('Upserting to BigQuery...')
    inserted = upsert_to_bq(rows, client)

    notify_discord(inserted, len(rows), dry_run=False)
    log.info('=== Done ===')


if __name__ == '__main__':
    main()
