"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { formatNumber } from "@/lib/utils";
import { DATASET } from "../constants";
import { Warehouse, Download } from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { cn } from "@/lib/utils";
import { queryCeoStock } from "@/lib/bq-queries";

interface InventoryTabProps {
    dateRange?: { from: Date; to: Date };
}

export default function InventoryTab({ dateRange }: InventoryTabProps) {
    const [loading, setLoading] = useState(true);
    const [stock, setStock] = useState<any[]>([]);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const res = await fetch("/api/query", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: queryCeoStock(DATASET) }),
                }).then((r) => r.json()).catch(() => ({ data: [] }));
                setStock(res.data || []);
            } catch (error) {
                console.error("Failed to fetch inventory data", error);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    const formatMoney = (v: number) => {
        if (!v) return "0";
        if (v >= 1e9) return (v / 1e9).toFixed(1) + "tỷ";
        if (v >= 1e6) return (v / 1e6).toFixed(1) + "tr";
        if (v >= 1e3) return (v / 1e3).toFixed(0) + "k";
        return v.toLocaleString("vi-VN");
    };

    const downloadCSV = () => {
        const headers = ["Mã SP", "Tên Sản Phẩm", "Tồn Kho", "Biến Thể", "GT Bán Lẻ", "GT Vốn"];
        const rows = stock.map((s) =>
            [s.product_code, `"${(s.product_name || "").replace(/"/g, '""')}"`, s.stock_qty || 0, s.variations || 0, s.retail_value || 0, s.cost_value || 0].join(",")
        );
        const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(","), ...rows].join("\n");
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", `zen8_inventory_${format(new Date(), "yyyy-MM-dd")}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (loading) return <TabSkeleton cards={0} showChart={false} rows={10} />;

    const totalStock = stock.reduce((s, i) => s + (i.stock_qty || 0), 0);
    const totalRetail = stock.reduce((s, i) => s + (i.retail_value || 0), 0);
    const totalCost = stock.reduce((s, i) => s + (i.cost_value || 0), 0);

    return (
        <div className="space-y-6">
            {/* Summary KPIs */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-border bg-card p-4">
                    <div className="text-xs text-muted-foreground mb-1">Tổng SKU</div>
                    <div className="text-2xl font-bold text-foreground">{stock.length}</div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                    <div className="text-xs text-muted-foreground mb-1">Tổng Tồn Kho</div>
                    <div className="text-2xl font-bold text-emerald-500">{formatNumber(totalStock)}</div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                    <div className="text-xs text-muted-foreground mb-1">GT Bán Lẻ</div>
                    <div className="text-2xl font-bold text-cyan-500">{formatMoney(totalRetail)}</div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                    <div className="text-xs text-muted-foreground mb-1">GT Vốn</div>
                    <div className="text-2xl font-bold text-amber-500">{formatMoney(totalCost)}</div>
                </div>
            </div>

            {/* Stock Table */}
            <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
                        <Warehouse className="h-5 w-5 text-cyan-500" /> Tồn Kho (POS)
                    </h3>
                    <button onClick={downloadCSV}
                        className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20">
                        <Download className="h-3 w-3" /> Export CSV
                    </button>
                </div>
                {stock.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic py-8 text-center">Chưa có dữ liệu tồn kho.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                                    <th className="px-3 py-2">Mã SP</th>
                                    <th className="px-3 py-2">Tên Sản Phẩm</th>
                                    <th className="px-3 py-2 text-right">Tồn Kho</th>
                                    <th className="px-3 py-2 text-right">Biến Thể</th>
                                    <th className="px-3 py-2 text-right">GT Bán Lẻ</th>
                                    <th className="px-3 py-2 text-center">Trạng Thái</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stock.map((s: any, i: number) => {
                                    const qty = s.stock_qty || 0;
                                    const status = qty <= 0
                                        ? { label: "Hết hàng", color: "bg-rose-500/20 text-rose-400" }
                                        : qty <= 5
                                            ? { label: "Sắp hết", color: "bg-amber-500/20 text-amber-400" }
                                            : qty <= 50
                                                ? { label: "Trung bình", color: "bg-blue-500/20 text-blue-400" }
                                                : { label: "Đủ hàng", color: "bg-emerald-500/20 text-emerald-400" };
                                    return (
                                        <tr key={i} className="border-b border-border/40 hover:bg-white/[0.02]">
                                            <td className="px-3 py-2.5 font-mono text-xs text-emerald-400">{s.product_code}</td>
                                            <td className="px-3 py-2.5 text-foreground font-medium">{s.product_name}</td>
                                            <td className="px-3 py-2.5 text-right font-bold text-foreground">{formatNumber(qty)}</td>
                                            <td className="px-3 py-2.5 text-right text-muted-foreground">{s.variations}</td>
                                            <td className="px-3 py-2.5 text-right text-cyan-400">{formatMoney(s.retail_value)}</td>
                                            <td className="px-3 py-2.5 text-center">
                                                <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", status.color)}>
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
