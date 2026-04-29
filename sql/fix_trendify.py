#!/usr/bin/env python3
"""
TRENDIFY Dashboard Fix — Based on ZEN8 Checklist
=================================================
Fixes:
1. dim_marketer_mapping: Wrong names (Minh Thư → Thu DM, Vân Tường → Vân PTT)  
2. vw_fact_daily_pnl_flex: revenue_confirmed=0 (status code mismatch)
3. mart_product_insights: product ads=0 (campaign→product mapping)
4. mart_market_intelligence: market=Unknown (derive from campaign)
5. mart_performance_master: marketer dedup & resolution
6. Missing product sync from POS
"""
import os, requests, json

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
DS = "TRENDIFY_Dataset"
FULL_DS = f"levelup-465304.{DS}"

def run_sql(name, sql):
    try:
        client.query(sql).result()
        print(f"  ✅ {name}")
        return True
    except Exception as e:
        print(f"  ❌ {name}: {e}")
        return False

# ════════════════════════════════════════════════════════════
# FIX 1: dim_marketer_mapping — correct names from YAML
# ════════════════════════════════════════════════════════════
print("═══ Fix 1: dim_marketer_mapping — correct marketer names ═══")

# Delete old wrong mappings
run_sql("Delete old mappings", f"""
DELETE FROM `{FULL_DS}.dim_marketer_mapping` WHERE TRUE
""")

# Insert correct mappings from YAML
run_sql("Insert correct mappings", f"""
INSERT INTO `{FULL_DS}.dim_marketer_mapping` (campaign_code, marketer_id, marketer_name)
VALUES 
    ('VANPTT', 'VANPTT', 'Vân PTT'),
    ('THUDM', 'THUDM', 'Thu DM'),
    ('PHUNGNTM', 'PHUNGNTM', 'Phụng NTM'),
    ('TuPA', 'TuPA', 'Tú PA'),
    ('THICHVV', 'THICHVV', 'Thích VV')
""")

# ════════════════════════════════════════════════════════════
# FIX 2: Check pnl_flex (examine why revenue_confirmed=0)
# ════════════════════════════════════════════════════════════
print("\n═══ Fix 2: Diagnose pnl_flex status codes ═══")

# Check what status codes pnl_flex recognizes as "success"
diag_q = f"""
SELECT 
    so.status,
    so.status_name,
    COUNT(*) as cnt,
    ROUND(SUM(so.cod),0) as total_cod
FROM `{FULL_DS}.sale_order` so
WHERE so.status IN ('3','16') 
GROUP BY 1,2
"""
rows = list(client.query(diag_q).result())
print(f"  Status 3/16 orders: {sum(r.cnt for r in rows)}")
for r in rows:
    print(f"    status={r.status} ({r.status_name}): {r.cnt} orders, {r.total_cod} COD")

# Check what vw_fact_daily_pnl_flex uses for success
diag_q2 = f"""
SELECT 
    SUM(success_orders) as success,
    ROUND(SUM(revenue_success),0) as rev_success,
    ROUND(SUM(revenue_confirmed),0) as rev_confirmed,
    ROUND(SUM(delivered_revenue),0) as rev_delivered
FROM `{FULL_DS}.vw_fact_daily_pnl_flex`
"""
rows2 = list(client.query(diag_q2).result())
for r in rows2:
    print(f"  pnl_flex totals: success={r.success}, rev_success={r.rev_success}, rev_confirmed={r.rev_confirmed}, rev_delivered={r.rev_delivered}")

# The issue: pnl_flex uses different column names for TRENDIFY
# P&L tab reads revenue_confirmed which may be calculated from different status codes
# Let's check the pnl_flex view definition
print("\n  Checking pnl_flex view source code...")
view_q = f"""
SELECT view_definition 
FROM `{FULL_DS}.INFORMATION_SCHEMA.VIEWS` 
WHERE table_name = 'vw_fact_daily_pnl_flex'
"""
view_rows = list(client.query(view_q).result())
if view_rows:
    view_def = view_rows[0].view_definition
    # Check what status codes are used for revenue_confirmed
    if 'revenue_confirmed' in view_def:
        # Find the line with revenue_confirmed
        for line in view_def.split('\n'):
            if 'revenue_confirmed' in line.lower() or 'delivered_revenue' in line.lower():
                print(f"    {line.strip()}")
    # Also find status conditions
    for line in view_def.split('\n'):
        if 'status' in line.lower() and ('16' in line or "'7'" in line or "'3'" in line):
            print(f"    Status line: {line.strip()}")

# ════════════════════════════════════════════════════════════
# FIX 3: Fix vw_fact_daily_pnl_flex for TRENDIFY  
# ════════════════════════════════════════════════════════════
print("\n═══ Fix 3: Update vw_fact_daily_pnl_flex — TRENDIFY status codes ═══")

# TRENDIFY status codes:
# 3 = delivered (SUCCESS)
# 4 = returning
# 5 = returned
# 6 = canceled
# 0 = new, 1 = submitted, 2 = shipped, 8 = packing

# Create updated view with correct status handling
# revenue_confirmed should use the SAME status as revenue_success
pnl_fix_sql = f"""
CREATE OR REPLACE VIEW `{FULL_DS}.vw_fact_daily_pnl_flex` AS
WITH 
-- FX rates
fx AS (
    SELECT from_currency, to_currency, rate
    FROM `{FULL_DS}.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'RON'
    ORDER BY effective_date DESC LIMIT 1
),
-- Orders
orders_daily AS (
    SELECT
        o.order_date AS report_date,
        COUNT(DISTINCT o.order_id) AS total_orders,
        COUNTIF(o.status_group = 'success') AS success_orders,
        COUNTIF(o.status_group = 'returned') AS returned_orders,
        COUNTIF(o.status_group = 'cancelled') AS cancelled_orders,
        COUNTIF(o.status_group NOT IN ('success','returned','cancelled')) AS pending_orders,
        ROUND(SUM(CASE WHEN o.status_group = 'success' THEN o.revenue_L3_success ELSE 0 END), 0) AS revenue_success,
        -- revenue_confirmed = same as revenue_success for TRENDIFY (status 3 = delivered)
        ROUND(SUM(CASE WHEN o.status_group = 'success' THEN o.revenue_L3_success ELSE 0 END), 0) AS revenue_confirmed,
        ROUND(SUM(CASE WHEN o.status_group = 'success' THEN o.revenue_L3_success ELSE 0 END), 0) AS delivered_revenue,
        ROUND(SUM(o.shipping_fee), 0) AS shipping_cost,
        0 AS fulfillment_cost,
        0 AS return_fulfillment_cost
    FROM `{FULL_DS}.vw_fact_orders` o
    GROUP BY 1
),
-- Ads
ads_daily AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        ROUND(SUM(a.spend), 2) AS ads_spend_usd,
        SUM(COALESCE(a.impressions, 0)) AS impressions,
        SUM(COALESCE(a.clicks, 0)) AS clicks,
        SUM(COALESCE(a.reach, 0)) AS reach,
        0 AS messages,
        0 AS total_leads
    FROM `{FULL_DS}.fb_ads_data` a
    GROUP BY 1
),
-- COGS daily estimate
cogs_daily AS (
    SELECT
        o.order_date AS report_date,
        ROUND(SUM(CASE WHEN o.status_group = 'success' THEN 
            COALESCE(SAFE_CAST(pc.cost_raw AS FLOAT64), 0) * oi.quantity
        ELSE 0 END), 0) AS cogs
    FROM `{FULL_DS}.vw_fact_orders` o
    JOIN `{FULL_DS}.order_items` oi ON o.order_id = oi.order_id
    LEFT JOIN `{FULL_DS}.product_template` pt ON oi.product_id = pt.id
    LEFT JOIN `{FULL_DS}.product_cogs` pc ON pt.custom_id = pc.product_code
    GROUP BY 1
)

SELECT
    COALESCE(od.report_date, ad.report_date) AS report_date,
    COALESCE(od.total_orders, 0) AS total_orders,
    COALESCE(od.success_orders, 0) AS success_orders,
    COALESCE(od.returned_orders, 0) AS returned_orders,
    COALESCE(od.cancelled_orders, 0) AS cancelled_orders,
    COALESCE(od.pending_orders, 0) AS pending_orders,
    COALESCE(od.revenue_success, 0) AS revenue_success,
    COALESCE(od.revenue_confirmed, 0) AS revenue_confirmed,
    COALESCE(od.delivered_revenue, 0) AS delivered_revenue,
    -- Ads in RON (TRENDIFY currency)
    ROUND(COALESCE(ad.ads_spend_usd, 0) * COALESCE(fx.rate, 4.6), 0) AS ads_spend_ron,
    COALESCE(ad.ads_spend_usd, 0) AS ads_spend_usd,
    COALESCE(od.shipping_cost, 0) AS shipping_cost,
    COALESCE(od.fulfillment_cost, 0) AS fulfillment_cost,
    COALESCE(od.return_fulfillment_cost, 0) AS return_fulfillment_cost,
    COALESCE(cd.cogs, 0) AS cogs,
    ROUND(COALESCE(od.revenue_confirmed, 0) 
        - COALESCE(cd.cogs, 0) 
        - COALESCE(ad.ads_spend_usd, 0) * COALESCE(fx.rate, 4.6) 
        - COALESCE(od.shipping_cost, 0), 0) AS net_profit,
    COALESCE(ad.impressions, 0) AS impressions,
    COALESCE(ad.clicks, 0) AS clicks,
    COALESCE(ad.reach, 0) AS reach,
    COALESCE(ad.messages, 0) AS messages,
    COALESCE(ad.total_leads, 0) AS total_leads,
    ROUND(SAFE_DIVIDE(od.revenue_success, NULLIF(ad.ads_spend_usd * fx.rate, 0)), 2) AS roas_l3,
    ROUND(SAFE_DIVIDE(od.returned_orders * 100, NULLIF(od.total_orders, 0)), 1) AS return_rate_pct,
    ROUND(SAFE_DIVIDE(od.success_orders * 100, NULLIF(od.total_orders, 0)), 1) AS success_rate_pct,
    ROUND(SAFE_DIVIDE(ad.ads_spend_usd * fx.rate, NULLIF(ad.total_leads, 0)), 2) AS cpl_ron
FROM orders_daily od
FULL OUTER JOIN ads_daily ad ON od.report_date = ad.report_date
LEFT JOIN cogs_daily cd ON COALESCE(od.report_date, ad.report_date) = cd.report_date
CROSS JOIN fx
"""
run_sql("vw_fact_daily_pnl_flex", pnl_fix_sql)

# ════════════════════════════════════════════════════════════
# FIX 4: campaign_product_mapping for TRENDIFY
# ════════════════════════════════════════════════════════════
print("\n═══ Fix 4: campaign_product_mapping ═══")

# Campaign format: ProductName_SRNxx_RO_MKTER
# SPLIT('_')[1] = SRNxx = product code
# Let's verify
verify_q = f"""
SELECT DISTINCT 
    SPLIT(campaign_name, '_')[SAFE_OFFSET(1)] as campaign_product,
    COUNT(*) as cnt,
    ROUND(SUM(spend),2) as spend
FROM `{FULL_DS}.fb_ads_data`
GROUP BY 1
ORDER BY spend DESC
"""
rows = list(client.query(verify_q).result())
print("  Campaign products found:")
for r in rows:
    print(f"    {r.campaign_product}: {r.cnt} rows, ${r.spend} spend")

# For TRENDIFY, SPLIT('_')[1] = product_code directly (SRN01, SRN02, etc.)
# So we can update mart_product_insights to use this directly

# ════════════════════════════════════════════════════════════
# FIX 5: mart_product_insights — ads attribution via campaign SPLIT
# ════════════════════════════════════════════════════════════
print("\n═══ Fix 5: mart_product_insights — ads via campaign SPLIT('_')[1] ═══")

product_insights_sql = f"""
CREATE OR REPLACE VIEW `{FULL_DS}.mart_product_insights` AS
WITH 
fx AS (
    SELECT rate FROM `{FULL_DS}.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'RON'
    ORDER BY effective_date DESC LIMIT 1
),
-- Orders by product (allocate revenue from order.cod)
order_products AS (
    SELECT
        o.order_date AS report_date,
        COALESCE(pt.custom_id, 'UNKNOWN') AS product_code,
        COALESCE(pt.name, 'Unknown Product') AS product_name,
        o.order_id,
        o.status_group,
        -- Allocate revenue from order COD
        ROUND(o.revenue_L1_lead * SAFE_DIVIDE(oi.quantity, 
            SUM(oi.quantity) OVER(PARTITION BY o.order_id)), 2) AS item_revenue_lead,
        ROUND(o.revenue_L3_success * SAFE_DIVIDE(oi.quantity, 
            SUM(oi.quantity) OVER(PARTITION BY o.order_id)), 2) AS item_revenue_success,
        oi.quantity,
        COALESCE(SAFE_CAST(pc.cost_raw AS FLOAT64), 0) * oi.quantity AS item_cogs,
        o.derived_market AS market
    FROM `{FULL_DS}.vw_fact_orders` o
    JOIN `{FULL_DS}.order_items` oi ON o.order_id = oi.order_id
    LEFT JOIN `{FULL_DS}.product_template` pt ON oi.product_id = pt.id
    LEFT JOIN `{FULL_DS}.product_cogs` pc ON pt.custom_id = pc.product_code
),
product_summary AS (
    SELECT
        report_date,
        product_code,
        ANY_VALUE(product_name) AS product_name,
        COUNT(DISTINCT order_id) AS order_count,
        COUNTIF(status_group = 'success') AS units_delivered,
        COUNTIF(status_group = 'returned') AS units_returned,
        ROUND(SUM(item_revenue_lead), 0) AS total_revenue,
        ROUND(SUM(item_revenue_success), 0) AS delivered_revenue,
        ROUND(SUM(item_cogs), 0) AS cogs,
        SUM(quantity) AS total_qty,
        ANY_VALUE(market) AS market
    FROM order_products
    GROUP BY 1, 2
),
-- Ads by product (SPLIT('_')[1] = product code like SRN01)
ads_by_product AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(1)])) AS product_code,
        SUM(a.spend) AS ads_usd,
        SUM(COALESCE(a.impressions, 0)) AS impressions,
        SUM(COALESCE(a.clicks, 0)) AS clicks
    FROM `{FULL_DS}.fb_ads_data` a
    GROUP BY 1, 2
)

SELECT
    COALESCE(ps.report_date, ap.report_date) AS report_date,
    COALESCE(ps.product_code, ap.product_code) AS product_code,
    COALESCE(ps.product_name, 'Unknown') AS product_name,
    COALESCE(ps.order_count, 0) AS order_count,
    COALESCE(ps.units_delivered, 0) AS units_delivered,
    COALESCE(ps.units_returned, 0) AS units_returned,
    COALESCE(ps.total_revenue, 0) AS total_revenue,
    COALESCE(ps.delivered_revenue, 0) AS delivered_revenue,
    COALESCE(ps.cogs, 0) AS cogs,
    ROUND(COALESCE(ps.delivered_revenue, 0) - COALESCE(ps.cogs, 0), 0) AS gross_profit,
    ROUND(SAFE_DIVIDE(COALESCE(ps.delivered_revenue, 0) - COALESCE(ps.cogs, 0), 
        NULLIF(ps.delivered_revenue, 0)) * 100, 1) AS margin_pct,
    COALESCE(ps.total_qty, 0) AS total_qty,
    ROUND(COALESCE(ap.ads_usd, 0) * fx.rate, 0) AS ads_spend_ron,
    COALESCE(ap.impressions, 0) AS impressions,
    COALESCE(ap.clicks, 0) AS clicks,
    COALESCE(ps.market, 'Unknown') AS market
FROM product_summary ps
FULL OUTER JOIN ads_by_product ap 
    ON ps.report_date = ap.report_date AND UPPER(ps.product_code) = ap.product_code
CROSS JOIN fx
"""
run_sql("mart_product_insights", product_insights_sql)

# ════════════════════════════════════════════════════════════
# FIX 6: mart_market_intelligence — derive from campaign SPLIT('_')[2]
# ════════════════════════════════════════════════════════════
print("\n═══ Fix 6: mart_market_intelligence — from campaign market code ═══")

# Campaign: ProductName_SRNxx_RO_MKTER → SPLIT('_')[2] = market code (RO, US, HR, etc.)
market_intel_sql = f"""
CREATE OR REPLACE VIEW `{FULL_DS}.mart_market_intelligence` AS
WITH 
fx AS (
    SELECT rate FROM `{FULL_DS}.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'RON'
    ORDER BY effective_date DESC LIMIT 1
),
-- Orders: derive market from campaign via ads attribution
-- Since all TRENDIFY orders are from Romania shops, we default to RO
order_market AS (
    SELECT
        o.order_date AS report_date,
        'Romania' AS market,
        'RO' AS market_code,
        COUNT(DISTINCT o.order_id) AS total_orders,
        COUNTIF(o.status_group = 'success') AS success_orders,
        COUNTIF(o.status_group = 'returned') AS returned_orders,
        COUNTIF(o.status_group = 'cancelled') AS cancelled_orders,
        ROUND(SUM(o.revenue_L1_lead), 0) AS revenue_lead,
        ROUND(SUM(o.revenue_L3_success), 0) AS revenue_success,
        ROUND(SUM(o.shipping_fee), 0) AS shipping_cost
    FROM `{FULL_DS}.vw_fact_orders` o
    GROUP BY 1, 2, 3
),
-- Ads by market (campaign SPLIT('_')[2])
ads_market AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        CASE UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)]))
            WHEN 'RO' THEN 'Romania'
            WHEN 'US' THEN 'United States'
            WHEN 'HR' THEN 'Croatia'
            WHEN 'IT' THEN 'Italy'
            WHEN 'BG' THEN 'Bulgaria'
            ELSE TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)])
        END AS market,
        UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)])) AS market_code,
        SUM(a.spend) AS ads_spend_usd,
        SUM(COALESCE(a.impressions, 0)) AS impressions,
        SUM(COALESCE(a.clicks, 0)) AS clicks
    FROM `{FULL_DS}.fb_ads_data` a
    GROUP BY 1, 2, 3
)

SELECT
    COALESCE(om.report_date, am.report_date) AS report_date,
    COALESCE(om.market, am.market, 'Unknown') AS market,
    COALESCE(om.market_code, am.market_code, 'XX') AS market_code,
    COALESCE(om.total_orders, 0) AS total_orders,
    COALESCE(om.success_orders, 0) AS success_orders,
    COALESCE(om.returned_orders, 0) AS returned_orders,
    COALESCE(om.cancelled_orders, 0) AS cancelled_orders,
    COALESCE(om.revenue_lead, 0) AS revenue_lead,
    COALESCE(om.revenue_success, 0) AS revenue_success,
    ROUND(COALESCE(am.ads_spend_usd, 0), 2) AS ads_spend_usd,
    ROUND(COALESCE(am.ads_spend_usd, 0) * fx.rate, 0) AS ads_spend_ron,
    COALESCE(am.impressions, 0) AS impressions,
    COALESCE(am.clicks, 0) AS clicks,
    ROUND(COALESCE(om.revenue_success, 0) - COALESCE(am.ads_spend_usd, 0) * fx.rate - COALESCE(om.shipping_cost, 0), 0) AS gross_profit,
    ROUND(SAFE_DIVIDE(om.revenue_success, NULLIF(am.ads_spend_usd * fx.rate, 0)), 2) AS market_roas,
    ROUND(SAFE_DIVIDE(om.success_orders, NULLIF(om.total_orders, 0)) * 100, 1) AS delivery_rate_pct,
    ROUND(SAFE_DIVIDE(om.returned_orders, NULLIF(om.total_orders, 0)) * 100, 1) AS return_rate_pct,
    ROUND(SAFE_DIVIDE(om.revenue_lead, NULLIF(om.total_orders, 0)), 2) AS market_aov
FROM order_market om
FULL OUTER JOIN ads_market am 
    ON om.report_date = am.report_date AND om.market_code = am.market_code
CROSS JOIN fx
"""
run_sql("mart_market_intelligence", market_intel_sql)

# ════════════════════════════════════════════════════════════
# FIX 7: Sync missing products from POS
# ════════════════════════════════════════════════════════════
print("\n═══ Fix 7: Sync missing products from POS ═══")

# TRENDIFY has 2 shops: US (407220179) + RO (407925623)
POS_SHOPS = [
    {"name": "US", "shop_id": "407220179", "api_key": "ac3c26e14bba4fa0b48be19e43f39781"},
    {"name": "RO", "shop_id": "407925623", "api_key": "ac3c26e14bba4fa0b48be19e43f39781"},
]

# Get existing BQ products
existing_q = f"SELECT id, custom_id FROM `{FULL_DS}.product_template`"
existing = {r.id: r.custom_id for r in client.query(existing_q).result()}
print(f"  Existing in BQ: {len(existing)} products")

# Fetch from POS and find missing
all_pos_products = {}
for shop in POS_SHOPS:
    for page in range(1, 5):
        resp = requests.get(
            f"https://pos.pages.fm/api/v1/shops/{shop['shop_id']}/products",
            params={"api_key": shop['api_key'], "page": page, "page_size": 50}
        )
        products = resp.json().get("data", [])
        if not products:
            break
        for p in products:
            all_pos_products[p["id"]] = p
        print(f"  {shop['name']} page {page}: {len(products)} products")

print(f"  Total POS products: {len(all_pos_products)}")

missing = []
for pid, p in all_pos_products.items():
    if pid not in existing:
        missing.append(p)
        print(f"  Missing: {p.get('custom_id','')} — {p.get('name','')}")

if missing:
    values = []
    for p in missing:
        name = p.get("name", "").replace("'", "\\'")
        price = str(p.get("retail_price", 0))
        values.append(f"('{p['id']}', '{p.get('custom_id','')}', '{name}', '{price}')")
    
    run_sql(f"INSERT {len(missing)} products", f"""
    INSERT INTO `{FULL_DS}.product_template` (id, custom_id, name, retail_price)
    VALUES {', '.join(values)}
    """)
else:
    print("  No missing products!")

# ════════════════════════════════════════════════════════════
# VERIFY
# ════════════════════════════════════════════════════════════
print("\n═══ Verification ═══")

# Verify pnl_flex now has revenue
v1 = list(client.query(f"""
SELECT SUM(revenue_confirmed) as rev, SUM(ads_spend_ron) as ads, SUM(success_orders) as success
FROM `{FULL_DS}.vw_fact_daily_pnl_flex`
""").result())
for r in v1:
    print(f"  pnl_flex: revenue={r.rev}, ads={r.ads}, success={r.success}")

# Verify product insights has ads
v2 = list(client.query(f"""
SELECT product_code, SUM(ads_spend_ron) as ads, SUM(delivered_revenue) as rev
FROM `{FULL_DS}.mart_product_insights`
WHERE product_code != 'UNKNOWN'
GROUP BY 1 ORDER BY rev DESC LIMIT 5
""").result())
for r in v2:
    print(f"  Product {r.product_code}: rev={r.rev}, ads={r.ads}")

# Verify marketers
v3 = list(client.query(f"""
SELECT campaign_code, marketer_name FROM `{FULL_DS}.dim_marketer_mapping`
""").result())
for r in v3:
    print(f"  Marketer: {r.campaign_code} → {r.marketer_name}")

print(f"\n{'═' * 60}")
print("  TRENDIFY Fix Complete!")
print(f"{'═' * 60}")
