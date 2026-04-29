-- 14_vw_creative_fatigue_v2.sql
-- Creative Fatigue Detection — Ad-level CTR/CPM/Frequency trend analysis
-- Used by: Creative Fatigue Detector service & API
-- Source: fb_ads_data (has ctr, cpm, frequency per ad per day)
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW `AUUS1_Dataset.vw_creative_fatigue_v2` AS

WITH daily_ad_stats AS (
    SELECT
        CAST(ad_id AS STRING)       AS ad_id,
        ad_name,
        CAST(campaign_id AS STRING) AS campaign_id,
        campaign_name,
        date                        AS ad_date,
        CASE
            WHEN UPPER(campaign_name) LIKE '%_AU_%' THEN 'AU'
            WHEN UPPER(campaign_name) LIKE '%_US_%' THEN 'US'
            ELSE 'AU'
        END AS market,
        SAFE_CAST(spend AS FLOAT64) / 25000            AS spend_usd,
        SAFE_CAST(impressions AS INT64)                 AS impressions,
        SAFE_CAST(clicks AS INT64)                      AS clicks,
        SAFE_CAST(ctr AS FLOAT64)                       AS ctr,
        SAFE_CAST(cpm AS FLOAT64) / 25000               AS cpm_usd,
        SAFE_CAST(frequency AS FLOAT64)                 AS frequency,
        SAFE_CAST(reach AS INT64)                       AS reach
    FROM `AUUS1_Dataset.fb_ads_data`
    WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
      AND SAFE_CAST(impressions AS INT64) > 100
),

-- Calculate 3-day rolling windows
recent_3d AS (
    SELECT ad_id, ad_name, campaign_id, campaign_name, market,
        AVG(ctr)       AS ctr_3d,
        AVG(cpm_usd)   AS cpm_3d,
        AVG(frequency)  AS freq_3d,
        SUM(spend_usd)  AS spend_3d
    FROM daily_ad_stats
    WHERE ad_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY)
    GROUP BY 1,2,3,4,5
),

-- Calculate 7-day baseline
baseline_7d AS (
    SELECT ad_id,
        AVG(ctr)       AS ctr_7d,
        AVG(cpm_usd)   AS cpm_7d,
        AVG(frequency)  AS freq_7d,
        SUM(spend_usd)  AS spend_7d,
        MIN(ad_date)    AS first_date,
        MAX(ad_date)    AS last_date,
        COUNT(*)        AS active_days
    FROM daily_ad_stats
    GROUP BY 1
),

-- Detect fatigue
fatigue_detection AS (
    SELECT
        r.ad_id,
        r.ad_name,
        r.campaign_id,
        r.campaign_name,
        r.market,
        ROUND(r.ctr_3d, 4)           AS ctr_recent,
        ROUND(b.ctr_7d, 4)           AS ctr_baseline,
        ROUND(r.cpm_3d, 2)           AS cpm_recent,
        ROUND(b.cpm_7d, 2)           AS cpm_baseline,
        ROUND(r.freq_3d, 2)          AS frequency_recent,
        ROUND(b.freq_7d, 2)          AS frequency_baseline,
        ROUND(r.spend_3d, 2)         AS spend_3d_usd,
        ROUND(b.spend_7d, 2)         AS spend_7d_usd,
        b.active_days,
        b.first_date,
        b.last_date,

        -- Fatigue signals
        CASE WHEN b.ctr_7d > 0
             THEN ROUND((r.ctr_3d - b.ctr_7d) / b.ctr_7d * 100, 1)
             ELSE 0 END AS ctr_change_pct,
        CASE WHEN b.cpm_7d > 0
             THEN ROUND((r.cpm_3d - b.cpm_7d) / b.cpm_7d * 100, 1)
             ELSE 0 END AS cpm_change_pct,

        -- Fatigue score (higher = more fatigued)
        (CASE WHEN b.ctr_7d > 0 AND (r.ctr_3d - b.ctr_7d) / b.ctr_7d < -0.15 THEN 30 ELSE 0 END) +
        (CASE WHEN b.cpm_7d > 0 AND (r.cpm_3d - b.cpm_7d) / b.cpm_7d > 0.20  THEN 30 ELSE 0 END) +
        (CASE WHEN r.freq_3d > 2.5 THEN 20 ELSE 0 END) +
        (CASE WHEN r.freq_3d > 3.5 THEN 20 ELSE 0 END)
        AS fatigue_score

    FROM recent_3d r
    JOIN baseline_7d b ON r.ad_id = b.ad_id
    WHERE b.active_days >= 3
)

SELECT *,
    CASE
        WHEN fatigue_score >= 60 THEN 'CRITICAL'
        WHEN fatigue_score >= 30 THEN 'WARNING'
        ELSE 'OK'
    END AS fatigue_level,
    CURRENT_TIMESTAMP() AS checked_at
FROM fatigue_detection
WHERE fatigue_score >= 30
ORDER BY fatigue_score DESC, spend_3d_usd DESC;
