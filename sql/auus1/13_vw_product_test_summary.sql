-- 13_vw_product_test_summary.sql
-- Product Test Summary View — WITH AU vs US market split
-- Used by: Product Lab Tab in AUUS1 dashboard
-- Source: vw_true_roas (has ad_spend, attributed_revenue, true_roas, campaign_name, ad_date)
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW `AUUS1_Dataset.vw_product_test_summary` AS

WITH campaign_stats AS (
    SELECT
        -- Extract product code from campaign name (position 4 in naming convention)
        -- e.g., PIA_TAO_AU_NECKLACE-01_TST → product = NECKLACE-01
        SPLIT(campaign_name, '_')[SAFE_OFFSET(3)] AS product_code,
        CASE
            WHEN UPPER(campaign_name) LIKE '%_AU_%' THEN 'AU'
            WHEN UPPER(campaign_name) LIKE '%_US_%' THEN 'US'
            ELSE 'AU'
        END AS market,
        ad_date AS date,
        SUM(ad_spend) / 25000           AS spend_usd,
        SUM(attributed_revenue) / 25000 AS revenue_usd,
        SUM(success_orders)             AS orders,
        SUM(impressions)                AS impressions,
        AVG(true_roas)                  AS roas,
        SAFE_DIVIDE(
            SUM(ad_spend), NULLIF(SUM(success_orders), 0)
        ) / 25000                       AS cpa_usd,
        SAFE_DIVIDE(
            SUM(ad_spend), NULLIF(SUM(impressions), 0)
        ) * 1000 / 25000               AS cpm_usd
    FROM `AUUS1_Dataset.vw_true_roas`
    WHERE campaign_name IS NOT NULL
      AND ARRAY_LENGTH(SPLIT(campaign_name, '_')) >= 4
    GROUP BY 1, 2, 3
),

-- Aggregate by product × market
product_market AS (
    SELECT
        product_code,
        market,

        -- Date range
        MIN(date)                             AS first_test_date,
        MAX(date)                             AS last_active_date,
        DATE_DIFF(MAX(date), MIN(date), DAY)  AS days_running,

        -- Spend & Revenue
        ROUND(SUM(spend_usd), 2)              AS total_spend_usd,
        ROUND(SUM(revenue_usd), 2)            AS total_revenue_usd,
        CAST(SUM(orders) AS INT64)            AS total_orders,

        -- Averages
        ROUND(AVG(roas), 3)                   AS avg_roas,
        ROUND(MAX(roas), 3)                   AS best_roas,
        ROUND(AVG(cpa_usd), 2)               AS avg_cpa_usd,
        ROUND(AVG(cpm_usd), 2)               AS avg_cpm_usd,

        -- Last 7 days performance
        ROUND(SUM(CASE WHEN date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
                       THEN spend_usd ELSE 0 END), 2) AS spend_last7d,
        ROUND(SUM(CASE WHEN date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
                       THEN revenue_usd ELSE 0 END), 2) AS revenue_last7d,
        ROUND(SAFE_DIVIDE(
            SUM(CASE WHEN date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) THEN revenue_usd ELSE 0 END),
            NULLIF(SUM(CASE WHEN date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) THEN spend_usd ELSE 0 END), 0)
        ), 3) AS roas_last7d

    FROM campaign_stats
    WHERE product_code IS NOT NULL AND product_code != ''
    GROUP BY 1, 2
),

-- Add journey stage based on performance
product_with_stage AS (
    SELECT *,
        CASE
            WHEN DATE_DIFF(CURRENT_DATE(), last_active_date, DAY) > 7
                THEN 'Paused'
            WHEN roas_last7d >= 3.5 AND spend_last7d >= 100
                THEN 'Scaling'
            WHEN roas_last7d >= 2.5
                THEN 'WIN'
            WHEN avg_roas >= 1.5
                THEN 'Potential'
            ELSE 'Testing'
        END AS journey_stage,

        CASE
            WHEN roas_last7d > avg_roas * 1.2 THEN 'trending_up'
            WHEN roas_last7d < avg_roas * 0.8 THEN 'trending_down'
            ELSE 'stable'
        END AS trend_direction

    FROM product_market
)

SELECT
    product_code,
    market,
    journey_stage,
    trend_direction,
    first_test_date,
    last_active_date,
    days_running,
    total_spend_usd,
    total_revenue_usd,
    total_orders,
    avg_roas,
    best_roas,
    avg_cpa_usd,
    avg_cpm_usd,
    0.0 AS avg_ctr_pct,
    spend_last7d,
    revenue_last7d,
    roas_last7d,
    CURRENT_TIMESTAMP() AS refreshed_at
FROM product_with_stage
ORDER BY
    CASE journey_stage
        WHEN 'Scaling'   THEN 1
        WHEN 'WIN'       THEN 2
        WHEN 'Potential' THEN 3
        WHEN 'Testing'   THEN 4
        WHEN 'Paused'    THEN 5
    END,
    avg_roas DESC;
