"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatNumber, cn } from "@/lib/utils";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { Package, TrendingUp, CheckCircle, Truck, RotateCcw, XCircle, Clock, ShoppingCart, Warehouse } from "lucide-react";

const DS = "levelup-465304.T1_Dataset";
const EUR_TO_VND = 28000;
async function queryBQ(sql: string) {
    const r = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }) });
    return (await r.json()).data || [];
}
function fmtVND(v: number) { const a = Math.abs(v); const s = v < 0 ? "-" : ""; if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}ty`; if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}tr`; if (a >= 1e3) return `${s}${Math.round(a / 1e3)}K`; return `${s}${Math.round(a)}`; }

// POS Cake inventory data (hardcoded from POS)
const POS_INVENTORY = {
    sku: "MK01",
    name: "MK01TITANIUM",
    total_imported: 300,
    available: 156,
    shipping: 29,
    total_stock: 185,
    price_eur: 159,
};

// POS Status definitions
const STATUS_CONFIG = [
    { status: 8, label: "Đang đóng hàng", bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", icon: Clock },
    { status: 3, label: "Đã nhận (chờ đối soát)", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: Truck },
    { status: 16, label: "Đã thu tiền", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", icon: CheckCircle },
    { status: 4, label: "Đang hoàn", bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-700", icon: RotateCcw },
    { status: 5, label: "Đã hoàn", bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700", icon: RotateCcw },
    { status: 6, label: "Đã hủy", bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-600", icon: XCircle },
];

const PIE_COLORS = ["#34d399", "#fbbf24", "#60a5fa", "#a78bfa"];

interface Props { dateRange?: { from: Date; to: Date }; }

export default function InventoryTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [statusBreakdown, setStatusBreakdown] = useState<any[]>([]);
    const [soldByStatus, setSoldByStatus] = useState<any>(null);

    useEffect(() => {
        setLoading(true);
        Promise.all([
            // Q1: Order status breakdown for MK01TITANIUM (NO JOIN - single SKU)
            queryBQ(`SELECT o.status,
                COUNT(DISTINCT o.id) as order_count,
                SUM(o.total_quantity) as total_qty,
                SUM(o.total_price) * ${EUR_TO_VND / 100} as total_value
            FROM \`${DS}.sale_order\` o
            GROUP BY 1 ORDER BY 1`),

            // Q2: Sold qty by status (using sale_order.total_quantity, no JOIN needed)
            queryBQ(`SELECT
                SUM(o.total_quantity) as total_sold,
                SUM(CASE WHEN o.status = 16 THEN o.total_quantity ELSE 0 END) as paid_qty,
                SUM(CASE WHEN o.status = 5 THEN o.total_quantity ELSE 0 END) as returned_qty,
                SUM(CASE WHEN o.status = 6 THEN o.total_quantity ELSE 0 END) as cancelled_qty,
                SUM(CASE WHEN o.status = 8 THEN o.total_quantity ELSE 0 END) as packing_qty,
                SUM(CASE WHEN o.status = 3 THEN o.total_quantity ELSE 0 END) as received_qty,
                SUM(CASE WHEN o.status = 4 THEN o.total_quantity ELSE 0 END) as returning_qty
            FROM \`${DS}.sale_order\` o`),
        ]).then(([statuses, sold]) => {
            setStatusBreakdown(statuses);
            setSoldByStatus(sold[0] || {});
        }).catch(() => { }).finally(() => setLoading(false));
    }, [dateRange]);

    if (loading) return <TabSkeleton cards={3} showChart={true} rows={5} />;

    const totalOrders = statusBreakdown.reduce((s, sb) => s + (sb.order_count || 0), 0);
    const getStatusCount = (status: number) => statusBreakdown.find(s => s.status === status)?.order_count || 0;
    const getStatusQty = (status: number) => statusBreakdown.find(s => s.status === status)?.total_qty || 0;
    const getStatusValue = (status: number) => statusBreakdown.find(s => s.status === status)?.total_value || 0;

    const totalSold = soldByStatus?.total_sold || 0;
    const sold_out = POS_INVENTORY.total_imported - POS_INVENTORY.total_stock; // 300 - 185 = 115

    // Pie chart for stock status
    const stockData = [
        { name: "Có thể bán", value: POS_INVENTORY.available },
        { name: "Chờ vận chuyển", value: POS_INVENTORY.shipping },
        { name: "Đã xuất kho", value: sold_out },
    ];

    return (
        <div className="space-y-6">
            {/* Product Info */}
            <div className="rounded-xl border border-border bg-gradient-to-r from-slate-900 to-slate-800 p-5 text-white">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-xs text-slate-400 mb-1">Mã SKU: {POS_INVENTORY.sku}</div>
                        <h2 className="text-xl font-bold">{POS_INVENTORY.name}</h2>
                        <div className="text-sm text-slate-400 mt-1">Giá bán: €{POS_INVENTORY.price_eur} ({fmtVND(POS_INVENTORY.price_eur * EUR_TO_VND / 100)})</div>
                    </div>
                    <Package className="w-10 h-10 text-emerald-400" />
                </div>
            </div>

            {/* Inventory KPI Cards */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <KPICard title="Tổng nhập" value={String(POS_INVENTORY.total_imported)} icon={Warehouse}
                    subValue="Từ POS Cake" />
                <KPICard title="Có thể bán" value={String(POS_INVENTORY.available)} icon={Package} status="success"
                    subValue={`${((POS_INVENTORY.available / POS_INVENTORY.total_imported) * 100).toFixed(0)}% tổng nhập`} />
                <KPICard title="Chờ vận chuyển" value={String(POS_INVENTORY.shipping)} icon={Truck} status="warning" />
                <KPICard title="Tổng tồn kho" value={String(POS_INVENTORY.total_stock)} icon={Package}
                    subValue={`${POS_INVENTORY.available} bán + ${POS_INVENTORY.shipping} ship`} />
                <KPICard title="Đã xuất kho" value={String(sold_out)} icon={TrendingUp}
                    subValue={`${totalOrders} leads / ${totalSold} sp`} />
            </div>

            {/* Order Status Breakdown */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Phân bổ {totalOrders} leads theo trạng thái POS</h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                    {STATUS_CONFIG.map(sc => {
                        const count = getStatusCount(sc.status);
                        const value = getStatusValue(sc.status);
                        const qty = getStatusQty(sc.status);
                        const Icon = sc.icon;
                        return (
                            <div key={sc.status} className={cn(
                                "rounded-lg border p-3 text-center", sc.bg, sc.border
                            )}>
                                <div className={cn("text-[10px] font-medium mb-1 flex items-center justify-center gap-1", sc.text)}>
                                    <Icon className="w-3 h-3" />
                                    {sc.label}
                                </div>
                                <div className={cn("text-2xl font-bold", sc.text)}>{count}</div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                    {fmtVND(value)} · {qty} sp
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                {/* Stock Distribution Pie */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Phân bổ tồn kho ({POS_INVENTORY.total_imported} sp)</h3>
                    <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                            <Pie data={stockData} cx="50%" cy="50%" innerRadius={60} outerRadius={100}
                                dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                                {stockData.map((_, idx) => (
                                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                {/* Order count by status */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Số đơn theo trạng thái ({totalOrders} đơn)</h3>
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={[
                            { name: "Đã thu tiền", qty: getStatusCount(16), fill: "#34d399" },
                            { name: "Đang đóng", qty: getStatusCount(8), fill: "#fbbf24" },
                            { name: "Đã nhận", qty: getStatusCount(3), fill: "#fb923c" },
                            { name: "Đang hoàn", qty: getStatusCount(4), fill: "#60a5fa" },
                            { name: "Đã hoàn", qty: getStatusCount(5), fill: "#f87171" },
                            { name: "Đã hủy", qty: getStatusCount(6), fill: "#d1d5db" },
                        ]}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
                            <Bar dataKey="qty" name="Số đơn" radius={[4, 4, 0, 0]}>
                                {[
                                    { fill: "#34d399" },
                                    { fill: "#fbbf24" },
                                    { fill: "#fb923c" },
                                    { fill: "#60a5fa" },
                                    { fill: "#f87171" },
                                    { fill: "#d1d5db" },
                                ].map((item, idx) => (
                                    <Cell key={idx} fill={item.fill} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Summary Table - Stock Flow from 300 units */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Tổng hợp kho hàng MK01TITANIUM (300 sp nhập)</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-3 pb-2 text-left font-medium">Chỉ số</th>
                                <th className="px-3 pb-2 text-right font-medium">Số lượng SP</th>
                                <th className="px-3 pb-2 text-right font-medium">Số đơn</th>
                                <th className="px-3 pb-2 text-left font-medium">Ghi chú</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {/* POS Stock Section */}
                            <tr className="bg-slate-50/50">
                                <td colSpan={4} className="px-3 py-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Tồn kho (từ POS Cake)</td>
                            </tr>
                            <tr className="hover:bg-gray-50/50">
                                <td className="px-3 py-2.5 font-medium">📦 Tổng nhập kho</td>
                                <td className="px-3 py-2.5 text-right font-bold text-lg">{POS_INVENTORY.total_imported}</td>
                                <td className="px-3 py-2.5 text-right">—</td>
                                <td className="px-3 py-2.5 text-muted-foreground">Nhập 1 lần từ nhà cung cấp</td>
                            </tr>
                            <tr className="hover:bg-gray-50/50">
                                <td className="px-3 py-2.5 font-medium">✅ Có thể bán</td>
                                <td className="px-3 py-2.5 text-right font-bold text-lg text-emerald-500">{POS_INVENTORY.available}</td>
                                <td className="px-3 py-2.5 text-right">—</td>
                                <td className="px-3 py-2.5 text-muted-foreground">Sẵn sàng bán</td>
                            </tr>
                            <tr className="hover:bg-gray-50/50">
                                <td className="px-3 py-2.5 font-medium">🚚 Chờ vận chuyển</td>
                                <td className="px-3 py-2.5 text-right font-bold text-lg text-amber-500">{POS_INVENTORY.shipping}</td>
                                <td className="px-3 py-2.5 text-right">—</td>
                                <td className="px-3 py-2.5 text-muted-foreground">Đang ship cho KH</td>
                            </tr>
                            <tr className="hover:bg-gray-50/50 bg-blue-50/50">
                                <td className="px-3 py-2.5 font-bold">📊 Tổng tồn kho</td>
                                <td className="px-3 py-2.5 text-right font-bold text-lg text-blue-600">{POS_INVENTORY.total_stock}</td>
                                <td className="px-3 py-2.5 text-right">—</td>
                                <td className="px-3 py-2.5 text-muted-foreground">{POS_INVENTORY.available} + {POS_INVENTORY.shipping} = {POS_INVENTORY.total_stock}</td>
                            </tr>
                            <tr className="hover:bg-gray-50/50">
                                <td className="px-3 py-2.5 font-medium">📤 Đã xuất (bán thành công)</td>
                                <td className="px-3 py-2.5 text-right font-bold text-lg">{sold_out}</td>
                                <td className="px-3 py-2.5 text-right">—</td>
                                <td className="px-3 py-2.5 text-muted-foreground">{POS_INVENTORY.total_imported} − {POS_INVENTORY.total_stock} = {sold_out}</td>
                            </tr>

                            {/* Order Status Section */}
                            <tr className="bg-slate-50/50">
                                <td colSpan={4} className="px-3 py-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Trạng thái đơn hàng ({totalOrders} leads)</td>
                            </tr>
                            <tr className="hover:bg-gray-50/50">
                                <td className="px-3 py-2.5 font-medium">⏳ Đang đóng hàng</td>
                                <td className="px-3 py-2.5 text-right">—</td>
                                <td className="px-3 py-2.5 text-right font-bold text-lg text-orange-500">{getStatusCount(8)}</td>
                                <td className="px-3 py-2.5 text-muted-foreground">Chờ đóng gói & ship</td>
                            </tr>
                            <tr className="hover:bg-gray-50/50">
                                <td className="px-3 py-2.5 font-medium">📬 Đã nhận (chờ đối soát)</td>
                                <td className="px-3 py-2.5 text-right">—</td>
                                <td className="px-3 py-2.5 text-right font-bold text-lg text-amber-500">{getStatusCount(3)}</td>
                                <td className="px-3 py-2.5 text-muted-foreground">KH đã nhận, chờ thu tiền</td>
                            </tr>
                            <tr className="hover:bg-gray-50/50 bg-emerald-50/30">
                                <td className="px-3 py-2.5 font-bold">💰 Đã thu tiền</td>
                                <td className="px-3 py-2.5 text-right">—</td>
                                <td className="px-3 py-2.5 text-right font-bold text-lg text-emerald-600">{getStatusCount(16)}</td>
                                <td className="px-3 py-2.5 text-muted-foreground font-semibold">Revenue thực = {fmtVND(getStatusValue(16))}</td>
                            </tr>
                            <tr className="hover:bg-gray-50/50">
                                <td className="px-3 py-2.5 font-medium">🔄 Đang hoàn</td>
                                <td className="px-3 py-2.5 text-right">—</td>
                                <td className="px-3 py-2.5 text-right font-bold text-lg text-sky-500">{getStatusCount(4)}</td>
                                <td className="px-3 py-2.5 text-muted-foreground">Đang trả về kho</td>
                            </tr>
                            <tr className="hover:bg-gray-50/50">
                                <td className="px-3 py-2.5 font-medium">↩️ Đã hoàn</td>
                                <td className="px-3 py-2.5 text-right">—</td>
                                <td className="px-3 py-2.5 text-right font-bold text-lg text-rose-500">{getStatusCount(5)}</td>
                                <td className="px-3 py-2.5 text-muted-foreground">SP về lại kho</td>
                            </tr>
                            <tr className="hover:bg-gray-50/50">
                                <td className="px-3 py-2.5 font-medium">❌ Đã hủy</td>
                                <td className="px-3 py-2.5 text-right">—</td>
                                <td className="px-3 py-2.5 text-right font-bold text-lg text-gray-500">{getStatusCount(6)}</td>
                                <td className="px-3 py-2.5 text-muted-foreground">Không xuất kho</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
