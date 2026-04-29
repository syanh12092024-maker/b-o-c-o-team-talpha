/**
 * BQ Schema Registry — Single Source of Truth for all table/column references.
 *
 * 🚨 RULE: NEVER reference BQ table names or column names directly in tab components.
 *    Always import from this file.
 *
 * When a column name changes in BQ:
 *   1. Update the constant HERE
 *   2. TypeScript compiler catches all broken references
 *   3. Validation script confirms column exists in BQ
 */

// ─── BQ Tables / Views ──────────────────────────────────────────────────────

export const BQ_TABLES = {
    /** Main mart: orders + marketer + ads + revenue (aggregated daily × marketer) */
    MART: "mart_performance_master",
    /** Standalone P&L view: daily aggregation, ads from fb_ads_data directly */
    PNL_VIEW: "vw_fact_daily_pnl_v2",
    /** Ads performance view: spend/impressions/clicks by date × campaign */
    ADS_VIEW: "vw_fact_ads_performance",
    /** Product insights mart: product × market × date */
    PRODUCT_VIEW: "mart_product_insights",
    /** Raw orders view: all order-level data */
    ORDERS: "vw_fact_orders",
    /** Raw FB ads data: campaign-level */
    ADS_RAW: "fb_ads_data",
    /** Product stock snapshot */
    STOCK: "product_stock",
    /** Deduped order items */
    ORDER_ITEMS: "fact_order_items_dedup",
    /** Exchange rates */
    FX: "cost_exchange_rates",
    /** Product catalog */
    PRODUCTS: "product_template",
    /** Product variations */
    PRODUCT_VARS: "product_variations",
    /** Market intelligence mart */
    MARKET_INTEL: "mart_market_intelligence",
    /** Flex P&L view: payment-model-aware, reads sale_order + vw_fb_ads_standard directly */
    PNL_FLEX: "vw_fact_daily_pnl_flex",
    /** Actual fulfillment costs from FFM partners (EU Shipment, TCE) */
    FFM_SHIPMENTS: "ffm_shipments",
    /** Order-to-3PL mapping with estimated costs */
    FULFILLMENT_ORDERS: "fulfillment_orders",
    /** Aggregated actual FFM costs per order */
    FFM_COST_ACTUAL: "vw_ffm_cost_actual",
    /** Payout protocol headers (from Protokol XLSX) */
    PAYOUT_PROTOCOLS: "payout_protocols",
    /** Payout protocol line items */
    PAYOUT_PROTOCOL_ITEMS: "payout_protocol_items",
} as const;

// ─── Column Enums (per table) ─────────────────────────────────────────────

/**
 * mart_performance_master columns.
 * ⚠️ CEO KPIs and Marketer table MUST use these (same source = same numbers)
 */
export const MART = {
    REPORT_DATE: "report_date",
    MARKETER: "marketer_name",
    TOTAL_ORDERS: "total_orders",
    SUCCESS_ORDERS: "success_orders",
    RETURNED_ORDERS: "returned_orders",
    /** Revenue from success orders only (= revenue_L3). Use for P&L display.
     *  ⚠️ May be 0 for new projects where orders haven't been delivered yet.
     *  Use REVENUE_LEAD for fallback (lead revenue = total order value). */
    REVENUE: "delivered_revenue",
    /** Revenue from all lead orders (COD-based). Non-zero even before delivery. */
    REVENUE_LEAD: "revenue_lead",
    COGS: "cogs",
    /** Forward fulfillment cost — AUUS1 mart uses shipping_cost */
    FULFILLMENT: "shipping_cost",
    /** Return leg fulfillment cost — AUUS1 mart uses return_cost */
    RETURN_FULFILLMENT: "return_cost",
    /** Ads spend in RON — ⚠️ may be 0 for recent dates (broken marketer→ads join) */
    ADS_SPEND: "ads_spend_ron",
    NET_PROFIT: "net_profit",
    /** ROAS L3 */
    ROAS: "roas_success",
} as const;

/**
 * vw_fact_daily_pnl_v2 columns.
 * ⚠️ Ads from this view reads fb_ads_data DIRECTLY — more complete than mart for recent dates
 */
export const PNL_VIEW = {
    REPORT_DATE: "report_date",
    TOTAL_ORDERS: "total_orders",
    SUCCESS_ORDERS: "success_orders",
    RETURNED_ORDERS: "returned_orders",
    /** Revenue from ALL orders — ⚠️ HIGHER than mart.delivered_revenue */
    REVENUE_LEAD: "revenue_lead",
    /** Revenue from success orders — ≈ mart.delivered_revenue */
    REVENUE_SUCCESS: "revenue_success",
    COGS: "cogs",
    /** Shipping fee from order data — ≠ mart.fulfillment_cost */
    SHIPPING: "shipping_cost",
    ADS_SPEND_USD: "ads_spend_usd",
    ADS_SPEND_RON: "ads_spend_ron",
    NET_PROFIT: "net_profit",
    IMPRESSIONS: "impressions",
    CLICKS: "clicks",
    REACH: "reach",
    MESSAGES: "messages",
} as const;

/**
 * vw_fact_daily_pnl_flex columns.
 * ✅ PREFERRED for P&L — reads sale_order + vw_fb_ads_standard directly,
 *    bypassing mart marketer JOIN (which drops recent orders).
 */
export const PNL_FLEX = {
    REPORT_DATE: "report_date",
    TOTAL_ORDERS: "total_orders",
    SUCCESS_ORDERS: "success_orders",
    RETURNED_ORDERS: "returned_orders",
    REVENUE_CONFIRMED: "revenue_confirmed",
    REVENUE_PROVISIONAL: "revenue_success",
    ADS_SPEND_RON: "ads_spend_ron",
    COGS: "cogs",
    SHIPPING: "shipping_cost",
    NET_PROFIT: "net_profit",
    ROAS: "roas_l3",
} as const;

/**
 * vw_fact_ads_performance columns.
 * ✅ BEST source for ads data — has all dates, all campaigns, all marketer codes
 */
export const ADS_VIEW = {
    REPORT_DATE: "report_date",
    MKTER_CODE: "campaign_mkter_code",
    SPEND: "spend_ron",
    SPEND_USD: "spend_usd",
    IMPRESSIONS: "impressions",
    CLICKS: "clicks",
    CAMPAIGN_NAME: "campaign_name",
} as const;

/**
 * mart_product_insights columns.
 */
export const PRODUCT_VIEW = {
    REPORT_DATE: "report_date",
    SKU: "sku",
    PRODUCT_NAME: "product_name",
    MARKET: "market",
    ORDER_COUNT: "order_count",
    UNITS_DELIVERED: "units_delivered",
    UNITS_RETURNED: "units_returned",
    REVENUE: "delivered_revenue",
    COGS: "delivered_cogs",
    ADS_SPEND: "ads_spend_ron",
    GROSS_PROFIT: "gross_profit",
} as const;

/**
 * vw_fact_orders columns.
 */
export const ORDERS = {
    ORDER_DATE: "order_date",
    STATUS: "status_name",
    STATUS_GROUP: "status_group",
    TOTAL_PRICE: "total_price",
    COD_AMOUNT: "cod_amount",
    SHIPPING_FEE: "shipping_fee",
    CUSTOMER_PHONE: "customer_phone",
    MARKET: "market",
} as const;

/**
 * ffm_shipments columns.
 * Source of truth for actual fulfillment costs & payout tracking.
 */
export const FFM = {
    AWB: "awb",
    POS_ORDER_ID: "pos_order_id",
    FFM_PARTNER: "ffm_partner",
    STATUS: "status",
    PRICE_EXCL_VAT: "price_excl_vat",
    PRICE_INCL_VAT: "price_incl_vat",
    COD_AMOUNT: "cod_amount",
    IS_RETURN: "is_return_shipment",
    CREATED_DATE: "created_date",
    DELIVERED_DATE: "delivered_date",
    RETURNED_DATE: "returned_date",
    PAYOUT_DATE: "payout_date",
    PAYOUT_NUMBER: "payout_number",
    SYNC_SOURCE: "sync_source",
    CURRENCY: "currency",
    CLIENT_ID: "client_id",
} as const;

/**
 * fulfillment_orders columns.
 */
export const FFM_ORDERS = {
    POS_ORDER_ID: "pos_order_id",
    TPL_ORDER_ID: "tpl_order_id",
    AWB: "awb",
    COURIER_NAME: "courier_name",
    RECIPIENT_COUNTRY: "recipient_country",
    COD_AMOUNT: "cod_amount",
    STATUS: "status",
} as const;

// ─── Data Source Rules (documented for AI/dev reference) ──────────────────

/**
 * DATA SOURCE RULES — Which source to use for each metric:
 *
 * | Metric     | Source              | Column                              | Why                                     |
 * |------------|---------------------|-------------------------------------|-----------------------------------------|
 * | Revenue    | mart                | delivered_revenue                   | Consistent with marketer table          |
 * | COGS       | mart                | cogs                                | Consistent with marketer table          |
 * | Shipping   | mart                | fulfillment_cost + return_ful...    | Real 3PL cost (not order shipping_fee)  |
 * | Ads (KPI)  | vw_fact_ads_perf    | spend_ron                           | Complete for ALL dates                  |
 * | Ads (mart) | mart                | ads_spend_ron                       | May be 0 for recent dates               |
 * | Orders     | mart                | total_orders, success_orders        | Pre-aggregated                          |
 * | Daily P&L  | vw_fact_daily_pnl   | revenue_success, ads_spend_ron      | Has ads for recent dates                |
 */
export type DataSourceRule = {
    metric: string;
    table: string;
    column: string;
    reason: string;
};
