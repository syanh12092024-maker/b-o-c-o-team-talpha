"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatNumber, cn } from "@/lib/utils";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { Globe, Target, MapPin } from "lucide-react";

const DS = "levelup-465304.T1_Dataset";
const EUR_F = 28000 / 100;
const USD_TO_VND = 25000;
async function queryBQ(sql: string) {
    const r = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }) });
    return (await r.json()).data || [];
}
function fmtVND(v: number) { const a = Math.abs(v); const s = v < 0 ? "-" : ""; if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}ty`; if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}tr`; if (a >= 1e3) return `${s}${Math.round(a / 1e3)}K`; return `${s}${Math.round(a)}`; }
function fmtUSD(v: number) { return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`; }
const PIE_COLORS = ["#34d399", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4"];

interface Props { dateRange?: { from: Date; to: Date }; }

export default function MarketIntelTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [markets, setMarkets] = useState<any[]>([]);
    const [productsByMarket, setProductsByMarket] = useState<any[]>([]);

    useEffect(() => {
        setLoading(true);
        const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
        const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

        Promise.all([
            queryBQ(`SELECT
                COALESCE(NULLIF(REGEXP_EXTRACT(o.shipping_address, r',\\s*([A-Za-z]{3,})\\s*"'), ''), 'Unknown') as market,
                COUNT(DISTINCT o.id) as orders,
                COUNT(DISTINCT CASE WHEN o.status = 16 THEN o.id END) as delivered,
                COUNT(DISTINCT CASE WHEN o.status = 5 THEN o.id END) as returned,
                ROUND(SUM(CASE WHEN o.status = 16 THEN o.total_price ELSE 0 END) * ${EUR_F}, 0) as revenue,
                ROUND(SAFE_DIVIDE(COUNT(DISTINCT CASE WHEN o.status = 16 THEN o.id END)*100, NULLIF(COUNT(DISTINCT o.id),0)), 1) as sr
            FROM \`${DS}.sale_order\` o
            WHERE SAFE_CAST(SUBSTR(o.inserted_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
            GROUP BY 1 ORDER BY revenue DESC LIMIT 15`),
            queryBQ(`SELECT
                COALESCE(NULLIF(REGEXP_EXTRACT(o.shipping_address, r',\\s*([A-Za-z]{3,})\\s*"'), ''), 'Unknown') as market,
                i.product_name,
                SUM(i.quantity) as qty,
                SUM(i.retail_price * i.quantity) * ${EUR_F} as revenue
            FROM \`${DS}.order_items\` i
            JOIN \`${DS}.sale_order\` o ON SAFE_CAST(i.order_id AS INT64) = o.id
            WHERE SAFE_CAST(SUBSTR(o.inserted_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
                AND i.product_name IS NOT NULL AND i.product_name != ''
            GROUP BY 1,2 ORDER BY revenue DESC LIMIT 30`),
        ]).then(([mkts, prods]) => {
            setMarkets(mkts);
            setProductsByMarket(prods);
        }).catch(() => { }).finally(() => setLoading(false));
    }, [dateRange]);

    if (loading) return <TabSkeleton cards={3} showChart={true} rows={5} />;

    const totalOrders = markets.reduce((s, m) => s + (m.orders || 0), 0);
    const totalRevenue = markets.reduce((s, m) => s + (m.revenue || 0), 0);
    const revPie = markets.filter(m => m.revenue > 0).map(m => ({ name: m.market, value: m.revenue }));
    const chartData = markets.slice(0, 8).map(m => ({ name: m.market?.substring(0, 12), revenue: Math.round((m.revenue || 0) / 1e6), orders: m.orders }));

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <KPICard title="Markets" value={String(markets.length)} icon={Globe} />
                <KPICard title="Total Orders" value={formatNumber(totalOrders)} icon={Target} />
                <KPICard title="Total Revenue" value={fmtVND(totalRevenue)} icon={MapPin} status="success" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Revenue by Market</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                            <Pie data={revPie} dataKey="value" nameKey="name" cx="50%" cy="50%"
                                outerRadius={100} innerRadius={45}
                                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}>
                                {revPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Revenue by Market (tr VND)</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }} />
                            <Bar dataKey="revenue" name="Revenue (tr)" fill="#34d399" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Market Performance</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">Market</th>
                                <th className="px-2 pb-2 text-right font-medium">Don</th>
                                <th className="px-2 pb-2 text-right font-medium">TC</th>
                                <th className="px-2 pb-2 text-right font-medium">Hoan</th>
                                <th className="px-2 pb-2 text-right font-medium">SR%</th>
                                <th className="px-2 pb-2 text-right font-medium">Revenue</th>
                            </tr>
                        </thead>
                        <tbody>
                            {markets.map((m, i) => (
                                <tr key={i} className="border-b border-border/30 hover:bg-gray-50/50">
                                    <td className="px-2 py-2.5 font-medium text-foreground">{m.market}</td>
                                    <td className="px-2 py-2.5 text-right">{formatNumber(m.orders)}</td>
                                    <td className="px-2 py-2.5 text-right">{formatNumber(m.delivered)}</td>
                                    <td className={cn("px-2 py-2.5 text-right", m.returned > 0 ? "text-rose-500" : "")}>{formatNumber(m.returned)}</td>
                                    <td className={cn("px-2 py-2.5 text-right font-semibold", (m.sr || 0) >= 45 ? "text-emerald-500" : "text-amber-500")}>{m.sr}%</td>
                                    <td className="px-2 py-2.5 text-right font-semibold text-emerald-500">{fmtVND(m.revenue)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Best Products per Market</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">Market</th>
                                <th className="px-2 pb-2 text-left font-medium">San pham</th>
                                <th className="px-2 pb-2 text-right font-medium">SL</th>
                                <th className="px-2 pb-2 text-right font-medium">Revenue</th>
                            </tr>
                        </thead>
                        <tbody>
                            {productsByMarket.map((p, i) => (
                                <tr key={i} className="border-b border-border/30 hover:bg-gray-50/50">
                                    <td className="px-2 py-2.5 text-foreground">{p.market}</td>
                                    <td className="px-2 py-2.5 font-medium text-foreground max-w-[200px] truncate">{p.product_name}</td>
                                    <td className="px-2 py-2.5 text-right">{formatNumber(p.qty)}</td>
                                    <td className="px-2 py-2.5 text-right text-emerald-500">{fmtVND(p.revenue)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
