"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, PieChart, Pie } from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatNumber, cn } from "@/lib/utils";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { Package, TrendingUp, ShoppingCart, CheckCircle, Truck, RotateCcw, XCircle, Clock, Phone, PhoneOff, PhoneCall, Tag } from "lucide-react";

const DS = "levelup-465304.T1_Dataset";
const EUR_TO_VND = 28000;
async function queryBQ(sql: string) {
    const r = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }) });
    const d = await r.json(); return d.data || [];
}
function fmtVND(v: number) { const a = Math.abs(v); const s = v < 0 ? "-" : ""; if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}ty`; if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}tr`; if (a >= 1e3) return `${s}${Math.round(a / 1e3)}K`; return `${s}${Math.round(a)}`; }

// POS Status definitions
const STATUS_CONFIG = [
    { status: 8, label: "Đang đóng hàng", bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", icon: Clock },
    { status: 3, label: "Đã nhận (chờ đối soát)", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: Truck },
    { status: 16, label: "Đã thu tiền", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", icon: CheckCircle },
    { status: 4, label: "Đang hoàn", bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-700", icon: RotateCcw },
    { status: 5, label: "Đã hoàn", bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700", icon: RotateCcw },
    { status: 6, label: "Đã hủy", bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-600", icon: XCircle },
];

// Call tag color map
const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    "Xác nhận": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
    "Call": { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
    "Call Lepeselony": { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
    "L2 - LPE": { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
    "L3 - LPE": { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
    "Gọi L2": { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200" },
    "Không nghe máy": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
    "Không mua": { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
    "Không mua - LPE": { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
    "KNM - LPE": { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
    "Sai SĐT": { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" },
};

const PIE_COLORS = ["#34d399", "#6366f1", "#3b82f6", "#a855f7", "#8b5cf6", "#06b6d4", "#f59e0b", "#f87171", "#ef4444", "#fb923c", "#9ca3af"];

interface Props { dateRange?: { from: Date; to: Date }; }

export default function ProductsTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [statusBreakdown, setStatusBreakdown] = useState<any[]>([]);
    const [tagBreakdown, setTagBreakdown] = useState<any[]>([]);
    const [tagsByStatus, setTagsByStatus] = useState<any[]>([]);
    const [orderDetails, setOrderDetails] = useState<any[]>([]);

    useEffect(() => {
        setLoading(true);
        const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
        const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
        const dateFilter = `SAFE_CAST(SUBSTR(o.updated_at, 1, 10) AS DATE) BETWEEN '${from}' AND '${to}'`;

        Promise.all([
            // Q1: Order status breakdown (NO JOIN to avoid row multiplication)
            queryBQ(`SELECT o.status, o.status_name,
                COUNT(DISTINCT o.id) as order_count,
                SUM(o.total_quantity) as total_qty,
                SUM(o.total_price) * ${EUR_TO_VND / 100} as total_value
            FROM \`${DS}.sale_order\` o
            WHERE ${dateFilter}
            GROUP BY 1, 2 ORDER BY 1`),

            // Q2: Call tag breakdown (overall)
            queryBQ(`SELECT tag_name, COUNT(DISTINCT o.id) as order_count
            FROM \`${DS}.sale_order\` o,
            UNNEST(JSON_EXTRACT_ARRAY(o.tags)) AS raw_tag,
            UNNEST([STRUCT(JSON_EXTRACT_SCALAR(raw_tag, '$.name') AS tag_name)]) AS t
            WHERE ${dateFilter}
            GROUP BY 1 ORDER BY order_count DESC`),

            // Q3: Tags cross-referenced with status
            queryBQ(`SELECT o.status, o.status_name, tag_name, COUNT(DISTINCT o.id) as cnt
            FROM \`${DS}.sale_order\` o,
            UNNEST(JSON_EXTRACT_ARRAY(o.tags)) AS raw_tag,
            UNNEST([STRUCT(JSON_EXTRACT_SCALAR(raw_tag, '$.name') AS tag_name)]) AS t
            WHERE ${dateFilter}
            GROUP BY 1, 2, 3 ORDER BY 1, cnt DESC`),

            // Q4: Individual order details with tags
            queryBQ(`SELECT o.id, o.status, o.status_name,
                o.bill_full_name,
                o.total_price * ${EUR_TO_VND / 100} as revenue_vnd,
                o.total_quantity as qty,
                o.tags,
                SUBSTR(o.updated_at, 1, 10) as order_date
            FROM \`${DS}.sale_order\` o
            WHERE ${dateFilter}
            ORDER BY o.updated_at DESC`),
        ]).then(([statuses, tags, tagStatus, orders]) => {
            setStatusBreakdown(statuses);
            setTagBreakdown(tags);
            setTagsByStatus(tagStatus);
            setOrderDetails(orders);
        }).catch(() => { }).finally(() => setLoading(false));
    }, [dateRange]);

    if (loading) return <TabSkeleton cards={4} showChart={true} rows={10} />;

    const totalOrders = statusBreakdown.reduce((s, sb) => s + (sb.order_count || 0), 0);
    const totalQty = statusBreakdown.reduce((s, sb) => s + (sb.total_qty || 0), 0);
    const getStatusCount = (status: number) => statusBreakdown.find(s => s.status === status)?.order_count || 0;
    const getStatusQty = (status: number) => statusBreakdown.find(s => s.status === status)?.total_qty || 0;
    const getStatusValue = (status: number) => statusBreakdown.find(s => s.status === status)?.total_value || 0;

    const paidRevenue = getStatusValue(16);
    const ordersWithTags = tagBreakdown.reduce((s, t) => s + (t.order_count || 0), 0);
    const xacNhanCount = tagBreakdown.find(t => t.tag_name === "Xác nhận")?.order_count || 0;

    // Parse tags from JSON string for each order
    const parseOrderTags = (tagsStr: string): string[] => {
        if (!tagsStr || tagsStr === '[]') return [];
        try {
            const parsed = JSON.parse(tagsStr);
            return parsed.map((t: any) => t.name);
        } catch { return []; }
    };

    // Pie chart for tag distribution
    const tagPieData = tagBreakdown.map(t => ({
        name: t.tag_name,
        value: t.order_count,
    }));

    return (
        <div className="space-y-6">
            {/* Product Info */}
            <div className="rounded-xl border border-border bg-gradient-to-r from-slate-900 to-slate-800 p-5 text-white">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-xs text-slate-400 mb-1">SKU duy nhất: MK01</div>
                        <h2 className="text-xl font-bold">MK01TITANIUM</h2>
                        <div className="text-sm text-slate-400 mt-1">€159 · {totalOrders} leads · {totalQty} sản phẩm</div>
                    </div>
                    <Package className="w-10 h-10 text-emerald-400" />
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <KPICard title="Tổng Leads" value={formatNumber(totalOrders)} icon={ShoppingCart}
                    subValue={`${totalQty} sp · ${fmtVND(paidRevenue)}`} />
                <KPICard title="TL Xác Nhận" value={`${totalOrders > 0 ? ((xacNhanCount / totalOrders) * 100).toFixed(1) : 0}%`}
                    icon={PhoneCall} status="success"
                    subValue={`${xacNhanCount}/${totalOrders} leads`} />
                <KPICard title="TL Thu Tiền" value={`${totalOrders > 0 ? ((getStatusCount(16) / totalOrders) * 100).toFixed(1) : 0}%`}
                    icon={CheckCircle} status="success"
                    subValue={`${getStatusCount(16)}/${totalOrders} đơn`} />
                <KPICard title="TL Hoàn" value={`${totalOrders > 0 ? ((getStatusCount(5) / totalOrders) * 100).toFixed(1) : 0}%`}
                    icon={RotateCcw} status="warning"
                    subValue={`${getStatusCount(5)}/${totalOrders} đơn`} />
                <KPICard title="TL Hủy" value={`${totalOrders > 0 ? ((getStatusCount(6) / totalOrders) * 100).toFixed(1) : 0}%`}
                    icon={XCircle} status="danger"
                    subValue={`${getStatusCount(6)}/${totalOrders} đơn`} />
                <KPICard title="Có Thẻ Gọi" value={`${totalOrders > 0 ? ((orderDetails.filter(o => parseOrderTags(o.tags).length > 0).length / totalOrders) * 100).toFixed(0) : 0}%`}
                    icon={Phone}
                    subValue={`${orderDetails.filter(o => parseOrderTags(o.tags).length > 0).length}/${totalOrders} · ${totalOrders - orderDetails.filter(o => parseOrderTags(o.tags).length > 0).length} chưa gọi`} />
            </div>

            {/* ORDER STATUS Section */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4" /> Trạng thái đơn hàng (theo POS Cake)
                </h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                    {STATUS_CONFIG.map(sc => {
                        const count = getStatusCount(sc.status);
                        const value = getStatusValue(sc.status);
                        const qty = getStatusQty(sc.status);
                        const Icon = sc.icon;
                        return (
                            <div key={sc.status} className={cn("rounded-lg border p-3 text-center", sc.bg, sc.border)}>
                                <div className={cn("text-[10px] font-medium mb-1 flex items-center justify-center gap-1", sc.text)}>
                                    <Icon className="w-3 h-3" /> {sc.label}
                                </div>
                                <div className={cn("text-2xl font-bold", sc.text)}>{count}</div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">{fmtVND(value)} · {qty} sp</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* CALL TAGS Section */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2">
                    <Phone className="w-4 h-4" /> Thẻ gọi điện — Tình trạng liên hệ
                </h3>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {tagBreakdown.map(tag => {
                        const colors = TAG_COLORS[tag.tag_name] || { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200" };
                        return (
                            <div key={tag.tag_name} className={cn("rounded-lg border p-2.5 text-center", colors.bg, colors.border)}>
                                <div className={cn("text-[10px] font-medium mb-0.5 flex items-center justify-center gap-1", colors.text)}>
                                    <Tag className="w-2.5 h-2.5" /> {tag.tag_name}
                                </div>
                                <div className={cn("text-xl font-bold", colors.text)}>{tag.order_count}</div>
                                <div className="text-[9px] text-muted-foreground">{totalOrders > 0 ? ((tag.order_count / totalOrders) * 100).toFixed(0) : 0}% leads</div>
                            </div>
                        );
                    })}
                    {/* No tag count */}
                    <div className="rounded-lg border p-2.5 text-center bg-white border-dashed border-gray-300">
                        <div className="text-[10px] font-medium mb-0.5 flex items-center justify-center gap-1 text-gray-400">
                            <PhoneOff className="w-2.5 h-2.5" /> Chưa có thẻ
                        </div>
                        <div className="text-xl font-bold text-gray-400">{totalOrders - orderDetails.filter(o => parseOrderTags(o.tags).length > 0).length}</div>
                        <div className="text-[9px] text-muted-foreground">Chưa gọi</div>
                    </div>
                </div>
            </div>

            {/* Charts: Tag Pie + Tags by Status Bar */}
            <div className="grid gap-4 lg:grid-cols-2">
                {/* Pie chart */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Phân bổ thẻ gọi điện</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                            <Pie data={tagPieData} cx="50%" cy="50%" innerRadius={55} outerRadius={100}
                                dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                                {tagPieData.map((_, idx) => (
                                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                {/* Tags by Status - stacked bar */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Thẻ gọi × Trạng thái đơn</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="px-2 pb-2 text-left font-medium">Thẻ</th>
                                    <th className="px-2 pb-2 text-right font-medium text-orange-500">Đóng gói</th>
                                    <th className="px-2 pb-2 text-right font-medium text-amber-500">Đã nhận</th>
                                    <th className="px-2 pb-2 text-right font-medium text-emerald-600">Đã thu</th>
                                    <th className="px-2 pb-2 text-right font-medium text-sky-500">Đang hoàn</th>
                                    <th className="px-2 pb-2 text-right font-medium text-rose-500">Đã hoàn</th>
                                    <th className="px-2 pb-2 text-right font-medium text-gray-500">Hủy</th>
                                    <th className="px-2 pb-2 text-right font-medium">Tổng</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tagBreakdown.map(tag => {
                                    const getCount = (status: number) => tagsByStatus.find(
                                        t => t.tag_name === tag.tag_name && t.status === status
                                    )?.cnt || 0;
                                    return (
                                        <tr key={tag.tag_name} className="border-b border-border/30 hover:bg-gray-50/50">
                                            <td className="px-2 py-2 font-medium text-foreground">{tag.tag_name}</td>
                                            <td className="px-2 py-2 text-right text-orange-500">{getCount(8) || "—"}</td>
                                            <td className="px-2 py-2 text-right text-amber-500">{getCount(3) || "—"}</td>
                                            <td className="px-2 py-2 text-right text-emerald-600 font-semibold">{getCount(16) || "—"}</td>
                                            <td className="px-2 py-2 text-right text-sky-500">{getCount(4) || "—"}</td>
                                            <td className="px-2 py-2 text-right text-rose-500">{getCount(5) || "—"}</td>
                                            <td className="px-2 py-2 text-right text-gray-500">{getCount(6) || "—"}</td>
                                            <td className="px-2 py-2 text-right font-bold">{tag.order_count}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Full Order Table */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Chi tiết đơn hàng ({totalOrders})</h3>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-card z-10">
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">#</th>
                                <th className="px-2 pb-2 text-left font-medium">ID</th>
                                <th className="px-2 pb-2 text-left font-medium">Khách hàng</th>
                                <th className="px-2 pb-2 text-right font-medium">SL</th>
                                <th className="px-2 pb-2 text-right font-medium">Revenue</th>
                                <th className="px-2 pb-2 text-center font-medium">Trạng thái</th>
                                <th className="px-2 pb-2 text-left font-medium">Thẻ gọi điện</th>
                                <th className="px-2 pb-2 text-right font-medium">Ngày</th>
                            </tr>
                        </thead>
                        <tbody>
                            {orderDetails.map((o, i) => {
                                const tags = parseOrderTags(o.tags);
                                const statusConf = STATUS_CONFIG.find(s => s.status === o.status);
                                return (
                                    <tr key={o.id} className="border-b border-border/30 hover:bg-gray-50/50">
                                        <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                                        <td className="px-2 py-2 text-muted-foreground">#{o.id}</td>
                                        <td className="px-2 py-2 font-medium text-foreground max-w-[150px] truncate">{o.bill_full_name || "---"}</td>
                                        <td className="px-2 py-2 text-right">{o.qty}</td>
                                        <td className="px-2 py-2 text-right font-semibold text-emerald-500">{fmtVND(o.revenue_vnd || 0)}</td>
                                        <td className="px-2 py-2 text-center">
                                            <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
                                                statusConf?.bg || "bg-gray-50", statusConf?.text || "text-gray-600", statusConf?.border || "border-gray-200", "border")}>
                                                {statusConf?.label || o.status_name}
                                            </span>
                                        </td>
                                        <td className="px-2 py-2">
                                            <div className="flex flex-wrap gap-1">
                                                {tags.length > 0 ? tags.map(tag => {
                                                    const colors = TAG_COLORS[tag] || { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" };
                                                    return (
                                                        <span key={tag} className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium border",
                                                            colors.bg, colors.text, colors.border)}>
                                                            {tag}
                                                        </span>
                                                    );
                                                }) : <span className="text-gray-300 text-[9px]">—</span>}
                                            </div>
                                        </td>
                                        <td className="px-2 py-2 text-right text-muted-foreground">{o.order_date}</td>
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
