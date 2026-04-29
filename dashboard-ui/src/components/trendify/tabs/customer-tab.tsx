"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Cell, PieChart, Pie, ComposedChart, Line,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency as _fmtC, formatNumber, formatMoney as _fmtM, COLORS, cn } from "@/lib/utils";
import { DATASET, CURRENCY_TO_VND } from "../constants";

const formatCurrency = (v: number) => _fmtC(v, CURRENCY_TO_VND);
const formatMoney = (v: number) => _fmtM(v, CURRENCY_TO_VND);
import TabSkeleton from "@/components/ui/tab-skeleton";
import {
    Users, Repeat, MapPin, ShoppingCart, TrendingUp,
    AlertTriangle, Crown, Heart,
} from "lucide-react";

interface CustomerTabProps {
    dateRange?: { from: Date; to: Date };
}

interface CustomerKpis {
    uniqueCustomers: number;
    totalOrders: number;
    avgOrdersPerCustomer: number;
    repeatRate: number;
    successRate: number;
    avgRevPerCustomer: number;
}

const PIE_COLORS = ["#6366f1", "#34d399", "#fbbf24", "#f43f5e", "#a78bfa", "#67e8f9", "#fb923c"];

function customerTier(orders: number, revenue: number): { label: string; cls: string } {
    if (orders >= 4 && revenue >= 500) return { label: "💎 VIP", cls: "bg-emerald-500/20 text-emerald-400" };
    if (orders >= 3) return { label: "⭐ Loyal", cls: "bg-blue-500/20 text-blue-400" };
    if (orders >= 2) return { label: "🔄 Repeat", cls: "bg-amber-500/15 text-amber-400" };
    return { label: "🆕 New", cls: "bg-slate-500/15 text-slate-400" };
}

export default function CustomerTab({ dateRange }: CustomerTabProps) {
    const [loading, setLoading] = useState(true);
    const [kpis, setKpis] = useState<CustomerKpis>({
        uniqueCustomers: 0, totalOrders: 0, avgOrdersPerCustomer: 0,
        repeatRate: 0, successRate: 0, avgRevPerCustomer: 0,
    });
    const [orderDist, setOrderDist] = useState<any[]>([]);
    const [provinces, setProvinces] = useState<any[]>([]);
    const [topCustomers, setTopCustomers] = useState<any[]>([]);
    const [boomBuyers, setBoomBuyers] = useState<any[]>([]);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    // Q0: KPIs — use bill_phone_number as customer identity (customer_id is empty)
                    `SELECT
                        COUNT(DISTINCT NULLIF(bill_phone_number,'')) as unique_customers,
                        COUNT(DISTINCT order_id) as total_orders,
                        ROUND(SUM(CASE WHEN status_group = 'success' THEN total_price ELSE 0 END),0) as total_revenue,
                        COUNTIF(status_group = 'success') as delivered_orders
                    FROM ${DATASET}.vw_fact_orders
                    WHERE order_date BETWEEN '${from}' AND '${to}'
                        AND bill_phone_number IS NOT NULL AND bill_phone_number != ''`,

                    // Q1: Order frequency distribution (RFM-like)
                    `SELECT
                        CASE
                            WHEN order_count = 1 THEN '1 đơn (New)'
                            WHEN order_count = 2 THEN '2 đơn (Repeat)'
                            WHEN order_count BETWEEN 3 AND 5 THEN '3-5 đơn (Loyal)'
                            ELSE '6+ đơn (VIP)'
                        END as segment,
                        SUM(customer_count) as customers,
                        SUM(order_count * customer_count) as total_orders
                    FROM (
                        SELECT COUNT(DISTINCT order_id) as order_count, 1 as customer_count
                        FROM ${DATASET}.vw_fact_orders
                        WHERE order_date BETWEEN '${from}' AND '${to}'
                            AND bill_phone_number IS NOT NULL AND bill_phone_number != ''
                        GROUP BY bill_phone_number
                    )
                    GROUP BY 1
                    ORDER BY MIN(order_count)`,

                    // Q2: Top markets (shipping_province is empty, use derived_market)
                    `SELECT
                        COALESCE(NULLIF(derived_market,''), 'Unknown') as province,
                        COUNT(DISTINCT order_id) as orders,
                        COUNT(DISTINCT NULLIF(bill_phone_number,'')) as customers,
                        ROUND(SUM(CASE WHEN status_group = 'success' THEN total_price ELSE 0 END), 0) as revenue,
                        COUNTIF(status_group = 'cancelled') as returns
                    FROM ${DATASET}.vw_fact_orders
                    WHERE order_date BETWEEN '${from}' AND '${to}'
                    GROUP BY 1
                    ORDER BY revenue DESC
                    LIMIT 15`,

                    // Q3: Top customers by bill_phone_number + bill_full_name
                    `SELECT
                        bill_full_name as customer_name,
                        bill_phone_number as phone,
                        COUNT(DISTINCT order_id) as orders,
                        ROUND(SUM(CASE WHEN status_group = 'success' THEN total_price ELSE 0 END), 0) as revenue,
                        COUNTIF(status_group = 'success') as delivered,
                        COUNTIF(status_group = 'cancelled') as returns,
                        MIN(order_date) as first_order,
                        MAX(order_date) as last_order
                    FROM ${DATASET}.vw_fact_orders
                    WHERE order_date BETWEEN '${from}' AND '${to}'
                        AND bill_phone_number IS NOT NULL AND bill_phone_number != ''
                    GROUP BY 1, 2
                    ORDER BY revenue DESC
                    LIMIT 25`,

                    // Q4: Potential boom buyers (high cancellation rate)
                    `SELECT
                        bill_full_name as customer_name,
                        bill_phone_number as phone,
                        COUNT(DISTINCT order_id) as orders,
                        COUNTIF(status_group = 'cancelled') as returns,
                        ROUND(SAFE_DIVIDE(COUNTIF(status_group = 'cancelled') * 100, COUNT(DISTINCT order_id)), 1) as return_rate
                    FROM ${DATASET}.vw_fact_orders
                    WHERE order_date BETWEEN '${from}' AND '${to}'
                        AND bill_phone_number IS NOT NULL AND bill_phone_number != ''
                    GROUP BY 1, 2
                    HAVING COUNT(DISTINCT order_id) >= 2 AND COUNTIF(status_group = 'cancelled') >= 1
                    ORDER BY return_rate DESC
                    LIMIT 10`,
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

                const kpiRow = results[0].data?.[0] || {};
                const distData = results[1].data || [];
                const totalCust = kpiRow.unique_customers || 1;
                const oneTimers = distData.find((d: any) => d.segment?.includes("New"))?.customers || 0;
                const returningCust = totalCust - oneTimers;

                setKpis({
                    uniqueCustomers: kpiRow.unique_customers || 0,
                    totalOrders: kpiRow.total_orders || 0,
                    avgOrdersPerCustomer: totalCust > 0 ? (kpiRow.total_orders || 0) / totalCust : 0,
                    repeatRate: totalCust > 0 ? (returningCust / totalCust) * 100 : 0,
                    successRate: kpiRow.total_orders > 0 ? ((kpiRow.delivered_orders || 0) / kpiRow.total_orders) * 100 : 0,
                    avgRevPerCustomer: totalCust > 0 ? (kpiRow.total_revenue || 0) / totalCust : 0,
                });
                setOrderDist(distData);
                setProvinces(results[2].data || []);
                setTopCustomers(results[3].data || []);
                setBoomBuyers(results[4].data || []);
            } catch (error) {
                console.error("Customer data fetch error:", error);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [dateRange]);

    if (loading) {
        return <TabSkeleton cards={4} showChart={true} rows={5} />;
    }

    const segmentPie = orderDist.map((d: any) => ({
        name: d.segment, value: d.customers,
    }));

    const provinceChart = provinces.slice(0, 10).map((p: any) => ({
        name: p.province?.substring(0, 15) || "?",
        orders: p.orders,
        revenue: p.revenue,
        customers: p.customers,
    }));

    return (
        <div className="space-y-6">
            {/* KPI Row */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard title="👥 Customers" value={formatNumber(kpis.uniqueCustomers)} icon={Users} />
                <KPICard title="📦 Orders" value={formatNumber(kpis.totalOrders)} icon={ShoppingCart} />
                <KPICard title="📊 Avg Orders/KH" value={kpis.avgOrdersPerCustomer.toFixed(1)} icon={Repeat} />
                <KPICard title="🔄 Repeat Rate" value={`${kpis.repeatRate.toFixed(1)}%`} icon={Heart}
                    status={kpis.repeatRate > 20 ? "success" : kpis.repeatRate > 10 ? "warning" : "danger"} />
                <KPICard title="✅ SR" value={`${kpis.successRate.toFixed(1)}%`} icon={TrendingUp}
                    status={kpis.successRate >= 60 ? "success" : "warning"} />
                <KPICard title="💰 Avg Rev/KH" value={formatCurrency(kpis.avgRevPerCustomer)} icon={Crown} />
            </div>

            {/* Charts Row */}
            <div className="grid gap-4 lg:grid-cols-2">
                {/* Segment Distribution Pie */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-indigo-400" />
                        👥 Customer Segments (Order Frequency)
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                            <Pie data={segmentPie} dataKey="value" nameKey="name" cx="50%" cy="50%"
                                outerRadius={100} innerRadius={45}
                                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}>
                                {segmentPie.map((_, i) => (
                                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                {/* Province Distribution */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        📍 Top Markets (Orders & Revenue)
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={provinceChart} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                            <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis dataKey="name" type="category" width={120} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                            <Legend />
                            <Bar dataKey="orders" name="Orders" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={10} />
                            <Bar dataKey="customers" name="Customers" fill="#34d399" radius={[0, 4, 4, 0]} barSize={10} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Tables Row */}
            <div className="grid gap-4 lg:grid-cols-2">
                {/* Top Customers */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Crown className="h-4 w-4 text-amber-400" />
                        Top Customers (by Revenue)
                    </h3>
                    <div className="overflow-x-auto max-h-[350px] overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-card">
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="px-2 pb-2 text-left font-medium">Customer</th>
                                    <th className="px-2 pb-2 text-right font-medium">Đơn</th>
                                    <th className="px-2 pb-2 text-right font-medium">Revenue</th>
                                    <th className="px-2 pb-2 text-right font-medium">Hoàn</th>
                                    <th className="px-2 pb-2 text-right font-medium">Tier</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {topCustomers.map((c: any, i: number) => {
                                    const tier = customerTier(c.orders || 0, c.revenue || 0);
                                    return (
                                        <tr key={i} className="hover:bg-gray-50/50">
                                            <td className="px-2 py-2">
                                                <div className="font-medium text-foreground text-[11px]">{c.customer_name || "N/A"}</div>
                                                <div className="text-[10px] text-muted-foreground">{c.phone || "-"}</div>
                                            </td>
                                            <td className="px-2 py-2 text-right text-indigo-400 font-bold">{c.orders}</td>
                                            <td className="px-2 py-2 text-right text-emerald-400 font-medium">{formatMoney(c.revenue || 0)}</td>
                                            <td className={cn("px-2 py-2 text-right", (c.returns || 0) > 0 ? "text-rose-400" : "text-muted-foreground")}>
                                                {c.returns || 0}
                                            </td>
                                            <td className="px-2 py-2 text-right">
                                                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap", tier.cls)}>{tier.label}</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Boom Buyers (High Return Rate) */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <AlertTriangle className="h-4 w-4 text-rose-400" />
                        ⚠️ Boom Buyers (Tỷ lệ hoàn cao)
                    </h3>
                    {boomBuyers.length === 0 ? (
                        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                            ✅ Không phát hiện boom buyer trong kỳ này
                        </div>
                    ) : (
                        <div className="overflow-x-auto max-h-[350px] overflow-y-auto">
                            <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-card">
                                    <tr className="border-b border-border text-muted-foreground">
                                        <th className="px-2 pb-2 text-left font-medium">Customer</th>
                                        <th className="px-2 pb-2 text-right font-medium">Đơn</th>
                                        <th className="px-2 pb-2 text-right font-medium">Hoàn</th>
                                        <th className="px-2 pb-2 text-right font-medium">Return%</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {boomBuyers.map((c: any, i: number) => (
                                        <tr key={i} className="hover:bg-gray-50/50">
                                            <td className="px-2 py-2">
                                                <div className="font-medium text-foreground text-[11px]">{c.customer_name || "N/A"}</div>
                                                <div className="text-[10px] text-muted-foreground">{c.phone || "-"}</div>
                                            </td>
                                            <td className="px-2 py-2 text-right">{c.orders}</td>
                                            <td className="px-2 py-2 text-right text-rose-400 font-bold">{c.returns}</td>
                                            <td className={cn("px-2 py-2 text-right font-bold",
                                                (c.return_rate || 0) >= 50 ? "text-rose-400" : "text-amber-400")}>
                                                {c.return_rate}%
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
