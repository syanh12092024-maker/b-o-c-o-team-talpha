"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, Cell,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency, formatNumber, formatMoney, COLORS, cn } from "../utils";
import { DATASET } from "../constants";
import { queryCeoMonthlyPnl, queryCeoMarketerPnl, queryCeoAdsByMarketer, queryMarketingDeliveredOrders } from "@/lib/bq-queries";
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
    revenue_shipped?: number;
}

interface MarketerRank {
    marketer_name: string;
    orders: number;
    success: number;
    revenue: number;
    ads_spend: number;
    net_profit: number;
    roas: number | null;
    sr: number;
}

interface ProductRank {
    product_code: string;
    product_name: string;
    revenue: number;
    margin: number;
    gross_profit: number;
    ads_spend: number;
    delivered: number;
}

interface MarketRank {
    market: string;
    orders: number;
    revenue: number;
    margin: number;
    ads_spend: number;
}



function gradeMarketer(roas: number | null, netProfit: number): { label: string; color: string } {
    if (roas != null && roas >= 5) return { label: "A+", color: "bg-emerald-500/20 text-emerald-400" };
    if (roas != null && roas >= 3.5) return { label: "A", color: "bg-emerald-500/15 text-emerald-400" };
    if (roas != null && roas >= 2.5) return { label: "B+", color: "bg-amber-500/15 text-amber-400" };
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
    const [totalRealAds, setTotalRealAds] = useState<number>(0);
    const [deliveredCount, setDeliveredCount] = useState(0);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    // Q0: Monthly P&L — AUUS1 COD model: use revenue_lead (orders in transit)
                    // delivered_revenue is near-zero because most recent orders aren't confirmed delivered
                    queryCeoMonthlyPnl(DATASET, from, to, "revenue_lead"),

                    // Q1: Marketer ranking — same revenue_lead column for consistency
                    queryCeoMarketerPnl(DATASET, from, to, "revenue_lead"),

                    // Q2: Product ranking — AUUS1 COD model
                    // Revenue = L1 lead (order placement value), not L3 success (only 2 confirmed deliveries)
                    // Sort by delivered (shipped orders) DESC — shows most active products first
                    projectId === 'AUUS1'
                        ? `WITH items_per_order AS (
                        SELECT order_id, COUNT(*) as item_count
                        FROM ${DATASET}.fact_order_items_dedup GROUP BY 1
                    ),
                    au_items AS (
                        SELECT pt.custom_id as product_code, pt.name as product_name,
                            o.status_group,
                            SAFE_DIVIDE(o.revenue_L1_lead, ipo.item_count) as item_rev,
                            COALESCE(oi.line_cogs, 0) as item_cogs
                        FROM ${DATASET}.fact_order_items_dedup oi
                        INNER JOIN ${DATASET}.product_template pt ON CAST(oi.product_id AS STRING) = CAST(pt.id AS STRING)
                        JOIN ${DATASET}.vw_fact_orders o ON oi.order_id = o.order_id
                        LEFT JOIN items_per_order ipo ON oi.order_id = ipo.order_id
                        WHERE o.order_date BETWEEN '${from}' AND '${to}'
                    ),
                    us_items AS (
                        SELECT
                            COALESCE(REGEXP_EXTRACT(oi.variation_name, r'(\\\\d{3})'), REGEXP_EXTRACT(oi.variation_name, r'^([A-Z]{2,})')) as product_code,
                            COALESCE(REGEXP_EXTRACT(oi.variation_name, r'(\\\\d{3})'), REGEXP_EXTRACT(oi.variation_name, r'^([A-Z]{2,})')) as product_name,
                            o.status_group,
                            SAFE_DIVIDE(o.revenue_L1_lead, ipo.item_count) as item_rev,
                            COALESCE(oi.line_cogs, 0) as item_cogs
                        FROM ${DATASET}.fact_order_items_dedup oi
                        JOIN ${DATASET}.vw_fact_orders o ON oi.order_id = o.order_id
                        LEFT JOIN items_per_order ipo ON oi.order_id = ipo.order_id
                        WHERE o.order_date BETWEEN '${from}' AND '${to}' AND oi.shop_name = 'US'
                          AND COALESCE(REGEXP_EXTRACT(oi.variation_name, r'(\\\\d{3})'), REGEXP_EXTRACT(oi.variation_name, r'^([A-Z]{2,})')) IS NOT NULL
                    ),
                    all_items AS (SELECT * FROM au_items UNION ALL SELECT * FROM us_items)
                    SELECT product_code,
                        ANY_VALUE(product_name) as product_name,
                        ROUND(SUM(item_rev), 0) as revenue,
                        ROUND(SAFE_DIVIDE(
                            SUM(CASE WHEN status_group IN ('shipping','success','returned') THEN item_rev ELSE 0 END) * 0.70 - SUM(item_cogs),
                            NULLIF(SUM(CASE WHEN status_group IN ('shipping','success','returned') THEN item_rev ELSE 0 END) * 0.70, 0)
                        ) * 100, 1) as margin,
                        ROUND(SUM(CASE WHEN status_group IN ('shipping','success','returned') THEN item_rev ELSE 0 END) * 0.70 - SUM(item_cogs), 0) as gross_profit,
                        0 as ads_spend,
                        COUNT(CASE WHEN status_group IN ('shipping','success','returned') THEN 1 END) as delivered
                    FROM all_items
                    WHERE product_code IS NOT NULL
                    GROUP BY 1
                    ORDER BY delivered DESC
                    LIMIT 10`
                        : `WITH items_per_order AS (
                        SELECT order_id, COUNT(*) as item_count
                        FROM ${DATASET}.fact_order_items_dedup GROUP BY 1
                    )
                    SELECT pt.custom_id as product_code, pt.name as product_name,
                        ROUND(SUM(SAFE_DIVIDE(o.revenue_L1_lead, ipo.item_count)),0) as revenue,
                        0 as margin,
                        ROUND(SUM(SAFE_DIVIDE(o.revenue_L1_lead, ipo.item_count)),0) as gross_profit,
                        0 as ads_spend,
                        COUNT(CASE WHEN o.status_group IN ('shipping','success','returned') THEN 1 END) as delivered
                    FROM ${DATASET}.fact_order_items_dedup oi
                    INNER JOIN ${DATASET}.product_template pt ON CAST(oi.product_id AS STRING) = CAST(pt.id AS STRING)
                    JOIN ${DATASET}.vw_fact_orders o ON oi.order_id = o.order_id
                    LEFT JOIN items_per_order ipo ON oi.order_id = ipo.order_id
                    WHERE o.order_date BETWEEN '${from}' AND '${to}'
                    GROUP BY 1,2
                    ORDER BY delivered DESC
                    LIMIT 10`,


                    // Q3: Market ranking — dùng vw_fact_orders trực tiếp để tính đúng COD margin
                    `WITH order_market AS (
                        SELECT
                            o.order_id,
                            CASE WHEN MAX(oi.shop_name) = 'US' THEN 'US' ELSE 'AU' END AS market,
                            MAX(o.status_group) AS status_group,
                            MAX(o.revenue_L1_lead) AS revenue_L1_lead
                        FROM ${DATASET}.vw_fact_orders o
                        LEFT JOIN ${DATASET}.fact_order_items_dedup oi ON o.order_id = oi.order_id
                        WHERE o.order_date BETWEEN '${from}' AND '${to}'
                        GROUP BY 1
                    ),
                    market_ads AS (
                        SELECT
                            UPPER(TRIM(campaign_market)) AS market,
                            ROUND(SUM(spend_ron), 0) AS ads_spend
                        FROM ${DATASET}.vw_fact_ads_performance
                        WHERE report_date BETWEEN '${from}' AND '${to}'
                          AND campaign_market IS NOT NULL AND campaign_market != 'Unknown'
                        GROUP BY 1
                    )
                    SELECT
                        o.market,
                        COUNT(*) AS orders,
                        ROUND(SUM(o.revenue_L1_lead), 0) AS revenue,
                        ROUND(SAFE_DIVIDE(
                            SUM(CASE WHEN o.status_group IN ('shipping','success','returned') THEN o.revenue_L1_lead ELSE 0 END) * 0.70
                                - COALESCE(MAX(a.ads_spend), 0),
                            NULLIF(SUM(CASE WHEN o.status_group IN ('shipping','success','returned') THEN o.revenue_L1_lead ELSE 0 END) * 0.70, 0)
                        ) * 100, 1) AS margin,
                        COALESCE(MAX(a.ads_spend), 0) AS ads_spend
                    FROM order_market o
                    LEFT JOIN market_ads a ON o.market = a.market
                    GROUP BY 1
                    ORDER BY revenue DESC
                    LIMIT 10`,

                    // Q4: Ads spend by marketer code from vw_fact_ads_performance
                    queryCeoAdsByMarketer(DATASET, from, to),

                    // Q5: Stock levels — AUUS1 product_stock has different schema (no retail_price/avg_cost/variation_id)
                    `SELECT
                        COALESCE(pt.custom_id, REGEXP_EXTRACT(ps.product_name, r'^([A-Z]\\d+)')) as product_code,
                        ps.product_name,
                        SUM(SAFE_CAST(ps.quantity AS INT64)) as stock_qty,
                        COUNT(*) as variations,
                        0 as retail_value,
                        0 as cost_value
                    FROM ${DATASET}.product_stock ps
                    LEFT JOIN ${DATASET}.product_template pt ON CAST(ps.product_id AS STRING) = CAST(pt.id AS STRING)
                    GROUP BY 1, 2
                    ORDER BY stock_qty DESC
                    LIMIT 20`,

                    // Q6: Delivered orders from vw_fact_orders
                    queryMarketingDeliveredOrders(DATASET, from, to),
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
                // Real total ads from vw_fact_ads_performance (more complete than mart)
                const realTotalAds = adsPerCode.reduce((sum: number, row: any) => sum + (row.ads_spend || 0), 0);
                setTotalRealAds(realTotalAds);
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
                    const prev = pnlByName.get(name) || { orders: 0, success: 0, revenue: 0, revenue_shipped: 0, ads_spend: 0, net_profit: 0, sr: 0, cogs: 0, shipping: 0 };
                    pnlByName.set(name, {
                        orders: prev.orders + (m.orders || 0),
                        success: prev.success + (m.success || 0),
                        revenue: prev.revenue + (m.revenue || 0),
                        revenue_shipped: prev.revenue_shipped + (m.revenue_shipped || 0),
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
                    // AUUS1 COD: expected collected = shipped × 70%, net = expected - costs
                    const expectedCollectedMkter = (pnl.revenue_shipped || 0) * 0.70;
                    // ROAS = expected collected / ads — dùng shipped×70% thay vì revenue_lead
                    const roas = realAds > 0 ? Math.round((expectedCollectedMkter / realAds) * 100) / 100 : null;
                    const sr = pnl.orders > 0 ? Math.round((pnl.success / pnl.orders) * 1000) / 10 : 0;
                    const net_profit = expectedCollectedMkter - (pnl.cogs || 0) - (pnl.shipping || 0) - realAds;
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

                // Q6: Delivered count
                const deliveredRow = results[6]?.data?.[0];
                setDeliveredCount(deliveredRow?.delivered_count || 0);

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
            revenue_shipped: acc.revenue_shipped + (m.revenue_shipped ?? 0),
        }),
        { revenue: 0, ads: 0, cogs: 0, shipping: 0, net: 0, orders: 0, success: 0, revenue_shipped: 0 }
    );

    const overallRoas = totalRealAds > 0 ? (totals.revenue / totalRealAds) : 0;
    // AUUS1 COD Margin: 1 - totalCost / (revenue_shipped × 70%)
    // revenue_shipped × 70% = expected collected revenue (COD ~70% success rate)
    const totalCost = totals.ads + totals.cogs + totals.shipping;
    const expectedCollected = (totals.revenue_shipped ?? 0) * 0.70;
    const overallMargin = expectedCollected > 0 ? ((1 - totalCost / expectedCollected) * 100) : 0;

    return (
        <div className="space-y-6">
            {/* KPI Row */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
                <KPICard
                    title="💰 Tổng Doanh Thu"
                    value={formatCurrency(totals.revenue)}
                    icon={DollarSign}
                    status={totals.revenue > 0 ? "success" : "neutral"}
                    subValue={`${monthly.length} tháng data`}
                />
                <KPICard
                    title="🚚 DT Đã Đi Đơn"
                    value={formatCurrency(totals.revenue_shipped)}
                    icon={Package}
                    status={totals.revenue_shipped > 0 ? "success" : "neutral"}
                    subValue={`${totals.revenue > 0 ? ((totals.revenue_shipped / totals.revenue) * 100).toFixed(1) : 0}% tổng DT`}
                />
                <KPICard
                    title="💵 DT Thực Nhận DK"
                    value={formatCurrency(expectedCollected)}
                    icon={DollarSign}
                    status={expectedCollected > totalCost ? "success" : "danger"}
                    subValue={`= Đã đi × 70%`}
                />
                <KPICard
                    title="📊 Lãi/Lỗ Ròng"
                    value={formatCurrency(expectedCollected - totalCost)}
                    icon={(expectedCollected - totalCost) >= 0 ? TrendingUp : TrendingDown}
                    status={(expectedCollected - totalCost) >= 0 ? "success" : "danger"}
                    subValue={`Margin: ${overallMargin.toFixed(1)}%`}
                />
                <KPICard
                    title="📦 Đơn / Thành công"
                    value={`${formatNumber(totals.success)} / ${formatNumber(totals.orders)}`}
                    icon={Package}
                    status="neutral"
                    subValue={`SR: ${totals.orders > 0 ? ((totals.success / totals.orders) * 100).toFixed(1) : 0}% • Giao: ${formatNumber(deliveredCount)}`}
                />
                <KPICard
                    title="🎯 ROAS"
                    value={`${overallRoas.toFixed(2)}x`}
                    icon={Target}
                    status={overallRoas >= 2.5 ? "success" : overallRoas >= 1.5 ? "warning" : "danger"}
                    subValue={`Ads: ${formatCurrency(totalRealAds)}`}
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
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Ads Spend</div>
                        <div className="mt-1 text-lg font-bold text-amber-400">{formatCurrency(totals.ads)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">COGS + Ship ($15/đơn)</div>
                        <div className="mt-1 text-lg font-bold text-orange-400">{formatCurrency(totals.cogs + totals.shipping)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Tổng CP</div>
                        <div className="mt-1 text-lg font-bold text-rose-400">{formatCurrency(totals.ads + totals.cogs + totals.shipping)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Lãi ròng</div>
                        <div className={cn("mt-1 text-lg font-bold", (expectedCollected - totalCost) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                            {formatCurrency(expectedCollected - totalCost)}
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
                                    <th className="pb-2 text-right font-medium">Lãi ước tính</th>
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
                                <th className="pb-2 text-right font-medium">Đơn đã đi</th>
                                <th className="pb-2 text-right font-medium">Revenue</th>
                                <th className="pb-2 text-right font-medium">Margin</th>
                                <th className="pb-2 text-right font-medium">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {products.slice(0, 6).map((p, i) => {
                                const grade = gradeProduct(p.margin || 0);
                                return (
                                    <tr key={`${p.product_code}-${i}`} className="border-b border-border/60">
                                        <td className="py-2 font-medium text-foreground" title={p.product_name}>{p.product_code || p.product_name?.substring(0, 10)}</td>
                                        <td className="py-2 text-right font-semibold text-sky-400">{formatNumber(p.delivered || 0)}</td>
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
                        <Bar dataKey="cogs" name="COGS+Ship" fill="#f97316" radius={[4, 4, 0, 0]} />
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
                                <th className="px-3 pb-2 text-right font-medium">Đã Giao*</th>
                                <th className="px-3 pb-2 text-right font-medium">SR%</th>
                                <th className="px-3 pb-2 text-right font-medium">Revenue</th>
                                <th className="px-3 pb-2 text-right font-medium">Ads Spend</th>
                                <th className="px-3 pb-2 text-right font-medium">COGS+Ship</th>
                                <th className="px-3 pb-2 text-right font-medium">Tổng CP</th>
                                <th className="px-3 pb-2 text-right font-medium">Net Profit</th>
                                <th className="px-3 pb-2 text-right font-medium">Margin%</th>
                            </tr>
                        </thead>
                        <tbody>
                            {monthly.map((m) => {
                                const expectedCollectedMonth = (m.revenue_shipped || 0) * 0.70;
                                const totalCost = m.ads_spend + m.cogs + m.shipping;
                                const netProfitMonth = expectedCollectedMonth - totalCost;
                                const margin = expectedCollectedMonth > 0 ? (netProfitMonth / expectedCollectedMonth * 100) : 0;
                                const sr = m.orders > 0 ? ((m.success / m.orders) * 100) : 0;
                                return (
                                    <tr key={m.month} className="border-b border-border/60 hover:bg-gray-50/50">
                                        <td className="px-3 py-2 font-medium text-foreground">{m.month}</td>
                                        <td className="px-3 py-2 text-right">{formatNumber(m.orders)}</td>
                                        <td className="px-3 py-2 text-right">{formatNumber(m.success)}</td>
                                        <td className="px-3 py-2 text-right text-sky-400">—</td>
                                        <td className={cn("px-3 py-2 text-right font-semibold", sr >= 45 ? "text-emerald-400" : "text-amber-400")}>
                                            {sr.toFixed(1)}%
                                        </td>
                                        <td className="px-3 py-2 text-right font-semibold text-emerald-400">{formatMoney(m.revenue)}</td>
                                        <td className="px-3 py-2 text-right text-amber-400">{formatMoney(m.ads_spend)}</td>
                                        <td className="px-3 py-2 text-right text-orange-400">{formatMoney(m.cogs + m.shipping)}</td>
                                        <td className="px-3 py-2 text-right text-rose-400">{formatMoney(totalCost)}</td>
                                        <td className={cn("px-3 py-2 text-right font-bold", netProfitMonth >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {netProfitMonth >= 0 ? "+" : ""}{formatMoney(netProfitMonth)}
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
                                <td className="px-3 py-2 text-right text-sky-400 font-bold">{formatNumber(deliveredCount)}</td>
                                <td className="px-3 py-2 text-right text-foreground">
                                    {totals.orders > 0 ? ((totals.success / totals.orders) * 100).toFixed(1) : "0"}%
                                </td>
                                <td className="px-3 py-2 text-right text-emerald-400">{formatMoney(totals.revenue)}</td>
                                <td className="px-3 py-2 text-right text-amber-400">{formatMoney(totals.ads)}</td>
                                <td className="px-3 py-2 text-right text-orange-400">{formatMoney(totals.cogs)}</td>
                                <td className="px-3 py-2 text-right text-cyan-400">{formatMoney(totals.shipping)}</td>
                                <td className="px-3 py-2 text-right text-rose-400">{formatMoney(totals.ads + totals.cogs + totals.shipping)}</td>
                                <td className={cn("px-3 py-2 text-right", (expectedCollected - totalCost) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {(expectedCollected - totalCost) >= 0 ? "+" : ""}{formatMoney(expectedCollected - totalCost)}
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
