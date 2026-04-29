"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, Cell, PieChart, Pie,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency as _fmtC, formatNumber, formatMoney as _fmtM, COLORS, cn } from "@/lib/utils";
import { DATASET, CURRENCY_TO_VND } from "../constants";

const formatCurrency = (v: number) => _fmtC(v, CURRENCY_TO_VND);
const formatMoney = (v: number) => _fmtM(v, CURRENCY_TO_VND);
import { queryMarketingAdsKpis, queryMarketingDailyTrend, queryMarketingAdsByMarketer, queryMarketingMarketerPnl, queryMarketingDailyRevenue, queryMarketingDailyAds, queryMarketingDailyOrders } from "@/lib/bq-queries";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { resolveMarketerName, isRealMarketer } from "@/lib/marketer-map";
import {
    Megaphone, MousePointer, Eye, Percent, Coins, Users,
    TrendingUp, Target, DollarSign, Trophy,
} from "lucide-react";

interface MarketingTabProps {
    dateRange?: { from: Date; to: Date };
}

/* ─── Marketer performance merged row ─── */
interface MarketerRow {
    marketer_name: string;
    orders: number; success: number; returned: number;
    revenue: number; ads_spend: number; shipping: number; cogs: number;
    net_profit: number; roas: number; sr: number;
    impressions: number; clicks: number;
}

function gradeMarketer(roas: number, netProfit: number): { label: string; cls: string } {
    if (roas >= 5) return { label: "A+", cls: "bg-emerald-500/20 text-emerald-400" };
    if (roas >= 3.5) return { label: "A", cls: "bg-emerald-500/15 text-emerald-400" };
    if (roas >= 2.5) return { label: "B+", cls: "bg-amber-500/15 text-amber-400" };
    if (netProfit < 0) return { label: "C", cls: "bg-rose-500/15 text-rose-400" };
    return { label: "B", cls: "bg-blue-500/15 text-blue-400" };
}

const PIE_COLORS = ["#34d399", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7"];

export default function MarketingTab({ dateRange }: MarketingTabProps) {
    const [loading, setLoading] = useState(true);

    // Aggregated state
    const [adsKpis, setAdsKpis] = useState({ spend: 0, impressions: 0, clicks: 0, ctr: 0, cpm: 0 });
    const [dailyTrend, setDailyTrend] = useState<any[]>([]);
    const [mkters, setMkters] = useState<MarketerRow[]>([]);
    const [dailyMkter, setDailyMkter] = useState<any[]>([]);
    const [selectedMkter, setSelectedMkter] = useState<string>("ALL");

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    queryMarketingAdsKpis(DATASET, from, to),        // Q0
                    queryMarketingDailyTrend(DATASET, from, to),      // Q1
                    queryMarketingAdsByMarketer(DATASET, from, to),   // Q2
                    queryMarketingMarketerPnl(DATASET, from, to),     // Q3
                    queryMarketingDailyRevenue(DATASET, from, to),    // Q4
                    queryMarketingDailyAds(DATASET, from, to),        // Q5
                    queryMarketingDailyOrders(DATASET, from, to),     // Q6
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

                // KPIs
                const kpiRow = results[0].data?.[0] || {};
                setAdsKpis({
                    spend: kpiRow.spend || 0,
                    impressions: kpiRow.impressions || 0,
                    clicks: kpiRow.clicks || 0,
                    ctr: kpiRow.ctr || 0,
                    cpm: kpiRow.cpm || 0,
                });

                // Daily trend: merge ads spend + revenue
                const adsDaily = results[1].data || [];
                const revDaily = results[4].data || [];
                const revMap = new Map<string, number>();
                revDaily.forEach((r: any) => revMap.set(r.report_date, r.revenue || 0));
                const combinedTrend = adsDaily.map((d: any) => ({
                    report_date: d.report_date,
                    spend: d.spend || 0,
                    impressions: d.impressions || 0,
                    clicks: d.clicks || 0,
                    revenue: revMap.get(d.report_date) || 0,
                    roas: d.spend > 0 ? ((revMap.get(d.report_date) || 0) / d.spend) : 0,
                }));
                setDailyTrend(combinedTrend);

                // Merge ads spend by marketer: aggregate by CANONICAL name
                const adsPerCode = results[2].data || [];
                const adsByName = new Map<string, { ads_spend: number; impressions: number; clicks: number }>();
                adsPerCode.forEach((row: any) => {
                    const name = resolveMarketerName(row.mkter_code || "");
                    if (!isRealMarketer(name)) return;
                    const prev = adsByName.get(name) || { ads_spend: 0, impressions: 0, clicks: 0 };
                    adsByName.set(name, {
                        ads_spend: prev.ads_spend + (row.ads_spend || 0),
                        impressions: prev.impressions + (row.impressions || 0),
                        clicks: prev.clicks + (row.clicks || 0),
                    });
                });

                // Aggregate mart_performance_master P&L by CANONICAL name too
                const mkterPnl = results[3].data || [];
                const pnlByName = new Map<string, { orders: number; success: number; returned: number; revenue: number; cogs: number; shipping: number }>();
                mkterPnl.forEach((m: any) => {
                    const name = resolveMarketerName(m.marketer_name || "");
                    if (!isRealMarketer(name)) return;
                    const prev = pnlByName.get(name) || { orders: 0, success: 0, returned: 0, revenue: 0, cogs: 0, shipping: 0 };
                    pnlByName.set(name, {
                        orders: prev.orders + (m.orders || 0),
                        success: prev.success + (m.success || 0),
                        returned: prev.returned + (m.returned || 0),
                        revenue: prev.revenue + (m.revenue || 0),
                        cogs: prev.cogs + (m.cogs || 0),
                        shipping: prev.shipping + (m.shipping || 0),
                    });
                });

                // Merge both maps into final rows
                const allNames = new Set([...pnlByName.keys(), ...adsByName.keys()]);
                const merged: MarketerRow[] = [];
                allNames.forEach((name) => {
                    const pnl = pnlByName.get(name) || { orders: 0, success: 0, returned: 0, revenue: 0, cogs: 0, shipping: 0 };
                    const ads = adsByName.get(name) || { ads_spend: 0, impressions: 0, clicks: 0 };
                    const revenue = pnl.revenue;
                    const roas = ads.ads_spend > 0 ? revenue / ads.ads_spend : 0;
                    const sr = pnl.orders > 0 ? (pnl.success / pnl.orders) * 100 : 0;
                    const net_profit = revenue - pnl.cogs - pnl.shipping - ads.ads_spend;
                    merged.push({
                        marketer_name: name,
                        orders: pnl.orders,
                        success: pnl.success,
                        returned: pnl.returned,
                        revenue, ads_spend: ads.ads_spend,
                        shipping: pnl.shipping, cogs: pnl.cogs,
                        net_profit,
                        roas: Math.round(roas * 100) / 100,
                        sr: Math.round(sr * 10) / 10,
                        impressions: ads.impressions,
                        clicks: ads.clicks,
                    });
                });

                merged.sort((a, b) => b.revenue - a.revenue);
                setMkters(merged);

                // Merge daily ads (Q5) with daily orders (Q6) for complete daily view
                const dailyAdsRaw = results[5]?.data || [];
                const dailyOrdersRaw = results[6]?.data || [];

                // Build orders lookup: date×marketer → orders data
                const ordersMap = new Map<string, any>();
                dailyOrdersRaw.forEach((d: any) => {
                    const name = resolveMarketerName(d.marketer_name || "");
                    if (!isRealMarketer(name)) return;
                    const key = `${d.report_date}|${name}`;
                    const prev = ordersMap.get(key) || { orders: 0, success: 0, returned: 0, revenue: 0, cogs: 0, shipping: 0 };
                    ordersMap.set(key, {
                        orders: prev.orders + (d.orders || 0),
                        success: prev.success + (d.success || 0),
                        returned: prev.returned + (d.returned || 0),
                        revenue: prev.revenue + (d.revenue || 0),
                        cogs: prev.cogs + (d.cogs || 0),
                        shipping: prev.shipping + (d.shipping || 0),
                    });
                });

                // Build ads lookup: date×marketer → ads_spend
                const adsMap = new Map<string, number>();
                dailyAdsRaw.forEach((d: any) => {
                    const name = resolveMarketerName(d.mkter_code || "");
                    if (!isRealMarketer(name)) return;
                    const key = `${d.report_date}|${name}`;
                    adsMap.set(key, (adsMap.get(key) || 0) + (d.ads_spend || 0));
                });

                // Merge: union of all date×marketer combos
                const allDailyKeys = new Set([...ordersMap.keys(), ...adsMap.keys()]);
                const dailyMerged: any[] = [];
                allDailyKeys.forEach((key) => {
                    const [date, mkter] = key.split("|");
                    const ord = ordersMap.get(key) || { orders: 0, success: 0, returned: 0, revenue: 0, cogs: 0, shipping: 0 };
                    const ads_spend = adsMap.get(key) || 0;
                    const sr = ord.orders > 0 ? Math.round(ord.success / ord.orders * 1000) / 10 : 0;
                    const net_profit = ord.revenue - ord.cogs - ord.shipping - ads_spend;
                    const roas = ads_spend > 0 ? Math.round(ord.revenue / ads_spend * 100) / 100 : 0;
                    dailyMerged.push({
                        report_date: date,
                        marketer_name: mkter,
                        orders: ord.orders, success: ord.success, returned: ord.returned,
                        revenue: ord.revenue, ads_spend, cogs: ord.cogs, shipping: ord.shipping,
                        net_profit, roas, sr,
                    });
                });
                dailyMerged.sort((a, b) => {
                    const dateCmp = String(b.report_date).localeCompare(String(a.report_date));
                    return dateCmp !== 0 ? dateCmp : b.revenue - a.revenue;
                });
                setDailyMkter(dailyMerged);
            } catch (error) {
                console.error("Marketing data fetch error:", error);
            } finally {
                setLoading(false);
            }
        }

        if (dateRange?.from && dateRange?.to) fetchData();
    }, [dateRange]);

    if (loading) {
        return <TabSkeleton cards={4} showChart={true} rows={5} />;
    }

    // Totals
    const totalRevenue = mkters.reduce((s, m) => s + m.revenue, 0);
    const totalSpend = mkters.reduce((s, m) => s + m.ads_spend, 0);
    const totalProfit = mkters.reduce((s, m) => s + m.net_profit, 0);
    const totalOrders = mkters.reduce((s, m) => s + m.orders, 0);
    const totalSuccess = mkters.reduce((s, m) => s + m.success, 0);
    const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const overallSR = totalOrders > 0 ? (totalSuccess / totalOrders) * 100 : 0;

    // Chart data
    const roasChart = mkters.filter(m => m.ads_spend > 0).map((m) => ({
        name: m.marketer_name?.split(" ").slice(-2).join(" ") || "?",
        roas: m.roas || 0,
        spend: m.ads_spend,
        revenue: m.revenue,
    }));

    const spendPie = mkters.filter(m => m.ads_spend > 0).map((m) => ({
        name: m.marketer_name?.split(" ").slice(-2).join(" ") || "?",
        value: m.ads_spend,
    }));

    return (
        <div className="space-y-6">
            {/* ── KPIs Row 1: Ads Metrics ── */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard title="💰 Total Ads Spend" value={formatCurrency(adsKpis.spend)} icon={Megaphone} />
                <KPICard title="🎯 ROAS (Overall)" value={`${overallRoas.toFixed(2)}x`} icon={Target}
                    status={overallRoas >= 3 ? "success" : overallRoas >= 2 ? "warning" : "danger"} />
                <KPICard title="📈 Net P&L" value={formatCurrency(totalProfit)} icon={TrendingUp}
                    status={totalProfit >= 0 ? "success" : "danger"} />
                <KPICard title="👁 Impressions" value={formatNumber(adsKpis.impressions)} icon={Eye} />
                <KPICard title="📊 CTR" value={`${adsKpis.ctr.toFixed(2)}%`} icon={Percent}
                    status={adsKpis.ctr > 3 ? "success" : "warning"} />
                <KPICard title="💵 CPM" value={formatCurrency(adsKpis.cpm)} icon={Coins}
                    subValue="RON/1000 impr" />
            </div>

            {/* ── KPIs Row 2: Revenue & Orders ── */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard title="💰 Revenue (TC)" value={formatCurrency(totalRevenue)} icon={DollarSign} status="success" />
                <KPICard title="📦 Tổng đơn" value={formatNumber(totalOrders)} icon={Trophy} />
                <KPICard title="✅ Thành công" value={formatNumber(totalSuccess)} icon={TrendingUp}
                    subValue={`SR: ${overallSR.toFixed(1)}%`} status="success" />
                <KPICard title="🖱 Clicks" value={formatNumber(adsKpis.clicks)} icon={MousePointer} />
                <KPICard title="👥 Marketers" value={String(mkters.length)} icon={Users} />
                <KPICard title="💸 Avg CPA" value={totalSuccess > 0 ? formatCurrency(totalSpend / totalSuccess) : "—"} icon={Coins}
                    subValue="RON/đơn TC" />
            </div>

            {/* ── Top 4 Marketer Cards ── */}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {mkters.slice(0, 4).map((m, i) => {
                    const grade = gradeMarketer(m.roas || 0, m.net_profit);
                    const medal = ["🥇", "🥈", "🥉", ""][i] || "";
                    const borderColor = m.net_profit >= 0 ? "border-l-emerald-500" : "border-l-rose-500";
                    const cpa = m.success > 0 ? m.ads_spend / m.success : 0;
                    return (
                        <div key={m.marketer_name}
                            className={cn("rounded-lg border border-border border-l-[3px] bg-card p-4", borderColor)}>
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-semibold text-muted-foreground">{medal} {m.marketer_name}</span>
                                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", grade.cls)}>{grade.label}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                <div>ROAS: <span className={cn("font-bold", m.roas >= 2.5 ? "text-emerald-400" : "text-amber-400")}>{m.roas}x</span></div>
                                <div>CPA: <span className="font-bold text-blue-400">{cpa > 0 ? formatMoney(cpa) : "—"}</span></div>
                                <div>Đơn: {formatNumber(m.orders)}</div>
                                <div>SR: <span className={cn(m.sr >= 60 ? "text-emerald-400" : "text-amber-400")}>{m.sr}%</span></div>
                                <div>Revenue: <span className="text-emerald-400">{formatMoney(m.revenue)}</span></div>
                                <div>Ads: <span className="text-amber-400">{formatMoney(m.ads_spend)}</span></div>
                                <div>COGS: <span className="text-orange-400">{formatMoney(m.cogs)}</span></div>
                                <div>Shipping: <span className="text-cyan-400">{formatMoney(m.shipping)}</span></div>
                            </div>
                            <div className="mt-2 flex justify-between border-t border-border pt-2 text-xs">
                                <span className="font-semibold">Net P&L:</span>
                                <span className={cn("font-bold", m.net_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {m.net_profit >= 0 ? "+" : ""}{formatMoney(m.net_profit)} RON
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── Charts Row ── */}
            <div className="grid gap-4 lg:grid-cols-2">
                {/* Daily Spend vs Revenue */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        💰 Daily: Spend vs Revenue vs ROAS
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={dailyTrend}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="report_date"
                                tickFormatter={(v) => { try { return format(new Date(v), "dd/MM"); } catch { return String(v).slice(5); } }}
                                tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                            <Legend />
                            <Bar yAxisId="left" dataKey="spend" name="Spend (RON)" fill="#ef4444" radius={[4, 4, 0, 0]} />
                            <Line yAxisId="left" type="monotone" dataKey="revenue" name="Revenue (RON)" stroke="#34d399" strokeWidth={2} dot={false} />
                            <Line yAxisId="right" type="monotone" dataKey="roas" name="ROAS" stroke="#818cf8" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>

                {/* ROAS per Marketer */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-indigo-400" />
                        🎯 ROAS per Marketer
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={roasChart}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                                formatter={(val: any, name: string) => [name === "roas" ? `${val}x` : formatMoney(val as number), name]} />
                            <Legend />
                            <Bar dataKey="roas" name="ROAS" fill="#34d399" radius={[4, 4, 0, 0]}>
                                {roasChart.map((e, i) => (
                                    <Cell key={i} fill={e.roas >= 3 ? "#34d399" : e.roas >= 2 ? "#f59e0b" : "#ef4444"} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Spend Distribution Pie */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-pink-400" />
                        📊 Ads Spend Distribution
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                            <Pie data={spendPie} dataKey="value" nameKey="name" cx="50%" cy="50%"
                                outerRadius={100} innerRadius={45}
                                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}>
                                {spendPie.map((_, i) => (
                                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                {/* Revenue vs Cost Stack per Marketer */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-amber-400" />
                        💰 Revenue vs Costs per Marketer
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={mkters.filter(m => m.revenue > 0 || m.ads_spend > 0).map(m => ({
                            name: m.marketer_name?.split(" ").slice(-2).join(" ") || "?",
                            revenue: m.revenue,
                            ads: m.ads_spend,
                            cogs: m.cogs,
                            shipping: m.shipping,
                        }))} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis dataKey="name" type="category" tick={{ fill: "#94a3b8", fontSize: 10 }} width={80} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                            <Legend />
                            <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" barSize={8} />
                            <Bar dataKey="ads" name="Ads" fill="#f59e0b" barSize={8} />
                            <Bar dataKey="cogs" name="COGS" fill="#f97316" barSize={8} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* ── Full Marketer P&L Table ── */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">📋 Marketer P&L Detail</h3>
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
                                <th className="px-2 pb-2 text-right font-medium">Impr.</th>
                                <th className="px-2 pb-2 text-right font-medium">Clicks</th>
                                <th className="px-2 pb-2 text-right font-medium">Grade</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mkters.map((m) => {
                                const grade = gradeMarketer(m.roas || 0, m.net_profit);
                                const cpa = m.success > 0 ? m.ads_spend / m.success : 0;
                                return (
                                    <tr key={m.marketer_name} className="border-b border-border/30 hover:bg-gray-50/50">
                                        <td className="px-2 py-2.5 font-semibold text-foreground whitespace-nowrap">{m.marketer_name}</td>
                                        <td className="px-2 py-2.5 text-right">{formatNumber(m.orders)}</td>
                                        <td className="px-2 py-2.5 text-right text-emerald-400">{formatNumber(m.success)}</td>
                                        <td className="px-2 py-2.5 text-right text-rose-400">{formatNumber(m.returned)}</td>
                                        <td className={cn("px-2 py-2.5 text-right font-bold", m.sr >= 60 ? "text-emerald-400" : "text-amber-400")}>{m.sr}%</td>
                                        <td className="px-2 py-2.5 text-right font-semibold text-blue-400">{formatMoney(m.revenue)}</td>
                                        <td className={cn("px-2 py-2.5 text-right font-medium", m.ads_spend > 0 ? "text-amber-400" : "text-muted-foreground")}>{formatMoney(m.ads_spend)}</td>
                                        <td className="px-2 py-2.5 text-right text-orange-400">{formatMoney(m.cogs)}</td>
                                        <td className="px-2 py-2.5 text-right text-cyan-400">{formatMoney(m.shipping)}</td>
                                        <td className={cn("px-2 py-2.5 text-right font-bold", m.net_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {m.net_profit >= 0 ? "+" : ""}{formatMoney(m.net_profit)}
                                        </td>
                                        <td className={cn("px-2 py-2.5 text-right font-bold", m.roas >= 3 ? "text-emerald-400" : m.roas >= 2 ? "text-amber-400" : "text-rose-400")}>
                                            {m.roas > 0 ? `${m.roas}x` : "—"}
                                        </td>
                                        <td className="px-2 py-2.5 text-right text-muted-foreground">
                                            {cpa > 0 ? formatMoney(cpa) : "—"}
                                        </td>
                                        <td className="px-2 py-2.5 text-right text-muted-foreground">{formatNumber(m.impressions)}</td>
                                        <td className="px-2 py-2.5 text-right text-muted-foreground">{formatNumber(m.clicks)}</td>
                                        <td className="px-2 py-2.5 text-right">
                                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", grade.cls)}>{grade.label}</span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {/* Totals */}
                            <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                <td className="px-2 py-2.5 text-foreground">TỔNG</td>
                                <td className="px-2 py-2.5 text-right">{formatNumber(totalOrders)}</td>
                                <td className="px-2 py-2.5 text-right text-emerald-400">{formatNumber(totalSuccess)}</td>
                                <td className="px-2 py-2.5 text-right text-rose-400">{formatNumber(mkters.reduce((s, m) => s + m.returned, 0))}</td>
                                <td className="px-2 py-2.5 text-right">{overallSR.toFixed(1)}%</td>
                                <td className="px-2 py-2.5 text-right text-blue-400">{formatMoney(totalRevenue)}</td>
                                <td className="px-2 py-2.5 text-right text-amber-400">{formatMoney(totalSpend)}</td>
                                <td className="px-2 py-2.5 text-right text-orange-400">{formatMoney(mkters.reduce((s, m) => s + m.cogs, 0))}</td>
                                <td className="px-2 py-2.5 text-right text-cyan-400">{formatMoney(mkters.reduce((s, m) => s + m.shipping, 0))}</td>
                                <td className={cn("px-2 py-2.5 text-right", totalProfit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {totalProfit >= 0 ? "+" : ""}{formatMoney(totalProfit)}
                                </td>
                                <td className="px-2 py-2.5 text-right">{overallRoas.toFixed(2)}x</td>
                                <td className="px-2 py-2.5" colSpan={4}></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Daily Marketer P&L Detail ── */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">📅 Chi Tiết P&L Theo Ngày</h3>
                {/* Marketer filter tabs */}
                <div className="mb-4 flex flex-wrap gap-2">
                    <button
                        onClick={() => setSelectedMkter("ALL")}
                        className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                            selectedMkter === "ALL" ? "bg-indigo-500 text-foreground" : "bg-white/10 text-gray-400 hover:bg-white/20")}
                    >Tất cả</button>
                    {mkters.map((m) => (
                        <button
                            key={m.marketer_name}
                            onClick={() => setSelectedMkter(m.marketer_name)}
                            className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                                selectedMkter === m.marketer_name ? "bg-emerald-500 text-foreground" : "bg-white/10 text-gray-400 hover:bg-white/20")}
                        >{m.marketer_name}</button>
                    ))}
                </div>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-card z-10">
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">Ngày</th>
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
                            {dailyMkter
                                .filter((d) => selectedMkter === "ALL" || d.marketer_name === selectedMkter)
                                .map((d, i) => {
                                    const cpa = d.orders > 0 ? Math.round(d.ads_spend / d.orders) : 0;
                                    const dateStr = typeof d.report_date === "string" ? d.report_date : "";
                                    // Group styling: alternating date backgrounds
                                    return (
                                        <tr key={`${d.report_date}-${d.marketer_name}`}
                                            className="border-b border-border/20 hover:bg-gray-50/50">
                                            <td className="px-2 py-1.5 font-mono text-[11px] text-foreground whitespace-nowrap">
                                                {dateStr.slice(0, 10)}
                                            </td>
                                            <td className="px-2 py-1.5 font-medium text-foreground whitespace-nowrap">{d.marketer_name}</td>
                                            <td className="px-2 py-1.5 text-right">{formatNumber(d.orders)}</td>
                                            <td className="px-2 py-1.5 text-right">{formatNumber(d.success)}</td>
                                            <td className={cn("px-2 py-1.5 text-right", d.returned > 0 ? "text-rose-400" : "")}>{formatNumber(d.returned)}</td>
                                            <td className={cn("px-2 py-1.5 text-right font-semibold",
                                                (d.sr || 0) >= 45 ? "text-emerald-400" : (d.sr || 0) >= 30 ? "text-amber-400" : "text-rose-400")}>
                                                {d.sr != null ? `${d.sr}%` : "—"}
                                            </td>
                                            <td className="px-2 py-1.5 text-right font-semibold text-emerald-400">{formatMoney(d.revenue)}</td>
                                            <td className="px-2 py-1.5 text-right text-amber-400">{formatMoney(d.ads_spend)}</td>
                                            <td className="px-2 py-1.5 text-right text-orange-400">{formatMoney(d.cogs)}</td>
                                            <td className="px-2 py-1.5 text-right text-cyan-400">{formatMoney(d.shipping)}</td>
                                            <td className={cn("px-2 py-1.5 text-right font-bold",
                                                d.net_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                                {d.net_profit >= 0 ? "+" : ""}{formatMoney(d.net_profit)}
                                            </td>
                                            <td className={cn("px-2 py-1.5 text-right font-semibold",
                                                (d.roas || 0) >= 3 ? "text-emerald-400" : (d.roas || 0) >= 1.5 ? "text-amber-400" : "text-rose-400")}>
                                                {d.roas ? `${d.roas}x` : "—"}
                                            </td>
                                            <td className="px-2 py-1.5 text-right">{formatMoney(cpa)}</td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div >
    );
}
