#!/usr/bin/env python3
"""
ZEN8 Fix Phase 2: Product Ads, Market Intel, Marketer Filter
=============================================================
RC8: Product ads=0 → campaign product_name ≠ product_code (need mapping table)
RC9: Market Intel empty → market column needs dim_market_mapping for countries
RC10: Extra marketers → whitelist only 6 YAML marketers in mart view
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
# Step 1: Create campaign_product_mapping table
# Maps campaign product names → product_template.custom_id
# ════════════════════════════════════════════════════
print("\n═══ Step 1: Build campaign → product mapping ═══")

# First create the mapping table
run_sql("Create campaign_product_mapping table", f"""
CREATE TABLE IF NOT EXISTS `{FULL_DS}.campaign_product_mapping` (
    campaign_product_name STRING,
    product_code STRING
)
""")

run_sql("Clear old mappings", f"DELETE FROM `{FULL_DS}.campaign_product_mapping` WHERE 1=1")

# Build mapping from campaign names to product codes
# Campaign format: ProductName_Code_Market_MKTER
# We map the campaign's product name hint to the actual product_code
PRODUCT_MAP = [
    # KSA products → KSAZEN8xxx
    ("KSA Kinoki", "KSAZEN8016"),
    ("KSA South moon hair spray", "KSAZEN8020"),
    ("KSA Zudaifu Cream", "KSAZEN8015"),
    ("KSA Ginger Patch", "KSAZEN8013"),
    ("KSA Ear Drops", "KSAZEN8025"),
    ("KSA Kasoy Cream", "KSAZEN8027"),
    ("KSA Superba oil", "KSAZEN8030"),
    ("KSA Neral Stone Patch", "KSAZEN8031"),
    ("KSA Varicose veins patch", "KSAZEN8013"),
    ("KSA Ginseng Serum", "KSAZEN8012"),
    ("KSA Sunscreen hat", "KSAZEN8028"),
    ("KSA BITONGSHU", "KSAZEN8029"),
    ("KSA Tawas cream", "KSAZEN8024"),
    ("KSA Golden Snake", "KSAZEN8019"),
    ("KSA Vitiligo Cream", "KSAZEN8018"),
    ("KSA Ginseng Five Treasure Tea", "KSAZEN8026"),
    # UAE products → AEZEN8xxx
    ("Kinoki", "AEZEN8016"),  # UAE version = Golden Snake/Kinoki
    ("Ginger Patch", "AEZEN8014"),
    ("Hair Dye Stick", "AEZEN8019"),
    ("Ginger Oil Muliya", "AEZEN8014"),
    ("Ginseng Five Treasure Tea", "AEZEN8015"),
    ("South Moon Hair Spray", "AEZEN8018"),
    ("Golden Snake", "AEZEN8016"),
    ("Kasoy cream", "AEZEN8017"),
    # KW products
    ("KW Kinoki", "KSAZEN8016"),
    ("KW Ginger Patch", "KSAZEN8013"),
    # Generic/other names
    ("Eelhoe Soap", "KSAZEN8017"),
    ("Lipoma Cream", "KSAZEN8021"),
    ("Bubble Herbal Shampoo", "KSAZEN8023"),
    ("Kasugai Fuyan Cream", "KSAZEN8022"),
    ("Baiyaolang Cream", "KSAZEN8015"),  # alternative name for Zudaifu
    ("HOUMAI CREAM", "KSAZEN8022"),
    ("Skin Essentials Sunscreen", "KSAZEN8028"),
    ("Superba Oil", "KSAZEN8030"),
    ("Collagen Gummie", "AEZEN8015"),
    ("KSA KINOKI DAILY", "KSAZEN8016"),
]

for cname, pcode in PRODUCT_MAP:
    sql = f"""
    INSERT INTO `{FULL_DS}.campaign_product_mapping` (campaign_product_name, product_code)
    VALUES ('{cname}', '{pcode}')
    """
    run_sql(f"  {cname} → {pcode}", sql)


# ════════════════════════════════════════════════════
# Step 2: Fix mart_product_insights — use campaign_product_mapping for ads
# ════════════════════════════════════════════════════
print("\n═══ Step 2: Fix mart_product_insights (ads + market) ═══")

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
dim_market AS (
    SELECT DISTINCT raw_market, market_name, market_code
    FROM `{FULL_DS}.dim_market_mapping`
),

-- ═══ KEY: Map campaign product name → product_code via mapping table ═══
ads_enriched AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        -- Product: map via campaign_product_mapping
        COALESCE(cpm.product_code, 'UNMATCHED') AS product_code,
        -- Marketer: from campaign SPLIT('_')[3]
        COALESCE(mu.marketer_id, 
            UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])),
            'UNMATCHED') AS marketer_id,
        -- Market: from campaign SPLIT('_')[2] → dim_market_mapping
        COALESCE(dm.market_name,
            TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)]),
            'Unknown') AS market,
        COALESCE(dm.market_code,
            UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)])),
            'XX') AS market_code,
        a.spend AS ads_spend_usd
    FROM `{FULL_DS}.fb_ads_data` a
    LEFT JOIN `{FULL_DS}.campaign_product_mapping` cpm
        ON LOWER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(0)])) = LOWER(TRIM(cpm.campaign_product_name))
    LEFT JOIN mkter_unique mu
        ON UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])) = UPPER(TRIM(mu.campaign_code))
    LEFT JOIN dim_market dm
        ON UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)])) = UPPER(dm.market_code)
),
ads_by_product AS (
    SELECT report_date, product_code, marketer_id, market, market_code,
        SUM(ads_spend_usd) AS ads_spend_usd
    FROM ads_enriched
    GROUP BY 1, 2, 3, 4, 5
),

-- Order items with allocated revenue
order_item_counts AS (
    SELECT order_id, SUM(SAFE_CAST(quantity AS INT64)) AS total_items
    FROM `{FULL_DS}.order_items`
    GROUP BY order_id
),
item_orders AS (
    SELECT o.order_date, o.order_id,
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
        o.status_group,
        -- Market from order address → dim_market_mapping
        COALESCE(dm.market_name, o.derived_market, 'Unknown') AS market,
        COALESCE(dm.market_code, o.derived_market_code, 'XX') AS market_code,
        oi.product_id, oi.product_name AS item_product_name,
        SAFE_CAST(oi.quantity AS INT64) AS qty,
        SAFE_CAST(COALESCE(oi.returned_count, oi.returning_quantity, 0) AS INT64) AS return_qty,
        ROUND(SAFE_DIVIDE(
            o.revenue_L3_success * SAFE_CAST(oi.quantity AS INT64),
            NULLIF(oic.total_items, 0)
        ), 2) AS allocated_revenue,
        ROUND(COALESCE(NULLIF(pc.cost_raw, 0), 0) * fx_vnd.rate, 2) AS unit_cogs
    FROM `{FULL_DS}.vw_fact_orders` o
    JOIN `{FULL_DS}.order_items` oi ON o.order_id = oi.order_id
    LEFT JOIN order_item_counts oic ON o.order_id = oic.order_id
    LEFT JOIN `{FULL_DS}.product_cogs` pc ON oi.variation_id = pc.variation_id
    LEFT JOIN ad_campaign_mkter acm ON o.resolved_ad_id = acm.ad_id
    LEFT JOIN mkter_unique mu_ad ON UPPER(TRIM(acm.parsed_mkter)) = UPPER(TRIM(mu_ad.campaign_code))
    LEFT JOIN dim_market dm ON LOWER(TRIM(o.derived_market)) = LOWER(dm.raw_market)
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
        io.market, io.market_code,
        COUNT(DISTINCT io.order_id) AS order_count,
        SUM(io.qty) AS units_sold,
        SUM(CASE WHEN io.status_group = 'success' THEN io.qty ELSE 0 END) AS units_delivered,
        SUM(COALESCE(io.return_qty, 0)) AS units_returned,
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
    AND pa.product_code = ap.product_code 
    AND pa.marketer_id = ap.marketer_id
CROSS JOIN fx_usd_aed fx
"""
run_sql("mart_product_insights", product_sql)


# ════════════════════════════════════════════════════
# Step 3: Fix mart_market_intelligence — use proper country names
# ════════════════════════════════════════════════════
print("\n═══ Step 3: Fix mart_market_intelligence ═══")

market_sql = f"""
CREATE OR REPLACE VIEW `{FULL_DS}.mart_market_intelligence` AS
WITH 
fx_usd_aed AS (
    SELECT rate FROM `{FULL_DS}.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'AED'
    ORDER BY effective_date DESC LIMIT 1
),
dim_market AS (
    SELECT DISTINCT raw_market, market_name, market_code
    FROM `{FULL_DS}.dim_market_mapping`
),
mkter_unique AS (
    SELECT campaign_code, ANY_VALUE(marketer_id) AS marketer_id
    FROM `{FULL_DS}.dim_marketer_mapping`
    GROUP BY campaign_code
),

-- Orders by country (from shipping address → dim_market_mapping)
order_by_market AS (
    SELECT
        o.order_date AS report_date,
        COALESCE(dm.market_name, o.derived_market, 'Unknown') AS market,
        COALESCE(dm.market_code, o.derived_market_code, 'XX') AS market_code,
        COUNT(DISTINCT o.order_id) AS total_orders,
        COUNTIF(o.status_group = 'success') AS success_orders,
        COUNTIF(o.status_group = 'returned') AS returned_orders,
        COUNTIF(o.status_group = 'cancelled') AS cancelled_orders,
        ROUND(SUM(o.revenue_L1_lead), 2) AS revenue_L1,
        ROUND(SUM(o.revenue_L3_success), 2) AS revenue_L3,
        ROUND(SUM(o.shipping_fee), 2) AS shipping_cost
    FROM `{FULL_DS}.vw_fact_orders` o
    LEFT JOIN dim_market dm ON LOWER(TRIM(o.derived_market)) = LOWER(dm.raw_market)
    GROUP BY 1, 2, 3
),

-- Ads by market (from campaign SPLIT('_')[2])
ads_by_market AS (
    SELECT
        SAFE.PARSE_DATE('%Y-%m-%d', a.date) AS report_date,
        COALESCE(dm.market_name, TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)]), 'Unknown') AS market,
        COALESCE(dm.market_code, UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)])), 'XX') AS market_code,
        SUM(a.spend) AS ads_spend_usd,
        SUM(COALESCE(a.impressions, 0)) AS impressions,
        SUM(COALESCE(a.clicks, 0)) AS clicks
    FROM `{FULL_DS}.fb_ads_data` a
    LEFT JOIN dim_market dm 
        ON UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(2)])) = UPPER(dm.market_code)
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
run_sql("mart_market_intelligence", market_sql)


print(f"\n{'═' * 60}")
print("  Phase 2 Complete!")
print("  - campaign_product_mapping: campaign names → product codes")
print("  - mart_product_insights: ads now JOIN via product mapping")
print("  - mart_market_intelligence: countries from dim_market_mapping")
print(f"{'═' * 60}")
