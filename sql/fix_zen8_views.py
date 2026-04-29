#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════╗
║  Fix ZEN8 BQ Views — Multi-Currency Normalization            ║
║                                                              ║
║  Problem: Cloned STRAMARK views have 3 currency conflicts:   ║
║  - sale_order prices: AED fils (÷100 = AED)                  ║
║  - product_cogs.cost_raw: VND (NOT AED)                      ║
║  - fb_ads_data.spend: USD                                    ║
║                                                              ║
║  Fix: Normalize everything to AED in views,                  ║
║  then dashboard converts AED→VND                             ║
╚══════════════════════════════════════════════════════════════╝

Data verification:
  - sale_order.total_price median = 11,800 (AED fils, 118 AED)
  - product_cogs.cost_raw = 22,825 (VND, ~0.9 USD, ~3.3 AED)
  - fb_ads_data.spend = USD
  - AOV = 700K-1M VND = 118 AED = ~32 USD ✓
"""
import os, sys

# Auto-detect credentials
key_paths = [
    os.path.join(os.path.dirname(__file__), "..", "bigquery_key.json"),
    "/Users/ngonhat/Desktop/Agentic-AI-Levelup/bigquery_key.json",
    "/Users/macbookpro/Desktop/Agentic-AI-Levelup/bigquery_key.json",
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
DRY_RUN = "--dry-run" in sys.argv

def run_sql(name, sql):
    """Execute SQL, print result."""
    if DRY_RUN:
        print(f"  [DRY-RUN] {name}")
        print(f"    SQL: {sql[:200]}...")
        return
    try:
        client.query(sql).result()
        print(f"  ✅ {name}")
    except Exception as e:
        print(f"  ❌ {name}: {e}")


# ════════════════════════════════════════════════════
# Step 1: Fix cost_exchange_rates — add proper AED rates
# ════════════════════════════════════════════════════
print("\n═══ Step 1: Fix exchange rates ═══")

# We need:
# - USD → AED (for ads conversion): ~3.67 AED per USD
# - VND → AED (for COGS conversion): 1 AED ≈ 6,900 VND → rate = 1/6900 = 0.000145
fx_inserts = [
    # USD to AED (for normalizing ads spend to AED)
    ("USD", "AED", 3.67, "manual_zen8_fix"),
    # VND to AED (for normalizing product_cogs from VND to AED)  
    ("VND", "AED", 0.000145, "manual_zen8_fix"),
    # AED to VND (for dashboard display)
    ("AED", "VND", 6900, "manual_zen8_fix"),
]

for from_c, to_c, rate, source in fx_inserts:
    sql = f"""
    DELETE FROM `{FULL_DS}.cost_exchange_rates` 
    WHERE from_currency = '{from_c}' AND to_currency = '{to_c}' AND source = '{source}'
    """
    run_sql(f"Clean {from_c}→{to_c}", sql)
    
    sql = f"""
    INSERT INTO `{FULL_DS}.cost_exchange_rates` (from_currency, to_currency, rate, effective_date, source)
    VALUES ('{from_c}', '{to_c}', {rate}, CURRENT_DATE(), '{source}')
    """
    run_sql(f"Insert {from_c}→{to_c} = {rate}", sql)


# ════════════════════════════════════════════════════
# Step 2: Fix mart_performance_master
# ════════════════════════════════════════════════════
print("\n═══ Step 2: Fix mart_performance_master ═══")

# Key changes from STRAMARK version:
# 1. Revenue: already in AED (vw_fact_orders divides by 100) ✅
# 2. COGS: product_cogs.cost_raw is in VND → convert to AED
# 3. Ads: spend is in USD → convert to AED
# 4. Fulfillment: ZEN8 uses AJEX not EU 3PL → set constants in AED
mart_sql = f"""
CREATE OR REPLACE VIEW `{FULL_DS}.mart_performance_master` AS
WITH 
-- FX rates
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

-- Build ad_id → marketer_id mapping from actual orders
ad_marketer_map AS (
    SELECT
        resolved_ad_id AS ad_id,
        APPROX_TOP_COUNT(marketer_id, 1)[OFFSET(0)].value AS marketer_id
    FROM `{FULL_DS}.vw_fact_orders`
    WHERE resolved_ad_id IS NOT NULL
      AND marketer_id IS NOT NULL AND marketer_id != 'UNKNOWN'
    GROUP BY 1
),
adset_marketer_map AS (
    SELECT
        resolved_adset_id AS adset_id,
        APPROX_TOP_COUNT(marketer_id, 1)[OFFSET(0)].value AS marketer_id
    FROM `{FULL_DS}.vw_fact_orders`
    WHERE resolved_adset_id IS NOT NULL
      AND marketer_id IS NOT NULL AND marketer_id != 'UNKNOWN'
    GROUP BY 1
),
mkter_lookup AS (
    SELECT marketer_id, ANY_VALUE(campaign_code) AS campaign_code
    FROM `{FULL_DS}.dim_marketer_mapping`
    GROUP BY marketer_id
),

-- Ads aggregation with 3-level marketer resolution
ads_enriched AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        a.ad_id, a.adset_id, a.campaign_name,
        a.spend,
        COALESCE(a.impressions, 0) AS impressions,
        COALESCE(a.reach, 0) AS reach,
        COALESCE(a.clicks, 0) AS clicks,
        COALESCE(
            am.marketer_id,
            asm.marketer_id,
            ml.marketer_id,
            'UNMATCHED'
        ) AS marketer_id
    FROM `{FULL_DS}.fb_ads_data` a
    LEFT JOIN ad_marketer_map am ON a.ad_id = am.ad_id
    LEFT JOIN adset_marketer_map asm ON a.adset_id = asm.adset_id
    LEFT JOIN mkter_lookup ml 
        ON UPPER(TRIM(SPLIT(a.campaign_name, ' - ')[SAFE_OFFSET(5)])) = UPPER(TRIM(ml.campaign_code))
),
ads_agg AS (
    SELECT
        report_date, marketer_id,
        SUM(spend) AS ads_spend_usd,
        SUM(impressions) AS impressions,
        SUM(reach) AS reach,
        SUM(clicks) AS clicks
    FROM ads_enriched
    GROUP BY 1, 2
),

-- Order aggregation
order_agg AS (
    SELECT
        o.order_date AS report_date,
        o.marketer_id,
        ANY_VALUE(o.marketer_name) AS marketer_name,
        COUNT(DISTINCT o.order_id) AS total_orders,
        COUNTIF(o.status_group = 'success') AS success_orders,
        COUNTIF(o.status_group = 'returned') AS returned_orders,
        COUNTIF(o.status_group = 'cancelled') AS cancelled_orders,
        COUNTIF(o.status_group IN ('processing','shipping')) AS pending_orders,
        COUNTIF(o.status_name IN ('packing','pending','shipped','delivered','received_money','returning','returned')) AS shipped_orders,
        -- Revenue already in AED (vw_fact_orders divides by 100)
        ROUND(SUM(o.revenue_L1_lead), 2) AS revenue_L1,
        ROUND(SUM(o.revenue_L3_success), 2) AS revenue_L3,
        ROUND(SUM(COALESCE(o.revenue_L4_cod_collected, o.revenue_L3_success)), 2) AS revenue_L4,
        ROUND(SUM(o.shipping_fee), 2) AS total_shipping
    FROM `{FULL_DS}.vw_fact_orders` o
    GROUP BY 1, 2
),

-- COGS: product_cogs.cost_raw is in VND → convert to AED
order_cogs AS (
    SELECT o.order_date AS report_date, o.marketer_id,
        -- cost_raw is in VND, convert to AED using VND→AED rate
        ROUND(SUM(
            SAFE_CAST(oi.quantity AS INT64) * 
            COALESCE(
                NULLIF(pc.cost_raw, 0),
                0
            ) * fx_vnd.rate  -- VND → AED conversion
        ), 2) AS total_cogs
    FROM `{FULL_DS}.vw_fact_orders` o
    JOIN `{FULL_DS}.order_items` oi ON o.order_id = oi.order_id
    LEFT JOIN `{FULL_DS}.product_cogs` pc ON oi.variation_id = pc.variation_id
    CROSS JOIN fx_vnd_aed fx_vnd
    WHERE o.status_group = 'success'
    AND COALESCE(NULLIF(pc.cost_raw, 0), 0) > 0
    GROUP BY 1, 2
)

-- FINAL SELECT: All values normalized to AED
SELECT
    oa.report_date, oa.marketer_id, oa.marketer_name,
    oa.total_orders, oa.success_orders, oa.returned_orders, oa.cancelled_orders,
    oa.pending_orders, 0 AS attributed_orders,
    oa.shipped_orders,
    
    ROUND(oa.revenue_L1, 0) AS revenue_lead,
    ROUND(oa.revenue_L3, 0) AS revenue_success,
    ROUND(oa.revenue_L3, 0) AS delivered_revenue,
    ROUND(COALESCE(oa.revenue_L4, oa.revenue_L3), 0) AS revenue_cod_collected,
    0.0 AS partner_debt,
    
    -- Ads: USD → AED
    ROUND(COALESCE(aa.ads_spend_usd, 0), 2) AS ads_spend_usd,
    ROUND(COALESCE(aa.ads_spend_usd, 0) * fx_usd.rate, 0) AS ads_spend_ron,
    ROUND(oa.total_shipping, 0) AS shipping_cost,
    0.0 AS partner_fee,
    0.0 AS return_cost,
    ROUND(COALESCE(oc.total_cogs, 0), 0) AS cogs,
    
    -- ZEN8: no EU 3PL, use flat rate in AED per shipped order
    ROUND(oa.shipped_orders * 15, 0) AS fulfillment_cost,  -- ~15 AED per order (3PL estimate)
    ROUND(oa.returned_orders * 10, 0) AS return_fulfillment_cost,  -- ~10 AED per return
    
    -- Net profit in AED
    ROUND(oa.revenue_L3 
          - COALESCE(aa.ads_spend_usd, 0) * fx_usd.rate
          - COALESCE(oc.total_cogs, 0)
          - oa.shipped_orders * 15
          - oa.returned_orders * 10
    , 0) AS net_profit,
    
    COALESCE(aa.impressions, 0) AS impressions,
    COALESCE(aa.reach, 0) AS reach,
    COALESCE(aa.clicks, 0) AS clicks,
    0 AS messages,
    0 AS ads_matched_by_ad,
    0 AS ads_matched_by_adset,
    0 AS ads_matched_by_parse,
    0 AS ads_unmatched,
    
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
# Step 3: Fix vw_fact_daily_pnl_flex
# ════════════════════════════════════════════════════
print("\n═══ Step 3: Fix vw_fact_daily_pnl_flex ═══")

pnl_flex_sql = f"""
CREATE OR REPLACE VIEW `{FULL_DS}.vw_fact_daily_pnl_flex` AS

WITH 
fx_usd_aed AS (
    SELECT rate FROM `{FULL_DS}.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'AED'
    ORDER BY effective_date DESC LIMIT 1
),
-- ZEN8 status codes from dim_status_mapping:
-- 3=delivered(success), 16=received_money(success)
-- 4=returning, 5=returned
-- 6=cancelled
-- 1=submitted, 2=shipped, 8=packing, 9=pending
daily_orders AS (
    SELECT
        DATE(TIMESTAMP(inserted_at))                        AS report_date,
        COUNT(*)                                            AS total_orders,
        COUNTIF(CAST(status AS INT64) IN (3, 16))           AS success_orders,
        COUNTIF(CAST(status AS INT64) IN (4, 5))            AS returned_orders,
        COUNTIF(CAST(status AS INT64) = 6)                  AS cancelled_orders,
        COUNTIF(CAST(status AS INT64) IN (1, 2, 8, 9))     AS pending_orders,
        -- Revenue in AED: cod field is in AED fils (÷100 = AED)
        ROUND(SUM(CASE WHEN CAST(status AS INT64) NOT IN (6)
            THEN COALESCE(CAST(cod AS FLOAT64), 0) / 100.0
            ELSE 0 END), 0)                                 AS revenue_provisional,
        ROUND(SUM(CASE WHEN CAST(status AS INT64) IN (3, 16)
            THEN COALESCE(CAST(cod AS FLOAT64), 0) / 100.0
            ELSE 0 END), 0)                                 AS revenue_confirmed
    FROM `{FULL_DS}.sale_order`
    WHERE DATE(TIMESTAMP(inserted_at)) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    GROUP BY 1
),

daily_ads AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', date)                    AS report_date,
        ROUND(SUM(spend), 2)                                AS ads_spend_usd,
        SUM(impressions)                                    AS impressions,
        SUM(clicks)                                         AS clicks,
        SUM(reach)                                          AS reach,
        SUM(SAFE_CAST(leads AS FLOAT64))                    AS total_leads,
        SUM(messaging_conversations_started)                AS total_messages,
        SUM(add_to_cart)                                    AS total_atc,
        SUM(purchases)                                      AS total_purchases
    FROM `{FULL_DS}.fb_ads_data`
    WHERE SAFE.PARSE_DATE('%Y-%m-%d', date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    GROUP BY 1
)

SELECT
    o.report_date,
    COALESCE(o.total_orders, 0) AS total_orders,
    COALESCE(o.success_orders, 0) AS success_orders,
    COALESCE(o.returned_orders, 0) AS returned_orders,
    COALESCE(o.cancelled_orders, 0) AS cancelled_orders,
    COALESCE(o.pending_orders, 0) AS pending_orders,
    -- Revenue in AED
    COALESCE(o.revenue_provisional, 0) AS revenue_success,
    COALESCE(o.revenue_confirmed, 0) AS revenue_confirmed,
    COALESCE(o.revenue_confirmed, 0) AS delivered_revenue,
    -- Ads: USD → AED
    ROUND(COALESCE(a.ads_spend_usd, 0) * fx.rate, 0) AS ads_spend_ron,
    COALESCE(a.ads_spend_usd, 0) AS ads_spend_usd,
    0.0 AS shipping_cost,
    0.0 AS fulfillment_cost,
    0.0 AS return_fulfillment_cost,
    0.0 AS cogs,
    COALESCE(o.revenue_confirmed, 0) - ROUND(COALESCE(a.ads_spend_usd, 0) * fx.rate, 0) AS net_profit,
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
CROSS JOIN fx_usd_aed fx
ORDER BY o.report_date DESC
"""
run_sql("vw_fact_daily_pnl_flex", pnl_flex_sql)


# ════════════════════════════════════════════════════
# Step 4: Fix vw_fact_ads_performance  
# ════════════════════════════════════════════════════
print("\n═══ Step 4: Fix vw_fact_ads_performance ═══")

ads_perf_sql = f"""
CREATE OR REPLACE VIEW `{FULL_DS}.vw_fact_ads_performance` AS
WITH 
fx_usd_aed AS (
    SELECT rate FROM `{FULL_DS}.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'AED'
    ORDER BY effective_date DESC LIMIT 1
),
mkter_lookup AS (
    SELECT marketer_id, ANY_VALUE(campaign_code) AS campaign_code
    FROM `{FULL_DS}.dim_marketer_mapping`
    GROUP BY marketer_id
)
SELECT
    SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
    a.campaign_name,
    a.campaign_id,
    a.ad_id,
    a.adset_id,
    -- Marketer code from campaign name parse
    COALESCE(ml.marketer_id, 
        UPPER(TRIM(SPLIT(a.campaign_name, ' - ')[SAFE_OFFSET(5)])),
        UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(0)])),
        'UNKNOWN'
    ) AS campaign_mkter_code,
    -- Ads in AED (spend USD × USD→AED rate)
    ROUND(a.spend * fx.rate, 2) AS spend_ron,
    a.spend AS spend_usd,
    COALESCE(a.impressions, 0) AS impressions,
    COALESCE(a.clicks, 0) AS clicks,
    COALESCE(a.reach, 0) AS reach
FROM `{FULL_DS}.fb_ads_data` a
LEFT JOIN mkter_lookup ml 
    ON UPPER(TRIM(SPLIT(a.campaign_name, ' - ')[SAFE_OFFSET(5)])) = UPPER(TRIM(ml.campaign_code))
CROSS JOIN fx_usd_aed fx
WHERE SAFE.PARSE_DATE('%Y-%m-%d', a.date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
"""
run_sql("vw_fact_ads_performance", ads_perf_sql)


# ════════════════════════════════════════════════════
# Step 5: Fix mart_product_insights
# ════════════════════════════════════════════════════
print("\n═══ Step 5: Fix mart_product_insights ═══")

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

-- Build ad_id → product/marketer mapping from orders
ad_order_products AS (
    SELECT
        o.resolved_ad_id AS ad_id,
        o.marketer_id,
        COALESCE(pt.custom_id, 'UNKNOWN') AS product_code,
        COALESCE(o.derived_market, 'Unknown') AS market,
        SUM(COALESCE(oi.retail_price, 0)) AS ad_product_revenue
    FROM `{FULL_DS}.vw_fact_orders` o
    JOIN `{FULL_DS}.order_items` oi ON o.order_id = oi.order_id
    LEFT JOIN `{FULL_DS}.product_template` pt ON oi.product_id = pt.id
    WHERE o.resolved_ad_id IS NOT NULL
    GROUP BY 1, 2, 3, 4
),
ad_primary AS (
    SELECT
        ad_id,
        APPROX_TOP_COUNT(marketer_id, 1)[OFFSET(0)].value AS marketer_id,
        APPROX_TOP_COUNT(product_code, 1)[OFFSET(0)].value AS product_code,
        APPROX_TOP_COUNT(market, 1)[OFFSET(0)].value AS market
    FROM ad_order_products
    WHERE marketer_id IS NOT NULL AND marketer_id != 'UNKNOWN'
    GROUP BY 1
),
mkter_lookup AS (
    SELECT marketer_id, ANY_VALUE(campaign_code) AS campaign_code
    FROM `{FULL_DS}.dim_marketer_mapping` GROUP BY marketer_id
),

-- Ads enriched
ads_enriched AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        UPPER(TRIM(COALESCE(ap.product_code, SPLIT(a.campaign_name, ' - ')[SAFE_OFFSET(1)], 'UNKNOWN'))) AS product_code,
        COALESCE(ap.marketer_id, ml.marketer_id, 'UNMATCHED') AS marketer_id,
        COALESCE(ap.market, TRIM(SPLIT(a.campaign_name, ' - ')[SAFE_OFFSET(2)]), 'Unknown') AS market,
        a.spend AS ads_spend_usd
    FROM `{FULL_DS}.fb_ads_data` a
    LEFT JOIN ad_primary ap ON a.ad_id = ap.ad_id
    LEFT JOIN mkter_lookup ml 
        ON UPPER(TRIM(SPLIT(a.campaign_name, ' - ')[SAFE_OFFSET(5)])) = UPPER(TRIM(ml.campaign_code))
),
ads_by_product AS (
    SELECT report_date, product_code, marketer_id, market,
        SUM(ads_spend_usd) AS ads_spend_usd
    FROM ads_enriched
    GROUP BY 1, 2, 3, 4
),

-- Order-level product aggregation
-- retail_price is in AED fils → /100 = AED
-- avg_imported_price from order_items might not exist for ZEN8
-- Use product_cogs.cost_raw (VND) instead
item_orders AS (
    SELECT o.order_date, o.order_id, o.marketer_id, o.marketer_name,
        o.status_group, o.derived_market AS market,
        oi.product_id, oi.product_name AS item_product_name,
        SAFE_CAST(oi.quantity AS INT64) AS qty,
        SAFE_CAST(COALESCE(oi.returned_count, oi.returning_quantity, 0) AS INT64) AS return_qty,
        ROUND(SAFE_CAST(oi.retail_price AS FLOAT64) / 100, 2) AS unit_price,
        -- COGS: product_cogs.cost_raw is VND → convert to AED
        ROUND(COALESCE(NULLIF(pc.cost_raw, 0), 0) * fx_vnd.rate, 2) AS unit_cogs
    FROM `{FULL_DS}.vw_fact_orders` o
    JOIN `{FULL_DS}.order_items` oi ON o.order_id = oi.order_id
    LEFT JOIN `{FULL_DS}.product_cogs` pc ON oi.variation_id = pc.variation_id
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
        -- Revenue in AED
        ROUND(SUM(CASE WHEN io.status_group = 'success' THEN io.qty * io.unit_price ELSE 0 END), 2) AS delivered_revenue,
        -- COGS in AED (converted from VND)
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


# ════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════
print(f"\n{'═' * 60}")
print(f"  {'[DRY-RUN] ' if DRY_RUN else ''}ZEN8 View Fix Complete!")
print(f"  All values now normalized to AED:")
print(f"    - Revenue: AED (from sale_order COD ÷100)")
print(f"    - COGS:    AED (from product_cogs VND × VND→AED)")
print(f"    - Ads:     AED (from fb_ads USD × USD→AED)")
print(f"  Dashboard CURRENCY_TO_VND should = AED→VND = 6900")
print(f"{'═' * 60}")
