"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Cell, PieChart, Pie, ComposedChart, Line,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency, formatNumber, formatMoney, COLORS, cn } from "@/lib/utils";
import { DATASET } from "@/lib/constants";
import TabSkeleton from "@/components/ui/tab-skeleton";
import {
    Users, Repeat, MapPin, ShoppingCart, TrendingUp,
    AlertTriangle, Crown, Heart, Download, Ban, Clock,
} from "lucide-react";

interface CustomerTabProps {
    dateRange?: { from: Date; to: Date };
    projectId?: string;
}

interface CustomerKpis {
    uniqueCustomers: number;
    totalOrders: number;
    avgOrdersPerCustomer: number;
    repeatRate: number;
    successRate: number;
    avgRevPerCustomer: number;
    blacklistCount: number;
    blacklistRevenue: number;
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
        blacklistCount: 0, blacklistRevenue: 0,
    });
    const [orderDist, setOrderDist] = useState<any[]>([]);
    const [provinces, setProvinces] = useState<any[]>([]);
    const [topCustomers, setTopCustomers] = useState<any[]>([]);
    const [blacklist, setBlacklist] = useState<any[]>([]);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    // Q0: KPIs — use cod-based VND revenue
                    `SELECT
                        COUNT(DISTINCT NULLIF(bill_phone_number,'')) as unique_customers,
                        COUNT(DISTINCT order_id) as total_orders,
                        ROUND(SUM(revenue_L3_success),0) as total_revenue,
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

                    // Q2: Top markets
                    `SELECT
                        COALESCE(NULLIF(derived_market,''), 'Unknown') as province,
                        COUNT(DISTINCT order_id) as orders,
                        COUNT(DISTINCT NULLIF(bill_phone_number,'')) as customers,
                        ROUND(SUM(revenue_L3_success), 0) as revenue,
                        COUNTIF(status_group = 'cancelled') as returns
                    FROM ${DATASET}.vw_fact_orders
                    WHERE order_date BETWEEN '${from}' AND '${to}'
                    GROUP BY 1
                    ORDER BY revenue DESC
                    LIMIT 15`,

                    // Q3: Top customers by VND revenue
                    `SELECT
                        bill_full_name as customer_name,
                        bill_phone_number as phone,
                        COUNT(DISTINCT order_id) as orders,
                        ROUND(SUM(revenue_L3_success), 0) as revenue,
                        COUNTIF(status_group = 'success') as delivered,
                        COUNTIF(status_group IN ('cancelled', 'returned')) as returns,
                        MIN(order_date) as first_order,
                        MAX(order_date) as last_order
                    FROM ${DATASET}.vw_fact_orders
                    WHERE order_date BETWEEN '${from}' AND '${to}'
                        AND bill_phone_number IS NOT NULL AND bill_phone_number != ''
                    GROUP BY 1, 2
                    ORDER BY revenue DESC
                    LIMIT 25`,

                    // Q4: 🚨 BLACKLIST — 45+ ngày chưa chuyển L3 (bùng tiền)
                    // Logic: đơn đã gửi (shipped/processing) > 45 ngày trước mà chưa success
                    `SELECT
                        bill_full_name as customer_name,
                        bill_phone_number as phone,
                        derived_market as market,
                        COUNT(DISTINCT order_id) as unpaid_orders,
                        ROUND(SUM(revenue_L1_lead), 0) as unpaid_amount,
                        MIN(order_date) as first_order,
                        MAX(order_date) as last_order,
                        STRING_AGG(DISTINCT status_display, ', ') as statuses,
                        DATE_DIFF(CURRENT_DATE(), MAX(order_date), DAY) as days_since_last
                    FROM ${DATASET}.vw_fact_orders
                    WHERE order_date < DATE_SUB(CURRENT_DATE(), INTERVAL 45 DAY)
                        AND status_group NOT IN ('success', 'cancelled')
                        AND bill_phone_number IS NOT NULL AND bill_phone_number != ''
                    GROUP BY 1, 2, 3
                    ORDER BY unpaid_amount DESC
                    LIMIT 200`,
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
                const blacklistData = results[4].data || [];
                const blRevenue = blacklistData.reduce((s: number, c: any) => s + (c.unpaid_amount || 0), 0);

                setKpis({
                    uniqueCustomers: kpiRow.unique_customers || 0,
                    totalOrders: kpiRow.total_orders || 0,
                    avgOrdersPerCustomer: totalCust > 0 ? (kpiRow.total_orders || 0) / totalCust : 0,
                    repeatRate: totalCust > 0 ? (returningCust / totalCust) * 100 : 0,
                    successRate: kpiRow.total_orders > 0 ? ((kpiRow.delivered_orders || 0) / kpiRow.total_orders) * 100 : 0,
                    avgRevPerCustomer: totalCust > 0 ? (kpiRow.total_revenue || 0) / totalCust : 0,
                    blacklistCount: blacklistData.length,
                    blacklistRevenue: blRevenue,
                });
                setOrderDist(distData);
                setProvinces(results[2].data || []);
                setTopCustomers(results[3].data || []);
                setBlacklist(blacklistData);
            } catch (error) {
                console.error("Customer data fetch error:", error);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [dateRange]);

    // Download blacklist as CSV
    const downloadBlacklist = () => {
        const headers = ["Customer Name", "Phone", "Market", "Unpaid Orders", "Unpaid Amount (VND)", "First Order", "Last Order", "Days Since Last", "Statuses"];
        const rows = blacklist.map((c: any) => [
            `"${(c.customer_name || "N/A").replace(/"/g, '""')}"`,
            c.phone || "",
            c.market || "",
            c.unpaid_orders || 0,
            c.unpaid_amount || 0,
            c.first_order ? String(c.first_order).slice(0, 10) : "",
            c.last_order ? String(c.last_order).slice(0, 10) : "",
            c.days_since_last || 0,
            `"${(c.statuses || "").replace(/"/g, '""')}"`,
        ].join(","));

        const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `blacklist_45days_${format(new Date(), "yyyy-MM-dd")}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
                <KPICard title="👥 Customers" value={formatNumber(kpis.uniqueCustomers)} icon={Users} />
                <KPICard title="📦 Orders" value={formatNumber(kpis.totalOrders)} icon={ShoppingCart} />
                <KPICard title="📊 Avg Đơn/KH" value={kpis.avgOrdersPerCustomer.toFixed(1)} icon={Repeat} />
                <KPICard title="🔄 Repeat Rate" value={`${kpis.repeatRate.toFixed(1)}%`} icon={Heart}
                    status={kpis.repeatRate > 20 ? "success" : kpis.repeatRate > 10 ? "warning" : "danger"} />
                <KPICard title="✅ SR" value={`${kpis.successRate.toFixed(1)}%`} icon={TrendingUp}
                    status={kpis.successRate >= 60 ? "success" : "warning"} />
                <KPICard title="💰 Avg Rev/KH" value={formatCurrency(kpis.avgRevPerCustomer)} icon={Crown} />
                <KPICard title="🚨 Blacklist" value={formatNumber(kpis.blacklistCount)} icon={Ban}
                    status={kpis.blacklistCount > 0 ? "danger" : "success"}
                    subValue={`${formatMoney(kpis.blacklistRevenue)} nợ`} />
                <KPICard title="⏰ Quá 45d" value={formatMoney(kpis.blacklistRevenue)} icon={Clock}
                    status="danger" subValue="DT chưa thu" />
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

            {/* 🚨 BLACKLIST SECTION — Full Width */}
            <div className="rounded-xl border-2 border-rose-500/30 bg-rose-500/5 p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
                        <Ban className="h-5 w-5 text-rose-400" />
                        🚨 Danh Sách Đen — Quá 45 Ngày Chưa Thanh Toán
                        <span className="ml-2 rounded-full bg-rose-500/20 px-3 py-0.5 text-sm font-bold text-rose-400">
                            {blacklist.length} KH
                        </span>
                    </h3>
                    {blacklist.length > 0 && (
                        <button
                            onClick={downloadBlacklist}
                            className="flex items-center gap-2 rounded-lg bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-400 hover:bg-rose-500/20 transition-colors border border-rose-500/20"
                        >
                            <Download className="h-4 w-4" />
                            Tải Blacklist CSV
                        </button>
                    )}
                </div>
                {blacklist.length === 0 ? (
                    <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                        ✅ Không có khách hàng nào quá 45 ngày chưa thanh toán
                    </div>
                ) : (
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-rose-500/10">
                                <tr className="border-b border-rose-500/20 text-muted-foreground">
                                    <th className="px-2 pb-2 text-left font-medium">#</th>
                                    <th className="px-2 pb-2 text-left font-medium">Khách hàng</th>
                                    <th className="px-2 pb-2 text-left font-medium">SĐT</th>
                                    <th className="px-2 pb-2 text-center font-medium">Market</th>
                                    <th className="px-2 pb-2 text-right font-medium">Đơn nợ</th>
                                    <th className="px-2 pb-2 text-right font-medium">Số tiền nợ</th>
                                    <th className="px-2 pb-2 text-center font-medium">Đơn đầu</th>
                                    <th className="px-2 pb-2 text-center font-medium">Đơn cuối</th>
                                    <th className="px-2 pb-2 text-right font-medium">Ngày trễ</th>
                                    <th className="px-2 pb-2 text-left font-medium">Trạng thái</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {blacklist.map((c: any, i: number) => (
                                    <tr key={i} className="hover:bg-rose-500/5 transition-colors">
                                        <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                                        <td className="px-2 py-2">
                                            <div className="font-medium text-foreground text-[11px]">{c.customer_name || "N/A"}</div>
                                        </td>
                                        <td className="px-2 py-2 text-muted-foreground text-[11px]">{c.phone || "-"}</td>
                                        <td className="px-2 py-2 text-center">
                                            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-400">
                                                {c.market || "?"}
                                            </span>
                                        </td>
                                        <td className="px-2 py-2 text-right text-rose-400 font-bold">{c.unpaid_orders}</td>
                                        <td className="px-2 py-2 text-right text-rose-400 font-bold">{formatMoney(c.unpaid_amount || 0)}</td>
                                        <td className="px-2 py-2 text-center text-muted-foreground text-[10px]">
                                            {c.first_order ? String(c.first_order).slice(0, 10) : "-"}
                                        </td>
                                        <td className="px-2 py-2 text-center text-muted-foreground text-[10px]">
                                            {c.last_order ? String(c.last_order).slice(0, 10) : "-"}
                                        </td>
                                        <td className={cn("px-2 py-2 text-right font-bold",
                                            (c.days_since_last || 0) >= 60 ? "text-rose-400" : "text-amber-400")}>
                                            {c.days_since_last}d
                                        </td>
                                        <td className="px-2 py-2 text-[10px] text-amber-400">{c.statuses || "-"}</td>
                                    </tr>
                                ))}
                            </tbody>
                            {/* Summary row */}
                            <tfoot>
                                <tr className="border-t-2 border-rose-500/30 bg-rose-500/10 font-bold">
                                    <td colSpan={4} className="px-2 py-2 text-foreground">TỔNG {blacklist.length} khách hàng nợ</td>
                                    <td className="px-2 py-2 text-right text-rose-400">
                                        {blacklist.reduce((s: number, c: any) => s + (c.unpaid_orders || 0), 0)}
                                    </td>
                                    <td className="px-2 py-2 text-right text-rose-400">
                                        {formatMoney(kpis.blacklistRevenue)}
                                    </td>
                                    <td colSpan={4}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
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

                {/* Blacklist Summary by Market */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <AlertTriangle className="h-4 w-4 text-rose-400" />
                        ⚠️ Blacklist theo Market
                    </h3>
                    {(() => {
                        const marketMap = new Map<string, { count: number; amount: number; orders: number }>();
                        blacklist.forEach((c: any) => {
                            const m = c.market || "Unknown";
                            const curr = marketMap.get(m) || { count: 0, amount: 0, orders: 0 };
                            marketMap.set(m, {
                                count: curr.count + 1,
                                amount: curr.amount + (c.unpaid_amount || 0),
                                orders: curr.orders + (c.unpaid_orders || 0),
                            });
                        });
                        const entries = Array.from(marketMap.entries()).sort((a, b) => b[1].amount - a[1].amount);
                        return entries.length === 0 ? (
                            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                                ✅ Không có dữ liệu blacklist
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {entries.map(([market, data]) => (
                                    <div key={market} className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-bold text-foreground">{market}</span>
                                            <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-bold text-rose-400">
                                                {data.count} KH
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                            <div>
                                                <span className="text-muted-foreground">Đơn nợ:</span>
                                                <span className="ml-2 text-rose-400 font-bold">{data.orders}</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Tiền nợ:</span>
                                                <span className="ml-2 text-rose-400 font-bold">{formatMoney(data.amount)}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        );
                    })()}
                </div>
            </div>
        </div>
    );
}
