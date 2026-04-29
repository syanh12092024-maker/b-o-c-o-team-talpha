"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Cell, ComposedChart, Line,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency, formatNumber, formatMoney, COLORS, cn } from "@/lib/utils";
import { DATASET, CURRENCY_SYMBOL } from "@/lib/constants";
import TabSkeleton from "@/components/ui/tab-skeleton";
import {
    Package, TrendingUp, TrendingDown, AlertTriangle, Star,
    Download, Warehouse, ArrowUpDown, Filter,
} from "lucide-react";

// Campaign product_code → POS SKU mapping
const CAMPAIGN_TO_SKU: Record<string, string> = {
    'MỌCTOC': '097', 'MỌC TÓC': '097', 'Mọc tóc': '097',
    'SERUMNHANSAM': '071', 'PAGEMOISERUMNHANSAM': '071',
    'Retinol Cream': '119', 'Kem xoá nhăn hồng': '119',
    'dầu gội  Fa Le Mei': '116',
    'Kem nở mông ngực': '114', 'AONGUC': 'BRA',
    'Đồng hồ 18k': '103',
    'Lotion tắm trắng': '112', 'Body Lotion': '112',
    'Hally Body Lotion': '088', 'kemchongnangI': '087',
};

interface ProductsTabProps {
    dateRange?: { from: Date; to: Date };
    projectId?: string;
}

interface ProductData {
    product_code: string;
    product_name: string;
    market: string;
    orders: number;
    delivered: number;
    returned: number;
    revenue: number;
    cogs: number;
    gross_profit: number;
    margin: number;
    ads_spend: number;
    return_rate: number;
    stock: number;
    sold_30d: number;
}

type SortKey = "revenue" | "margin" | "gross_profit" | "return_rate" | "stock" | "potential";
type FilterKey = "all" | "star" | "good" | "average" | "loss";

function gradeProduct(margin: number, returnRate: number): { label: string; cls: string; key: FilterKey } {
    if (margin >= 60 && returnRate < 20) return { label: "⭐ Star", cls: "bg-emerald-500/20 text-emerald-400", key: "star" };
    if (margin >= 40) return { label: "Tốt", cls: "bg-emerald-500/15 text-emerald-400", key: "good" };
    if (margin >= 20) return { label: "Trung bình", cls: "bg-amber-500/15 text-amber-400", key: "average" };
    if (margin > 0) return { label: "Yếu", cls: "bg-orange-500/15 text-orange-400", key: "average" };
    return { label: "🔻 Cắt lỗ", cls: "bg-rose-500/15 text-rose-400", key: "loss" };
}

function calcPotentialScore(p: ProductData): number {
    let score = 0;
    // Margin contribution (0-40 points)
    score += Math.min(40, Math.max(0, (p.margin || 0)));
    // Volume contribution (0-20 points)
    const dailySales = (p.sold_30d || 0) / 30;
    score += Math.min(20, dailySales * 2);
    // Return rate penalty (0 to -20)
    score -= Math.min(20, (p.return_rate || 0) * 0.5);
    // Stock health bonus (0-10)
    if (p.stock > 0 && dailySales > 0) {
        const daysOfStock = p.stock / dailySales;
        if (daysOfStock >= 15 && daysOfStock <= 60) score += 10;
        else if (daysOfStock > 0) score += 5;
    }
    // Revenue weight (0-10)
    score += Math.min(10, (p.revenue || 0) / 10000);
    return Math.max(0, Math.round(score));
}

function potentialLabel(score: number): { label: string; cls: string } {
    if (score >= 70) return { label: "🚀 Cao", cls: "text-emerald-400" };
    if (score >= 50) return { label: "📈 Khá", cls: "text-blue-400" };
    if (score >= 30) return { label: "⚖️ TB", cls: "text-amber-400" };
    return { label: "⚠️ Thấp", cls: "text-rose-400" };
}

const CHART_COLORS = ["#34d399", "#3b82f6", "#06b6d4", "#a855f7", "#f59e0b", "#ec4899", "#14b8a6", "#f97316"];

export default function ProductsTab({ dateRange, projectId }: ProductsTabProps) {
    const [loading, setLoading] = useState(true);
    const [products, setProducts] = useState<ProductData[]>([]);
    const [sortBy, setSortBy] = useState<SortKey>("revenue");
    const [sortAsc, setSortAsc] = useState(false);
    const [filterBy, setFilterBy] = useState<FilterKey>("all");

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                // Project-aware Q0 query: AUUS1 uses AU/US UNION ALL, others use simple join
                // Both paths now compute actual COGS from line_cogs and Ads from vw_fact_ads_performance
                const q0 = projectId === 'AUUS1' ? `WITH items_per_order AS (
                        SELECT order_id, COUNT(*) as item_count
                        FROM ${DATASET}.fact_order_items_dedup
                        GROUP BY 1
                    ),
                    au_items AS (
                        SELECT pt.custom_id as product_code, pt.name as product_name,
                            'AU' as market, oi.order_id, o.status_group,
                            SAFE_DIVIDE(o.revenue_L3_success, ipo.item_count) as item_revenue,
                            COALESCE(oi.line_cogs, 0) as item_cogs
                        FROM ${DATASET}.fact_order_items_dedup oi
                        INNER JOIN ${DATASET}.product_template pt ON CAST(oi.product_id AS STRING) = CAST(pt.id AS STRING)
                        JOIN ${DATASET}.vw_fact_orders o ON oi.order_id = o.order_id
                        LEFT JOIN items_per_order ipo ON oi.order_id = ipo.order_id
                        WHERE o.order_date BETWEEN '${from}' AND '${to}'
                    ),
                    us_items AS (
                        SELECT pt.custom_id as product_code, pt.name as product_name,
                            'US' as market, oi.order_id, o.status_group,
                            SAFE_DIVIDE(o.revenue_L3_success, ipo.item_count) as item_revenue,
                            COALESCE(oi.line_cogs, 0) as item_cogs
                        FROM ${DATASET}.fact_order_items_dedup oi
                        INNER JOIN ${DATASET}.product_template pt
                            ON pt.custom_id = COALESCE(
                                REGEXP_EXTRACT(oi.variation_name, r'(\\d{3})'),
                                REGEXP_EXTRACT(oi.variation_name, r'^([A-Z]{2,})')
                            )
                        JOIN ${DATASET}.vw_fact_orders o ON oi.order_id = o.order_id
                        LEFT JOIN items_per_order ipo ON oi.order_id = ipo.order_id
                        WHERE o.order_date BETWEEN '${from}' AND '${to}'
                          AND oi.shop_name = 'US'
                    ),
                    all_items AS (
                        SELECT * FROM au_items
                        UNION ALL
                        SELECT * FROM us_items
                    ),
                    product_ads AS (
                        SELECT campaign_product_code as product_code,
                            ROUND(SUM(spend_ron),0) as ads_spend
                        FROM ${DATASET}.vw_fact_ads_performance
                        WHERE report_date BETWEEN '${from}' AND '${to}'
                        GROUP BY 1
                    )
                    SELECT a.product_code, a.product_name, a.market,
                        COUNT(DISTINCT a.order_id) as orders,
                        COUNTIF(a.status_group = 'success') as delivered,
                        COUNTIF(a.status_group IN ('cancelled')) as returned,
                        ROUND(SUM(CASE WHEN a.status_group = 'success' THEN a.item_revenue ELSE 0 END),0) as revenue,
                        ROUND(SUM(a.item_cogs),0) as cogs,
                        ROUND(SUM(CASE WHEN a.status_group = 'success' THEN a.item_revenue ELSE 0 END) - SUM(a.item_cogs),0) as gross_profit,
                        ROUND(SAFE_DIVIDE(SUM(CASE WHEN a.status_group = 'success' THEN a.item_revenue ELSE 0 END) - SUM(a.item_cogs), NULLIF(SUM(CASE WHEN a.status_group = 'success' THEN a.item_revenue ELSE 0 END),0))*100, 1) as margin,
                        COALESCE(pa.ads_spend, 0) as ads_spend,
                        ROUND(SAFE_DIVIDE(COUNTIF(a.status_group IN ('cancelled')), NULLIF(COUNT(DISTINCT a.order_id),0))*100, 1) as return_rate
                    FROM all_items a
                    LEFT JOIN product_ads pa ON a.product_code = pa.product_code
                    GROUP BY 1,2,3, pa.ads_spend ORDER BY revenue DESC
                    LIMIT 60`
                    : `WITH items_per_order AS (
                        SELECT order_id, COUNT(*) as item_count
                        FROM ${DATASET}.fact_order_items_dedup
                        GROUP BY 1
                    ),
                    product_ads AS (
                        SELECT campaign_product_code as product_code,
                            ROUND(SUM(spend_ron),0) as ads_spend
                        FROM ${DATASET}.vw_fact_ads_performance
                        WHERE report_date BETWEEN '${from}' AND '${to}'
                        GROUP BY 1
                    )
                    SELECT pt.custom_id as product_code, pt.name as product_name,
                        oi.shop_name as market,
                        COUNT(DISTINCT oi.order_id) as orders,
                        COUNTIF(o.status_group = 'success') as delivered,
                        COUNTIF(o.status_group IN ('cancelled')) as returned,
                        ROUND(SUM(CASE WHEN o.status_group = 'success' THEN SAFE_DIVIDE(o.revenue_L3_success, ipo.item_count) ELSE 0 END),0) as revenue,
                        ROUND(SUM(COALESCE(oi.line_cogs, 0)),0) as cogs,
                        ROUND(SUM(CASE WHEN o.status_group = 'success' THEN SAFE_DIVIDE(o.revenue_L3_success, ipo.item_count) ELSE 0 END) - SUM(COALESCE(oi.line_cogs, 0)),0) as gross_profit,
                        ROUND(SAFE_DIVIDE(SUM(CASE WHEN o.status_group = 'success' THEN SAFE_DIVIDE(o.revenue_L3_success, ipo.item_count) ELSE 0 END) - SUM(COALESCE(oi.line_cogs, 0)), NULLIF(SUM(CASE WHEN o.status_group = 'success' THEN SAFE_DIVIDE(o.revenue_L3_success, ipo.item_count) ELSE 0 END),0))*100, 1) as margin,
                        COALESCE(pa.ads_spend, 0) as ads_spend,
                        ROUND(SAFE_DIVIDE(COUNTIF(o.status_group IN ('cancelled')), NULLIF(COUNT(DISTINCT oi.order_id),0))*100, 1) as return_rate
                    FROM ${DATASET}.fact_order_items_dedup oi
                    INNER JOIN ${DATASET}.product_template pt ON CAST(oi.product_id AS STRING) = CAST(pt.id AS STRING)
                    JOIN ${DATASET}.vw_fact_orders o ON oi.order_id = o.order_id
                    LEFT JOIN items_per_order ipo ON oi.order_id = ipo.order_id
                    LEFT JOIN product_ads pa ON pt.custom_id = pa.product_code
                    WHERE o.order_date BETWEEN '${from}' AND '${to}'
                    GROUP BY 1,2,3, pa.ads_spend ORDER BY revenue DESC
                    LIMIT 60`;

                const queries = [
                    q0,

                    // Q1: Stock levels from product_variations.remain_quantity
                    `SELECT
                        pt.custom_id as product_code,
                        SUM(SAFE_CAST(pv.remain_quantity AS INT64)) as total_stock
                    FROM ${DATASET}.product_variations pv
                    INNER JOIN ${DATASET}.product_template pt ON CAST(pv.product_id AS STRING) = CAST(pt.id AS STRING)
                    GROUP BY 1`,

                    // Q2: Sales velocity (30 days)
                    `SELECT
                        pt.custom_id as product_code,
                        SUM(SAFE_CAST(oi.quantity AS INT64)) as sold_30d
                    FROM ${DATASET}.fact_order_items_dedup oi
                    INNER JOIN ${DATASET}.product_template pt ON CAST(oi.product_id AS STRING) = CAST(pt.id AS STRING)
                    JOIN ${DATASET}.vw_fact_orders o ON oi.order_id = o.order_id
                    WHERE o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
                    GROUP BY 1`,

                    // Q3: Ads spend per campaign product code 
                    `SELECT
                        TRIM(SPLIT(CAST(campaign_name AS STRING), '/')[SAFE_OFFSET(2)]) as campaign_product,
                        ROUND(SUM(SAFE_CAST(spend AS FLOAT64)), 0) as ads_spend
                    FROM ${DATASET}.fb_ads_data
                    WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                    GROUP BY 1`,
                ];

                const results = await Promise.all(
                    queries.map((q) =>
                        fetch("/api/query", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q }),
                        }).then((r) => r.json()).catch(() => ({ data: [] }))
                    )
                );

                const productData: ProductData[] = (results[0].data || []);
                const stockMap = new Map((results[1].data || []).map((s: any) => [s.product_code, s.total_stock || 0]));
                const velocityMap = new Map((results[2].data || []).map((v: any) => [v.product_code, v.sold_30d || 0]));

                // Build ads spend map: campaign product → SKU → aggregate spend
                const adsSpendBySku = new Map<string, number>();
                (results[3]?.data || []).forEach((row: any) => {
                    const campProduct = (row.campaign_product || '').trim();
                    const sku = CAMPAIGN_TO_SKU[campProduct] || campProduct;
                    adsSpendBySku.set(sku, (adsSpendBySku.get(sku) || 0) + (row.ads_spend || 0));
                });

                // Enrich products with stock, velocity, and ads spend (fallback from Q3 only if Q0 had no ads)
                productData.forEach((p) => {
                    p.stock = (stockMap.get(p.product_code) as number) || 0;
                    p.sold_30d = (velocityMap.get(p.product_code) as number) || 0;
                    // Only use Q3 ads map as fallback if Q0 SQL returned 0
                    if (!p.ads_spend) {
                        p.ads_spend = (adsSpendBySku.get(p.product_code) as number) || 0;
                    }
                    // Only recalculate gross_profit if it hasn't been set by Q0
                    if (p.gross_profit === 0 && p.revenue > 0 && p.cogs > 0) {
                        p.gross_profit = p.revenue - p.cogs;
                    }
                });

                setProducts(productData);
            } catch (error) {
                console.error("Product data fetch error:", error);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [dateRange]);

    if (loading) {
        return <TabSkeleton cards={4} showChart={false} rows={8} />;
    }

    // Calculations
    const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
    const totalGross = products.reduce((s, p) => s + p.gross_profit, 0);
    const totalAds = products.reduce((s, p) => s + p.ads_spend, 0);
    const totalCogs = products.reduce((s, p) => s + p.cogs, 0);
    const netProfit = totalGross - totalAds;
    const avgMargin = totalRevenue > 0 ? ((totalGross / totalRevenue) * 100) : 0;

    const starCount = products.filter((p) => (p.margin || 0) >= 60 && (p.return_rate || 0) < 20).length;
    const goodCount = products.filter((p) => (p.margin || 0) >= 40 && !((p.margin || 0) >= 60 && (p.return_rate || 0) < 20)).length;
    const lossCount = products.filter((p) => (p.margin || 0) <= 0).length;

    // Sort & Filter
    const sortedProducts = [...products]
        .filter((p) => {
            if (filterBy === "all") return true;
            return gradeProduct(p.margin || 0, p.return_rate || 0).key === filterBy;
        })
        .sort((a, b) => {
            let va: number, vb: number;
            if (sortBy === "potential") {
                va = calcPotentialScore(a);
                vb = calcPotentialScore(b);
            } else {
                va = (a as any)[sortBy] || 0;
                vb = (b as any)[sortBy] || 0;
            }
            return sortAsc ? va - vb : vb - va;
        });

    // Chart data
    const top8 = products.filter((p) => p.revenue > 0).slice(0, 8);
    const revVsProfitChart = top8.map((p) => ({
        name: p.product_code || p.product_name?.substring(0, 10),
        revenue: p.revenue,
        gross_profit: p.gross_profit,
        ads_spend: p.ads_spend,
    }));

    const marginChart = top8.map((p) => ({
        name: p.product_code || p.product_name?.substring(0, 10),
        margin: p.margin || 0,
        return_rate: p.return_rate || 0,
        potential: calcPotentialScore(p),
    }));

    // Download CSV
    const downloadCSV = () => {
        const headers = ["Mã SP", "Tên SP", "Đơn hàng", "Giao", "Hoàn", `Revenue (${CURRENCY_SYMBOL})`, "COGS", "Gross Profit", "Margin%", "Ads Spend", "Net P&L", "Return%", "Tồn kho", "Bán 30d", "Potential", "Xếp hạng"];
        const rows = products.map((p) => {
            const netPnl = p.gross_profit - p.ads_spend;
            const grade = gradeProduct(p.margin || 0, p.return_rate || 0);
            const pot = calcPotentialScore(p);
            return [p.product_code, `"${(p.product_name || '').replace(/"/g, '""')}"`, p.orders, p.delivered, p.returned, p.revenue, p.cogs, p.gross_profit, p.margin, p.ads_spend, netPnl, p.return_rate, p.stock, p.sold_30d, pot, grade.label].join(",");
        });
        const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csv));
        link.setAttribute("download", `product_intelligence_${format(new Date(), "yyyy-MM-dd")}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleSort = (key: SortKey) => {
        if (sortBy === key) setSortAsc(!sortAsc);
        else { setSortBy(key); setSortAsc(false); }
    };

    const SortHeader = ({ label, sortKey, className = "" }: { label: string; sortKey: SortKey; className?: string }) => (
        <th
            className={cn("px-2 pb-2 font-medium cursor-pointer hover:text-foreground transition-colors select-none", className)}
            onClick={() => handleSort(sortKey)}
        >
            <span className="flex items-center gap-1 justify-end">
                {label}
                {sortBy === sortKey && <ArrowUpDown className="h-3 w-3 text-indigo-400" />}
            </span>
        </th>
    );

    return (
        <div className="space-y-6">
            {/* KPI Row */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard
                    title="⭐ Star Products"
                    value={String(starCount)}
                    icon={Star}
                    status="success"
                    subValue="Margin ≥60%, Return <20%"
                />
                <KPICard
                    title="💚 Sản phẩm tốt"
                    value={String(goodCount)}
                    icon={TrendingUp}
                    status="success"
                    subValue="Margin ≥40%"
                />
                <KPICard
                    title="🔻 Sản phẩm lỗ"
                    value={String(lossCount)}
                    icon={TrendingDown}
                    status={lossCount > 0 ? "danger" : "neutral"}
                    subValue="Margin ≤0%"
                />
                <KPICard
                    title="📊 Avg Margin"
                    value={`${avgMargin.toFixed(1)}%`}
                    icon={TrendingUp}
                    status={avgMargin >= 50 ? "success" : "warning"}
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

            {/* Charts Row */}
            <div className="grid gap-4 lg:grid-cols-2">
                {/* Revenue vs Profit vs Ads */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        📦 Revenue vs Profit vs Ads (Top 8)
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={revVsProfitChart} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis dataKey="name" type="category" tick={{ fill: "#94a3b8", fontSize: 10 }} width={70} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                            <Legend />
                            <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={12} />
                            <Bar dataKey="gross_profit" name="Gross Profit" fill="#34d399" radius={[0, 4, 4, 0]} barSize={12} />
                            <Bar dataKey="ads_spend" name="Ads Spend" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={12} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>

                {/* Margin + Return Rate + Potential */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-pink-400" />
                        📈 Margin % vs Return Rate vs Potential Score
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={marginChart}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                            <Legend />
                            <Bar dataKey="margin" name="Margin %" radius={[6, 6, 0, 0]}>
                                {marginChart.map((entry, i) => (
                                    <Cell key={i} fill={entry.margin >= 40 ? "#34d399" : entry.margin >= 0 ? "#f59e0b" : "#ef4444"} />
                                ))}
                            </Bar>
                            <Line type="monotone" dataKey="return_rate" name="Return %" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                            <Line type="monotone" dataKey="potential" name="Potential" stroke="#818cf8" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Full Product Intelligence Table */}
            <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Package className="h-4 w-4 text-indigo-400" />
                        Product Intelligence — P&L + Stock + Potential
                    </h3>
                    <div className="flex items-center gap-2">
                        {/* Filter buttons */}
                        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                            {[
                                { key: "all" as FilterKey, label: "Tất cả" },
                                { key: "star" as FilterKey, label: "⭐ Star" },
                                { key: "good" as FilterKey, label: "Tốt" },
                                { key: "average" as FilterKey, label: "TB" },
                                { key: "loss" as FilterKey, label: "Lỗ" },
                            ].map((f) => (
                                <button
                                    key={f.key}
                                    onClick={() => setFilterBy(f.key)}
                                    className={cn(
                                        "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                                        filterBy === f.key
                                            ? "bg-indigo-500/20 text-indigo-400"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={downloadCSV}
                            className="flex items-center gap-1.5 rounded-lg bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-400 hover:bg-indigo-500/20 transition-colors"
                        >
                            <Download className="h-3 w-3" />
                            Export CSV
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">Sản phẩm</th>
                                <th className="px-2 pb-2 text-center font-medium">TT</th>
                                <th className="px-2 pb-2 text-right font-medium">Đơn</th>
                                <th className="px-2 pb-2 text-right font-medium">Giao</th>
                                <th className="px-2 pb-2 text-right font-medium">Hoàn</th>
                                <SortHeader label="Revenue" sortKey="revenue" className="text-right" />
                                <th className="px-2 pb-2 text-right font-medium">COGS</th>
                                <SortHeader label="Gross P." sortKey="gross_profit" className="text-right" />
                                <SortHeader label="Margin%" sortKey="margin" className="text-right" />
                                <th className="px-2 pb-2 text-right font-medium">Ads</th>
                                <th className="px-2 pb-2 text-right font-medium">Net P&L</th>
                                <SortHeader label="Return%" sortKey="return_rate" className="text-right" />
                                <SortHeader label="Tồn kho" sortKey="stock" className="text-right" />
                                <th className="px-2 pb-2 text-right font-medium">30d Sales</th>
                                <SortHeader label="Potential" sortKey="potential" className="text-right" />
                                <th className="px-2 pb-2 text-right font-medium">Xếp hạng</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedProducts.map((p) => {
                                const netPnl = p.gross_profit - p.ads_spend;
                                const grade = gradeProduct(p.margin || 0, p.return_rate || 0);
                                const potScore = calcPotentialScore(p);
                                const pot = potentialLabel(potScore);
                                const dailySales = (p.sold_30d || 0) / 30;
                                const daysOfStock = dailySales > 0 ? Math.round(p.stock / dailySales) : 999;

                                return (
                                    <tr key={p.product_code + (p.market || '')} className="border-b border-border/30 hover:bg-gray-50/50 transition-colors">
                                        <td className="px-2 py-2.5">
                                            <div className="font-semibold text-foreground">{p.product_code}</div>
                                            <div className="text-[10px] text-muted-foreground max-w-[150px] truncate" title={p.product_name}>{p.product_name?.substring(0, 30)}</div>
                                        </td>
                                        <td className="px-2 py-2.5 text-center">
                                            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold',
                                                p.market === 'US' ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'
                                            )}>{p.market || '—'}</span>
                                        </td>
                                        <td className="px-2 py-2.5 text-right">{formatNumber(p.orders)}</td>
                                        <td className="px-2 py-2.5 text-right text-emerald-400">{formatNumber(p.delivered)}</td>
                                        <td className="px-2 py-2.5 text-right text-rose-400">{formatNumber(p.returned)}</td>
                                        <td className="px-2 py-2.5 text-right font-semibold text-blue-400">{formatMoney(p.revenue)}</td>
                                        <td className="px-2 py-2.5 text-right text-orange-400">{formatMoney(p.cogs)}</td>
                                        <td className={cn("px-2 py-2.5 text-right font-semibold", p.gross_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {p.gross_profit >= 0 ? "+" : ""}{formatMoney(p.gross_profit)}
                                        </td>
                                        <td className={cn("px-2 py-2.5 text-right font-bold",
                                            (p.margin || 0) >= 40 ? "text-emerald-400" : (p.margin || 0) >= 0 ? "text-amber-400" : "text-rose-400")}>
                                            {p.margin != null ? `${p.margin}%` : "—"}
                                        </td>
                                        <td className="px-2 py-2.5 text-right text-amber-400">{formatMoney(p.ads_spend)}</td>
                                        <td className={cn("px-2 py-2.5 text-right font-bold", netPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {netPnl >= 0 ? "+" : ""}{formatMoney(netPnl)}
                                        </td>
                                        <td className={cn("px-2 py-2.5 text-right", (p.return_rate || 0) >= 30 ? "text-rose-400 font-bold" : "text-muted-foreground")}>
                                            {p.return_rate != null ? `${p.return_rate}%` : "—"}
                                        </td>
                                        <td className="px-2 py-2.5 text-right">
                                            <div className="font-medium text-foreground">{formatNumber(p.stock)}</div>
                                            {dailySales > 0 && (
                                                <div className={cn("text-[10px]",
                                                    daysOfStock <= 7 ? "text-rose-400" : daysOfStock <= 14 ? "text-amber-400" : "text-muted-foreground"
                                                )}>
                                                    {daysOfStock}d left
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-2 py-2.5 text-right text-indigo-400 font-medium">
                                            {formatNumber(p.sold_30d || 0)}
                                        </td>
                                        <td className="px-2 py-2.5 text-right">
                                            <div className={cn("font-bold text-sm", pot.cls)}>{potScore}</div>
                                            <div className={cn("text-[10px]", pot.cls)}>{pot.label}</div>
                                        </td>
                                        <td className="px-2 py-2.5 text-right">
                                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap", grade.cls)}>
                                                {grade.label}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}

                            {/* Totals Row */}
                            <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                <td className="px-2 py-2.5 text-foreground">TỔNG {sortedProducts.length} SP</td>
                                <td className="px-2 py-2.5 text-right text-foreground">{formatNumber(sortedProducts.reduce((s, p) => s + p.orders, 0))}</td>
                                <td className="px-2 py-2.5 text-right text-emerald-400">{formatNumber(sortedProducts.reduce((s, p) => s + p.delivered, 0))}</td>
                                <td className="px-2 py-2.5 text-right text-rose-400">{formatNumber(sortedProducts.reduce((s, p) => s + p.returned, 0))}</td>
                                <td className="px-2 py-2.5 text-right text-blue-400">{formatMoney(sortedProducts.reduce((s, p) => s + p.revenue, 0))}</td>
                                <td className="px-2 py-2.5 text-right text-orange-400">{formatMoney(sortedProducts.reduce((s, p) => s + p.cogs, 0))}</td>
                                <td className={cn("px-2 py-2.5 text-right", totalGross >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {totalGross >= 0 ? "+" : ""}{formatMoney(totalGross)}
                                </td>
                                <td className="px-2 py-2.5 text-right text-foreground">{avgMargin.toFixed(1)}%</td>
                                <td className="px-2 py-2.5 text-right text-amber-400">{formatMoney(totalAds)}</td>
                                <td className={cn("px-2 py-2.5 text-right", netProfit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {netProfit >= 0 ? "+" : ""}{formatMoney(netProfit)}
                                </td>
                                <td className="px-2 py-2.5" colSpan={5}></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
