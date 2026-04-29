"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, Cell,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatVNDCompact, formatCurrency, formatMoney, formatNumber, toVND, cn, COLORS } from "../utils";
import { DATASET } from "../constants";
import TabSkeleton from "@/components/ui/tab-skeleton";
import {
    Crown, TrendingUp, TrendingDown, DollarSign,
    Users, Globe, Package, Target, Megaphone,
} from "lucide-react";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

interface MonthlyRow {
    month: string; orders: number; revenue: number; ads_spend: number; net_profit: number;
}
interface MarketerRow {
    marketer: string; orders: number; revenue: number; ads_spend: number; roas: number; net_profit: number;
}
interface MarketRow {
    shop_name: string; orders: number; revenue: number; ads_spend: number; margin: number;
}
interface ProductRow {
    product_name: string; quantity: number; revenue: number;
}

function gradeMarketer(roas: number, netProfit: number): { label: string; color: string } {
    if (roas >= 5) return { label: "A+", color: "bg-emerald-500/20 text-emerald-400" };
    if (roas >= 3.5) return { label: "A", color: "bg-emerald-500/15 text-emerald-400" };
    if (roas >= 2.5) return { label: "B+", color: "bg-amber-500/15 text-amber-400" };
    if (netProfit < 0) return { label: "C", color: "bg-rose-500/15 text-rose-400" };
    return { label: "B", color: "bg-blue-500/15 text-blue-400" };
}

export default function TALPHACeoOverviewTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
    const [marketers, setMarketers] = useState<MarketerRow[]>([]);
    const [markets, setMarkets] = useState<MarketRow[]>([]);
    const [products, setProducts] = useState<ProductRow[]>([]);
    const [totals, setTotals] = useState({ orders: 0, revenue: 0, ads: 0, net: 0, markets: 0 });

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    // Q0: Monthly revenue by shop (for VND) + monthly ads spend
                    `SELECT
                        FORMAT_DATE('%Y-%m', DATE(inserted_at)) as month,
                        shop_name,
                        COUNT(DISTINCT id) as orders,
                        ROUND(SUM(total_price), 2) as revenue
                    FROM \`levelup-465304.${DATASET}.sale_order\`
                    WHERE DATE(inserted_at) BETWEEN '${from}' AND '${to}' AND total_price > 0
                    GROUP BY 1, 2 ORDER BY 1`,

                    // Q1: Monthly ads spend
                    `SELECT
                        FORMAT_DATE('%Y-%m', DATE(date_start)) as month,
                        ROUND(SUM(spend), 0) as ads_spend
                    FROM \`levelup-465304.${DATASET}.fb_ads_data\`
                    WHERE DATE(date_start) BETWEEN '${from}' AND '${to}' AND spend > 0
                    GROUP BY 1 ORDER BY 1`,

                    // Q2: Marketer performance with shop for VND + ads attribution
                    `SELECT
                        COALESCE(NULLIF(o.marketer, ''), NULLIF(o.pke_mkter, ''), 'Unknown') as marketer,
                        o.shop_name,
                        COUNT(DISTINCT o.id) as orders,
                        ROUND(SUM(o.total_price), 2) as revenue,
                        ROUND(SUM(CASE WHEN a.ad_id IS NOT NULL THEN a.spend ELSE 0 END), 0) as ads_spend
                    FROM \`levelup-465304.${DATASET}.sale_order\` o
                    LEFT JOIN (
                        SELECT ad_id, ROUND(AVG(spend), 2) as spend
                        FROM \`levelup-465304.${DATASET}.fb_ads_data\`
                        WHERE DATE(date_start) BETWEEN '${from}' AND '${to}'
                        GROUP BY 1
                    ) a ON o.ad_id = a.ad_id
                    WHERE DATE(o.inserted_at) BETWEEN '${from}' AND '${to}' AND o.total_price > 0
                    GROUP BY 1, 2 ORDER BY revenue DESC`,

                    // Q3: Market breakdown
                    `SELECT
                        shop_name,
                        COUNT(DISTINCT id) as orders,
                        ROUND(SUM(total_price), 2) as revenue
                    FROM \`levelup-465304.${DATASET}.sale_order\`
                    WHERE DATE(inserted_at) BETWEEN '${from}' AND '${to}' AND total_price > 0
                    GROUP BY 1 ORDER BY revenue DESC`,

                    // Q4: Market ads spend
                    `SELECT
                        CASE
                            WHEN campaign_name LIKE '%Saudi%' OR campaign_name LIKE '%SA%' THEN 'Saudi'
                            WHEN campaign_name LIKE '%UAE%' OR campaign_name LIKE '%Dubai%' OR campaign_name LIKE '%AE%' THEN 'UAE'
                            WHEN campaign_name LIKE '%Kuwait%' OR campaign_name LIKE '%KW%' THEN 'Kuwait'
                            WHEN campaign_name LIKE '%Oman%' OR campaign_name LIKE '%OM%' THEN 'Oman'
                            WHEN campaign_name LIKE '%Qatar%' OR campaign_name LIKE '%QA%' THEN 'Qatar'
                            WHEN campaign_name LIKE '%Bahrain%' OR campaign_name LIKE '%BH%' THEN 'Bahrain'
                            ELSE 'Other'
                        END as market,
                        ROUND(SUM(spend), 0) as ads_spend
                    FROM \`levelup-465304.${DATASET}.fb_ads_data\`
                    WHERE DATE(date_start) BETWEEN '${from}' AND '${to}' AND spend > 0
                    GROUP BY 1`,

                    // Q5: Top products
                    `SELECT
                        COALESCE(NULLIF(oi.product_name, ''), 'Unknown') as product_name,
                        SUM(oi.quantity) as quantity,
                        ROUND(SUM(oi.retail_price * oi.quantity), 2) as revenue_local,
                        STRING_AGG(DISTINCT o.shop_name, ', ') as shops
                    FROM \`levelup-465304.${DATASET}.order_items\` oi
                    LEFT JOIN \`levelup-465304.${DATASET}.sale_order\` o ON oi.order_id = CAST(o.id AS STRING)
                    WHERE o.total_price > 0
                    GROUP BY 1 ORDER BY quantity DESC LIMIT 10`,

                    // Q6: Total ads spend
                    `SELECT ROUND(SUM(spend), 0) as total_ads
                    FROM \`levelup-465304.${DATASET}.fb_ads_data\`
                    WHERE DATE(date_start) BETWEEN '${from}' AND '${to}' AND spend > 0`,
                ];

                const results = await Promise.all(
                    queries.map(q =>
                        fetch("/api/query", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q })
                        }).then(r => r.json()).catch(() => ({ data: [] }))
                    )
                );

                // Monthly: aggregate revenue by month with VND + merge ads
                const monthRevMap = new Map<string, { orders: number; revenue: number }>();
                for (const r of results[0].data || []) {
                    const m = r.month || "";
                    const rev = toVND(r.revenue || 0, r.shop_name);
                    const ex = monthRevMap.get(m);
                    if (ex) { ex.orders += r.orders || 0; ex.revenue += rev; }
                    else monthRevMap.set(m, { orders: r.orders || 0, revenue: rev });
                }
                const monthAdsMap = new Map<string, number>();
                for (const r of results[1].data || []) {
                    monthAdsMap.set(r.month || "", r.ads_spend || 0);
                }
                const allMonths = new Set([...monthRevMap.keys(), ...monthAdsMap.keys()]);
                const monthlyArr: MonthlyRow[] = Array.from(allMonths).sort().map(m => {
                    const rev = monthRevMap.get(m)?.revenue || 0;
                    const orders = monthRevMap.get(m)?.orders || 0;
                    const ads = monthAdsMap.get(m) || 0;
                    return { month: m, orders, revenue: rev, ads_spend: ads, net_profit: rev - ads };
                });
                setMonthly(monthlyArr);

                // Marketers: aggregate by name with VND + ads
                const mkMap = new Map<string, MarketerRow>();
                for (const r of results[2].data || []) {
                    let name = (r.marketer || "").trim();
                    // Skip JSON strings, None, empty, or garbage data
                    if (!name || name === "Unknown" || name === "None" || name === "null"
                        || name.includes("{") || name.includes("'phone_number'")
                        || name.includes("avatar_url") || name.length > 50) continue;
                    const rev = toVND(r.revenue || 0, r.shop_name);
                    const ads = r.ads_spend || 0;
                    const ex = mkMap.get(name);
                    if (ex) { ex.orders += r.orders || 0; ex.revenue += rev; ex.ads_spend += ads; }
                    else mkMap.set(name, { marketer: name, orders: r.orders || 0, revenue: rev, ads_spend: ads, roas: 0, net_profit: 0 });
                }
                const mkArr = Array.from(mkMap.values()).map(m => ({
                    ...m,
                    roas: m.ads_spend > 0 ? Math.round((m.revenue / m.ads_spend) * 100) / 100 : 0,
                    net_profit: m.revenue - m.ads_spend,
                })).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
                setMarketers(mkArr);

                // Markets: revenue + ads
                const mktAdsMap = new Map<string, number>();
                for (const r of results[4].data || []) {
                    mktAdsMap.set(r.market || "", r.ads_spend || 0);
                }
                const marketsArr: MarketRow[] = (results[3].data || []).map((r: any) => {
                    const rev = toVND(r.revenue || 0, r.shop_name);
                    const ads = mktAdsMap.get(r.shop_name) || 0;
                    return {
                        shop_name: r.shop_name, orders: r.orders || 0, revenue: rev,
                        ads_spend: ads, margin: rev > 0 ? Math.round(((rev - ads) / rev) * 1000) / 10 : 0,
                    };
                });
                setMarkets(marketsArr);

                // Products
                const prodArr = (results[5].data || []).map((r: any) => ({
                    product_name: r.product_name || "Unknown",
                    quantity: r.quantity || 0,
                    revenue: toVND(r.revenue_local || 0, (r.shops || "").split(",")[0]?.trim()),
                }));
                setProducts(prodArr);

                // Global totals
                const totalRev = monthlyArr.reduce((s, m) => s + m.revenue, 0);
                const totalOrders = monthlyArr.reduce((s, m) => s + m.orders, 0);
                const totalAds = results[6].data?.[0]?.total_ads || 0;
                setTotals({
                    orders: totalOrders, revenue: totalRev, ads: totalAds,
                    net: totalRev - totalAds, markets: marketsArr.length,
                });
            } catch (e) { console.error("CEO fetch error", e); } finally { setLoading(false); }
        }
        fetchData();
    }, [dateRange]);

    if (loading) return <TabSkeleton cards={6} showChart={true} rows={5} />;

    const overallRoas = totals.ads > 0 ? totals.revenue / totals.ads : 0;
    const overallMargin = totals.revenue > 0 ? (totals.net / totals.revenue) * 100 : 0;

    return (
        <div className="space-y-6">
            {/* KPI Row — same pattern as AUUS1 */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard title="💰 Tổng Doanh Thu" value={formatCurrency(totals.revenue)} icon={DollarSign}
                    status={totals.revenue > 0 ? "success" : "neutral"}
                    subValue={`${monthly.length} tháng data`} />
                <KPICard title="📊 Lãi/Lỗ Ròng" value={formatCurrency(totals.net)} icon={totals.net >= 0 ? TrendingUp : TrendingDown}
                    status={totals.net >= 0 ? "success" : "danger"}
                    subValue={`Margin: ${overallMargin.toFixed(1)}%`} />
                <KPICard title="📦 Đơn hàng" value={formatNumber(totals.orders)} icon={Package}
                    status="neutral" subValue={`AOV: ${formatCurrency(totals.orders > 0 ? totals.revenue / totals.orders : 0)}`} />
                <KPICard title="🎯 ROAS" value={`${overallRoas.toFixed(2)}x`} icon={Target}
                    status={overallRoas >= 2.5 ? "success" : overallRoas >= 1.5 ? "warning" : "danger"}
                    subValue={`Ads: ${formatCurrency(totals.ads)}`} />
                <KPICard title="👥 Marketers" value={String(marketers.length)} icon={Users}
                    status="neutral" subValue="Active" />
                <KPICard title="🌍 Markets" value={String(totals.markets)} icon={Globe}
                    status="neutral" subValue={markets.slice(0, 3).map(m => m.shop_name).join(", ")} />
            </div>

            {/* Cost Breakdown Banner */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">💸 Chi phí chi tiết</h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Ads Spend</div>
                        <div className="mt-1 text-lg font-bold text-amber-400">{formatCurrency(totals.ads)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">COGS</div>
                        <div className="mt-1 text-lg font-bold text-orange-400">—</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Shipping</div>
                        <div className="mt-1 text-lg font-bold text-cyan-400">—</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Tổng CP</div>
                        <div className="mt-1 text-lg font-bold text-rose-400">{formatCurrency(totals.ads)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Lãi ròng</div>
                        <div className={cn("mt-1 text-lg font-bold", totals.net >= 0 ? "text-emerald-400" : "text-rose-400")}>
                            {formatCurrency(totals.net)}
                        </div>
                    </div>
                </div>
            </div>

            {/* 3 Columns: Marketer / Product / Market Rankings */}
            <div className="grid gap-4 lg:grid-cols-3">
                {/* Marketer Ranking */}
                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        🏆 Marketer Ranking
                    </h3>
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="pb-2 text-left font-medium">#</th>
                                <th className="pb-2 text-left font-medium">Tên</th>
                                <th className="pb-2 text-right font-medium">ROAS</th>
                                <th className="pb-2 text-right font-medium">Net P&L</th>
                                <th className="pb-2 text-right font-medium">Grade</th>
                            </tr>
                        </thead>
                        <tbody>
                            {marketers.map((m, i) => {
                                const grade = gradeMarketer(m.roas, m.net_profit);
                                return (
                                    <tr key={m.marketer} className="border-b border-border/60">
                                        <td className="py-2 text-muted-foreground">{i + 1}</td>
                                        <td className="py-2 font-medium text-foreground">{m.marketer?.split(" ").slice(-2).join(" ")}</td>
                                        <td className={cn("py-2 text-right font-semibold", m.roas >= 2.5 ? "text-emerald-400" : "text-amber-400")}>
                                            {m.roas ? `${m.roas}x` : "—"}
                                        </td>
                                        <td className={cn("py-2 text-right font-semibold", m.net_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {m.net_profit >= 0 ? "+" : ""}{formatMoney(m.net_profit)}
                                        </td>
                                        <td className="py-2 text-right">
                                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", grade.color)}>
                                                {grade.label}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {marketers.length === 0 && (
                                <tr><td colSpan={5} className="py-4 text-center text-muted-foreground italic">Chưa có dữ liệu marketer</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Product Ranking */}
                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-blue-400" />
                        📦 Product Ranking
                    </h3>
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="pb-2 text-left font-medium">SP</th>
                                <th className="pb-2 text-right font-medium">SL</th>
                                <th className="pb-2 text-right font-medium">Revenue</th>
                            </tr>
                        </thead>
                        <tbody>
                            {products.slice(0, 6).map((p, i) => (
                                <tr key={i} className="border-b border-border/60">
                                    <td className="py-2 font-medium text-foreground max-w-[120px] truncate" title={p.product_name}>
                                        {p.product_name?.substring(0, 20)}
                                    </td>
                                    <td className="py-2 text-right text-blue-400">{p.quantity}</td>
                                    <td className="py-2 text-right text-emerald-400">{formatMoney(p.revenue)}</td>
                                </tr>
                            ))}
                            {products.length === 0 && (
                                <tr><td colSpan={3} className="py-4 text-center text-muted-foreground italic">Chưa có dữ liệu sản phẩm</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Market Ranking */}
                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-cyan-400" />
                        🌍 Market Ranking
                    </h3>
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="pb-2 text-left font-medium">Market</th>
                                <th className="pb-2 text-right font-medium">Revenue</th>
                                <th className="pb-2 text-right font-medium">Orders</th>
                                <th className="pb-2 text-right font-medium">Margin</th>
                            </tr>
                        </thead>
                        <tbody>
                            {markets.map((m) => (
                                <tr key={m.shop_name} className="border-b border-border/60">
                                    <td className="py-2 font-medium text-foreground">{m.shop_name}</td>
                                    <td className="py-2 text-right">{formatMoney(m.revenue)}</td>
                                    <td className="py-2 text-right">{formatNumber(m.orders)}</td>
                                    <td className={cn("py-2 text-right font-semibold",
                                        m.margin >= 50 ? "text-emerald-400" : m.margin >= 30 ? "text-amber-400" : "text-rose-400")}>
                                        {m.margin}%
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Monthly P&L Chart */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="h-2 w-2 rounded-full bg-indigo-400" />
                    📅 Monthly P&L Trend
                </h3>
                <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={monthly}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => formatVNDCompact(v)} />
                        <Tooltip
                            contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                            labelStyle={{ color: "#e2e8f0" }}
                            formatter={(v: number) => [formatVNDCompact(v), ""]}
                        />
                        <Legend />
                        <Bar dataKey="revenue" name="Revenue" fill="#34d399" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="ads_spend" name="Ads Spend" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                        <Line type="monotone" dataKey="net_profit" name="Net Profit" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4 }} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            {/* Monthly P&L Table */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">📋 Monthly P&L Detail</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-3 pb-2 text-left font-medium">Tháng</th>
                                <th className="px-3 pb-2 text-right font-medium">Đơn</th>
                                <th className="px-3 pb-2 text-right font-medium">Revenue</th>
                                <th className="px-3 pb-2 text-right font-medium">Ads Spend</th>
                                <th className="px-3 pb-2 text-right font-medium">Net Profit</th>
                                <th className="px-3 pb-2 text-right font-medium">Margin%</th>
                            </tr>
                        </thead>
                        <tbody>
                            {monthly.map((m) => {
                                const margin = m.revenue > 0 ? ((m.net_profit / m.revenue) * 100) : 0;
                                return (
                                    <tr key={m.month} className="border-b border-border/60 hover:bg-gray-50/50">
                                        <td className="px-3 py-2 font-medium text-foreground">{m.month}</td>
                                        <td className="px-3 py-2 text-right">{formatNumber(m.orders)}</td>
                                        <td className="px-3 py-2 text-right font-semibold text-emerald-400">{formatMoney(m.revenue)}</td>
                                        <td className="px-3 py-2 text-right text-amber-400">{formatMoney(m.ads_spend)}</td>
                                        <td className={cn("px-3 py-2 text-right font-bold", m.net_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {m.net_profit >= 0 ? "+" : ""}{formatMoney(m.net_profit)}
                                        </td>
                                        <td className={cn("px-3 py-2 text-right font-semibold", margin >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {margin.toFixed(1)}%
                                        </td>
                                    </tr>
                                );
                            })}
                            {/* Totals row */}
                            <tr className="border-t-2 border-amber-500/30 bg-amber-500/5 font-bold">
                                <td className="px-3 py-2 text-foreground">TỔNG</td>
                                <td className="px-3 py-2 text-right text-foreground">{formatNumber(totals.orders)}</td>
                                <td className="px-3 py-2 text-right text-emerald-400">{formatMoney(totals.revenue)}</td>
                                <td className="px-3 py-2 text-right text-amber-400">{formatMoney(totals.ads)}</td>
                                <td className={cn("px-3 py-2 text-right", totals.net >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {totals.net >= 0 ? "+" : ""}{formatMoney(totals.net)}
                                </td>
                                <td className={cn("px-3 py-2 text-right", overallMargin >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {overallMargin.toFixed(1)}%
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
