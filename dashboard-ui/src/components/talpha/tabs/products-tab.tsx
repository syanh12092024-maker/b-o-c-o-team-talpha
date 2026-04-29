"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell,
} from "recharts";
import { Package, TrendingUp } from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { DATASET } from "../constants";
import { formatVNDCompact, toVND } from "../utils";

const CHART_COLORS = ["#34d399", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4"];

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

type SortKey = "quantity" | "revenue" | "orders";

export default function TALPHAProductsTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [products, setProducts] = useState<any[]>([]);
    const [shopFilter, setShopFilter] = useState("all");
    const [sortKey, setSortKey] = useState<SortKey>("revenue");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const query = `
                    SELECT
                        COALESCE(NULLIF(oi.product_name, ''), 'Unknown') as product_name,
                        o.shop_name,
                        SUM(oi.quantity) as quantity,
                        ROUND(SUM(oi.retail_price * oi.quantity), 2) as revenue,
                        COUNT(DISTINCT oi.order_id) as orders
                    FROM \`levelup-465304.${DATASET}.order_items\` oi
                    LEFT JOIN \`levelup-465304.${DATASET}.sale_order\` o ON oi.order_id = CAST(o.id AS STRING)
                    WHERE DATE(o.inserted_at) BETWEEN '${from}' AND '${to}'
                    GROUP BY 1, 2
                    ORDER BY revenue DESC
                `;

                const result = await fetch("/api/query", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query }),
                }).then(r => r.json()).catch(() => ({ data: [] }));

                setProducts((result.data || []).map((r: any) => ({
                    product_name: r.product_name, shop_name: r.shop_name || "Unknown",
                    quantity: r.quantity || 0,
                    revenue: toVND(r.revenue || 0, r.shop_name),
                    orders: r.orders || 0,
                })));
            } catch (e) { console.error(e); } finally { setLoading(false); }
        }
        fetchData();
    }, [dateRange]);

    if (loading) return <TabSkeleton />;

    const shops = ["all", ...Array.from(new Set(products.map(p => p.shop_name)))];
    const filtered = shopFilter === "all" ? products : products.filter(p => p.shop_name === shopFilter);

    const aggMap = new Map<string, { product_name: string; quantity: number; revenue: number; orders: number; shops: Set<string> }>();
    filtered.forEach(p => {
        const existing = aggMap.get(p.product_name);
        if (existing) {
            existing.quantity += p.quantity; existing.revenue += p.revenue;
            existing.orders += p.orders; existing.shops.add(p.shop_name);
        } else {
            aggMap.set(p.product_name, { ...p, shops: new Set([p.shop_name]) });
        }
    });
    const aggregated = Array.from(aggMap.values())
        .sort((a, b) => sortDir === "desc" ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]);
    const chartData = aggregated.slice(0, 10);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
        else { setSortKey(key); setSortDir("desc"); }
    };
    const SortHeader = ({ label, sk }: { label: string; sk: SortKey }) => (
        <th className="text-right py-2 pr-2 cursor-pointer hover:text-foreground" onClick={() => handleSort(sk)}>
            {label} {sortKey === sk ? (sortDir === "desc" ? "↓" : "↑") : ""}
        </th>
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">Thị trường:</span>
                <div className="flex gap-1">
                    {shops.map(s => (
                        <button key={s} onClick={() => setShopFilter(s)}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition ${shopFilter === s ? "bg-amber-600 text-foreground" : "bg-slate-700 text-slate-400 hover:text-foreground"}`}>
                            {s === "all" ? "Tất cả" : s}
                        </button>
                    ))}
                </div>
            </div>

            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-4">📦 Top 10 Sản phẩm (VND)</h3>
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chartData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => formatVNDCompact(v)} />
                        <YAxis type="category" dataKey="product_name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={180} />
                        <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8 }}
                            formatter={(v: number) => [formatVNDCompact(v), ""]} />
                        <Bar dataKey="revenue" name="Doanh thu" radius={[0, 4, 4, 0]}>
                            {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-foreground mb-4">📋 Chi tiết sản phẩm ({aggregated.length})</h3>
                <div className="overflow-auto max-h-[500px]">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-slate-800">
                            <tr className="text-slate-400 text-xs border-b border-slate-700">
                                <th className="text-left py-2 pl-2">#</th>
                                <th className="text-left py-2">Sản phẩm</th>
                                <th className="text-left py-2">Thị trường</th>
                                <SortHeader label="SL bán" sk="quantity" />
                                <SortHeader label="Đơn" sk="orders" />
                                <SortHeader label="DT (VND)" sk="revenue" />
                            </tr>
                        </thead>
                        <tbody>
                            {aggregated.map((p, i) => (
                                <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                                    <td className="py-2 pl-2 text-slate-500">{i + 1}</td>
                                    <td className="py-2 text-foreground font-medium max-w-[200px] truncate">{p.product_name}</td>
                                    <td className="py-2 text-xs text-slate-400">{Array.from(p.shops).join(", ")}</td>
                                    <td className="py-2 text-right text-blue-400 font-mono">{p.quantity}</td>
                                    <td className="py-2 text-right text-purple-400 font-mono">{p.orders}</td>
                                    <td className="py-2 text-right pr-2 text-emerald-400 font-mono">{formatVNDCompact(p.revenue)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
