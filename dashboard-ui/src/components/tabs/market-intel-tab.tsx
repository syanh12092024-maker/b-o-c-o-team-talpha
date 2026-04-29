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
import { Globe, TrendingUp, TrendingDown, Target, MapPin, Package } from "lucide-react";

interface MarketIntelTabProps {
    dateRange?: { from: Date; to: Date };
    projectId?: string;
}

interface MarketSummary {
    market: string;
    market_code: string;
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

interface MarketProductMatrix {
    market: string;
    product_code: string;
    product_name: string;
    revenue: number;
    margin: number;
    ads_spend: number;
}

const PIE_COLORS = ["#34d399", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#f97316"];

function marketVerdict(margin: number, returnRate: number): { label: string; cls: string } {
    if (margin >= 50 && returnRate < 25) return { label: "🚀 Scale", cls: "bg-emerald-500/20 text-emerald-400" };
    if (margin >= 30) return { label: "⚙️ Optimize", cls: "bg-amber-500/15 text-amber-400" };
    if (margin >= 0) return { label: "❓ Review", cls: "bg-orange-500/15 text-orange-400" };
    return { label: "⛔ Pause", cls: "bg-rose-500/15 text-rose-400" };
}

export default function MarketIntelTab({ dateRange }: MarketIntelTabProps) {
    const [loading, setLoading] = useState(true);
    const [markets, setMarkets] = useState<MarketSummary[]>([]);
    const [matrix, setMatrix] = useState<MarketProductMatrix[]>([]);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    // Q0: Market P&L summary from mart_market_intelligence
                    `SELECT
                        market, market_code,
                        SUM(total_orders) as orders,
                        SUM(success_orders) as delivered,
                        SUM(returned_orders) as returned,
                        ROUND(COALESCE(SUM(revenue_success), 0),0) as revenue,
                        0 as cogs,
                        ROUND(COALESCE(SUM(gross_profit), 0),0) as gross_profit,
                        ROUND(AVG(COALESCE(market_roas, 0)),1) as margin,
                        ROUND(COALESCE(SUM(ads_spend_ron), 0),0) as ads_spend,
                        ROUND(SAFE_DIVIDE(SUM(returned_orders), NULLIF(SUM(total_orders), 0)) * 100, 1) as return_rate
                    FROM ${DATASET}.mart_market_intelligence
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                        AND market IS NOT NULL AND market != 'Unknown'
                    GROUP BY 1,2 ORDER BY revenue DESC
                    LIMIT 15`,

                    // Q1: Best products per market from mart_product_insights
                    `SELECT
                        COALESCE(o.derived_market, 'Unknown') as market,
                        oi.product_name as product_code,
                        oi.product_name,
                        ROUND(SUM(CASE WHEN o.status_group = 'success' THEN o.revenue_L3_success ELSE 0 END),0) as revenue,
                        0 as margin,
                        0 as ads_spend
                    FROM ${DATASET}.fact_order_items_dedup oi
                    JOIN ${DATASET}.vw_fact_orders o ON oi.order_id = o.order_id
                    WHERE o.order_date BETWEEN '${from}' AND '${to}'
                        AND o.derived_market IS NOT NULL AND o.derived_market != 'Unknown'
                    GROUP BY 1,2,3
                    ORDER BY revenue DESC
                    LIMIT 30`,
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

                setMarkets(results[0].data || []);
                setMatrix(results[1].data || []);
            } catch (error) {
                console.error("Market Intel fetch error:", error);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [dateRange]);

    if (loading) {
        return <TabSkeleton cards={3} showChart={true} rows={5} />;
    }

    const totalRevenue = markets.reduce((s, m) => s + m.revenue, 0);
    const totalGross = markets.reduce((s, m) => s + m.gross_profit, 0);
    const totalAds = markets.reduce((s, m) => s + m.ads_spend, 0);
    const totalOrders = markets.reduce((s, m) => s + m.orders, 0);
    const avgMargin = totalRevenue > 0 ? (totalGross / totalRevenue) * 100 : 0;
    const scaleMarkets = markets.filter((m) => m.margin >= 50 && m.return_rate < 25).length;
    const pauseMarkets = markets.filter((m) => m.margin < 0).length;

    // Revenue pie data
    const revenuePie = markets.slice(0, 7).map((m) => ({
        name: m.market || m.market_code,
        value: m.revenue,
    }));

    // Profile chart: revenue + margin + return rate
    const profileChart = markets.map((m) => ({
        name: m.market_code || m.market?.substring(0, 10) || "?",
        revenue: m.revenue,
        margin: m.margin || 0,
        return_rate: m.return_rate || 0,
    }));

    // Group matrix by market for expansion
    const matrixByMarket = new Map<string, MarketProductMatrix[]>();
    matrix.forEach((m) => {
        if (!matrixByMarket.has(m.market)) matrixByMarket.set(m.market, []);
        matrixByMarket.get(m.market)!.push(m);
    });

    return (
        <div className="space-y-6">
            {/* KPI Row */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard title="🌍 Markets" value={String(markets.length)} icon={Globe} />
                <KPICard title="🚀 Scale-ready" value={String(scaleMarkets)} icon={TrendingUp} status="success"
                    subValue="Margin≥50%, Ret<25%" />
                <KPICard title="⛔ Cần pause" value={String(pauseMarkets)} icon={TrendingDown}
                    status={pauseMarkets > 0 ? "danger" : "neutral"} subValue="Margin < 0%" />
                <KPICard title="📊 Avg Margin" value={`${avgMargin.toFixed(1)}%`} icon={Target}
                    status={avgMargin >= 40 ? "success" : "warning"} />
                <KPICard title="💰 Total Revenue" value={formatCurrency(totalRevenue)} status="success" />
                <KPICard title="📢 Total Ads" value={formatCurrency(totalAds)} />
            </div>

            {/* Charts Row */}
            <div className="grid gap-4 lg:grid-cols-2">
                {/* Revenue Distribution Pie */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        🌍 Revenue Share by Market
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                            <Pie data={revenuePie} dataKey="value" nameKey="name" cx="50%" cy="50%"
                                outerRadius={100} innerRadius={50}
                                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}>
                                {revenuePie.map((_, i) => (
                                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                {/* Market Profile: Revenue + Margin + Return */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-indigo-400" />
                        📈 Market Profile (Revenue, Margin, Return Rate)
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={profileChart}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                            <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                            <Legend />
                            <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                            <Line yAxisId="right" type="monotone" dataKey="margin" name="Margin %" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} />
                            <Line yAxisId="right" type="monotone" dataKey="return_rate" name="Return %" stroke="#ef4444" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Full Market P&L Table */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Globe className="h-4 w-4 text-indigo-400" />
                    Market P&L Analysis
                </h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">Market</th>
                                <th className="px-2 pb-2 text-right font-medium">Đơn</th>
                                <th className="px-2 pb-2 text-right font-medium">Giao</th>
                                <th className="px-2 pb-2 text-right font-medium">Hoàn</th>
                                <th className="px-2 pb-2 text-right font-medium">Revenue</th>
                                <th className="px-2 pb-2 text-right font-medium">COGS</th>
                                <th className="px-2 pb-2 text-right font-medium">Gross P.</th>
                                <th className="px-2 pb-2 text-right font-medium">Margin%</th>
                                <th className="px-2 pb-2 text-right font-medium">Ads</th>
                                <th className="px-2 pb-2 text-right font-medium">Net P&L</th>
                                <th className="px-2 pb-2 text-right font-medium">Return%</th>
                                <th className="px-2 pb-2 text-right font-medium">Verdict</th>
                            </tr>
                        </thead>
                        <tbody>
                            {markets.map((m) => {
                                const netPnl = m.gross_profit - m.ads_spend;
                                const verdict = marketVerdict(m.margin || 0, m.return_rate || 0);
                                return (
                                    <tr key={m.market + m.market_code} className="border-b border-border/30 hover:bg-gray-50/50 transition-colors">
                                        <td className="px-2 py-2.5">
                                            <div className="font-semibold text-foreground">{m.market}</div>
                                            <div className="text-[10px] text-muted-foreground">{m.market_code}</div>
                                        </td>
                                        <td className="px-2 py-2.5 text-right">{formatNumber(m.orders)}</td>
                                        <td className="px-2 py-2.5 text-right text-emerald-400">{formatNumber(m.delivered)}</td>
                                        <td className="px-2 py-2.5 text-right text-rose-400">{formatNumber(m.returned)}</td>
                                        <td className="px-2 py-2.5 text-right font-semibold text-blue-400">{formatMoney(m.revenue)}</td>
                                        <td className="px-2 py-2.5 text-right text-orange-400">{formatMoney(m.cogs)}</td>
                                        <td className={cn("px-2 py-2.5 text-right font-semibold", m.gross_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {m.gross_profit >= 0 ? "+" : ""}{formatMoney(m.gross_profit)}
                                        </td>
                                        <td className={cn("px-2 py-2.5 text-right font-bold",
                                            (m.margin || 0) >= 40 ? "text-emerald-400" : (m.margin || 0) >= 0 ? "text-amber-400" : "text-rose-400")}>
                                            {m.margin != null ? `${m.margin}%` : "—"}
                                        </td>
                                        <td className="px-2 py-2.5 text-right text-amber-400">{formatMoney(m.ads_spend)}</td>
                                        <td className={cn("px-2 py-2.5 text-right font-bold", netPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {netPnl >= 0 ? "+" : ""}{formatMoney(netPnl)}
                                        </td>
                                        <td className={cn("px-2 py-2.5 text-right", (m.return_rate || 0) >= 30 ? "text-rose-400 font-bold" : "text-muted-foreground")}>
                                            {m.return_rate != null ? `${m.return_rate}%` : "—"}
                                        </td>
                                        <td className="px-2 py-2.5 text-right">
                                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap", verdict.cls)}>
                                                {verdict.label}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {/* Totals */}
                            <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                <td className="px-2 py-2.5 text-foreground">TỔNG {markets.length} TT</td>
                                <td className="px-2 py-2.5 text-right">{formatNumber(totalOrders)}</td>
                                <td className="px-2 py-2.5 text-right text-emerald-400">{formatNumber(markets.reduce((s, m) => s + m.delivered, 0))}</td>
                                <td className="px-2 py-2.5 text-right text-rose-400">{formatNumber(markets.reduce((s, m) => s + m.returned, 0))}</td>
                                <td className="px-2 py-2.5 text-right text-blue-400">{formatMoney(totalRevenue)}</td>
                                <td className="px-2 py-2.5 text-right text-orange-400">{formatMoney(markets.reduce((s, m) => s + m.cogs, 0))}</td>
                                <td className={cn("px-2 py-2.5 text-right", totalGross >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {totalGross >= 0 ? "+" : ""}{formatMoney(totalGross)}
                                </td>
                                <td className="px-2 py-2.5 text-right">{avgMargin.toFixed(1)}%</td>
                                <td className="px-2 py-2.5 text-right text-amber-400">{formatMoney(totalAds)}</td>
                                <td className={cn("px-2 py-2.5 text-right", (totalGross - totalAds) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {(totalGross - totalAds) >= 0 ? "+" : ""}{formatMoney(totalGross - totalAds)}
                                </td>
                                <td className="px-2 py-2.5" colSpan={2}></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Top Product per Market */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Package className="h-4 w-4 text-emerald-400" />
                    🏆 Top Products per Market
                </h3>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {Array.from(matrixByMarket.entries()).slice(0, 6).map(([market, prods]) => (
                        <div key={market} className="rounded-lg border border-border bg-card p-4">
                            <div className="mb-2 flex items-center gap-2">
                                <MapPin className="h-3.5 w-3.5 text-indigo-400" />
                                <span className="text-xs font-bold text-foreground">{market}</span>
                            </div>
                            <div className="space-y-1.5">
                                {prods.slice(0, 3).map((p, i) => (
                                    <div key={i} className="flex items-center justify-between text-[11px]">
                                        <span className="text-muted-foreground truncate max-w-[140px]" title={p.product_name}>
                                            {p.product_code || p.product_name?.substring(0, 15)}
                                        </span>
                                        <div className="flex gap-3">
                                            <span className="text-blue-400">{formatMoney(p.revenue)}</span>
                                            <span className={cn((p.margin || 0) >= 40 ? "text-emerald-400" : "text-amber-400")}>{p.margin}%</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
