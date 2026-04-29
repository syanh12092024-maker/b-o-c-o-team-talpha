"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatNumber, COLORS } from "../utils";
import { DATASET } from "../constants";
import { Package, AlertTriangle, TrendingUp, Download } from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";

interface InventoryData {
    totalSkus: number;
    totalUnitsSold: number;
    totalUnitsReturned: number;
    returnRate: number;
    products: any[];
}

interface InventoryTabProps {
    dateRange?: { from: Date; to: Date };
}

export default function InventoryTab({ dateRange }: InventoryTabProps) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<InventoryData>({
        totalSkus: 0,
        totalUnitsSold: 0,
        totalUnitsReturned: 0,
        returnRate: 0,
        products: [],
    });

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const queries = [
                    // Q0: Product catalog with sales + product names from product_template/variations + stock
                    `SELECT
                        COALESCE(pt.name, pv.display_id, CAST(oi.product_id AS STRING)) as product_name,
                        COALESCE(pt.custom_id, CAST(oi.product_id AS STRING)) as sku,
                        COALESCE(pv_stock.remain_qty, 0) as stock_on_hand,
                        SUM(SAFE_CAST(oi.quantity AS INT64)) as units_sold,
                        SUM(SAFE_CAST(oi.return_quantity AS INT64)) as units_returned,
                        COUNT(DISTINCT oi.order_id) as order_count,
                        MAX(o.order_date) as last_order_date,
                        SUM(CASE WHEN o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
                            THEN SAFE_CAST(oi.quantity AS INT64) ELSE 0 END) as sold_30d,
                        ROUND(SUM(CASE WHEN o.status_group = 'success' THEN o.revenue_L3_success ELSE 0 END), 0) as revenue
                     FROM ${DATASET}.fact_order_items_dedup oi
                     LEFT JOIN ${DATASET}.product_template pt ON CAST(oi.product_id AS STRING) = CAST(pt.id AS STRING)
                     LEFT JOIN (SELECT DISTINCT product_id, display_id FROM ${DATASET}.product_variations) pv
                        ON CAST(oi.product_id AS STRING) = CAST(pv.product_id AS STRING)
                     LEFT JOIN (SELECT product_id, SUM(SAFE_CAST(remain_quantity AS INT64)) as remain_qty
                                FROM ${DATASET}.product_variations GROUP BY 1) pv_stock
                        ON CAST(oi.product_id AS STRING) = CAST(pv_stock.product_id AS STRING)
                     LEFT JOIN ${DATASET}.vw_fact_orders o ON oi.order_id = o.order_id
                     GROUP BY 1, 2, 3
                     HAVING SUM(SAFE_CAST(oi.quantity AS INT64)) > 0
                     ORDER BY units_sold DESC
                     LIMIT 100`,

                    // Q1: Summary stats
                    `SELECT
                        COUNT(DISTINCT COALESCE(pt.custom_id, CAST(oi.product_id AS STRING))) as total_skus,
                        SUM(SAFE_CAST(oi.quantity AS INT64)) as total_sold,
                        SUM(SAFE_CAST(oi.return_quantity AS INT64)) as total_returned
                     FROM ${DATASET}.fact_order_items_dedup oi
                     LEFT JOIN ${DATASET}.product_template pt ON CAST(oi.product_id AS STRING) = CAST(pt.id AS STRING)`,
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

                const stats = results[1].data?.[0] || {};
                const totalSold = stats.total_sold || 0;
                const totalReturned = stats.total_returned || 0;

                setData({
                    totalSkus: stats.total_skus || 0,
                    totalUnitsSold: totalSold,
                    totalUnitsReturned: totalReturned,
                    returnRate: totalSold > 0 ? (totalReturned / totalSold) * 100 : 0,
                    products: results[0].data || [],
                });
            } catch (error) {
                console.error("Failed to fetch inventory data", error);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    const downloadCSV = () => {
        const headers = ["Product Name", "SKU", "Stock Available", "Total Sold", "Total Returned", "Return Rate %", "Sold Last 30 Days", "Avg Daily Sales", "Last Order Date"];
        const rows = data.products.map(p => {
            const retRate = p.units_sold > 0 ? (p.units_returned / p.units_sold) * 100 : 0;
            const avgDaily = (p.sold_30d || 0) / 30;
            return [
                `"${p.product_name.replace(/"/g, '""')}"`,
                p.sku,
                p.stock_on_hand || 0,
                p.units_sold,
                p.units_returned,
                retRate.toFixed(2),
                p.sold_30d || 0,
                avgDaily.toFixed(1),
                p.last_order_date ? String(p.last_order_date).slice(0, 10) : ""
            ].join(",");
        });

        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `inventory_report_${format(new Date(), "yyyy-MM-dd")}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (loading) return <TabSkeleton cards={4} showChart={true} rows={6} />;

    const topProducts = data.products.slice(0, 10);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KPICard title="Total SKUs" value={formatNumber(data.totalSkus)} icon={Package} />
                <KPICard title="Units Sold" value={formatNumber(data.totalUnitsSold)} icon={TrendingUp} status="success" />
                <KPICard title="Units Returned" value={formatNumber(data.totalUnitsReturned)} icon={AlertTriangle}
                    status={data.returnRate > 15 ? "danger" : "warning"} />
                <KPICard title="Return Rate" value={`${data.returnRate.toFixed(1)}%`} icon={AlertTriangle}
                    status={data.returnRate > 15 ? "danger" : data.returnRate > 10 ? "warning" : "success"} />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Top Products Bar Chart */}
                <div className="rounded-xl border border-border bg-card p-6">
                    <h3 className="section-header">📦 Top Products (Units Sold)</h3>
                    <div className="h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={topProducts} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={false} />
                                <XAxis type="number" stroke="#888" fontSize={12} />
                                <YAxis dataKey="sku" type="category" width={50} stroke="#888" fontSize={10} />
                                <Tooltip contentStyle={{ backgroundColor: "#1e1e2e" }} />
                                <Bar dataKey="units_sold" fill={COLORS.indigo} radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Product Catalog Table */}
                <div className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="section-header mb-0">📋 Product Catalog</h3>
                        <button
                            onClick={downloadCSV}
                            className="flex items-center gap-2 rounded bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-400 hover:bg-indigo-500/20"
                        >
                            <Download className="h-3 w-3" />
                            Export CSV
                        </button>
                    </div>
                    <div className="overflow-x-auto max-h-[350px] overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-card">
                                <tr className="border-b border-border text-left text-muted-foreground">
                                    <th className="pb-2 pl-2 font-medium">SKU</th>
                                    <th className="pb-2 font-medium">Product</th>
                                    <th className="pb-2 text-right font-medium">Stock</th>
                                    <th className="pb-2 text-right font-medium">Sold</th>
                                    <th className="pb-2 text-right font-medium">Daily Avg</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {data.products.map((p: any, i: number) => {
                                    const retRate = p.units_sold > 0 ? (p.units_returned / p.units_sold) * 100 : 0;
                                    const avgDaily = (p.sold_30d || 0) / 30;
                                    return (
                                        <tr key={i}>
                                            <td className="py-2 pl-2 font-medium text-foreground text-xs whitespace-nowrap">
                                                {p.sku}
                                            </td>
                                            <td className="py-2 font-medium text-muted-foreground text-xs max-w-[120px] truncate" title={p.product_name}>
                                                {p.product_name}
                                            </td>
                                            <td className="py-2 text-right text-emerald-400 font-bold">{formatNumber(p.stock_on_hand || 0)}</td>
                                            <td className="py-2 text-right text-muted-foreground">{formatNumber(p.units_sold)}</td>
                                            <td className="py-2 text-right text-indigo-400 font-medium">
                                                {avgDaily > 0 ? avgDaily.toFixed(1) : "-"}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
