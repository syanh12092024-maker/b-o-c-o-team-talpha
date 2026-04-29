-- ═══════════════════════════════════════════════════
-- fb_library_creatives — Ad creative variants
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `levelup-465304.AUUS1_Dataset.fb_library_creatives` (
    ad_id STRING NOT NULL,
    creative_index INT64,
    media_type STRING,
    media_url STRING,
    headline STRING,
    body_text STRING,
    cta_text STRING
);
