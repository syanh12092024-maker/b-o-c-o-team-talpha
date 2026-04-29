#!/usr/bin/env python3
"""Fix TRENDIFY pnl_flex and mart_product_insights views"""
import os
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = '/Users/ngonhat/Desktop/Agentic-AI-Levelup/bigquery_key.json'
from google.cloud import bigquery
client = bigquery.Client(project='levelup-465304')
DS = 'levelup-465304.TRENDIFY_Dataset'

def run(name, sql):
    try:
        client.query(sql).result()
        print(f'  ✅ {name}')
    except Exception as e:
        print(f'  ❌ {name}: {e}')

# ═══ Fix pnl_flex ═══
print('═══ Fix pnl_flex ═══')
run('vw_fact_daily_pnl_flex', f"""
CREATE OR REPLACE VIEW `{DS}.vw_fact_daily_pnl_flex` AS
WITH 
fx AS (
    SELECT COALESCE(MAX(rate), 4.6) as rate FROM `{DS}.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'RON'
),
orders_daily AS (
    SELECT
        o.order_date AS report_date,
        COUNT(DISTINCT o.order_id) AS total_orders,
        COUNTIF(o.status_group = 'success') AS success_orders,
        COUNTIF(o.status_group = 'returned') AS returned_orders,
        COUNTIF(o.status_group = 'cancelled') AS cancelled_orders,
        COUNTIF(o.status_group NOT IN ('success','returned','cancelled')) AS pending_orders,
        ROUND(SUM(CASE WHEN o.status_group = 'success' THEN o.revenue_L3_success ELSE 0 END), 0) AS revenue_success,
        ROUND(SUM(CASE WHEN o.status_group = 'success' THEN o.revenue_L3_success ELSE 0 END), 0) AS revenue_confirmed,
        ROUND(SUM(CASE WHEN o.status_group = 'success' THEN o.revenue_L3_success ELSE 0 END), 0) AS delivered_revenue,
        ROUND(SUM(o.shipping_fee), 0) AS shipping_cost
    FROM `{DS}.vw_fact_orders` o
    GROUP BY 1
),
ads_daily AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        ROUND(SUM(a.spend), 2) AS ads_spend_usd,
        SUM(COALESCE(a.impressions, 0)) AS impressions,
        SUM(COALESCE(a.clicks, 0)) AS clicks,
        SUM(COALESCE(a.reach, 0)) AS reach
    FROM `{DS}.fb_ads_data` a
    GROUP BY 1
),
cogs_daily AS (
    SELECT
        o.order_date AS report_date,
        ROUND(SUM(CASE WHEN o.status_group = 'success' THEN 
            COALESCE(pc.cost_ron, 0) * oi.quantity
        ELSE 0 END), 0) AS cogs
    FROM `{DS}.vw_fact_orders` o
    JOIN `{DS}.order_items` oi ON o.order_id = oi.order_id
    LEFT JOIN `{DS}.product_cogs` pc ON oi.variation_id = pc.variation_id
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
    ROUND(COALESCE(ad.ads_spend_usd, 0) * fx.rate, 0) AS ads_spend_ron,
    COALESCE(ad.ads_spend_usd, 0) AS ads_spend_usd,
    COALESCE(od.shipping_cost, 0) AS shipping_cost,
    0 AS fulfillment_cost,
    0 AS return_fulfillment_cost,
    COALESCE(cd.cogs, 0) AS cogs,
    ROUND(COALESCE(od.revenue_confirmed, 0) - COALESCE(cd.cogs, 0) - COALESCE(ad.ads_spend_usd, 0) * fx.rate - COALESCE(od.shipping_cost, 0), 0) AS net_profit,
    COALESCE(ad.impressions, 0) AS impressions,
    COALESCE(ad.clicks, 0) AS clicks,
    COALESCE(ad.reach, 0) AS reach,
    0 AS messages,
    0 AS total_leads,
    ROUND(SAFE_DIVIDE(od.revenue_success, NULLIF(ad.ads_spend_usd * fx.rate, 0)), 2) AS roas_l3,
    ROUND(SAFE_DIVIDE(od.returned_orders * 100, NULLIF(od.total_orders, 0)), 1) AS return_rate_pct,
    ROUND(SAFE_DIVIDE(od.success_orders * 100, NULLIF(od.total_orders, 0)), 1) AS success_rate_pct,
    0 AS cpl_ron
FROM orders_daily od
FULL OUTER JOIN ads_daily ad ON od.report_date = ad.report_date
LEFT JOIN cogs_daily cd ON COALESCE(od.report_date, ad.report_date) = cd.report_date
CROSS JOIN fx
""")

# ═══ Fix mart_product_insights ═══
print('\n═══ Fix mart_product_insights ═══')
run('mart_product_insights', f"""
CREATE OR REPLACE VIEW `{DS}.mart_product_insights` AS
WITH 
fx AS (
    SELECT COALESCE(MAX(rate), 4.6) as rate FROM `{DS}.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'RON'
),
order_products AS (
    SELECT
        o.order_date AS report_date,
        COALESCE(pt.custom_id, 'UNKNOWN') AS product_code,
        COALESCE(pt.name, 'Unknown Product') AS product_name,
        o.order_id,
        o.status_group,
        ROUND(o.revenue_L1_lead * SAFE_DIVIDE(oi.quantity, 
            SUM(oi.quantity) OVER(PARTITION BY o.order_id)), 2) AS item_revenue_lead,
        ROUND(o.revenue_L3_success * SAFE_DIVIDE(oi.quantity, 
            SUM(oi.quantity) OVER(PARTITION BY o.order_id)), 2) AS item_revenue_success,
        oi.quantity,
        COALESCE(pc.cost_ron, 0) * oi.quantity AS item_cogs,
        o.derived_market AS market
    FROM `{DS}.vw_fact_orders` o
    JOIN `{DS}.order_items` oi ON o.order_id = oi.order_id
    LEFT JOIN `{DS}.product_template` pt ON oi.product_id = pt.id
    LEFT JOIN `{DS}.product_cogs` pc ON oi.variation_id = pc.variation_id
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
ads_by_product AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(1)])) AS product_code,
        SUM(a.spend) AS ads_usd,
        SUM(COALESCE(a.impressions, 0)) AS impressions,
        SUM(COALESCE(a.clicks, 0)) AS clicks
    FROM `{DS}.fb_ads_data` a
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
""")

# ═══ Verify ═══
print('\n═══ Verify ═══')
v = list(client.query(f"""
SELECT SUM(revenue_confirmed) as rev, SUM(ads_spend_ron) as ads, SUM(cogs) as cogs, SUM(success_orders) as success
FROM `{DS}.vw_fact_daily_pnl_flex`
""").result())
for r in v:
    print(f'  pnl_flex: rev={r.rev}, ads={r.ads}, cogs={r.cogs}, success={r.success}')

v2 = list(client.query(f"""
SELECT product_code, SUM(ads_spend_ron) as ads, SUM(delivered_revenue) as rev
FROM `{DS}.mart_product_insights`
WHERE product_code != 'UNKNOWN'
GROUP BY 1 ORDER BY rev DESC LIMIT 5
""").result())
for r in v2:
    print(f'  Product {r.product_code}: rev={r.rev}, ads={r.ads}')
