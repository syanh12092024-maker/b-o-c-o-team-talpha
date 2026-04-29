"use client";

import React, { useEffect, useState, useRef } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, Cell, PieChart, Pie,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency as _fmtC, formatNumber, formatMoney as _fmtM, COLORS, cn } from "@/lib/utils";
import { DATASET, CURRENCY_TO_VND, REVENUE_COL, FX_TO_VND, POS_TIMEZONE, pageMktCTE } from "../constants";
import { queryCeoMonthlyPnl, queryCeoProductRanking, queryCeoMarketRanking, queryCeoAdsByMarketer, queryCeoStock } from "@/lib/bq-queries";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { resolveMarketerName, isRealMarketer } from "@/lib/marketer-map";

// ── Filter constants (same as Tổng quan) ──
const MARKETS_ALL = ["KSA", "UAE", "KWT", "AUS"];
const MKTERS_ALL = ["NHAMHT", "LYVLN", "HUYTN", "DUNGNH", "TAIHH", "TUNPT", "LINHLTT", "VUONGNM"];
const TIME_PRESETS = [
    { label: "Hôm nay", from: () => format(new Date(), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Hôm qua", from: () => { const d = new Date(); d.setDate(d.getDate() - 1); return format(d, "yyyy-MM-dd"); }, to: () => { const d = new Date(); d.setDate(d.getDate() - 1); return format(d, "yyyy-MM-dd"); } },
    { label: "7 ngày", from: () => { const d = new Date(); d.setDate(d.getDate() - 6); return format(d, "yyyy-MM-dd"); }, to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Tháng này", from: () => format(new Date(), "yyyy-MM-01"), to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Tháng trước", from: () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return format(d, "yyyy-MM-01"); }, to: () => { const d = new Date(); d.setDate(0); return format(d, "yyyy-MM-dd"); } },
    { label: "Tùy chỉnh", from: () => "", to: () => "" },
];

const FX_CASE = `CASE order_currency WHEN 'SAR' THEN ${FX_TO_VND.SAR} WHEN 'AED' THEN ${FX_TO_VND.AED} WHEN 'KWD' THEN ${FX_TO_VND.KWD} WHEN 'AUD' THEN ${FX_TO_VND.AUD} WHEN 'VND' THEN 1 ELSE ${FX_TO_VND.AED} END`;
const PRICE_VND = `ROUND(cod / 100.0 * (${FX_CASE}), 0)`;
const TZ = POS_TIMEZONE;

async function runQ(q: string) {
    return fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }).then(r => r.json()).then(r => r.data || []).catch(() => []);
}
import {
    Crown, TrendingUp, TrendingDown, DollarSign,
    Users, Globe, Package, Target, Warehouse,
} from "lucide-react";

/** Project-bound formatters */
const formatCurrency = (v: number) => _fmtC(v, 1); // totals already in VND from sale_order
const formatMoney = (v: number) => _fmtM(v, 1);    // totals already in VND
const formatCurrencyOld = (v: number) => _fmtC(v, CURRENCY_TO_VND); // for mart-based data still in AED

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



function gradeMarketer(roas: number, netProfit: number): { label: string; color: string } {
    if (roas >= 5) return { label: "A+", color: "bg-emerald-500/20 text-emerald-500" };
    if (roas >= 3.5) return { label: "A", color: "bg-emerald-500/15 text-emerald-500" };
    if (roas >= 2.5) return { label: "B+", color: "bg-amber-500/15 text-amber-500" };
    if (netProfit < 0) return { label: "C", color: "bg-rose-500/15 text-rose-500" };
    return { label: "B", color: "bg-blue-500/15 text-blue-400" };
}

function gradeProduct(margin: number, returnRate?: number): { label: string; color: string } {
    if (margin >= 60) return { label: "⭐ Star", color: "bg-emerald-500/20 text-emerald-500" };
    if (margin >= 40) return { label: "Tốt", color: "bg-emerald-500/15 text-emerald-500" };
    if (margin >= 20) return { label: "Trung bình", color: "bg-amber-500/15 text-amber-500" };
    return { label: "Lỗ", color: "bg-rose-500/15 text-rose-500" };
}

export default function CeoOverviewTab({ dateRange }: CeoOverviewTabProps) {
    const [loading, setLoading] = useState(true);
    const [monthly, setMonthly] = useState<MonthlyPnl[]>([]);
    const [marketers, setMarketers] = useState<MarketerRank[]>([]);
    const [products, setProducts] = useState<ProductRank[]>([]);
    const [markets, setMarkets] = useState<MarketRank[]>([]);
    const [stock, setStock] = useState<any[]>([]);
    const [directKpi, setDirectKpi] = useState<any>({});
    const [monthlyMarket, setMonthlyMarket] = useState<any[]>([]);

    // Filters
    const [timePreset, setTimePreset] = useState("Tháng này");
    const [customFrom, setCustomFrom] = useState(format(new Date(), "yyyy-MM-01"));
    const [customTo, setCustomTo] = useState(format(new Date(), "yyyy-MM-dd"));
    const [selMarkets, setSelMarkets] = useState<string[]>([]);
    const [selMkts, setSelMkts] = useState<string[]>([]);
    const [selProducts, setSelProducts] = useState<string[]>([]);
    const [appliedMarkets, setAppliedMarkets] = useState<string[]>([]);
    const [appliedMkts, setAppliedMkts] = useState<string[]>([]);
    const [appliedProducts, setAppliedProducts] = useState<string[]>([]);
    const [productList, setProductList] = useState<string[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);

    const applyFilters = () => { setAppliedMarkets([...selMarkets]); setAppliedMkts([...selMkts]); setAppliedProducts([...selProducts]); setRefreshKey(k => k + 1); };

    const resolvedRange = (() => {
        if (timePreset === "Tùy chỉnh") return { from: customFrom, to: customTo };
        const preset = TIME_PRESETS.find(p => p.label === timePreset);
        if (preset) return { from: preset.from(), to: preset.to() };
        return { from: format(new Date(), "yyyy-MM-01"), to: format(new Date(), "yyyy-MM-dd") };
    })();

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = resolvedRange.from;
                const to = resolvedRange.to;
                const ds = DATASET;
                // Extended from: include previous month for Monthly×Market comparison
                const extFrom = (() => { const d = new Date(from); d.setDate(1); d.setMonth(d.getMonth() - 1); return format(d, "yyyy-MM-dd"); })();

                // Build filters
                const currencyMap: Record<string,string> = { KSA: "SAR", UAE: "AED", KWT: "KWD", AUS: "AUD" };
                const marketFilter = appliedMarkets.length > 0
                    ? `AND s.order_currency IN (${appliedMarkets.map(m => `'${currencyMap[m] || m}'`).join(",")})`
                    : "";
                // MKT filter via page_mkt_map (page_id fallback)
                const mktFilter_page = appliedMkts.length > 0
                    ? `AND pm.mkter IN (${appliedMkts.map(m => `'${m}'`).join(",")})`
                    : "";
                const adsMarketFilter = appliedMarkets.length > 0
                    ? `AND UPPER(TRIM(SPLIT(campaign_name, '_')[SAFE_OFFSET(2)])) IN (${appliedMarkets.map(m => m === "KSA" ? "'SA','KSA','KSA01'" : m === "UAE" ? "'AE','UAE01'" : m === "KWT" ? "'KW'" : "'AU'").join(",")})`
                    : "";
                const adsMktFilter = appliedMkts.length > 0
                    ? `AND UPPER(TRIM(SPLIT(campaign_name, '_')[SAFE_OFFSET(3)])) IN (${appliedMkts.map(m => `'${m}'`).join(",")})`
                    : "";
                // Product filter: filter orders by product name via order_items
                const productFilter = appliedProducts.length > 0
                    ? `AND s.id IN (SELECT order_id FROM \`levelup-465304.${ds}.order_items\` WHERE product_name IN (${appliedProducts.map(p => `'${p.replace(/'/g, "\\'")}'`).join(",")}))`
                    : "";

                // Fetch product list for filter dropdown (once)
                if (productList.length === 0) {
                    runQ(`SELECT DISTINCT product_name FROM \`levelup-465304.${ds}.order_items\` WHERE product_name IS NOT NULL AND product_name != '' ORDER BY product_name`).then((rows: any[]) => {
                        setProductList(rows.map((r: any) => r.product_name));
                    });
                }

                // Direct KPIs from sale_order + page_mkt_map (multi-currency, VN timezone, correct status)
                const directKpiData = await runQ(`WITH ${pageMktCTE(ds)}
                SELECT
                    ROUND(SUM(CASE WHEN s.status_category NOT IN ('HUY','DON_THO') THEN ROUND(s.cod / 100.0 * (${FX_CASE}), 0) ELSE 0 END), 0) as dt_xuat_kho,
                    ROUND(SUM(CASE WHEN s.status_category = 'GIAO_THANH_CONG' THEN ROUND(s.cod / 100.0 * (${FX_CASE}), 0) ELSE 0 END), 0) as dt_thanh_cong,
                    COUNT(CASE WHEN s.status_category NOT IN ('HUY','DON_THO') THEN 1 END) as don_xk,
                    SUM(CASE WHEN s.status_category = 'GIAO_THANH_CONG' THEN 1 ELSE 0 END) as don_tc,
                    COUNT(*) as tong_don
                FROM \`levelup-465304.${ds}.sale_order\` s
                LEFT JOIN page_mkt_map pm ON s.page_id = pm.page_id
                WHERE DATE(TIMESTAMP(s.inserted_at), '${TZ}') BETWEEN '${from}' AND '${to}' ${marketFilter} ${mktFilter_page} ${productFilter}`);

                // Ads spend (USD) with filters
                const adsData = await runQ(`SELECT ROUND(SUM(spend_usd), 2) as ads_usd
                FROM \`levelup-465304.${ds}.vw_fact_ads_performance\`
                WHERE report_date BETWEEN '${from}' AND '${to}' ${adsMarketFilter} ${adsMktFilter}`);

                setDirectKpi({ ...(directKpiData[0] || {}), ads_usd: adsData[0]?.ads_usd || 0 });

                // Marketer P&L: orders + revenue per market for DT Ước Tính
                const mkterPnlQuery = `WITH ${pageMktCTE(ds)}
                SELECT
                    COALESCE(pm.mkter, 'UNKNOWN') as mkter,
                    COUNT(*) as orders,
                    SUM(CASE WHEN s.status_category='GIAO_THANH_CONG' THEN 1 ELSE 0 END) as success,
                    SUM(CASE WHEN s.status_category='DON_HOAN' THEN 1 ELSE 0 END) as returned,
                    ROUND(SUM(s.cod / 100.0 * (${FX_CASE})), 0) as revenue,
                    ROUND(SUM(CASE WHEN s.status_category='GIAO_THANH_CONG' THEN s.cod / 100.0 * (${FX_CASE}) ELSE 0 END), 0) as revenue_tc,
                    ROUND(SUM(CASE WHEN s.order_currency='SAR' THEN s.cod / 100.0 * ${FX_TO_VND.SAR} ELSE 0 END), 0) as rev_ksa,
                    ROUND(SUM(CASE WHEN s.order_currency='AED' THEN s.cod / 100.0 * ${FX_TO_VND.AED} ELSE 0 END), 0) as rev_uae,
                    ROUND(SUM(CASE WHEN s.order_currency='KWD' THEN s.cod / 100.0 * ${FX_TO_VND.KWD} ELSE 0 END), 0) as rev_kwt,
                    ROUND(SUM(CASE WHEN s.order_currency='AUD' THEN s.cod / 100.0 * ${FX_TO_VND.AUD} ELSE 0 END), 0) as rev_aus
                FROM \`levelup-465304.${ds}.sale_order\` s
                LEFT JOIN page_mkt_map pm ON s.page_id = pm.page_id
                WHERE DATE(TIMESTAMP(s.inserted_at), '${TZ}') BETWEEN '${from}' AND '${to}'
                    AND s.status_category NOT IN ('HUY','DON_THO')
                    ${marketFilter} ${mktFilter_page}
                GROUP BY 1 ORDER BY revenue DESC`;

                // COGS per MKT: xuất kho + thành công separately
                const mkterCogsQuery = `WITH ${pageMktCTE(ds)}
                SELECT
                    COALESCE(pm.mkter, 'UNKNOWN') as mkter,
                    ROUND(SUM(COALESCE(pc.cost_raw, 0) * i.quantity), 0) as cogs_xk,
                    ROUND(SUM(CASE WHEN s.status_category='GIAO_THANH_CONG' THEN COALESCE(pc.cost_raw, 0) * i.quantity ELSE 0 END), 0) as cogs_tc
                FROM \`levelup-465304.${ds}.sale_order\` s
                LEFT JOIN page_mkt_map pm ON s.page_id = pm.page_id
                LEFT JOIN \`levelup-465304.${ds}.order_items\` i ON s.id = i.order_id
                LEFT JOIN \`levelup-465304.${ds}.product_cogs\` pc ON i.variation_id = pc.variation_id
                WHERE DATE(TIMESTAMP(s.inserted_at), '${TZ}') BETWEEN '${from}' AND '${to}'
                    AND s.status_category NOT IN ('HUY','DON_THO')
                    ${marketFilter} ${mktFilter_page}
                GROUP BY 1`;

                // Q2: Product rank by DT Xuất Kho (sale_order + order_items, multi-currency)
                const FX_CASE_O = FX_CASE.replace(/order_currency/g, 'o.order_currency');
                // Product rank: allocate order cod to items by quantity ratio + SR%
                const productRankQuery = `SELECT COALESCE(pt.name, i.product_name) as product_name,
                    SUM(i.quantity) as qty,
                    COUNT(DISTINCT o.id) as orders,
                    COUNT(DISTINCT CASE WHEN o.status_category='GIAO_THANH_CONG' THEN o.id END) as success,
                    ROUND(SUM(o.cod / 100.0 * (${FX_CASE_O}) * i.quantity / GREATEST(CAST(o.total_quantity AS INT64), 1)), 0) as revenue
                FROM \`levelup-465304.${ds}.order_items\` i
                JOIN \`levelup-465304.${ds}.sale_order\` o ON i.order_id = o.id
                LEFT JOIN \`levelup-465304.${ds}.product_template\` pt ON i.product_id = pt.id
                WHERE DATE(TIMESTAMP(o.inserted_at), '${TZ}') BETWEEN '${from}' AND '${to}'
                    AND o.status_category NOT IN ('HUY','DON_THO')
                    AND COALESCE(pt.name, i.product_name) IS NOT NULL AND COALESCE(pt.name, i.product_name) != ''
                    ${marketFilter.replace(/s\./g, 'o.')}
                GROUP BY 1 HAVING revenue > 0 ORDER BY revenue DESC LIMIT 100`;

                // Market performance from sale_order (multi-currency)
                const marketPerfQuery = `SELECT
                    CASE s.order_currency WHEN 'SAR' THEN 'KSA' WHEN 'AED' THEN 'UAE' WHEN 'KWD' THEN 'Kuwait' WHEN 'AUD' THEN 'Australia' ELSE 'Other' END as market,
                    COUNT(*) as orders,
                    SUM(CASE WHEN s.status_category='GIAO_THANH_CONG' THEN 1 ELSE 0 END) as success,
                    ROUND(SUM(s.cod / 100.0 * (${FX_CASE})), 0) as dt_xuat_kho,
                    ROUND(SUM(CASE WHEN s.status_category='GIAO_THANH_CONG' THEN s.cod / 100.0 * (${FX_CASE}) ELSE 0 END), 0) as dt_thanh_cong
                FROM \`levelup-465304.${ds}.sale_order\` s
                WHERE DATE(TIMESTAMP(s.inserted_at), '${TZ}') BETWEEN '${from}' AND '${to}'
                    AND s.status_category NOT IN ('HUY','DON_THO')
                    AND s.order_currency != 'VND'
                    ${marketFilter} ${mktFilter_page.replace(/pm\./g, '')}
                GROUP BY 1 ORDER BY dt_xuat_kho DESC`;

                const queries = [
                    queryCeoMonthlyPnl(DATASET, from, to, REVENUE_COL),      // Q0
                    mkterPnlQuery,                                            // Q1 - page_mkt_map attributed
                    productRankQuery,                                          // Q2 - product rank by DT Xuất Kho
                    marketPerfQuery,                                           // Q3 - market from sale_order
                    queryCeoAdsByMarketer(DATASET, from, to),    // Q4
                    queryCeoStock(DATASET),                       // Q5
                    mkterCogsQuery,                                           // Q6 - COGS per MKT
                    // Q7: Monthly × Market breakdown — include prev month for comparison
                    `SELECT
                        FORMAT_DATE('%Y-%m', DATE(TIMESTAMP(s.inserted_at), '${TZ}')) as month,
                        CASE s.order_currency WHEN 'SAR' THEN 'KSA' WHEN 'AED' THEN 'UAE' WHEN 'KWD' THEN 'Kuwait' WHEN 'AUD' THEN 'Australia' ELSE 'Other' END as market,
                        COUNT(*) as orders,
                        SUM(CASE WHEN s.status_category='GIAO_THANH_CONG' THEN 1 ELSE 0 END) as success,
                        SUM(CASE WHEN s.status_category='DON_HOAN' THEN 1 ELSE 0 END) as returned,
                        SUM(CASE WHEN s.status_category='DANG_GIAO' THEN 1 ELSE 0 END) as in_transit,
                        ROUND(SUM(s.cod / 100.0 * (${FX_CASE})), 0) as dt_xuat_kho,
                        ROUND(SUM(CASE WHEN s.status_category='GIAO_THANH_CONG' THEN s.cod / 100.0 * (${FX_CASE}) ELSE 0 END), 0) as dt_thanh_cong,
                        ROUND(SUM(CASE WHEN s.status_category='DON_HOAN' THEN s.cod / 100.0 * (${FX_CASE}) ELSE 0 END), 0) as dt_hoan,
                        ROUND(SUM(CASE WHEN s.status_category='DANG_GIAO' THEN s.cod / 100.0 * (${FX_CASE}) ELSE 0 END), 0) as dt_dang_giao
                    FROM \`levelup-465304.${ds}.sale_order\` s
                    WHERE DATE(TIMESTAMP(s.inserted_at), '${TZ}') BETWEEN '${extFrom}' AND '${to}'
                        AND s.status_category NOT IN ('HUY','DON_THO')
                        AND s.order_currency != 'VND'
                        ${marketFilter} ${mktFilter_page.replace(/pm\./g, '')}
                    GROUP BY 1, 2 ORDER BY 1, dt_xuat_kho DESC`,
                    // Q8: COGS breakdown by month×market (xuất kho, thành công, hoàn, đang giao)
                    `SELECT
                        FORMAT_DATE('%Y-%m', DATE(TIMESTAMP(o.inserted_at), '${TZ}')) as month,
                        CASE o.order_currency WHEN 'SAR' THEN 'KSA' WHEN 'AED' THEN 'UAE' WHEN 'KWD' THEN 'Kuwait' WHEN 'AUD' THEN 'Australia' ELSE 'Other' END as market,
                        ROUND(SUM(COALESCE(pc.cost_raw, 0) * i.quantity), 0) as cogs_xk,
                        ROUND(SUM(CASE WHEN o.status_category='GIAO_THANH_CONG' THEN COALESCE(pc.cost_raw, 0) * i.quantity ELSE 0 END), 0) as cogs_tc,
                        ROUND(SUM(CASE WHEN o.status_category='DON_HOAN' THEN COALESCE(pc.cost_raw, 0) * i.quantity ELSE 0 END), 0) as cogs_hoan,
                        ROUND(SUM(CASE WHEN o.status_category='DANG_GIAO' THEN COALESCE(pc.cost_raw, 0) * i.quantity ELSE 0 END), 0) as cogs_dang_giao
                    FROM \`levelup-465304.${ds}.sale_order\` o
                    LEFT JOIN \`levelup-465304.${ds}.order_items\` i ON o.id = i.order_id
                    LEFT JOIN \`levelup-465304.${ds}.product_cogs\` pc ON i.variation_id = pc.variation_id
                    WHERE DATE(TIMESTAMP(o.inserted_at), '${TZ}') BETWEEN '${extFrom}' AND '${to}'
                        AND o.status_category NOT IN ('HUY','DON_THO')
                        AND o.order_currency != 'VND'
                        ${marketFilter.replace(/s\./g, 'o.')}
                    GROUP BY 1, 2`,
                    // Q9: Ads spend by month × market (actual, not proportional)
                    `SELECT FORMAT_DATE('%Y-%m', report_date) as month,
                        CASE UPPER(TRIM(SPLIT(campaign_name, '_')[SAFE_OFFSET(2)]))
                            WHEN 'SA' THEN 'KSA' WHEN 'KSA' THEN 'KSA' WHEN 'KSA01' THEN 'KSA'
                            WHEN 'AE' THEN 'UAE' WHEN 'UAE01' THEN 'UAE'
                            WHEN 'KW' THEN 'Kuwait' WHEN 'AU' THEN 'Australia'
                            WHEN 'QA' THEN 'Qatar' WHEN 'US' THEN 'USA' WHEN 'RO' THEN 'Romania'
                            ELSE 'Unknown' END as market,
                        ROUND(SUM(spend_usd) * ${FX_TO_VND.USD || 25400}, 0) as ads_vnd
                    FROM \`levelup-465304.${ds}.vw_fact_ads_performance\`
                    WHERE report_date BETWEEN '${extFrom}' AND '${to}'
                        ${adsMarketFilter} ${adsMktFilter}
                    GROUP BY 1, 2`,
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

                setMonthly(results[0].data || []);

                // Build marketer P&L: orders + COGS + ads (all in VND)
                const mkterPnlRows = results[1].data || [];
                const cogsRows = results[6]?.data || [];
                const adsPerCode = results[4]?.data || [];

                // Ads spend per MKT: query spend_usd directly instead of spend_ron
                const adsPerMktUsd = await runQ(`SELECT
                    campaign_mkter_code as mkter_code,
                    ROUND(SUM(spend_usd), 2) as spend_usd
                FROM \`levelup-465304.${ds}.vw_fact_ads_performance\`
                WHERE report_date BETWEEN '${from}' AND '${to}' ${adsMarketFilter} ${adsMktFilter}
                GROUP BY 1`);

                const adsByCode = new Map<string, number>();
                adsPerMktUsd.forEach((row: any) => {
                    const code = (row.mkter_code || "").toUpperCase();
                    adsByCode.set(code, (adsByCode.get(code) || 0) + ((row.spend_usd || 0) * (FX_TO_VND.USD || 25400)));
                });

                // COGS per MKT code (already VND): xuất kho + thành công
                const cogsByCode = new Map<string, { xk: number; tc: number }>();
                cogsRows.forEach((row: any) => {
                    const prev = cogsByCode.get(row.mkter) || { xk: 0, tc: 0 };
                    cogsByCode.set(row.mkter, {
                        xk: prev.xk + (row.cogs_xk || 0),
                        tc: prev.tc + (row.cogs_tc || 0),
                    });
                });

                // Merge all data: compute DT Ước Tính, Shipping, LN tạm tính, Net P&L
                const mergedMarketers: MarketerRank[] = [];
                mkterPnlRows.forEach((m: any) => {
                    const code = (m.mkter || "").toUpperCase();
                    const name = resolveMarketerName(code);
                    if (!isRealMarketer(name)) return;

                    const revenue = m.revenue || 0;        // DT Xuất Kho
                    const revenueTc = m.revenue_tc || 0;   // DT Thành Công
                    const adsVnd = adsByCode.get(code) || 0;
                    const cogsData = cogsByCode.get(code) || { xk: 0, tc: 0 };

                    // DT Ước Tính = KSA×65% + UAE×85% + KWT×82% + AUS×65%
                    const dtUocTinh = Math.round(
                        (m.rev_ksa || 0) * 0.65 +
                        (m.rev_uae || 0) * 0.85 +
                        (m.rev_kwt || 0) * 0.82 +
                        (m.rev_aus || 0) * 0.65
                    );
                    const shipping = Math.round(revenue * 0.20); // 20% DT Xuất Kho
                    const lnTamTinh = dtUocTinh - adsVnd - cogsData.xk - shipping;
                    const netPnl = revenueTc - adsVnd - cogsData.tc - Math.round(revenueTc * 0.20);

                    const roas = adsVnd > 0 ? Math.round((revenue / adsVnd) * 100) / 100 : 0;
                    const sr = m.orders > 0 ? Math.round((m.success / m.orders) * 1000) / 10 : 0;

                    mergedMarketers.push({
                        marketer_name: name,
                        orders: m.orders || 0, success: m.success || 0, returned: m.returned || 0,
                        revenue, ads_spend: adsVnd,
                        cogs: cogsData.xk,        // Hàng Xuất Kho
                        shipping,
                        net_profit: netPnl,
                        roas, sr,
                        // Extra fields (cast via any)
                        revenue_tc: revenueTc,
                        dt_uoc_tinh: dtUocTinh,
                        cogs_tc: cogsData.tc,      // Vốn thực bán
                        ln_tam_tinh: lnTamTinh,
                    } as any);
                });
                mergedMarketers.sort((a, b) => b.revenue - a.revenue);
                setMarketers(mergedMarketers);

                setProducts(results[2].data || []); // now = productRank data
                setMarkets(results[3].data || []);
                setStock(results[5]?.data || []);
                // Merge Q7 (orders) + Q8 (cogs) + Q9 (ads) for monthly×market
                const mmData = results[7]?.data || [];
                const mmCogs = results[8]?.data || [];
                const mmAds = results[9]?.data || [];
                const cogsMap = new Map<string, any>();
                mmCogs.forEach((c: any) => cogsMap.set(`${c.month}|${c.market}`, c));
                // Build ads map by month×market
                const adsMap = new Map<string, number>();
                mmAds.forEach((a: any) => {
                    const key = `${a.month}|${a.market}`;
                    adsMap.set(key, (adsMap.get(key) || 0) + (a.ads_vnd || 0));
                });
                // Base = Q7 order data (markets with orders only)
                const mmMerged: any[] = mmData.map((r: any) => {
                    const c = cogsMap.get(`${r.month}|${r.market}`) || {};
                    return {
                        ...r,
                        cogs_xk: c.cogs_xk || 0, cogs_tc: c.cogs_tc || 0,
                        cogs_hoan: c.cogs_hoan || 0, cogs_dang_giao: c.cogs_dang_giao || 0,
                        ads_vnd: adsMap.get(`${r.month}|${r.market}`) || 0,
                    };
                });
                // Add "Unknown" row per month for ads that don't match any order-market
                const orderMonths = [...new Set(mmData.map((r: any) => r.month))];
                const adsMonths = [...new Set(mmAds.map((a: any) => a.month))];
                const allMonths = [...new Set([...orderMonths, ...adsMonths])].sort();
                allMonths.forEach(month => {
                    const orderMarkets = new Set(mmData.filter((r: any) => r.month === month).map((r: any) => r.market));
                    let unknownAds = 0;
                    adsMap.forEach((v, k) => {
                        if (k.startsWith(month + '|')) {
                            const mkt = k.split('|')[1];
                            if (!orderMarkets.has(mkt)) unknownAds += v;
                        }
                    });
                    if (unknownAds > 0) {
                        mmMerged.push({
                            month, market: 'Unknown', orders: 0, success: 0, returned: 0, in_transit: 0,
                            dt_xuat_kho: 0, dt_thanh_cong: 0, dt_hoan: 0, dt_dang_giao: 0,
                            cogs_xk: 0, cogs_tc: 0, cogs_hoan: 0, cogs_dang_giao: 0,
                            ads_vnd: unknownAds,
                        });
                    }
                });
                mmMerged.sort((a, b) => a.month.localeCompare(b.month) || b.dt_xuat_kho - a.dt_xuat_kho);
                setMonthlyMarket(mmMerged);

            } catch (error) {
                console.error("CEO Overview fetch error:", error);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [dateRange, timePreset, refreshKey]);

    if (loading) {
        return <TabSkeleton cards={6} showChart={true} rows={5} />;
    }

    // Aggregates from monthly pnl (Q0) — mart-based
    const martTotals = monthly.reduce(
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

    // Use sale_order-based KPIs (multi-currency, VN timezone, correct status)
    const adsVnd = Math.round((directKpi.ads_usd || 0) * (FX_TO_VND.USD || 25400));
    const dtXuatKho = directKpi.dt_xuat_kho || 0;
    const dtThanhCong = directKpi.dt_thanh_cong || 0;

    // Sum COGS from marketer table (already VND)
    const totalCogs = marketers.reduce((s, m) => s + (m.cogs || 0), 0);
    const totalAdsFromMkt = marketers.reduce((s, m) => s + (m.ads_spend || 0), 0);
    const totalShipping = marketers.reduce((s: number, m: any) => s + (m.shipping || 0), 0);

    const totals = {
        revenue: dtXuatKho,
        delivered: dtThanhCong,
        orders: directKpi.tong_don || 0,
        ordersXk: directKpi.don_xk || 0,
        success: directKpi.don_tc || 0,
        cogs: totalCogs,
        shipping: totalShipping,
        ads: totalAdsFromMkt || adsVnd,
        net: 0,
    };
    totals.net = marketers.reduce((s: number, m: any) => s + (m.net_profit || 0), 0);

    const totalCogsTc = marketers.reduce((s: number, m: any) => s + (m.cogs_tc || 0), 0);
    const totalPctNet = totals.delivered > 0 ? ((totals.net / totals.delivered) * 100) : 0;
    const overallRoas = totals.ads > 0 ? (dtXuatKho / totals.ads) : 0;
    const overallMargin = dtXuatKho > 0 ? ((totals.net / dtXuatKho) * 100) : 0;
    const productRank = products;

    return (
        <div className="space-y-6">
            {/* ── Filter Bar ── */}
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-[#0f172a] px-5 py-3">
                <div className="flex items-center gap-1.5 mr-2">
                    <span className="text-base">📈</span>
                    <span className="font-bold text-base text-white">Tổng Quan</span>
                    <span className="font-bold text-base text-emerald-500">Zen 8</span>
                </div>
                <div className="flex-1" />

                <CeoTimePicker presets={TIME_PRESETS} selected={timePreset}
                    onPreset={(l: string) => { setTimePreset(l); if (l !== "Tùy chỉnh") setRefreshKey(k => k + 1); }}
                    customFrom={customFrom} customTo={customTo}
                    onCustomFrom={setCustomFrom} onCustomTo={setCustomTo}
                    onApply={() => { setTimePreset("Tùy chỉnh"); setRefreshKey(k => k + 1); }} />

                <CeoMultiSelect label="Thị trường" options={MARKETS_ALL} selected={selMarkets} onChange={setSelMarkets} />
                <CeoMultiSelect label="MKT" options={MKTERS_ALL} selected={selMkts} onChange={setSelMkts} />
                <CeoMultiSelect label="Sản phẩm" options={productList} selected={selProducts} onChange={setSelProducts} searchable />

                <button onClick={applyFilters}
                    className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white bg-emerald-500 hover:opacity-90">
                    Lọc
                </button>
                <ThemeToggle />
            </div>

            {/* KPI Row */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard
                    title="💰 DT Xuất Kho"
                    value={formatCurrency(totals.revenue)}
                    icon={DollarSign}
                    status={totals.revenue > 0 ? "success" : "neutral"}
                    subValue={`${formatNumber(totals.ordersXk)} đơn`}
                />
                <KPICard
                    title="✅ DT Thành Công"
                    value={formatCurrency(totals.delivered)}
                    icon={TrendingUp}
                    status={totals.delivered > 0 ? "success" : "neutral"}
                    subValue={`${formatNumber(totals.success)} đơn đã nhận`}
                />
                <KPICard
                    title="📦 Đơn / Thành công"
                    value={`${formatNumber(totals.orders)} / ${formatNumber(totals.success)}`}
                    icon={Package}
                    status="neutral"
                    subValue={`SR: ${totals.orders > 0 ? ((totals.success / totals.orders) * 100).toFixed(1) : 0}%`}
                />
                <KPICard
                    title="🎯 ROAS"
                    value={`${overallRoas.toFixed(2)}x`}
                    icon={Target}
                    status={overallRoas >= 2.5 ? "success" : overallRoas >= 1.5 ? "warning" : "danger"}
                    subValue={`Ads: ${formatCurrency(totals.ads)}`}
                />
                <KPICard
                    title="👥 Marketers"
                    value={String(marketers.length)}
                    icon={Users}
                    status="neutral"
                    subValue="Active"
                />
                <KPICard
                    title="🌍 Markets"
                    value={String(markets.length)}
                    icon={Globe}
                    status="neutral"
                    subValue={markets.slice(0, 3).map((m) => m.market).join(", ")}
                />
            </div>

            {/* Cost breakdown banner */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">💸 Chi phí chi tiết</h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Ads Spend</div>
                        <div className="mt-1 text-lg font-bold text-amber-500">{formatCurrency(totals.ads)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Vốn Thực Bán</div>
                        <div className="mt-1 text-lg font-bold text-pink-500">{formatCurrency(totalCogsTc)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Shipping</div>
                        <div className="mt-1 text-lg font-bold text-cyan-500">{formatCurrency(totals.shipping)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Tổng CP</div>
                        <div className="mt-1 text-lg font-bold text-rose-500">{formatCurrency(totals.ads + totalCogsTc + totals.shipping)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Net P&L</div>
                        <div className={cn("mt-1 text-lg font-bold", totals.net >= 0 ? "text-emerald-500" : "text-rose-500")}>
                            {formatCurrency(totals.net)}
                        </div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">%Net Profit</div>
                        <div className={cn("mt-1 text-lg font-bold", totalPctNet >= 20 ? "text-emerald-500" : totalPctNet >= 0 ? "text-amber-500" : "text-rose-500")}>
                            {totals.delivered > 0 ? `${totalPctNet.toFixed(1)}%` : "—"}
                        </div>
                    </div>
                </div>
            </div>

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
                                <th className="px-2 pb-2 text-left font-medium sticky left-0 bg-card z-10">Marketer</th>
                                <th className="px-2 pb-2 text-right font-medium">Đơn</th>
                                <th className="px-2 pb-2 text-right font-medium">TC</th>
                                <th className="px-2 pb-2 text-right font-medium">Hoàn</th>
                                <th className="px-2 pb-2 text-right font-medium">SR%</th>
                                <th className="px-2 pb-2 text-right font-medium text-emerald-500">DT Xuất Kho</th>
                                <th className="px-2 pb-2 text-right font-medium text-blue-400">DT Ước Tính</th>
                                <th className="px-2 pb-2 text-right font-medium text-teal-400">DT Thành Công</th>
                                <th className="px-2 pb-2 text-right font-medium text-amber-500">Ads Spend</th>
                                <th className="px-2 pb-2 text-right font-medium text-orange-500">Hàng XK</th>
                                <th className="px-2 pb-2 text-right font-medium text-pink-500">Vốn Thực Bán</th>
                                <th className="px-2 pb-2 text-right font-medium text-cyan-500">Shipping</th>
                                <th className="px-2 pb-2 text-right font-medium text-violet-400">LN Tạm Tính</th>
                                <th className="px-2 pb-2 text-right font-medium">Net P&L</th>
                                <th className="px-2 pb-2 text-right font-medium text-amber-300">%ADS</th>
                                <th className="px-2 pb-2 text-right font-medium text-emerald-300">%Net Profit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {marketers.map((m: any) => {
                                const pctAds = (m.revenue_tc || 0) > 0 ? ((m.ads_spend / m.revenue_tc) * 100) : 0;
                                const pctNet = (m.revenue_tc || 0) > 0 ? ((m.net_profit / m.revenue_tc) * 100) : 0;
                                return (
                                    <tr key={m.marketer_name} className="border-b border-border/60 hover:bg-gray-50/50">
                                        <td className="px-2 py-2 font-medium text-foreground sticky left-0 bg-card z-10">{m.marketer_name}</td>
                                        <td className="px-2 py-2 text-right">{formatNumber(m.orders)}</td>
                                        <td className="px-2 py-2 text-right">{formatNumber(m.success)}</td>
                                        <td className={cn("px-2 py-2 text-right", m.returned > 0 ? "text-rose-500" : "")}>{formatNumber(m.returned)}</td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", m.sr >= 45 ? "text-emerald-500" : m.sr >= 30 ? "text-amber-500" : "text-rose-500")}>{m.sr}%</td>
                                        <td className="px-2 py-2 text-right font-semibold text-emerald-500">{formatMoney(m.revenue)}</td>
                                        <td className="px-2 py-2 text-right text-blue-400">{formatMoney(m.dt_uoc_tinh || 0)}</td>
                                        <td className="px-2 py-2 text-right text-teal-400">{formatMoney(m.revenue_tc || 0)}</td>
                                        <td className="px-2 py-2 text-right text-amber-500">{formatMoney(m.ads_spend)}</td>
                                        <td className="px-2 py-2 text-right text-orange-500">{formatMoney(m.cogs)}</td>
                                        <td className="px-2 py-2 text-right text-pink-500">{formatMoney(m.cogs_tc || 0)}</td>
                                        <td className="px-2 py-2 text-right text-cyan-500">{formatMoney(m.shipping)}</td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", (m.ln_tam_tinh || 0) >= 0 ? "text-violet-400" : "text-rose-500")}>
                                            {(m.ln_tam_tinh || 0) >= 0 ? "+" : ""}{formatMoney(m.ln_tam_tinh || 0)}
                                        </td>
                                        <td className={cn("px-2 py-2 text-right font-bold", m.net_profit >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                            {m.net_profit >= 0 ? "+" : ""}{formatMoney(m.net_profit)}
                                        </td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", pctAds <= 25 ? "text-emerald-500" : pctAds <= 40 ? "text-amber-500" : "text-rose-500")}>
                                            {pctAds > 0 ? `${pctAds.toFixed(1)}%` : "—"}
                                        </td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", pctNet >= 20 ? "text-emerald-500" : pctNet >= 0 ? "text-amber-500" : "text-rose-500")}>
                                            {(m.revenue_tc || 0) > 0 ? `${pctNet.toFixed(1)}%` : "—"}
                                        </td>
                                    </tr>
                                );
                            })}
                            {/* TỔNG row */}
                            {(() => {
                                const t = marketers.reduce((a: any, m: any) => ({
                                    orders: a.orders + m.orders, success: a.success + m.success, returned: a.returned + m.returned,
                                    revenue: a.revenue + m.revenue, dt_uoc_tinh: a.dt_uoc_tinh + (m.dt_uoc_tinh || 0),
                                    revenue_tc: a.revenue_tc + (m.revenue_tc || 0),
                                    ads: a.ads + m.ads_spend, cogs: a.cogs + m.cogs, cogs_tc: a.cogs_tc + (m.cogs_tc || 0),
                                    shipping: a.shipping + m.shipping, ln_tam_tinh: a.ln_tam_tinh + (m.ln_tam_tinh || 0),
                                    net: a.net + m.net_profit,
                                }), { orders: 0, success: 0, returned: 0, revenue: 0, dt_uoc_tinh: 0, revenue_tc: 0, ads: 0, cogs: 0, cogs_tc: 0, shipping: 0, ln_tam_tinh: 0, net: 0 });
                                const sr = t.orders > 0 ? Math.round(t.success / t.orders * 1000) / 10 : 0;
                                const tPctAds = t.revenue_tc > 0 ? ((t.ads / t.revenue_tc) * 100) : 0;
                                const tPctNet = t.revenue_tc > 0 ? ((t.net / t.revenue_tc) * 100) : 0;
                                return (
                                    <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                        <td className="px-2 py-2 text-foreground sticky left-0 bg-indigo-500/5 z-10">TỔNG</td>
                                        <td className="px-2 py-2 text-right text-foreground">{formatNumber(t.orders)}</td>
                                        <td className="px-2 py-2 text-right text-foreground">{formatNumber(t.success)}</td>
                                        <td className="px-2 py-2 text-right text-rose-500">{formatNumber(t.returned)}</td>
                                        <td className="px-2 py-2 text-right text-foreground">{sr}%</td>
                                        <td className="px-2 py-2 text-right text-emerald-500">{formatMoney(t.revenue)}</td>
                                        <td className="px-2 py-2 text-right text-blue-400">{formatMoney(t.dt_uoc_tinh)}</td>
                                        <td className="px-2 py-2 text-right text-teal-400">{formatMoney(t.revenue_tc)}</td>
                                        <td className="px-2 py-2 text-right text-amber-500">{formatMoney(t.ads)}</td>
                                        <td className="px-2 py-2 text-right text-orange-500">{formatMoney(t.cogs)}</td>
                                        <td className="px-2 py-2 text-right text-pink-500">{formatMoney(t.cogs_tc)}</td>
                                        <td className="px-2 py-2 text-right text-cyan-500">{formatMoney(t.shipping)}</td>
                                        <td className={cn("px-2 py-2 text-right", t.ln_tam_tinh >= 0 ? "text-violet-400" : "text-rose-500")}>
                                            {t.ln_tam_tinh >= 0 ? "+" : ""}{formatMoney(t.ln_tam_tinh)}
                                        </td>
                                        <td className={cn("px-2 py-2 text-right", t.net >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                            {t.net >= 0 ? "+" : ""}{formatMoney(t.net)}
                                        </td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", tPctAds <= 25 ? "text-emerald-500" : tPctAds <= 40 ? "text-amber-500" : "text-rose-500")}>
                                            {tPctAds > 0 ? `${tPctAds.toFixed(1)}%` : "—"}
                                        </td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", tPctNet >= 20 ? "text-emerald-500" : tPctNet >= 0 ? "text-amber-500" : "text-rose-500")}>
                                            {t.revenue_tc > 0 ? `${tPctNet.toFixed(1)}%` : "—"}
                                        </td>
                                    </tr>
                                );
                            })()}
                        </tbody>
                    </table>
                </div>
            </div >

            {/* ── Product + Market (2 columns) ── */}
            < div className="grid gap-4 lg:grid-cols-2" >
                {/* Rank Sản Phẩm Xuất Kho */}
                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-blue-400" />
                        🏆 Rank Sản Phẩm Xuất Kho ({productRank.length})
                    </h3>
                    <div className="space-y-2 max-h-[520px] overflow-y-auto pr-2" style={{ scrollbarWidth: "thin", scrollbarColor: "#4b5563 transparent" }}>
                        {productRank.map((p: any, i: number) => {
                            const maxRev = productRank[0]?.revenue || 1;
                            const pct = (p.revenue / maxRev) * 100;
                            const sr = p.orders > 0 ? Math.round((p.success / p.orders) * 1000) / 10 : 0;
                            return (
                                <div key={i} className="flex items-center gap-3 text-xs">
                                    <span className={cn("w-5 text-right font-bold", i < 3 ? "text-amber-500" : "text-muted-foreground")}>{i + 1}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className={cn("truncate", i < 3 ? "font-bold text-amber-500" : "font-medium text-foreground")}>{p.product_name}</div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <div className="relative flex-1 h-2 rounded-full bg-border overflow-hidden group/bar cursor-default"
                                                title={`SR: ${sr}% (${formatNumber(p.success)}/${formatNumber(p.orders)} đơn TC)`}>
                                                <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
                                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/bar:opacity-100 transition-opacity bg-black/60 rounded-full">
                                                    <span className="text-[10px] font-bold text-white">SR: {sr}%</span>
                                                </div>
                                            </div>
                                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatNumber(p.qty)} sp</span>
                                        </div>
                                    </div>
                                    <span className="font-bold text-emerald-500 whitespace-nowrap">{formatMoney(p.revenue)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Market Performance - Pie Chart */}
                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-cyan-400" />
                        🌍 Market Performance
                    </h3>
                    {markets.length > 0 ? (
                        <ResponsiveContainer width="100%" height={320}>
                            <PieChart>
                                <Pie
                                    data={markets.filter((m: any) => (m.dt_xuat_kho || m.revenue || 0) > 0)}
                                    dataKey="dt_xuat_kho"
                                    nameKey="market"
                                    cx="50%" cy="50%"
                                    innerRadius={60} outerRadius={100}
                                    paddingAngle={3}
                                    label={({ market, percent }: any) => `${market} ${(percent * 100).toFixed(0)}%`}
                                >
                                    {markets.map((_: any, i: number) => (
                                        <Cell key={i} fill={["#3b82f6", "#10b981", "#a855f7", "#f59e0b", "#06b6d4", "#f97316"][i % 6]} />
                                    ))}
                                </Pie>
                                <Tooltip content={({ active, payload }: any) => {
                                    if (!active || !payload?.length) return null;
                                    const m = payload[0].payload;
                                    const sr = m.orders > 0 ? ((m.success / m.orders) * 100).toFixed(1) : "0";
                                    const dtXk = m.dt_xuat_kho || 0;
                                    const dtTc = m.dt_thanh_cong || 0;
                                    // Net P&L = DT Thành Công - Ads(tỷ lệ) - COGS(tỷ lệ) - Shipping(20% DT TC)
                                    const mktShare = totals.revenue > 0 ? dtXk / totals.revenue : 0;
                                    const mktAds = Math.round(totals.ads * mktShare);
                                    const mktCogs = Math.round(totalCogsTc * mktShare);
                                    const shippingTc = Math.round(dtTc * 0.2);
                                    const netPnl = dtTc - mktAds - mktCogs - shippingTc;
                                    const pctNetProfit = dtTc > 0 ? ((netPnl / dtTc) * 100).toFixed(1) : "0";
                                    return (
                                        <div className="rounded-lg p-3 shadow-xl text-xs" style={{ background: "#1f2937", border: "1px solid #374151" }}>
                                            <div className="font-bold text-white text-sm mb-2">{m.market}</div>
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                                <span className="text-gray-400">Đơn:</span>
                                                <span className="text-white font-semibold text-right">{formatNumber(m.orders)}</span>
                                                <span className="text-gray-400">DT Xuất Kho:</span>
                                                <span className="text-emerald-500 font-semibold text-right">{formatMoney(dtXk)}</span>
                                                <span className="text-gray-400">DT Thành Công:</span>
                                                <span className="text-teal-400 font-semibold text-right">{formatMoney(dtTc)}</span>
                                                <span className="text-gray-400">% Giao hàng:</span>
                                                <span className={cn("font-semibold text-right", Number(sr) >= 50 ? "text-emerald-500" : "text-amber-500")}>{sr}%</span>
                                                <span className="text-gray-400">Net P&L:</span>
                                                <span className={cn("font-semibold text-right", netPnl >= 0 ? "text-emerald-500" : "text-rose-500")}>{formatMoney(netPnl)}</span>
                                                <span className="text-gray-400">%Net Profit:</span>
                                                <span className={cn("font-semibold text-right", Number(pctNetProfit) >= 20 ? "text-emerald-500" : Number(pctNetProfit) >= 0 ? "text-amber-500" : "text-rose-500")}>{pctNetProfit}%</span>
                                            </div>
                                        </div>
                                    );
                                }} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="text-center text-muted-foreground text-sm py-8">Không có dữ liệu</div>
                    )}
                </div>
            </div >

            {/* Monthly × Market P&L Table */}
            <MonthlyMarketTable data={monthlyMarket} totals={totals} totalCogsTc={totalCogsTc} formatMoney={formatMoney} formatNumber={formatNumber} />

            {/* Tồn Kho đã chuyển sang tab Tồn kho */}

        </div >
    );
}

// ── Monthly × Market Table ──

function HoverTooltip({ children, content }: { children: React.ReactNode; content: React.ReactNode }) {
    const [show, setShow] = useState(false);
    const ref = useRef<HTMLSpanElement>(null);
    return (
        <span ref={ref} className="relative inline-block cursor-help"
            onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
            {children}
            {show && (
                <div className="fixed z-[9999] min-w-[200px] rounded-lg bg-gray-900 text-white text-[10px] px-3 py-2 shadow-2xl border border-gray-600 whitespace-nowrap pointer-events-none"
                    style={{
                        top: ref.current ? ref.current.getBoundingClientRect().top - 8 : 0,
                        left: ref.current ? ref.current.getBoundingClientRect().right + 8 : 0,
                        transform: 'translateY(-100%)',
                    }}>
                    {content}
                </div>
            )}
        </span>
    );
}

function MonthlyMarketTable({ data, totals, totalCogsTc, formatMoney, formatNumber }: any) {
    const months = [...new Set<string>(data.map((d: any) => d.month))].sort();
    const byMonth: Record<string, any[]> = {};
    data.forEach((row: any) => {
        if (!byMonth[row.month]) byMonth[row.month] = [];
        byMonth[row.month].push(row);
    });

    const sumRows = (rows: any[]) => rows.reduce((acc: any, r: any) => ({
        market: 'Total', orders: acc.orders + (r.orders || 0),
        success: acc.success + (r.success || 0), returned: acc.returned + (r.returned || 0),
        in_transit: acc.in_transit + (r.in_transit || 0),
        dt_xuat_kho: acc.dt_xuat_kho + (r.dt_xuat_kho || 0),
        dt_thanh_cong: acc.dt_thanh_cong + (r.dt_thanh_cong || 0),
        dt_hoan: acc.dt_hoan + (r.dt_hoan || 0), dt_dang_giao: acc.dt_dang_giao + (r.dt_dang_giao || 0),
        cogs_xk: acc.cogs_xk + (r.cogs_xk || 0), cogs_tc: acc.cogs_tc + (r.cogs_tc || 0),
        cogs_hoan: acc.cogs_hoan + (r.cogs_hoan || 0), cogs_dang_giao: acc.cogs_dang_giao + (r.cogs_dang_giao || 0),
        ads_vnd: acc.ads_vnd + (r.ads_vnd || 0),
    }), { orders: 0, success: 0, returned: 0, in_transit: 0, dt_xuat_kho: 0, dt_thanh_cong: 0, dt_hoan: 0, dt_dang_giao: 0, cogs_xk: 0, cogs_tc: 0, cogs_hoan: 0, cogs_dang_giao: 0, ads_vnd: 0 });

    const grand = sumRows(data);

    const renderRow = (row: any, key: string, isTotal: boolean = false, isGrand: boolean = false) => {
        const sr = row.orders > 0 ? (row.success / row.orders * 100) : 0;
        const returnPct = row.orders > 0 ? (row.returned / row.orders * 100) : 0;
        const transitPct = row.orders > 0 ? (row.in_transit / row.orders * 100) : 0;
        const shipping = Math.round((row.dt_thanh_cong || 0) * 0.20);
        const adsShare = row.ads_vnd || 0;
        const totalCp = adsShare + (row.cogs_tc || 0) + shipping;
        const netPnl = (row.dt_thanh_cong || 0) - totalCp;
        const pctNet = row.dt_thanh_cong > 0 ? (netPnl / row.dt_thanh_cong * 100) : 0;

        const bgClass = isGrand
            ? "border-t-2 border-indigo-500/60 bg-indigo-100 dark:bg-indigo-500/20 font-bold text-foreground"
            : isTotal
                ? "bg-amber-100/80 dark:bg-amber-500/15 font-bold border-b-2 border-amber-400/50 text-foreground"
                : "hover:bg-gray-50/50 dark:hover:bg-gray-800/30";

        return (
            <tr key={key} className={cn("border-b border-border/40 text-xs", bgClass)}>
                <td className={cn("px-2 py-1.5", isTotal || isGrand ? "font-bold text-foreground" : "text-muted-foreground pl-6")}>
                    {isGrand ? "📊 TỔNG" : isTotal ? "Tất cả thị trường" : `● ${row.market}`}
                </td>
                <td className="px-2 py-1.5 text-right">{formatNumber(row.orders)}</td>
                {/* DT Thành Công — hover: DT Xuất Kho */}
                <td className="px-2 py-1.5 text-right">
                    <HoverTooltip content={
                        <div className="space-y-1">
                            <div className="flex justify-between gap-4"><span className="text-gray-400">DT Xuất Kho:</span><span className="text-amber-300 font-semibold">{formatMoney(row.dt_xuat_kho)}</span></div>
                            <div className="flex justify-between gap-4"><span className="text-gray-400">DT Thành Công:</span><span className="text-emerald-500 font-semibold">{formatMoney(row.dt_thanh_cong)}</span></div>
                            <div className="flex justify-between gap-4"><span className="text-gray-400">DT Hoàn:</span><span className="text-rose-500">{formatMoney(row.dt_hoan || 0)}</span></div>
                            <div className="flex justify-between gap-4"><span className="text-gray-400">DT Đang giao:</span><span className="text-cyan-500">{formatMoney(row.dt_dang_giao || 0)}</span></div>
                        </div>
                    }>
                        <span className="text-emerald-500 font-semibold border-b border-dotted border-emerald-500/40">{formatMoney(row.dt_thanh_cong)}</span>
                    </HoverTooltip>
                </td>
                {/* % Giao — hover: %Hoàn, %Đang giao */}
                <td className="px-2 py-1.5 text-right">
                    <HoverTooltip content={
                        <div className="space-y-1">
                            <div className="flex justify-between gap-4"><span className="text-gray-400">% Giao TC:</span><span className="text-emerald-500 font-semibold">{sr.toFixed(1)}% ({row.success}/{row.orders})</span></div>
                            <div className="flex justify-between gap-4"><span className="text-gray-400">% Hoàn:</span><span className="text-rose-500">{returnPct.toFixed(1)}% ({row.returned}/{row.orders})</span></div>
                            <div className="flex justify-between gap-4"><span className="text-gray-400">% Đang giao:</span><span className="text-cyan-500">{transitPct.toFixed(1)}% ({row.in_transit}/{row.orders})</span></div>
                        </div>
                    }>
                        <span className={cn("font-semibold border-b border-dotted", sr >= 50 ? "text-emerald-500 border-emerald-500/40" : sr >= 30 ? "text-amber-500 border-amber-500/40" : "text-rose-500 border-rose-400/40")}>
                            {sr.toFixed(1)}%
                        </span>
                    </HoverTooltip>
                </td>
                <td className="px-2 py-1.5 text-right text-amber-500">{formatMoney(adsShare)}</td>
                <td className={cn("px-2 py-1.5 text-right font-semibold", (row.dt_thanh_cong > 0 && adsShare / row.dt_thanh_cong <= 0.35) ? "text-emerald-500" : (row.dt_thanh_cong > 0 && adsShare / row.dt_thanh_cong <= 0.50) ? "text-amber-500" : "text-rose-500")}>
                    {row.dt_thanh_cong > 0 ? ((adsShare / row.dt_thanh_cong) * 100).toFixed(1) + "%" : "—"}
                </td>
                {/* Vốn Thực Bán — hover: Vốn XK, Hoàn, Đang giao */}
                <td className="px-2 py-1.5 text-right">
                    <HoverTooltip content={
                        <div className="space-y-1">
                            <div className="flex justify-between gap-4"><span className="text-gray-400">Vốn Xuất Kho:</span><span className="text-amber-300">{formatMoney(row.cogs_xk || 0)}</span></div>
                            <div className="flex justify-between gap-4"><span className="text-gray-400">Vốn Thực Bán:</span><span className="text-pink-500 font-semibold">{formatMoney(row.cogs_tc || 0)}</span></div>
                            <div className="flex justify-between gap-4"><span className="text-gray-400">Vốn Hoàn:</span><span className="text-rose-500">{formatMoney(row.cogs_hoan || 0)}</span></div>
                            <div className="flex justify-between gap-4"><span className="text-gray-400">Vốn Đang giao:</span><span className="text-cyan-500">{formatMoney(row.cogs_dang_giao || 0)}</span></div>
                        </div>
                    }>
                        <span className="text-pink-500 border-b border-dotted border-pink-400/40">{formatMoney(row.cogs_tc || 0)}</span>
                    </HoverTooltip>
                </td>
                <td className="px-2 py-1.5 text-right text-cyan-500">{formatMoney(shipping)}</td>
                <td className="px-2 py-1.5 text-right text-rose-500">{formatMoney(totalCp)}</td>
                <td className={cn("px-2 py-1.5 text-right font-bold", netPnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
                    {netPnl >= 0 ? "+" : ""}{formatMoney(netPnl)}
                </td>
                <td className={cn("px-2 py-1.5 text-right font-semibold", pctNet >= 0 ? "text-emerald-500" : "text-rose-500")}>
                    {pctNet.toFixed(1)}%
                </td>
            </tr>
        );
    };

    return (
        <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">📋 Monthly × Market P&L</h3>
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b-2 border-border text-muted-foreground">
                            <th className="px-2 pb-2 text-left font-medium">Tháng / Thị trường</th>
                            <th className="px-2 pb-2 text-right font-medium">Đơn</th>
                            <th className="px-2 pb-2 text-right font-medium">DT Thành Công</th>
                            <th className="px-2 pb-2 text-right font-medium">% Giao</th>
                            <th className="px-2 pb-2 text-right font-medium">Ads Spend</th>
                            <th className="px-2 pb-2 text-right font-medium">%ADS</th>
                            <th className="px-2 pb-2 text-right font-medium">Vốn Thực Bán</th>
                            <th className="px-2 pb-2 text-right font-medium">Shipping</th>
                            <th className="px-2 pb-2 text-right font-medium">Tổng CP</th>
                            <th className="px-2 pb-2 text-right font-medium">Net P&L</th>
                            <th className="px-2 pb-2 text-right font-medium">%Net Profit</th>
                        </tr>
                    </thead>
                    <tbody>
                        {months.map((month) => {
                            const rows = byMonth[month] || [];
                            const monthTotal = sumRows(rows);
                            return (
                                <React.Fragment key={month}>
                                    <tr className="bg-gray-100/80 dark:bg-gray-800/50">
                                        <td className="px-2 py-2 font-bold text-foreground text-xs" colSpan={11}>
                                            📅 {month}
                                        </td>
                                    </tr>
                                    {renderRow(monthTotal, `${month}-total`, true)}
                                    {rows.map((r: any) => renderRow(r, `${month}-${r.market}`))}
                                </React.Fragment>
                            );
                        })}
                        {renderRow(grand, 'grand-total', false, true)}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── CEO Filter Components ──

function CeoTimePicker({ presets, selected, onPreset, customFrom, customTo, onCustomFrom, onCustomTo, onApply }: any) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
    }, []);
    const label = selected === "Tùy chỉnh"
        ? `${customFrom.split("-").reverse().join("/")} - ${customTo.split("-").reverse().join("/")}`
        : selected;
    return (
        <div ref={ref} className="relative">
            <button onClick={() => setOpen(!open)} className="rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap bg-gray-800 border border-gray-600 text-white">
                📅 {label} <span style={{ fontSize: 8 }}>▼</span>
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-1 z-50 rounded-xl shadow-2xl overflow-hidden w-[260px] bg-gray-800 border border-gray-600">
                    <div className="p-1.5">
                        {presets.filter((p: any) => p.label !== "Tùy chỉnh").map((p: any) => (
                            <button key={p.label} onClick={() => { onPreset(p.label); setOpen(false); }}
                                className={cn("w-full text-left rounded-lg px-3 py-2 text-xs font-medium", selected === p.label ? "bg-blue-600 text-white" : "text-gray-200 hover:bg-gray-700")}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <div className="border-t border-gray-600" />
                    <div className="p-3 space-y-2.5">
                        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40">
                            <span className="text-amber-500 text-xs font-semibold">📅 Tùy chọn khoảng thời gian</span>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs w-8 text-gray-400">Từ</span>
                                <input type="date" value={customFrom} onChange={(e: any) => onCustomFrom(e.target.value)}
                                    className="flex-1 rounded-lg px-3 py-2 text-xs outline-none bg-gray-900 border border-gray-600 text-white" style={{ colorScheme: "dark" }} />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs w-8 text-gray-400">Đến</span>
                                <input type="date" value={customTo} onChange={(e: any) => onCustomTo(e.target.value)}
                                    className="flex-1 rounded-lg px-3 py-2 text-xs outline-none bg-gray-900 border border-gray-600 text-white" style={{ colorScheme: "dark" }} />
                            </div>
                        </div>
                        <button onClick={() => { onApply(); setOpen(false); }}
                            className="w-full rounded-lg py-2 text-xs font-semibold text-white" style={{ background: "linear-gradient(135deg, #f97316, #f43f5e)" }}>
                            Áp dụng
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function CeoMultiSelect({ label, options, selected, onChange, searchable }: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void; searchable?: boolean }) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
    }, []);
    const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v]);
    const btnLabel = selected.length === 0 ? `Tất cả ${label}` : `${label} (${selected.length})`;
    const filtered = searchable && search ? options.filter(o => o.toLowerCase().includes(search.toLowerCase())) : options;
    return (
        <div ref={ref} className="relative">
            <button onClick={() => setOpen(!open)}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap border",
                    selected.length > 0 ? "border-emerald-500 text-emerald-500 bg-gray-800" : "border-gray-600 text-white bg-gray-800")}>
                {btnLabel} <span style={{ fontSize: 8 }}>▼</span>
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-1 z-50 rounded-lg shadow-xl overflow-hidden min-w-[240px] bg-gray-800 border border-gray-600">
                    {searchable && (
                        <div className="p-2 border-b border-gray-700">
                            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                                placeholder="Tìm sản phẩm..."
                                className="w-full rounded px-2 py-1.5 text-xs bg-gray-900 border border-gray-600 text-white outline-none placeholder-gray-500" />
                        </div>
                    )}
                    <div className="max-h-[280px] overflow-y-auto">
                        <button onClick={() => onChange(selected.length === filtered.length ? [] : [...filtered])}
                            className="w-full text-left px-3 py-2 text-xs font-semibold text-blue-400 border-b border-gray-700 hover:bg-gray-700">
                            {selected.length === filtered.length ? "Bỏ chọn tất cả" : `Tất cả ${label}`}
                        </button>
                        {filtered.map(o => (
                            <label key={o} className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer text-gray-200 hover:bg-gray-700">
                                <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} style={{ accentColor: "#22c55e" }} />
                                <span>{o}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
