"use client";

import React, { useEffect, useState, useRef } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, Cell,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency as _fmtC, formatNumber, formatMoney as _fmtM, COLORS, cn } from "@/lib/utils";
import { DATASET, CURRENCY_TO_VND, REVENUE_COL, FX_TO_VND } from "../constants";

const formatCurrency = (v: number) => _fmtC(v, 1); // data already in VND
const formatMoney = (v: number) => _fmtM(v, 1);
import { queryCeoStock } from "@/lib/bq-queries";

const FX_CASE = `CASE order_currency WHEN 'SAR' THEN ${FX_TO_VND.SAR} WHEN 'AED' THEN ${FX_TO_VND.AED} WHEN 'KWD' THEN ${FX_TO_VND.KWD} WHEN 'AUD' THEN ${FX_TO_VND.AUD} WHEN 'VND' THEN 1 ELSE ${FX_TO_VND.USD} END`;
const TZ = "Asia/Ho_Chi_Minh";
async function runQ(q: string) {
    return fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }).then(r => r.json()).then(r => r.data || []).catch(() => []);
}
import TabSkeleton from "@/components/ui/tab-skeleton";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { resolveMarketerName, isRealMarketer } from "@/lib/marketer-map";
import {
    Crown, TrendingUp, TrendingDown, DollarSign,
    Users, Globe, Package, Target, Warehouse,
} from "lucide-react";

// ── Filter constants ──
const MARKETS_ALL = ["SA", "AE", "KW", "AU"];
const MKTERS_ALL = ["TUNGNT", "THACHTD", "NHATTM", "DUCNV", "VANDTH", "HUYENLT"];
const TIME_PRESETS = [
    { label: "Hôm nay", from: () => format(new Date(), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Hôm qua", from: () => { const d = new Date(); d.setDate(d.getDate() - 1); return format(d, "yyyy-MM-dd"); }, to: () => { const d = new Date(); d.setDate(d.getDate() - 1); return format(d, "yyyy-MM-dd"); } },
    { label: "7 ngày", from: () => { const d = new Date(); d.setDate(d.getDate() - 6); return format(d, "yyyy-MM-dd"); }, to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Tháng này", from: () => format(new Date(), "yyyy-MM-01"), to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Tháng trước", from: () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return format(d, "yyyy-MM-01"); }, to: () => { const d = new Date(); d.setDate(0); return format(d, "yyyy-MM-dd"); } },
    { label: "Tùy chỉnh", from: () => "", to: () => "" },
];

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
                const from = resolvedRange.from || (dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15");
                const to = resolvedRange.to || (dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"));

                const ds = DATASET;

                // Fetch product list for filter dropdown (once)
                if (productList.length === 0) {
                    runQ(`SELECT DISTINCT product_name FROM \`levelup-465304.${ds}.order_items\` WHERE product_name IS NOT NULL AND product_name != '' ORDER BY product_name`).then((rows: any[]) => {
                        setProductList(rows.map((r: any) => r.product_name));
                    });
                }

                // Build filters
                const currencyMap: Record<string,string> = { SA: "SAR", AE: "AED", KW: "KWD", AU: "AUD" };
                const marketFilter = appliedMarkets.length > 0
                    ? `AND s.order_currency IN (${appliedMarkets.map(m => `'${currencyMap[m] || m}'`).join(",")})`
                    : "";
                const mktFilter = appliedMkts.length > 0
                    ? `AND pm.marketer_id IN (${appliedMkts.map(m => `'${m}'`).join(",")})`
                    : "";
                const adsMarketFilter = appliedMarkets.length > 0
                    ? `AND UPPER(TRIM(SPLIT(campaign_name, '_')[SAFE_OFFSET(2)])) IN (${appliedMarkets.map(m => m === "SA" ? "'SA','KSA','KSA01'" : m === "AE" ? "'AE','UAE01'" : m === "KW" ? "'KW'" : "'AU'").join(",")})`
                    : "";
                const adsMktFilter = appliedMkts.length > 0
                    ? `AND campaign_mkter_code IN (${appliedMkts.map(m => `'${m}'`).join(",")})`
                    : "";

                // Q0: Direct KPIs from sale_order (multi-currency → VND)
                const directKpiData = await runQ(`
                    SELECT
                        COUNT(DISTINCT CASE WHEN s.status_category NOT IN ('HUY','DON_THO') THEN s.id END) as don_xk,
                        COUNT(DISTINCT CASE WHEN s.status_category = 'GIAO_THANH_CONG' THEN s.id END) as don_tc,
                        COUNT(DISTINCT s.id) as tong_don,
                        ROUND(SUM(CASE WHEN s.status_category NOT IN ('HUY','DON_THO') THEN CAST(s.cod AS FLOAT64) / 100.0 * (${FX_CASE}) ELSE 0 END), 0) as dt_xuat_kho,
                        ROUND(SUM(CASE WHEN s.status_category = 'GIAO_THANH_CONG' THEN CAST(s.cod AS FLOAT64) / 100.0 * (${FX_CASE}) ELSE 0 END), 0) as dt_thanh_cong
                    FROM \`levelup-465304.${ds}.sale_order\` s
                    LEFT JOIN \`levelup-465304.${ds}.page_marketer\` pm ON s.page_id = pm.page_id
                    WHERE DATE(TIMESTAMP(s.inserted_at), '${TZ}') BETWEEN '${from}' AND '${to}' ${marketFilter} ${mktFilter}`);

                // Q1: Ads spend (USD → VND)
                const adsData = await runQ(`SELECT ROUND(SUM(spend_usd) * ${FX_TO_VND.USD}, 0) as ads_vnd
                    FROM \`levelup-465304.${ds}.vw_fact_ads_performance\`
                    WHERE report_date BETWEEN '${from}' AND '${to}' ${adsMarketFilter} ${adsMktFilter}`);

                const kpi = directKpiData[0] || {};
                const adsVndTotal = adsData[0]?.ads_vnd || 0;

                // Q2: Marketer P&L from sale_order + page_marketer
                const mkterPnlRows = await runQ(`
                    SELECT
                        COALESCE(pm.marketer_id, 'UNKNOWN') as mkter,
                        COUNT(DISTINCT s.id) as orders,
                        COUNT(DISTINCT CASE WHEN s.status_category='GIAO_THANH_CONG' THEN s.id END) as success,
                        COUNT(DISTINCT CASE WHEN s.status_category='DON_HOAN' THEN s.id END) as returned,
                        ROUND(SUM(CASE WHEN s.status_category NOT IN ('HUY','DON_THO') THEN CAST(s.cod AS FLOAT64) / 100.0 * (${FX_CASE}) ELSE 0 END), 0) as revenue,
                        ROUND(SUM(CASE WHEN s.status_category='GIAO_THANH_CONG' THEN CAST(s.cod AS FLOAT64) / 100.0 * (${FX_CASE}) ELSE 0 END), 0) as revenue_tc
                    FROM \`levelup-465304.${ds}.sale_order\` s
                    LEFT JOIN \`levelup-465304.${ds}.page_marketer\` pm ON s.page_id = pm.page_id
                    WHERE DATE(TIMESTAMP(s.inserted_at), '${TZ}') BETWEEN '${from}' AND '${to}'
                        AND s.status_category NOT IN ('HUY','DON_THO')
                        ${marketFilter} ${mktFilter}
                    GROUP BY 1 ORDER BY revenue DESC`);

                // Q3: Ads per marketer (USD → VND)
                const adsPerMkt = await runQ(`SELECT
                    campaign_mkter_code as mkter_code,
                    ROUND(SUM(spend_usd) * ${FX_TO_VND.USD}, 0) as ads_vnd
                    FROM \`levelup-465304.${ds}.vw_fact_ads_performance\`
                    WHERE report_date BETWEEN '${from}' AND '${to}' ${adsMarketFilter} ${adsMktFilter}
                    GROUP BY 1`);

                // Q4: Market performance from sale_order
                const marketRows = await runQ(`SELECT
                    CASE s.order_currency WHEN 'SAR' THEN 'KSA' WHEN 'AED' THEN 'UAE' WHEN 'KWD' THEN 'Kuwait' WHEN 'AUD' THEN 'Australia' ELSE 'Other' END as market,
                    COUNT(DISTINCT s.id) as orders,
                    COUNT(DISTINCT CASE WHEN s.status_category='GIAO_THANH_CONG' THEN s.id END) as success,
                    ROUND(SUM(CASE WHEN s.status_category NOT IN ('HUY','DON_THO') THEN CAST(s.cod AS FLOAT64) / 100.0 * (${FX_CASE}) ELSE 0 END), 0) as revenue
                    FROM \`levelup-465304.${ds}.sale_order\` s
                    WHERE DATE(TIMESTAMP(s.inserted_at), '${TZ}') BETWEEN '${from}' AND '${to}'
                        AND s.status_category NOT IN ('HUY','DON_THO') AND s.order_currency != 'VND'
                        ${marketFilter}
                    GROUP BY 1 ORDER BY revenue DESC`);

                // Q5: Stock
                const stockRows = await runQ(queryCeoStock(ds));

                // Build ads map by marketer code
                const adsByCode = new Map<string, number>();
                adsPerMkt.forEach((row: any) => {
                    const code = resolveMarketerName(row.mkter_code || "");
                    adsByCode.set(code, (adsByCode.get(code) || 0) + (row.ads_vnd || 0));
                });

                // Build marketer list
                const mergedMarketers: MarketerRank[] = [];
                const seenNames = new Set<string>();
                mkterPnlRows.forEach((m: any) => {
                    const code = (m.mkter || "").toUpperCase();
                    const name = resolveMarketerName(code);
                    if (!isRealMarketer(name) && (m.orders || 0) === 0) return;
                    const adsVnd = adsByCode.get(name) || 0;
                    adsByCode.delete(name); // consumed
                    const revenue = m.revenue || 0;
                    const revenueTc = m.revenue_tc || 0;
                    const shipping = Math.round(revenue * 0.20);
                    const roas = adsVnd > 0 ? Math.round((revenue / adsVnd) * 100) / 100 : 0;
                    const sr = m.orders > 0 ? Math.round((m.success / m.orders) * 1000) / 10 : 0;
                    const netPnl = revenueTc - adsVnd - Math.round(revenueTc * 0.20);
                    const lnTamTinh = revenue * 0.65 - adsVnd - shipping;
                    seenNames.add(name);
                    mergedMarketers.push({
                        marketer_name: name,
                        orders: m.orders || 0, success: m.success || 0, returned: m.returned || 0,
                        revenue, ads_spend: adsVnd, cogs: 0, shipping,
                        net_profit: netPnl, roas, sr,
                        revenue_tc: revenueTc, ln_tam_tinh: lnTamTinh,
                    } as any);
                });
                // Add ads-only marketers (no orders)
                adsByCode.forEach((adsVnd, name) => {
                    if (seenNames.has(name) || adsVnd === 0) return;
                    if (!isRealMarketer(name)) return;
                    mergedMarketers.push({
                        marketer_name: name, orders: 0, success: 0, returned: 0,
                        revenue: 0, ads_spend: adsVnd, cogs: 0, shipping: 0,
                        net_profit: -adsVnd, roas: 0, sr: 0,
                        revenue_tc: 0, ln_tam_tinh: -adsVnd,
                    } as any);
                });
                mergedMarketers.sort((a, b) => b.revenue - a.revenue);
                setMarketers(mergedMarketers);

                // Monthly PnL (for KPI cards)
                const dtXk = kpi.dt_xuat_kho || 0;
                const dtTc = kpi.dt_thanh_cong || 0;
                setMonthly([{
                    month: format(new Date(from), "yyyy-MM"),
                    orders: kpi.don_xk || 0, success: kpi.don_tc || 0, returned: 0,
                    revenue: dtXk, ads_spend: adsVndTotal, cogs: 0, shipping: Math.round(dtXk * 0.20),
                    net_profit: dtTc - adsVndTotal - Math.round(dtTc * 0.20),
                }]);

                setProducts([]);
                setMarkets(marketRows.map((m: any) => ({
                    market: m.market, orders: m.orders, success: m.success,
                    sr: m.orders > 0 ? Math.round(m.success / m.orders * 1000) / 10 : 0,
                    revenue: m.revenue, ads_spend: 0, roas: 0, cpa: 0,
                })));
                setStock(stockRows);

            } catch (error) {
                console.error("CEO Overview fetch error:", error);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [timePreset, customFrom, customTo, refreshKey]);

    if (loading) {
        return <TabSkeleton cards={6} showChart={true} rows={5} />;
    }

    // Aggregates from monthly (now direct from sale_order)
    const m0 = monthly[0] || { revenue: 0, ads_spend: 0, cogs: 0, shipping: 0, net_profit: 0, orders: 0, success: 0 };
    const totals = {
        revenue: m0.revenue,
        ads: m0.ads_spend,
        cogs: m0.cogs,
        shipping: m0.shipping,
        net: m0.net_profit,
        orders: m0.orders,
        success: m0.success,
    };

    const overallRoas = totals.ads > 0 ? (totals.revenue / totals.ads) : 0;
    const overallMargin = totals.revenue > 0 ? ((totals.net / totals.revenue) * 100) : 0;

    return (
        <div className="space-y-6">
            {/* ── Filter Bar (sticky) ── */}
            <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-[#0f172a] px-5 py-3">
                <div className="flex items-center gap-1.5 mr-2">
                    <span className="text-base">📈</span>
                    <span className="font-bold text-base text-white">Tổng Quan</span>
                    <span className="font-bold text-base text-indigo-400">HNLE</span>
                </div>
                <div className="flex-1" />

                <CeoTimePicker presets={TIME_PRESETS} selected={timePreset}
                    onPreset={(l: string) => { setTimePreset(l); if (l !== "Tùy chỉnh") setRefreshKey(k => k + 1); }}
                    customFrom={customFrom} customTo={customTo}
                    onCustomFrom={setCustomFrom} onCustomTo={setCustomTo}
                    onApply={() => { setTimePreset("Tùy chỉnh"); setRefreshKey(k => k + 1); }} />

                <CeoMultiSelect label="Tất cả Thị trường" options={MARKETS_ALL} selected={selMarkets} onChange={setSelMarkets} />
                <CeoMultiSelect label="Tất cả MKT" options={MKTERS_ALL} selected={selMkts} onChange={setSelMkts} />
                <CeoMultiSelect label="Tất cả Sản phẩm" options={productList} selected={selProducts} onChange={setSelProducts} searchable />

                <button onClick={applyFilters}
                    className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white bg-emerald-500 hover:opacity-90">
                    Lọc
                </button>
                <ThemeToggle />
            </div>

            {/* KPI Row */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard
                    title="💰 Tổng Doanh Thu"
                    value={formatCurrency(totals.revenue)}
                    icon={DollarSign}
                    status={totals.revenue > 0 ? "success" : "neutral"}
                    subValue={`${formatNumber(totals.orders)} đơn`}
                />
                <KPICard
                    title="📊 Lãi/Lỗ Ròng"
                    value={formatCurrency(totals.net)}
                    icon={totals.net >= 0 ? TrendingUp : TrendingDown}
                    status={totals.net >= 0 ? "success" : "danger"}
                    subValue={`Margin: ${overallMargin.toFixed(1)} % `}
                />
                <KPICard
                    title="📦 Đơn / Thành công"
                    value={`${formatNumber(totals.success)
                        } / ${formatNumber(totals.orders)}`}
                    icon={Package}
                    status="neutral"
                    subValue={`SR: ${totals.orders > 0 ? ((totals.success / totals.orders) * 100).toFixed(1) : 0}%`}
                />
                < KPICard
                    title="🎯 ROAS"
                    value={`${overallRoas.toFixed(2)}x`}
                    icon={Target}
                    status={overallRoas >= 2.5 ? "success" : overallRoas >= 1.5 ? "warning" : "danger"}
                    subValue={`Ads: ${formatCurrency(totals.ads)}`}
                />
                < KPICard
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
            </div >

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
                        <div className="mt-1 text-lg font-bold text-pink-500">{formatCurrency(totals.cogs)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Shipping</div>
                        <div className="mt-1 text-lg font-bold text-cyan-500">{formatCurrency(totals.shipping)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Tổng CP</div>
                        <div className="mt-1 text-lg font-bold text-rose-500">{formatCurrency(totals.ads + totals.cogs + totals.shipping)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Net P&L</div>
                        <div className={cn("mt-1 text-lg font-bold", totals.net >= 0 ? "text-emerald-500" : "text-rose-500")}>
                            {formatCurrency(totals.net)}
                        </div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">%Net Profit</div>
                        <div className={cn("mt-1 text-lg font-bold", overallMargin >= 20 ? "text-emerald-500" : overallMargin >= 0 ? "text-amber-500" : "text-rose-500")}>
                            {totals.revenue > 0 ? `${overallMargin.toFixed(1)}%` : "—"}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Marketer P&L Detail (full width) ── */}
            <div className="rounded-lg border border-border bg-card p-4">
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
                                const revenueTc = m.revenue_tc || 0;
                                const dtUocTinh = Math.round(m.revenue * 0.65);
                                const lnTamTinh = m.ln_tam_tinh || 0;
                                const pctAds = revenueTc > 0 ? ((m.ads_spend / revenueTc) * 100) : 0;
                                const pctNet = revenueTc > 0 ? ((m.net_profit / revenueTc) * 100) : 0;
                                return (
                                    <tr key={m.marketer_name} className="border-b border-border/60 hover:bg-gray-50/50">
                                        <td className="px-2 py-2 font-medium text-foreground sticky left-0 bg-card z-10">{m.marketer_name}</td>
                                        <td className="px-2 py-2 text-right">{formatNumber(m.orders)}</td>
                                        <td className="px-2 py-2 text-right">{formatNumber(m.success)}</td>
                                        <td className={cn("px-2 py-2 text-right", m.returned > 0 ? "text-rose-500" : "")}>{formatNumber(m.returned)}</td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", m.sr >= 45 ? "text-emerald-500" : m.sr >= 30 ? "text-amber-500" : "text-rose-500")}>{m.sr}%</td>
                                        <td className="px-2 py-2 text-right font-semibold text-emerald-500">{formatMoney(m.revenue)}</td>
                                        <td className="px-2 py-2 text-right text-blue-400">{formatMoney(dtUocTinh)}</td>
                                        <td className="px-2 py-2 text-right text-teal-400">{formatMoney(revenueTc)}</td>
                                        <td className="px-2 py-2 text-right text-amber-500">{formatMoney(m.ads_spend)}</td>
                                        <td className="px-2 py-2 text-right text-orange-500">{formatMoney(m.cogs)}</td>
                                        <td className="px-2 py-2 text-right text-pink-500">0</td>
                                        <td className="px-2 py-2 text-right text-cyan-500">{formatMoney(m.shipping)}</td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", lnTamTinh >= 0 ? "text-violet-400" : "text-rose-500")}>
                                            {lnTamTinh >= 0 ? "+" : ""}{formatMoney(lnTamTinh)}
                                        </td>
                                        <td className={cn("px-2 py-2 text-right font-bold", m.net_profit >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                            {m.net_profit >= 0 ? "+" : ""}{formatMoney(m.net_profit)}
                                        </td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", pctAds <= 25 ? "text-emerald-500" : pctAds <= 40 ? "text-amber-500" : "text-rose-500")}>
                                            {pctAds > 0 ? `${pctAds.toFixed(1)}%` : "—"}
                                        </td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", pctNet >= 20 ? "text-emerald-500" : pctNet >= 0 ? "text-amber-500" : "text-rose-500")}>
                                            {revenueTc > 0 ? `${pctNet.toFixed(1)}%` : "—"}
                                        </td>
                                    </tr>
                                );
                            })}
                            {/* TỔNG row */}
                            {(() => {
                                const t = marketers.reduce((a: any, m: any) => ({
                                    orders: a.orders + m.orders, success: a.success + m.success, returned: a.returned + m.returned,
                                    revenue: a.revenue + m.revenue, revenue_tc: a.revenue_tc + (m.revenue_tc || 0),
                                    ads: a.ads + m.ads_spend, cogs: a.cogs + m.cogs,
                                    shipping: a.shipping + m.shipping, ln_tam_tinh: a.ln_tam_tinh + (m.ln_tam_tinh || 0),
                                    net: a.net + m.net_profit,
                                }), { orders: 0, success: 0, returned: 0, revenue: 0, revenue_tc: 0, ads: 0, cogs: 0, shipping: 0, ln_tam_tinh: 0, net: 0 });
                                const sr = t.orders > 0 ? Math.round(t.success / t.orders * 1000) / 10 : 0;
                                const tDtUocTinh = Math.round(t.revenue * 0.65);
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
                                        <td className="px-2 py-2 text-right text-blue-400">{formatMoney(tDtUocTinh)}</td>
                                        <td className="px-2 py-2 text-right text-teal-400">{formatMoney(t.revenue_tc)}</td>
                                        <td className="px-2 py-2 text-right text-amber-500">{formatMoney(t.ads)}</td>
                                        <td className="px-2 py-2 text-right text-orange-500">{formatMoney(t.cogs)}</td>
                                        <td className="px-2 py-2 text-right text-pink-500">0</td>
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
            </div>

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
                        <Bar dataKey="shipping" name="Shipping" fill="#06b6d4" radius={[4, 4, 0, 0]} />
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
                                <th className="px-3 pb-2 text-right font-medium">Shipping</th>
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

            {/* ── Stock / Inventory ── */}
            < div className="rounded-xl border border-border bg-gray-50 p-5" >
                <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-foreground">
                    <Warehouse className="h-5 w-5 text-cyan-400" /> Tồn Kho (POS)
                </h3>
                {
                    stock.length === 0 ? (
                        <p className="text-sm text-gray-400 italic">Chưa có dữ liệu tồn kho — đang chờ sync từ POS webhook.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border text-left text-xs uppercase text-gray-400">
                                        <th className="px-3 py-2">Mã SP</th>
                                        <th className="px-3 py-2">Tên sản phẩm</th>
                                        <th className="px-3 py-2 text-right">Tồn kho</th>
                                        <th className="px-3 py-2 text-right">Biến thể</th>
                                        <th className="px-3 py-2 text-right">GT Bán lẻ</th>
                                        <th className="px-3 py-2 text-center">Trạng thái</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stock.map((s: any, i: number) => {
                                        const qty = s.stock_qty || 0;
                                        const status = qty <= 0 ? { label: "Hết hàng", color: "bg-rose-500/20 text-rose-400" }
                                            : qty <= 5 ? { label: "Sắp hết", color: "bg-amber-500/20 text-amber-400" }
                                                : qty <= 20 ? { label: "Trung bình", color: "bg-blue-500/20 text-blue-400" }
                                                    : { label: "Đủ hàng", color: "bg-emerald-500/20 text-emerald-400" };
                                        return (
                                            <tr key={i} className="border-b border-white/5 hover:bg-gray-50">
                                                <td className="px-3 py-2 font-mono text-emerald-300">{s.product_code}</td>
                                                <td className="px-3 py-2 text-foreground">{s.product_name}</td>
                                                <td className="px-3 py-2 text-right font-bold text-foreground">{formatNumber(qty)}</td>
                                                <td className="px-3 py-2 text-right text-gray-400">{s.variations}</td>
                                                <td className="px-3 py-2 text-right text-cyan-400">{formatMoney(s.retail_value)}</td>
                                                <td className="px-3 py-2 text-center">
                                                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", status.color)}>
                                                        {status.label}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )
                }
            </div >

        </div >
    );
}

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
    const btnLabel = selected.length === 0 ? label : `${label} (${selected.length})`;
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
