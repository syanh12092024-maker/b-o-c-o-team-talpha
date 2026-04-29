"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Line, ComposedChart,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency, formatNumber, COLORS } from "@/lib/utils";
import { DATASET, CURRENCY_SYMBOL } from "@/lib/constants";
import { ShoppingCart, DollarSign, CheckCircle, TrendingUp, Target } from "lucide-react";

interface OverviewTabProps {
    dateRange?: { from: Date; to: Date };
}

interface OverviewData {
    kpis: { total_orders: number; revenue: number; success_orders: number; spend_ron: number };
    trend: any[];
    marketers: any[];
    funnel: { revenue_l1: number; revenue_l2: number; revenue_l3: number; revenue_l4: number };
}

export default function OverviewTab({ dateRange }: OverviewTabProps) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<OverviewData>({
        kpis: { total_orders: 0, revenue: 0, success_orders: 0, spend_ron: 0 },
        trend: [],
        marketers: [],
        funnel: { revenue_l1: 0, revenue_l2: 0, revenue_l3: 0, revenue_l4: 0 },
    });

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2024-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    // Q0: KPI Summary from mart_performance_master
                    `SELECT
                        SUM(total_orders) as total_orders,
                        SUM(success_orders) as success_orders,
                        SUM(delivered_revenue) as revenue,
                        SUM(ads_spend_ron) as spend_ron
                     FROM ${DATASET}.mart_performance_master
                     WHERE report_date BETWEEN '${from}' AND '${to}'`,

                    // Q1: Daily Trend
                    `SELECT
                        report_date,
                        SUM(total_orders) as orders,
                        SUM(delivered_revenue) as revenue
                     FROM ${DATASET}.mart_performance_master
                     WHERE report_date BETWEEN '${from}' AND '${to}'
                     GROUP BY 1 ORDER BY 1`,

                    // Q2: Top Marketers
                    `SELECT
                        marketer_name,
                        SUM(total_orders) as orders,
                        SUM(delivered_revenue) as revenue,
                        SUM(ads_spend_ron) as spend
                     FROM ${DATASET}.mart_performance_master
                     WHERE report_date BETWEEN '${from}' AND '${to}'
                     GROUP BY 1 ORDER BY revenue DESC LIMIT 5`,

                    // Q3: Revenue Funnel
                    `SELECT
                        ROUND(SUM(revenue_L1_lead), 0) as revenue_l1,
                        ROUND(SUM(revenue_L2_shipped), 0) as revenue_l2,
                        ROUND(SUM(revenue_L3_success), 0) as revenue_l3,
                        ROUND(SUM(revenue_L4_collected), 0) as revenue_l4
                     FROM ${DATASET}.vw_fact_orders
                     WHERE order_date BETWEEN '${from}' AND '${to}'`,
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

                const kpis = results[0].data?.[0] || { total_orders: 0, revenue: 0, success_orders: 0, spend_ron: 0 };
                const funnel = results[3].data?.[0] || { revenue_l1: 0, revenue_l2: 0, revenue_l3: 0, revenue_l4: 0 };

                setData({
                    kpis,
                    trend: results[1].data || [],
                    marketers: results[2].data || [],
                    funnel,
                });
            } catch (error) {
                console.error("Failed to fetch data", error);
            } finally {
                setLoading(false);
            }
        }

        if (dateRange?.from && dateRange?.to) {
            fetchData();
        }
    }, [dateRange]);

    if (loading) {
        return <div className="flex h-96 items-center justify-center text-muted-foreground">Loading data...</div>;
    }

    const { kpis, trend, marketers, funnel } = data;

    // Use mart spend directly (already in local currency)
    const effectiveSpend = kpis.spend_ron;

    const roas = effectiveSpend > 0 ? kpis.revenue / effectiveSpend : 0;
    const cpa = kpis.success_orders > 0 ? effectiveSpend / kpis.success_orders : 0;
    const successRate = kpis.total_orders > 0 ? (kpis.success_orders / kpis.total_orders) * 100 : 0;

    return (
        <div className="space-y-6">

            {/* KPI Row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <KPICard title="Tổng đơn" value={formatNumber(kpis.total_orders)} icon={ShoppingCart} />
                <KPICard title="Doanh thu" value={formatCurrency(kpis.revenue)} icon={DollarSign} status="success" />
                <KPICard
                    title="Thành công"
                    value={formatNumber(kpis.success_orders)}
                    subValue={`${successRate.toFixed(1)}%`}
                    icon={CheckCircle}
                />
                <KPICard
                    title="ROAS"
                    value={`${roas.toFixed(2)}x`}
                    icon={TrendingUp}
                    status={roas >= 2.5 ? "success" : roas >= 1.5 ? "warning" : "danger"}
                    trend={{ value: roas >= 2.5 ? 10 : -5 }}
                />
                <KPICard
                    title="CPA"
                    value={formatCurrency(cpa)}
                    icon={Target}
                    status={cpa > 0 && cpa < 70000 ? "success" : "warning"}
                />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Daily Trend Chart */}
                <div className="col-span-2 rounded-xl border border-border bg-card p-6">
                    <h3 className="section-header">Xu hướng hàng ngày</h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={trend}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                <XAxis
                                    dataKey="report_date"
                                    tickFormatter={(val) => {
                                        try { return format(new Date(val), "dd/MM"); }
                                        catch { return String(val).slice(5); }
                                    }}
                                    stroke="#888" fontSize={12}
                                />
                                <YAxis yAxisId="left" stroke="#888" fontSize={12} />
                                <YAxis yAxisId="right" orientation="right" stroke="#888" fontSize={12} tickFormatter={(val) => `${(val / 1000).toFixed(0)}K`} />
                                <Tooltip contentStyle={{ backgroundColor: "#1e1e2e", borderColor: "#333" }} labelStyle={{ color: "#fff" }} />
                                <Legend />
                                <Bar yAxisId="left" dataKey="orders" name="Đơn hàng" fill={COLORS.indigo} radius={[4, 4, 0, 0]} barSize={20} />
                                <Line yAxisId="right" type="monotone" dataKey="revenue" name="Doanh thu" stroke={COLORS.emerald} strokeWidth={2} dot={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Top Marketer Table */}
                <div className="rounded-xl border border-border bg-card p-6">
                    <h3 className="section-header">🏆 Top Marketer</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-left text-muted-foreground">
                                    <th className="pb-2 font-medium">Name</th>
                                    <th className="pb-2 text-right font-medium">Rev</th>
                                    <th className="pb-2 text-right font-medium">ROAS</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {marketers.map((m: any, i: number) => (
                                    <tr key={i} className="group">
                                        <td className="py-3 font-medium text-foreground">{m.marketer_name}</td>
                                        <td className="py-3 text-right text-emerald-400">{formatNumber(m.revenue)}</td>
                                        <td className="py-3 text-right text-indigo-400">
                                            {(m.revenue / (m.spend || 1)).toFixed(1)}x
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Revenue Funnel */}
            <div className="rounded-xl border border-border bg-card p-6">
                <h3 className="section-header">Revenue Funnel (L1 → L4)</h3>
                <div className="flex items-center justify-center">
                    <div className="w-full max-w-2xl space-y-4 py-4">
                        <div className="bg-indigo-500/20 p-4 rounded-lg flex justify-between items-center">
                            <span className="text-muted-foreground">L1 Lead (Tổng đơn)</span>
                            <span className="font-bold text-foreground text-lg">{formatCurrency(funnel.revenue_l1)}</span>
                        </div>
                        <div className="bg-indigo-500/30 mx-4 p-4 rounded-lg flex justify-between items-center">
                            <span className="text-muted-foreground">L2 Gửi đi (Shipped)</span>
                            <span className="font-bold text-foreground text-lg">{formatCurrency(funnel.revenue_l2)}</span>
                        </div>
                        <div className="bg-indigo-500/40 mx-8 p-4 rounded-lg flex justify-between items-center">
                            <span className="text-muted-foreground">L3 Thành công</span>
                            <span className="font-bold text-foreground text-lg">{formatCurrency(funnel.revenue_l3)}</span>
                        </div>
                        <div className="bg-emerald-500/50 mx-12 p-4 rounded-lg flex justify-between items-center">
                            <span className="text-foreground">L4 Đã thu tiền</span>
                            <span className="font-bold text-foreground text-lg">{formatCurrency(funnel.revenue_l4)}</span>
                        </div>
                        <div className="bg-amber-500/30 mx-12 p-4 rounded-lg flex justify-between items-center">
                            <span className="text-amber-200">📊 Est. L4 (65% × L2)</span>
                            <span className="font-bold text-amber-300 text-lg">{formatCurrency(funnel.revenue_l2 * 0.65)}</span>
                        </div>
                        {funnel.revenue_l1 > 0 && (
                            <div className="text-center text-xs text-muted-foreground mt-2">
                                L1→L2: {((funnel.revenue_l2 / funnel.revenue_l1) * 100).toFixed(1)}%
                                | L2→L3: {funnel.revenue_l2 > 0 ? ((funnel.revenue_l3 / funnel.revenue_l2) * 100).toFixed(1) : 0}%
                                | Est. L4/L2: 65%
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
