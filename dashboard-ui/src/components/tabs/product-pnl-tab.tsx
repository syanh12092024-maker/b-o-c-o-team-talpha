"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Cell,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency, formatNumber, formatMoney, COLORS, cn } from "@/lib/utils";
import { DATASET } from "@/lib/constants";
import { Package, TrendingUp, TrendingDown, AlertTriangle, Star } from "lucide-react";

interface ProductPnlTabProps {
    dateRange?: { from: Date; to: Date };
}

interface ProductData {
    product_code: string;
    product_name: string;
    orders: number;
    delivered: number;
    returned: number;
    revenue: number;
    cogs: number;
    gross_profit: number;
    margin: number;
    ads_spend: number;
    return_rate: number;
}

const PRODUCT_COLORS_POS = ["#34d399", "#3b82f6", "#06b6d4", "#a855f7", "#f59e0b"];
const PRODUCT_COLORS_NEG = "#ef4444";

function gradeProduct(margin: number, returnRate: number): { label: string; cls: string } {
    if (margin >= 60 && returnRate < 20) return { label: "⭐ Star", cls: "bg-emerald-500/20 text-emerald-400" };
    if (margin >= 40) return { label: "Tốt", cls: "bg-emerald-500/15 text-emerald-400" };
    if (margin >= 20) return { label: "Trung bình", cls: "bg-amber-500/15 text-amber-400" };
    if (margin > 0) return { label: "Yếu", cls: "bg-orange-500/15 text-orange-400" };
    return { label: "🔻 Cắt lỗ", cls: "bg-rose-500/15 text-rose-400" };
}

export default function ProductPnlTab({ dateRange }: ProductPnlTabProps) {
    const [loading, setLoading] = useState(true);
    const [products, setProducts] = useState<ProductData[]>([]);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const query = `SELECT
                    product_code, product_name,
                    SUM(order_count) as orders,
                    SUM(units_delivered) as delivered,
                    SUM(units_returned) as returned,
                    ROUND(SUM(delivered_revenue),0) as revenue,
                    ROUND(SUM(delivered_cogs),0) as cogs,
                    ROUND(SUM(gross_profit),0) as gross_profit,
                    ROUND(AVG(margin_pct),1) as margin,
                    ROUND(SUM(ads_spend_ron),0) as ads_spend,
                    ROUND(AVG(product_return_rate),1) as return_rate
                FROM ${DATASET}.mart_product_insights
                WHERE report_date BETWEEN '${from}' AND '${to}'
                GROUP BY 1,2 ORDER BY revenue DESC
                LIMIT 20`;

                const res = await fetch("/api/query", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query }),
                }).then((r) => r.json()).catch(() => ({ data: [] }));

                setProducts(res.data || []);
            } catch (error) {
                console.error("Product P&L fetch error:", error);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [dateRange]);

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
            </div>
        );
    }

    const profitable = products.filter((p) => p.gross_profit > 0 && (p.margin || 0) >= 40).length;
    const breakeven = products.filter((p) => (p.margin || 0) >= 0 && (p.margin || 0) < 40).length;
    const losing = products.filter((p) => (p.margin || 0) < 0).length;
    const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
    const totalGross = products.reduce((s, p) => s + p.gross_profit, 0);
    const totalAds = products.reduce((s, p) => s + p.ads_spend, 0);
    const totalCogs = products.reduce((s, p) => s + p.cogs, 0);
    const avgMargin = totalRevenue > 0 ? ((totalGross / totalRevenue) * 100) : 0;
    const netProfit = totalGross - totalAds;

    // Chart data
    const revChart = products.filter((p) => p.revenue > 0).slice(0, 8).map((p) => ({
        name: p.product_code || p.product_name?.substring(0, 12),
        revenue: p.revenue,
    }));

    const marginChart = products.filter((p) => p.revenue > 0).slice(0, 8).map((p) => ({
        name: p.product_code || p.product_name?.substring(0, 12),
        margin: p.margin || 0,
    }));

    return (
        <div className="space-y-6">
            {/* KPI Row */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard
                    title="⭐ Sản phẩm lời"
                    value={String(profitable)}
                    icon={Star}
                    status="success"
                    subValue="Margin ≥ 40%"
                />
                <KPICard
                    title="⚖️ Trung bình"
                    value={String(breakeven)}
                    icon={AlertTriangle}
                    status="warning"
                    subValue="Margin 0-40%"
                />
                <KPICard
                    title="🔻 Sản phẩm lỗ"
                    value={String(losing)}
                    icon={TrendingDown}
                    status={losing > 0 ? "danger" : "neutral"}
                    subValue="Margin < 0%"
                />
                <KPICard
                    title="📊 Avg Margin"
                    value={`${avgMargin.toFixed(1)}%`}
                    icon={TrendingUp}
                    status={avgMargin >= 50 ? "success" : "warning"}
                    subValue="Weighted by revenue"
                />
                <KPICard
                    title="💰 Gross Profit"
                    value={formatCurrency(totalGross)}
                    status="success"
                    subValue={`Rev: ${formatCurrency(totalRevenue)}`}
                />
                <KPICard
                    title="📢 Net (- Ads)"
                    value={formatCurrency(netProfit)}
                    status={netProfit >= 0 ? "success" : "danger"}
                    subValue={`Ads: ${formatCurrency(totalAds)}`}
                />
            </div>

            {/* Charts */}
            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        📦 Revenue by Product
                    </h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={revChart} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis dataKey="name" type="category" tick={{ fill: "#94a3b8", fontSize: 10 }} width={80} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                            <Bar dataKey="revenue" name="Revenue" radius={[0, 6, 6, 0]}>
                                {revChart.map((_, i) => (
                                    <Cell key={i} fill={PRODUCT_COLORS_POS[i % PRODUCT_COLORS_POS.length]} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-pink-400" />
                        📈 Margin % by Product
                    </h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={marginChart}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                            <Bar dataKey="margin" name="Margin %" radius={[6, 6, 0, 0]}>
                                {marginChart.map((entry, i) => (
                                    <Cell key={i} fill={entry.margin >= 40 ? "#34d399" : entry.margin >= 0 ? "#f59e0b" : "#ef4444"} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Full P&L Table */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">📋 Product P&L Detail</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-3 pb-2 text-left font-medium">Product</th>
                                <th className="px-3 pb-2 text-right font-medium">Orders</th>
                                <th className="px-3 pb-2 text-right font-medium">Delivered</th>
                                <th className="px-3 pb-2 text-right font-medium">Returned</th>
                                <th className="px-3 pb-2 text-right font-medium">Revenue</th>
                                <th className="px-3 pb-2 text-right font-medium">COGS</th>
                                <th className="px-3 pb-2 text-right font-medium">Gross Profit</th>
                                <th className="px-3 pb-2 text-right font-medium">Margin%</th>
                                <th className="px-3 pb-2 text-right font-medium">Ads Spend</th>
                                <th className="px-3 pb-2 text-right font-medium">Net P&L</th>
                                <th className="px-3 pb-2 text-right font-medium">Return%</th>
                                <th className="px-3 pb-2 text-right font-medium">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {products.map((p) => {
                                const netPnl = p.gross_profit - p.ads_spend;
                                const grade = gradeProduct(p.margin || 0, p.return_rate || 0);
                                return (
                                    <tr key={p.product_code + p.product_name} className="border-b border-border/60 hover:bg-gray-50/50">
                                        <td className="px-3 py-2">
                                            <div className="font-medium text-foreground">{p.product_code}</div>
                                            <div className="text-[10px] text-muted-foreground">{p.product_name?.substring(0, 25)}</div>
                                        </td>
                                        <td className="px-3 py-2 text-right">{formatNumber(p.orders)}</td>
                                        <td className="px-3 py-2 text-right">{formatNumber(p.delivered)}</td>
                                        <td className="px-3 py-2 text-right">{formatNumber(p.returned)}</td>
                                        <td className="px-3 py-2 text-right font-semibold text-emerald-400">{formatMoney(p.revenue)}</td>
                                        <td className="px-3 py-2 text-right text-orange-400">{formatMoney(p.cogs)}</td>
                                        <td className={cn("px-3 py-2 text-right font-semibold", p.gross_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {p.gross_profit >= 0 ? "+" : ""}{formatMoney(p.gross_profit)}
                                        </td>
                                        <td className={cn("px-3 py-2 text-right font-bold",
                                            (p.margin || 0) >= 40 ? "text-emerald-400" : (p.margin || 0) >= 0 ? "text-amber-400" : "text-rose-400")}>
                                            {p.margin != null ? `${p.margin}%` : "—"}
                                        </td>
                                        <td className="px-3 py-2 text-right text-amber-400">{formatMoney(p.ads_spend)}</td>
                                        <td className={cn("px-3 py-2 text-right font-bold", netPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {netPnl >= 0 ? "+" : ""}{formatMoney(netPnl)}
                                        </td>
                                        <td className={cn("px-3 py-2 text-right", (p.return_rate || 0) >= 30 ? "text-rose-400" : "text-muted-foreground")}>
                                            {p.return_rate != null ? `${p.return_rate}%` : "—"}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", grade.cls)}>
                                                {grade.label}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {/* Totals */}
                            <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                <td className="px-3 py-2 text-foreground">TỔNG {products.length} SP</td>
                                <td className="px-3 py-2 text-right text-foreground">{formatNumber(products.reduce((s, p) => s + p.orders, 0))}</td>
                                <td className="px-3 py-2 text-right text-foreground">{formatNumber(products.reduce((s, p) => s + p.delivered, 0))}</td>
                                <td className="px-3 py-2 text-right text-foreground">{formatNumber(products.reduce((s, p) => s + p.returned, 0))}</td>
                                <td className="px-3 py-2 text-right text-emerald-400">{formatMoney(totalRevenue)}</td>
                                <td className="px-3 py-2 text-right text-orange-400">{formatMoney(totalCogs)}</td>
                                <td className={cn("px-3 py-2 text-right", totalGross >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {totalGross >= 0 ? "+" : ""}{formatMoney(totalGross)}
                                </td>
                                <td className="px-3 py-2 text-right text-foreground">{avgMargin.toFixed(1)}%</td>
                                <td className="px-3 py-2 text-right text-amber-400">{formatMoney(totalAds)}</td>
                                <td className={cn("px-3 py-2 text-right", netProfit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {netProfit >= 0 ? "+" : ""}{formatMoney(netProfit)}
                                </td>
                                <td className="px-3 py-2"></td>
                                <td className="px-3 py-2"></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
