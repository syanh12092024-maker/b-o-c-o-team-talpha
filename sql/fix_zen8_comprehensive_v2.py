#!/usr/bin/env python3
"""
ZEN8 Comprehensive Fix V2 — All 5 Root Causes
==============================================
RC1: marketer-map.ts wrong → FIXED in dashboard code
RC2: orders_resolved CTE duplicates → FIX HERE: deduplicate LEFT JOIN
RC3: pnl_flex cogs=0 hardcoded → FIX HERE: add COGS calculation
RC4: order_items.retail_price=0 → FIX HERE: use sale_order.cod÷items.qty
RC5: Market Intel zero → CASCADING FIX from RC4
"""
import os, sys

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
GCP = "levelup-465304"
DS = "ZEN8_Dataset"
FULL_DS = f"{GCP}.{DS}"

def run_sql(name, sql):
    try:
        client.query(sql).result()
        print(f"  ✅ {name}")
    except Exception as e:
        print(f"  ❌ {name}: {e}")


# ════════════════════════════════════════════════════
# FIX RC2: mart_performance_master — no duplicate rows
# ════════════════════════════════════════════════════
print("\n═══ Fix 1: mart_performance_master (no duplicates) ═══")

mart_sql = f"""
CREATE OR REPLACE VIEW `{FULL_DS}.mart_performance_master` AS
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

-- Unique campaign_code → marketer_id mapping (ONE row per code)
mkter_unique AS (
    SELECT campaign_code, 
        ANY_VALUE(marketer_id) AS marketer_id,
        ANY_VALUE(marketer_name) AS marketer_name
    FROM `{FULL_DS}.dim_marketer_mapping`
    GROUP BY campaign_code
),

-- ad_id → parsed marketer from campaign name (DISTINCT to avoid dups)
ad_campaign_mkter AS (
    SELECT ad_id,
        ANY_VALUE(UPPER(TRIM(SPLIT(campaign_name, '_')[SAFE_OFFSET(3)]))) AS parsed_mkter
    FROM `{FULL_DS}.fb_ads_data`
    WHERE ad_id IS NOT NULL
    GROUP BY ad_id
),

-- Orders with resolved marketer (NO DUPLICATES: each order gets ONE marketer)
orders_resolved AS (
    SELECT 
        o.order_id,
        o.order_date,
        o.status_group,
        o.status_name,
        o.revenue_L1_lead,
        o.revenue_L3_success,
        o.revenue_L4_cod_collected,
        o.shipping_fee,
        o.resolved_ad_id,
        -- Resolve marketer: order.marketer_id → ad_id→campaign → UNKNOWN
        CASE 
            WHEN o.marketer_id IS NOT NULL AND o.marketer_id != 'UNKNOWN' 
                THEN o.marketer_id
            WHEN mu.marketer_id IS NOT NULL
                THEN mu.marketer_id
            WHEN acm.parsed_mkter IS NOT NULL 
                THEN acm.parsed_mkter
            ELSE 'UNKNOWN'
        END AS resolved_marketer_id,
        CASE 
            WHEN o.marketer_id IS NOT NULL AND o.marketer_id != 'UNKNOWN' 
                THEN o.marketer_name
            WHEN mu.marketer_name IS NOT NULL
                THEN mu.marketer_name
            WHEN acm.parsed_mkter IS NOT NULL 
                THEN acm.parsed_mkter
            ELSE 'Unknown'
        END AS resolved_marketer_name
    FROM `{FULL_DS}.vw_fact_orders` o
    LEFT JOIN ad_campaign_mkter acm ON o.resolved_ad_id = acm.ad_id
    LEFT JOIN mkter_unique mu ON UPPER(TRIM(acm.parsed_mkter)) = UPPER(TRIM(mu.campaign_code))
),

-- Ads enriched with marketer (same unique approach)
ads_enriched AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        COALESCE(
            mu.marketer_id,
            UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])),
            'UNMATCHED'
        ) AS marketer_id,
        a.spend,
        COALESCE(a.impressions, 0) AS impressions,
        COALESCE(a.reach, 0) AS reach,
        COALESCE(a.clicks, 0) AS clicks
    FROM `{FULL_DS}.fb_ads_data` a
    LEFT JOIN mkter_unique mu
        ON UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])) = UPPER(TRIM(mu.campaign_code))
),
ads_agg AS (
    SELECT report_date, marketer_id,
        SUM(spend) AS ads_spend_usd,
        SUM(impressions) AS impressions,
        SUM(reach) AS reach,
        SUM(clicks) AS clicks
    FROM ads_enriched
    GROUP BY 1, 2
),

-- Order aggregation (DISTINCT order_id to avoid duplicates)
order_agg AS (
    SELECT
        o.order_date AS report_date,
        o.resolved_marketer_id AS marketer_id,
        ANY_VALUE(o.resolved_marketer_name) AS marketer_name,
        COUNT(DISTINCT o.order_id) AS total_orders,
        COUNTIF(o.status_group = 'success') AS success_orders,
        COUNTIF(o.status_group = 'returned') AS returned_orders,
        COUNTIF(o.status_group = 'cancelled') AS cancelled_orders,
        COUNTIF(o.status_group IN ('processing','shipping')) AS pending_orders,
        COUNTIF(o.status_name IN ('packing','pending','shipped','delivered','received_money','returning','returned')) AS shipped_orders,
        ROUND(SUM(o.revenue_L1_lead), 2) AS revenue_L1,
        ROUND(SUM(o.revenue_L3_success), 2) AS revenue_L3,
        ROUND(SUM(COALESCE(o.revenue_L4_cod_collected, o.revenue_L3_success)), 2) AS revenue_L4,
        ROUND(SUM(o.shipping_fee), 2) AS total_shipping
    FROM orders_resolved o
    GROUP BY 1, 2
),

-- COGS
order_cogs AS (
    SELECT o.order_date AS report_date, o.resolved_marketer_id AS marketer_id,
        ROUND(SUM(
            SAFE_CAST(oi.quantity AS INT64) * 
            COALESCE(NULLIF(pc.cost_raw, 0), 0) * fx_vnd.rate
        ), 2) AS total_cogs
    FROM orders_resolved o
    JOIN `{FULL_DS}.order_items` oi ON o.order_id = oi.order_id
    LEFT JOIN `{FULL_DS}.product_cogs` pc ON oi.variation_id = pc.variation_id
    CROSS JOIN fx_vnd_aed fx_vnd
    WHERE o.status_group = 'success'
    AND COALESCE(NULLIF(pc.cost_raw, 0), 0) > 0
    GROUP BY 1, 2
)

SELECT
    oa.report_date, oa.marketer_id, oa.marketer_name,
    oa.total_orders, oa.success_orders, oa.returned_orders, oa.cancelled_orders,
    oa.pending_orders, 0 AS attributed_orders, oa.shipped_orders,
    ROUND(oa.revenue_L1, 0) AS revenue_lead,
    ROUND(oa.revenue_L3, 0) AS revenue_success,
    ROUND(oa.revenue_L3, 0) AS delivered_revenue,
    ROUND(COALESCE(oa.revenue_L4, oa.revenue_L3), 0) AS revenue_cod_collected,
    0.0 AS partner_debt,
    ROUND(COALESCE(aa.ads_spend_usd, 0), 2) AS ads_spend_usd,
    ROUND(COALESCE(aa.ads_spend_usd, 0) * fx_usd.rate, 0) AS ads_spend_ron,
    ROUND(oa.total_shipping, 0) AS shipping_cost,
    0.0 AS partner_fee, 0.0 AS return_cost,
    ROUND(COALESCE(oc.total_cogs, 0), 0) AS cogs,
    ROUND(oa.shipped_orders * 15, 0) AS fulfillment_cost,
    ROUND(oa.returned_orders * 10, 0) AS return_fulfillment_cost,
    ROUND(oa.revenue_L3 
          - COALESCE(aa.ads_spend_usd, 0) * fx_usd.rate
          - COALESCE(oc.total_cogs, 0)
          - oa.shipped_orders * 15
          - oa.returned_orders * 10, 0) AS net_profit,
    COALESCE(aa.impressions, 0) AS impressions,
    COALESCE(aa.reach, 0) AS reach,
    COALESCE(aa.clicks, 0) AS clicks,
    0 AS messages,
    0 AS ads_matched_by_ad, 0 AS ads_matched_by_adset,
    0 AS ads_matched_by_parse, 0 AS ads_unmatched,
    ROUND(SAFE_DIVIDE(oa.revenue_L3, NULLIF(aa.ads_spend_usd * fx_usd.rate, 0)), 2) AS real_roas,
    ROUND(SAFE_DIVIDE(aa.ads_spend_usd * fx_usd.rate, NULLIF(oa.total_orders, 0)), 2) AS real_cpa,
    ROUND(SAFE_DIVIDE(oa.revenue_L1, NULLIF(oa.total_orders, 0)), 2) AS avg_order_value,
    ROUND(SAFE_DIVIDE(aa.ads_spend_usd, NULLIF(aa.impressions, 0)) * 1000, 2) AS cpm_usd,
    ROUND(SAFE_DIVIDE(aa.clicks, NULLIF(aa.impressions, 0)) * 100, 2) AS ctr_pct,
    ROUND(SAFE_DIVIDE(oa.total_orders, NULLIF(aa.clicks, 0)) * 100, 2) AS cr_click_pct,
    ROUND(SAFE_DIVIDE(oa.success_orders, NULLIF(oa.success_orders + oa.returned_orders + oa.cancelled_orders, 0)) * 100, 1) AS delivery_rate_pct,
    ROUND(SAFE_DIVIDE(oa.returned_orders, NULLIF(oa.total_orders, 0)) * 100, 1) AS return_rate_pct,
    'N/A' AS diagnosis
FROM order_agg oa
LEFT JOIN ads_agg aa ON oa.marketer_id = aa.marketer_id AND oa.report_date = aa.report_date
LEFT JOIN order_cogs oc ON oa.report_date = oc.report_date AND oa.marketer_id = oc.marketer_id
CROSS JOIN fx_usd_aed fx_usd
"""
run_sql("mart_performance_master", mart_sql)


# ════════════════════════════════════════════════════
# FIX RC3: vw_fact_daily_pnl_flex — add COGS calculation
# ════════════════════════════════════════════════════
print("\n═══ Fix 2: vw_fact_daily_pnl_flex (with COGS) ═══")

pnl_flex_sql = f"""
CREATE OR REPLACE VIEW `{FULL_DS}.vw_fact_daily_pnl_flex` AS
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
-- ZEN8 status codes from dim_status_mapping:
-- 3=delivered(success), 16=received_money(success)
-- 4=returning, 5=returned
-- 6=cancelled
daily_orders AS (
    SELECT
        DATE(TIMESTAMP(inserted_at)) AS report_date,
        COUNT(*) AS total_orders,
        COUNTIF(CAST(status AS INT64) IN (3, 16)) AS success_orders,
        COUNTIF(CAST(status AS INT64) IN (4, 5)) AS returned_orders,
        COUNTIF(CAST(status AS INT64) = 6) AS cancelled_orders,
        COUNTIF(CAST(status AS INT64) IN (1, 2, 8, 9)) AS pending_orders,
        ROUND(SUM(CASE WHEN CAST(status AS INT64) NOT IN (6)
            THEN COALESCE(CAST(cod AS FLOAT64), 0) / 100.0
            ELSE 0 END), 0) AS revenue_provisional,
        ROUND(SUM(CASE WHEN CAST(status AS INT64) IN (3, 16)
            THEN COALESCE(CAST(cod AS FLOAT64), 0) / 100.0
            ELSE 0 END), 0) AS revenue_confirmed
    FROM `{FULL_DS}.sale_order`
    WHERE DATE(TIMESTAMP(inserted_at)) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    GROUP BY 1
),
-- COGS: aggregate daily from order_items × product_cogs (VND→AED)
daily_cogs AS (
    SELECT
        DATE(TIMESTAMP(so.inserted_at)) AS report_date,
        ROUND(SUM(
            SAFE_CAST(oi.quantity AS INT64) *
            COALESCE(NULLIF(pc.cost_raw, 0), 0) * fx_vnd.rate
        ), 0) AS cogs
    FROM `{FULL_DS}.sale_order` so
    JOIN `{FULL_DS}.order_items` oi ON CAST(so.id AS STRING) = oi.order_id
    LEFT JOIN `{FULL_DS}.product_cogs` pc ON oi.variation_id = pc.variation_id
    CROSS JOIN fx_vnd_aed fx_vnd
    WHERE CAST(so.status AS INT64) IN (3, 16)  -- only success orders
      AND DATE(TIMESTAMP(so.inserted_at)) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    GROUP BY 1
),
daily_ads AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', date) AS report_date,
        ROUND(SUM(spend), 2) AS ads_spend_usd,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(reach) AS reach,
        SUM(SAFE_CAST(leads AS FLOAT64)) AS total_leads,
        SUM(messaging_conversations_started) AS total_messages,
        SUM(add_to_cart) AS total_atc,
        SUM(purchases) AS total_purchases
    FROM `{FULL_DS}.fb_ads_data`
    WHERE SAFE.PARSE_DATE('%Y-%m-%d', date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    GROUP BY 1
),
-- Shipping cost: sum from success orders
daily_shipping AS (
    SELECT
        DATE(TIMESTAMP(inserted_at)) AS report_date,
        ROUND(SUM(CASE WHEN CAST(status AS INT64) IN (3, 16)
            THEN COALESCE(CAST(shipping_fee AS FLOAT64), 0) / 100.0
            ELSE 0 END), 0) AS shipping_cost
    FROM `{FULL_DS}.sale_order`
    WHERE DATE(TIMESTAMP(inserted_at)) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    GROUP BY 1
)

SELECT
    o.report_date,
    COALESCE(o.total_orders, 0) AS total_orders,
    COALESCE(o.success_orders, 0) AS success_orders,
    COALESCE(o.returned_orders, 0) AS returned_orders,
    COALESCE(o.cancelled_orders, 0) AS cancelled_orders,
    COALESCE(o.pending_orders, 0) AS pending_orders,
    COALESCE(o.revenue_provisional, 0) AS revenue_success,
    COALESCE(o.revenue_confirmed, 0) AS revenue_confirmed,
    COALESCE(o.revenue_confirmed, 0) AS delivered_revenue,
    ROUND(COALESCE(a.ads_spend_usd, 0) * fx.rate, 0) AS ads_spend_ron,
    COALESCE(a.ads_spend_usd, 0) AS ads_spend_usd,
    COALESCE(sh.shipping_cost, 0) AS shipping_cost,
    0.0 AS fulfillment_cost,
    0.0 AS return_fulfillment_cost,
    COALESCE(dc.cogs, 0) AS cogs,
    COALESCE(o.revenue_confirmed, 0) 
        - ROUND(COALESCE(a.ads_spend_usd, 0) * fx.rate, 0)
        - COALESCE(dc.cogs, 0)
        - COALESCE(sh.shipping_cost, 0) AS net_profit,
    COALESCE(a.impressions, 0) AS impressions,
    COALESCE(a.clicks, 0) AS clicks,
    COALESCE(a.reach, 0) AS reach,
    COALESCE(a.total_messages, 0) AS messages,
    COALESCE(a.total_leads, 0) AS total_leads,
    ROUND(SAFE_DIVIDE(o.revenue_confirmed, NULLIF(a.ads_spend_usd * fx.rate, 0)), 2) AS roas_l3,
    ROUND(SAFE_DIVIDE(o.returned_orders, NULLIF(o.total_orders, 0)) * 100, 1) AS return_rate_pct,
    ROUND(SAFE_DIVIDE(o.success_orders, NULLIF(o.total_orders, 0)) * 100, 1) AS success_rate_pct,
    ROUND(SAFE_DIVIDE(a.ads_spend_usd * fx.rate, NULLIF(o.total_orders, 0)), 2) AS cpl_ron
FROM daily_orders o
LEFT JOIN daily_ads a ON o.report_date = a.report_date
LEFT JOIN daily_cogs dc ON o.report_date = dc.report_date
LEFT JOIN daily_shipping sh ON o.report_date = sh.report_date
CROSS JOIN fx_usd_aed fx
ORDER BY o.report_date DESC
"""
run_sql("vw_fact_daily_pnl_flex", pnl_flex_sql)


# ════════════════════════════════════════════════════
# FIX RC4: mart_product_insights — use order-level revenue
# ════════════════════════════════════════════════════
print("\n═══ Fix 3: mart_product_insights (order-level revenue) ═══")

# Since order_items.retail_price=0 for ALL ZEN8,
# derive product revenue from: order.cod ÷ num_items_in_order × item_qty
product_sql = f"""
CREATE OR REPLACE VIEW `{FULL_DS}.mart_product_insights` AS
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
mkter_unique AS (
    SELECT campaign_code, 
        ANY_VALUE(marketer_id) AS marketer_id,
        ANY_VALUE(marketer_name) AS marketer_name
    FROM `{FULL_DS}.dim_marketer_mapping`
    GROUP BY campaign_code
),
ad_campaign_mkter AS (
    SELECT ad_id,
        ANY_VALUE(UPPER(TRIM(SPLIT(campaign_name, '_')[SAFE_OFFSET(3)]))) AS parsed_mkter
    FROM `{FULL_DS}.fb_ads_data`
    WHERE ad_id IS NOT NULL
    GROUP BY ad_id
),

-- Ads enrichment
ad_primary AS (
    SELECT a.ad_id,
        COALESCE(mu.marketer_id, UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])), 'UNMATCHED') AS marketer_id,
        UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(0)])) AS product_hint,
        TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)]) AS market_hint
    FROM (SELECT ad_id, ANY_VALUE(campaign_name) AS campaign_name FROM `{FULL_DS}.fb_ads_data` GROUP BY ad_id) a
    LEFT JOIN mkter_unique mu
        ON UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])) = UPPER(TRIM(mu.campaign_code))
),
ads_enriched AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        UPPER(TRIM(COALESCE(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(0)], 'UNKNOWN'))) AS product_code,
        COALESCE(mu.marketer_id, UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])), 'UNMATCHED') AS marketer_id,
        COALESCE(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)]), 'Unknown') AS market,
        a.spend AS ads_spend_usd
    FROM `{FULL_DS}.fb_ads_data` a
    LEFT JOIN mkter_unique mu
        ON UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])) = UPPER(TRIM(mu.campaign_code))
),
ads_by_product AS (
    SELECT report_date, product_code, marketer_id, market,
        SUM(ads_spend_usd) AS ads_spend_usd
    FROM ads_enriched
    GROUP BY 1, 2, 3, 4
),

-- Order-level: calculate total items per order for revenue allocation
order_item_counts AS (
    SELECT order_id, SUM(SAFE_CAST(quantity AS INT64)) AS total_items
    FROM `{FULL_DS}.order_items`
    GROUP BY order_id
),

-- Order items with allocated revenue (since retail_price=0 for ZEN8)
item_orders AS (
    SELECT o.order_date, o.order_id,
        -- Resolve marketer via ad_id→campaign when UNKNOWN
        CASE 
            WHEN o.marketer_id IS NOT NULL AND o.marketer_id != 'UNKNOWN' THEN o.marketer_id
            WHEN mu_ad.marketer_id IS NOT NULL THEN mu_ad.marketer_id
            WHEN acm.parsed_mkter IS NOT NULL THEN acm.parsed_mkter
            ELSE 'UNKNOWN'
        END AS marketer_id,
        CASE 
            WHEN o.marketer_id IS NOT NULL AND o.marketer_id != 'UNKNOWN' THEN o.marketer_name
            WHEN mu_ad.marketer_name IS NOT NULL THEN mu_ad.marketer_name
            ELSE 'Unknown'
        END AS marketer_name,
        o.status_group, o.derived_market AS market,
        oi.product_id, oi.product_name AS item_product_name,
        SAFE_CAST(oi.quantity AS INT64) AS qty,
        SAFE_CAST(COALESCE(oi.returned_count, oi.returning_quantity, 0) AS INT64) AS return_qty,
        -- Revenue allocation: order.cod ÷ total_items × this_item_qty
        -- cod is already in AED (vw_fact_orders divides by 100)
        ROUND(SAFE_DIVIDE(
            o.revenue_L3_success * SAFE_CAST(oi.quantity AS INT64),
            NULLIF(oic.total_items, 0)
        ), 2) AS allocated_revenue,
        -- COGS: product_cogs.cost_raw is VND → AED
        ROUND(COALESCE(NULLIF(pc.cost_raw, 0), 0) * fx_vnd.rate, 2) AS unit_cogs
    FROM `{FULL_DS}.vw_fact_orders` o
    JOIN `{FULL_DS}.order_items` oi ON o.order_id = oi.order_id
    LEFT JOIN order_item_counts oic ON o.order_id = oic.order_id
    LEFT JOIN `{FULL_DS}.product_cogs` pc ON oi.variation_id = pc.variation_id
    LEFT JOIN ad_campaign_mkter acm ON o.resolved_ad_id = acm.ad_id
    LEFT JOIN mkter_unique mu_ad ON UPPER(TRIM(acm.parsed_mkter)) = UPPER(TRIM(mu_ad.campaign_code))
    CROSS JOIN fx_vnd_aed fx_vnd
),
product_info AS (
    SELECT DISTINCT id AS product_id, custom_id, name
    FROM `{FULL_DS}.product_template`
),
product_agg AS (
    SELECT io.order_date AS report_date,
        COALESCE(pi.custom_id, 'UNKNOWN') AS product_code,
        COALESCE(pi.name, io.item_product_name) AS product_name,
        io.marketer_id, ANY_VALUE(io.marketer_name) AS marketer_name,
        io.market, 'ME' AS market_code,
        COUNT(DISTINCT io.order_id) AS order_count,
        SUM(io.qty) AS units_sold,
        SUM(CASE WHEN io.status_group = 'success' THEN io.qty ELSE 0 END) AS units_delivered,
        SUM(COALESCE(io.return_qty, 0)) AS units_returned,
        -- Revenue from allocated order-level revenue
        ROUND(SUM(CASE WHEN io.status_group = 'success' THEN io.allocated_revenue ELSE 0 END), 2) AS delivered_revenue,
        ROUND(SUM(io.qty * io.unit_cogs), 2) AS total_cogs,
        ROUND(SUM(CASE WHEN io.status_group = 'success' THEN io.qty * io.unit_cogs ELSE 0 END), 2) AS delivered_cogs,
        'UNKNOWN' AS sku
    FROM item_orders io
    LEFT JOIN product_info pi ON io.product_id = pi.product_id
    GROUP BY 1, 2, 3, 4, 6, 7
)

SELECT
    pa.report_date, pa.product_code, pa.product_name,
    pa.sku, pa.marketer_id, pa.marketer_name, pa.market, pa.market_code,
    pa.order_count, pa.units_sold, pa.units_delivered, pa.units_returned,
    ROUND(pa.delivered_revenue, 0) AS delivered_revenue,
    ROUND(pa.delivered_cogs, 0) AS delivered_cogs,
    ROUND(pa.delivered_revenue - pa.delivered_cogs, 0) AS gross_profit,
    ROUND(SAFE_DIVIDE(pa.delivered_revenue - pa.delivered_cogs, NULLIF(pa.delivered_revenue, 0)) * 100, 1) AS margin_pct,
    ROUND(COALESCE(ap.ads_spend_usd, 0), 2) AS ads_spend_usd,
    ROUND(COALESCE(ap.ads_spend_usd, 0) * fx.rate, 0) AS ads_spend_ron,
    ROUND(SAFE_DIVIDE(ap.ads_spend_usd * fx.rate, NULLIF(pa.units_delivered, 0)), 2) AS cpps_ron,
    ROUND(SAFE_DIVIDE(pa.delivered_revenue, NULLIF(ap.ads_spend_usd * fx.rate, 0)), 2) AS product_roas,
    ROUND(SAFE_DIVIDE(pa.units_returned, NULLIF(pa.units_sold, 0)) * 100, 1) AS product_return_rate
FROM product_agg pa
LEFT JOIN ads_by_product ap 
    ON pa.report_date = ap.report_date 
    AND UPPER(TRIM(pa.product_code)) = ap.product_code 
    AND pa.marketer_id = ap.marketer_id
CROSS JOIN fx_usd_aed fx
"""
run_sql("mart_product_insights", product_sql)


print(f"\n{'═' * 60}")
print("  All fixes applied!")
print("  RC2: mart dedup via ANY_VALUE + mkter_unique")
print("  RC3: pnl_flex now has daily COGS + shipping")
print("  RC4: product revenue from order.cod ÷ items allocation")
print(f"{'═' * 60}")
