-- ═══════════════════════════════════════════════════
-- fb_library_ads — Raw ads from Facebook Ad Library
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `levelup-465304.AUUS1_Dataset.fb_library_ads` (
    ad_id STRING NOT NULL,
    page_id STRING,
    page_name STRING,
    ad_text STRING,
    ad_url STRING,
    landing_url STRING,
    started_at DATE,
    is_active BOOL,
    duration_days INT64,
    num_adsets INT64,
    platforms STRING,
    niche STRING,
    market STRING,
    likes INT64 DEFAULT 0,
    comments INT64 DEFAULT 0,
    shares INT64 DEFAULT 0,
    hot_score FLOAT64 DEFAULT 0.0,
    creative_type STRING,
    thumbnail_url STRING,
    headline STRING,
    sync_date DATE
);
