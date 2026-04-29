#!/usr/bin/env python3
"""
Fix ZEN8 mart_performance_master: resolve marketer from ad_id→campaign 
when vw_fact_orders.marketer_id = 'UNKNOWN'
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


print("\n═══ Fix mart_performance_master — marketer via ad_id→campaign ═══")

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
mkter_lookup AS (
    SELECT marketer_id, ANY_VALUE(campaign_code) AS campaign_code
    FROM `{FULL_DS}.dim_marketer_mapping`
    GROUP BY marketer_id
),

-- ═══ RESOLVE MARKETER FOR ORDERS VIA AD_ID→CAMPAIGN ═══
-- When order.marketer_id = UNKNOWN, look up ad_id in fb_ads_data
-- and parse marketer from campaign_name SPLIT('_')[3]
ad_campaign_mkter AS (
    SELECT DISTINCT ad_id,
        UPPER(TRIM(SPLIT(campaign_name, '_')[SAFE_OFFSET(3)])) AS parsed_mkter
    FROM `{FULL_DS}.fb_ads_data`
    WHERE ad_id IS NOT NULL
),

-- Orders with resolved marketer  
orders_resolved AS (
    SELECT o.*,
        CASE 
            WHEN o.marketer_id IS NOT NULL AND o.marketer_id != 'UNKNOWN' 
                THEN o.marketer_id
            -- Fallback: resolve via ad_id → campaign name
            WHEN acm.parsed_mkter IS NOT NULL 
                AND ml.marketer_id IS NOT NULL
                THEN ml.marketer_id
            WHEN acm.parsed_mkter IS NOT NULL 
                THEN acm.parsed_mkter
            ELSE o.marketer_id
        END AS resolved_marketer_id,
        CASE 
            WHEN o.marketer_id IS NOT NULL AND o.marketer_id != 'UNKNOWN' 
                THEN o.marketer_name
            WHEN acm.parsed_mkter IS NOT NULL AND ml2.marketer_name IS NOT NULL
                THEN ml2.marketer_name
            WHEN acm.parsed_mkter IS NOT NULL 
                THEN acm.parsed_mkter
            ELSE o.marketer_name
        END AS resolved_marketer_name
    FROM `{FULL_DS}.vw_fact_orders` o
    LEFT JOIN ad_campaign_mkter acm ON o.resolved_ad_id = acm.ad_id
    LEFT JOIN mkter_lookup ml ON UPPER(TRIM(acm.parsed_mkter)) = UPPER(TRIM(ml.campaign_code))
    LEFT JOIN `{FULL_DS}.dim_marketer_mapping` ml2 
        ON UPPER(TRIM(acm.parsed_mkter)) = UPPER(TRIM(ml2.campaign_code))
),

-- Ads with marketer attribution
ads_enriched AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        a.ad_id, a.adset_id, a.campaign_name,
        a.spend,
        COALESCE(a.impressions, 0) AS impressions,
        COALESCE(a.reach, 0) AS reach,
        COALESCE(a.clicks, 0) AS clicks,
        COALESCE(
            ml.marketer_id,
            UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])),
            'UNMATCHED'
        ) AS marketer_id
    FROM `{FULL_DS}.fb_ads_data` a
    LEFT JOIN mkter_lookup ml 
        ON UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])) = UPPER(TRIM(ml.campaign_code))
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

-- Order aggregation (uses resolved marketer)
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
          - oa.returned_orders * 10
    , 0) AS net_profit,
    
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
run_sql("mart_performance_master (with ad_id→campaign marketer resolution)", mart_sql)

print(f"\n{'═' * 60}")
print("  Done! Orders with UNKNOWN marketer now resolved via ad_id→campaign")
print(f"{'═' * 60}")
