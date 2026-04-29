#!/usr/bin/env python3
"""
ZEN8 Fix Phase 4: Sync missing products from POS to BQ product_template
========================================================================
Root cause: ETL only synced ~30 products, but POS has 53 products.
12 products exist in order_items but NOT in product_template → show as UNKNOWN.
"""
import os, json, requests

key_paths = [
    os.path.join(os.path.dirname(__file__), "..", "bigquery_key.json"),
    "/Users/ngonhat/Desktop/Agentic-AI-Levelup/bigquery_key.json",
]
for p in key_paths:
    if os.path.exists(p):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = p
        break

from google.cloud import bigquery
client = bigquery.Client(project="levelup-465304")
FULL_DS = "levelup-465304.ZEN8_Dataset"

def run_sql(name, sql):
    try:
        client.query(sql).result()
        print(f"  ✅ {name}")
    except Exception as e:
        print(f"  ❌ {name}: {e}")

# ═══ Step 1: Find missing product IDs ═══
print("═══ Step 1: Find missing product_ids in order_items but not in product_template ═══")
missing_q = f"""
SELECT oi.product_id, COUNT(*) as items
FROM `{FULL_DS}.order_items` oi
LEFT JOIN `{FULL_DS}.product_template` pt ON oi.product_id = pt.id
WHERE pt.id IS NULL
GROUP BY 1
ORDER BY items DESC
"""
rows = list(client.query(missing_q).result())
missing_ids = [r.product_id for r in rows]
print(f"  Found {len(missing_ids)} missing product_ids")

# ═══ Step 2: Fetch ALL products from POS API ═══
print("\n═══ Step 2: Fetch all products from POS API ═══")
POS_URL = "https://pos.pages.fm/api/v1/shops/714234971/products"
API_KEY = os.environ.get("ZEN8_POSCAKE_API_KEY", "")
if not API_KEY:
    raise SystemExit("ERROR: ZEN8_POSCAKE_API_KEY not set in environment")

all_products = []
for page in range(1, 5):
    resp = requests.get(POS_URL, params={"api_key": API_KEY, "page": page, "page_size": 50})
    data = resp.json()
    products = data.get("data", [])
    if not products:
        break
    all_products.extend(products)
    print(f"  Page {page}: {len(products)} products")

print(f"  Total POS products: {len(all_products)}")

# ═══ Step 3: Match missing IDs to POS products ═══
print("\n═══ Step 3: Match missing product_ids to POS products ═══")
# Build lookup: product_id → POS product info
pos_by_id = {}
for p in all_products:
    pos_by_id[p["id"]] = p

matched = []
for mid in missing_ids:
    if mid in pos_by_id:
        p = pos_by_id[mid]
        matched.append({
            "id": mid,
            "custom_id": p.get("custom_id", ""),
            "name": p.get("name", ""),
            "retail_price": p.get("retail_price", 0),
        })
        print(f"  ✅ {mid} → {p.get('custom_id','')} — {p.get('name','')}")
    else:
        print(f"  ❌ {mid} → NOT found in POS!")

# ═══ Step 4: Also find products in BQ product_template that we already have ═══
existing_q = f"SELECT id FROM `{FULL_DS}.product_template`"
existing_ids = {r.id for r in client.query(existing_q).result()}
print(f"\n  Existing in BQ: {len(existing_ids)} products")

# Also add POS products that exist but aren't in BQ (beyond just order_items matches)
extra_missing = []
for p in all_products:
    if p["id"] not in existing_ids and p["id"] not in missing_ids:
        extra_missing.append({
            "id": p["id"],
            "custom_id": p.get("custom_id", ""),
            "name": p.get("name", ""),
            "retail_price": p.get("retail_price", 0),
        })
        print(f"  Also missing from BQ: {p.get('custom_id','')} — {p.get('name','')}")

all_to_insert = matched + extra_missing
print(f"\n  Total products to INSERT: {len(all_to_insert)}")

# ═══ Step 5: INSERT missing products into product_template ═══
if all_to_insert:
    print("\n═══ Step 5: INSERT missing products into product_template ═══")
    values = []
    for p in all_to_insert:
        name_escaped = p["name"].replace("'", "\\'").replace('"', '\\"')
        price_str = str(p["retail_price"])
        values.append(f"('{p['id']}', '{p['custom_id']}', '{name_escaped}', '{price_str}')")
    
    insert_sql = f"""
    INSERT INTO `{FULL_DS}.product_template` (id, custom_id, name, retail_price)
    VALUES {', '.join(values)}
    """
    run_sql(f"INSERT {len(all_to_insert)} products", insert_sql)

# ═══ Step 6: Verify ═══
print("\n═══ Step 6: Verify — no more UNKNOWN products ═══")
verify_q = f"""
SELECT COUNT(DISTINCT oi.product_id) as still_missing
FROM `{FULL_DS}.order_items` oi
LEFT JOIN `{FULL_DS}.product_template` pt ON oi.product_id = pt.id
WHERE pt.id IS NULL
"""
result = list(client.query(verify_q).result())
still_missing = result[0].still_missing if result else -1
print(f"  Still missing: {still_missing} product_ids")
if still_missing == 0:
    print("  🎉 All products now mapped!")
else:
    print(f"  ⚠️  {still_missing} product_ids still missing (may not be in POS)")

print(f"\n{'═' * 60}")
print("  Phase 4 Complete! Missing products synced from POS to BQ")
print(f"{'═' * 60}")
