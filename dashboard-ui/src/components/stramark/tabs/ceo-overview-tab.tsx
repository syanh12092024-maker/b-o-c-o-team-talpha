"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, Cell,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency, formatNumber, formatMoney, COLORS, cn, USD_TO_VND, RON_TO_VND, EUR_TO_VND } from "@/lib/utils";
import ExchangeRateBanner from "@/components/stramark/exchange-rate-banner";
import { DATASET } from "@/lib/constants";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { resolveMarketerName, isRealMarketer, CANONICAL_MARKETERS } from "@/lib/marketer-map";
import {
    Crown, TrendingUp, TrendingDown, DollarSign,
    Users, Globe, Package, Target, Warehouse, AlertTriangle, Truck, Activity, Info, X,
} from "lucide-react";

interface CeoOverviewTabProps {
    dateRange?: { from: Date; to: Date };
}

interface MonthlyPnl {
    month: string;
    orders: number;
    success: number;
    returned: number;
    revenue: number;
    ads_spend: number;
    cogs: number;
    shipping: number;
    net_profit: number;
}

interface MarketerRank {
    marketer_name: string;
    orders: number;
    success: number;
    returned: number;
    revenue: number;
    ads_spend: number;
    cogs: number;
    shipping: number;
    net_profit: number;
    roas: number;
    sr: number;
}

interface ProductRank {
    product_code: string;
    product_name: string;
    orders: number;
    success: number;
    returned: number;
    sr: number;
    revenue: number;
    margin: number;
    gross_profit: number;
}

interface MarketRank {
    market: string;
    orders: number;
    success: number;
    sr: number;
    revenue: number;
    ads_spend: number;
    roas: number;
    cpa: number;
}



function InfoTip({ content }: { content: string }) {
    return (
        <span className="group/tip relative inline-flex align-middle">
            <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
            <span className="pointer-events-none absolute left-1/2 bottom-full z-50 mb-1.5 w-60 -translate-x-1/2 rounded-md border border-border bg-popover p-2 text-[11px] font-normal leading-relaxed text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100">
                {content}
            </span>
        </span>
    );
}

function gradeMarketer(roas: number, netProfit: number): { label: string; color: string } {
    if (roas >= 5) return { label: "A+", color: "bg-emerald-500/20 text-emerald-400" };
    if (roas >= 3.5) return { label: "A", color: "bg-emerald-500/15 text-emerald-400" };
    if (roas >= 2.5) return { label: "B+", color: "bg-amber-500/15 text-amber-400" };
    if (netProfit < 0) return { label: "C", color: "bg-rose-500/15 text-rose-400" };
    return { label: "B", color: "bg-blue-500/15 text-blue-400" };
}

function gradeProduct(margin: number, returnRate?: number): { label: string; color: string } {
    if (margin >= 60) return { label: "⭐ Star", color: "bg-emerald-500/20 text-emerald-400" };
    if (margin >= 40) return { label: "Tốt", color: "bg-emerald-500/15 text-emerald-400" };
    if (margin >= 20) return { label: "Trung bình", color: "bg-amber-500/15 text-amber-400" };
    return { label: "Lỗ", color: "bg-rose-500/15 text-rose-400" };
}

export default function CeoOverviewTab({ dateRange }: CeoOverviewTabProps) {
    const [loading, setLoading] = useState(true);
    const [monthly, setMonthly] = useState<MonthlyPnl[]>([]);
    const [marketers, setMarketers] = useState<MarketerRank[]>([]);
    const [products, setProducts] = useState<ProductRank[]>([]);
    const [markets, setMarkets] = useState<MarketRank[]>([]);
    const [stock, setStock] = useState<any[]>([]);
    // Per-product ads spend (RON-equiv units) computed via Q12 UTM attribution.
    // Same methodology as Ads Command Center, so the two pages stay in sync.
    const [adsByProduct, setAdsByProduct] = useState<Map<string, { ads_spend_ron: number; campaigns: number }>>(new Map());
    const [ffmAlert, setFfmAlert] = useState<{ missing: number; estimated: number; actual: number; tceCostEur: number } | null>(null);
    const [forecast, setForecast] = useState({ revenue: 0, dr: 0, totalOrders: 0, estSuccess: 0 });
    const [inTransit, setInTransit] = useState({ orders: 0, revenue: 0 });
    // Per-status breakdown for in-progress orders (Q10).
    // Each entry: { status_name, cnt, cod_ron }. Frontend renders with Vietnamese labels.
    const [orderStatusBreakdown, setOrderStatusBreakdown] = useState<Array<{ status_name: string; cnt: number; cod_ron: number }>>([]);

    // Filter state — single-select mode: đổi 1 dropdown sẽ reset 2 cái còn lại
    const [marketerFilter, setMarketerFilter] = useState<string>("");
    const [productFilter, setProductFilter] = useState<string>("");
    const [marketFilter, setMarketFilter] = useState<string>("");
    const selectMarketer = (v: string) => { setMarketerFilter(v); setProductFilter(""); setMarketFilter(""); };
    const selectProduct = (v: string) => { setProductFilter(v); setMarketerFilter(""); setMarketFilter(""); };
    const selectMarket = (v: string) => { setMarketFilter(v); setMarketerFilter(""); setProductFilter(""); };
    const resetFilters = () => { setMarketerFilter(""); setProductFilter(""); setMarketFilter(""); };

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    // Q0: Monthly P&L — uses mart_performance_master (same source as Marketer P&L)
                    // FIX: Previously used legacy vw_fact_daily_pnl_v2 which had 0 fulfillment_cost
                    `SELECT
                        FORMAT_DATE('%Y-%m', report_date) as month,
                        SUM(total_orders) as orders,
                        SUM(success_orders) as success,
                        SUM(returned_orders) as returned,
                        ROUND(SUM(delivered_revenue),0) as revenue,
                        ROUND(SUM(ads_spend_ron),0) as ads_spend,
                        ROUND(SUM(cogs),0) as cogs,
                        ROUND(SUM(fulfillment_cost) + SUM(return_fulfillment_cost),0) as shipping,
                        ROUND(SUM(net_profit),0) as net_profit
                    FROM ${DATASET}.mart_performance_master
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                    GROUP BY 1 ORDER BY 1`,

                    // Q1: Marketer ranking (detailed P&L) — fulfillment_cost = actual 3PL cost
                    `SELECT
                        marketer_name,
                        SUM(total_orders) as orders,
                        SUM(success_orders) as success,
                        SUM(returned_orders) as returned,
                        ROUND(SUM(delivered_revenue),0) as revenue,
                        ROUND(SUM(ads_spend_ron),0) as ads_spend,
                        ROUND(SUM(cogs),0) as cogs,
                        ROUND(SUM(fulfillment_cost) + SUM(return_fulfillment_cost),0) as shipping,
                        ROUND(SUM(net_profit),0) as net_profit,
                        ROUND(SAFE_DIVIDE(SUM(delivered_revenue), NULLIF(SUM(ads_spend_ron),0)),2) as roas,
                        ROUND(SAFE_DIVIDE(SUM(success_orders)*100, NULLIF(SUM(total_orders),0)),1) as sr
                    FROM ${DATASET}.mart_performance_master
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                        AND marketer_name IS NOT NULL
                    GROUP BY 1 ORDER BY revenue DESC`,

                    // Q2: Product ranking — với 3-level COGS fallback override
                    // mart_product_insights.delivered_cogs chỉ dùng oi.avg_imported_price (null cho D06/D07/V02)
                    // → override bằng COALESCE(product_cogs → avg_imported_price → product_variations)
                    `WITH cogs_fallback AS (
                        SELECT
                            COALESCE(pt.custom_id, 'UNKNOWN') as product_code,
                            ROUND(SUM(
                                CASE WHEN so.status_name IN ('delivered', 'received_money')
                                THEN SAFE_CAST(oi.quantity AS INT64) * COALESCE(
                                    NULLIF(pc.cost_raw, 0),
                                    NULLIF(SAFE_CAST(oi.avg_imported_price AS FLOAT64), 0),
                                    NULLIF(SAFE_CAST(pv.imported_price AS FLOAT64), 0),
                                    0
                                ) / 100.0 ELSE 0 END
                            ), 0) as delivered_cogs_fixed
                        FROM ${DATASET}.sale_order so
                        JOIN ${DATASET}.order_items oi ON so.id = oi.order_id
                        LEFT JOIN ${DATASET}.product_cogs pc ON oi.variation_id = pc.variation_id
                        LEFT JOIN ${DATASET}.product_variations pv ON oi.variation_id = pv.id
                        LEFT JOIN ${DATASET}.product_template pt ON oi.product_id = pt.id
                        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at))
                            BETWEEN '${from}' AND '${to}'
                        GROUP BY 1
                    ),
                    mart_agg AS (
                        SELECT
                            product_code, product_name,
                            SUM(order_count) as orders,
                            SUM(units_delivered) as success,
                            SUM(units_returned) as returned,
                            ROUND(SAFE_DIVIDE(SUM(units_delivered)*100, NULLIF(SUM(order_count),0)),1) as sr,
                            ROUND(SUM(delivered_revenue),0) as revenue
                        FROM ${DATASET}.mart_product_insights
                        WHERE report_date BETWEEN '${from}' AND '${to}'
                        GROUP BY 1,2
                    )
                    SELECT
                        m.product_code, m.product_name,
                        m.orders, m.success, m.returned, m.sr, m.revenue,
                        ROUND(SAFE_DIVIDE(m.revenue - COALESCE(cf.delivered_cogs_fixed, 0), NULLIF(m.revenue, 0)) * 100, 1) as margin,
                        ROUND(m.revenue - COALESCE(cf.delivered_cogs_fixed, 0), 0) as gross_profit
                    FROM mart_agg m
                    LEFT JOIN cogs_fallback cf ON UPPER(TRIM(m.product_code)) = UPPER(TRIM(cf.product_code))
                    ORDER BY revenue DESC
                    LIMIT 10`,

                    // Q3: Market ranking (with ads/ROAS/CPA)
                    `SELECT
                        market,
                        SUM(order_count) as orders,
                        SUM(units_delivered) as success,
                        ROUND(SAFE_DIVIDE(SUM(units_delivered)*100, NULLIF(SUM(order_count),0)),1) as sr,
                        ROUND(SUM(delivered_revenue),0) as revenue,
                        ROUND(SUM(ads_spend_ron),0) as ads_spend,
                        ROUND(SAFE_DIVIDE(SUM(delivered_revenue), NULLIF(SUM(ads_spend_ron),0)),2) as roas,
                        ROUND(SAFE_DIVIDE(SUM(ads_spend_ron), NULLIF(SUM(order_count),0)),0) as cpa
                    FROM ${DATASET}.mart_product_insights
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                        AND market IS NOT NULL AND market != 'Unknown'
                        AND market NOT IN ('CĐ', 'DS')
                    GROUP BY 1 ORDER BY revenue DESC
                    LIMIT 10`,

                    // Q4: Ads spend by campaign from fb_ads_data (raw, no JOIN multiplication)
                    `SELECT
                        CASE
                          WHEN ENDS_WITH(campaign_name, ' Lệ') OR ENDS_WITH(campaign_name, '-Lệ') OR ENDS_WITH(campaign_name, '_Lệ') OR campaign_name = 'Lệ' OR campaign_name LIKE '% Lệ %' THEN 'LETC'
                          WHEN ENDS_WITH(campaign_name, ' LC') OR ENDS_WITH(campaign_name, '-LC') OR ENDS_WITH(campaign_name, '_LC') OR campaign_name LIKE '% LC %' OR campaign_name LIKE '% LC-%' OR campaign_name LIKE '% LC_%' THEN 'CHIPTL'
                          WHEN ENDS_WITH(campaign_name, ' TA') OR ENDS_WITH(campaign_name, '-TA') OR ENDS_WITH(campaign_name, '_TA') OR campaign_name LIKE '% TA %' OR campaign_name LIKE '% TA-%' OR campaign_name LIKE '% TA_%' THEN 'ANHNT'
                          WHEN ENDS_WITH(campaign_name, ' TÚ') OR ENDS_WITH(campaign_name, ' Tú') OR ENDS_WITH(campaign_name, '-TÚ') OR ENDS_WITH(campaign_name, '-Tú') OR ENDS_WITH(campaign_name, ' Kim Tu') OR ENDS_WITH(campaign_name, ' Kim Tú') THEN 'TUKT'
                          WHEN ENDS_WITH(campaign_name, ' MT') OR ENDS_WITH(campaign_name, '-MT') OR ENDS_WITH(campaign_name, '_MT') OR campaign_name LIKE '% MT %' OR campaign_name LIKE '% MT-%' OR ENDS_WITH(campaign_name, ' Minh Thư') OR ENDS_WITH(campaign_name, ' Minh Thu') THEN 'MINHTHU'
                          WHEN ENDS_WITH(campaign_name, ' Vân') OR ENDS_WITH(campaign_name, '-Vân') OR ENDS_WITH(campaign_name, '_Vân') OR campaign_name LIKE '% Vân %' OR ENDS_WITH(campaign_name, ' Tường Vân') OR ENDS_WITH(campaign_name, ' Tuong Van') OR ENDS_WITH(campaign_name, ' TV') OR ENDS_WITH(campaign_name, '-TV') THEN 'TUONGVAN'
                          WHEN ENDS_WITH(campaign_name, ' Hiệu') OR ENDS_WITH(campaign_name, '-Hiệu') OR ENDS_WITH(campaign_name, '_Hiệu') OR campaign_name LIKE '% Hiệu %' OR ENDS_WITH(campaign_name, ' Hieu') OR ENDS_WITH(campaign_name, '-Hieu') THEN 'HIEUNV'
                          ELSE 'UNMATCHED'
                        END as mkter_code,
                        campaign_name,
                    ROUND(SUM(spend), 2) as ads_spend_usd
                    FROM ${DATASET}.fb_ads_data
                    WHERE date BETWEEN '${from}' AND '${to}'
                    GROUP BY 1, 2`,

                    // Q5: Stock levels — query product_stock directly (view was unreliable)
                    `SELECT
                        COALESCE(pt.custom_id, REGEXP_EXTRACT(ps.product_name, r'^([A-Z]\\d+)')) as product_code,
                    ps.product_name,
                    SUM(SAFE_CAST(ps.quantity_on_hand AS INT64)) as stock_qty,
                    COUNT(DISTINCT ps.variation_id) as variations,
                    ROUND(SUM(SAFE_CAST(ps.quantity_on_hand AS INT64) * SAFE_CAST(ps.retail_price AS FLOAT64)), 0) as retail_value,
                    ROUND(SUM(SAFE_CAST(ps.quantity_on_hand AS INT64) * SAFE_CAST(ps.avg_cost AS FLOAT64)), 0) as cost_value
                    FROM ${DATASET}.product_stock ps
                    LEFT JOIN ${DATASET}.product_template pt ON ps.product_id = pt.id
                    GROUP BY 1, 2
                    ORDER BY stock_qty DESC
                    LIMIT 20`,

                    // Q6: Monthly REAL ads spend from fb_ads_data (raw, no JOIN multiplication)
                    `SELECT
                        FORMAT_DATE('%Y-%m', SAFE_CAST(date AS DATE)) as month,
                        ROUND(SUM(spend), 2) as ads_spend_usd
                    FROM ${DATASET}.fb_ads_data
                    WHERE date BETWEEN '${from}' AND '${to}'
                    GROUP BY 1 ORDER BY 1`,

                    // Q7: FFM cost coverage alert — v5.1 with TCE data
                    `SELECT
                        SUM(orders_with_actual_ffm) as orders_with_actual,
                        SUM(orders_with_estimated_ffm) as orders_with_estimated,
                        SUM(CASE WHEN fulfillment_cost = 0 AND (success_orders > 0 OR returned_orders > 0) THEN success_orders + returned_orders ELSE 0 END) as orders_missing_cost,
                        SUM(COALESCE(tce_forward_cost_eur, 0) + COALESCE(tce_return_cost_eur, 0)) as tce_total_cost_eur
                    FROM ${DATASET}.mart_performance_master
                    WHERE report_date BETWEEN '${from}' AND '${to}'`,

                    // Q8: Actual FFM from ffm_shipments (incl VAT, converted to RON)
                    // ⚠️ BQ rule: fx.rate from CROSS JOIN cannot be in SELECT alongside GROUP BY.
                    // Fix: aggregate per-month in 'monthly' CTE first, then CROSS JOIN outside (no GROUP BY → no conflict).
                    `WITH fx_eur AS (
                        SELECT rate FROM ${DATASET}.cost_exchange_rates
                        WHERE from_currency = 'EUR' AND to_currency = 'RON'
                        ORDER BY effective_date DESC LIMIT 1
                    ),
                    monthly AS (
                        SELECT
                            FORMAT_DATE('%Y-%m', DATE(COALESCE(
                                f.created_date,
                                PARSE_TIMESTAMP('%Y-%m-%d %H:%M:%S', JSON_VALUE(f.raw_response, '$.WAYBILL_AVAILABLE_DATE')),
                                f.synced_at
                            ))) AS month,
                            SUM(f.price_incl_vat) AS ffm_eur
                        FROM ${DATASET}.ffm_shipments f
                        WHERE DATE(COALESCE(
                                f.created_date,
                                PARSE_TIMESTAMP('%Y-%m-%d %H:%M:%S', JSON_VALUE(f.raw_response, '$.WAYBILL_AVAILABLE_DATE')),
                                f.synced_at
                            )) BETWEEN '${from}' AND '${to}'
                        GROUP BY 1
                    )
                    SELECT m.month, ROUND(m.ffm_eur * fx.rate, 0) AS ffm_actual
                    FROM monthly m
                    CROSS JOIN fx_eur fx
                    ORDER BY m.month`,

                    // Q9: Forecast revenue using true DR from sale_order (same as P&L v7)
                    `WITH dr_window AS (
                        SELECT ROUND(SAFE_DIVIDE(
                            COUNTIF(status_name IN ('delivered', 'received_money')),
                            NULLIF(COUNTIF(status_name NOT IN ('waitting', 'ordered')), 0)
                        ), 4) AS delivery_rate
                        FROM ${DATASET}.sale_order
                        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at))
                            BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 35 DAY)
                            AND DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
                    ),
                    order_agg AS (
                        SELECT
                            COUNTIF(status_name NOT IN ('waitting', 'ordered')) AS total_orders,
                            ROUND(SUM(CASE WHEN status_name NOT IN ('waitting', 'ordered')
                                THEN SAFE_CAST(cod AS FLOAT64) / 100.0 ELSE 0 END), 0) AS total_revenue
                        FROM ${DATASET}.sale_order
                        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at))
                            BETWEEN '${from}' AND '${to}'
                    )
                    SELECT
                        ROUND(oa.total_revenue * dr.delivery_rate, 0) AS forecast_revenue,
                        ROUND(dr.delivery_rate * 100, 1) AS delivery_rate_pct,
                        oa.total_orders,
                        ROUND(oa.total_orders * dr.delivery_rate) AS est_success
                    FROM order_agg oa
                    CROSS JOIN dr_window dr`,

                    // Q10: Order count + COD by status_name (in-progress + returning).
                    // Excludes final-state buckets (delivered, received_money, canceled, removed).
                    // Frontend maps each status to a Vietnamese label.
                    `SELECT
                        status_name,
                        COUNT(*) AS cnt,
                        ROUND(SUM(SAFE_CAST(cod AS FLOAT64) / 100.0), 0) AS cod_ron
                    FROM ${DATASET}.sale_order
                    WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at))
                        BETWEEN '${from}' AND '${to}'
                      AND status_name IN ('new','pending','ordered','submitted','packing','waitting','shipped','returning')
                    GROUP BY 1`,

                    // Q11: Sales velocity 7d by product code (for CEO inventory overview)
                    `SELECT
                        COALESCE(pt.custom_id, 'N/A') as product_code,
                        SUM(SAFE_CAST(oi.quantity AS INT64)) as sold_7d
                    FROM ${DATASET}.fact_order_items_dedup oi
                    LEFT JOIN ${DATASET}.product_template pt ON oi.product_id = pt.id
                    LEFT JOIN ${DATASET}.vw_fact_orders o ON oi.order_id = o.order_id
                    WHERE o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
                        AND o.status_group != 'canceled'
                    GROUP BY 1`,

                    // Q12: Per-product ads spend with proportional per-campaign allocation.
                    // For each campaign, attribute spend to a product proportionally to that
                    // product's share of the campaign's POS orders. A "D07-…" campaign with 1
                    // D06 order out of 386 contributes only 1/386 of its spend to D06.
                    // Mirrors the Ads Command Center filter logic exactly.
                    `WITH order_codes AS (
                        SELECT
                            so.id, so.p_utm_term, so.p_utm_campaign,
                            ARRAY_AGG(DISTINCT COALESCE(
                                pt.custom_id,
                                REGEXP_EXTRACT(oi.product_name, r'^([A-Z]\\d+)'),
                                REGEXP_EXTRACT(oi.variation_name, r'^([A-Z]\\d+)')
                            ) IGNORE NULLS) AS product_codes
                        FROM ${DATASET}.sale_order so
                        JOIN ${DATASET}.order_items oi ON so.id = oi.order_id
                        LEFT JOIN ${DATASET}.product_template pt ON oi.product_id = pt.id
                        WHERE DATE(CAST(so.inserted_at AS TIMESTAMP)) BETWEEN '${from}' AND '${to}'
                          AND COALESCE(SAFE_CAST(so.status AS INT64), 0) != 7
                        GROUP BY so.id, so.p_utm_term, so.p_utm_campaign
                    ),
                    order_to_campaign AS (
                        -- Each order → its campaign(s) (DISTINCT to dedupe ad_id duplicates)
                        SELECT DISTINCT oc.id AS order_id, oc.product_codes, fa.campaign_id
                        FROM order_codes oc
                        JOIN ${DATASET}.fb_ads_data fa
                          ON fa.date BETWEEN '${from}' AND '${to}'
                         AND (
                            CAST(fa.ad_id AS STRING) = oc.p_utm_term
                            OR fa.campaign_name = oc.p_utm_campaign
                         )
                    ),
                    campaign_totals AS (
                        SELECT campaign_id, COUNT(DISTINCT order_id) AS total_orders
                        FROM order_to_campaign
                        GROUP BY 1
                    ),
                    campaign_product_orders AS (
                        SELECT campaign_id, UPPER(code) AS product_code, COUNT(DISTINCT order_id) AS product_orders
                        FROM order_to_campaign, UNNEST(product_codes) AS code
                        WHERE code IS NOT NULL
                        GROUP BY 1, 2
                    ),
                    campaign_spend AS (
                        SELECT campaign_id, SUM(spend) AS spend_usd
                        FROM ${DATASET}.fb_ads_data
                        WHERE date BETWEEN '${from}' AND '${to}'
                        GROUP BY 1
                    )
                    SELECT
                        cpo.product_code,
                        COUNT(DISTINCT cpo.campaign_id) AS campaigns,
                        ROUND(SUM(cs.spend_usd * cpo.product_orders / ct.total_orders), 2) AS ads_spend_usd
                    FROM campaign_product_orders cpo
                    JOIN campaign_totals ct ON cpo.campaign_id = ct.campaign_id
                    JOIN campaign_spend cs ON cpo.campaign_id = cs.campaign_id
                    WHERE ct.total_orders > 0
                    GROUP BY 1`,
                ];

                const results = await Promise.all(
                    queries.map((q) =>
                        fetch("/api/query", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q }),
                        }).then((res) => res.json()).catch(() => ({ data: [] }))
                    )
                );

                // Overlay real ads spend (Q6) + actual FFM (Q8) onto monthly P&L (Q0)
                const monthlyRaw = results[0].data || [];
                const realAdsMonthly = results[6]?.data || [];
                const realAdsMap = new Map<string, number>();
                // Q6 now returns USD → convert to "fake RON" so formatMoney(×RON_TO_VND) = correct VND
                realAdsMonthly.forEach((r: any) => realAdsMap.set(r.month, Math.round((r.ads_spend_usd || 0) * USD_TO_VND / RON_TO_VND)));
                const ffmActualMonthly = results[8]?.data || [];
                const ffmActualMap = new Map<string, number>();
                ffmActualMonthly.forEach((r: any) => ffmActualMap.set(r.month, r.ffm_actual || 0));
                const monthlyWithRealAds = monthlyRaw.map((m: any) => {
                    const realAds = realAdsMap.get(m.month) ?? m.ads_spend;
                    const ffmActual = ffmActualMap.get(m.month);
                    const shipping = ffmActual != null && ffmActual > 0 ? ffmActual : m.shipping;
                    return {
                        ...m,
                        ads_spend: realAds,
                        shipping,
                        net_profit: m.revenue - m.cogs - shipping - realAds,
                    };
                });
                setMonthly(monthlyWithRealAds);

                // Merge marketer P&L with real ads, using CANONICAL names
                const mkterPnl = results[1].data || [];
                const adsPerCode = results[4]?.data || [];
                const adsByName = new Map<string, number>();
                adsPerCode.forEach((row: any) => {
                    // Try resolving by mkter_code first, then by campaign_name suffix
                    let name = resolveMarketerName(row.mkter_code || "");
                    if (!isRealMarketer(name) || !CANONICAL_MARKETERS.some(m => m.name === name)) {
                        // Parse campaign_name: STRAMARK convention is "... - SUFFIX"
                        const parts = (row.campaign_name || "").split(" - ");
                        const suffix = parts[parts.length - 1]?.trim() || "";
                        name = resolveMarketerName(suffix);
                        // Also try position 5 (legacy STRAMARK convention)
                        if (!isRealMarketer(name) && parts[5]) {
                            name = resolveMarketerName(parts[5].trim());
                        }
                        // Last resort: try full campaign_name
                        if (!isRealMarketer(name)) {
                            name = resolveMarketerName(row.campaign_name || "");
                        }
                    }
                    if (!isRealMarketer(name) || !CANONICAL_MARKETERS.some(m => m.name === name)) return;
                    // Convert USD → "fake RON" so formatMoney(×RON_TO_VND) = correct VND
                    adsByName.set(name, (adsByName.get(name) || 0) + Math.round((row.ads_spend_usd || 0) * USD_TO_VND / RON_TO_VND));
                });

                // Also aggregate mart P&L by canonical name
                const pnlByName = new Map<string, any>();
                mkterPnl.forEach((m: any) => {
                    const name = resolveMarketerName(m.marketer_name || "");
                    if (!isRealMarketer(name)) return;
                    const prev = pnlByName.get(name) || { orders: 0, success: 0, returned: 0, revenue: 0, ads_spend: 0, net_profit: 0, sr: 0, cogs: 0, shipping: 0 };
                    pnlByName.set(name, {
                        orders: prev.orders + (m.orders || 0),
                        success: prev.success + (m.success || 0),
                        returned: prev.returned + (m.returned || 0),
                        revenue: prev.revenue + (m.revenue || 0),
                        ads_spend: 0, // will be replaced by real ads
                        net_profit: 0,
                        sr: m.sr || 0,
                        cogs: prev.cogs + (m.cogs || 0),
                        shipping: prev.shipping + (m.shipping || 0),
                    });
                });

                // Merge into final marketer list
                const allNames = new Set([...pnlByName.keys(), ...adsByName.keys()]);
                const mergedMarketers: MarketerRank[] = [];
                allNames.forEach((name) => {
                    const pnl = pnlByName.get(name) || { orders: 0, success: 0, returned: 0, revenue: 0, cogs: 0, shipping: 0 };
                    const realAds = adsByName.get(name) || 0;
                    const revenue = pnl.revenue || 0;
                    const roas = realAds > 0 ? Math.round((revenue / realAds) * 100) / 100 : 0;
                    const sr = pnl.orders > 0 ? Math.round((pnl.success / pnl.orders) * 1000) / 10 : 0;
                    const net_profit = revenue - (pnl.cogs || 0) - (pnl.shipping || 0) - realAds;
                    mergedMarketers.push({
                        marketer_name: name,
                        orders: pnl.orders, success: pnl.success, returned: pnl.returned || 0,
                        revenue, ads_spend: realAds, cogs: pnl.cogs || 0, shipping: pnl.shipping || 0,
                        net_profit, roas, sr,
                    });
                });
                mergedMarketers.sort((a, b) => b.revenue - a.revenue);
                setMarketers(mergedMarketers);

                setProducts(results[2].data || []);

                // Q12 — per-product ads (UTM attribution, RON-equiv to align with mart_*_ron units)
                const adsByProductMap = new Map<string, { ads_spend_ron: number; campaigns: number }>();
                (results[12]?.data || []).forEach((r: any) => {
                    const code = String(r.product_code || "").toUpperCase();
                    if (!code) return;
                    const adsRon = Math.round((r.ads_spend_usd || 0) * USD_TO_VND / RON_TO_VND);
                    adsByProductMap.set(code, { ads_spend_ron: adsRon, campaigns: r.campaigns || 0 });
                });
                setAdsByProduct(adsByProductMap);
                setMarkets(results[3].data || []);
                // Enrich stock with 7d velocity (Q11) for CEO inventory view
                const velocityData = results[11]?.data || [];
                const velocityMap = new Map<string, number>();
                velocityData.forEach((v: any) => velocityMap.set(v.product_code, v.sold_7d || 0));
                const enrichedStock = (results[5]?.data || []).map((s: any) => {
                    const sold7d = velocityMap.get(s.product_code) || 0;
                    const dailyAvg = sold7d / 7;
                    const qty = s.stock_qty || 0;
                    const daysLeft = dailyAvg > 0 ? qty / dailyAvg : (qty > 0 ? 9999 : 0);
                    return { ...s, sold_7d: sold7d, daily_avg: Math.round(dailyAvg * 10) / 10, days_left: Math.round(daysLeft) };
                });
                // Sort by urgency: lowest days_left first (hết hàng / nguy cấp lên đầu)
                enrichedStock.sort((a: any, b: any) => a.days_left - b.days_left);
                setStock(enrichedStock);

                // FFM alert data (Q7)
                const ffmData = results[7]?.data?.[0];
                if (ffmData) {
                    setFfmAlert({
                        actual: ffmData.orders_with_actual || 0,
                        estimated: ffmData.orders_with_estimated || 0,
                        missing: ffmData.orders_missing_cost || 0,
                        tceCostEur: ffmData.tce_total_cost_eur || 0,
                    });
                }

                // Forecast data (Q9) — true DR from sale_order
                const forecastData = results[9]?.data?.[0];
                if (forecastData) {
                    setForecast({
                        revenue: forecastData.forecast_revenue || 0,
                        dr: forecastData.delivery_rate_pct || 0,
                        totalOrders: forecastData.total_orders || 0,
                        estSuccess: forecastData.est_success || 0,
                    });
                }

                // Q10 — orders by status_name (in-progress + returning), used for both
                // the headline "Đang giao hàng" KPI (packing+pending+shipped) and the
                // per-status breakdown card.
                const statusRows: Array<{ status_name: string; cnt: number; cod_ron: number }> = (results[10]?.data || []).map((r: any) => ({
                    status_name: String(r.status_name || ""),
                    cnt: r.cnt || 0,
                    cod_ron: r.cod_ron || 0,
                }));
                setOrderStatusBreakdown(statusRows);
                const transitStatuses = new Set(["packing", "pending", "shipped"]);
                const transitOrders = statusRows.filter(r => transitStatuses.has(r.status_name)).reduce((s, r) => s + r.cnt, 0);
                const transitRev = statusRows.filter(r => transitStatuses.has(r.status_name)).reduce((s, r) => s + r.cod_ron, 0);
                setInTransit({ orders: transitOrders, revenue: transitRev });

            } catch (error) {
                console.error("CEO Overview fetch error:", error);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [dateRange]);

    if (loading) {
        return <TabSkeleton cards={6} showChart={true} rows={5} />;
    }

    // Aggregates from monthly pnl (Q0)
    const totals = monthly.reduce(
        (acc, m) => ({
            revenue: acc.revenue + m.revenue,
            ads: acc.ads + m.ads_spend,
            cogs: acc.cogs + m.cogs,
            shipping: acc.shipping + m.shipping,
            net: acc.net + m.net_profit,
            orders: acc.orders + m.orders,
            success: acc.success + m.success,
        }),
        { revenue: 0, ads: 0, cogs: 0, shipping: 0, net: 0, orders: 0, success: 0 }
    );

    // Override ads with total from fb_ads_data (raw, parsed by campaign name)
    // because mart misses ~50% of ad spend through unmatched campaigns
    const realAdsTotal = marketers.reduce((s, m) => s + m.ads_spend, 0);
    totals.ads = realAdsTotal;
    totals.net = totals.revenue - totals.cogs - totals.shipping - totals.ads;

    // ── Global scale factor dùng chung cho filter & toàn team ──
    const scaleFactor = totals.success > 0 ? forecast.estSuccess / totals.success : 0;
    const ordersInPlayRatio = totals.orders > 0 ? forecast.totalOrders / totals.orders : 1;

    // ── Aggregates theo filter (client-side từ detail arrays) ──
    // Không dùng useMemo vì nằm sau early return (loading) — vi phạm Rules of Hooks
    const filteredBase: { source: "marketer" | "product" | "market"; revenue: number; cogs: number; shipping: number; ads: number; orders: number; success: number } | null = (() => {
        if (marketerFilter) {
            const m = marketers.find(x => x.marketer_name === marketerFilter);
            if (!m) return null;
            return {
                source: "marketer",
                revenue: m.revenue, cogs: m.cogs, shipping: m.shipping,
                ads: m.ads_spend, orders: m.orders, success: m.success,
            };
        }
        if (productFilter) {
            const p = products.find(x => x.product_code === productFilter);
            if (!p) return null;
            const revShare = totals.revenue > 0 ? p.revenue / totals.revenue : 0;
            const cogs = Math.round(p.revenue - (p.gross_profit ?? 0));
            // Ads: use UTM-attribution number from Q12 (matches Ads Command Center). Falls back to
            // revenue-share allocation only if Q12 yielded nothing for this SKU (e.g. no orders
            // in the period had UTM tracking — rare).
            const adsAttributed = adsByProduct.get(productFilter.toUpperCase())?.ads_spend_ron;
            const ads = adsAttributed != null ? adsAttributed : Math.round(totals.ads * revShare);
            return {
                source: "product",
                revenue: p.revenue, cogs,
                shipping: Math.round(totals.shipping * revShare),
                ads,
                orders: p.orders, success: p.success,
            };
        }
        if (marketFilter) {
            const mk = markets.find(x => x.market === marketFilter);
            if (!mk) return null;
            const revShare = totals.revenue > 0 ? mk.revenue / totals.revenue : 0;
            return {
                source: "market",
                revenue: mk.revenue,
                cogs: Math.round(totals.cogs * revShare),
                shipping: Math.round(totals.shipping * revShare),
                ads: mk.ads_spend,
                orders: mk.orders, success: mk.success,
            };
        }
        return null;
    })();

    const isFiltered = !!filteredBase;
    const filterLabel = marketerFilter || productFilter || marketFilter || "";
    const filterSourceLabel = filteredBase?.source === "marketer" ? "Marketer" :
        filteredBase?.source === "product" ? "Sản phẩm" :
            filteredBase?.source === "market" ? "Thị trường" : "";

    // Effective actual values (có thể là của filter hoặc của toàn team)
    const eff = {
        revenue: filteredBase?.revenue ?? totals.revenue,
        cogs: filteredBase?.cogs ?? totals.cogs,
        shipping: filteredBase?.shipping ?? totals.shipping,
        ads: filteredBase?.ads ?? totals.ads,
        orders: filteredBase?.orders ?? totals.orders,
        success: filteredBase?.success ?? totals.success,
    };
    const effNet = eff.revenue - eff.cogs - eff.shipping - eff.ads;
    const effMargin = eff.revenue > 0 ? (effNet / eff.revenue) * 100 : 0;
    const effRoas = eff.ads > 0 ? eff.revenue / eff.ads : 0;
    const effSr = eff.orders > 0 ? (eff.success / eff.orders) * 100 : 0;

    // Forecast scaled từ actual hiện tại (filtered hoặc toàn team)
    // Khi không filter, dùng forecast.revenue từ Q9 (chính xác hơn) thay vì scale.
    const effEstRevenue = isFiltered ? Math.round(eff.revenue * scaleFactor) : forecast.revenue;
    const effTotalOrders = isFiltered ? Math.round(eff.orders * ordersInPlayRatio) : forecast.totalOrders;
    // SR kỳ vọng áp dụng chung DR toàn team cho mọi marketer
    // (đơn mới behave theo hệ thống vận hành hiện tại, không theo SR lịch sử của từng marketer)
    const effEstSuccess = isFiltered ? Math.round(effTotalOrders * (forecast.dr / 100)) : forecast.estSuccess;
    const estCogs = Math.round(eff.cogs * scaleFactor);
    const estShipping = Math.round(eff.shipping * scaleFactor);
    const estNet = effEstRevenue - estCogs - estShipping - eff.ads;
    const estMargin = effEstRevenue > 0 ? (estNet / effEstRevenue) * 100 : 0;
    const estRoas = eff.ads > 0 ? effEstRevenue / eff.ads : 0;
    const estSr = effTotalOrders > 0 ? (effEstSuccess / effTotalOrders) * 100 : 0;

    // Legacy aliases để không phá các chỗ cũ
    const overallRoas = effRoas;
    const overallMargin = effMargin;
    const actualSr = effSr;

    // Options cho dropdown filter (sorted)
    const marketerOptions = [...marketers].filter(m => m.marketer_name).sort((a, b) => b.revenue - a.revenue);
    const productOptions = [...products].filter(p => p.product_code).sort((a, b) => b.revenue - a.revenue);
    const marketOptions = [...markets].filter(m => m.market).sort((a, b) => b.revenue - a.revenue);

    return (
        <div className="space-y-6">
            <ExchangeRateBanner />

            {/* ─── Bộ lọc: Thị trường / Marketer / Sản phẩm ─── */}
            <div className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">
                        <Target className="h-3.5 w-3.5" /> Bộ lọc
                    </div>

                    <label className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-cyan-500" />
                        <select
                            value={marketFilter}
                            onChange={e => selectMarket(e.target.value)}
                            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 focus:outline-none"
                        >
                            <option value="">Tất cả Thị trường</option>
                            {marketOptions.map(m => (
                                <option key={m.market} value={m.market}>{m.market}</option>
                            ))}
                        </select>
                    </label>

                    <label className="flex items-center gap-2">
                        <Users className="h-3.5 w-3.5 text-blue-500" />
                        <select
                            value={marketerFilter}
                            onChange={e => selectMarketer(e.target.value)}
                            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 focus:outline-none"
                        >
                            <option value="">Tất cả MKT</option>
                            {marketerOptions.map(m => (
                                <option key={m.marketer_name} value={m.marketer_name}>{m.marketer_name}</option>
                            ))}
                        </select>
                    </label>

                    <label className="flex items-center gap-2">
                        <Package className="h-3.5 w-3.5 text-emerald-500" />
                        <select
                            value={productFilter}
                            onChange={e => selectProduct(e.target.value)}
                            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30 focus:outline-none"
                        >
                            <option value="">Tất cả Sản phẩm</option>
                            {productOptions.map(p => (
                                <option key={p.product_code} value={p.product_code}>
                                    {p.product_code}{p.product_name ? ` — ${p.product_name.substring(0, 30)}` : ""}
                                </option>
                            ))}
                        </select>
                    </label>

                    {isFiltered && (
                        <>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                                Đang lọc: {filterSourceLabel} = {filterLabel}
                            </span>
                            <button
                                onClick={resetFilters}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rose-500 hover:bg-rose-500/10 transition"
                                title="Xoá tất cả bộ lọc"
                            >
                                <X className="h-3.5 w-3.5" /> Xoá lọc
                            </button>
                        </>
                    )}
                    {!isFiltered && (
                        <span className="text-xs text-muted-foreground">Mặc định: toàn team. Chọn 1 trong 3 dropdown để lọc — chỉ 1 bộ lọc được áp dụng tại 1 thời điểm.</span>
                    )}
                </div>
            </div>

            {/* ─── Nhóm 1: Số liệu THỰC TẾ (đơn đã có kết quả cuối cùng) ─── */}
            <section className="rounded-xl border-2 border-emerald-500/40 bg-emerald-500/[0.08] dark:bg-emerald-500/[0.06] p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-base font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                            ✅ Số liệu thực tế
                            <InfoTip content="Chỉ tính các đơn đã có kết quả cuối cùng (delivered / received_money / returned). Chưa bao gồm các đơn đang vận chuyển." />
                        </h2>
                        <p className="text-xs text-muted-foreground">Dựa trên đơn đã settle trong khoảng thời gian đang xem</p>
                    </div>
                    <span className="hidden md:inline-flex rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatNumber(eff.success)} đơn TC{isFiltered ? ` · ${filterSourceLabel}: ${filterLabel}` : " đã ghi nhận"}
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <KPICard
                        title="💰 Doanh thu thực tế"
                        value={formatCurrency(eff.revenue)}
                        icon={DollarSign}
                        status={eff.revenue > 0 ? "success" : "neutral"}
                        subValue={isFiltered ? `${filterSourceLabel}: ${filterLabel}` : `${monthly.length} tháng data`}
                        tooltip="Tổng COD đã thu từ các đơn giao thành công (status = delivered / received_money). Nguồn: mart_performance_master.delivered_revenue."
                    />
                    <KPICard
                        title="📊 Lãi/Lỗ thực tế"
                        value={formatCurrency(effNet)}
                        icon={effNet >= 0 ? TrendingUp : TrendingDown}
                        status={effNet >= 0 ? "success" : "danger"}
                        subValue={`Margin: ${effMargin.toFixed(1)}%`}
                        tooltip="Lãi ròng thực tế = Doanh thu thực tế − COGS thực tế − Ship/FFM thực tế − Ads Spend. Chưa trừ overhead/nhân sự."
                    />
                    <KPICard
                        title="📦 TC / Tổng đơn"
                        value={`${formatNumber(eff.success)} / ${formatNumber(eff.orders)}`}
                        icon={Package}
                        status="neutral"
                        subValue={`SR thực tế: ${effSr.toFixed(1)}%`}
                        tooltip="Đơn thành công / Tổng đơn đã có kết quả. SR = Success Rate trên các đơn đã settle. Đơn waitting/ordered không tính vào mẫu."
                    />
                    <KPICard
                        title="🎯 ROAS thực tế"
                        value={`${effRoas.toFixed(2)}x`}
                        icon={Target}
                        status={effRoas >= 2.5 ? "success" : effRoas >= 1.5 ? "warning" : "danger"}
                        subValue={`Ads: ${formatCurrency(eff.ads)}`}
                        tooltip="Return On Ad Spend thực tế = Doanh thu thực tế / Ads Spend. ≥ 2.5x: tốt · 1.5–2.5x: cảnh báo · < 1.5x: lỗ."
                    />
                </div>

                {/* Chi phí compact — thực tế */}
                <div className="rounded-lg border border-emerald-500/30 bg-white/70 dark:bg-card/50 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-base">
                        <span className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                            💸 Chi phí thực tế
                            <InfoTip content="Các chi phí đã phát sinh dựa trên đơn đã có kết quả cuối cùng. % bên cạnh = chi phí / Doanh thu thực tế." />
                        </span>
                        <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Ads:</span>
                            <span className="text-lg font-bold text-amber-500">{formatCurrency(eff.ads)}</span>
                            <span className="text-xs text-muted-foreground/70">({eff.revenue > 0 ? ((eff.ads / eff.revenue) * 100).toFixed(1) : "0.0"}%)</span>
                            <InfoTip content={filteredBase?.source === "product" ? "Ads attribution theo UTM: tổng spend của tất cả campaigns đã chạy ra ít nhất 1 đơn chứa SKU này. Dùng cùng methodology với Ads Command Center. Có thể lệch nhẹ (~0.3%) vì BQ giữ lịch sử archived ads mà Meta API live không trả." : "Chi phí quảng cáo Facebook từ fb_ads_data (USD → RON → VND), spend thô chưa trừ fee/VAT."} />
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">COGS:</span>
                            <span className="text-lg font-bold text-orange-500">{formatCurrency(eff.cogs)}</span>
                            <span className="text-xs text-muted-foreground/70">({eff.revenue > 0 ? ((eff.cogs / eff.revenue) * 100).toFixed(1) : "0.0"}%)</span>
                            <InfoTip content={filteredBase?.source === "market" ? "COGS được phân bổ theo tỷ lệ revenue của thị trường (approximation)." : "Giá vốn hàng bán cho các đơn đã TC. 3-level fallback: product_cogs → avg_imported_price → product_variations."} />
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Ship/FFM:</span>
                            <span className="text-lg font-bold text-cyan-500">{formatCurrency(eff.shipping)}</span>
                            <span className="text-xs text-muted-foreground/70">({eff.revenue > 0 ? ((eff.shipping / eff.revenue) * 100).toFixed(1) : "0.0"}%)</span>
                            <InfoTip content={filteredBase && filteredBase.source !== "marketer" ? "Ship/FFM được phân bổ theo tỷ lệ revenue của subset (approximation)." : "Phí 3PL thực tế (EU Shipment, đã gồm VAT, EUR → RON). Bao gồm forward + return cost."} />
                            {ffmAlert && (ffmAlert.missing > 0 || ffmAlert.estimated > 0) && (
                                <span className="group/ffm relative inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500 cursor-help">
                                    <AlertTriangle className="h-3 w-3" />
                                    <span>Chưa đầy đủ</span>
                                    <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 w-72 -translate-x-1/2 rounded-md border border-border bg-popover p-2.5 text-left text-[12px] font-normal leading-relaxed text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover/ffm:opacity-100">
                                        <div className="mb-1 font-semibold text-amber-500">Chi phí FFM chưa đầy đủ</div>
                                        <div className="space-y-0.5">
                                            <div className="text-emerald-500">✓ {ffmAlert.actual.toLocaleString()} đơn có chi phí thực tế (EU Shipment)</div>
                                            {ffmAlert.tceCostEur > 0 && (
                                                <div className="text-emerald-500">✓ TCE (PDF): {ffmAlert.tceCostEur.toLocaleString(undefined, { maximumFractionDigits: 0 })} EUR — phân bổ theo shipped_orders/ngày</div>
                                            )}
                                            {ffmAlert.estimated > 0 && ffmAlert.tceCostEur <= 0 && (
                                                <div className="text-amber-500">⚡ {ffmAlert.estimated.toLocaleString()} đơn dùng chi phí ước tính</div>
                                            )}
                                            {ffmAlert.estimated > 0 && ffmAlert.tceCostEur > 0 && (
                                                <div className="text-cyan-500">ℹ️ {ffmAlert.estimated.toLocaleString()} đơn chưa match per-order — TCE đã phân bổ</div>
                                            )}
                                            {ffmAlert.missing > 0 && (
                                                <div className="text-rose-500">✗ {ffmAlert.missing.toLocaleString()} đơn đã giao/hoàn nhưng chưa có chi phí FFM</div>
                                            )}
                                        </div>
                                    </div>
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Tổng CP:</span>
                            <span className="text-lg font-bold text-rose-500">{formatCurrency(eff.ads + eff.cogs + eff.shipping)}</span>
                            <span className="text-xs text-muted-foreground/70">({eff.revenue > 0 ? (((eff.ads + eff.cogs + eff.shipping) / eff.revenue) * 100).toFixed(1) : "0.0"}%)</span>
                            <InfoTip content="Tổng CP = Ads + COGS + Ship/FFM. Chưa gồm nhân sự, văn phòng, công cụ. % = Tổng CP / Doanh thu thực tế." />
                        </div>
                    </div>
                </div>
            </section>

            {/* ─── Nhóm 2: Số liệu DỰ ĐOÁN (khi tất cả đơn đạt kết quả cuối cùng) ─── */}
            <section className="rounded-xl border-2 border-indigo-500/40 bg-indigo-500/[0.08] dark:bg-indigo-500/[0.06] p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-base font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                            🔮 Số liệu dự đoán
                            <InfoTip content={`Chiếu tất cả đơn đang chạy về kết quả cuối cùng với Delivery Rate = ${forecast.dr}% (đo trên cửa sổ 14–35 ngày trước). COGS & Ship/FFM được mở rộng theo tỷ lệ ${scaleFactor.toFixed(2)}×; Ads không scale vì đã chi tiêu. Cùng logic với dự đoán ở P&L.`} />
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            Giả định tất cả đơn đang chạy sẽ settle với DR {forecast.dr}% · Scale ×{scaleFactor.toFixed(2)}
                        </p>
                    </div>
                    <span className="hidden md:inline-flex rounded-full bg-indigo-500/20 px-2.5 py-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                        {formatNumber(effEstSuccess)} đơn TC dự kiến{isFiltered ? ` · ${filterSourceLabel}: ${filterLabel}` : ""}
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <KPICard
                        title="📈 DT Dự đoán"
                        value={formatCurrency(effEstRevenue)}
                        icon={Activity}
                        status="neutral"
                        subValue={`DR: ${forecast.dr}%`}
                        tooltip={isFiltered
                            ? `DT Dự đoán của subset = Doanh thu thực tế × scale ×${scaleFactor.toFixed(2)} (giả định subset có DR xấp xỉ DR team ${forecast.dr}%).`
                            : "Doanh thu kỳ vọng = Tổng COD đơn đã tạo × Delivery Rate (DR). DR được tính trên cửa sổ 14–35 ngày trước (loại đơn chưa có kết quả). Cùng công thức với P&L."}
                    />
                    <KPICard
                        title="📊 Lãi/Lỗ Dự đoán"
                        value={formatCurrency(estNet)}
                        icon={estNet >= 0 ? TrendingUp : TrendingDown}
                        status={estNet >= 0 ? "success" : "danger"}
                        subValue={`Margin: ${estMargin.toFixed(1)}%`}
                        tooltip={`Lãi dự đoán = DT Dự đoán − COGS dự đoán − Ship/FFM dự đoán − Ads Spend. COGS & FFM mở rộng theo scale ×${scaleFactor.toFixed(2)} (= estSuccess/actualSuccess). Ads không scale.`}
                    />
                    <KPICard
                        title="📦 TC dự kiến / Tổng"
                        value={`${formatNumber(effEstSuccess)} / ${formatNumber(effTotalOrders)}`}
                        icon={Package}
                        status="neutral"
                        subValue={`SR kỳ vọng: ${estSr.toFixed(1)}%`}
                        tooltip="Đơn TC dự kiến = Tổng đơn đã tạo × DR. Tổng đơn gồm cả đơn đang chạy (packing/pending/shipped)."
                    />
                    <KPICard
                        title="🎯 ROAS Dự đoán"
                        value={`${estRoas.toFixed(2)}x`}
                        icon={Target}
                        status={estRoas >= 2.5 ? "success" : estRoas >= 1.5 ? "warning" : "danger"}
                        subValue={`Ads: ${formatCurrency(eff.ads)}`}
                        tooltip="ROAS dự đoán = DT Dự đoán / Ads Spend. Ước tính ROAS cuối kỳ khi tất cả đơn đã settle."
                    />
                </div>

                {/* Chi phí compact — dự đoán */}
                <div className="rounded-lg border border-indigo-500/30 bg-white/70 dark:bg-card/50 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-base">
                        <span className="flex items-center gap-1.5 font-semibold text-indigo-600 dark:text-indigo-400 shrink-0">
                            💸 Chi phí dự đoán
                            <InfoTip content={`COGS & Ship/FFM được scale theo tỷ lệ ${scaleFactor.toFixed(2)}× (= estSuccess/actualSuccess). Ads không scale vì đã chi tiêu. % bên cạnh = chi phí / DT Dự đoán.`} />
                        </span>
                        <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Ads:</span>
                            <span className="text-lg font-bold text-amber-500">{formatCurrency(eff.ads)}</span>
                            <span className="text-xs text-muted-foreground/70">({effEstRevenue > 0 ? ((eff.ads / effEstRevenue) * 100).toFixed(1) : "0.0"}%, không scale)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">COGS:</span>
                            <span className="text-lg font-bold text-orange-500">{formatCurrency(estCogs)}</span>
                            <span className="text-xs text-muted-foreground/70">({effEstRevenue > 0 ? ((estCogs / effEstRevenue) * 100).toFixed(1) : "0.0"}%)</span>
                            <InfoTip content={`COGS × ${scaleFactor.toFixed(2)} — mở rộng theo tỷ lệ đơn TC dự kiến.`} />
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Ship/FFM:</span>
                            <span className="text-lg font-bold text-cyan-500">{formatCurrency(estShipping)}</span>
                            <span className="text-xs text-muted-foreground/70">({effEstRevenue > 0 ? ((estShipping / effEstRevenue) * 100).toFixed(1) : "0.0"}%)</span>
                            <InfoTip content={`Ship/FFM × ${scaleFactor.toFixed(2)} — giả định per-order FFM giữ nguyên.`} />
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Tổng CP:</span>
                            <span className="text-lg font-bold text-rose-500">{formatCurrency(eff.ads + estCogs + estShipping)}</span>
                            <span className="text-xs text-muted-foreground/70">({effEstRevenue > 0 ? (((eff.ads + estCogs + estShipping) / effEstRevenue) * 100).toFixed(1) : "0.0"}%)</span>
                            <InfoTip content="Tổng CP dự đoán = Ads + COGS dự đoán + Ship/FFM dự đoán. % = Tổng CP / DT Dự đoán." />
                        </div>
                    </div>
                </div>
            </section>

            {/* ─── Nhóm 3: Hoạt động & Phạm vi ─── */}
            <section className="rounded-xl border-2 border-slate-400/40 bg-slate-500/[0.06] dark:bg-slate-500/[0.08] p-4 space-y-3 shadow-sm">
                <div className="flex items-center gap-2">
                    <div>
                        <h2 className="text-base font-bold text-slate-600 dark:text-slate-300 flex items-center gap-2">
                            ⚙️ Hoạt động & Phạm vi
                            <InfoTip content="Các chỉ số bổ trợ: đơn đang trong quá trình vận chuyển, số lượng marketer và thị trường đang hoạt động." />
                        </h2>
                        <p className="text-xs text-muted-foreground">Trạng thái hiện tại và phạm vi vận hành</p>
                    </div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <KPICard
                        title="🚚 Đang giao hàng"
                        value={formatNumber(inTransit.orders)}
                        icon={Truck}
                        status={inTransit.orders > 0 ? "warning" : "neutral"}
                        subValue={`COD: ${formatCurrency(inTransit.revenue)}`}
                        tooltip="Số đơn đang ở trạng thái packing / pending / shipped — chưa có kết quả cuối cùng. COD là tổng giá trị tiềm năng có thể thu từ các đơn này."
                    />
                    <KPICard
                        title="👥 Marketers"
                        value={String(marketers.length)}
                        icon={Users}
                        status="neutral"
                        subValue="Active"
                        tooltip="Số marketer có hoạt động (có đơn hoặc có ads spend) trong khoảng thời gian đang xem, sau khi map chiến dịch FB về canonical name."
                    />
                    <KPICard
                        title="🌍 Markets"
                        value={String(markets.length)}
                        icon={Globe}
                        status="neutral"
                        subValue={markets.slice(0, 3).map((m) => m.market).join(", ")}
                        tooltip="Số thị trường (quốc gia) có đơn hàng trong khoảng thời gian đang xem. Loại bỏ các mã nội bộ 'CĐ' / 'DS' / Unknown."
                    />
                </div>

                {/* Breakdown đơn theo trạng thái — chi tiết hơn so với "Đang giao hàng" tổng */}
                {orderStatusBreakdown.length > 0 && (() => {
                    // Mapping BQ status_name → label POS UI (verified against POS UI counts):
                    //   waitting (status=11) = POS "Chờ hàng"  (chờ stock từ kho)
                    //   pending  (status=9)  = POS "Chờ chuyển hàng"  (chờ chuyển/đang giao)
                    // Trước đây bị swap → đã đảo lại ở đây.
                    const STATUS_LABELS: Array<[string, string, string]> = [
                        ["new", "🆕 Mới", "text-blue-500"],
                        ["waitting", "⏳ Chờ hàng", "text-amber-500"],
                        ["ordered", "📋 Đã đặt hàng", "text-purple-500"],
                        ["submitted", "✅ Đã xác nhận", "text-emerald-500"],
                        ["packing", "📦 Đang đóng hàng", "text-cyan-500"],
                        ["pending", "🚛 Chờ chuyển hàng", "text-indigo-500"],
                        ["shipped", "🚚 Đã gửi hàng", "text-violet-500"],
                        ["returning", "↩️ Đang hoàn", "text-rose-500"],
                    ];
                    const map = new Map(orderStatusBreakdown.map(r => [r.status_name, r]));
                    const totalCnt = orderStatusBreakdown.reduce((s, r) => s + r.cnt, 0);
                    const totalCod = orderStatusBreakdown.reduce((s, r) => s + r.cod_ron, 0);
                    return (
                        <div className="rounded-lg border border-slate-400/30 bg-white/70 dark:bg-card/50 px-4 py-3">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 mb-2">
                                <span className="font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                                    📊 Đơn theo trạng thái
                                </span>
                                <InfoTip content="Tổng đơn đang ở các trạng thái chưa final (chưa giao thành công / chưa hủy). COD là giá trị tiềm năng có thể thu được từ các đơn đó. Số có thể lệch nhẹ với POS UI do POS chia thêm theo sub_status mà BQ không có (vd: 1 phần 'Chờ chuyển hàng' trong POS có thể đã chuyển sang 'Đã gửi hàng')." />
                                <span className="text-xs text-muted-foreground/80">
                                    Tổng: <b className="text-slate-700 dark:text-slate-200">{formatNumber(totalCnt)}</b> đơn · COD <b className="text-slate-700 dark:text-slate-200">{formatCurrency(totalCod)}</b>
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                                {STATUS_LABELS.map(([key, label, color]) => {
                                    const row = map.get(key);
                                    const cnt = row?.cnt || 0;
                                    const cod = row?.cod_ron || 0;
                                    return (
                                        <div key={key} className="rounded-md border border-border/60 bg-background/60 px-2 py-1.5">
                                            <div className="text-[10px] text-muted-foreground truncate" title={label}>{label}</div>
                                            <div className={cn("text-base font-bold font-mono leading-tight", cnt > 0 ? color : "text-muted-foreground/40")}>
                                                {formatNumber(cnt)}
                                            </div>
                                            <div className="text-[9px] text-muted-foreground/70">{cod > 0 ? formatCurrency(cod) : "—"}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}
            </section>


            {/* ── Marketer P&L Detail (full width) ── */}
            < div className="rounded-lg border border-border bg-card p-4" >
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    🏆 Marketer P&L Detail
                </h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">Marketer</th>
                                <th className="px-2 pb-2 text-right font-medium">Đơn</th>
                                <th className="px-2 pb-2 text-right font-medium">TC</th>
                                <th className="px-2 pb-2 text-right font-medium">Hoàn</th>
                                <th className="px-2 pb-2 text-right font-medium">SR%</th>
                                <th className="px-2 pb-2 text-right font-medium">Revenue</th>
                                <th className="px-2 pb-2 text-right font-medium">Ads Spend</th>
                                <th className="px-2 pb-2 text-right font-medium">COGS</th>
                                <th className="px-2 pb-2 text-right font-medium">Ship/FFM (3PL)</th>
                                <th className="px-2 pb-2 text-right font-medium">Net P&L</th>
                                <th className="px-2 pb-2 text-right font-medium">ROAS</th>
                                <th className="px-2 pb-2 text-right font-medium">CPA</th>
                            </tr>
                        </thead>
                        <tbody>
                            {marketers.map((m) => {
                                const cpa = m.orders > 0 ? Math.round(m.ads_spend / m.orders) : 0;
                                return (
                                    <tr key={m.marketer_name} className="border-b border-border/60 hover:bg-gray-50/50">
                                        <td className="px-2 py-2 font-medium text-foreground">{m.marketer_name}</td>
                                        <td className="px-2 py-2 text-right">{formatNumber(m.orders)}</td>
                                        <td className="px-2 py-2 text-right">{formatNumber(m.success)}</td>
                                        <td className={cn("px-2 py-2 text-right", m.returned > 0 ? "text-rose-400" : "")}>{formatNumber(m.returned)}</td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", m.sr >= 45 ? "text-emerald-400" : m.sr >= 30 ? "text-amber-400" : "text-rose-400")}>
                                            {m.sr}%
                                        </td>
                                        <td className="px-2 py-2 text-right font-semibold text-emerald-400">{formatMoney(m.revenue)}</td>
                                        <td className="px-2 py-2 text-right text-amber-400">{formatMoney(m.ads_spend)}</td>
                                        <td className="px-2 py-2 text-right text-orange-400">{formatMoney(m.cogs)}</td>
                                        <td className="px-2 py-2 text-right text-cyan-400">{formatMoney(m.shipping)}</td>
                                        <td className={cn("px-2 py-2 text-right font-bold", m.net_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {m.net_profit >= 0 ? "+" : ""}{formatMoney(m.net_profit)}
                                        </td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", m.roas >= 3 ? "text-emerald-400" : m.roas >= 1.5 ? "text-amber-400" : "text-rose-400")}>
                                            {m.roas ? `${m.roas}x` : "—"}
                                        </td>
                                        <td className="px-2 py-2 text-right">{formatMoney(cpa)}</td>
                                    </tr>
                                );
                            })}
                            {/* TỔNG row */}
                            {(() => {
                                const t = marketers.reduce((a, m) => ({
                                    orders: a.orders + m.orders, success: a.success + m.success, returned: a.returned + m.returned,
                                    revenue: a.revenue + m.revenue, ads: a.ads + m.ads_spend, cogs: a.cogs + m.cogs,
                                    shipping: a.shipping + m.shipping, net: a.net + m.net_profit,
                                }), { orders: 0, success: 0, returned: 0, revenue: 0, ads: 0, cogs: 0, shipping: 0, net: 0 });
                                const sr = t.orders > 0 ? Math.round(t.success / t.orders * 1000) / 10 : 0;
                                const roas = t.ads > 0 ? Math.round(t.revenue / t.ads * 100) / 100 : 0;
                                const cpa = t.orders > 0 ? Math.round(t.ads / t.orders) : 0;
                                return (
                                    <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                        <td className="px-2 py-2 text-foreground">TỔNG</td>
                                        <td className="px-2 py-2 text-right text-foreground">{formatNumber(t.orders)}</td>
                                        <td className="px-2 py-2 text-right text-foreground">{formatNumber(t.success)}</td>
                                        <td className="px-2 py-2 text-right text-rose-400">{formatNumber(t.returned)}</td>
                                        <td className="px-2 py-2 text-right text-foreground">{sr}%</td>
                                        <td className="px-2 py-2 text-right text-emerald-400">{formatMoney(t.revenue)}</td>
                                        <td className="px-2 py-2 text-right text-amber-400">{formatMoney(t.ads)}</td>
                                        <td className="px-2 py-2 text-right text-orange-400">{formatMoney(t.cogs)}</td>
                                        <td className="px-2 py-2 text-right text-cyan-400">{formatMoney(t.shipping)}</td>
                                        <td className={cn("px-2 py-2 text-right", t.net >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {t.net >= 0 ? "+" : ""}{formatMoney(t.net)}
                                        </td>
                                        <td className="px-2 py-2 text-right text-foreground">{roas}x</td>
                                        <td className="px-2 py-2 text-right text-foreground">{formatMoney(cpa)}</td>
                                    </tr>
                                );
                            })()}
                        </tbody>
                    </table>
                </div>
            </div >

            {/* ── Product + Market (2 columns) ── */}
            < div className="grid gap-4 lg:grid-cols-2" >
                {/* Product Performance */}
                < div className="rounded-lg border border-border bg-card p-4" >
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-blue-400" />
                        📦 Product Performance
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="px-2 pb-2 text-left font-medium">Mã SP</th>
                                    <th className="px-2 pb-2 text-right font-medium">Đơn</th>
                                    <th className="px-2 pb-2 text-right font-medium">TC</th>
                                    <th className="px-2 pb-2 text-right font-medium">Hoàn</th>
                                    <th className="px-2 pb-2 text-right font-medium">SR%</th>
                                    <th className="px-2 pb-2 text-right font-medium">Revenue</th>
                                    <th className="px-2 pb-2 text-right font-medium">Margin</th>
                                    <th className="px-2 pb-2 text-right font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {products.slice(0, 8).map((p) => {
                                    const grade = gradeProduct(p.margin || 0, p.sr);
                                    return (
                                        <tr key={p.product_code} className="border-b border-border/60 hover:bg-gray-50/50">
                                            <td className="px-2 py-2 font-medium text-foreground" title={p.product_name}>{p.product_code || p.product_name?.substring(0, 10)}</td>
                                            <td className="px-2 py-2 text-right">{formatNumber(p.orders)}</td>
                                            <td className="px-2 py-2 text-right">{formatNumber(p.success)}</td>
                                            <td className={cn("px-2 py-2 text-right", p.returned > 0 ? "text-rose-400" : "")}>{formatNumber(p.returned)}</td>
                                            <td className={cn("px-2 py-2 text-right font-semibold", (p.sr || 0) >= 45 ? "text-emerald-400" : (p.sr || 0) >= 30 ? "text-amber-400" : "text-rose-400")}>
                                                {p.sr != null ? `${p.sr}%` : "—"}
                                            </td>
                                            <td className="px-2 py-2 text-right font-semibold text-emerald-400">{formatMoney(p.revenue)}</td>
                                            <td className={cn("px-2 py-2 text-right font-semibold", (p.margin || 0) >= 50 ? "text-emerald-400" : (p.margin || 0) >= 30 ? "text-amber-400" : "text-rose-400")}>
                                                {p.margin != null ? `${p.margin}%` : "—"}
                                            </td>
                                            <td className="px-2 py-2 text-right">
                                                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", grade.color)}>
                                                    {grade.label}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div >

                {/* Market Performance */}
                < div className="rounded-lg border border-border bg-card p-4" >
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-cyan-400" />
                        🌍 Market Performance
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="px-2 pb-2 text-left font-medium">Market</th>
                                    <th className="px-2 pb-2 text-right font-medium">Đơn</th>
                                    <th className="px-2 pb-2 text-right font-medium">TC</th>
                                    <th className="px-2 pb-2 text-right font-medium">SR%</th>
                                    <th className="px-2 pb-2 text-right font-medium">Revenue</th>
                                    <th className="px-2 pb-2 text-right font-medium">Ads</th>
                                    <th className="px-2 pb-2 text-right font-medium">ROAS</th>
                                    <th className="px-2 pb-2 text-right font-medium">CPA</th>
                                </tr>
                            </thead>
                            <tbody>
                                {markets.slice(0, 6).map((m) => (
                                    <tr key={m.market} className="border-b border-border/60 hover:bg-gray-50/50">
                                        <td className="px-2 py-2 font-medium text-foreground">{m.market}</td>
                                        <td className="px-2 py-2 text-right">{formatNumber(m.orders)}</td>
                                        <td className="px-2 py-2 text-right">{formatNumber(m.success)}</td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", (m.sr || 0) >= 45 ? "text-emerald-400" : (m.sr || 0) >= 30 ? "text-amber-400" : "text-rose-400")}>
                                            {m.sr != null ? `${m.sr}%` : "—"}
                                        </td>
                                        <td className="px-2 py-2 text-right font-semibold text-emerald-400">{formatMoney(m.revenue)}</td>
                                        <td className="px-2 py-2 text-right text-amber-400">{formatMoney(m.ads_spend)}</td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", (m.roas || 0) >= 3 ? "text-emerald-400" : (m.roas || 0) >= 1.5 ? "text-amber-400" : "text-rose-400")}>
                                            {m.roas ? `${m.roas}x` : "—"}
                                        </td>
                                        <td className="px-2 py-2 text-right">{formatMoney(m.cpa)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div >
            </div >

            {/* Monthly P&L Chart */}
            < div className="rounded-lg border border-border bg-card p-4" >
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="h-2 w-2 rounded-full bg-indigo-400" />
                    📅 Monthly P&L Trend
                </h3>
                <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={monthly}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <Tooltip
                            contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                            labelStyle={{ color: "#e2e8f0" }}
                        />
                        <Legend />
                        <Bar dataKey="revenue" name="Revenue" fill="#34d399" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="ads_spend" name="Ads Spend" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="cogs" name="COGS" fill="#f97316" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="shipping" name="Ship/FFM (3PL)" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                        <Line type="monotone" dataKey="net_profit" name="Net Profit" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4 }} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div >

            {/* Monthly P&L Table */}
            < div className="rounded-lg border border-border bg-card p-4" >
                <h3 className="mb-3 text-sm font-semibold text-foreground">📋 Monthly P&L Detail</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-3 pb-2 text-left font-medium">Tháng</th>
                                <th className="px-3 pb-2 text-right font-medium">Đơn</th>
                                <th className="px-3 pb-2 text-right font-medium">Thành công</th>
                                <th className="px-3 pb-2 text-right font-medium">SR%</th>
                                <th className="px-3 pb-2 text-right font-medium">Revenue</th>
                                <th className="px-3 pb-2 text-right font-medium">Ads Spend</th>
                                <th className="px-3 pb-2 text-right font-medium">COGS</th>
                                <th className="px-3 pb-2 text-right font-medium">Ship/FFM (3PL)</th>
                                <th className="px-3 pb-2 text-right font-medium">Tổng CP</th>
                                <th className="px-3 pb-2 text-right font-medium">Net Profit</th>
                                <th className="px-3 pb-2 text-right font-medium">Margin%</th>
                            </tr>
                        </thead>
                        <tbody>
                            {monthly.map((m) => {
                                const totalCost = m.ads_spend + m.cogs + m.shipping;
                                const margin = m.revenue > 0 ? ((m.net_profit / m.revenue) * 100) : 0;
                                const sr = m.orders > 0 ? ((m.success / m.orders) * 100) : 0;
                                return (
                                    <tr key={m.month} className="border-b border-border/60 hover:bg-gray-50/50">
                                        <td className="px-3 py-2 font-medium text-foreground">{m.month}</td>
                                        <td className="px-3 py-2 text-right">{formatNumber(m.orders)}</td>
                                        <td className="px-3 py-2 text-right">{formatNumber(m.success)}</td>
                                        <td className={cn("px-3 py-2 text-right font-semibold", sr >= 45 ? "text-emerald-400" : "text-amber-400")}>
                                            {sr.toFixed(1)}%
                                        </td>
                                        <td className="px-3 py-2 text-right font-semibold text-emerald-400">{formatMoney(m.revenue)}</td>
                                        <td className="px-3 py-2 text-right text-amber-400">{formatMoney(m.ads_spend)}</td>
                                        <td className="px-3 py-2 text-right text-orange-400">{formatMoney(m.cogs)}</td>
                                        <td className="px-3 py-2 text-right text-cyan-400">{formatMoney(m.shipping)}</td>
                                        <td className="px-3 py-2 text-right text-rose-400">{formatMoney(totalCost)}</td>
                                        <td className={cn("px-3 py-2 text-right font-bold", m.net_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {m.net_profit >= 0 ? "+" : ""}{formatMoney(m.net_profit)}
                                        </td>
                                        <td className={cn("px-3 py-2 text-right font-semibold", margin >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {margin.toFixed(1)}%
                                        </td>
                                    </tr>
                                );
                            })}
                            {/* Totals row */}
                            <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                <td className="px-3 py-2 text-foreground">TỔNG</td>
                                <td className="px-3 py-2 text-right text-foreground">{formatNumber(totals.orders)}</td>
                                <td className="px-3 py-2 text-right text-foreground">{formatNumber(totals.success)}</td>
                                <td className="px-3 py-2 text-right text-foreground">
                                    {totals.orders > 0 ? ((totals.success / totals.orders) * 100).toFixed(1) : "0"}%
                                </td>
                                <td className="px-3 py-2 text-right text-emerald-400">{formatMoney(totals.revenue)}</td>
                                <td className="px-3 py-2 text-right text-amber-400">{formatMoney(totals.ads)}</td>
                                <td className="px-3 py-2 text-right text-orange-400">{formatMoney(totals.cogs)}</td>
                                <td className="px-3 py-2 text-right text-cyan-400">{formatMoney(totals.shipping)}</td>
                                <td className="px-3 py-2 text-right text-rose-400">{formatMoney(totals.ads + totals.cogs + totals.shipping)}</td>
                                <td className={cn("px-3 py-2 text-right", totals.net >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {totals.net >= 0 ? "+" : ""}{formatMoney(totals.net)}
                                </td>
                                <td className={cn("px-3 py-2 text-right", overallMargin >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {overallMargin.toFixed(1)}%
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div >

            {/* ── Stock / Inventory (enriched from Sản phẩm & Kho) ── */}
            {(() => {
                const totalStockUnits = stock.reduce((s: number, v: any) => s + (v.stock_qty || 0), 0);
                const totalStockValue = stock.reduce((s: number, v: any) => s + (v.cost_value || 0), 0);
                const outOfStockCount = stock.filter((v: any) => (v.stock_qty || 0) <= 0 && (v.daily_avg || 0) > 0).length;
                const urgentCount = stock.filter((v: any) => {
                    const dl = v.days_left ?? 9999;
                    return dl <= 7 && (v.daily_avg || 0) > 0;
                }).length;

                return (
                    <div className="space-y-4">
                        <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
                            <Warehouse className="h-5 w-5 text-cyan-400" /> Tồn Kho (POS)
                        </h3>

                        {stock.length === 0 ? (
                            <p className="text-sm text-gray-400 italic">Chưa có dữ liệu tồn kho — đang chờ sync từ POS webhook.</p>
                        ) : (
                            <>
                                {/* KPI Cards */}
                                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                    <KPICard title="Tổng tồn kho" value={formatNumber(totalStockUnits)} icon={Package} status="success" />
                                    <KPICard title="Giá trị tồn (RON)" value={formatCurrency(totalStockValue)} icon={TrendingUp} subValue="Giá vốn × Số lượng" />
                                    <KPICard title="Hết hàng" value={String(outOfStockCount)} icon={AlertTriangle}
                                        status={outOfStockCount > 0 ? "danger" : "success"} subValue="SP đang bán nhưng hết kho" />
                                    <KPICard title="Cần nhập gấp" value={String(urgentCount)} icon={AlertTriangle}
                                        status={urgentCount > 0 ? "warning" : "success"} subValue="≤ 7 ngày tồn kho" />
                                </div>

                                {/* Enhanced Table */}
                                <div className="rounded-xl border border-border bg-card p-5">
                                    <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                                        <table className="w-full text-xs">
                                            <thead className="sticky top-0 bg-card z-10">
                                                <tr className="border-b border-border text-muted-foreground">
                                                    <th className="px-2 pb-2 text-left font-medium">Mã SP</th>
                                                    <th className="px-2 pb-2 text-left font-medium">Sản phẩm</th>
                                                    <th className="px-2 pb-2 text-right font-medium">Tồn kho</th>
                                                    <th className="px-2 pb-2 text-right font-medium">Bán 7d</th>
                                                    <th className="px-2 pb-2 text-right font-medium">Bán/ngày</th>
                                                    <th className="px-2 pb-2 text-right font-medium">Ngày tồn</th>
                                                    <th className="px-2 pb-2 text-right font-medium">GT Tồn (RON)</th>
                                                    <th className="px-2 pb-2 text-center font-medium">Trạng thái</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {stock.map((s: any, i: number) => {
                                                    const qty = s.stock_qty || 0;
                                                    const daysLeft = s.days_left ?? 9999;
                                                    const dailyAvg = s.daily_avg || 0;
                                                    const status = qty <= 0 && dailyAvg > 0
                                                        ? { label: "Hết hàng", color: "bg-rose-500/20 text-rose-400" }
                                                        : daysLeft <= 3 && dailyAvg > 0
                                                            ? { label: "Nguy cấp", color: "bg-rose-500/20 text-rose-400" }
                                                            : daysLeft <= 7 && dailyAvg > 0
                                                                ? { label: "Cần nhập", color: "bg-orange-500/20 text-orange-400" }
                                                                : daysLeft <= 14 && dailyAvg > 0
                                                                    ? { label: "Theo dõi", color: "bg-amber-500/20 text-amber-400" }
                                                                    : dailyAvg <= 0
                                                                        ? { label: "Không bán", color: "bg-gray-500/20 text-gray-400" }
                                                                        : { label: "Ổn định", color: "bg-emerald-500/20 text-emerald-400" };
                                                    return (
                                                        <tr key={i} className="border-b border-border/30 hover:bg-gray-50/50 transition-colors">
                                                            <td className="px-2 py-2 font-semibold text-foreground">{s.product_code}</td>
                                                            <td className="px-2 py-2 text-muted-foreground max-w-[150px] truncate" title={s.product_name}>
                                                                {s.product_name?.substring(0, 30)}
                                                            </td>
                                                            <td className={cn("px-2 py-2 text-right font-bold", qty <= 0 ? "text-rose-400" : "text-foreground")}>
                                                                {formatNumber(qty)}
                                                            </td>
                                                            <td className="px-2 py-2 text-right text-indigo-400">{formatNumber(s.sold_7d || 0)}</td>
                                                            <td className="px-2 py-2 text-right text-muted-foreground">{dailyAvg > 0 ? dailyAvg.toFixed(1) : "—"}</td>
                                                            <td className={cn("px-2 py-2 text-right font-semibold",
                                                                daysLeft <= 7 && dailyAvg > 0 ? "text-rose-400" : daysLeft <= 14 && dailyAvg > 0 ? "text-amber-400" : "text-foreground"
                                                            )}>
                                                                {dailyAvg > 0 ? (daysLeft >= 9999 ? "∞" : `${daysLeft}d`) : "—"}
                                                            </td>
                                                            <td className="px-2 py-2 text-right text-amber-400">{s.cost_value > 0 ? formatMoney(s.cost_value) : "—"}</td>
                                                            <td className="px-2 py-2 text-center">
                                                                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", status.color)}>
                                                                    {status.label}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                                {/* Totals row */}
                                                <tr className="border-t-2 border-cyan-500/30 bg-cyan-500/5 font-bold">
                                                    <td className="px-2 py-2.5 text-foreground" colSpan={2}>TỔNG {stock.length} sản phẩm</td>
                                                    <td className="px-2 py-2.5 text-right text-foreground">{formatNumber(totalStockUnits)}</td>
                                                    <td className="px-2 py-2.5 text-right text-indigo-400">{formatNumber(stock.reduce((s: number, v: any) => s + (v.sold_7d || 0), 0))}</td>
                                                    <td className="px-2 py-2.5" colSpan={2}></td>
                                                    <td className="px-2 py-2.5 text-right text-amber-400">{formatMoney(totalStockValue)}</td>
                                                    <td className="px-2 py-2.5"></td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                );
            })()}

        </div >
    );
}
