/** HNLE project constants */
export const DATASET = "HNLE_Dataset";
export const PROJECT_NAME = "HNLE";
export const CURRENCY = "USD";
export const CURRENCY_TO_VND = 25400;

/** Multi-currency rates → VND (HNLE sells to ME + AU) */
export const FX_TO_VND: Record<string, number> = {
    USD: 25400,
    SAR: 6669,    // Riyal Saudi Arabia
    AED: 7020,    // Dirham UAE
    KWD: 82000,   // Dinar Kuwait
    AUD: 17000,   // Dollar Australia
    VND: 1,
};

/** Use revenue_lead for HNLE — COD-based revenue, delivered_revenue only counts confirmed deliveries */
export const REVENUE_COL = "revenue_lead";

/** HNLE mart uses fulfillment_cost / return_fulfillment_cost (differs from ZEN8 shipping_cost / return_cost) */
export const FULFILLMENT_COL = "fulfillment_cost";
export const RETURN_FULFILLMENT_COL = "return_fulfillment_cost";

/**
 * Campaign-level marketer override: campaigns where ETL-parsed mkter_code is WRONG.
 * Key = campaign_id, Value = correct marketer_code.
 * Reason: Vân runs campaigns from Đức's ad account → code parsed as "DUC" but should be "VANDTH".
 */
export const CAMPAIGN_MKTER_OVERRIDE: Record<string, string> = {
    "120239353273070532": "VANDTH",   // VÂN_ TEST KSA_ BOTOXLUX
    "120239748406330532": "VANDTH",   // VÂN_ TEST KUWAIT_ DẦU TÔM
    "120241908309160599": "VANDTH",   // VÂN_ TEST KUWAIT_ orange gel
    "120239579518320532": "VANDTH",   // Vân_test yayashi_27.3
    "120239387762990532": "VANDTH",   // VÂN_ TEST KSA_ BOTOXLUX 24.3
    "120239387814160532": "VANDTH",   // VÂN_ TEST KSA_ BOTOXLUX 24.3 (2)
};

/** CTE for page_id → MKT mapping (HNLE marketer codes) */
export function pageMktCTE(ds: string) {
    return `page_mkt_raw AS (
        SELECT o.page_id, UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])) as mkter, COUNT(*) as cnt
        FROM \`levelup-465304.${ds}.sale_order\` o
        JOIN \`levelup-465304.${ds}.fb_ads_data\` a ON o.ad_id = a.ad_id
        WHERE o.ad_id != '' AND o.page_id != '' AND o.page_id IS NOT NULL
            AND UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])) IN ('TUNGNT','THACHTD','NHATTM','DUCNV','VANDTH','HUYENLT')
        GROUP BY 1,2
    ), page_mkt_map AS (
        SELECT page_id, ARRAY_AGG(mkter ORDER BY cnt DESC LIMIT 1)[OFFSET(0)] as mkter
        FROM page_mkt_raw GROUP BY 1
    )`;
}
