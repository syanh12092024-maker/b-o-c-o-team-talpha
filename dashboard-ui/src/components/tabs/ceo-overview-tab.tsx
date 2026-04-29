"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, Cell,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency, formatNumber, formatMoney, COLORS, cn } from "@/lib/utils";
import { DATASET } from "@/lib/constants";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { resolveMarketerName, isRealMarketer } from "@/lib/marketer-map";
import {
    Crown, TrendingUp, TrendingDown, DollarSign,
    Users, Globe, Package, Target, Warehouse,
} from "lucide-react";

interface CeoOverviewTabProps {
    dateRange?: { from: Date; to: Date };
    projectId?: string;
}

interface MonthlyPnl {
    month: string;
    orders: number;
    success: number;
    returned: number;
    revenue: number;
    ads_spend: number;
    cogs: number;
    shipping: number;
    net_profit: number;
}

interface MarketerRank {
    marketer_name: string;
    orders: number;
    success: number;
    revenue: number;
    ads_spend: number;
    net_profit: number;
    roas: number;
    sr: number;
}

interface ProductRank {
    product_code: string;
    product_name: string;
    revenue: number;
    margin: number;
    gross_profit: number;
    ads_spend: number;
}

interface MarketRank {
    market: string;
    orders: number;
    revenue: number;
    margin: number;
    ads_spend: number;
}



function gradeMarketer(roas: number, netProfit: number): { label: string; color: string } {
    if (roas >= 5) return { label: "A+", color: "bg-emerald-500/20 text-emerald-400" };
    if (roas >= 3.5) return { label: "A", color: "bg-emerald-500/15 text-emerald-400" };
    if (roas >= 2.5) return { label: "B+", color: "bg-amber-500/15 text-amber-400" };
    if (netProfit < 0) return { label: "C", color: "bg-rose-500/15 text-rose-400" };
    return { label: "B", color: "bg-blue-500/15 text-blue-400" };
}

function gradeProduct(margin: number, returnRate?: number): { label: string; color: string } {
    if (margin >= 60) return { label: "⭐ Star", color: "bg-emerald-500/20 text-emerald-400" };
    if (margin >= 40) return { label: "Tốt", color: "bg-emerald-500/15 text-emerald-400" };
    if (margin >= 20) return { label: "Trung bình", color: "bg-amber-500/15 text-amber-400" };
    return { label: "Lỗ", color: "bg-rose-500/15 text-rose-400" };
}

export default function CeoOverviewTab({ dateRange, projectId }: CeoOverviewTabProps) {
    const [loading, setLoading] = useState(true);
    const [monthly, setMonthly] = useState<MonthlyPnl[]>([]);
    const [marketers, setMarketers] = useState<MarketerRank[]>([]);
    const [products, setProducts] = useState<ProductRank[]>([]);
    const [markets, setMarkets] = useState<MarketRank[]>([]);
    const [stock, setStock] = useState<any[]>([]);


    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    // Q0: Monthly P&L
                    `SELECT
                        FORMAT_DATE('%Y-%m', report_date) as month,
                        SUM(total_orders) as orders,
                        SUM(success_orders) as success,
                        SUM(returned_orders) as returned,
                        ROUND(SUM(revenue_success),0) as revenue,
                        ROUND(SUM(ads_spend_ron),0) as ads_spend,
                        ROUND(SUM(cogs),0) as cogs,
                        ROUND(SUM(shipping_cost),0) as shipping,
                        ROUND(SUM(net_profit),0) as net_profit
                    FROM ${DATASET}.vw_fact_daily_pnl_v2
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                    GROUP BY 1 ORDER BY 1`,

                    // Q1: Marketer ranking
                    `SELECT
                        marketer_name,
                        SUM(total_orders) as orders,
                        SUM(success_orders) as success,
                        ROUND(SUM(delivered_revenue),0) as revenue,
                        ROUND(SUM(ads_spend_ron),0) as ads_spend,
                        ROUND(SUM(net_profit),0) as net_profit,
                        ROUND(SAFE_DIVIDE(SUM(delivered_revenue), NULLIF(SUM(ads_spend_ron),0)),2) as roas,
                        ROUND(SAFE_DIVIDE(SUM(success_orders)*100, NULLIF(SUM(total_orders),0)),1) as sr
                    FROM ${DATASET}.mart_performance_master
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                        AND marketer_name IS NOT NULL
                    GROUP BY 1 ORDER BY revenue DESC`,

                    // Q2: Product ranking — project-aware
                    projectId === 'AUUS1'
                        ? `WITH items_per_order AS (
                        SELECT order_id, COUNT(*) as item_count
                        FROM ${DATASET}.fact_order_items_dedup GROUP BY 1
                    ),
                    au_items AS (
                        SELECT pt.custom_id as product_code, pt.name as product_name,
                            o.status_group, SAFE_DIVIDE(o.revenue_L3_success, ipo.item_count) as item_rev
                        FROM ${DATASET}.fact_order_items_dedup oi
                        INNER JOIN ${DATASET}.product_template pt ON CAST(oi.product_id AS STRING) = CAST(pt.id AS STRING)
                        JOIN ${DATASET}.vw_fact_orders o ON oi.order_id = o.order_id
                        LEFT JOIN items_per_order ipo ON oi.order_id = ipo.order_id
                        WHERE o.order_date BETWEEN '${from}' AND '${to}'
                    ),
                    us_items AS (
                        SELECT pt.custom_id as product_code, pt.name as product_name,
                            o.status_group, SAFE_DIVIDE(o.revenue_L3_success, ipo.item_count) as item_rev
                        FROM ${DATASET}.fact_order_items_dedup oi
                        INNER JOIN ${DATASET}.product_template pt
                            ON pt.custom_id = COALESCE(
                                REGEXP_EXTRACT(oi.variation_name, r'(\\d{3})'),
                                REGEXP_EXTRACT(oi.variation_name, r'^([A-Z]{2,})')
                            )
                        JOIN ${DATASET}.vw_fact_orders o ON oi.order_id = o.order_id
                        LEFT JOIN items_per_order ipo ON oi.order_id = ipo.order_id
                        WHERE o.order_date BETWEEN '${from}' AND '${to}' AND oi.shop_name = 'US'
                    ),
                    all_items AS (SELECT * FROM au_items UNION ALL SELECT * FROM us_items)
                    SELECT product_code, product_name,
                        ROUND(SUM(CASE WHEN status_group = 'success' THEN item_rev ELSE 0 END),0) as revenue,
                        0 as margin,
                        ROUND(SUM(CASE WHEN status_group = 'success' THEN item_rev ELSE 0 END),0) as gross_profit,
                        0 as ads_spend
                    FROM all_items
                    GROUP BY 1,2 ORDER BY revenue DESC
                    LIMIT 10`
                        : `WITH items_per_order AS (
                        SELECT order_id, COUNT(*) as item_count
                        FROM ${DATASET}.fact_order_items_dedup GROUP BY 1
                    )
                    SELECT pt.custom_id as product_code, pt.name as product_name,
                        ROUND(SUM(CASE WHEN o.status_group = 'success' THEN SAFE_DIVIDE(o.revenue_L3_success, ipo.item_count) ELSE 0 END),0) as revenue,
                        0 as margin,
                        ROUND(SUM(CASE WHEN o.status_group = 'success' THEN SAFE_DIVIDE(o.revenue_L3_success, ipo.item_count) ELSE 0 END),0) as gross_profit,
                        0 as ads_spend
                    FROM ${DATASET}.fact_order_items_dedup oi
                    INNER JOIN ${DATASET}.product_template pt ON CAST(oi.product_id AS STRING) = CAST(pt.id AS STRING)
                    JOIN ${DATASET}.vw_fact_orders o ON oi.order_id = o.order_id
                    LEFT JOIN items_per_order ipo ON oi.order_id = ipo.order_id
                    WHERE o.order_date BETWEEN '${from}' AND '${to}'
                    GROUP BY 1,2 ORDER BY revenue DESC
                    LIMIT 10`,

                    // Q3: Market ranking from mart_market_intelligence
                    `SELECT
                        market,
                        SUM(total_orders) as orders,
                        ROUND(COALESCE(SUM(revenue_success),0),0) as revenue,
                        ROUND(AVG(COALESCE(market_roas,0)),1) as margin,
                        ROUND(COALESCE(SUM(ads_spend_ron),0),0) as ads_spend
                    FROM ${DATASET}.mart_market_intelligence
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                        AND market IS NOT NULL AND market != 'Unknown'
                    GROUP BY 1 ORDER BY revenue DESC
                    LIMIT 10`,

                    // Q4: Ads spend by marketer code from vw_fact_ads_performance
                    `SELECT
                        campaign_mkter_code as mkter_code,
                        ROUND(SUM(spend_ron),0) as ads_spend
                    FROM ${DATASET}.vw_fact_ads_performance
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                    GROUP BY 1`,

                    // Q5: Stock levels — query product_stock directly (view was unreliable)
                    // Uses `quantity` column (compatible with both project schemas)
                    `SELECT
                        COALESCE(pt.custom_id, REGEXP_EXTRACT(ps.product_name, r'^([A-Z]\\d+)')) as product_code,
                        ps.product_name,
                        SUM(SAFE_CAST(ps.quantity AS INT64)) as stock_qty,
                        COUNT(DISTINCT ps.variation_id) as variations,
                        ROUND(SUM(SAFE_CAST(ps.quantity AS INT64) * SAFE_CAST(ps.retail_price AS FLOAT64) / 100),0) as retail_value,
                        ROUND(SUM(SAFE_CAST(ps.quantity AS INT64) * SAFE_CAST(ps.avg_cost AS FLOAT64) / 100),0) as cost_value
                    FROM ${DATASET}.product_stock ps
                    LEFT JOIN ${DATASET}.product_template pt ON ps.product_id = pt.id
                    GROUP BY 1, 2
                    ORDER BY stock_qty DESC
                    LIMIT 20`,
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

                setMonthly(results[0].data || []);

                // Merge marketer P&L with real ads, using CANONICAL names
                const mkterPnl = results[1].data || [];
                const adsPerCode = results[4]?.data || [];
                const adsByName = new Map<string, number>();
                adsPerCode.forEach((row: any) => {
                    const name = resolveMarketerName(row.mkter_code || "");
                    if (!isRealMarketer(name)) return;
                    adsByName.set(name, (adsByName.get(name) || 0) + (row.ads_spend || 0));
                });

                // Also aggregate mart P&L by canonical name
                const pnlByName = new Map<string, any>();
                mkterPnl.forEach((m: any) => {
                    const name = resolveMarketerName(m.marketer_name || "");
                    if (!isRealMarketer(name)) return;
                    const prev = pnlByName.get(name) || { orders: 0, success: 0, revenue: 0, ads_spend: 0, net_profit: 0, sr: 0, cogs: 0, shipping: 0 };
                    pnlByName.set(name, {
                        orders: prev.orders + (m.orders || 0),
                        success: prev.success + (m.success || 0),
                        revenue: prev.revenue + (m.revenue || 0),
                        ads_spend: 0, // will be replaced by real ads
                        net_profit: 0,
                        sr: m.sr || 0,
                        cogs: prev.cogs + (m.cogs || 0),
                        shipping: prev.shipping + (m.shipping || 0),
                    });
                });

                // Merge into final marketer list
                const allNames = new Set([...pnlByName.keys(), ...adsByName.keys()]);
                const mergedMarketers: MarketerRank[] = [];
                allNames.forEach((name) => {
                    const pnl = pnlByName.get(name) || { orders: 0, success: 0, revenue: 0, cogs: 0, shipping: 0 };
                    const realAds = adsByName.get(name) || 0;
                    const revenue = pnl.revenue || 0;
                    const roas = realAds > 0 ? Math.round((revenue / realAds) * 100) / 100 : 0;
                    const sr = pnl.orders > 0 ? Math.round((pnl.success / pnl.orders) * 1000) / 10 : 0;
                    const net_profit = revenue - (pnl.cogs || 0) - (pnl.shipping || 0) - realAds;
                    mergedMarketers.push({
                        marketer_name: name,
                        orders: pnl.orders, success: pnl.success,
                        revenue, ads_spend: realAds,
                        net_profit, roas, sr,
                    });
                });
                mergedMarketers.sort((a, b) => b.revenue - a.revenue);
                setMarketers(mergedMarketers);

                setProducts(results[2].data || []);
                setMarkets(results[3].data || []);
                setStock(results[5]?.data || []);

            } catch (error) {
                console.error("CEO Overview fetch error:", error);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [dateRange]);

    if (loading) {
        return <TabSkeleton cards={6} showChart={true} rows={5} />;
    }

    // Aggregates
    const totals = monthly.reduce(
        (acc, m) => ({
            revenue: acc.revenue + m.revenue,
            ads: acc.ads + m.ads_spend,
            cogs: acc.cogs + m.cogs,
            shipping: acc.shipping + m.shipping,
            net: acc.net + m.net_profit,
            orders: acc.orders + m.orders,
            success: acc.success + m.success,
        }),
        { revenue: 0, ads: 0, cogs: 0, shipping: 0, net: 0, orders: 0, success: 0 }
    );

    const overallRoas = totals.ads > 0 ? (totals.revenue / totals.ads) : 0;
    const overallMargin = totals.revenue > 0 ? ((totals.net / totals.revenue) * 100) : 0;

    return (
        <div className="space-y-6">
            {/* KPI Row */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard
                    title="💰 Tổng Doanh Thu"
                    value={formatCurrency(totals.revenue)}
                    icon={DollarSign}
                    status={totals.revenue > 0 ? "success" : "neutral"}
                    subValue={`${monthly.length} tháng data`}
                />
                <KPICard
                    title="📊 Lãi/Lỗ Ròng"
                    value={formatCurrency(totals.net)}
                    icon={totals.net >= 0 ? TrendingUp : TrendingDown}
                    status={totals.net >= 0 ? "success" : "danger"}
                    subValue={`Margin: ${overallMargin.toFixed(1)}%`}
                />
                <KPICard
                    title="📦 Đơn / Thành công"
                    value={`${formatNumber(totals.success)} / ${formatNumber(totals.orders)}`}
                    icon={Package}
                    status="neutral"
                    subValue={`SR: ${totals.orders > 0 ? ((totals.success / totals.orders) * 100).toFixed(1) : 0}%`}
                />
                <KPICard
                    title="🎯 ROAS"
                    value={`${overallRoas.toFixed(2)}x`}
                    icon={Target}
                    status={overallRoas >= 2.5 ? "success" : overallRoas >= 1.5 ? "warning" : "danger"}
                    subValue={`Ads: ${formatCurrency(totals.ads)}`}
                />
                <KPICard
                    title="👥 Marketers"
                    value={String(marketers.length)}
                    icon={Users}
                    status="neutral"
                    subValue="Active"
                />
                <KPICard
                    title="🌍 Markets"
                    value={String(markets.length)}
                    icon={Globe}
                    status="neutral"
                    subValue={markets.slice(0, 3).map((m) => m.market).join(", ")}
                />
            </div>

            {/* Cost breakdown banner */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">💸 Chi phí chi tiết</h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Ads Spend</div>
                        <div className="mt-1 text-lg font-bold text-amber-400">{formatCurrency(totals.ads)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">COGS</div>
                        <div className="mt-1 text-lg font-bold text-orange-400">{formatCurrency(totals.cogs)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Shipping</div>
                        <div className="mt-1 text-lg font-bold text-cyan-400">{formatCurrency(totals.shipping)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Tổng CP</div>
                        <div className="mt-1 text-lg font-bold text-rose-400">{formatCurrency(totals.ads + totals.cogs + totals.shipping)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Lãi ròng</div>
                        <div className={cn("mt-1 text-lg font-bold", totals.net >= 0 ? "text-emerald-400" : "text-rose-400")}>
                            {formatCurrency(totals.net)}
                        </div>
                    </div>
                </div>
            </div>

            {/* 3 Columns: Marketer / Product / Market */}
            <div className="grid gap-4 lg:grid-cols-3">
                {/* Marketer Ranking */}
                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        🏆 Marketer Ranking
                    </h3>
                    <div className="space-y-0">
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
                                    const grade = gradeMarketer(m.roas || 0, m.net_profit);
                                    return (
                                        <tr key={m.marketer_name} className="border-b border-border/60">
                                            <td className="py-2 text-muted-foreground">{i + 1}</td>
                                            <td className="py-2 font-medium text-foreground">{m.marketer_name?.split(" ").slice(-2).join(" ")}</td>
                                            <td className={cn("py-2 text-right font-semibold", (m.roas || 0) >= 2.5 ? "text-emerald-400" : "text-amber-400")}>
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
                            </tbody>
                        </table>
                    </div>
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
                                <th className="pb-2 text-right font-medium">Revenue</th>
                                <th className="pb-2 text-right font-medium">Margin</th>
                                <th className="pb-2 text-right font-medium">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {products.slice(0, 6).map((p) => {
                                const grade = gradeProduct(p.margin || 0);
                                return (
                                    <tr key={p.product_code} className="border-b border-border/60">
                                        <td className="py-2 font-medium text-foreground" title={p.product_name}>{p.product_code || p.product_name?.substring(0, 10)}</td>
                                        <td className="py-2 text-right">{formatMoney(p.revenue)}</td>
                                        <td className={cn("py-2 text-right font-semibold", (p.margin || 0) >= 40 ? "text-emerald-400" : (p.margin || 0) >= 20 ? "text-amber-400" : "text-rose-400")}>
                                            {p.margin != null ? `${p.margin}%` : "—"}
                                        </td>
                                        <td className="py-2 text-right">
                                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", grade.color)}>
                                                {grade.label}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
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
                            {markets.slice(0, 6).map((m) => (
                                <tr key={m.market} className="border-b border-border/60">
                                    <td className="py-2 font-medium text-foreground">{m.market}</td>
                                    <td className="py-2 text-right">{formatMoney(m.revenue)}</td>
                                    <td className="py-2 text-right">{formatNumber(m.orders)}</td>
                                    <td className={cn("py-2 text-right font-semibold", (m.margin || 0) >= 50 ? "text-emerald-400" : (m.margin || 0) >= 30 ? "text-amber-400" : "text-rose-400")}>
                                        {m.margin != null ? `${m.margin}%` : "—"}
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
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <Tooltip
                            contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                            labelStyle={{ color: "#e2e8f0" }}
                        />
                        <Legend />
                        <Bar dataKey="revenue" name="Revenue" fill="#34d399" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="ads_spend" name="Ads Spend" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="cogs" name="COGS" fill="#f97316" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="shipping" name="Shipping" fill="#06b6d4" radius={[4, 4, 0, 0]} />
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
                                <th className="px-3 pb-2 text-right font-medium">Thành công</th>
                                <th className="px-3 pb-2 text-right font-medium">SR%</th>
                                <th className="px-3 pb-2 text-right font-medium">Revenue</th>
                                <th className="px-3 pb-2 text-right font-medium">Ads Spend</th>
                                <th className="px-3 pb-2 text-right font-medium">COGS</th>
                                <th className="px-3 pb-2 text-right font-medium">Shipping</th>
                                <th className="px-3 pb-2 text-right font-medium">Tổng CP</th>
                                <th className="px-3 pb-2 text-right font-medium">Net Profit</th>
                                <th className="px-3 pb-2 text-right font-medium">Margin%</th>
                            </tr>
                        </thead>
                        <tbody>
                            {monthly.map((m) => {
                                const totalCost = m.ads_spend + m.cogs + m.shipping;
                                const margin = m.revenue > 0 ? ((m.net_profit / m.revenue) * 100) : 0;
                                const sr = m.orders > 0 ? ((m.success / m.orders) * 100) : 0;
                                return (
                                    <tr key={m.month} className="border-b border-border/60 hover:bg-gray-50/50">
                                        <td className="px-3 py-2 font-medium text-foreground">{m.month}</td>
                                        <td className="px-3 py-2 text-right">{formatNumber(m.orders)}</td>
                                        <td className="px-3 py-2 text-right">{formatNumber(m.success)}</td>
                                        <td className={cn("px-3 py-2 text-right font-semibold", sr >= 45 ? "text-emerald-400" : "text-amber-400")}>
                                            {sr.toFixed(1)}%
                                        </td>
                                        <td className="px-3 py-2 text-right font-semibold text-emerald-400">{formatMoney(m.revenue)}</td>
                                        <td className="px-3 py-2 text-right text-amber-400">{formatMoney(m.ads_spend)}</td>
                                        <td className="px-3 py-2 text-right text-orange-400">{formatMoney(m.cogs)}</td>
                                        <td className="px-3 py-2 text-right text-cyan-400">{formatMoney(m.shipping)}</td>
                                        <td className="px-3 py-2 text-right text-rose-400">{formatMoney(totalCost)}</td>
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
                            <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                <td className="px-3 py-2 text-foreground">TỔNG</td>
                                <td className="px-3 py-2 text-right text-foreground">{formatNumber(totals.orders)}</td>
                                <td className="px-3 py-2 text-right text-foreground">{formatNumber(totals.success)}</td>
                                <td className="px-3 py-2 text-right text-foreground">
                                    {totals.orders > 0 ? ((totals.success / totals.orders) * 100).toFixed(1) : "0"}%
                                </td>
                                <td className="px-3 py-2 text-right text-emerald-400">{formatMoney(totals.revenue)}</td>
                                <td className="px-3 py-2 text-right text-amber-400">{formatMoney(totals.ads)}</td>
                                <td className="px-3 py-2 text-right text-orange-400">{formatMoney(totals.cogs)}</td>
                                <td className="px-3 py-2 text-right text-cyan-400">{formatMoney(totals.shipping)}</td>
                                <td className="px-3 py-2 text-right text-rose-400">{formatMoney(totals.ads + totals.cogs + totals.shipping)}</td>
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

            {/* ── Stock / Inventory ── */}
            <div className="rounded-xl border border-border bg-gray-50 p-5">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-foreground">
                    <Warehouse className="h-5 w-5 text-cyan-400" /> Tồn Kho (POS)
                </h3>
                {stock.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">Chưa có dữ liệu tồn kho — đang chờ sync từ POS webhook.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-left text-xs uppercase text-gray-400">
                                    <th className="px-3 py-2">Mã SP</th>
                                    <th className="px-3 py-2">Tên sản phẩm</th>
                                    <th className="px-3 py-2 text-right">Tồn kho</th>
                                    <th className="px-3 py-2 text-right">Biến thể</th>
                                    <th className="px-3 py-2 text-right">GT Bán lẻ</th>
                                    <th className="px-3 py-2 text-center">Trạng thái</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stock.map((s: any, i: number) => {
                                    const qty = s.stock_qty || 0;
                                    const status = qty <= 0 ? { label: "Hết hàng", color: "bg-rose-500/20 text-rose-400" }
                                        : qty <= 5 ? { label: "Sắp hết", color: "bg-amber-500/20 text-amber-400" }
                                            : qty <= 20 ? { label: "Trung bình", color: "bg-blue-500/20 text-blue-400" }
                                                : { label: "Đủ hàng", color: "bg-emerald-500/20 text-emerald-400" };
                                    return (
                                        <tr key={i} className="border-b border-white/5 hover:bg-gray-50">
                                            <td className="px-3 py-2 font-mono text-emerald-300">{s.product_code}</td>
                                            <td className="px-3 py-2 text-foreground">{s.product_name}</td>
                                            <td className="px-3 py-2 text-right font-bold text-foreground">{formatNumber(qty)}</td>
                                            <td className="px-3 py-2 text-right text-gray-400">{s.variations}</td>
                                            <td className="px-3 py-2 text-right text-cyan-400">{formatNumber(s.retail_value || 0)}</td>
                                            <td className="px-3 py-2 text-center">
                                                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", status.color)}>
                                                    {status.label}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

        </div>
    );
}
