"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ReferenceLine, AreaChart, Area, Cell,
    ComposedChart, Line
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { formatCurrency, formatMoney, COLORS, cn, formatNumber } from "@/lib/utils";
import { DATASET } from "@/lib/constants";
import { DollarSign, TrendingDown, TrendingUp, Truck, Package, Activity, Download } from "lucide-react";

interface PnLTabProps {
    dateRange?: { from: Date; to: Date };
    projectId?: string;
}

interface PnLSummary {
    revenue: number;
    cogs: number;
    ads: number;
    shipping: number;
    ffm: number;
    operating_cost: number;
    profit: number;
    margin: number;
    isBlended: boolean;
}

export default function PnLTab({ dateRange }: PnLTabProps) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<{ summary: PnLSummary; daily: any[]; waterfall: any[] }>({
        summary: { revenue: 0, cogs: 0, ads: 0, shipping: 0, ffm: 0, operating_cost: 0, profit: 0, margin: 0, isBlended: false },
        daily: [],
        waterfall: [],
    });

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2024-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                // Query from vw_fact_daily_pnl_v2 — compatible with both STRAMARK and AUUS1
                const pnlQuery = `
                    SELECT 
                        report_date,
                        success_orders,
                        COALESCE(revenue_success, 0) as revenue,
                        COALESCE(cogs, 0) as cogs,
                        COALESCE(ads_spend_ron, 0) as ads,
                        COALESCE(shipping_cost, 0) as shipping,
                        0 as ffm,
                        COALESCE(net_profit, 0) as estimated_L4,
                        COALESCE(net_profit, 0) as estimated_net_profit
                    FROM ${DATASET}.vw_fact_daily_pnl_v2
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                    ORDER BY 1
                `;

                const results = await fetch("/api/query", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: pnlQuery }),
                }).then((res) => res.json());

                const rows = results.data || [];

                let totalRev = 0, totalCogs = 0, totalAds = 0, totalShip = 0, totalFfm = 0;

                const dailyData = rows.map((r: any) => {
                    const rev = r.revenue || 0;
                    const cogs = r.cogs || 0;
                    const ads = r.ads || 0;
                    const ship = r.shipping || 0;
                    const ffm = r.ffm || 0;
                    const profit = rev - cogs - ads - ship - ffm;
                    const margin = rev > 0 ? (profit / rev) * 100 : 0;

                    totalRev += rev;
                    totalCogs += cogs;
                    totalAds += ads;
                    totalShip += ship;
                    totalFfm += ffm;

                    return {
                        date: r.report_date ? r.report_date.value || r.report_date : "",
                        orders: r.success_orders || 0,
                        revenue: rev,
                        cogs,
                        ads,
                        shipping: ship,
                        ffm,
                        profit,
                        margin
                    };
                });

                const totalProfit = totalRev - totalCogs - totalAds - totalShip - totalFfm;
                const totalMargin = totalRev > 0 ? (totalProfit / totalRev) * 100 : 0;

                const summary: PnLSummary = {
                    revenue: totalRev,
                    cogs: totalCogs,
                    ads: totalAds,
                    shipping: totalShip,
                    ffm: totalFfm,
                    operating_cost: totalShip + totalFfm,
                    profit: totalProfit,
                    margin: totalMargin,
                    isBlended: true // Always true now as we calculate ourselves
                };

                const waterfall = [
                    { name: "Revenue", value: totalRev, fill: COLORS.emerald },
                    { name: "COGS", value: -totalCogs, fill: COLORS.rose },
                    { name: "Ads", value: -totalAds, fill: COLORS.amber },
                    { name: "Shipping", value: -totalShip, fill: COLORS.slate },
                    { name: "FFM & Ops", value: -totalFfm, fill: COLORS.indigo },
                    { name: "Net Profit", value: totalProfit, fill: totalProfit > 0 ? COLORS.emerald : COLORS.rose },
                ];

                setData({ summary, daily: dailyData, waterfall });

            } catch (error) {
                console.error("Failed to fetch PnL data", error);
            } finally {
                setLoading(false);
            }
        }

        if (dateRange?.from && dateRange?.to) {
            fetchData();
        }
    }, [dateRange]);

    const downloadCSV = () => {
        const headers = ["Date", "Orders", "Revenue", "COGS", "Ads Spend", "Shipping", "FFM", "Net Profit", "Margin %"];
        const rows = data.daily.map(r => [
            r.date,
            r.orders,
            r.revenue,
            r.cogs,
            r.ads,
            r.shipping,
            r.ffm,
            r.profit,
            r.margin.toFixed(2) + "%"
        ].join(","));
        const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
        const link = document.createElement("a");
        link.href = encodeURI(csv);
        link.download = `pnl_report_${format(new Date(), "yyyyMMdd")}.csv`;
        link.click();
    };

    if (loading) return <TabSkeleton cards={4} showChart={true} rows={5} />;

    const { summary, daily, waterfall } = data;

    return (
        <div className="space-y-6">
            {/* KPI Summary */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
                <KPICard title="Revenue" value={formatCurrency(summary.revenue)} icon={DollarSign} status="success" />
                <KPICard title="COGS" value={formatCurrency(summary.cogs)} icon={Package} />
                <KPICard title="Ad Spend" value={formatCurrency(summary.ads)} icon={TrendingUp} status="warning" />
                <KPICard title="Shipping" value={formatCurrency(summary.shipping)} icon={Truck} />
                <KPICard title="FFM (Est)" value={formatCurrency(summary.ffm)} icon={Activity} />
                <KPICard
                    title="Net Profit"
                    value={formatCurrency(summary.profit)}
                    subValue={`Margin: ${summary.margin.toFixed(1)}%`}
                    status={summary.margin > 20 ? "success" : summary.margin > 0 ? "warning" : "danger"}
                    icon={DollarSign}
                />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Waterfall Chart */}
                <div className="rounded-xl border border-border bg-card p-6">
                    <h3 className="section-header">📊 Cost Structure (Waterfall)</h3>
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={waterfall}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                <XAxis dataKey="name" stroke="#888" fontSize={12} />
                                <YAxis stroke="#888" fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                                <Tooltip contentStyle={{ backgroundColor: "#1e1e2e" }} formatter={(v: number) => formatCurrency(v)} />
                                <ReferenceLine y={0} stroke="#666" />
                                <Bar dataKey="value" name="Amount" radius={[4, 4, 4, 4]}>
                                    {waterfall.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.fill} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Daily Net Profit Trend */}
                <div className="rounded-xl border border-border bg-card p-6">
                    <h3 className="section-header">📈 Net Profit Trend</h3>
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={daily}>
                                <defs>
                                    <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={COLORS.emerald} stopOpacity={0.3} />
                                        <stop offset="95%" stopColor={COLORS.emerald} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                <XAxis dataKey="date"
                                    tickFormatter={(v) => { try { return format(new Date(v), "dd/MM"); } catch { return String(v).slice(5); } }}
                                    stroke="#888" fontSize={12} minTickGap={30} />
                                <YAxis stroke="#888" fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                                <Tooltip contentStyle={{ backgroundColor: "#1e1e2e" }} formatter={(v: number) => formatCurrency(v)} />
                                <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                                <Area type="monotone" dataKey="profit" stroke={COLORS.emerald} fillOpacity={1} fill="url(#colorProfit)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Detailed Daily Table */}
            <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="section-header mb-0">📅 Daily P&L Breakdown</h3>
                    <button
                        onClick={downloadCSV}
                        className="flex items-center gap-2 rounded bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-400 hover:bg-indigo-500/20"
                    >
                        <Download className="h-3 w-3" />
                        Export CSV
                    </button>
                </div>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-card z-10">
                            <tr className="border-b border-border text-right text-muted-foreground">
                                <th className="pb-3 pl-2 text-left">Date</th>
                                <th className="pb-3">Orders</th>
                                <th className="pb-3 text-emerald-400">Revenue</th>
                                <th className="pb-3 text-rose-400">COGS</th>
                                <th className="pb-3 text-amber-400">Ads</th>
                                <th className="pb-3 text-slate-400">Ship</th>
                                <th className="pb-3 text-indigo-400">FFM</th>
                                <th className="pb-3 font-bold text-foreground">Net Profit</th>
                                <th className="pb-3">Margin</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {daily.map((r, i) => (
                                <tr key={i} className="hover:bg-gray-50 transition-colors">
                                    <td className="py-3 pl-2 font-medium text-foreground text-left whitespace-nowrap">
                                        {r.date && typeof r.date === 'string' ? r.date.slice(0, 10) : String(r.date)}
                                    </td>
                                    <td className="py-3 text-right">{r.orders}</td>
                                    <td className="py-3 text-right font-medium text-emerald-400">{formatMoney(r.revenue)}</td>
                                    <td className="py-3 text-right text-rose-300">-{formatMoney(r.cogs)}</td>
                                    <td className="py-3 text-right text-amber-300">-{formatMoney(r.ads)}</td>
                                    <td className="py-3 text-right text-slate-300">-{formatMoney(r.shipping)}</td>
                                    <td className="py-3 text-right text-indigo-300">-{formatMoney(r.ffm)}</td>
                                    <td className={cn("py-3 text-right font-bold", r.profit > 0 ? "text-emerald-400" : "text-rose-500")}>
                                        {formatMoney(r.profit)}
                                    </td>
                                    <td className={cn("py-3 text-right text-xs", r.margin > 20 ? "text-emerald-400" : "text-muted-foreground")}>
                                        {r.margin.toFixed(1)}%
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
