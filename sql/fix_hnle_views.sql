-- ═══════════════════════════════════════════════════════════════════
-- HNLE Dashboard Fix — Marketer Attribution & Market Detection
-- ═══════════════════════════════════════════════════════════════════
-- Root Causes:
--   1. sale_order.marketer = '' (POS has no marketer field filled)
--      → vw_fact_orders.marketer_id = 'UNKNOWN' for ALL 320 orders
--      → mart_performance_master shows all orders as "Unknown"
--   2. Campaign name format is MIXED:
--      - 33% structured: "ProductName_KSAHNLE01_KSA_TUNGNT_..." (SPLIT index 3 = marketer)
--      - 67% freeform: "dautom ksa 8-1", "wrinkleCream-Úc-12-3" (no delimiter)
--      → vw_fact_ads_performance only parses structured campaigns
--   3. mart_market_intelligence shows market=Unknown (100%)
--      because market detection depends on vw_fact_orders.derived_market_code
--      which is 'XX' when marketer/market can't be parsed
--   4. COGS in product_variations.imported_price is in VND (90545, 9900...)
--      while revenue is in USD → currency mismatch in pnl_flex
--
-- Fix Strategy:
--   1. Update dim_marketer_mapping with ad_account_id → marketer mapping
--   2. Add campaign keyword-based market detection in vw_fact_ads_performance
--   3. Market intel: detect from campaign keywords (ksa→KSA, Uc/AU→AU)
-- ═══════════════════════════════════════════════════════════════════

-- Step 1: Ensure dim_marketer_mapping has ad_account_id mappings
-- (Already has TUNGNT, NHAT, DUC mappings — verify VAN is added)
INSERT INTO `levelup-465304.HNLE_Dataset.dim_marketer_mapping`
  (raw_name, campaign_code, marketer_id, marketer_name)
VALUES
  ('VAN', 'VAN', 'VAN', 'Vân')
ON DUPLICATE KEY UPDATE marketer_name = VALUES(marketer_name);

-- NOTE: The above INSERT may fail if the table has constraints.
-- Alternative: Check if VAN exists and insert if not
-- SELECT * FROM HNLE_Dataset.dim_marketer_mapping WHERE marketer_id = 'VAN';

-- Step 2: Rebuild vw_fact_ads_performance with improved campaign parsing
-- CRITICAL: This needs manual review before running
-- The view already has campaign_name SPLIT logic but needs additional
-- keyword-based fallback for freeform campaign names

-- Campaign-to-marketer mapping for HNLE:
-- Ad accounts from yaml:
--   act_4436251663362042  TDF_UC(Dufei)_01  → DUC
--   act_862258773090270   HNLE_UC_01        → DUC  
--   act_1801091267209683  NHAT TK 07        → NHAT
--   act_2013093525898990  NHAT TK 06        → NHAT
--   act_1188914743330947  DUC TK 03         → DUC
--   act_850593750862900   TUNG TK 05        → TUNGNT
--   act_648920421569173   HNLE 6            → [unknown - needs assignment]
--   act_1344820070087553  TUNG TK 07        → TUNGNT

-- Campaign-to-market mapping for HNLE:
-- Keywords in campaign names:
--   'ksa', 'KSA', 'saudi'       → KSA (Saudi Arabia / Middle East)
--   'Uc', 'Úc', 'AU', 'Au'     → AU  (Australia)
--   'uae', 'UAE', 'dubai'       → AE  (UAE)
--   'kuwait', 'KW'              → KW  (Kuwait)

-- ═══════════════════════════════════════════════════════════════════
-- The following views need to be rebuilt in BigQuery Console:
-- 
-- 1. vw_fact_ads_performance: Add account_id-based marketer resolution
--    and keyword-based market detection
--
-- 2. mart_market_intelligence: Add keyword-based market detection 
--    for freeform campaign names
--
-- 3. vw_fact_daily_pnl_flex: Fix COGS currency (imported_price is VND,
--    needs /25000 to convert to USD)
-- ═══════════════════════════════════════════════════════════════════

-- Diagnostic: Check current state
-- SELECT campaign_mkter_code, COUNT(*) AS cnt, ROUND(SUM(spend_ron),0) AS ads
-- FROM HNLE_Dataset.vw_fact_ads_performance GROUP BY 1 ORDER BY ads DESC;

-- SELECT market, market_code, SUM(total_orders), ROUND(SUM(revenue_success),0)
-- FROM HNLE_Dataset.mart_market_intelligence GROUP BY 1,2 ORDER BY 3 DESC;
