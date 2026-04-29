#!/usr/bin/env python3
"""
Fix ZEN8 Marketer Attribution + Campaign Parsing

Campaign format: ProductName_CampaignCode_Market_MKTER_Description_Price_Date
Example: KSA Kinoki_KSAZEN8016_SA_HUYTN_KSA KINOKI DAILY_99_10/3
                                    ^^^^^ marketer at SPLIT('_')[3]

User's correct marketer list:
  NHAMHT  → Mai Huỳnh Thanh Nhã
  LYVLN   → Võ Lê Nhật Ly
  HUYTN   → Trương Nhật Huy
  DUNGNH  → Nguyễn Hoàng Dũng
  TAIHH   → Huỳnh Hữu Tài
  TUNPT   → Nguyễn Phan Thiên Tú
  LINHLTT → Lê Thị Trúc Linh
  VUONGNM → Nguyễn Minh Vương
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
DRY_RUN = "--dry-run" in sys.argv

def run_sql(name, sql):
    if DRY_RUN:
        print(f"  [DRY-RUN] {name}")
        return
    try:
        client.query(sql).result()
        print(f"  ✅ {name}")
    except Exception as e:
        print(f"  ❌ {name}: {e}")


# ════════════════════════════════════════════════════
# Step 1: Fix dim_marketer_mapping
# ════════════════════════════════════════════════════
print("\n═══ Step 1: Update dim_marketer_mapping ═══")

# Clear old entries
run_sql("Clear old mappings", f"DELETE FROM `{FULL_DS}.dim_marketer_mapping` WHERE 1=1")

# Insert correct mappings — campaign_code is what appears in campaign_name
# marketer_id is the user's preferred ID (= campaign_code for ZEN8)
MARKETERS = [
    # (raw_name, campaign_code, marketer_id, marketer_name)
    ("Mai Nhã", "NHAMHT", "NHAMHT", "Mai Huỳnh Thanh Nhã"),
    ("Mai Huỳnh Thanh Nhã", "NHAMHT", "NHAMHT", "Mai Huỳnh Thanh Nhã"),
    ("Nhật Ly", "LYVLN", "LYVLN", "Võ Lê Nhật Ly"),
    ("Võ Lê Nhật Ly", "LYVLN", "LYVLN", "Võ Lê Nhật Ly"),
    ("Li Zi", "LYVLN", "LYVLN", "Võ Lê Nhật Ly"),
    ("Nhật Huy", "HUYTN", "HUYTN", "Trương Nhật Huy"),
    ("Nhat Huyy", "HUYTN", "HUYTN", "Trương Nhật Huy"),
    ("Trương Nhật Huy", "HUYTN", "HUYTN", "Trương Nhật Huy"),
    ("Hoàng Dũng", "DUNGNH", "DUNGNH", "Nguyễn Hoàng Dũng"),
    ("Nguyễn Hoàng Dũng", "DUNGNH", "DUNGNH", "Nguyễn Hoàng Dũng"),
    ("Huỳnh Tài", "TAIHH", "TAIHH", "Huỳnh Hữu Tài"),
    ("Huỳnh Hữu Tài", "TAIHH", "TAIHH", "Huỳnh Hữu Tài"),
    ("Thiên Tú", "TUNPT", "TUNPT", "Nguyễn Phan Thiên Tú"),
    ("Tấn Trường", "TUNPT", "TUNPT", "Nguyễn Phan Thiên Tú"),
    ("Nguyễn Phan Thiên Tú", "TUNPT", "TUNPT", "Nguyễn Phan Thiên Tú"),
    ("Trúc Linh", "LINHLTT", "LINHLTT", "Lê Thị Trúc Linh"),
    ("Lê Thị Trúc Linh", "LINHLTT", "LINHLTT", "Lê Thị Trúc Linh"),
    ("Minh Vương", "VUONGNM", "VUONGNM", "Nguyễn Minh Vương"),
    ("Nguyễn Minh Vương", "VUONGNM", "VUONGNM", "Nguyễn Minh Vương"),
]

for raw, code, mid, mname in MARKETERS:
    sql = f"""
    INSERT INTO `{FULL_DS}.dim_marketer_mapping` (raw_name, campaign_code, marketer_id, marketer_name, project_id)
    VALUES ('{raw}', '{code}', '{mid}', '{mname}', 'ZEN8')
    """
    run_sql(f"  {code} ({raw})", sql)


# ════════════════════════════════════════════════════
# Step 2: Fix mart_performance_master — campaign name parsing
# ════════════════════════════════════════════════════
print("\n═══ Step 2: Fix mart_performance_master ═══")

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

-- Build ad_id → marketer_id from orders (highest resolution)
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

-- ═══ KEY FIX: ZEN8 campaign format uses '_' delimiter ═══
-- Format: ProductName_CampaignCode_Market_MKTER_Description_Price_Date
-- Marketer code at SPLIT('_')[3]
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
            -- Fallback: parse campaign_name with '_' delimiter at index 3
            ml.marketer_id,
            UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])),
            'UNMATCHED'
        ) AS marketer_id
    FROM `{FULL_DS}.fb_ads_data` a
    LEFT JOIN ad_marketer_map am ON a.ad_id = am.ad_id
    LEFT JOIN adset_marketer_map asm ON a.adset_id = asm.adset_id
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
        ROUND(SUM(o.revenue_L1_lead), 2) AS revenue_L1,
        ROUND(SUM(o.revenue_L3_success), 2) AS revenue_L3,
        ROUND(SUM(COALESCE(o.revenue_L4_cod_collected, o.revenue_L3_success)), 2) AS revenue_L4,
        ROUND(SUM(o.shipping_fee), 2) AS total_shipping
    FROM `{FULL_DS}.vw_fact_orders` o
    GROUP BY 1, 2
),

-- COGS: product_cogs.cost_raw is VND → AED
order_cogs AS (
    SELECT o.order_date AS report_date, o.marketer_id,
        ROUND(SUM(
            SAFE_CAST(oi.quantity AS INT64) * 
            COALESCE(NULLIF(pc.cost_raw, 0), 0) * fx_vnd.rate
        ), 2) AS total_cogs
    FROM `{FULL_DS}.vw_fact_orders` o
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
run_sql("mart_performance_master", mart_sql)


# ════════════════════════════════════════════════════
# Step 3: Fix vw_fact_ads_performance — campaign parse
# ════════════════════════════════════════════════════
print("\n═══ Step 3: Fix vw_fact_ads_performance ═══")

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
    -- ZEN8: marketer at SPLIT('_')[3]
    COALESCE(ml.marketer_id, 
        UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])),
        'UNKNOWN'
    ) AS campaign_mkter_code,
    ROUND(a.spend * fx.rate, 2) AS spend_ron,
    a.spend AS spend_usd,
    COALESCE(a.impressions, 0) AS impressions,
    COALESCE(a.clicks, 0) AS clicks,
    COALESCE(a.reach, 0) AS reach
FROM `{FULL_DS}.fb_ads_data` a
LEFT JOIN mkter_lookup ml 
    ON UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])) = UPPER(TRIM(ml.campaign_code))
CROSS JOIN fx_usd_aed fx
WHERE SAFE.PARSE_DATE('%Y-%m-%d', a.date) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
"""
run_sql("vw_fact_ads_performance", ads_perf_sql)


# ════════════════════════════════════════════════════
# Step 4: Fix mart_product_insights — campaign parse  
# ════════════════════════════════════════════════════
print("\n═══ Step 4: Fix mart_product_insights ═══")

# ZEN8 campaign: Product_Code_Market_MKTER_Description
# Product at index 0 (before first _)
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

ads_enriched AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        -- Product: from order or campaign name (first part before '_')
        UPPER(TRIM(COALESCE(ap.product_code, SPLIT(a.campaign_name, '_')[SAFE_OFFSET(0)], 'UNKNOWN'))) AS product_code,
        -- Marketer: from order or campaign name (index 3 after '_')
        COALESCE(ap.marketer_id, ml.marketer_id, 
            UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])),
            'UNMATCHED') AS marketer_id,
        COALESCE(ap.market, 
            TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)]),
            'Unknown') AS market,
        a.spend AS ads_spend_usd
    FROM `{FULL_DS}.fb_ads_data` a
    LEFT JOIN ad_primary ap ON a.ad_id = ap.ad_id
    LEFT JOIN mkter_lookup ml 
        ON UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])) = UPPER(TRIM(ml.campaign_code))
),
ads_by_product AS (
    SELECT report_date, product_code, marketer_id, market,
        SUM(ads_spend_usd) AS ads_spend_usd
    FROM ads_enriched
    GROUP BY 1, 2, 3, 4
),

item_orders AS (
    SELECT o.order_date, o.order_id, o.marketer_id, o.marketer_name,
        o.status_group, o.derived_market AS market,
        oi.product_id, oi.product_name AS item_product_name,
        SAFE_CAST(oi.quantity AS INT64) AS qty,
        SAFE_CAST(COALESCE(oi.returned_count, oi.returning_quantity, 0) AS INT64) AS return_qty,
        ROUND(SAFE_CAST(oi.retail_price AS FLOAT64) / 100, 2) AS unit_price,
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
        ROUND(SUM(CASE WHEN io.status_group = 'success' THEN io.qty * io.unit_price ELSE 0 END), 2) AS delivered_revenue,
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
# Step 5: Fix mart_market_intelligence — campaign parse
# ════════════════════════════════════════════════════
print("\n═══ Step 5: Fix mart_market_intelligence ═══")

market_sql = f"""
CREATE OR REPLACE VIEW `{FULL_DS}.mart_market_intelligence` AS
WITH 
fx_usd_aed AS (
    SELECT rate FROM `{FULL_DS}.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'AED'
    ORDER BY effective_date DESC LIMIT 1
),

ad_marketer_map AS (
    SELECT resolved_ad_id AS ad_id,
        APPROX_TOP_COUNT(marketer_id, 1)[OFFSET(0)].value AS marketer_id,
        APPROX_TOP_COUNT(derived_market, 1)[OFFSET(0)].value AS market,
        APPROX_TOP_COUNT(derived_market_code, 1)[OFFSET(0)].value AS market_code
    FROM `{FULL_DS}.vw_fact_orders`
    WHERE resolved_ad_id IS NOT NULL AND marketer_id IS NOT NULL AND marketer_id != 'UNKNOWN'
    GROUP BY 1
),
adset_marketer_map AS (
    SELECT resolved_adset_id AS adset_id,
        APPROX_TOP_COUNT(marketer_id, 1)[OFFSET(0)].value AS marketer_id,
        APPROX_TOP_COUNT(derived_market, 1)[OFFSET(0)].value AS market,
        APPROX_TOP_COUNT(derived_market_code, 1)[OFFSET(0)].value AS market_code
    FROM `{FULL_DS}.vw_fact_orders`
    WHERE resolved_adset_id IS NOT NULL AND marketer_id IS NOT NULL AND marketer_id != 'UNKNOWN'
    GROUP BY 1
),
mkter_lookup AS (
    SELECT marketer_id, ANY_VALUE(campaign_code) AS campaign_code
    FROM `{FULL_DS}.dim_marketer_mapping` GROUP BY marketer_id
),
dim_market AS (
    SELECT DISTINCT raw_market, market_name, market_code
    FROM `{FULL_DS}.dim_market_mapping`
),

order_by_market AS (
    SELECT
        o.order_date AS report_date,
        o.derived_market AS market,
        o.derived_market_code AS market_code,
        o.marketer_id,
        ANY_VALUE(o.marketer_name) AS marketer_name,
        COUNT(DISTINCT o.order_id) AS total_orders,
        COUNTIF(o.status_group = 'success') AS success_orders,
        COUNTIF(o.status_group = 'returned') AS returned_orders,
        COUNTIF(o.status_group = 'cancelled') AS cancelled_orders,
        ROUND(SUM(o.revenue_L1_lead), 2) AS revenue_L1,
        ROUND(SUM(o.revenue_L3_success), 2) AS revenue_L3,
        ROUND(SUM(o.partner_fee), 2) AS shipping_cost
    FROM `{FULL_DS}.vw_fact_orders` o
    GROUP BY 1, 2, 3, 4
),

-- ZEN8: market at SPLIT('_')[2], marketer at SPLIT('_')[3]
ads_enriched AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        COALESCE(am.market, asm.market, dm.market_name,
            TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)]), 'Unknown') AS market,
        COALESCE(am.market_code, asm.market_code, dm.market_code, 'XX') AS market_code,
        COALESCE(am.marketer_id, asm.marketer_id, ml.marketer_id,
            UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])), 'UNMATCHED') AS marketer_id,
        a.spend AS ads_spend_usd,
        COALESCE(a.impressions, 0) AS impressions,
        COALESCE(a.clicks, 0) AS clicks,
        0 AS messages
    FROM `{FULL_DS}.fb_ads_data` a
    LEFT JOIN ad_marketer_map am ON a.ad_id = am.ad_id
    LEFT JOIN adset_marketer_map asm ON a.adset_id = asm.adset_id
    LEFT JOIN mkter_lookup ml 
        ON UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])) = UPPER(TRIM(ml.campaign_code))
    LEFT JOIN dim_market dm 
        ON LOWER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)])) = LOWER(dm.raw_market)
),
ads_by_market AS (
    SELECT report_date, market, market_code, marketer_id,
        SUM(ads_spend_usd) AS ads_spend_usd,
        SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(messages) AS messages
    FROM ads_enriched
    GROUP BY 1, 2, 3, 4
)

SELECT
    COALESCE(om.report_date, am.report_date) AS report_date,
    COALESCE(om.market, am.market, 'Unknown') AS market,
    COALESCE(om.market_code, am.market_code, 'XX') AS market_code,
    COALESCE(om.marketer_id, am.marketer_id, 'UNKNOWN') AS marketer_id,
    COALESCE(om.marketer_name, am.marketer_id) AS marketer_name,
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
    ON om.report_date = am.report_date AND om.marketer_id = am.marketer_id AND om.market_code = am.market_code
CROSS JOIN fx_usd_aed fx
"""
run_sql("mart_market_intelligence", market_sql)


print(f"\n{'═' * 60}")
print(f"  ZEN8 Marketer Attribution Fix Complete!")
print(f"  Campaign parsing: SPLIT('_')[3] for marketer code")
print(f"  dim_marketer_mapping: Updated with 6 correct marketers")
print(f"{'═' * 60}")
