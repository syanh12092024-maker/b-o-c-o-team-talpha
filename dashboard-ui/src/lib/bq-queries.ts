/**
 * BQ Query Builder — Centralized SQL query functions for ALL dashboard tabs.
 *
 * 🚨 RULES:
 *   1. Every tab MUST import queries from here. No inline SQL in tab components.
 *   2. Each function documents WHY it uses a specific data source.
 *   3. Functions sharing the same metric on the same page MUST use the same source.
 *
 * When adding a new query:
 *   1. Use constants from bq-schema.ts (never hardcode table/column names)
 *   2. Add JSDoc explaining the data source choice
 *   3. Run `npm run validate` to check column existence
 */

import { BQ_TABLES, MART, PNL_VIEW, PNL_FLEX, ADS_VIEW, PRODUCT_VIEW, ORDERS, FFM, FFM_ORDERS } from "./bq-schema";

/**
 * Campaign name → marketer code parsing (inline SQL CASE).
 * Mirrors mart_performance_master_v5 ads_enriched logic.
 * Used in per-marketer queries that read fb_ads_data directly.
 */
const ADS_MKTER_PARSE = `CASE
    WHEN ENDS_WITH(campaign_name, ' Lệ') OR ENDS_WITH(campaign_name, '-Lệ') OR ENDS_WITH(campaign_name, '_Lệ') OR campaign_name = 'Lệ' OR campaign_name LIKE '% Lệ %' THEN 'LETC'
    WHEN ENDS_WITH(campaign_name, ' LC') OR ENDS_WITH(campaign_name, '-LC') OR ENDS_WITH(campaign_name, '_LC') OR campaign_name LIKE '% LC %' OR campaign_name LIKE '% LC-%' OR campaign_name LIKE '% LC_%' THEN 'CHIPTL'
    WHEN ENDS_WITH(campaign_name, ' TA') OR ENDS_WITH(campaign_name, '-TA') OR ENDS_WITH(campaign_name, '_TA') OR campaign_name LIKE '% TA %' OR campaign_name LIKE '% TA-%' OR campaign_name LIKE '% TA_%' THEN 'ANHNT'
    WHEN ENDS_WITH(campaign_name, ' TÚ') OR ENDS_WITH(campaign_name, ' Tú') OR ENDS_WITH(campaign_name, '-TÚ') OR ENDS_WITH(campaign_name, '-Tú') OR ENDS_WITH(campaign_name, ' Kim Tu') OR ENDS_WITH(campaign_name, ' Kim Tú') THEN 'TUKT'
    WHEN ENDS_WITH(campaign_name, ' MT') OR ENDS_WITH(campaign_name, '-MT') OR ENDS_WITH(campaign_name, '_MT') OR campaign_name LIKE '% MT %' OR campaign_name LIKE '% MT-%' OR ENDS_WITH(campaign_name, ' Minh Thư') OR ENDS_WITH(campaign_name, ' Minh Thu') THEN 'MINHTHU'
    WHEN ENDS_WITH(campaign_name, ' Vân') OR ENDS_WITH(campaign_name, '-Vân') OR ENDS_WITH(campaign_name, '_Vân') OR campaign_name LIKE '% Vân %' OR ENDS_WITH(campaign_name, ' Tường Vân') OR ENDS_WITH(campaign_name, ' Tuong Van') OR ENDS_WITH(campaign_name, ' TV') OR ENDS_WITH(campaign_name, '-TV') THEN 'TUONGVAN'
    WHEN ENDS_WITH(campaign_name, ' Hiệu') OR ENDS_WITH(campaign_name, '-Hiệu') OR ENDS_WITH(campaign_name, '_Hiệu') OR campaign_name LIKE '% Hiệu %' OR ENDS_WITH(campaign_name, ' Hieu') OR ENDS_WITH(campaign_name, '-Hieu') THEN 'HIEUNV'
    ELSE 'UNMATCHED'
  END`;

// ─── CEO Overview Queries ────────────────────────────────────────────────────

/**
 * CEO Q0: Monthly P&L Summary
 * Source: mart — MUST match marketer table (same page consistency)
 */
export function queryCeoMonthlyPnl(dataset: string, from: string, to: string, revenueCol?: string, opts?: { fulfillment?: string; returnFulfillment?: string }) {
    const rev = revenueCol || MART.REVENUE;
    const ful = opts?.fulfillment || MART.FULFILLMENT;
    const rful = opts?.returnFulfillment || MART.RETURN_FULFILLMENT;
    return `SELECT
        FORMAT_DATE('%Y-%m', ${MART.REPORT_DATE}) as month,
        SUM(${MART.TOTAL_ORDERS}) as orders,
        SUM(${MART.SUCCESS_ORDERS}) as success,
        SUM(${MART.RETURNED_ORDERS}) as returned,
        ROUND(SUM(COALESCE(${rev}, 0)),0) as revenue,
        ROUND(SUM(COALESCE(${MART.ADS_SPEND}, 0)),0) as ads_spend,
        ROUND(SUM(COALESCE(${MART.COGS}, 0)),0) as cogs,
        ROUND(SUM(COALESCE(${ful}, 0)) + SUM(COALESCE(${rful}, 0)),0) as shipping,
        ROUND(SUM(COALESCE(${MART.NET_PROFIT}, 0)),0) as net_profit,
        ROUND(SUM(COALESCE(revenue_shipped, 0)),0) as revenue_shipped
    FROM ${dataset}.${BQ_TABLES.MART}
    WHERE ${MART.REPORT_DATE} BETWEEN '${from}' AND '${to}'
    GROUP BY 1 ORDER BY 1`;
}

/**
 * CEO Q1: Marketer P&L Detail
 * Source: mart — same source as Q0 (consistency on same page)
 */
export function queryCeoMarketerPnl(dataset: string, from: string, to: string, revenueCol?: string, opts?: { fulfillment?: string; returnFulfillment?: string }) {
    const rev = revenueCol || MART.REVENUE;
    const ful = opts?.fulfillment || MART.FULFILLMENT;
    const rful = opts?.returnFulfillment || MART.RETURN_FULFILLMENT;
    return `SELECT
        ${MART.MARKETER} as marketer_name,
        SUM(${MART.TOTAL_ORDERS}) as orders,
        SUM(${MART.SUCCESS_ORDERS}) as success,
        SUM(${MART.RETURNED_ORDERS}) as returned,
        ROUND(SUM(COALESCE(${rev}, 0)),0) as revenue,
        ROUND(SUM(COALESCE(${MART.COGS}, 0)),0) as cogs,
        ROUND(SUM(COALESCE(${ful}, 0)) + SUM(COALESCE(${rful}, 0)),0) as shipping,
        ROUND(SUM(COALESCE(${MART.ADS_SPEND}, 0)),0) as ads_spend,
        ROUND(SUM(COALESCE(${MART.NET_PROFIT}, 0)),0) as net_profit,
        ROUND(SUM(COALESCE(revenue_shipped, 0)),0) as revenue_shipped,
        ROUND(SAFE_DIVIDE(SUM(COALESCE(${rev}, 0)), NULLIF(SUM(COALESCE(${MART.ADS_SPEND}, 0)),0)),2) as roas
    FROM ${dataset}.${BQ_TABLES.MART}
    WHERE ${MART.REPORT_DATE} BETWEEN '${from}' AND '${to}'
        AND ${MART.MARKETER} IS NOT NULL
    GROUP BY 1 ORDER BY revenue DESC`;
}

/**
 * CEO Q2: Market ranking
 * Source: mart_product_insights — has market dimension
 */
export function queryCeoMarkets(dataset: string, from: string, to: string) {
    return `SELECT
        ${PRODUCT_VIEW.MARKET} as market,
        SUM(${PRODUCT_VIEW.ORDER_COUNT}) as orders,
        SUM(${PRODUCT_VIEW.UNITS_DELIVERED}) as success,
        ROUND(SUM(${PRODUCT_VIEW.REVENUE}),0) as revenue,
        ROUND(SUM(${PRODUCT_VIEW.ADS_SPEND}),0) as ads_spend
    FROM ${dataset}.${BQ_TABLES.PRODUCT_VIEW}
    WHERE ${PRODUCT_VIEW.REPORT_DATE} BETWEEN '${from}' AND '${to}'
        AND ${PRODUCT_VIEW.MARKET} IS NOT NULL AND ${PRODUCT_VIEW.MARKET} != 'Unknown'
    GROUP BY 1 ORDER BY revenue DESC LIMIT 10`;
}

/**
 * CEO Q3: Total ads spend from fb_ads_data (raw, no JOIN multiplication).
 * ⚠️ vw_fact_ads_performance LEFT JOINs orders → spend duplication.
 */
export function queryCeoAdsTotal(dataset: string, from: string, to: string) {
    return `SELECT
        ROUND(SUM(spend),2) as ads_spend_usd
    FROM ${dataset}.${BQ_TABLES.ADS_RAW}
    WHERE date BETWEEN '${from}' AND '${to}'`;
}

// ─── P&L Tab Queries ─────────────────────────────────────────────────────────

/**
 * P&L Q0: Daily revenue + orders + estimated FFM — from sale_order directly
 *
 * Revenue  = SUM(cod/100) for all orders EXCEPT canceled & ordered (test)
 * Orders   = COUNT orders EXCEPT canceled & ordered (test)
 *
 * V7 changes:
 * - DR = TRUE order-to-delivery rate from sale_order (settled window: 35-14 days ago)
 *         Previously used ffm_shipments which only measured shipped orders → inflated DR
 * - FFM = orders × (avg actual FFM cost per order from ffm_shipments) × EUR/RON rate
 *         Previously used hardcoded 4.3/3.35 EUR constants × formula
 *
 * ⚠️ Excludes status 'canceled' (Đã hủy) and 'ordered' (test orders)
 */
export function queryPnlDailyFromMart(dataset: string, from: string, to: string) {
    // ⚠️ BQ rule: non-aggregated CROSS JOIN columns (dr.delivery_rate, fx.rate) cannot be
    //    in SELECT alongside GROUP BY. Fix: aggregate first in 'daily' CTE, then CROSS JOIN
    //    in outer SELECT (no GROUP BY needed there → no conflict).
    return `WITH fx_eur AS (
        SELECT rate
        FROM ${dataset}.cost_exchange_rates
        WHERE from_currency = 'EUR' AND to_currency = 'RON'
        ORDER BY effective_date DESC LIMIT 1
    ),
    dr_window AS (
        -- V7: True DR from sale_order (order-to-delivery conversion rate)
        -- V6 used ffm_shipments Delivered/(Delivered+Returned) ≈ 87% — only measured
        -- shipped orders, ignoring orders lost before shipping → inflated forecast.
        -- Now: settled sale_order window (35-14 days ago) for true conversion.
        SELECT ROUND(SAFE_DIVIDE(
            COUNTIF(status_name IN ('delivered', 'received_money')),
            NULLIF(COUNTIF(status_name NOT IN ('waitting', 'ordered')), 0)
        ), 4) AS delivery_rate
        FROM ${dataset}.sale_order
        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at))
            BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 35 DAY)
            AND DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
    ),
    ffm_baseline AS (
        -- Actual total FFM cost (EUR) from ffm_shipments in settlement window
        SELECT COALESCE(SUM(price_incl_vat), 0) AS total_ffm_eur
        FROM ${dataset}.ffm_shipments
        WHERE DATE(COALESCE(created_date, synced_at))
            BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 35 DAY)
            AND DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
    ),
    order_baseline AS (
        -- Total orders in settlement window (for ffm-per-order calculation)
        SELECT COUNTIF(status_name NOT IN ('waitting', 'ordered')) AS total_orders_base
        FROM ${dataset}.sale_order
        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at))
            BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 35 DAY)
            AND DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
    ),
    daily AS (
        -- Step 1: Aggregate per day first (no CROSS JOIN here → no GROUP BY conflict)
        SELECT
            DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at)) AS report_date,
            COUNTIF(status_name NOT IN ('waitting', 'ordered'))             AS total_orders,
            ROUND(SUM(CASE WHEN status_name NOT IN ('waitting', 'ordered')
                THEN SAFE_CAST(cod AS FLOAT64) / 100.0 ELSE 0 END), 0)  AS revenue
        FROM ${dataset}.sale_order
        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at))
            BETWEEN '${from}' AND '${to}'
        GROUP BY 1
    )
    -- Step 2: revenue is already RON (cod/100), apply DR formula
    SELECT
        d.report_date,
        d.total_orders,
        d.revenue,
        ROUND(dr.delivery_rate * 100, 1)                                  AS delivery_rate_pct,
        ROUND(d.total_orders * dr.delivery_rate)                          AS est_success_orders,
        ROUND(d.revenue * dr.delivery_rate, 0)                            AS est_revenue,
        ROUND(
            d.total_orders
            * SAFE_DIVIDE(fb.total_ffm_eur, ob.total_orders_base)
            * fx.rate
        , 0)                                                              AS ffm,
        ROUND(SAFE_DIVIDE(fb.total_ffm_eur, ob.total_orders_base), 2)    AS ffm_per_order_eur
    FROM daily d
    CROSS JOIN dr_window dr
    CROSS JOIN fx_eur fx
    CROSS JOIN ffm_baseline fb
    CROSS JOIN order_baseline ob
    ORDER BY 1 DESC`;
}

/**
 * P&L Q0b: Daily COGS — from sale_order + order_items + product_cogs
 * Matches same order filter as Q0: excludes canceled & ordered (test)
 * Cost formula: SUM(quantity × COALESCE(cost_raw, avg_imported_price, imported_price) / 100)
 */
export function queryPnlDailyCogs(dataset: string, from: string, to: string) {
    return `WITH fx_eur AS (
        SELECT rate FROM ${dataset}.cost_exchange_rates
        WHERE from_currency = 'EUR' AND to_currency = 'RON'
        ORDER BY effective_date DESC LIMIT 1
    ),
    daily_cogs AS (
        SELECT
            DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at)) AS report_date,
            ROUND(SUM(
                SAFE_CAST(oi.quantity AS INT64) * COALESCE(
                    NULLIF(pc.cost_raw, 0),
                    NULLIF(oi.avg_imported_price, 0),
                    NULLIF(SAFE_CAST(pv.imported_price AS FLOAT64), 0),
                    0
                ) / 100.0
            ), 0) AS cogs_eur
        FROM ${dataset}.sale_order so
        JOIN ${dataset}.order_items oi ON so.id = oi.order_id
        LEFT JOIN ${dataset}.product_variations pv ON oi.variation_id = pv.id
        LEFT JOIN ${dataset}.product_cogs pc ON oi.variation_id = pc.variation_id
        WHERE so.status_name NOT IN ('waitting', 'ordered')
            AND DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at))
                BETWEEN '${from}' AND '${to}'
            AND COALESCE(
                NULLIF(pc.cost_raw, 0),
                NULLIF(oi.avg_imported_price, 0),
                NULLIF(SAFE_CAST(pv.imported_price AS FLOAT64), 0)
            ) > 0
        GROUP BY 1
    )
    SELECT d.report_date, d.cogs_eur AS cogs
    FROM daily_cogs d
    ORDER BY 1 DESC`;
}

/**
 * P&L Q0c: Daily ACTUAL orders + revenue — status IN ('delivered','received_money')
 */
export function queryPnlDailyActual(dataset: string, from: string, to: string) {
    return `WITH fx_eur AS (
        SELECT rate FROM ${dataset}.cost_exchange_rates
        WHERE from_currency = 'EUR' AND to_currency = 'RON'
        ORDER BY effective_date DESC LIMIT 1
    ),
    daily_actual AS (
        SELECT
            DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at)) AS report_date,
            COUNTIF(status_name IN ('delivered', 'received_money'))     AS actual_orders,
            ROUND(SUM(CASE WHEN status_name IN ('delivered', 'received_money')
                THEN SAFE_CAST(cod AS FLOAT64) / 100.0 ELSE 0 END), 0) AS actual_revenue_eur
        FROM ${dataset}.sale_order
        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at))
            BETWEEN '${from}' AND '${to}'
        GROUP BY 1
    )
    SELECT d.report_date, d.actual_orders,
        d.actual_revenue_eur AS actual_revenue
    FROM daily_actual d
    ORDER BY 1 DESC`;
}

/**
 * P&L Q0d: Daily ACTUAL COGS — same join as Q0b but only delivered/received_money orders
 */
export function queryPnlDailyActualCogs(dataset: string, from: string, to: string) {
    return `WITH fx_eur AS (
        SELECT rate FROM ${dataset}.cost_exchange_rates
        WHERE from_currency = 'EUR' AND to_currency = 'RON'
        ORDER BY effective_date DESC LIMIT 1
    ),
    daily_acogs AS (
        SELECT
            DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at)) AS report_date,
            ROUND(SUM(
                SAFE_CAST(oi.quantity AS INT64) * COALESCE(
                    NULLIF(pc.cost_raw, 0),
                    NULLIF(oi.avg_imported_price, 0),
                    NULLIF(SAFE_CAST(pv.imported_price AS FLOAT64), 0),
                    0
                ) / 100.0
            ), 0) AS actual_cogs_eur
        FROM ${dataset}.sale_order so
        JOIN ${dataset}.order_items oi ON so.id = oi.order_id
        LEFT JOIN ${dataset}.product_variations pv ON oi.variation_id = pv.id
        LEFT JOIN ${dataset}.product_cogs pc ON oi.variation_id = pc.variation_id
        WHERE so.status_name IN ('delivered', 'received_money')
            AND DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at))
                BETWEEN '${from}' AND '${to}'
            AND COALESCE(
                NULLIF(pc.cost_raw, 0),
                NULLIF(oi.avg_imported_price, 0),
                NULLIF(SAFE_CAST(pv.imported_price AS FLOAT64), 0)
            ) > 0
        GROUP BY 1
    )
    SELECT d.report_date, d.actual_cogs_eur AS actual_cogs
    FROM daily_acogs d
    ORDER BY 1 DESC`;
}

/**
 * P&L Q1: Daily ads spend from fb_ads_data (raw table, no JOIN multiplication).
 * ⚠️ Previously used vw_fact_ads_performance which LEFT JOINs orders — this caused
 *    spend duplication when one ad matched orders from multiple marketers/markets.
 * Source: fb_ads_data.spend — USD (Meta API billing currency), convert client-side.
 */
export function queryPnlDailyAds(dataset: string, from: string, to: string) {
    return `SELECT
        date AS report_date,
        ROUND(SUM(spend), 2) as ads_usd
    FROM ${dataset}.${BQ_TABLES.ADS_RAW}
    WHERE date BETWEEN '${from}' AND '${to}'
    GROUP BY 1
    ORDER BY 1 DESC`;
}

/**
 * P&L Q2: Daily COGS + FFM (3PL fulfillment) costs from mart
 * Source: mart — has real COGS (order_cogs CTE) and real 3PL costs.
 * ⚠️ pnl_flex hardcodes cogs=0 and shipping_cost=0 — never use those columns.
 * Merged client-side with Q0+Q1 for complete daily P&L.
 */
export function queryPnlDailyFfm(dataset: string, from: string, to: string) {
    return `SELECT
        ${MART.REPORT_DATE},
        SUM(${MART.TOTAL_ORDERS}) as total_orders,
        SUM(${MART.SUCCESS_ORDERS}) as success_orders,
        ROUND(SUM(COALESCE(${MART.COGS}, 0)), 0) as cogs,
        ROUND(SUM(COALESCE(${MART.FULFILLMENT}, 0)) + SUM(COALESCE(${MART.RETURN_FULFILLMENT}, 0)), 0) as ffm
    FROM ${dataset}.${BQ_TABLES.MART}
    WHERE ${MART.REPORT_DATE} BETWEEN '${from}' AND '${to}'
    GROUP BY 1
    ORDER BY 1 DESC`;
}

/**
 * P&L Q5: Daily ACTUAL 3PL/FFM costs from ffm_shipments (euShipments API)
 * Source: ffm_shipments — ground truth for actual shipping costs (incl 20% VAT)
 * Joins with sale_order by order_id so costs are grouped by ORDER date,
 * not shipment creation date (fixes weekend gaps where 3PL doesn't create AWBs).
 * Returns costs in RON (converted via cost_exchange_rates)
 */
export function queryPnlDailyFfmActual(dataset: string, from: string, to: string) {
    return `WITH fx_eur AS (
        SELECT rate FROM ${dataset}.cost_exchange_rates
        WHERE from_currency = 'EUR' AND to_currency = 'RON'
        ORDER BY effective_date DESC LIMIT 1
    ),
    daily_eur AS (
        SELECT
            DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at)) AS report_date,
            ROUND(SUM(f.price_incl_vat), 2) AS ffm_eur
        FROM ${dataset}.ffm_shipments f
        JOIN ${dataset}.sale_order so
          ON f.pos_order_id = CAST(so.id AS STRING)
        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at))
            BETWEEN '${from}' AND '${to}'
        GROUP BY 1
    )
    SELECT
        d.report_date,
        ROUND(d.ffm_eur * fx.rate, 0) AS ffm_actual_ron,
        d.ffm_eur AS ffm_actual_eur
    FROM daily_eur d
    CROSS JOIN fx_eur fx
    ORDER BY 1 DESC`;
}

/**
 * P&L Q6: Product P&L Forecast — per-product DR from 35-14 day settlement window
 * Revenue per product from order_items (retail_price × qty - discount)
 * COGS hierarchy: cost_raw > avg_imported_price > imported_price
 * FFM allocated per product by splitting shipment cost across distinct products per order
 */
export function queryPnlProductForecast(dataset: string, from: string, to: string) {
    return `WITH fx_eur AS (
        SELECT rate FROM ${dataset}.cost_exchange_rates
        WHERE from_currency = 'EUR' AND to_currency = 'RON'
        ORDER BY effective_date DESC LIMIT 1
    ),
    -- Per-product delivery rate from 35-14 day settlement window
    product_dr AS (
        SELECT
            oi.product_id,
            ROUND(SAFE_DIVIDE(
                COUNTIF(so.status_name IN ('delivered', 'received_money')),
                NULLIF(COUNTIF(so.status_name NOT IN ('waitting', 'ordered')), 0)
            ), 4) AS delivery_rate
        FROM ${dataset}.sale_order so
        JOIN ${dataset}.order_items oi ON so.id = oi.order_id
        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at))
            BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 35 DAY)
            AND DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
            AND so.status_name NOT IN ('waitting', 'ordered')
        GROUP BY 1
    ),
    -- Orders + revenue per product in date range
    -- retail_price=0 (POS sync gap) → split cod proportionally by quantity
    product_orders AS (
        SELECT
            oi.product_id,
            COALESCE(pt.custom_id, 'UNKNOWN') AS product_code,
            COALESCE(pt.name, 'Unknown Product') AS product_name,
            COUNT(DISTINCT so.id) AS total_orders,
            ROUND(SUM(
                SAFE_CAST(oi.quantity AS INT64)
                * SAFE_DIVIDE(SAFE_CAST(so.cod AS FLOAT64), ot.total_qty)
                / 100.0
            ), 0) AS revenue
        FROM ${dataset}.sale_order so
        JOIN ${dataset}.order_items oi ON so.id = oi.order_id
        LEFT JOIN ${dataset}.product_template pt ON oi.product_id = pt.id
        JOIN (
            SELECT order_id, SUM(SAFE_CAST(quantity AS INT64)) AS total_qty
            FROM ${dataset}.order_items GROUP BY 1
        ) ot ON so.id = ot.order_id
        WHERE so.status_name NOT IN ('waitting', 'ordered')
            AND DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at))
                BETWEEN '${from}' AND '${to}'
        GROUP BY 1, 2, 3
    ),
    -- COGS per product (all non-canceled orders in date range)
    product_cogs AS (
        SELECT
            oi.product_id,
            ROUND(SUM(
                SAFE_CAST(oi.quantity AS INT64) * COALESCE(
                    NULLIF(pc.cost_raw, 0),
                    NULLIF(oi.avg_imported_price, 0),
                    NULLIF(SAFE_CAST(pv.imported_price AS FLOAT64), 0),
                    0
                ) / 100.0
            ), 0) AS cogs_all
        FROM ${dataset}.sale_order so
        JOIN ${dataset}.order_items oi ON so.id = oi.order_id
        LEFT JOIN ${dataset}.product_variations pv ON oi.variation_id = pv.id
        LEFT JOIN ${dataset}.product_cogs pc ON oi.variation_id = pc.variation_id
        WHERE so.status_name NOT IN ('waitting', 'ordered')
            AND DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at))
                BETWEEN '${from}' AND '${to}'
            AND COALESCE(
                NULLIF(pc.cost_raw, 0),
                NULLIF(oi.avg_imported_price, 0),
                NULLIF(SAFE_CAST(pv.imported_price AS FLOAT64), 0)
            ) > 0
        GROUP BY 1
    ),
    -- FFM cost allocated per product (split by distinct products per order)
    product_ffm AS (
        SELECT
            oi.product_id,
            ROUND(SUM(
                f.price_incl_vat / ipo.product_count
            ), 2) AS ffm_eur
        FROM ${dataset}.ffm_shipments f
        JOIN ${dataset}.sale_order so
            ON f.pos_order_id = CAST(so.id AS STRING)
        JOIN ${dataset}.order_items oi ON so.id = oi.order_id
        JOIN (
            SELECT order_id, COUNT(DISTINCT product_id) AS product_count
            FROM ${dataset}.order_items
            GROUP BY 1
        ) ipo ON so.id = ipo.order_id
        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at))
            BETWEEN '${from}' AND '${to}'
            AND f.price_incl_vat > 0
        GROUP BY 1
    ),
    -- Ads spend per product from mart_product_insights (ad_id → dominant product attribution)
    product_ads AS (
        SELECT
            UPPER(TRIM(product_code)) AS product_code,
            ROUND(SUM(COALESCE(ads_spend_ron, 0)), 0) AS ads_ron
        FROM ${dataset}.mart_product_insights
        WHERE report_date BETWEEN '${from}' AND '${to}'
        GROUP BY 1
    )
    SELECT
        po.product_code,
        po.product_name,
        po.total_orders,
        ROUND(COALESCE(pdr.delivery_rate, 0) * 100, 1) AS dr_pct,
        ROUND(po.total_orders * COALESCE(pdr.delivery_rate, 0)) AS est_success_orders,
        ROUND(po.revenue * COALESCE(pdr.delivery_rate, 0), 0) AS est_revenue,
        ROUND(COALESCE(pcg.cogs_all, 0) * COALESCE(pdr.delivery_rate, 0), 0) AS est_cogs,
        ROUND(COALESCE(pf.ffm_eur, 0) * fx.rate, 0) AS ffm_ron,
        COALESCE(pa.ads_ron, 0) AS ads_ron,
        ROUND(
            po.revenue * COALESCE(pdr.delivery_rate, 0)
            - COALESCE(pcg.cogs_all, 0) * COALESCE(pdr.delivery_rate, 0)
            - COALESCE(pf.ffm_eur, 0) * fx.rate
            - COALESCE(pa.ads_ron, 0)
        , 0) AS est_profit,
        ROUND(SAFE_DIVIDE(
            po.revenue * COALESCE(pdr.delivery_rate, 0)
            - COALESCE(pcg.cogs_all, 0) * COALESCE(pdr.delivery_rate, 0)
            - COALESCE(pf.ffm_eur, 0) * fx.rate
            - COALESCE(pa.ads_ron, 0),
            NULLIF(po.revenue * COALESCE(pdr.delivery_rate, 0), 0)
        ) * 100, 1) AS est_margin_pct
    FROM product_orders po
    LEFT JOIN product_dr pdr ON po.product_id = pdr.product_id
    LEFT JOIN product_cogs pcg ON po.product_id = pcg.product_id
    LEFT JOIN product_ffm pf ON po.product_id = pf.product_id
    LEFT JOIN product_ads pa ON UPPER(TRIM(po.product_code)) = pa.product_code
    CROSS JOIN fx_eur fx
    WHERE po.total_orders > 0
    ORDER BY est_revenue DESC
    LIMIT 30`;
}

/**
 * CEO Q_FFM: Actual 3PL/FFM from ffm_shipments for CEO overview
 * Returns monthly totals in RON for consistency with other CEO metrics
 */
export function queryCeoFfmActual(dataset: string, from: string, to: string) {
    return `WITH fx_eur AS (
        SELECT rate FROM ${dataset}.cost_exchange_rates
        WHERE from_currency = 'EUR' AND to_currency = 'RON'
        ORDER BY effective_date DESC LIMIT 1
    ),
    monthly_eur AS (
        SELECT
            FORMAT_DATE('%Y-%m', DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at))) AS month,
            ROUND(SUM(f.price_incl_vat), 2) AS ffm_eur
        FROM ${dataset}.ffm_shipments f
        JOIN ${dataset}.sale_order so
          ON f.pos_order_id = CAST(so.id AS STRING)
        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at))
            BETWEEN '${from}' AND '${to}'
        GROUP BY 1
    )
    SELECT m.month, ROUND(m.ffm_eur * fx.rate, 0) AS ffm_actual
    FROM monthly_eur m
    CROSS JOIN fx_eur fx
    ORDER BY 1`;
}

// ─── Marketing Tab Queries ───────────────────────────────────────────────────

/**
 * Marketing: Ads KPIs (total spend, impressions, clicks, CTR, CPM)
 * Source: fb_ads_data raw — no JOIN multiplication.
 */
export function queryMarketingAdsKpis(dataset: string, from: string, to: string) {
    return `SELECT
        ROUND(SUM(spend),2) as spend_usd,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        ROUND(SAFE_DIVIDE(SUM(clicks)*100, NULLIF(SUM(impressions),0)),2) as ctr,
        ROUND(SAFE_DIVIDE(SUM(spend)*1000, NULLIF(SUM(impressions),0)),2) as cpm_usd
    FROM ${dataset}.${BQ_TABLES.ADS_RAW}
    WHERE date BETWEEN '${from}' AND '${to}'`;
}

/**
 * Marketing: Daily ads trend (for chart)
 * Source: fb_ads_data raw — no JOIN multiplication.
 */
export function queryMarketingDailyTrend(dataset: string, from: string, to: string) {
    return `SELECT
        date AS report_date,
        ROUND(SUM(spend),2) as spend_usd,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks
    FROM ${dataset}.${BQ_TABLES.ADS_RAW}
    WHERE date BETWEEN '${from}' AND '${to}'
    GROUP BY 1 ORDER BY 1`;
}

/**
 * Marketing Q2: Ads spend per marketer CODE
 * Source: fb_ads_data raw + campaign name parsing (no order JOINs).
 */
export function queryMarketingAdsByMarketer(dataset: string, from: string, to: string) {
    return `WITH parsed AS (
        SELECT spend, impressions, clicks, ${ADS_MKTER_PARSE} AS mkter_code
        FROM ${dataset}.${BQ_TABLES.ADS_RAW}
        WHERE date BETWEEN '${from}' AND '${to}')
    SELECT mkter_code,
        ROUND(SUM(spend),2) as ads_spend_usd,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks
    FROM parsed GROUP BY 1`;
}

/**
 * Marketing Q3: Marketer orders/revenue from mart
 * Source: mart — for orders, revenue, cogs, shipping per marketer
 */
export function queryMarketingMarketerPnl(dataset: string, from: string, to: string, opts?: { fulfillment?: string; returnFulfillment?: string; revenueCol?: string }) {
    const ful = opts?.fulfillment || MART.FULFILLMENT;
    const rful = opts?.returnFulfillment || MART.RETURN_FULFILLMENT;
    const rev = opts?.revenueCol || MART.REVENUE;
    return `SELECT
        ${MART.MARKETER} as marketer_name,
        SUM(${MART.TOTAL_ORDERS}) as orders,
        SUM(${MART.SUCCESS_ORDERS}) as success,
        SUM(${MART.RETURNED_ORDERS}) as returned,
        ROUND(SUM(COALESCE(${rev}, 0)),0) as revenue,
        ROUND(SUM(COALESCE(${ful}, 0)) + SUM(COALESCE(${rful}, 0)),0) as shipping,
        ROUND(SUM(COALESCE(${MART.COGS}, 0)),0) as cogs,
        ROUND(SUM(COALESCE(${MART.NET_PROFIT}, 0)),0) as net_profit
    FROM ${dataset}.${BQ_TABLES.MART}
    WHERE ${MART.REPORT_DATE} BETWEEN '${from}' AND '${to}'
        AND ${MART.MARKETER} IS NOT NULL
    GROUP BY 1 ORDER BY revenue DESC`;
}

/**
 * Marketing Q4b: Delivered orders count from vw_fact_orders
 * Source: vw_fact_orders — status_group = 'success' = đã giao + nhận tiền
 * Note: vw_fact_orders has no marketer column → only total count available
 */
export function queryMarketingDeliveredOrders(dataset: string, from: string, to: string) {
    return `SELECT
        COUNT(*) as delivered_count
    FROM ${dataset}.${BQ_TABLES.ORDERS}
    WHERE ${ORDERS.ORDER_DATE} BETWEEN '${from}' AND '${to}'
        AND ${ORDERS.STATUS_GROUP} = 'success'`;
}

/**
 * Marketing Q4: Daily revenue overlay (for chart merge)
 * Source: mart
 */
export function queryMarketingDailyRevenue(dataset: string, from: string, to: string) {
    return `SELECT
        ${MART.REPORT_DATE},
        ROUND(SUM(COALESCE(${MART.REVENUE}, 0)),0) as revenue
    FROM ${dataset}.${BQ_TABLES.MART}
    WHERE ${MART.REPORT_DATE} BETWEEN '${from}' AND '${to}'
    GROUP BY 1 ORDER BY 1`;
}

/**
 * Marketing Q5: Daily ads by marketer CODE
 * Source: fb_ads_data raw + campaign name parsing (no order JOINs).
 */
export function queryMarketingDailyAds(dataset: string, from: string, to: string) {
    return `WITH parsed AS (
        SELECT date AS report_date, spend, ${ADS_MKTER_PARSE} AS mkter_code
        FROM ${dataset}.${BQ_TABLES.ADS_RAW}
        WHERE date BETWEEN '${from}' AND '${to}')
    SELECT report_date, mkter_code,
        ROUND(SUM(spend),0) as ads_spend
    FROM parsed GROUP BY 1, 2
    ORDER BY 1 DESC, ads_spend DESC`;
}

/**
 * Marketing Q6: Daily orders by marketer from mart
 * Source: mart — orders data per date × marketer
 * Merged with Q5 client-side for complete daily detail
 */
export function queryMarketingDailyOrders(dataset: string, from: string, to: string, opts?: { fulfillment?: string; returnFulfillment?: string; revenueCol?: string }) {
    const ful = opts?.fulfillment || MART.FULFILLMENT;
    const rful = opts?.returnFulfillment || MART.RETURN_FULFILLMENT;
    const rev = opts?.revenueCol || MART.REVENUE;
    return `SELECT
        ${MART.REPORT_DATE},
        ${MART.MARKETER} as marketer_name,
        SUM(${MART.TOTAL_ORDERS}) as orders,
        SUM(${MART.SUCCESS_ORDERS}) as success,
        SUM(${MART.RETURNED_ORDERS}) as returned,
        ROUND(SUM(COALESCE(${rev}, 0)),0) as revenue,
        ROUND(SUM(COALESCE(${MART.COGS}, 0)),0) as cogs,
        ROUND(SUM(COALESCE(${ful}, 0)) + SUM(COALESCE(${rful}, 0)),0) as shipping
    FROM ${dataset}.${BQ_TABLES.MART}
    WHERE ${MART.REPORT_DATE} BETWEEN '${from}' AND '${to}'
        AND ${MART.MARKETER} IS NOT NULL
    GROUP BY 1, 2
    ORDER BY 1 DESC, revenue DESC`;
}

// ─── Overview Tab Queries ────────────────────────────────────────────────────

/**
 * Overview: Summary metrics (last 30 days, last 7 days)
 * Source: mart
 */
export function queryOverviewSummary(dataset: string, from: string, to: string) {
    return `SELECT
        SUM(${MART.TOTAL_ORDERS}) as orders,
        SUM(${MART.SUCCESS_ORDERS}) as success,
        SUM(${MART.RETURNED_ORDERS}) as returned,
        ROUND(SUM(COALESCE(${MART.REVENUE}, 0)),0) as revenue,
        ROUND(SUM(COALESCE(${MART.ADS_SPEND}, 0)),0) as ads,
        ROUND(SUM(COALESCE(${MART.NET_PROFIT}, 0)),0) as net_profit,
        ROUND(SAFE_DIVIDE(SUM(COALESCE(${MART.REVENUE}, 0)), NULLIF(SUM(COALESCE(${MART.ADS_SPEND}, 0)),0)),2) as roas
    FROM ${dataset}.${BQ_TABLES.MART}
    WHERE ${MART.REPORT_DATE} BETWEEN '${from}' AND '${to}'`;
}

/**
 * Overview: Daily trend
 * Source: mart
 */
export function queryOverviewDailyTrend(dataset: string, from: string, to: string) {
    return `SELECT
        ${MART.REPORT_DATE},
        SUM(${MART.TOTAL_ORDERS}) as orders,
        SUM(${MART.SUCCESS_ORDERS}) as success,
        ROUND(SUM(COALESCE(${MART.REVENUE}, 0)),0) as revenue,
        ROUND(SUM(COALESCE(${MART.ADS_SPEND}, 0)),0) as ads,
        ROUND(SUM(COALESCE(${MART.NET_PROFIT}, 0)),0) as net_profit
    FROM ${dataset}.${BQ_TABLES.MART}
    WHERE ${MART.REPORT_DATE} BETWEEN '${from}' AND '${to}'
    GROUP BY 1 ORDER BY 1`;
}

// ─── Product Tab Queries ─────────────────────────────────────────────────────

/**
 * Products: Product performance ranking
 * Source: mart_product_insights
 */
export function queryProductRanking(dataset: string, from: string, to: string) {
    return `SELECT
        ${PRODUCT_VIEW.SKU},
        ${PRODUCT_VIEW.PRODUCT_NAME},
        SUM(${PRODUCT_VIEW.ORDER_COUNT}) as orders,
        SUM(${PRODUCT_VIEW.UNITS_DELIVERED}) as delivered,
        SUM(${PRODUCT_VIEW.UNITS_RETURNED}) as returned,
        ROUND(SUM(${PRODUCT_VIEW.REVENUE}),0) as revenue,
        ROUND(SUM(${PRODUCT_VIEW.COGS}),0) as cogs,
        ROUND(SUM(${PRODUCT_VIEW.ADS_SPEND}),0) as ads,
        ROUND(SUM(${PRODUCT_VIEW.GROSS_PROFIT}),0) as profit
    FROM ${dataset}.${BQ_TABLES.PRODUCT_VIEW}
    WHERE ${PRODUCT_VIEW.REPORT_DATE} BETWEEN '${from}' AND '${to}'
    GROUP BY 1, 2
    ORDER BY revenue DESC`;
}

// ─── Market Intel Queries ────────────────────────────────────────────────────

/**
 * Market Intel: Performance by market
 * Source: mart_product_insights (has market dimension)
 */
export function queryMarketPerformance(dataset: string, from: string, to: string) {
    return `SELECT
        ${PRODUCT_VIEW.MARKET} as market,
        SUM(${PRODUCT_VIEW.ORDER_COUNT}) as orders,
        SUM(${PRODUCT_VIEW.UNITS_DELIVERED}) as delivered,
        SUM(${PRODUCT_VIEW.UNITS_RETURNED}) as returned,
        ROUND(SUM(${PRODUCT_VIEW.REVENUE}),0) as revenue,
        ROUND(SUM(${PRODUCT_VIEW.ADS_SPEND}),0) as ads,
        ROUND(SUM(${PRODUCT_VIEW.GROSS_PROFIT}),0) as profit
    FROM ${dataset}.${BQ_TABLES.PRODUCT_VIEW}
    WHERE ${PRODUCT_VIEW.REPORT_DATE} BETWEEN '${from}' AND '${to}'
        AND ${PRODUCT_VIEW.MARKET} IS NOT NULL AND ${PRODUCT_VIEW.MARKET} != 'Unknown'
    GROUP BY 1 ORDER BY revenue DESC`;
}

// ─── CEO Extra Queries ───────────────────────────────────────────────────────

/**
 * CEO Q2: Product ranking with margin & profit
 * Source: mart_product_insights
 */
export function queryCeoProductRanking(dataset: string, from: string, to: string) {
    return `SELECT
        product_code, product_name,
        SUM(${PRODUCT_VIEW.ORDER_COUNT}) as orders,
        SUM(${PRODUCT_VIEW.UNITS_DELIVERED}) as success,
        SUM(${PRODUCT_VIEW.UNITS_RETURNED}) as returned,
        ROUND(SAFE_DIVIDE(SUM(${PRODUCT_VIEW.UNITS_DELIVERED})*100, NULLIF(SUM(${PRODUCT_VIEW.ORDER_COUNT}),0)),1) as sr,
        ROUND(SUM(${PRODUCT_VIEW.REVENUE}),0) as revenue,
        ROUND(AVG(margin_pct),1) as margin,
        ROUND(SUM(${PRODUCT_VIEW.GROSS_PROFIT}),0) as gross_profit
    FROM ${dataset}.${BQ_TABLES.PRODUCT_VIEW}
    WHERE ${PRODUCT_VIEW.REPORT_DATE} BETWEEN '${from}' AND '${to}'
    GROUP BY 1,2 ORDER BY revenue DESC
    LIMIT 10`;
}

/**
 * CEO Q3: Market ranking with CPA
 * Source: mart_product_insights
 */
export function queryCeoMarketRanking(dataset: string, from: string, to: string, marketCodes?: string[]) {
    const codeFilter = marketCodes && marketCodes.length > 0
        ? `AND market_code IN (${marketCodes.map(c => `'${c.replace(/'/g, "")}'`).join(",")})`
        : '';
    return `SELECT
        market,
        SUM(total_orders) as orders,
        SUM(COALESCE(success_orders, 0)) as success,
        ROUND(SAFE_DIVIDE(SUM(COALESCE(success_orders, 0))*100, NULLIF(SUM(total_orders),0)),1) as sr,
        ROUND(SUM(COALESCE(revenue_success, revenue_lead, 0)),0) as revenue,
        ROUND(SUM(COALESCE(ads_spend_ron, 0)),0) as ads_spend,
        ROUND(SAFE_DIVIDE(SUM(COALESCE(revenue_success, revenue_lead, 0)), NULLIF(SUM(COALESCE(ads_spend_ron, 0)),0)),2) as roas,
        ROUND(SAFE_DIVIDE(SUM(COALESCE(ads_spend_ron, 0)), NULLIF(SUM(total_orders),0)),0) as cpa
    FROM ${dataset}.${BQ_TABLES.MARKET_INTEL}
    WHERE report_date BETWEEN '${from}' AND '${to}'
        AND market IS NOT NULL AND market != 'Unknown'
        ${codeFilter}
    GROUP BY 1 ORDER BY revenue DESC
    LIMIT 10`;
}

/**
 * CEO Q4: Ads spend by marketer CODE
 * Source: fb_ads_data raw + campaign name parsing (no order JOINs).
 */
export function queryCeoAdsByMarketer(dataset: string, from: string, to: string) {
    return `WITH parsed AS (
        SELECT spend, ${ADS_MKTER_PARSE} AS mkter_code
        FROM ${dataset}.${BQ_TABLES.ADS_RAW}
        WHERE date BETWEEN '${from}' AND '${to}')
    SELECT mkter_code,
        ROUND(SUM(spend), 0) as ads_spend
    FROM parsed GROUP BY 1`;
}

/**
 * CEO Q5: Stock levels (complex join — product_stock × product_template)
 * Source: product_stock + product_template
 */
export function queryCeoStock(dataset: string) {
    return `SELECT
        COALESCE(pt.custom_id, REGEXP_EXTRACT(ps.product_name, r'^([A-Z]\\\\d+)')) as product_code,
        ps.product_name,
        SUM(SAFE_CAST(ps.quantity_on_hand AS INT64)) as stock_qty,
        COUNT(DISTINCT ps.variation_id) as variations,
        ROUND(SUM(SAFE_CAST(ps.quantity_on_hand AS INT64) * SAFE_CAST(ps.retail_price AS FLOAT64)), 0) as retail_value,
        ROUND(SUM(SAFE_CAST(ps.quantity_on_hand AS INT64) * SAFE_CAST(ps.avg_cost AS FLOAT64)), 0) as cost_value
    FROM ${dataset}.${BQ_TABLES.STOCK} ps
    LEFT JOIN ${dataset}.${BQ_TABLES.PRODUCTS} pt ON ps.product_id = pt.id
    GROUP BY 1, 2
    ORDER BY stock_qty DESC
    LIMIT 20`;
}

// ─── Marketer Performance Tab ────────────────────────────────────────────────

/**
 * Marketer Perf Q0: Summary P&L per marketer
 * Source: mart — same as CEO marketer table
 */
export function queryMarketerPerfSummary(dataset: string, from: string, to: string, opts?: { fulfillment?: string; returnFulfillment?: string; revenueCol?: string }) {
    const ful = opts?.fulfillment || MART.FULFILLMENT;
    const rful = opts?.returnFulfillment || MART.RETURN_FULFILLMENT;
    const rev = opts?.revenueCol || MART.REVENUE;
    return `SELECT
        ${MART.MARKETER} as marketer_name,
        SUM(${MART.TOTAL_ORDERS}) as orders,
        SUM(${MART.SUCCESS_ORDERS}) as success,
        SUM(${MART.RETURNED_ORDERS}) as returned,
        ROUND(SUM(COALESCE(${rev}, 0)),0) as revenue,
        ROUND(SUM(COALESCE(${MART.ADS_SPEND}, 0)),0) as ads_spend,
        ROUND(SUM(COALESCE(${MART.COGS}, 0)),0) as cogs,
        ROUND(SUM(COALESCE(${ful}, 0)) + SUM(COALESCE(${rful}, 0)),0) as shipping,
        ROUND(SUM(COALESCE(${MART.NET_PROFIT}, 0)),0) as net_profit,
        ROUND(SAFE_DIVIDE(SUM(COALESCE(${MART.REVENUE}, 0)), NULLIF(SUM(COALESCE(${MART.ADS_SPEND}, 0)),0)),2) as roas,
        ROUND(SAFE_DIVIDE(SUM(${MART.SUCCESS_ORDERS})*100, NULLIF(SUM(${MART.TOTAL_ORDERS}),0)),1) as sr
    FROM ${dataset}.${BQ_TABLES.MART}
    WHERE ${MART.REPORT_DATE} BETWEEN '${from}' AND '${to}'
        AND ${MART.MARKETER} IS NOT NULL
    GROUP BY 1 ORDER BY revenue DESC`;
}

/**
 * Marketer Perf Q1: Daily trend per marketer
 * Source: mart
 */
export function queryMarketerDailyTrend(dataset: string, from: string, to: string) {
    return `SELECT
        ${MART.REPORT_DATE},
        ${MART.MARKETER} as marketer_name,
        SUM(${MART.TOTAL_ORDERS}) as orders,
        SUM(${MART.SUCCESS_ORDERS}) as success,
        ROUND(SUM(COALESCE(${MART.REVENUE}, 0)),0) as revenue,
        ROUND(SUM(COALESCE(${MART.ADS_SPEND}, 0)),0) as ads_spend
    FROM ${dataset}.${BQ_TABLES.MART}
    WHERE ${MART.REPORT_DATE} BETWEEN '${from}' AND '${to}'
        AND ${MART.MARKETER} IS NOT NULL
    GROUP BY 1, 2 ORDER BY 1, revenue DESC`;
}

// ─── Overview Extra ──────────────────────────────────────────────────────────

/**
 * Overview: Marketer breakdown (top marketers)
 * Source: mart
 */
export function queryOverviewMarketerBreakdown(dataset: string, from: string, to: string) {
    return `SELECT
        ${MART.MARKETER} as marketer_name,
        SUM(${MART.TOTAL_ORDERS}) as orders,
        SUM(${MART.SUCCESS_ORDERS}) as success,
        ROUND(SUM(COALESCE(${MART.REVENUE}, 0)),0) as revenue,
        ROUND(SUM(COALESCE(${MART.ADS_SPEND}, 0)),0) as ads,
        ROUND(SUM(COALESCE(${MART.NET_PROFIT}, 0)),0) as net_profit
    FROM ${dataset}.${BQ_TABLES.MART}
    WHERE ${MART.REPORT_DATE} BETWEEN '${from}' AND '${to}'
        AND ${MART.MARKETER} IS NOT NULL
    GROUP BY 1 ORDER BY revenue DESC`;
}

/**
 * Overview: Latest orders (for activity feed)
 * Source: vw_fact_orders
 */
export function queryOverviewLatestOrders(dataset: string, from: string, to: string) {
    return `SELECT
        ${ORDERS.ORDER_DATE},
        ${ORDERS.STATUS} as status,
        SUM(${ORDERS.TOTAL_PRICE}) as total_price,
        COUNT(*) as order_count
    FROM ${dataset}.${BQ_TABLES.ORDERS}
    WHERE ${ORDERS.ORDER_DATE} BETWEEN '${from}' AND '${to}'
    GROUP BY 1, 2 ORDER BY 1 DESC`;
}

/**
 * Exchange rate lookup
 * Source: cost_exchange_rates
 */
export function queryExchangeRate(dataset: string) {
    return `SELECT rate FROM ${dataset}.${BQ_TABLES.FX}
    WHERE from_currency = 'USD' AND to_currency = 'VND'
    ORDER BY effective_date DESC LIMIT 1`;
}

// ─── Financial Control Queries ───────────────────────────────────────────────

/**
 * FinCtrl Q1: Overview KPIs — partner debt, settlement rate, pending payout
 * Source: ffm_shipments + cost_exchange_rates
 */
export function queryFinCtrlOverview(dataset: string, from: string, to: string) {
    return `WITH fx_eur AS (
    SELECT rate FROM ${dataset}.${BQ_TABLES.FX}
    WHERE from_currency = 'EUR' AND to_currency = 'RON'
    ORDER BY effective_date DESC LIMIT 1
),
payout_summary AS (
    SELECT
        COUNTIF(${FFM.STATUS} = 'Delivered') AS total_delivered,
        COUNTIF(${FFM.STATUS} = 'Delivered' AND ${FFM.PAYOUT_DATE} IS NOT NULL) AS total_settled,
        ROUND(SUM(CASE WHEN ${FFM.STATUS} = 'Delivered' AND ${FFM.PAYOUT_DATE} IS NULL
            THEN ${FFM.COD_AMOUNT} ELSE 0 END), 2) AS pending_cod_eur,
        ROUND(SUM(CASE WHEN ${FFM.STATUS} = 'Delivered' AND ${FFM.PAYOUT_DATE} IS NOT NULL
            THEN ${FFM.COD_AMOUNT} ELSE 0 END), 2) AS settled_cod_eur,
        ROUND(SUM(CASE WHEN ${FFM.STATUS} = 'Delivered' AND ${FFM.PAYOUT_DATE} IS NULL
            THEN ${FFM.PRICE_INCL_VAT} ELSE 0 END), 2) AS pending_ffm_cost_eur,
        ROUND(AVG(CASE WHEN ${FFM.PAYOUT_DATE} IS NOT NULL AND ${FFM.DELIVERED_DATE} IS NOT NULL
            THEN TIMESTAMP_DIFF(${FFM.PAYOUT_DATE}, ${FFM.DELIVERED_DATE}, HOUR) / 24.0 END), 1)
            AS avg_days_to_payout
    FROM ${dataset}.${BQ_TABLES.FFM_SHIPMENTS}
    WHERE ${FFM.IS_RETURN} = FALSE
        AND ${FFM.FFM_PARTNER} = 'euShipments'
        AND DATE(COALESCE(${FFM.CREATED_DATE}, synced_at)) BETWEEN '${from}' AND '${to}'
)
SELECT
    p.total_delivered,
    p.total_settled,
    ROUND(SAFE_DIVIDE(p.total_settled * 100, NULLIF(p.total_delivered, 0)), 1) AS settlement_rate_pct,
    p.pending_cod_eur,
    ROUND(p.pending_cod_eur * fx.rate, 0) AS pending_cod_ron,
    p.settled_cod_eur,
    p.pending_ffm_cost_eur,
    p.avg_days_to_payout,
    fx.rate AS eur_to_ron
FROM payout_summary p, fx_eur fx`;
}

/**
 * FinCtrl Q2: Aging buckets for unsettled delivered shipments
 * Source: ffm_shipments — groups by days since delivery
 */
export function queryFinCtrlAging(dataset: string, from: string, to: string) {
    return `SELECT
    CASE
        WHEN DATE_DIFF(CURRENT_DATE(), DATE(${FFM.DELIVERED_DATE}), DAY) <= 7 THEN '0-7 days'
        WHEN DATE_DIFF(CURRENT_DATE(), DATE(${FFM.DELIVERED_DATE}), DAY) <= 14 THEN '8-14 days'
        WHEN DATE_DIFF(CURRENT_DATE(), DATE(${FFM.DELIVERED_DATE}), DAY) <= 30 THEN '15-30 days'
        ELSE '30+ days'
    END AS aging_bucket,
    COUNT(*) AS order_count,
    ROUND(SUM(${FFM.COD_AMOUNT}), 2) AS pending_cod_eur,
    ROUND(SUM(${FFM.PRICE_INCL_VAT}), 2) AS ffm_cost_eur
FROM ${dataset}.${BQ_TABLES.FFM_SHIPMENTS}
WHERE ${FFM.STATUS} = 'Delivered'
    AND ${FFM.PAYOUT_DATE} IS NULL
    AND ${FFM.IS_RETURN} = FALSE
    AND ${FFM.DELIVERED_DATE} IS NOT NULL
    AND DATE(COALESCE(${FFM.CREATED_DATE}, synced_at)) BETWEEN '${from}' AND '${to}'
GROUP BY 1
ORDER BY CASE aging_bucket
    WHEN '0-7 days' THEN 1
    WHEN '8-14 days' THEN 2
    WHEN '15-30 days' THEN 3
    ELSE 4
END`;
}

/**
 * FinCtrl Q3a: Cash flow reconciliation summary
 * Source: ffm_shipments + payout data — compares COD receivable vs actually received
 */
export function queryFinCtrlCashReconciliation(dataset: string, from: string, to: string) {
    return `WITH fx_eur AS (
    SELECT rate FROM ${dataset}.${BQ_TABLES.FX}
    WHERE from_currency = 'EUR' AND to_currency = 'RON'
    ORDER BY effective_date DESC LIMIT 1
),
delivered AS (
    SELECT
        COALESCE(fo.${FFM_ORDERS.RECIPIENT_COUNTRY}, 'RO') AS market,
        COUNT(*) AS total_delivered,
        ROUND(SUM(f.${FFM.COD_AMOUNT}), 2) AS total_cod,
        COUNTIF(f.${FFM.PAYOUT_DATE} IS NOT NULL) AS paid_count,
        ROUND(SUM(CASE WHEN f.${FFM.PAYOUT_DATE} IS NOT NULL THEN f.${FFM.COD_AMOUNT} ELSE 0 END), 2) AS paid_cod,
        ROUND(SUM(CASE WHEN f.${FFM.PAYOUT_DATE} IS NULL THEN f.${FFM.COD_AMOUNT} ELSE 0 END), 2) AS pending_cod,
        ROUND(SUM(f.${FFM.PRICE_INCL_VAT}), 2) AS total_ffm_cost,
        f.${FFM.CURRENCY} AS currency
    FROM ${dataset}.${BQ_TABLES.FFM_SHIPMENTS} f
    LEFT JOIN ${dataset}.${BQ_TABLES.FULFILLMENT_ORDERS} fo
        ON f.${FFM.POS_ORDER_ID} = fo.${FFM_ORDERS.POS_ORDER_ID}
    WHERE f.${FFM.IS_RETURN} = FALSE
        AND f.${FFM.STATUS} = 'Delivered'
        AND DATE(COALESCE(f.${FFM.CREATED_DATE}, f.synced_at)) BETWEEN '${from}' AND '${to}'
    GROUP BY 1, 8
)
SELECT
    d.market,
    d.currency,
    d.total_delivered,
    d.total_cod,
    d.paid_count,
    d.paid_cod,
    d.pending_cod,
    d.total_ffm_cost,
    ROUND(d.paid_cod - d.total_ffm_cost, 2) AS net_after_cost,
    d.total_delivered - d.paid_count AS pending_count
FROM delivered d
ORDER BY d.total_cod DESC`;
}

/**
 * FinCtrl Q3c: Pending orders (delivered but not yet paid by euShipments)
 * Source: ffm_shipments WHERE payout_date IS NULL + orders for COD/market info
 */
export function queryFinCtrlPendingOrders(dataset: string, from: string, to: string) {
    return `SELECT
    f.${FFM.POS_ORDER_ID} AS order_id,
    DATE(f.${FFM.CREATED_DATE}) AS created_date,
    DATE(f.${FFM.DELIVERED_DATE}) AS delivered_date,
    DATE_DIFF(CURRENT_DATE(), DATE(f.${FFM.DELIVERED_DATE}), DAY) AS days_since_delivery,
    COALESCE(fo.${FFM_ORDERS.RECIPIENT_COUNTRY}, 'RO') AS market,
    f.${FFM.COD_AMOUNT} AS cod_amount,
    f.${FFM.CURRENCY} AS currency,
    ROUND(f.${FFM.PRICE_INCL_VAT}, 2) AS ffm_cost_eur,
    f.${FFM.AWB} AS awb,
    f.${FFM.CLIENT_ID} AS client_id,
    o.order_currency
FROM ${dataset}.${BQ_TABLES.FFM_SHIPMENTS} f
LEFT JOIN ${dataset}.${BQ_TABLES.FULFILLMENT_ORDERS} fo
    ON f.${FFM.POS_ORDER_ID} = fo.${FFM_ORDERS.POS_ORDER_ID}
LEFT JOIN ${dataset}.${BQ_TABLES.ORDERS} o
    ON f.${FFM.POS_ORDER_ID} = CAST(o.order_id AS STRING)
WHERE f.${FFM.IS_RETURN} = FALSE
    AND f.${FFM.STATUS} = 'Delivered'
    AND f.${FFM.PAYOUT_DATE} IS NULL
    AND DATE(COALESCE(f.${FFM.CREATED_DATE}, f.synced_at)) BETWEEN '${from}' AND '${to}'
ORDER BY days_since_delivery DESC
LIMIT 300`;
}

/**
 * FinCtrl Q3b: Per-order reconciliation detail (on demand)
 * Source: vw_fact_orders + fulfillment_orders + ffm_shipments + vw_ffm_cost_actual
 */
// queryFinCtrlReconciliation removed — use queryFinCtrlCashReconciliation + queryFinCtrlPendingOrders instead

/**
 * FinCtrl Q4: TCE unpaid orders (no date filter — all TCE history for debt collection)
 * Source: ffm_shipments WHERE ffm_partner = 'TCE'
 */
export function queryFinCtrlTceDebt(dataset: string) {
    return `SELECT
    ${FFM.AWB},
    ${FFM.POS_ORDER_ID},
    ${FFM.STATUS},
    ROUND(${FFM.COD_AMOUNT}, 2) AS cod_amount_eur,
    ROUND(${FFM.PRICE_INCL_VAT}, 2) AS ffm_cost_eur,
    DATE(${FFM.CREATED_DATE}) AS created_date,
    DATE(${FFM.DELIVERED_DATE}) AS delivered_date,
    DATE(${FFM.PAYOUT_DATE}) AS payout_date,
    CASE
        WHEN ${FFM.PAYOUT_DATE} IS NOT NULL THEN 'Settled'
        WHEN ${FFM.STATUS} = 'Delivered' THEN 'Unpaid'
        WHEN ${FFM.STATUS} = 'Returned' THEN 'Returned'
        ELSE ${FFM.STATUS}
    END AS debt_status,
    DATE_DIFF(CURRENT_DATE(), DATE(COALESCE(${FFM.DELIVERED_DATE}, ${FFM.CREATED_DATE})), DAY) AS days_outstanding
FROM ${dataset}.${BQ_TABLES.FFM_SHIPMENTS}
WHERE ${FFM.FFM_PARTNER} = 'TCE'
    AND ${FFM.IS_RETURN} = FALSE
ORDER BY days_outstanding DESC`;
}

/**
 * FinCtrl Q5: Weekly full cash flow — Revenue IN vs ALL costs OUT
 * Source: mart_performance_master (has revenue, ads, cogs, ffm costs aggregated weekly)
 */
export function queryFinCtrlWeeklyCashFlow(dataset: string, from: string, to: string) {
    return `SELECT
    DATE_TRUNC(${MART.REPORT_DATE}, WEEK(MONDAY)) AS week_start,
    FORMAT_DATE('%d/%m', DATE_TRUNC(${MART.REPORT_DATE}, WEEK(MONDAY))) AS week_label,
    ROUND(SUM(${MART.REVENUE}), 0) AS revenue,
    ROUND(SUM(${MART.ADS_SPEND}), 0) AS ads_spend,
    ROUND(SUM(${MART.COGS}), 0) AS cogs,
    ROUND(SUM(${MART.FULFILLMENT}), 0) AS ffm_cost,
    ROUND(SUM(${MART.RETURN_FULFILLMENT}), 0) AS return_ffm_cost,
    ROUND(SUM(${MART.NET_PROFIT}), 0) AS net_profit,
    ROUND(SUM(${MART.ADS_SPEND}) + SUM(${MART.COGS}) + SUM(${MART.FULFILLMENT}) + SUM(${MART.RETURN_FULFILLMENT}), 0) AS total_cost
FROM ${dataset}.${BQ_TABLES.MART}
WHERE ${MART.REPORT_DATE} BETWEEN '${from}' AND '${to}'
GROUP BY 1, 2
ORDER BY 1`;
}

/**
 * FinCtrl Q6: Cash cycle timeline — avg days between stages
 * Source: ffm_shipments — delivery and payout timestamps
 */
export function queryFinCtrlCashCycle(dataset: string, from: string, to: string) {
    return `SELECT
    ROUND(AVG(CASE WHEN ${FFM.DELIVERED_DATE} IS NOT NULL AND ${FFM.CREATED_DATE} IS NOT NULL
        THEN TIMESTAMP_DIFF(${FFM.DELIVERED_DATE}, ${FFM.CREATED_DATE}, HOUR) / 24.0 END), 1)
        AS avg_days_to_delivery,
    ROUND(AVG(CASE WHEN ${FFM.PAYOUT_DATE} IS NOT NULL AND ${FFM.DELIVERED_DATE} IS NOT NULL
        THEN TIMESTAMP_DIFF(${FFM.PAYOUT_DATE}, ${FFM.DELIVERED_DATE}, HOUR) / 24.0 END), 1)
        AS avg_days_delivery_to_payout,
    ROUND(AVG(CASE WHEN ${FFM.PAYOUT_DATE} IS NOT NULL AND ${FFM.CREATED_DATE} IS NOT NULL
        THEN TIMESTAMP_DIFF(${FFM.PAYOUT_DATE}, ${FFM.CREATED_DATE}, HOUR) / 24.0 END), 1)
        AS avg_days_total_cycle,
    COUNT(CASE WHEN ${FFM.PAYOUT_DATE} IS NOT NULL THEN 1 END) AS orders_with_payout,
    COUNT(CASE WHEN ${FFM.DELIVERED_DATE} IS NOT NULL THEN 1 END) AS orders_delivered
FROM ${dataset}.${BQ_TABLES.FFM_SHIPMENTS}
WHERE ${FFM.IS_RETURN} = FALSE
    AND ${FFM.STATUS} = 'Delivered'
    AND DATE(COALESCE(${FFM.CREATED_DATE}, synced_at)) BETWEEN '${from}' AND '${to}'`;
}

/**
 * FinCtrl Q7: Pending receivables grouped by delivery week
 * Source: ffm_shipments WHERE payout_date IS NULL
 */
export function queryFinCtrlPendingReceivables(dataset: string) {
    return `WITH fx_eur AS (
    SELECT rate FROM ${dataset}.${BQ_TABLES.FX}
    WHERE from_currency = 'EUR' AND to_currency = 'RON'
    ORDER BY effective_date DESC LIMIT 1
)
SELECT
    FORMAT_DATE('%d/%m', DATE_TRUNC(DATE(${FFM.DELIVERED_DATE}), WEEK(MONDAY))) AS week_label,
    COUNT(*) AS pending_orders,
    ROUND(SUM(${FFM.COD_AMOUNT}), 2) AS pending_cod_eur,
    ROUND(SUM(${FFM.COD_AMOUNT}) * fx.rate, 0) AS pending_cod_ron
FROM ${dataset}.${BQ_TABLES.FFM_SHIPMENTS}
CROSS JOIN fx_eur fx
WHERE ${FFM.STATUS} = 'Delivered'
    AND ${FFM.PAYOUT_DATE} IS NULL
    AND ${FFM.IS_RETURN} = FALSE
    AND ${FFM.DELIVERED_DATE} IS NOT NULL
GROUP BY 1, fx.rate
ORDER BY MIN(DATE(${FFM.DELIVERED_DATE}))`;
}

/**
 * FinCtrl Q8: Per-market financial summary
 * Source: ffm_shipments + fulfillment_orders for country
 */
export function queryFinCtrlMarketBreakdown(dataset: string, from: string, to: string) {
    return `WITH fx_eur AS (
    SELECT rate FROM ${dataset}.${BQ_TABLES.FX}
    WHERE from_currency = 'EUR' AND to_currency = 'RON'
    ORDER BY effective_date DESC LIMIT 1
)
SELECT
    COALESCE(fo.${FFM_ORDERS.RECIPIENT_COUNTRY}, 'RO') AS market,
    COUNT(DISTINCT f.${FFM.POS_ORDER_ID}) AS total_orders,
    COUNTIF(f.${FFM.STATUS} = 'Delivered') AS delivered,
    COUNTIF(f.${FFM.STATUS} IN ('Returned', 'returned')) AS returned,
    ROUND(SUM(CASE WHEN f.${FFM.STATUS} = 'Delivered' THEN f.${FFM.COD_AMOUNT} ELSE 0 END), 2) AS total_cod_eur,
    ROUND(SUM(f.${FFM.PRICE_INCL_VAT}), 2) AS total_ffm_cost_eur,
    ROUND(SUM(CASE WHEN f.${FFM.STATUS} = 'Delivered' THEN f.${FFM.COD_AMOUNT} ELSE 0 END)
        - SUM(f.${FFM.PRICE_INCL_VAT}), 2) AS net_eur,
    ROUND(SUM(CASE WHEN f.${FFM.STATUS} = 'Delivered' AND f.${FFM.PAYOUT_DATE} IS NULL
        THEN f.${FFM.COD_AMOUNT} ELSE 0 END), 2) AS pending_payout_eur,
    ROUND(AVG(CASE WHEN f.${FFM.PAYOUT_DATE} IS NOT NULL AND f.${FFM.DELIVERED_DATE} IS NOT NULL
        THEN TIMESTAMP_DIFF(f.${FFM.PAYOUT_DATE}, f.${FFM.DELIVERED_DATE}, HOUR) / 24.0 END), 1)
        AS avg_days_to_payout,
    ROUND(SAFE_DIVIDE(COUNTIF(f.${FFM.PAYOUT_DATE} IS NOT NULL) * 100,
        NULLIF(COUNTIF(f.${FFM.STATUS} = 'Delivered'), 0)), 1) AS settlement_rate_pct
FROM ${dataset}.${BQ_TABLES.FFM_SHIPMENTS} f
LEFT JOIN ${dataset}.${BQ_TABLES.FULFILLMENT_ORDERS} fo
    ON f.${FFM.POS_ORDER_ID} = fo.${FFM_ORDERS.POS_ORDER_ID}
CROSS JOIN fx_eur fx
WHERE f.${FFM.IS_RETURN} = FALSE
    AND DATE(COALESCE(f.${FFM.CREATED_DATE}, f.synced_at)) BETWEEN '${from}' AND '${to}'
GROUP BY 1
ORDER BY total_orders DESC`;
}
