-- 15_vw_marketer_scorecard.sql
-- Marketer weekly performance scorecard
-- Parses marketer code from campaign naming: PIA_{MKTER}_{MARKET}_{PRODUCT}_{TYPE}
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW `AUUS1_Dataset.vw_marketer_scorecard` AS

WITH marketer_daily AS (
    SELECT
        SPLIT(campaign_name, '_')[SAFE_OFFSET(1)] AS mkter_code,
        CASE
            WHEN UPPER(campaign_name) LIKE '%_AU_%' THEN 'AU'
            WHEN UPPER(campaign_name) LIKE '%_US_%' THEN 'US'
            ELSE 'AU'
        END AS market,
        SPLIT(campaign_name, '_')[SAFE_OFFSET(3)] AS product_code,
        ad_date,
        DATE_TRUNC(ad_date, WEEK(MONDAY)) AS week_start,
        SUM(ad_spend) / 25000             AS spend_usd,
        SUM(attributed_revenue) / 25000   AS revenue_usd,
        SUM(success_orders)               AS orders,
        AVG(true_roas)                    AS roas,
        COUNT(DISTINCT campaign_id)       AS campaigns
    FROM `AUUS1_Dataset.vw_true_roas`
    WHERE campaign_name IS NOT NULL
      AND ARRAY_LENGTH(SPLIT(campaign_name, '_')) >= 4
      AND ad_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY)
    GROUP BY 1, 2, 3, 4, 5
),

weekly_summary AS (
    SELECT
        mkter_code,
        week_start,
        ROUND(SUM(spend_usd), 2)        AS total_spend,
        ROUND(SUM(revenue_usd), 2)      AS total_revenue,
        CAST(SUM(orders) AS INT64)       AS total_orders,
        ROUND(AVG(roas), 3)             AS avg_roas,
        COUNT(DISTINCT product_code)     AS products_tested,
        COUNT(DISTINCT CASE WHEN roas >= 2.5 THEN product_code END) AS products_winning,
        SUM(campaigns)                   AS total_campaigns,
        ROUND(SAFE_DIVIDE(SUM(spend_usd), NULLIF(SUM(orders), 0)), 2) AS cpa_usd
    FROM marketer_daily
    GROUP BY 1, 2
),

-- Current week rank
current_week AS (
    SELECT *,
        RANK() OVER (ORDER BY avg_roas DESC) AS roas_rank,
        RANK() OVER (ORDER BY total_orders DESC) AS orders_rank,
        RANK() OVER (ORDER BY products_winning DESC) AS wins_rank
    FROM weekly_summary
    WHERE week_start = DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY))
)

SELECT
    mkter_code,
    week_start,
    total_spend,
    total_revenue,
    total_orders,
    avg_roas,
    products_tested,
    products_winning,
    total_campaigns,
    cpa_usd,
    roas_rank,
    orders_rank,
    wins_rank,
    -- Combined score: lower is better
    ROUND((roas_rank + orders_rank + wins_rank) / 3.0, 1) AS overall_rank,
    CURRENT_TIMESTAMP() AS refreshed_at
FROM current_week
WHERE mkter_code IS NOT NULL AND mkter_code != ''
ORDER BY overall_rank ASC;
