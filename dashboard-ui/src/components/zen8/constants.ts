/** ZEN8 project constants */
export const DATASET = "ZEN8_Dataset";
export const PROJECT_NAME = "ZEN8";

/**
 * ZEN8 operates in Middle East (UAE + KSA + Kuwait + Australia).
 * Multi-currency: SAR (KSA), AED (UAE), KWD (Kuwait), AUD (Australia)
 * - sale_order prices: stored in local currency (SAR/AED/KWD/AUD)
 * - fb_ads_data: USD → converted in views
 * - Dashboard converts each currency → VND for display
 * - Timezone: Asia/Ho_Chi_Minh (UTC+7) — POS team operates from VN
 */

/** Primary currency (used by BQ views for ads) */
export const CURRENCY = "AED";
export const CURRENCY_TO_VND = 7020;  // 1 AED = 7,020 VND (updated 2026-03-30)

/** Multi-currency rates → VND */
export const FX_TO_VND: Record<string, number> = {
    AED: 7020,    // Dirham UAE
    SAR: 6669,    // Riyal Saudi Arabia
    KWD: 82000,   // Dinar Kuwait
    AUD: 17000,   // Dollar Australia
    VND: 1,
    USD: 25400,
};

/** Timezone for date filtering (POS team in Vietnam) */
export const POS_TIMEZONE = "Asia/Ho_Chi_Minh";

/** Use revenue_lead for ZEN8 — most orders are COD, delivered_revenue only counts confirmed deliveries */
export const REVENUE_COL = "revenue_lead";

/** CTE for page_id → MKT mapping (fallback when ad_id doesn't match) */
export function pageMktCTE(ds: string) {
    return `page_mkt_raw AS (
        SELECT o.page_id, UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])) as mkter, COUNT(*) as cnt
        FROM \`levelup-465304.${ds}.sale_order\` o
        JOIN \`levelup-465304.${ds}.fb_ads_data\` a ON o.ad_id = a.ad_id
        WHERE o.ad_id != '' AND o.page_id != '' AND o.page_id IS NOT NULL
            AND UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])) IN ('NHAMHT','LYVLN','HUYTN','TUNPT','LINHLTT','TAIHH','DUNGNH','VUONGNM')
        GROUP BY 1,2
    ), page_mkt_map AS (
        SELECT page_id, ARRAY_AGG(mkter ORDER BY cnt DESC LIMIT 1)[OFFSET(0)] as mkter
        FROM page_mkt_raw GROUP BY 1
    )`;
}
