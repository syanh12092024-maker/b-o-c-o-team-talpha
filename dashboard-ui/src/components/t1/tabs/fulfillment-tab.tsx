"use client";

import { useEffect, useState, useCallback } from "react";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { cn } from "@/lib/utils";
import TabSkeleton from "@/components/ui/tab-skeleton";
import {
    Truck, Package, CheckCircle, XCircle, RotateCcw, Clock, AlertTriangle,
    ArrowRight, MapPin, Phone, Shield, Zap, Globe, Warehouse,
    RefreshCw, Box, TrendingUp, Activity, Loader2, Upload,
} from "lucide-react";

const DS = "levelup-465304.T1_Dataset";

async function queryBQ(sql: string) {
    const r = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }) });
    return (await r.json()).data || [];
}

async function fetchEU(action: string, params?: Record<string, string>) {
    const sp = new URLSearchParams({ action, ...params });
    const r = await fetch(`/api/eushipments?${sp}`);
    const json = await r.json();
    return json.data || [];
}

async function triggerSync() {
    const r = await fetch("/api/eushipments/sync", { method: "POST" });
    return r.json();
}

function fmtVND(v: number) {
    const a = Math.abs(v); const s = v < 0 ? "-" : "";
    if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}ty`;
    if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}tr`;
    if (a >= 1e3) return `${s}${Math.round(a / 1e3)}K`;
    return `${s}${Math.round(a)}`;
}

// ─── Status Mapping: POS Cake ↔ euShipments ───
const STATUS_MAP = [
    {
        posStatus: 8, posLabel: "Đang đóng hàng",
        euLabel: "Chờ tạo đơn 3PL",
        euDesc: "Đơn mới từ POS → validate → tạo trên euShipments",
        flow: "POS → Validate",
        bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700",
        icon: Clock, dot: "bg-orange-400",
    },
    {
        posStatus: 9, posLabel: "Đã gửi hàng",
        euLabel: "Đã tạo đơn / Đang ship",
        euDesc: "euShipments đã nhận đơn, GLS Slovakia đang vận chuyển",
        flow: "euShipments → GLS SK",
        bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700",
        icon: Truck, dot: "bg-blue-400",
    },
    {
        posStatus: 3, posLabel: "Đã nhận hàng",
        euLabel: "Delivered (chờ đối soát)",
        euDesc: "KH đã nhận hàng, COD chờ thu về",
        flow: "GLS → KH nhận",
        bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700",
        icon: Package, dot: "bg-amber-400",
    },
    {
        posStatus: 16, posLabel: "Đã thu tiền",
        euLabel: "Completed (COD settled)",
        euDesc: "COD đã đối soát xong, tiền về tài khoản",
        flow: "COD ✅ Settled",
        bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700",
        icon: CheckCircle, dot: "bg-emerald-400",
    },
    {
        posStatus: 4, posLabel: "Đang hoàn",
        euLabel: "Returning (GLS trả lại)",
        euDesc: "KH từ chối / không nhận → GLS trả về kho HelpShip",
        flow: "GLS → Kho Oradea",
        bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-700",
        icon: RotateCcw, dot: "bg-sky-400",
    },
    {
        posStatus: 5, posLabel: "Đã hoàn",
        euLabel: "Returned (về kho)",
        euDesc: "SP đã về kho HelpShip Oradea, cần restock",
        flow: "Kho ← SP",
        bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700",
        icon: RotateCcw, dot: "bg-rose-400",
    },
    {
        posStatus: 6, posLabel: "Đã hủy",
        euLabel: "Cancelled",
        euDesc: "Đơn hủy trước khi ship, không tạo trên euShipments",
        flow: "⛔ Hủy",
        bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-600",
        icon: XCircle, dot: "bg-gray-400",
    },
];

const PIE_COLORS = ["#fb923c", "#3b82f6", "#fbbf24", "#34d399", "#38bdf8", "#f43f5e", "#9ca3af"];
const TOOLTIP_STYLE = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 };

interface Props { dateRange?: { from: Date; to: Date }; }

export default function FulfillmentTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [statusData, setStatusData] = useState<any[]>([]);
    const [ffmOrders, setFfmOrders] = useState<any[]>([]);
    const [dailyFlow, setDailyFlow] = useState<any[]>([]);
    const [validationStats, setValidationStats] = useState<any>(null);

    // euShipments live data
    const [euInventory, setEuInventory] = useState<any[]>([]);
    const [euOrders, setEuOrders] = useState<any[]>([]);
    const [euConnected, setEuConnected] = useState(false);
    const [euError, setEuError] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [lastSync, setLastSync] = useState<string | null>(null);

    // Status sync (euShipments → POS Cake)
    const [statusSyncing, setStatusSyncing] = useState(false);
    const [statusSyncResult, setStatusSyncResult] = useState<any>(null);

    // Push orders state
    const [pushing, setPushing] = useState(false);
    const [pushResult, setPushResult] = useState<any>(null);

    useEffect(() => {
        setLoading(true);
        const from = dateRange?.from?.toISOString().slice(0, 10) || "2026-01-01";
        const to = dateRange?.to?.toISOString().slice(0, 10) || "2026-12-31";

        Promise.all([
            // Q1: POS order status breakdown
            queryBQ(`SELECT status, status_name,
                COUNT(DISTINCT id) as order_count,
                SUM(total_quantity) as total_qty,
                SUM(cod) as total_cod
            FROM \`${DS}.sale_order\`
            WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', updated_at))
                BETWEEN '${from}' AND '${to}'
            GROUP BY 1, 2 ORDER BY 1`),

            // Q2: Fulfillment orders from BQ
            queryBQ(`SELECT status, COUNT(*) as cnt,
                SUM(cod_amount) as total_cod,
                COUNTIF(is_test = true) as test_orders,
                SUM(IFNULL(shipping_cost_eur, 0)) as total_shipping,
                SUM(IFNULL(ffm_cost_eur, 0)) as total_ffm,
                SUM(IFNULL(total_3pl_cost_eur, 0)) as total_3pl_cost
            FROM \`${DS}.fulfillment_orders\`
            GROUP BY 1`).catch(() => []),

            // Q3: Daily order flow
            queryBQ(`SELECT
                DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', updated_at)) as day,
                COUNTIF(status IN (3, 16)) as delivered,
                COUNTIF(status = 8) as packing,
                COUNTIF(status IN (4, 5)) as returned,
                COUNTIF(status = 6) as cancelled
            FROM \`${DS}.sale_order\`
            WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', updated_at))
                BETWEEN '${from}' AND '${to}'
            GROUP BY 1 ORDER BY 1`),

            // Q4: Validation stats
            queryBQ(`SELECT
                COUNTIF(status = 'validation_failed') as fail_count,
                COUNTIF(status = 'created') as created_count,
                COUNTIF(status = 'shipped') as shipped_count,
                COUNTIF(status = 'delivered') as delivered_count,
                COUNTIF(status = 'processing') as processing_count,
                COUNTIF(status != 'validation_failed') as ok_count,
                COUNT(*) as total
            FROM \`${DS}.fulfillment_orders\``).catch(() => [{ fail_count: 0, created_count: 0, ok_count: 0, total: 0 }]),

            // Q5: euShipments live inventory
            fetchEU("inventory").catch(() => []),

            // Q6: euShipments live orders
            fetchEU("orders").catch(() => []),
        ]).then(([statuses, ffm, daily, valStats, inv, orders]) => {
            setStatusData(statuses);
            setFfmOrders(ffm);
            setDailyFlow(daily);
            setValidationStats(valStats[0] || {});

            // euShipments data
            if (Array.isArray(inv) && inv.length > 0) {
                setEuInventory(inv);
                setEuConnected(true);
            }
            if (Array.isArray(orders) && orders.length > 0) {
                setEuOrders(orders);
                setEuConnected(true);
            }
            if ((!inv || inv.length === 0) && (!orders || orders.length === 0)) {
                setEuConnected(false);
            }
        }).catch((err) => {
            setEuError(err.message);
        }).finally(() => setLoading(false));
    }, [dateRange]);

    const handleSync = useCallback(async () => {
        setSyncing(true);
        try {
            const result = await triggerSync();
            setLastSync(new Date().toISOString());
            // Reload euShipments data after sync
            const [inv, orders] = await Promise.all([
                fetchEU("inventory").catch(() => []),
                fetchEU("orders").catch(() => []),
            ]);
            if (Array.isArray(inv)) setEuInventory(inv);
            if (Array.isArray(orders)) setEuOrders(orders);
            setEuConnected(true);
            alert(`✅ Sync thành công!\n📦 Inventory: ${result.inventory?.synced || 0} SKUs\n📋 Orders: ${result.orders?.synced || 0} mới, ${result.orders?.updated || 0} cập nhật`);
        } catch (err: any) {
            setEuError(err.message);
            alert(`❌ Sync thất bại: ${err.message}`);
        } finally {
            setSyncing(false);
        }
    }, []);

    // Handle Status Sync: euShipments tracking → POS Cake status update
    const handleStatusSync = useCallback(async () => {
        if (statusSyncing) return;
        setStatusSyncing(true);
        setStatusSyncResult(null);
        try {
            const resp = await fetch("/api/eushipments/status-sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dryRun: false }),
            });
            const data = await resp.json();
            setStatusSyncResult(data);

            if (data.success) {
                const msg = [
                    `✅ Status Sync hoàn tất!`,
                    `📊 Checked: ${data.stats?.checked || 0} orders`,
                    `🔄 Updated: ${data.stats?.updated || 0} orders`,
                    `❌ Errors: ${data.stats?.errors || 0}`,
                ];
                if (data.updates?.length > 0) {
                    msg.push(`\n📝 Chi tiết:`);
                    data.updates.slice(0, 5).forEach((u: string) => msg.push(`  ${u}`));
                }
                alert(msg.join("\n"));
            } else {
                alert(`❌ Status Sync lỗi: ${data.error || 'Unknown'}`);
            }
        } catch (err: any) {
            setStatusSyncResult({ success: false, error: err.message });
            alert(`❌ Status Sync thất bại: ${err.message}`);
        } finally {
            setStatusSyncing(false);
        }
    }, [statusSyncing]);

    // Handle Push Orders: POS packing → euShipments
    const handlePushOrders = useCallback(async () => {
        if (pushing) return;
        const confirmed = confirm(
            "Đẩy tất cả đơn \"Đang đóng hàng\" lên euShipments?\n\n" +
            "Chỉ những đơn có status=8 (packing) sẽ được tạo."
        );
        if (!confirmed) return;

        setPushing(true);
        setPushResult(null);
        try {
            const resp = await fetch("/api/eushipments/push-orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dryRun: false }),
            });
            const data = await resp.json();
            setPushResult(data);

            if (data.success) {
                const msg = [
                    `✅ Push hoàn tất!`,
                    `📦 Tổng: ${data.stats?.total || 0} đơn`,
                    `🚚 Tạo thành công: ${data.stats?.created || 0}`,
                    `❌ Lỗi: ${data.stats?.failed || 0}`,
                    `⏭ Bỏ qua: ${data.stats?.skipped || 0}`,
                ];
                if (data.results?.length > 0) {
                    msg.push(`\nChi tiết:`);
                    data.results.slice(0, 10).forEach((r: any) => {
                        const icon = r.status === 'created' ? '✅' : r.status === 'failed' ? '❌' : '⏭';
                        msg.push(`  ${icon} #${r.orderId} ${r.recipient} ${r.euOrderId ? `(euID: ${r.euOrderId})` : r.error || ''}`);
                    });
                }
                alert(msg.join("\n"));

                // Reload data after push
                const [inv, orders] = await Promise.all([
                    fetchEU("inventory").catch(() => []),
                    fetchEU("orders").catch(() => []),
                ]);
                if (Array.isArray(inv)) setEuInventory(inv);
                if (Array.isArray(orders)) setEuOrders(orders);
            } else {
                alert(`❌ Push lỗi: ${data.error || 'Unknown'}`);
            }
        } catch (err: any) {
            setPushResult({ success: false, error: err.message });
            alert(`❌ Push thất bại: ${err.message}`);
        } finally {
            setPushing(false);
        }
    }, [pushing]);

    if (loading) return <TabSkeleton cards={4} showChart={true} rows={5} />;

    // Helpers
    const getStatus = (s: number) => statusData.find((d) => d.status === s) || {};
    const totalOrders = statusData.reduce((sum, d) => sum + (d.order_count || 0), 0);
    const successOrders = (getStatus(3).order_count || 0) + (getStatus(16).order_count || 0);
    const returnOrders = (getStatus(4).order_count || 0) + (getStatus(5).order_count || 0);
    const packingOrders = getStatus(8).order_count || 0;
    const cancelOrders = getStatus(6).order_count || 0;
    const totalCOD = (getStatus(3).total_cod || 0) + (getStatus(16).total_cod || 0);

    const deliveryRate = successOrders + returnOrders > 0
        ? ((successOrders / (successOrders + returnOrders)) * 100).toFixed(1)
        : "0.0";
    const returnRate = successOrders + returnOrders > 0
        ? ((returnOrders / (successOrders + returnOrders)) * 100).toFixed(1)
        : "0.0";

    // Pie data for fulfillment status distribution
    const pieData = STATUS_MAP.map(s => ({
        name: s.posLabel,
        value: getStatus(s.posStatus).order_count || 0,
    })).filter(d => d.value > 0);

    const valFailed = validationStats?.fail_count || 0;
    const ffmCreated = validationStats?.created_count || 0;
    const ffmShipped = validationStats?.shipped_count || 0;
    const ffmDelivered = validationStats?.delivered_count || 0;
    const ffmProcessing = validationStats?.processing_count || 0;

    // euShipments 3PL cost summary from BQ
    const totalShippingEUR = ffmOrders.reduce((s: number, f: any) => s + (f.total_shipping || 0), 0);
    const totalFfmEUR = ffmOrders.reduce((s: number, f: any) => s + (f.total_ffm || 0), 0);
    const total3plEUR = ffmOrders.reduce((s: number, f: any) => s + (f.total_3pl_cost || 0), 0);

    // euShipments inventory summary
    const totalAvailableQty = euInventory.reduce((s, i) => s + (i.availableQty || 0), 0);
    const totalReservedQty = euInventory.reduce((s, i) => s + (i.reservedQty || 0), 0);
    const totalStockQty = euInventory.reduce((s, i) => s + (i.totalQty || 0), 0);

    return (
        <div className="space-y-6">
            {/* Header Banner */}
            <div className="rounded-xl border border-border bg-gradient-to-r from-indigo-900 via-blue-900 to-slate-900 p-5 text-white">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <Globe className="w-4 h-4 text-blue-300" />
                            <span className="text-xs text-blue-300">3PL Partner: euShipments (InOut BG)</span>
                            {euConnected ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-500/30">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    API Connected
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold text-red-300 border border-red-500/30">
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                                    Disconnected
                                </span>
                            )}
                        </div>
                        <h2 className="text-xl font-bold">Fulfillment — Slovakia 🇸🇰</h2>
                        <div className="flex items-center gap-4 mt-1 text-sm text-slate-400">
                            <span>🚚 Courier: GLS Slovakia (ID 741)</span>
                            <span>🏭 Kho: HelpShip Oradea</span>
                            <span>💶 COD: EUR</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handlePushOrders}
                            disabled={pushing}
                            className={cn(
                                "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-all",
                                pushing
                                    ? "bg-orange-600/50 text-orange-300 cursor-not-allowed"
                                    : "bg-orange-500/30 text-orange-200 border border-orange-400/50 hover:bg-orange-500/50 hover:scale-105"
                            )}
                        >
                            {pushing ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Upload className="w-3.5 h-3.5" />
                            )}
                            {pushing ? "Đang đẩy đơn..." : "🚀 Đẩy đơn lên euShipments"}
                        </button>
                        <button
                            onClick={handleSync}
                            disabled={syncing}
                            className={cn(
                                "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all",
                                syncing
                                    ? "bg-slate-600/50 text-slate-400 cursor-not-allowed"
                                    : "bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30"
                            )}
                        >
                            {syncing ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <RefreshCw className="w-3.5 h-3.5" />
                            )}
                            {syncing ? "Đang sync..." : "Sync euShipments"}
                        </button>
                        <button
                            onClick={handleStatusSync}
                            disabled={statusSyncing}
                            className={cn(
                                "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all",
                                statusSyncing
                                    ? "bg-amber-600/50 text-amber-300 cursor-not-allowed"
                                    : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30"
                            )}
                        >
                            {statusSyncing ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Activity className="w-3.5 h-3.5" />
                            )}
                            {statusSyncing ? "Đang cập nhật..." : "🔄 Sync Status → POS"}
                        </button>
                        <div className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
                            <Zap className="w-3 h-3 inline mr-1" />
                            Auto Fulfillment
                        </div>
                    </div>
                </div>
                {(lastSync || statusSyncResult) && (
                    <div className="mt-2 flex items-center gap-4 text-[10px] text-slate-500">
                        {lastSync && <span>📦 euShipments sync: {new Date(lastSync).toLocaleString("vi-VN")}</span>}
                        {statusSyncResult?.success && (
                            <span className="text-emerald-400">
                                🔄 Status sync: {statusSyncResult.stats?.updated || 0} updated, {statusSyncResult.stats?.checked || 0} checked
                            </span>
                        )}
                        {statusSyncResult?.success === false && (
                            <span className="text-red-400">❌ Status sync lỗi</span>
                        )}
                    </div>
                )}
            </div>

            {/* KPI Cards - Main Metrics */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
                <KPICard title="Tổng đơn" value={String(totalOrders)} icon={Package}
                    subValue="Tất cả trạng thái" />
                <KPICard title="Đang đóng hàng" value={String(packingOrders)} icon={Clock} status="warning"
                    subValue="Chờ tạo đơn 3PL" />
                <KPICard title="Giao thành công" value={String(successOrders)} icon={CheckCircle} status="success"
                    subValue={`${deliveryRate}% tỷ lệ giao`} />
                <KPICard title="Hoàn trả" value={String(returnOrders)} icon={RotateCcw} status="danger"
                    subValue={`${returnRate}% tỷ lệ hoàn`} />
                <KPICard title="COD thu được" value={fmtVND(totalCOD)} icon={CheckCircle}
                    subValue="Từ đơn thành công" />
                <KPICard title="Đã hủy" value={String(cancelOrders)} icon={XCircle}
                    subValue="Không ship" />
                <KPICard title="Kho 3PL" value={String(totalAvailableQty)} icon={Box}
                    status={totalAvailableQty > 0 ? "success" : "danger"}
                    subValue={`${euInventory.length} SKU · ${totalReservedQty} reserved`} />
                <KPICard title="3PL Orders" value={String(ffmCreated + ffmShipped + ffmDelivered + ffmProcessing)} icon={Truck}
                    status="success"
                    subValue={`€${total3plEUR.toFixed(1)} tổng chi phí`} />
            </div>

            {/* ─── euShipments Live Inventory ─── */}
            {euInventory.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Box className="w-4 h-4 text-indigo-500" />
                            Tồn kho 3PL — euShipments (HelpShip Oradea)
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                Live
                            </span>
                        </h3>
                        <span className="text-[10px] text-muted-foreground">{euInventory.length} SKU(s)</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="px-3 pb-2 text-left font-medium">SKU / Ref</th>
                                    <th className="px-3 pb-2 text-left font-medium">Tên sản phẩm</th>
                                    <th className="px-3 pb-2 text-left font-medium">Barcode</th>
                                    <th className="px-3 pb-2 text-right font-medium">Kho</th>
                                    <th className="px-3 pb-2 text-right font-medium text-emerald-600">Có sẵn</th>
                                    <th className="px-3 pb-2 text-right font-medium text-amber-600">Đã đặt</th>
                                    <th className="px-3 pb-2 text-right font-medium">Tổng</th>
                                    <th className="px-3 pb-2 text-center font-medium">Trạng thái</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/30">
                                {euInventory.map((item, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50/50">
                                        <td className="px-3 py-2.5 font-mono text-xs font-semibold text-indigo-600">
                                            {item.refNumber}
                                        </td>
                                        <td className="px-3 py-2.5 text-xs">{item.productName || "—"}</td>
                                        <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">{item.barcode || "—"}</td>
                                        <td className="px-3 py-2.5 text-xs text-right">{item.warehouse}</td>
                                        <td className={cn(
                                            "px-3 py-2.5 text-right text-sm font-bold",
                                            item.availableQty > 10 ? "text-emerald-600" :
                                                item.availableQty > 0 ? "text-amber-600" : "text-rose-600"
                                        )}>
                                            {item.availableQty}
                                        </td>
                                        <td className="px-3 py-2.5 text-right text-xs text-amber-600">{item.reservedQty}</td>
                                        <td className="px-3 py-2.5 text-right text-xs font-medium">{item.totalQty}</td>
                                        <td className="px-3 py-2.5 text-center">
                                            {item.availableQty > 10 ? (
                                                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                                    ✅ Đủ hàng
                                                </span>
                                            ) : item.availableQty > 0 ? (
                                                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                                    ⚠️ Sắp hết
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                                                    🔴 Hết hàng
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                <tr className="bg-slate-100/60 font-semibold">
                                    <td className="px-3 py-2.5 text-xs" colSpan={4}>TỔNG</td>
                                    <td className="px-3 py-2.5 text-right text-sm font-bold text-emerald-600">{totalAvailableQty}</td>
                                    <td className="px-3 py-2.5 text-right text-xs text-amber-600">{totalReservedQty}</td>
                                    <td className="px-3 py-2.5 text-right text-xs font-medium">{totalStockQty}</td>
                                    <td className="px-3 py-2.5"></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── euShipments Live Orders ─── */}
            {euOrders.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Truck className="w-4 h-4 text-blue-500" />
                            Đơn euShipments — Live Data
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 border border-blue-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                {euOrders.length} đơn
                            </span>
                        </h3>
                    </div>
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-card z-10">
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="px-2 pb-2 text-left font-medium">Order ID</th>
                                    <th className="px-2 pb-2 text-left font-medium">Ref</th>
                                    <th className="px-2 pb-2 text-left font-medium">Người nhận</th>
                                    <th className="px-2 pb-2 text-left font-medium">Thành phố</th>
                                    <th className="px-2 pb-2 text-left font-medium">AWB</th>
                                    <th className="px-2 pb-2 text-center font-medium">Status</th>
                                    <th className="px-2 pb-2 text-right font-medium">COD (€)</th>
                                    <th className="px-2 pb-2 text-right font-medium">Ship (€)</th>
                                    <th className="px-2 pb-2 text-left font-medium">Courier</th>
                                    <th className="px-2 pb-2 text-left font-medium">Ngày tạo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/30">
                                {euOrders.map((o, idx) => {
                                    const statusColor = o.status?.toString().toLowerCase().includes("deliver") ? "bg-emerald-100 text-emerald-700"
                                        : o.status?.toString().toLowerCase().includes("ship") || o.status?.toString().toLowerCase().includes("transit") ? "bg-blue-100 text-blue-700"
                                            : o.status?.toString().toLowerCase().includes("return") ? "bg-rose-100 text-rose-700"
                                                : o.status?.toString().toLowerCase().includes("cancel") ? "bg-gray-100 text-gray-600"
                                                    : "bg-amber-100 text-amber-700";

                                    return (
                                        <tr key={idx} className="hover:bg-gray-50/50">
                                            <td className="px-2 py-2 font-mono font-semibold text-indigo-600">{o.orderId}</td>
                                            <td className="px-2 py-2 font-mono text-muted-foreground">{o.clientReference}</td>
                                            <td className="px-2 py-2">{o.recipientName}</td>
                                            <td className="px-2 py-2">{o.recipientCity}</td>
                                            <td className="px-2 py-2 font-mono text-[10px]">{o.awb || "—"}</td>
                                            <td className="px-2 py-2 text-center">
                                                <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-medium", statusColor)}>
                                                    {o.statusName || o.status || "pending"}
                                                </span>
                                            </td>
                                            <td className="px-2 py-2 text-right font-semibold">€{Number(o.codAmount || 0).toFixed(2)}</td>
                                            <td className="px-2 py-2 text-right text-muted-foreground">€{Number(o.shippingCost || 0).toFixed(2)}</td>
                                            <td className="px-2 py-2">{o.courierName || "GLS"}</td>
                                            <td className="px-2 py-2 text-muted-foreground">{o.createdAt ? String(o.createdAt).slice(0, 10) : "—"}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Status Flow Mapping: POS ↔ euShipments */}
            <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-foreground">
                        Ánh xạ trạng thái: POS Cake ↔ euShipments ({totalOrders} đơn)
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> POS</span>
                        <ArrowRight className="w-3 h-3" />
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> euShipments</span>
                    </div>
                </div>

                <div className="space-y-2">
                    {STATUS_MAP.map(sm => {
                        const data = getStatus(sm.posStatus);
                        const count = data.order_count || 0;
                        const qty = data.total_qty || 0;
                        const cod = data.total_cod || 0;
                        const pct = totalOrders > 0 ? ((count / totalOrders) * 100).toFixed(1) : "0.0";
                        const Icon = sm.icon;

                        return (
                            <div key={sm.posStatus} className={cn(
                                "grid grid-cols-12 gap-2 items-center rounded-lg border p-3 transition-all hover:shadow-sm",
                                sm.bg, sm.border
                            )}>
                                {/* POS Status */}
                                <div className="col-span-2 flex items-center gap-2">
                                    <span className={cn("w-2 h-2 rounded-full flex-shrink-0", sm.dot)} />
                                    <div>
                                        <div className={cn("text-xs font-semibold", sm.text)}>{sm.posLabel}</div>
                                        <div className="text-[10px] text-muted-foreground">POS #{sm.posStatus}</div>
                                    </div>
                                </div>

                                {/* Arrow */}
                                <div className="col-span-1 flex items-center justify-center">
                                    <ArrowRight className={cn("w-4 h-4", sm.text)} />
                                </div>

                                {/* euShipments Status */}
                                <div className="col-span-3">
                                    <div className={cn("text-xs font-semibold", sm.text)}>
                                        <Icon className="w-3 h-3 inline mr-1" />{sm.euLabel}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">{sm.euDesc}</div>
                                </div>

                                {/* Count */}
                                <div className="col-span-2 text-center">
                                    <div className={cn("text-2xl font-bold", sm.text)}>{count}</div>
                                    <div className="text-[10px] text-muted-foreground">{pct}% · {qty} sp</div>
                                </div>

                                {/* COD */}
                                <div className="col-span-2 text-center">
                                    <div className="text-sm font-semibold text-foreground">{fmtVND(cod)}</div>
                                    <div className="text-[10px] text-muted-foreground">COD</div>
                                </div>

                                {/* Progress bar */}
                                <div className="col-span-2">
                                    <div className="h-2 w-full rounded-full bg-gray-200/80">
                                        <div
                                            className={cn("h-2 rounded-full transition-all", sm.dot)}
                                            style={{ width: `${Math.min(parseFloat(pct), 100)}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                {/* Pie Chart - Order Distribution */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Phân bổ đơn theo trạng thái</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                            <Pie data={pieData} cx="50%" cy="50%" innerRadius={65} outerRadius={105}
                                dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                                {pieData.map((_, idx) => (
                                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip contentStyle={TOOLTIP_STYLE} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                {/* Bar Chart - Status Counts */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Số đơn theo trạng thái ({totalOrders} đơn)</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={STATUS_MAP.map(s => ({
                            name: s.posLabel,
                            count: getStatus(s.posStatus).order_count || 0,
                            fill: s.dot.replace("bg-", ""),
                        }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={TOOLTIP_STYLE} />
                            <Bar dataKey="count" name="Số đơn" radius={[6, 6, 0, 0]}>
                                {STATUS_MAP.map((s, idx) => (
                                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Daily Trend */}
            {dailyFlow.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Xu hướng giao hàng theo ngày</h3>
                    <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={dailyFlow}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 10 }}
                                tickFormatter={(v) => v?.slice?.(5) || v} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={TOOLTIP_STYLE} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line type="monotone" dataKey="delivered" name="Thành công" stroke="#34d399" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="packing" name="Đang đóng" stroke="#fb923c" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="returned" name="Hoàn trả" stroke="#f43f5e" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="cancelled" name="Hủy" stroke="#9ca3af" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Fulfillment Pipeline & Config */}
            <div className="grid gap-4 lg:grid-cols-2">
                {/* Pipeline Status */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-4 text-sm font-semibold text-foreground flex items-center gap-2">
                        <Shield className="w-4 h-4 text-blue-500" /> Pipeline Fulfillment
                    </h3>
                    <div className="space-y-3">
                        {[
                            { step: "1", label: "POS → Packing", desc: "Đơn chuyển status 8", count: packingOrders, color: "bg-orange-100 text-orange-700 border-orange-200" },
                            { step: "2", label: "Validate SĐT + Địa chỉ", desc: "Kiểm tra format Slovakia", count: null, color: "bg-purple-100 text-purple-700 border-purple-200", extra: valFailed > 0 ? `❌ ${valFailed} thất bại` : "✅ OK" },
                            { step: "3", label: "Tạo đơn euShipments", desc: "API create-order → GLS SK", count: ffmCreated + ffmProcessing, color: "bg-blue-100 text-blue-700 border-blue-200" },
                            { step: "4", label: "GLS Slovakia vận chuyển", desc: "Door-to-door Slovakia", count: ffmShipped + (getStatus(9).order_count || 0), color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
                            { step: "5", label: "Giao thành công", desc: "COD thu & đối soát", count: successOrders, color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
                        ].map((item, idx) => (
                            <div key={idx} className={cn("flex items-center gap-3 rounded-lg border p-3", item.color)}>
                                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/70 flex items-center justify-center text-xs font-bold">
                                    {item.step}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-semibold">{item.label}</div>
                                    <div className="text-[10px] opacity-70">{item.desc}</div>
                                </div>
                                <div className="text-right">
                                    {item.count !== null && (
                                        <div className="text-lg font-bold">{item.count}</div>
                                    )}
                                    {item.extra && (
                                        <div className="text-[10px] font-medium">{item.extra}</div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* euShipments Config Info */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-4 text-sm font-semibold text-foreground flex items-center gap-2">
                        <Warehouse className="w-4 h-4 text-indigo-500" /> Cấu hình euShipments
                    </h3>
                    <div className="space-y-2">
                        {[
                            { icon: Globe, label: "Platform", value: "euShipments (InOut BG)" },
                            { icon: Truck, label: "Courier", value: "Slovakia GLS (ID 741)" },
                            { icon: Warehouse, label: "Kho hàng", value: "HelpShip Oradea, Romania" },
                            { icon: MapPin, label: "Thị trường", value: "Slovakia (SK)" },
                            { icon: Phone, label: "Phone format", value: "+421xxxxxxxxx" },
                            { icon: AlertTriangle, label: "Validation", value: "SĐT Slovakia + Địa chỉ + ZIP" },
                            { icon: Shield, label: "Auto fulfill", value: "Status 8 → euShipments" },
                            { icon: Activity, label: "API Status", value: euConnected ? "✅ Connected" : "❌ Disconnected" },
                            { icon: Box, label: "Stock 3PL", value: `${totalAvailableQty} sẵn · ${euInventory.length} SKU` },
                            { icon: TrendingUp, label: "3PL Cost", value: total3plEUR > 0 ? `€${total3plEUR.toFixed(2)}` : "Chưa có data" },
                        ].map((item, idx) => {
                            const IconComp = item.icon;
                            return (
                                <div key={idx} className="flex items-center gap-3 rounded-md border border-border/50 bg-gray-50/50 px-3 py-2">
                                    <IconComp className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                    <span className="text-xs text-muted-foreground w-24 flex-shrink-0">{item.label}</span>
                                    <span className="text-xs font-medium text-foreground">{item.value}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Summary Table */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Tổng hợp Fulfillment — POS Cake ↔ euShipments</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-3 pb-2 text-left font-medium">POS Status</th>
                                <th className="px-3 pb-2 text-left font-medium">euShipments Status</th>
                                <th className="px-3 pb-2 text-right font-medium">Số đơn</th>
                                <th className="px-3 pb-2 text-right font-medium">Số SP</th>
                                <th className="px-3 pb-2 text-right font-medium">COD</th>
                                <th className="px-3 pb-2 text-right font-medium">%</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {STATUS_MAP.map(sm => {
                                const d = getStatus(sm.posStatus);
                                const count = d.order_count || 0;
                                const qty = d.total_qty || 0;
                                const cod = d.total_cod || 0;
                                const pct = totalOrders > 0 ? ((count / totalOrders) * 100).toFixed(1) : "0.0";
                                const Icon = sm.icon;
                                return (
                                    <tr key={sm.posStatus} className={cn("hover:bg-gray-50/50", sm.bg + "/30")}>
                                        <td className="px-3 py-2.5">
                                            <div className="flex items-center gap-2">
                                                <span className={cn("w-2 h-2 rounded-full", sm.dot)} />
                                                <span className={cn("text-xs font-medium", sm.text)}>
                                                    #{sm.posStatus} {sm.posLabel}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <div className="flex items-center gap-1.5">
                                                <Icon className={cn("w-3 h-3", sm.text)} />
                                                <span className="text-xs">{sm.euLabel}</span>
                                            </div>
                                        </td>
                                        <td className={cn("px-3 py-2.5 text-right font-bold", sm.text)}>{count}</td>
                                        <td className="px-3 py-2.5 text-right text-xs">{qty}</td>
                                        <td className="px-3 py-2.5 text-right text-xs font-medium">{fmtVND(cod)}</td>
                                        <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{pct}%</td>
                                    </tr>
                                );
                            })}
                            <tr className="bg-slate-100/60 font-semibold">
                                <td className="px-3 py-2.5 text-xs">TỔNG</td>
                                <td className="px-3 py-2.5"></td>
                                <td className="px-3 py-2.5 text-right font-bold">{totalOrders}</td>
                                <td className="px-3 py-2.5 text-right text-xs">
                                    {statusData.reduce((s, d) => s + (d.total_qty || 0), 0)}
                                </td>
                                <td className="px-3 py-2.5 text-right text-xs font-medium">
                                    {fmtVND(statusData.reduce((s, d) => s + (d.total_cod || 0), 0))}
                                </td>
                                <td className="px-3 py-2.5 text-right text-xs">100%</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
