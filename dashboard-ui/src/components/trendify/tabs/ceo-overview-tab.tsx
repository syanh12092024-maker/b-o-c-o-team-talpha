"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, Cell,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency as _fmtC, formatNumber, formatMoney as _fmtM, COLORS, cn } from "@/lib/utils";
import { DATASET, CURRENCY_TO_VND, REVENUE_COL } from "../constants";

const formatCurrency = (v: number) => _fmtC(v, CURRENCY_TO_VND);
const formatMoney = (v: number) => _fmtM(v, CURRENCY_TO_VND);
import { queryCeoMonthlyPnl, queryCeoMarketerPnl, queryCeoProductRanking, queryCeoMarketRanking, queryCeoAdsByMarketer, queryCeoStock } from "@/lib/bq-queries";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { resolveMarketerName, isRealMarketer } from "@/lib/marketer-map";
import {
    Crown, TrendingUp, TrendingDown, DollarSign,
    Users, Globe, Package, Target, Warehouse,
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


    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    queryCeoMonthlyPnl(DATASET, from, to, REVENUE_COL),      // Q0
                    queryCeoMarketerPnl(DATASET, from, to, REVENUE_COL),      // Q1
                    queryCeoProductRanking(DATASET, from, to),   // Q2
                    queryCeoMarketRanking(DATASET, from, to, ['RO','US','HR','IT','BG']),    // Q3
                    queryCeoAdsByMarketer(DATASET, from, to),    // Q4
                    queryCeoStock(DATASET),                       // Q5
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

                // Merge marketer P&L with real ads, using CANONICAL names
                const mkterPnl = results[1].data || [];
                const adsPerCode = results[4]?.data || [];
                const adsByName = new Map<string, number>();
                adsPerCode.forEach((row: any) => {
                    const name = resolveMarketerName(row.mkter_code || "");
                    if (!isRealMarketer(name)) return;
                    adsByName.set(name, (adsByName.get(name) || 0) + (row.ads_spend || 0));
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
                setMarkets(results[3].data || []);
                setStock(results[5]?.data || []);

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

    // Override ads with total from marketer table (vw_fact_ads_performance)
    // because mart misses ~50% of ad spend through unmatched campaigns
    const realAdsTotal = marketers.reduce((s, m) => s + m.ads_spend, 0);
    totals.ads = realAdsTotal;
    totals.net = totals.revenue - totals.cogs - totals.shipping - totals.ads;

    const overallRoas = totals.ads > 0 ? (totals.revenue / totals.ads) : 0;
    const overallMargin = totals.revenue > 0 ? ((totals.net / totals.revenue) * 100) : 0;

    return (
        <div className="space-y-6">
            {/* KPI Row */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard
                    title="💰 Tổng Doanh Thu"
                    value={formatCurrency(totals.revenue)}
                    icon={DollarSign}
                    status={totals.revenue > 0 ? "success" : "neutral"}
                    subValue={`${monthly.length} tháng data`}
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
            < div className="rounded-lg border border-border bg-card p-4" >
                <h3 className="mb-3 text-sm font-semibold text-foreground">💸 Chi phí chi tiết</h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Ads Spend</div>
                        <div className="mt-1 text-lg font-bold text-amber-400">{formatCurrency(totals.ads)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">COGS</div>
                        <div className="mt-1 text-lg font-bold text-orange-400">{formatCurrency(totals.cogs)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Shipping</div>
                        <div className="mt-1 text-lg font-bold text-cyan-400">{formatCurrency(totals.shipping)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Tổng CP</div>
                        <div className="mt-1 text-lg font-bold text-rose-400">{formatCurrency(totals.ads + totals.cogs + totals.shipping)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Lãi ròng</div>
                        <div className={cn("mt-1 text-lg font-bold", totals.net >= 0 ? "text-emerald-400" : "text-rose-400")}>
                            {formatCurrency(totals.net)}
                        </div>
                    </div>
                </div>
            </div >

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
                                <th className="px-2 pb-2 text-right font-medium">Shipping</th>
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
