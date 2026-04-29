-- ═══════════════════════════════════════════════════
-- vw_trending_ads — Top ads by hot_score
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE VIEW `levelup-465304.AUUS1_Dataset.vw_trending_ads` AS
SELECT
    a.ad_id,
    a.page_name,
    a.ad_text,
    a.ad_url,
    a.headline,
    a.started_at,
    a.is_active,
    a.duration_days,
    a.num_adsets,
    a.platforms,
    a.niche,
    a.market,
    a.likes,
    a.comments,
    a.shares,
    a.hot_score,
    a.creative_type,
    a.thumbnail_url,
    a.sync_date,
    -- Engagement total
    (a.likes + a.comments + a.shares) AS total_engagement,
    -- Hot tier
    CASE
        WHEN a.hot_score >= 80 THEN '🔥 HOT'
        WHEN a.hot_score >= 50 THEN '⚡ WARM'
        WHEN a.hot_score >= 20 THEN '💡 NEW'
        ELSE '❄️ COLD'
    END AS tier,
    -- Creative count
    (SELECT COUNT(*) FROM `levelup-465304.AUUS1_Dataset.fb_library_creatives` c WHERE c.ad_id = a.ad_id) AS creative_count
FROM `levelup-465304.AUUS1_Dataset.fb_library_ads` a
WHERE a.sync_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
ORDER BY a.hot_score DESC;
