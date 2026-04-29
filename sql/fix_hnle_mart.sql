-- Fix HNLE mart_performance_master
-- Issues:
--   1. Uses revenue_L3_success (=0 for undelivered) → change to revenue_L1_lead
--   2. FULL OUTER JOIN only on report_date, missing marketer join → orders show 0
--   3. Add revenue_lead column for consistency with ZEN8/TRENDIFY
--
-- Run: bq query --use_legacy_sql=false < sql/fix_hnle_mart.sql

CREATE OR REPLACE VIEW `levelup-465304.HNLE_Dataset.mart_performance_master` AS

WITH fx AS (
    SELECT rate FROM `levelup-465304.HNLE_Dataset.cost_exchange_rates`
    WHERE from_currency = 'USD' AND to_currency = 'RON'
    ORDER BY effective_date DESC LIMIT 1
),

-- Orders grouped by date (marketer from vw_fact_orders)
order_summary AS (
    SELECT
        o.order_date AS report_date,
        COALESCE(o.marketer_id, 'UNKNOWN') AS marketer_id,
        COALESCE(o.marketer_name, 'Unknown') AS marketer_name,
        COUNT(DISTINCT o.order_id) AS total_orders,
        COUNTIF(o.status_group = 'success') AS success_orders,
        COUNTIF(o.status_group = 'returned') AS returned_orders,
        ROUND(SUM(o.revenue_L1_lead), 0) AS revenue_lead,
        ROUND(SUM(o.revenue_L3_success), 0) AS delivered_revenue,
        ROUND(SUM(o.partner_fee), 0) AS fulfillment_cost,
        0 AS return_fulfillment_cost,
        0 AS cogs
    FROM `levelup-465304.HNLE_Dataset.vw_fact_orders` o
    GROUP BY 1, 2, 3
),

-- Ads grouped by date × marketer
ads_summary AS (
    SELECT
        report_date,
        campaign_mkter_code AS marketer_id,
        ROUND(SUM(spend_usd), 2) AS ads_spend_usd,
        ROUND(SUM(spend_ron), 2) AS ads_spend_ron
    FROM `levelup-465304.HNLE_Dataset.vw_fact_ads_performance`
    GROUP BY 1, 2
)

SELECT
    COALESCE(os.report_date, ads.report_date) AS report_date,
    COALESCE(os.marketer_id, ads.marketer_id, 'UNKNOWN') AS marketer_id,
    COALESCE(
        dm.marketer_name,
        os.marketer_name,
        CASE ads.marketer_id
            WHEN 'TUNGNT' THEN 'Tùng NT'
            WHEN 'NHAT' THEN 'Nhật'
            WHEN 'DUC' THEN 'Đức'
            WHEN 'VAN' THEN 'Vân'
            ELSE 'Unknown'
        END
    ) AS marketer_name,

    COALESCE(os.total_orders, 0) AS total_orders,
    COALESCE(os.success_orders, 0) AS success_orders,
    COALESCE(os.returned_orders, 0) AS returned_orders,
    COALESCE(os.revenue_lead, 0) AS revenue_lead,
    COALESCE(os.delivered_revenue, 0) AS delivered_revenue,
    COALESCE(os.fulfillment_cost, 0) AS fulfillment_cost,
    0 AS return_fulfillment_cost,
    COALESCE(os.cogs, 0) AS cogs,
    ROUND(COALESCE(ads.ads_spend_usd, 0), 2) AS ads_spend_usd,
    ROUND(COALESCE(ads.ads_spend_ron, 0), 0) AS ads_spend_ron,

    ROUND(
        COALESCE(os.revenue_lead, 0)
        - COALESCE(ads.ads_spend_ron, 0)
        - COALESCE(os.fulfillment_cost, 0)
        - COALESCE(os.cogs, 0), 0
    ) AS net_profit

FROM order_summary os
FULL OUTER JOIN ads_summary ads
    ON os.report_date = ads.report_date
    AND os.marketer_id = ads.marketer_id
LEFT JOIN `levelup-465304.HNLE_Dataset.dim_marketer_mapping` dm
    ON COALESCE(os.marketer_id, ads.marketer_id) = dm.marketer_id;
