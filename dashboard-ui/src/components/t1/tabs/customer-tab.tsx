"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatNumber, cn } from "@/lib/utils";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { Users, Repeat, ShoppingCart, Crown, Heart } from "lucide-react";

const DS = "levelup-465304.T1_Dataset";
const EUR_F = 28000 / 100;
async function queryBQ(sql: string) {
    const r = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }) });
    return (await r.json()).data || [];
}
function fmtVND(v: number) { const a = Math.abs(v); const s = v < 0 ? "-" : ""; if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}ty`; if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}tr`; if (a >= 1e3) return `${s}${Math.round(a / 1e3)}K`; return `${s}${Math.round(a)}`; }
function fmtMoney(v: number) { return new Intl.NumberFormat("vi-VN").format(Math.round(v)); }
const PIE_COLORS = ["#6366f1", "#34d399", "#fbbf24", "#f43f5e", "#a78bfa"];

function customerTier(orders: number, revenue: number) {
    if (orders >= 6) return { label: "VIP", cls: "bg-violet-100 text-violet-700" };
    if (orders >= 3) return { label: "Loyal", cls: "bg-emerald-100 text-emerald-700" };
    if (orders >= 2) return { label: "Repeat", cls: "bg-sky-100 text-sky-700" };
    return { label: "New", cls: "bg-gray-100 text-gray-600" };
}

interface Props { dateRange?: { from: Date; to: Date }; }

export default function CustomerTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [kpis, setKpis] = useState<any>(null);
    const [segments, setSegments] = useState<any[]>([]);
    const [topCustomers, setTopCustomers] = useState<any[]>([]);

    useEffect(() => {
        setLoading(true);
        const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
        const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

        Promise.all([
            queryBQ(`SELECT COUNT(DISTINCT NULLIF(bill_phone_number,'')) as unique_customers,
                COUNT(DISTINCT id) as total_orders,
                ROUND(SUM(CASE WHEN status = 16 THEN total_price ELSE 0 END) * ${EUR_F}, 0) as total_revenue,
                COUNT(DISTINCT CASE WHEN status = 16 THEN id END) as delivered
            FROM \`${DS}.sale_order\`
            WHERE SAFE_CAST(SUBSTR(inserted_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
                AND bill_phone_number IS NOT NULL AND bill_phone_number != ''`),
            queryBQ(`SELECT
                CASE WHEN order_count = 1 THEN '1 don (New)'
                     WHEN order_count = 2 THEN '2 don (Repeat)'
                     WHEN order_count BETWEEN 3 AND 5 THEN '3-5 don (Loyal)'
                     ELSE '6+ don (VIP)' END as segment,
                SUM(customer_count) as customers
            FROM (SELECT COUNT(DISTINCT id) as order_count, 1 as customer_count
                FROM \`${DS}.sale_order\`
                WHERE SAFE_CAST(SUBSTR(inserted_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
                    AND bill_phone_number IS NOT NULL AND bill_phone_number != ''
                GROUP BY bill_phone_number)
            GROUP BY 1 ORDER BY MIN(order_count)`),
            queryBQ(`SELECT bill_full_name as name, bill_phone_number as phone,
                COUNT(DISTINCT id) as orders,
                ROUND(SUM(CASE WHEN status = 16 THEN total_price ELSE 0 END) * ${EUR_F}, 0) as revenue,
                COUNT(DISTINCT CASE WHEN status = 16 THEN id END) as delivered,
                COUNT(DISTINCT CASE WHEN status = 6 THEN id END) as cancelled
            FROM \`${DS}.sale_order\`
            WHERE SAFE_CAST(SUBSTR(inserted_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
                AND bill_phone_number IS NOT NULL AND bill_phone_number != ''
            GROUP BY 1,2 ORDER BY revenue DESC LIMIT 25`),
        ]).then(([kpi, seg, top]) => {
            const k = kpi[0] || {};
            setKpis({
                uniqueCustomers: k.unique_customers || 0,
                totalOrders: k.total_orders || 0,
                totalRevenue: k.total_revenue || 0,
                delivered: k.delivered || 0,
                avgOrdersPerCustomer: k.unique_customers > 0 ? Math.round(k.total_orders / k.unique_customers * 10) / 10 : 0,
                aov: k.delivered > 0 ? Math.round(k.total_revenue / k.delivered) : 0,
            });
            setSegments(seg);
            setTopCustomers(top);
        }).catch(() => { }).finally(() => setLoading(false));
    }, [dateRange]);

    if (loading) return <TabSkeleton cards={4} showChart={true} rows={5} />;
    if (!kpis) return null;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard title="Khach hang" value={formatNumber(kpis.uniqueCustomers)} icon={Users} />
                <KPICard title="Tong don" value={formatNumber(kpis.totalOrders)} icon={ShoppingCart} />
                <KPICard title="Don/KH" value={String(kpis.avgOrdersPerCustomer)} icon={Repeat} />
                <KPICard title="Revenue" value={fmtVND(kpis.totalRevenue)} icon={Crown} status="success" />
                <KPICard title="Don TC" value={formatNumber(kpis.delivered)} icon={Heart} />
                <KPICard title="AOV" value={fmtVND(kpis.aov)} icon={ShoppingCart} subValue="Average Order Value" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Customer Segments</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                            <Pie data={segments} dataKey="customers" nameKey="segment" cx="50%" cy="50%"
                                outerRadius={100} innerRadius={45}
                                label={({ segment, percent }) => `${segment}: ${(percent * 100).toFixed(0)}%`}>
                                {segments.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Segment Distribution</h3>
                    <div className="space-y-3 mt-4">
                        {segments.map((s, i) => (
                            <div key={i} className="flex items-center justify-between">
                                <span className="text-sm text-foreground">{s.segment}</span>
                                <div className="flex items-center gap-3">
                                    <div className="w-32 h-2 rounded-full bg-gray-100 overflow-hidden">
                                        <div className="h-full rounded-full" style={{
                                            width: `${kpis.uniqueCustomers > 0 ? (s.customers / kpis.uniqueCustomers * 100) : 0}%`,
                                            backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                                        }} />
                                    </div>
                                    <span className="text-xs font-semibold text-foreground w-8 text-right">{s.customers}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Top Customers ({topCustomers.length})</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">Khach hang</th>
                                <th className="px-2 pb-2 text-left font-medium">SDT</th>
                                <th className="px-2 pb-2 text-right font-medium">Don</th>
                                <th className="px-2 pb-2 text-right font-medium">TC</th>
                                <th className="px-2 pb-2 text-right font-medium">Huy</th>
                                <th className="px-2 pb-2 text-right font-medium">Revenue</th>
                                <th className="px-2 pb-2 text-center font-medium">Tier</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topCustomers.map((c, i) => {
                                const tier = customerTier(c.orders, c.revenue);
                                return (
                                    <tr key={i} className="border-b border-border/30 hover:bg-gray-50/50">
                                        <td className="px-2 py-2.5 font-medium text-foreground">{c.name || "---"}</td>
                                        <td className="px-2 py-2.5 text-xs">{c.phone}</td>
                                        <td className="px-2 py-2.5 text-right">{c.orders}</td>
                                        <td className="px-2 py-2.5 text-right text-emerald-500">{c.delivered}</td>
                                        <td className={cn("px-2 py-2.5 text-right", c.cancelled > 0 ? "text-rose-500" : "")}>{c.cancelled}</td>
                                        <td className="px-2 py-2.5 text-right font-semibold text-emerald-500">{fmtVND(c.revenue)}</td>
                                        <td className="px-2 py-2.5 text-center">
                                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", tier.cls)}>{tier.label}</span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
