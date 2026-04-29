"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatNumber, cn } from "@/lib/utils";
import TabSkeleton from "@/components/ui/tab-skeleton";
import {
    Package, TrendingUp, CheckCircle, Truck, RotateCcw, XCircle,
    Clock, ShoppingCart, Warehouse, Users, Repeat, Crown, Heart,
} from "lucide-react";

const DS = "levelup-465304.T1_Dataset";
const EUR_TO_VND = 28000;
const EUR_F = EUR_TO_VND / 100;

async function queryBQ(sql: string) {
    const r = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }) });
    return (await r.json()).data || [];
}
function fmtVND(v: number) { const a = Math.abs(v); const s = v < 0 ? "-" : ""; if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}ty`; if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}tr`; if (a >= 1e3) return `${s}${Math.round(a / 1e3)}K`; return `${s}${Math.round(a)}`; }
function fmtMoney(v: number) { return new Intl.NumberFormat("vi-VN").format(Math.round(v)); }

// POS Cake inventory data
const POS_INVENTORY = { sku: "MK01", name: "MK01TITANIUM", total_imported: 300, available: 156, shipping: 29, total_stock: 185, price_eur: 159 };
const STATUS_CONFIG = [
    { status: 8, label: "Đang đóng hàng", bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", icon: Clock },
    { status: 3, label: "Đã nhận (chờ đối soát)", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: Truck },
    { status: 16, label: "Đã thu tiền", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", icon: CheckCircle },
    { status: 4, label: "Đang hoàn", bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-700", icon: RotateCcw },
    { status: 5, label: "Đã hoàn", bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700", icon: RotateCcw },
    { status: 6, label: "Đã hủy", bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-600", icon: XCircle },
];
const PIE_COLORS = ["#34d399", "#fbbf24", "#60a5fa", "#a78bfa", "#f43f5e"];

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
    paid: { label: 'Đã thu tiền', cls: 'bg-emerald-100 text-emerald-700' },
    received: { label: 'Đã nhận', cls: 'bg-sky-100 text-sky-700' },
    shipped: { label: 'Đã gửi hàng', cls: 'bg-blue-100 text-blue-700' },
    packing: { label: 'Đang đóng', cls: 'bg-amber-100 text-amber-700' },
    returning: { label: 'Đang hoàn', cls: 'bg-orange-100 text-orange-700' },
    returned: { label: 'Đã hoàn', cls: 'bg-red-100 text-red-700' },
    canceled: { label: 'Đã hủy', cls: 'bg-gray-100 text-gray-600' },
    unknown: { label: 'Đã thu tiền', cls: 'bg-emerald-100 text-emerald-700' },
    confirmed: { label: 'Đã xác nhận', cls: 'bg-indigo-100 text-indigo-700' },
    new: { label: 'Mới', cls: 'bg-gray-100 text-gray-600' },
    waiting_stock: { label: 'Chờ hàng', cls: 'bg-yellow-100 text-yellow-700' },
};

function customerTier(orders: number) {
    if (orders >= 6) return { label: "VIP", cls: "bg-violet-100 text-violet-700" };
    if (orders >= 3) return { label: "Loyal", cls: "bg-emerald-100 text-emerald-700" };
    if (orders >= 2) return { label: "Repeat", cls: "bg-sky-100 text-sky-700" };
    return { label: "New", cls: "bg-gray-100 text-gray-600" };
}

interface Props { dateRange?: { from: Date; to: Date }; }

export default function OrdersTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [statusBreakdown, setStatusBreakdown] = useState<any[]>([]);
    const [soldByStatus, setSoldByStatus] = useState<any>(null);
    const [customerKpis, setCustomerKpis] = useState<any>(null);
    const [segments, setSegments] = useState<any[]>([]);
    const [topCustomers, setTopCustomers] = useState<any[]>([]);
    const [recentOrders, setRecentOrders] = useState<any[]>([]);

    useEffect(() => {
        setLoading(true);
        const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
        const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

        Promise.all([
            // Q0: Order status breakdown
            queryBQ(`SELECT o.status,
                COUNT(DISTINCT o.id) as order_count,
                SUM(o.total_quantity) as total_qty,
                SUM(o.total_price) * ${EUR_F} as total_value
            FROM \`${DS}.sale_order\` o
            GROUP BY 1 ORDER BY 1`),

            // Q1: Sold by status
            queryBQ(`SELECT
                SUM(o.total_quantity) as total_sold,
                SUM(CASE WHEN o.status = 16 THEN o.total_quantity ELSE 0 END) as paid_qty,
                SUM(CASE WHEN o.status = 5 THEN o.total_quantity ELSE 0 END) as returned_qty,
                SUM(CASE WHEN o.status = 6 THEN o.total_quantity ELSE 0 END) as cancelled_qty
            FROM \`${DS}.sale_order\` o`),

            // Q2: Customer KPIs
            queryBQ(`SELECT COUNT(DISTINCT NULLIF(bill_phone_number,'')) as unique_customers,
                COUNT(DISTINCT id) as total_orders,
                ROUND(SUM(CASE WHEN status = 16 THEN total_price ELSE 0 END) * ${EUR_F}, 0) as total_revenue,
                COUNT(DISTINCT CASE WHEN status = 16 THEN id END) as delivered
            FROM \`${DS}.sale_order\`
            WHERE SAFE_CAST(SUBSTR(updated_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
                AND bill_phone_number IS NOT NULL AND bill_phone_number != ''`),

            // Q3: Customer segments
            queryBQ(`SELECT
                CASE WHEN order_count = 1 THEN '1 đơn (New)'
                     WHEN order_count = 2 THEN '2 đơn (Repeat)'
                     WHEN order_count BETWEEN 3 AND 5 THEN '3-5 đơn (Loyal)'
                     ELSE '6+ đơn (VIP)' END as segment,
                SUM(customer_count) as customers
            FROM (SELECT COUNT(DISTINCT id) as order_count, 1 as customer_count
                FROM \`${DS}.sale_order\`
                WHERE SAFE_CAST(SUBSTR(updated_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
                    AND bill_phone_number IS NOT NULL AND bill_phone_number != ''
                GROUP BY bill_phone_number)
            GROUP BY 1 ORDER BY MIN(order_count)`),

            // Q4: Top customers
            queryBQ(`SELECT bill_full_name as name, bill_phone_number as phone,
                COUNT(DISTINCT id) as orders,
                ROUND(SUM(CASE WHEN status = 16 THEN total_price ELSE 0 END) * ${EUR_F}, 0) as revenue,
                COUNT(DISTINCT CASE WHEN status = 16 THEN id END) as delivered,
                COUNT(DISTINCT CASE WHEN status = 6 THEN id END) as cancelled
            FROM \`${DS}.sale_order\`
            WHERE SAFE_CAST(SUBSTR(updated_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
                AND bill_phone_number IS NOT NULL AND bill_phone_number != ''
            GROUP BY 1,2 ORDER BY revenue DESC LIMIT 20`),

            // Q5: Recent orders
            queryBQ(`SELECT id, status_name, total_price, bill_full_name,
                bill_phone_number, updated_at, total_quantity
            FROM \`${DS}.sale_order\`
            WHERE SAFE_CAST(SUBSTR(updated_at, 1, 10) AS DATE) BETWEEN '${from}' AND '${to}'
            ORDER BY updated_at DESC LIMIT 20`),
        ]).then(([statuses, sold, custKpi, seg, top, orders]) => {
            setStatusBreakdown(statuses);
            setSoldByStatus(sold[0] || {});
            const k = custKpi[0] || {};
            setCustomerKpis({
                uniqueCustomers: k.unique_customers || 0,
                totalOrders: k.total_orders || 0,
                totalRevenue: k.total_revenue || 0,
                delivered: k.delivered || 0,
                aov: k.delivered > 0 ? Math.round(k.total_revenue / k.delivered) : 0,
            });
            setSegments(seg);
            setTopCustomers(top);
            setRecentOrders(orders);
        }).catch(() => { }).finally(() => setLoading(false));
    }, [dateRange]);

    if (loading) return <TabSkeleton cards={5} showChart={true} rows={5} />;

    const totalOrders = statusBreakdown.reduce((s, sb) => s + (sb.order_count || 0), 0);
    const getStatusCount = (status: number) => statusBreakdown.find(s => s.status === status)?.order_count || 0;
    const getStatusQty = (status: number) => statusBreakdown.find(s => s.status === status)?.total_qty || 0;
    const getStatusValue = (status: number) => statusBreakdown.find(s => s.status === status)?.total_value || 0;
    const sold_out = POS_INVENTORY.total_imported - POS_INVENTORY.total_stock;

    const stockData = [
        { name: "Có thể bán", value: POS_INVENTORY.available },
        { name: "Chờ vận chuyển", value: POS_INVENTORY.shipping },
        { name: "Đã xuất kho", value: sold_out },
    ];

    return (
        <div className="space-y-6">
            {/* ═══ Inventory Header ═══ */}
            <div className="rounded-xl border border-border bg-gradient-to-r from-slate-900 to-slate-800 p-5 text-white">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-xs text-slate-400 mb-1">Mã SKU: {POS_INVENTORY.sku}</div>
                        <h2 className="text-xl font-bold">{POS_INVENTORY.name}</h2>
                        <div className="text-sm text-slate-400 mt-1">Giá bán: €{POS_INVENTORY.price_eur} ({fmtVND(POS_INVENTORY.price_eur * EUR_F)})</div>
                    </div>
                    <Package className="w-10 h-10 text-emerald-400" />
                </div>
            </div>

            {/* ═══ Inventory + Customer KPIs ═══ */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
                <KPICard title="Tổng nhập" value={String(POS_INVENTORY.total_imported)} icon={Warehouse} />
                <KPICard title="Có thể bán" value={String(POS_INVENTORY.available)} icon={Package} status="success" />
                <KPICard title="Chờ ship" value={String(POS_INVENTORY.shipping)} icon={Truck} status="warning" />
                <KPICard title="Đã xuất" value={String(sold_out)} icon={TrendingUp} subValue={`${totalOrders} leads`} />
                <KPICard title="Khách hàng" value={formatNumber(customerKpis?.uniqueCustomers || 0)} icon={Users} />
                <KPICard title="Tổng đơn" value={formatNumber(customerKpis?.totalOrders || 0)} icon={ShoppingCart} />
                <KPICard title="Revenue" value={fmtVND(customerKpis?.totalRevenue || 0)} icon={Crown} status="success" />
                <KPICard title="AOV" value={fmtVND(customerKpis?.aov || 0)} icon={Heart} subValue="Giá trị TB/đơn" />
            </div>

            {/* ═══ Order Status Breakdown ═══ */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Phân bổ {totalOrders} leads theo trạng thái POS</h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                    {STATUS_CONFIG.map(sc => {
                        const count = getStatusCount(sc.status);
                        const value = getStatusValue(sc.status);
                        const qty = getStatusQty(sc.status);
                        const Icon = sc.icon;
                        return (
                            <div key={sc.status} className={cn("rounded-lg border p-3 text-center", sc.bg, sc.border)}>
                                <div className={cn("text-[10px] font-medium mb-1 flex items-center justify-center gap-1", sc.text)}>
                                    <Icon className="w-3 h-3" />{sc.label}
                                </div>
                                <div className={cn("text-2xl font-bold", sc.text)}>{count}</div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">{fmtVND(value)} · {qty} sp</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ═══ Inventory Pie + Customer Segments ═══ */}
            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Phân bổ tồn kho ({POS_INVENTORY.total_imported} sp)</h3>
                    <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                            <Pie data={stockData} cx="50%" cy="50%" innerRadius={60} outerRadius={100}
                                dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                                {stockData.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Customer Segments</h3>
                    <div className="space-y-3 mt-4">
                        {segments.map((s, i) => (
                            <div key={i} className="flex items-center justify-between">
                                <span className="text-sm text-foreground">{s.segment}</span>
                                <div className="flex items-center gap-3">
                                    <div className="w-32 h-2 rounded-full bg-gray-100 overflow-hidden">
                                        <div className="h-full rounded-full" style={{
                                            width: `${customerKpis?.uniqueCustomers > 0 ? (s.customers / customerKpis.uniqueCustomers * 100) : 0}%`,
                                            backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                                        }} />
                                    </div>
                                    <span className="text-xs font-semibold text-foreground w-8 text-right">{s.customers}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    {/* Orders by status bar chart */}
                    <div className="mt-6">
                        <h4 className="mb-2 text-xs font-semibold text-muted-foreground">Số đơn theo trạng thái</h4>
                        <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={[
                                { name: "Đã thu", qty: getStatusCount(16), fill: "#34d399" },
                                { name: "Đóng", qty: getStatusCount(8), fill: "#fbbf24" },
                                { name: "Nhận", qty: getStatusCount(3), fill: "#fb923c" },
                                { name: "Hoàn", qty: getStatusCount(5), fill: "#f87171" },
                                { name: "Hủy", qty: getStatusCount(6), fill: "#d1d5db" },
                            ]}>
                                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                <Tooltip />
                                <Bar dataKey="qty" name="Số đơn" radius={[4, 4, 0, 0]}>
                                    {[{ fill: "#34d399" }, { fill: "#fbbf24" }, { fill: "#fb923c" }, { fill: "#f87171" }, { fill: "#d1d5db" }]
                                        .map((item, idx) => <Cell key={idx} fill={item.fill} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* ═══ Top Customers Table ═══ */}
            {topCustomers.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Top Customers ({topCustomers.length})</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="px-2 pb-2 text-left font-medium">Khách hàng</th>
                                    <th className="px-2 pb-2 text-left font-medium">SĐT</th>
                                    <th className="px-2 pb-2 text-right font-medium">Đơn</th>
                                    <th className="px-2 pb-2 text-right font-medium">TC</th>
                                    <th className="px-2 pb-2 text-right font-medium">Hủy</th>
                                    <th className="px-2 pb-2 text-right font-medium">Revenue</th>
                                    <th className="px-2 pb-2 text-center font-medium">Tier</th>
                                </tr>
                            </thead>
                            <tbody>
                                {topCustomers.map((c, i) => {
                                    const tier = customerTier(c.orders);
                                    return (
                                        <tr key={i} className="border-b border-border/30 hover:bg-gray-50/50">
                                            <td className="px-2 py-2.5 font-medium text-foreground">{c.name || "---"}</td>
                                            <td className="px-2 py-2.5 text-xs">{c.phone}</td>
                                            <td className="px-2 py-2.5 text-right">{c.orders}</td>
                                            <td className="px-2 py-2.5 text-right text-emerald-500">{c.delivered}</td>
                                            <td className={cn("px-2 py-2.5 text-right", c.cancelled > 0 ? "text-rose-500" : "")}>{c.cancelled}</td>
                                            <td className="px-2 py-2.5 text-right font-semibold text-emerald-500">{fmtVND(c.revenue)}</td>
                                            <td className="px-2 py-2.5 text-center">
                                                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", tier.cls)}>{tier.label}</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ═══ Recent Orders ═══ */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Đơn hàng gần nhất ({recentOrders.length})</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">ID</th>
                                <th className="px-2 pb-2 text-left font-medium">Khách hàng</th>
                                <th className="px-2 pb-2 text-left font-medium">SĐT</th>
                                <th className="px-2 pb-2 text-right font-medium">Giá trị</th>
                                <th className="px-2 pb-2 text-right font-medium">SL</th>
                                <th className="px-2 pb-2 text-left font-medium">Trạng thái</th>
                                <th className="px-2 pb-2 text-left font-medium">Cập nhật</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recentOrders.map((o, i) => {
                                const sl = STATUS_LABELS[o.status_name] || { label: o.status_name, cls: 'bg-gray-100 text-gray-600' };
                                return (
                                    <tr key={i} className="border-b border-border/60 hover:bg-gray-50/50">
                                        <td className="px-2 py-2 font-mono text-xs">{o.id}</td>
                                        <td className="px-2 py-2">{o.bill_full_name || "---"}</td>
                                        <td className="px-2 py-2 text-xs">{o.bill_phone_number || "---"}</td>
                                        <td className="px-2 py-2 text-right font-medium">{fmtVND((o.total_price || 0) * EUR_F)}</td>
                                        <td className="px-2 py-2 text-right">{o.total_quantity || 0}</td>
                                        <td className="px-2 py-2">
                                            <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium", sl.cls)}>{sl.label}</span>
                                        </td>
                                        <td className="px-2 py-2 text-xs text-muted-foreground">
                                            {o.updated_at ? o.updated_at.substring(0, 16).replace("T", " ") : "---"}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
