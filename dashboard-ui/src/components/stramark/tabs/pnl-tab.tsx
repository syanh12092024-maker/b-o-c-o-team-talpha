"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ReferenceLine, AreaChart, Area, Cell,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { formatCurrency, formatMoney, COLORS, cn, USD_TO_VND, RON_TO_VND, EUR_TO_VND } from "@/lib/utils";
import ExchangeRateBanner from "@/components/stramark/exchange-rate-banner";
import { DATASET } from "../constants";
import {
    queryPnlDailyFromMart,
    queryPnlDailyCogs,
    queryPnlDailyActual,
    queryPnlDailyActualCogs,
    queryPnlDailyAds,
    queryPnlDailyFfmActual,
    queryPnlProductForecast,
} from "@/lib/bq-queries";
import { DollarSign, TrendingUp, Truck, Package, Download, TrendingDown, Activity } from "lucide-react";

interface PnLTabProps { dateRange?: { from: Date; to: Date }; }

function bq(query: string) {
    return fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
    }).then((r) => r.json()).catch(() => ({ data: [] }));
}

function fmtDelta(v: number) {
    if (v === 0) return <span className="text-muted-foreground text-[10px]">—</span>;
    const pos = v > 0;
    return (
        <span className={cn("text-[10px] font-medium", pos ? "text-emerald-500" : "text-rose-500")}>
            {pos ? "▲" : "▼"} {formatMoney(Math.abs(v))}
        </span>
    );
}
function fmtDeltaPct(actual: number, est: number) {
    if (est === 0) return null;
    const pct = ((actual - est) / Math.abs(est)) * 100;
    const pos = pct >= 0;
    return (
        <span className={cn("ml-1 text-[10px] font-medium", pos ? "text-emerald-500" : "text-rose-500")}>
            ({pos ? "+" : ""}{pct.toFixed(0)}%)
        </span>
    );
}

export default function PnLTab({ dateRange }: PnLTabProps) {
    const [loading, setLoading] = useState(true);
    const [activeView, setActiveView] = useState<"forecast" | "actual">("forecast");
    const [deliveryRate, setDeliveryRate] = useState(0);
    const [ffmPerOrder, setFfmPerOrder] = useState(0);
    const [daily, setDaily] = useState<any[]>([]);
    const [summary, setSummary] = useState({ revenue: 0, cogs: 0, ads: 0, ffm: 0, profit: 0, margin: 0 });
    const [waterfall, setWaterfall] = useState<any[]>([]);
    const [productPnl, setProductPnl] = useState<any[]>([]);
    const [productSortBy, setProductSortBy] = useState<string>("est_revenue");
    const [productSortAsc, setProductSortAsc] = useState(false);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2024-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const [mainRes, fcastCogsRes, actualRes, actualCogsRes, adsRes, ffmActualRes, productPnlRes] = await Promise.all([
                    bq(queryPnlDailyFromMart(DATASET, from, to)),
                    bq(queryPnlDailyCogs(DATASET, from, to)),
                    bq(queryPnlDailyActual(DATASET, from, to)),
                    bq(queryPnlDailyActualCogs(DATASET, from, to)),
                    bq(queryPnlDailyAds(DATASET, from, to)),
                    bq(queryPnlDailyFfmActual(DATASET, from, to)),
                    bq(queryPnlProductForecast(DATASET, from, to)),
                ]);

                // Build lookup maps
                const fcogsMap = new Map<string, number>();
                (fcastCogsRes.data || []).forEach((r: any) => fcogsMap.set(r.report_date?.value || r.report_date || "", r.cogs || 0));

                const actualMap = new Map<string, { orders: number; revenue: number }>();
                (actualRes.data || []).forEach((r: any) => actualMap.set(r.report_date?.value || r.report_date || "", {
                    orders: r.actual_orders || 0, revenue: r.actual_revenue || 0,
                }));

                const acogsMap = new Map<string, number>();
                (actualCogsRes.data || []).forEach((r: any) => acogsMap.set(r.report_date?.value || r.report_date || "", r.actual_cogs || 0));

                // Ads: query returns USD, convert to VND directly (not via RON)
                const adsMap = new Map<string, number>();
                (adsRes.data || []).forEach((r: any) => {
                    const usd = r.ads_usd || 0;
                    adsMap.set(r.report_date?.value || r.report_date || "", Math.round(usd * USD_TO_VND / RON_TO_VND));
                    // Store as "fake RON" so formatMoney(×RON_TO_VND) produces correct VND
                });

                // Fallback: detect dates with missing ads in BQ → fill from Meta API
                const allDates = (mainRes.data || []).map((r: any) => r.report_date?.value || r.report_date || "");
                const missingAdsDates = allDates.filter((d: string) => d && !adsMap.has(d));
                if (missingAdsDates.length > 0) {
                    try {
                        const fbRes = await fetch(`/api/stramark/ads-daily?from_date=${from}&to_date=${to}`).then(r => r.json());
                        (fbRes.data || []).forEach((r: any) => {
                            const d = r.date || "";
                            if (d && !adsMap.has(d)) {
                                adsMap.set(d, Math.round((r.spend_usd || 0) * USD_TO_VND / RON_TO_VND));
                            }
                        });
                    } catch { /* BQ data wins, Meta fallback is best-effort */ }
                }

                // FFM actual from ffm_shipments (incl VAT, in RON)
                const ffmActualMap = new Map<string, number>();
                (ffmActualRes.data || []).forEach((r: any) => ffmActualMap.set(r.report_date?.value || r.report_date || "", r.ffm_actual_ron || 0));

                // DR + FFM per order from first row (same for all rows)
                const rows = mainRes.data || [];
                const dr = rows.length > 0 ? (rows[0].delivery_rate_pct || 0) / 100 : 0;
                setDeliveryRate(rows.length > 0 ? rows[0].delivery_rate_pct || 0 : 0);
                setFfmPerOrder(rows.length > 0 ? rows[0].ffm_per_order_eur || 0 : 0);

                let totRev = 0, totCogs = 0, totAds = 0, totFfm = 0, totProfit = 0;

                const dailyRows = rows.map((r: any) => {
                    const date = r.report_date?.value || r.report_date || "";
                    const orders = r.total_orders || 0;
                    const revenue = r.revenue || 0;
                    const estOrders = r.est_success_orders || 0;
                    const estRevenue = r.est_revenue || 0;
                    const rawCogs = fcogsMap.get(date) || 0;
                    const fcastCogs = Math.round(rawCogs * dr);   // COGS × DR
                    const ffm = r.ffm || 0;
                    const ads = adsMap.get(date) || 0;
                    const fcastProfit = estRevenue - fcastCogs - ffm - ads;
                    const fcastMargin = estRevenue > 0 ? (fcastProfit / estRevenue) * 100 : 0;

                    const act = actualMap.get(date) || { orders: 0, revenue: 0 };
                    const actualCogs = acogsMap.get(date) || 0;
                    const ffmActual = ffmActualMap.get(date) || 0;  // actual 3PL from ffm_shipments
                    const actualProfit = act.revenue - actualCogs - ffmActual - ads;
                    const actualMargin = act.revenue > 0 ? (actualProfit / act.revenue) * 100 : 0;

                    totRev += estRevenue;
                    totCogs += fcastCogs;
                    totAds += ads;
                    totFfm += ffm;
                    totProfit += fcastProfit;

                    return {
                        date: String(date).slice(0, 10),
                        // Forecast
                        orders, estOrders, revenue, estRevenue,
                        fcastCogs, ffm, ads, fcastProfit, fcastMargin,
                        // Actual
                        actualOrders: act.orders,
                        actualRevenue: act.revenue,
                        actualCogs,
                        ffmActual,
                        actualProfit,
                        actualMargin,
                    };
                });

                setDaily(dailyRows);
                const totalMargin = totRev > 0 ? (totProfit / totRev) * 100 : 0;
                setSummary({ revenue: totRev, cogs: totCogs, ads: totAds, ffm: totFfm, profit: totProfit, margin: totalMargin });
                setWaterfall([
                    { name: "Rev TC", value: totRev, fill: COLORS.emerald },
                    { name: "COGS", value: -totCogs, fill: COLORS.rose },
                    { name: "Ads", value: -totAds, fill: COLORS.amber },
                    { name: "3PL/FFM", value: -totFfm, fill: "#a78bfa" },
                    { name: "Lợi nhuận", value: totProfit, fill: totProfit > 0 ? COLORS.emerald : COLORS.rose },
                ]);
                setProductPnl(productPnlRes.data || []);
            } catch (e) {
                console.error("P&L fetch error", e);
            } finally {
                setLoading(false);
            }
        }
        if (dateRange?.from && dateRange?.to) fetchData();
    }, [dateRange]);

    const downloadCSV = () => {
        const headers = activeView === "forecast"
            ? ["Date", "Orders↑", "TC Dự kiến", "Rev↑", "Rev TC dự kiến", "COGS(est)", "3PL/FFM", "Ads", "Profit(est)", "Margin"]
            : ["Date", "Orders TC", "Revenue", "COGS", "3PL/FFM", "Ads", "Profit", "Margin"];
        const rows = daily.map(r => activeView === "forecast"
            ? [r.date, r.orders, r.estOrders, r.revenue, r.estRevenue, r.fcastCogs, r.ffm, r.ads, r.fcastProfit, r.fcastMargin.toFixed(1) + "%"]
            : [r.date, r.actualOrders, r.actualRevenue, r.actualCogs, r.ffmActual, r.ads, r.actualProfit, r.actualMargin.toFixed(1) + "%"]
        ).map(row => row.join(","));
        const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
        const a = document.createElement("a");
        a.href = encodeURI(csv);
        a.download = `pnl_${activeView}_${format(new Date(), "yyyyMMdd")}.csv`;
        a.click();
    };

    // ── Product P&L sort ──
    const handleProductSort = (key: string) => {
        if (productSortBy === key) setProductSortAsc(!productSortAsc);
        else { setProductSortBy(key); setProductSortAsc(false); }
    };
    const sortedProductPnl = [...productPnl].sort((a, b) => {
        const va = a[productSortBy] || 0;
        const vb = b[productSortBy] || 0;
        return productSortAsc ? va - vb : vb - va;
    });

    if (loading) return <TabSkeleton cards={4} showChart={true} rows={5} />;

    return (
        <div className="space-y-6">
            <ExchangeRateBanner />
            {/* ─── KPI Summary (Forecast) ─────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <KPICard title="Rev TC dự kiến" value={formatCurrency(summary.revenue)} icon={DollarSign} status="success"
                    subValue={`DR: ${deliveryRate.toFixed(1)}%`} />
                <KPICard title="COGS dự kiến" value={formatCurrency(summary.cogs)} icon={Package}
                    subValue="Trên đơn thành công" />
                <KPICard title="Ad Spend" value={formatCurrency(summary.ads)} icon={TrendingUp} status="warning" />
                <KPICard title="3PL/FFM ước tính" value={formatCurrency(summary.ffm)} icon={Truck}
                    subValue={`~${ffmPerOrder.toFixed(2)} EUR/đơn (thực tế)`} />
                <KPICard title="Lợi nhuận dự kiến" value={formatCurrency(summary.profit)}
                    subValue={`Margin: ${summary.margin.toFixed(1)}%`}
                    status={summary.margin > 20 ? "success" : summary.margin > 0 ? "warning" : "danger"}
                    icon={DollarSign} />
            </div>

            {/* ─── Charts ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-6">
                    <h3 className="section-header">📊 Cost Structure (Dự đoán)</h3>
                    <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={waterfall}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                <XAxis dataKey="name" stroke="#888" fontSize={11} />
                                <YAxis stroke="#888" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                                <Tooltip contentStyle={{ backgroundColor: "#1e1e2e" }} formatter={(v: number) => formatCurrency(v)} />
                                <ReferenceLine y={0} stroke="#666" />
                                <Bar dataKey="value" radius={[4, 4, 4, 4]}>
                                    {waterfall.map((e, i) => <Cell key={i} fill={e.fill} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-6">
                    <h3 className="section-header">📈 Rev TC dự kiến vs Thực tế</h3>
                    <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={[...daily].reverse()} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
                                <defs>
                                    <linearGradient id="gradEst" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={COLORS.emerald} stopOpacity={0.7} />
                                        <stop offset="95%" stopColor={COLORS.emerald} stopOpacity={0.2} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis dataKey="date" stroke="#888" fontSize={10} tickFormatter={(v) => String(v).slice(5)} minTickGap={20} />
                                <YAxis stroke="#888" fontSize={10} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                                <Tooltip contentStyle={{ backgroundColor: "#1e1e2e" }} formatter={(v: number, name: string) => [formatCurrency(v), name]} />
                                <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                                <Bar dataKey="estRevenue" name="Rev TC dự kiến" fill={COLORS.emerald} opacity={0.6} radius={[2, 2, 0, 0]} />
                                <Bar dataKey="actualRevenue" name="Rev thực tế" fill="#38bdf8" opacity={0.9} radius={[2, 2, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* ─── Daily Breakdown Table with Forecast / Actual toggle ─────── */}
            <div className="rounded-xl border border-border bg-card p-5">
                {/* Section header + toggle */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            📅 Daily P&L Breakdown
                        </h3>
                        {/* DR badge */}
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 dark:bg-indigo-900/30 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700">
                            DR {deliveryRate.toFixed(1)}%
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Toggle tabs */}
                        <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
                            <button
                                onClick={() => setActiveView("forecast")}
                                className={cn(
                                    "px-3 py-1.5 flex items-center gap-1.5 transition-colors",
                                    activeView === "forecast"
                                        ? "bg-indigo-500 text-white"
                                        : "bg-card text-muted-foreground hover:bg-muted/50"
                                )}>
                                <Activity className="w-3 h-3" /> Dự đoán
                            </button>
                            <button
                                onClick={() => setActiveView("actual")}
                                className={cn(
                                    "px-3 py-1.5 flex items-center gap-1.5 transition-colors border-l border-border",
                                    activeView === "actual"
                                        ? "bg-emerald-600 text-white"
                                        : "bg-card text-muted-foreground hover:bg-muted/50"
                                )}>
                                <TrendingDown className="w-3 h-3" /> Thực tế
                            </button>
                        </div>
                        <button onClick={downloadCSV}
                            className="flex items-center gap-1.5 rounded bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-400 hover:bg-indigo-500/20">
                            <Download className="h-3 w-3" /> CSV
                        </button>
                    </div>
                </div>

                {/* Description row */}
                <div className={cn(
                    "rounded-lg px-3 py-2 mb-3 text-[11px] text-muted-foreground border",
                    activeView === "forecast"
                        ? "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800"
                        : "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
                )}>
                    {activeView === "forecast" ? (
                        <>📊 <strong>Dự đoán</strong>: Revenue & COGS × DR ({deliveryRate.toFixed(1)}% — tỷ lệ giao thành công thực tế từ sale_order, cửa sổ 35-14 ngày). 3PL/FFM = đơn × {ffmPerOrder.toFixed(2)} EUR/đơn (chi phí thực tế trung bình).</>
                    ) : (
                        <>✅ <strong>Thực tế</strong>: Chỉ tính đơn <code className="bg-muted px-1 rounded">delivered</code> + <code className="bg-muted px-1 rounded">received_money</code>. 3PL/FFM từ ffm_shipments thực tế. <span className="text-amber-500">Đơn &lt;14 ngày chưa settled — delta sẽ thu hẹp khi đơn được giao.</span></>
                    )}
                </div>

                <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                    {activeView === "forecast" ? (
                        /* ──── FORECAST TABLE ──── */
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-card z-10">
                                <tr className="border-b border-border text-right text-muted-foreground text-xs">
                                    <th className="pb-3 pl-2 text-left">Ngày</th>
                                    <th className="pb-3 text-slate-400" title="Tất cả đơn trừ hủy & test">Orders↑</th>
                                    <th className="pb-3 text-indigo-400" title="Orders × DR">TC dự kiến</th>
                                    <th className="pb-3 text-slate-400" title="SUM(cod) trừ hủy & test">Rev lên đơn</th>
                                    <th className="pb-3 text-emerald-400" title="Revenue × DR">Rev TC dự kiến</th>
                                    <th className="pb-3 text-rose-400" title="COGS × DR">COGS</th>
                                    <th className="pb-3 text-violet-400">3PL/FFM</th>
                                    <th className="pb-3 text-amber-400">Ads</th>
                                    <th className="pb-3 font-bold text-foreground">Lợi nhuận</th>
                                    <th className="pb-3">Margin</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/40">
                                {daily.map((r, i) => (
                                    <tr key={i} className="hover:bg-muted/30 transition-colors text-xs">
                                        <td className="py-2.5 pl-2 font-medium text-foreground text-left whitespace-nowrap">{r.date}</td>
                                        <td className="py-2.5 text-right text-slate-400">{r.orders}</td>
                                        <td className="py-2.5 text-right text-indigo-400 font-medium">{r.estOrders}</td>
                                        <td className="py-2.5 text-right text-slate-400">{formatMoney(r.revenue)}</td>
                                        <td className="py-2.5 text-right text-emerald-400 font-medium">{formatMoney(r.estRevenue)}</td>
                                        <td className="py-2.5 text-right text-rose-300">{r.fcastCogs > 0 ? `-${formatMoney(r.fcastCogs)}` : "—"}</td>
                                        <td className="py-2.5 text-right text-violet-300">{r.ffm > 0 ? `-${formatMoney(r.ffm)}` : "—"}</td>
                                        <td className="py-2.5 text-right text-amber-300">{r.ads > 0 ? `-${formatMoney(r.ads)}` : "—"}</td>
                                        <td className={cn("py-2.5 text-right font-bold", r.fcastProfit > 0 ? "text-emerald-400" : "text-rose-500")}>
                                            {formatMoney(r.fcastProfit)}
                                        </td>
                                        <td className={cn("py-2.5 text-right", r.fcastMargin > 20 ? "text-emerald-400" : "text-muted-foreground")}>
                                            {r.fcastMargin.toFixed(1)}%
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            {daily.length > 0 && (
                                <tfoot className="sticky bottom-0 bg-card border-t-2 border-border font-semibold text-xs">
                                    <tr>
                                        <td className="py-2.5 pl-2 text-left">Tổng</td>
                                        <td className="py-2.5 text-right text-slate-400">{daily.reduce((s, r) => s + r.orders, 0)}</td>
                                        <td className="py-2.5 text-right text-indigo-400">{daily.reduce((s, r) => s + r.estOrders, 0)}</td>
                                        <td className="py-2.5 text-right text-slate-400">{formatMoney(daily.reduce((s, r) => s + r.revenue, 0))}</td>
                                        <td className="py-2.5 text-right text-emerald-400">{formatMoney(daily.reduce((s, r) => s + r.estRevenue, 0))}</td>
                                        <td className="py-2.5 text-right text-rose-300">-{formatMoney(daily.reduce((s, r) => s + r.fcastCogs, 0))}</td>
                                        <td className="py-2.5 text-right text-violet-300">-{formatMoney(daily.reduce((s, r) => s + r.ffm, 0))}</td>
                                        <td className="py-2.5 text-right text-amber-300">-{formatMoney(daily.reduce((s, r) => s + r.ads, 0))}</td>
                                        <td className={cn("py-2.5 text-right", summary.profit > 0 ? "text-emerald-400" : "text-rose-500")}>
                                            {formatMoney(summary.profit)}
                                        </td>
                                        <td className="py-2.5 text-right text-muted-foreground">{summary.margin.toFixed(1)}%</td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    ) : (
                        /* ──── ACTUAL TABLE ──── */
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-card z-10">
                                <tr className="border-b border-border text-right text-muted-foreground text-xs">
                                    <th className="pb-3 pl-2 text-left">Ngày</th>
                                    <th className="pb-3 text-indigo-400" title="Dự đoán">TC dự kiến</th>
                                    <th className="pb-3 text-emerald-400" title="delivered + received_money">Orders TC ✓</th>
                                    <th className="pb-3 text-slate-400">∆ Orders</th>
                                    <th className="pb-3 text-indigo-400">Rev dự kiến</th>
                                    <th className="pb-3 text-emerald-400">Revenue ✓</th>
                                    <th className="pb-3 text-slate-400">∆ Rev</th>
                                    <th className="pb-3 text-rose-400">COGS ✓</th>
                                    <th className="pb-3 text-violet-400">3PL/FFM</th>
                                    <th className="pb-3 text-amber-400">Ads</th>
                                    <th className="pb-3 font-bold text-foreground">Lợi nhuận ✓</th>
                                    <th className="pb-3">Margin</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/40">
                                {daily.map((r, i) => {
                                    const age = Math.floor((Date.now() - new Date(r.date).getTime()) / 86400000);
                                    const settled = age >= 14;
                                    return (
                                    <tr key={i} className={cn("hover:bg-muted/30 transition-colors text-xs", !settled && "opacity-60")}>
                                        <td className="py-2.5 pl-2 font-medium text-foreground text-left whitespace-nowrap">
                                            {r.date}
                                            {!settled && <span className="ml-1.5 inline-flex items-center rounded bg-amber-100 dark:bg-amber-900/30 px-1 py-0.5 text-[9px] text-amber-600 dark:text-amber-400" title={`${age}d — đơn chưa settle đủ 14 ngày`}>~{age}d</span>}
                                        </td>
                                        {/* Forecast ref */}
                                        <td className="py-2.5 text-right text-indigo-400">{r.estOrders}</td>
                                        {/* Actual */}
                                        <td className="py-2.5 text-right text-emerald-400 font-bold">{r.actualOrders}</td>
                                        <td className="py-2.5 text-right">{fmtDelta(r.actualOrders - r.estOrders)}</td>
                                        <td className="py-2.5 text-right text-indigo-400">{formatMoney(r.estRevenue)}</td>
                                        <td className="py-2.5 text-right text-emerald-400 font-bold">{formatMoney(r.actualRevenue)}</td>
                                        <td className="py-2.5 text-right">
                                            {fmtDelta(r.actualRevenue - r.estRevenue)}
                                            {settled && fmtDeltaPct(r.actualRevenue, r.estRevenue)}
                                        </td>
                                        <td className="py-2.5 text-right text-rose-300">{r.actualCogs > 0 ? `-${formatMoney(r.actualCogs)}` : "—"}</td>
                                        <td className="py-2.5 text-right text-violet-300">{r.ffmActual > 0 ? `-${formatMoney(r.ffmActual)}` : "—"}</td>
                                        <td className="py-2.5 text-right text-amber-300">{r.ads > 0 ? `-${formatMoney(r.ads)}` : "—"}</td>
                                        <td className={cn("py-2.5 text-right font-bold", r.actualProfit > 0 ? "text-emerald-400" : "text-rose-500")}>
                                            {formatMoney(r.actualProfit)}
                                        </td>
                                        <td className={cn("py-2.5 text-right", r.actualMargin > 20 ? "text-emerald-400" : "text-muted-foreground")}>
                                            {r.actualMargin.toFixed(1)}%
                                        </td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                            {daily.length > 0 && (() => {
                                const totEstOrd = daily.reduce((s, r) => s + r.estOrders, 0);
                                const totActOrd = daily.reduce((s, r) => s + r.actualOrders, 0);
                                const totEstRev = daily.reduce((s, r) => s + r.estRevenue, 0);
                                const totActRev = daily.reduce((s, r) => s + r.actualRevenue, 0);
                                const totActCogs = daily.reduce((s, r) => s + r.actualCogs, 0);
                                const totFfm = daily.reduce((s, r) => s + r.ffmActual, 0);
                                const totAds = daily.reduce((s, r) => s + r.ads, 0);
                                const totActProfit = totActRev - totActCogs - totFfm - totAds;
                                const totActMargin = totActRev > 0 ? (totActProfit / totActRev) * 100 : 0;
                                return (
                                    <tfoot className="sticky bottom-0 bg-card border-t-2 border-border font-semibold text-xs">
                                        <tr>
                                            <td className="py-2.5 pl-2 text-left">Tổng</td>
                                            <td className="py-2.5 text-right text-indigo-400">{totEstOrd}</td>
                                            <td className="py-2.5 text-right text-emerald-400">{totActOrd}</td>
                                            <td className="py-2.5 text-right">{fmtDelta(totActOrd - totEstOrd)}</td>
                                            <td className="py-2.5 text-right text-indigo-400">{formatMoney(totEstRev)}</td>
                                            <td className="py-2.5 text-right text-emerald-400">{formatMoney(totActRev)}</td>
                                            <td className="py-2.5 text-right">{fmtDelta(totActRev - totEstRev)}{fmtDeltaPct(totActRev, totEstRev)}</td>
                                            <td className="py-2.5 text-right text-rose-300">-{formatMoney(totActCogs)}</td>
                                            <td className="py-2.5 text-right text-violet-300">-{formatMoney(totFfm)}</td>
                                            <td className="py-2.5 text-right text-amber-300">-{formatMoney(totAds)}</td>
                                            <td className={cn("py-2.5 text-right", totActProfit > 0 ? "text-emerald-400" : "text-rose-500")}>
                                                {formatMoney(totActProfit)}
                                            </td>
                                            <td className="py-2.5 text-right text-muted-foreground">{totActMargin.toFixed(1)}%</td>
                                        </tr>
                                    </tfoot>
                                );
                            })()}
                        </table>
                    )}
                </div>
            </div>

            {/* ─── Product P&L Forecast (Per-Product DR) ─────────────────── */}
            <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Package className="h-4 w-4 text-indigo-400" />
                        Product P&L Forecast (Per-Product DR)
                    </h3>
                </div>

                <div className="rounded-lg px-3 py-2 mb-3 text-[11px] text-muted-foreground border bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800">
                    DR rieng per product (35-14 ngay). COGS = chi phi hang x DR. FFM = chi phi giao hang phan bo theo don. Revenue & Profit tinh bang RON roi quy doi VND.
                </div>

                <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-card z-10">
                            <tr className="border-b border-border text-right text-muted-foreground text-xs">
                                <th className="pb-3 pl-2 text-left font-medium">San pham</th>
                                <th className="pb-3 font-medium cursor-pointer hover:text-foreground select-none"
                                    onClick={() => handleProductSort("total_orders")}>Orders {productSortBy === "total_orders" ? (productSortAsc ? "▲" : "▼") : ""}</th>
                                <th className="pb-3 text-indigo-400 font-medium cursor-pointer hover:text-foreground select-none"
                                    onClick={() => handleProductSort("dr_pct")}>DR% {productSortBy === "dr_pct" ? (productSortAsc ? "▲" : "▼") : ""}</th>
                                <th className="pb-3 text-indigo-400 font-medium">TC DK</th>
                                <th className="pb-3 text-emerald-400 font-medium cursor-pointer hover:text-foreground select-none"
                                    onClick={() => handleProductSort("est_revenue")}>Est Rev {productSortBy === "est_revenue" ? (productSortAsc ? "▲" : "▼") : ""}</th>
                                <th className="pb-3 text-rose-400 font-medium">COGS</th>
                                <th className="pb-3 text-violet-400 font-medium">FFM</th>
                                <th className="pb-3 text-amber-400 font-medium cursor-pointer hover:text-foreground select-none"
                                    onClick={() => handleProductSort("ads_ron")}>Ads {productSortBy === "ads_ron" ? (productSortAsc ? "▲" : "▼") : ""}</th>
                                <th className="pb-3 font-bold text-foreground cursor-pointer hover:text-foreground select-none"
                                    onClick={() => handleProductSort("est_profit")}>Profit {productSortBy === "est_profit" ? (productSortAsc ? "▲" : "▼") : ""}</th>
                                <th className="pb-3 font-medium cursor-pointer hover:text-foreground select-none"
                                    onClick={() => handleProductSort("est_margin_pct")}>Margin% {productSortBy === "est_margin_pct" ? (productSortAsc ? "▲" : "▼") : ""}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                            {sortedProductPnl.map((r: any, i: number) => (
                                <tr key={i} className="hover:bg-muted/30 transition-colors text-xs">
                                    <td className="py-2.5 pl-2 text-left">
                                        <div className="font-semibold text-foreground">{r.product_code}</div>
                                        <div className="text-[10px] text-muted-foreground max-w-[150px] truncate" title={r.product_name}>
                                            {r.product_name?.substring(0, 30)}
                                        </div>
                                    </td>
                                    <td className="py-2.5 text-right text-slate-400">{r.total_orders}</td>
                                    <td className={cn("py-2.5 text-right font-medium",
                                        r.dr_pct >= 50 ? "text-emerald-400" : r.dr_pct >= 30 ? "text-amber-400" : "text-rose-400")}>
                                        {(r.dr_pct ?? 0).toFixed(1)}%
                                    </td>
                                    <td className="py-2.5 text-right text-indigo-400 font-medium">{r.est_success_orders}</td>
                                    <td className="py-2.5 text-right text-emerald-400 font-medium">{formatMoney(r.est_revenue)}</td>
                                    <td className="py-2.5 text-right text-rose-300">{r.est_cogs > 0 ? `-${formatMoney(r.est_cogs)}` : "\u2014"}</td>
                                    <td className="py-2.5 text-right text-violet-300">{r.ffm_ron > 0 ? `-${formatMoney(r.ffm_ron)}` : "\u2014"}</td>
                                    <td className="py-2.5 text-right text-amber-300">{r.ads_ron > 0 ? `-${formatMoney(r.ads_ron)}` : "\u2014"}</td>
                                    <td className={cn("py-2.5 text-right font-bold", r.est_profit > 0 ? "text-emerald-400" : "text-rose-500")}>
                                        {formatMoney(r.est_profit)}
                                    </td>
                                    <td className={cn("py-2.5 text-right",
                                        (r.est_margin_pct || 0) > 20 ? "text-emerald-400" :
                                        (r.est_margin_pct || 0) > 0 ? "text-amber-400" : "text-rose-400")}>
                                        {(r.est_margin_pct ?? 0).toFixed(1)}%
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        {sortedProductPnl.length > 0 && (
                            <tfoot className="sticky bottom-0 bg-card border-t-2 border-border font-semibold text-xs">
                                <tr>
                                    <td className="py-2.5 pl-2 text-left">Tong ({sortedProductPnl.length} SP)</td>
                                    <td className="py-2.5 text-right text-slate-400">
                                        {sortedProductPnl.reduce((s: number, r: any) => s + (r.total_orders || 0), 0)}
                                    </td>
                                    <td className="py-2.5 text-right text-muted-foreground">
                                        {(() => {
                                            const totOrd = sortedProductPnl.reduce((s: number, r: any) => s + (r.total_orders || 0), 0);
                                            const wDr = sortedProductPnl.reduce((s: number, r: any) => s + (r.dr_pct || 0) * (r.total_orders || 0), 0);
                                            return totOrd > 0 ? (wDr / totOrd).toFixed(1) : "0.0";
                                        })()}%
                                    </td>
                                    <td className="py-2.5 text-right text-indigo-400">
                                        {sortedProductPnl.reduce((s: number, r: any) => s + (r.est_success_orders || 0), 0)}
                                    </td>
                                    <td className="py-2.5 text-right text-emerald-400">
                                        {formatMoney(sortedProductPnl.reduce((s: number, r: any) => s + (r.est_revenue || 0), 0))}
                                    </td>
                                    <td className="py-2.5 text-right text-rose-300">
                                        -{formatMoney(sortedProductPnl.reduce((s: number, r: any) => s + (r.est_cogs || 0), 0))}
                                    </td>
                                    <td className="py-2.5 text-right text-violet-300">
                                        -{formatMoney(sortedProductPnl.reduce((s: number, r: any) => s + (r.ffm_ron || 0), 0))}
                                    </td>
                                    <td className="py-2.5 text-right text-amber-300">
                                        -{formatMoney(sortedProductPnl.reduce((s: number, r: any) => s + (r.ads_ron || 0), 0))}
                                    </td>
                                    {(() => {
                                        const totProf = sortedProductPnl.reduce((s: number, r: any) => s + (r.est_profit || 0), 0);
                                        const totRev = sortedProductPnl.reduce((s: number, r: any) => s + (r.est_revenue || 0), 0);
                                        return (
                                            <>
                                                <td className={cn("py-2.5 text-right", totProf > 0 ? "text-emerald-400" : "text-rose-500")}>
                                                    {formatMoney(totProf)}
                                                </td>
                                                <td className="py-2.5 text-right text-muted-foreground">
                                                    {totRev > 0 ? ((totProf / totRev) * 100).toFixed(1) : "0.0"}%
                                                </td>
                                            </>
                                        );
                                    })()}
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>
        </div>
    );
}
