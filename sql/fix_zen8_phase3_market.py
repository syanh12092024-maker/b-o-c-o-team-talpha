#!/usr/bin/env python3
"""
ZEN8 Fix Phase 3: Market Intelligence from product code prefix + campaign market
================================================================================
Problem: sale_order has NO city/province → derived_market=Unknown for 99.8% orders
Solution: Derive market from:
  1. product_code prefix: KSAZEN8xxx → SA (Saudi Arabia), AEZEN8xxx → AE (UAE)
  2. Campaign name SPLIT('_')[2] → SA, AE, KW, etc.
"""
import os

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


# ════════════════════════════════════════════════════
# Fix: mart_market_intelligence — derive market from product prefix
# ════════════════════════════════════════════════════
print("\n═══ Fix mart_market_intelligence (product prefix + campaign market) ═══")

sql = f"""
CREATE OR REPLACE VIEW `{FULL_DS}.mart_market_intelligence` AS
WITH 
fx_usd_aed AS (
    SELECT rate FROM `{FULL_DS}.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'AED'
    ORDER BY effective_date DESC LIMIT 1
),
fx_vnd_aed AS (
    SELECT rate FROM `{FULL_DS}.cost_exchange_rates`
    WHERE from_currency = 'VND' AND to_currency = 'AED'
    ORDER BY effective_date DESC LIMIT 1
),

-- Product code → market mapping
product_market AS (
    SELECT custom_id, name,
        CASE
            WHEN UPPER(custom_id) LIKE 'KSA%' OR UPPER(custom_id) LIKE 'KSAZEN%' THEN 'Saudi Arabia'
            WHEN UPPER(custom_id) LIKE 'KW%' THEN 'Kuwait'
            WHEN UPPER(custom_id) LIKE 'AE%' OR UPPER(custom_id) LIKE 'AEZEN%' THEN 'UAE'
            WHEN UPPER(custom_id) LIKE 'BH%' THEN 'Bahrain'
            WHEN UPPER(custom_id) LIKE 'OM%' THEN 'Oman'
            WHEN UPPER(custom_id) LIKE 'QA%' THEN 'Qatar'
            ELSE 'Unknown'
        END AS market_name,
        CASE
            WHEN UPPER(custom_id) LIKE 'KSA%' OR UPPER(custom_id) LIKE 'KSAZEN%' THEN 'SA'
            WHEN UPPER(custom_id) LIKE 'KW%' THEN 'KW'
            WHEN UPPER(custom_id) LIKE 'AE%' OR UPPER(custom_id) LIKE 'AEZEN%' THEN 'AE'
            WHEN UPPER(custom_id) LIKE 'BH%' THEN 'BH'
            WHEN UPPER(custom_id) LIKE 'OM%' THEN 'OM'
            WHEN UPPER(custom_id) LIKE 'QA%' THEN 'QA'
            ELSE 'XX'
        END AS market_code
    FROM `{FULL_DS}.product_template`
),

-- Orders by market (derive market from order_item → product → product_market)
order_items_market AS (
    SELECT
        o.order_date AS report_date,
        o.order_id,
        o.status_group,
        o.revenue_L1_lead,
        o.revenue_L3_success,
        o.shipping_fee,
        COALESCE(pm.market_name, 'Unknown') AS market,
        COALESCE(pm.market_code, 'XX') AS market_code
    FROM `{FULL_DS}.vw_fact_orders` o
    JOIN `{FULL_DS}.order_items` oi ON o.order_id = oi.order_id
    LEFT JOIN `{FULL_DS}.product_template` pt ON oi.product_id = pt.id
    LEFT JOIN product_market pm ON pt.custom_id = pm.custom_id
),
-- Deduplicate: one order can have multiple items → pick the most common market
order_market AS (
    SELECT report_date, order_id, status_group,
        -- Use ANY_VALUE to pick one market per order (most items usually same market)
        ANY_VALUE(revenue_L1_lead) AS revenue_L1,
        ANY_VALUE(revenue_L3_success) AS revenue_L3,
        ANY_VALUE(shipping_fee) AS shipping_fee,
        -- Pick the market with most items
        APPROX_TOP_COUNT(market, 1)[SAFE_OFFSET(0)].value AS market,
        APPROX_TOP_COUNT(market_code, 1)[SAFE_OFFSET(0)].value AS market_code
    FROM order_items_market
    GROUP BY 1, 2, 3
),
order_by_market AS (
    SELECT
        report_date, market, market_code,
        COUNT(DISTINCT order_id) AS total_orders,
        COUNTIF(status_group = 'success') AS success_orders,
        COUNTIF(status_group = 'returned') AS returned_orders,
        COUNTIF(status_group = 'cancelled') AS cancelled_orders,
        ROUND(SUM(revenue_L1), 2) AS revenue_L1,
        ROUND(SUM(revenue_L3), 2) AS revenue_L3,
        ROUND(SUM(shipping_fee), 2) AS shipping_cost
    FROM order_market
    GROUP BY 1, 2, 3
),

-- Ads by market (from campaign)
dim_market AS (
    SELECT DISTINCT 
        UPPER(TRIM(market_code)) AS market_code_upper,
        ANY_VALUE(market_name) AS market_name,
        ANY_VALUE(market_code) AS market_code
    FROM `{FULL_DS}.dim_market_mapping`
    GROUP BY 1
),
ads_by_market AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        COALESCE(
            dm.market_name,
            CASE UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)]))
                WHEN 'SA' THEN 'Saudi Arabia'
                WHEN 'AE' THEN 'UAE'
                WHEN 'KW' THEN 'Kuwait'
                WHEN 'BH' THEN 'Bahrain'
                WHEN 'OM' THEN 'Oman'
                WHEN 'QA' THEN 'Qatar'
                ELSE TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)])
            END
        ) AS market,
        COALESCE(
            dm.market_code,
            UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)]))
        ) AS market_code,
        SUM(a.spend) AS ads_spend_usd,
        SUM(COALESCE(a.impressions, 0)) AS impressions,
        SUM(COALESCE(a.clicks, 0)) AS clicks
    FROM `{FULL_DS}.fb_ads_data` a
    LEFT JOIN dim_market dm 
        ON UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)])) = dm.market_code_upper
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
    ROUND(COALESCE(om.revenue_L1, 0), 0) AS revenue_lead,
    ROUND(COALESCE(om.revenue_L3, 0), 0) AS revenue_success,
    ROUND(COALESCE(am.ads_spend_usd, 0), 2) AS ads_spend_usd,
    ROUND(COALESCE(am.ads_spend_usd, 0) * fx.rate, 0) AS ads_spend_ron,
    COALESCE(am.impressions, 0) AS impressions,
    COALESCE(am.clicks, 0) AS clicks,
    ROUND(COALESCE(om.revenue_L3, 0) - COALESCE(am.ads_spend_usd, 0) * fx.rate - COALESCE(om.shipping_cost, 0), 0) AS gross_profit,
    ROUND(SAFE_DIVIDE(om.revenue_L3, NULLIF(am.ads_spend_usd * fx.rate, 0)), 2) AS market_roas,
    ROUND(SAFE_DIVIDE(om.success_orders, NULLIF(om.success_orders + om.returned_orders + om.cancelled_orders, 0)) * 100, 1) AS delivery_rate_pct,
    ROUND(SAFE_DIVIDE(om.returned_orders, NULLIF(om.total_orders, 0)) * 100, 1) AS return_rate_pct,
    ROUND(SAFE_DIVIDE(om.revenue_L1, NULLIF(om.total_orders, 0)), 2) AS market_aov
FROM order_by_market om
FULL OUTER JOIN ads_by_market am 
    ON om.report_date = am.report_date AND om.market_code = am.market_code
CROSS JOIN fx_usd_aed fx
"""
run_sql("mart_market_intelligence", sql)

# Also fix mart_product_insights to use same product→market mapping
print("\n═══ Verify product→market mapping ═══")
verify_sql = f"""
SELECT market, market_code, 
    SUM(total_orders) as orders, 
    SUM(success_orders) as success,
    ROUND(SUM(revenue_success),0) as revenue,
    ROUND(SUM(ads_spend_ron),0) as ads
FROM `{FULL_DS}.mart_market_intelligence`
WHERE market != 'Unknown' AND market_code NOT IN ('NHAMHT','LINHLTT','VUONGNM','TUNPT','HUYTN','LYVLN')
GROUP BY 1,2 ORDER BY revenue DESC LIMIT 10
"""
q = client.query(verify_sql)
rows = list(q.result())
for r in rows:
    print(f"  {r.market} ({r.market_code}): {r.orders} orders, {r.revenue} AED rev, {r.ads} AED ads")

print(f"\n{'═' * 60}")
print("  Phase 3 Complete! Market derived from product_code prefix")
print(f"{'═' * 60}")
