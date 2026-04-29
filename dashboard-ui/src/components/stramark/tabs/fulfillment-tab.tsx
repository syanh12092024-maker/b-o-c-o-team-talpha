"use client";

import { useEffect, useState, useCallback } from "react";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line, ComposedChart,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { cn } from "@/lib/utils";
import ExchangeRateBanner from "@/components/stramark/exchange-rate-banner";
import TabSkeleton from "@/components/ui/tab-skeleton";
import {
    Truck, Package, CheckCircle, XCircle, RotateCcw, Clock, AlertTriangle,
    ArrowRight, Globe, Warehouse, RefreshCw, Box, Activity, Loader2, Zap,
    Upload, ArrowUpRight,
} from "lucide-react";
import { DATASET } from "../constants";

const BQ_DS = `levelup-465304.${DATASET}`;

async function queryBQ(sql: string) {
    const r = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
    });
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

function fmtRON(v: number) {
    const a = Math.abs(v); const s = v < 0 ? "-" : "";
    if (a >= 1_000_000) return `${s}${(a / 1_000_000).toFixed(1)}M`;
    if (a >= 1_000) return `${s}${(a / 1_000).toFixed(0)}K`;
    return `${s}${Math.round(a)}`;
}
function fmtEUR(v: number) { return `€${v.toFixed(2)}`; }

// ─── Status Map — STRAMARK (string status) ───────────────────────────────────
const STATUS_MAP = [
    {
        key: "new",       label: "Đơn mới",
        desc: "Vừa tạo, chưa xác nhận",
        flow: "POS → Tạo",
        bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-600",
        icon: Clock, dot: "bg-slate-400",
    },
    {
        key: "submitted", label: "Đã xác nhận",
        desc: "CS confirm, chờ đóng hàng",
        flow: "CS → OK",
        bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700",
        icon: CheckCircle, dot: "bg-blue-400",
    },
    {
        key: "packing",   label: "Đang đóng hàng",
        desc: "Kho đóng gói → auto push lên euShipments",
        flow: "Kho → euShipments",
        bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700",
        icon: Clock, dot: "bg-orange-400",
    },
    {
        key: "ordered",   label: "Đã đặt 3PL",
        desc: "euShipments nhận đơn, AWB tạo xong",
        flow: "euShipments → AWB",
        bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-700",
        icon: Package, dot: "bg-indigo-400",
    },
    {
        key: "shipped",   label: "Đang vận chuyển",
        desc: "Courier Romania đang giao (Cargus/FAN/SameDay/GLS)",
        flow: "Courier → KH",
        bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-700",
        icon: Truck, dot: "bg-sky-400",
    },
    {
        key: "delivered", label: "Đã giao / Chờ đối soát",
        desc: "KH nhận hàng, COD chờ thu về",
        flow: "Courier → KH ✓",
        bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700",
        icon: Package, dot: "bg-amber-400",
    },
    {
        key: "received_money", label: "Đã thu tiền",
        desc: "COD đối soát xong, tiền về",
        flow: "COD ✅ Settled",
        bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700",
        icon: CheckCircle, dot: "bg-emerald-400",
    },
    {
        key: "returning", label: "Đang hoàn",
        desc: "KH từ chối → courier trả về kho Oradea",
        flow: "Courier → Kho",
        bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700",
        icon: RotateCcw, dot: "bg-rose-400",
    },
    {
        key: "returned",  label: "Đã hoàn",
        desc: "Hàng về kho HelpShip Oradea, cần restock",
        flow: "Kho ← SP",
        bg: "bg-red-50", border: "border-red-200", text: "text-red-700",
        icon: RotateCcw, dot: "bg-red-400",
    },
    {
        key: "canceled",  label: "Đã hủy",
        desc: "Hủy trước khi ship",
        flow: "⛔ Hủy",
        bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-600",
        icon: XCircle, dot: "bg-gray-400",
    },
    {
        key: "waitting",  label: "Chờ hàng",
        desc: "Tồn kho không đủ",
        flow: "⏸ Chờ",
        bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-700",
        icon: AlertTriangle, dot: "bg-yellow-400",
    },
];

const PIE_COLORS = ["#64748b", "#3b82f6", "#fb923c", "#6366f1", "#38bdf8", "#fbbf24", "#34d399", "#f43f5e", "#ef4444", "#9ca3af", "#facc15"];
const TOOLTIP_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12, color: "#e2e8f0" };

interface Props { dateRange?: { from: Date; to: Date }; }

export default function FulfillmentTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [ffmStats, setFfmStats] = useState<any>(null);
    const [dailyFlow, setDailyFlow] = useState<any[]>([]);

    // euShipments live
    const [euInventory, setEuInventory] = useState<any[]>([]);
    const [euOrders, setEuOrders] = useState<any[]>([]);
    const [euConnected, setEuConnected] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [lastSync, setLastSync] = useState<string | null>(null);

    // Push orders + status sync
    const [pushing, setPushing] = useState(false);
    const [pushResult, setPushResult] = useState<any>(null);
    const [statusSyncing, setStatusSyncing] = useState(false);
    const [statusSyncResult, setStatusSyncResult] = useState<any>(null);
    const [showSyncPreview, setShowSyncPreview] = useState(false);
    const [pushCountryFilter, setPushCountryFilter] = useState<string>("ALL");
    const [pushCourier, setPushCourier] = useState<string>("gls");

    // Status Audit proposals
    const [auditProposals, setAuditProposals] = useState<any[]>([]);
    const [auditPendingCount, setAuditPendingCount] = useState(0);
    const [lastAuditAt, setLastAuditAt] = useState<string | null>(null);
    const [auditRunning, setAuditRunning] = useState(false);
    const [selectedProposals, setSelectedProposals] = useState<Set<string>>(new Set());
    const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());

    // Ghost orders detection + force re-push
    const [ghostOrders, setGhostOrders] = useState<any[]>([]);
    const [ghostLoading, setGhostLoading] = useState(false);
    const [repushing, setRepushing] = useState<Set<string>>(new Set());
    const [repushResult, setRepushResult] = useState<any>(null);

    // Status sync history (audit log)
    const [syncHistory, setSyncHistory] = useState<any[]>([]);
    const [syncHistoryOpen, setSyncHistoryOpen] = useState(false);
    const [expandedHistoryIdx, setExpandedHistoryIdx] = useState<number | null>(null);

    // Weekly trend + Market comparison (new)
    const [weeklyTrend, setWeeklyTrend] = useState<any[]>([]);
    const [marketComparison, setMarketComparison] = useState<any[]>([]);

    // Delivery-days distribution (POS order date → delivered date)
    const [deliveryDaysData, setDeliveryDaysData] = useState<any[]>([]);
    const [deliveryDaysLoading, setDeliveryDaysLoading] = useState(false);
    const [productList, setProductList] = useState<string[]>([]);
    const [ddCountryFilter, setDdCountryFilter] = useState<string>("ALL");
    const [ddProductFilter, setDdProductFilter] = useState<string>("ALL");

    // Sub-tab selector (metrics = KPI/charts cho leader, ops = nghiệp vụ vận đơn)
    const [activeSubTab, setActiveSubTab] = useState<"metrics" | "ops">("ops");

    // Sync sub-tab state with URL hash for deep linking
    useEffect(() => {
        if (typeof window === "undefined") return;
        const readHash = () => {
            const h = window.location.hash.replace("#", "");
            if (h === "ops" || h === "metrics") setActiveSubTab(h);
        };
        readHash();
        window.addEventListener("hashchange", readHash);
        return () => window.removeEventListener("hashchange", readHash);
    }, []);

    const selectSubTab = useCallback((tab: "metrics" | "ops") => {
        setActiveSubTab(tab);
        if (typeof window !== "undefined") {
            window.history.replaceState(null, "", `#${tab}`);
        }
    }, []);

    useEffect(() => {
        setLoading(true);
        const from = dateRange?.from?.toISOString().slice(0, 10) || "2026-01-01";
        const to = dateRange?.to?.toISOString().slice(0, 10) || new Date().toISOString().slice(0, 10);

        // effective_date: created_date → WAYBILL_AVAILABLE_DATE (from raw_response) → synced_at
        const dateExpr = `DATE(COALESCE(
            created_date,
            PARSE_TIMESTAMP('%Y-%m-%d %H:%M:%S', JSON_VALUE(raw_response, '$.WAYBILL_AVAILABLE_DATE')),
            synced_at
        ))`;

        Promise.all([
            // Q1: ffm_shipments KPI summary + previous period for trend comparison
            queryBQ(`WITH curr AS (
                SELECT
                    COUNT(*) as total,
                    COUNTIF(status = 'Delivered') as fwd_delivered,
                    COUNTIF(status = 'Returned' OR is_return_shipment = TRUE) as return_shipments,
                    COUNTIF(status NOT IN ('Delivered','Returned') AND (is_return_shipment = FALSE OR is_return_shipment IS NULL)) as in_transit,
                    ROUND(SUM(price_incl_vat), 2) as total_cost_eur,
                    ROUND(SUM(CASE WHEN status = 'Delivered' THEN price_incl_vat ELSE 0 END), 2) as fwd_cost_eur,
                    ROUND(SUM(CASE WHEN status = 'Returned' OR is_return_shipment = TRUE THEN price_incl_vat ELSE 0 END), 2) as rev_cost_eur,
                    ROUND(SUM(CASE WHEN status = 'Delivered' AND cod_amount > 0 THEN cod_amount ELSE 0 END), 0) as cod_collected,
                    MAX(synced_at) as last_sync,
                    ROUND(AVG(CASE WHEN status = 'Delivered' AND delivered_date IS NOT NULL AND created_date IS NOT NULL
                        THEN TIMESTAMP_DIFF(delivered_date, created_date, HOUR) / 24.0 END), 1) as avg_delivery_days
                FROM \`${BQ_DS}.ffm_shipments\`
                WHERE ${dateExpr} BETWEEN '${from}' AND '${to}'
            ), prev AS (
                SELECT
                    COUNT(*) as total,
                    COUNTIF(status = 'Delivered') as fwd_delivered,
                    COUNTIF(status = 'Returned' OR is_return_shipment = TRUE) as return_shipments,
                    ROUND(SUM(price_incl_vat), 2) as total_cost_eur,
                    ROUND(SUM(CASE WHEN status = 'Delivered' AND cod_amount > 0 THEN cod_amount ELSE 0 END), 0) as cod_collected,
                    ROUND(AVG(CASE WHEN status = 'Delivered' AND delivered_date IS NOT NULL AND created_date IS NOT NULL
                        THEN TIMESTAMP_DIFF(delivered_date, created_date, HOUR) / 24.0 END), 1) as avg_delivery_days
                FROM \`${BQ_DS}.ffm_shipments\`
                WHERE ${dateExpr} BETWEEN
                    DATE_SUB('${from}', INTERVAL DATE_DIFF('${to}', '${from}', DAY) + 1 DAY)
                    AND DATE_SUB('${from}', INTERVAL 1 DAY)
            )
            SELECT c.*, p.total as prev_total, p.fwd_delivered as prev_fwd_delivered,
                p.return_shipments as prev_return_shipments, p.total_cost_eur as prev_total_cost_eur,
                p.cod_collected as prev_cod_collected, p.avg_delivery_days as prev_avg_delivery_days
            FROM curr c, prev p`).catch(() => [{}]),

            // Q2: Daily flow from ffm_shipments
            queryBQ(`SELECT
                ${dateExpr} as day,
                COUNTIF(status = 'Delivered') as success,
                COUNTIF(status = 'Returned' OR is_return_shipment = TRUE) as returned,
                COUNTIF(status NOT IN ('Delivered','Returned') AND (is_return_shipment = FALSE OR is_return_shipment IS NULL)) as in_transit
            FROM \`${BQ_DS}.ffm_shipments\`
            WHERE ${dateExpr} BETWEEN '${from}' AND '${to}'
            GROUP BY 1 ORDER BY 1`).catch(() => []),

            // Q3: Weekly delivery rate trend
            queryBQ(`SELECT
                FORMAT_DATE('%Y-W%V', DATE(${dateExpr})) as week_label,
                DATE_TRUNC(DATE(${dateExpr}), WEEK(MONDAY)) as week_start,
                COUNTIF(status = 'Delivered') as delivered,
                COUNTIF(status = 'Returned' OR is_return_shipment = TRUE) as returned,
                COUNT(*) as total,
                ROUND(SAFE_DIVIDE(COUNTIF(status = 'Delivered'),
                    COUNTIF(status = 'Delivered') + COUNTIF(status = 'Returned' OR is_return_shipment = TRUE)) * 100, 1) as success_rate
            FROM \`${BQ_DS}.ffm_shipments\`
            WHERE ${dateExpr} BETWEEN '${from}' AND '${to}'
            GROUP BY 1, 2 ORDER BY 2`).catch(() => []),

            // Q4: Market comparison (per-country)
            queryBQ(`SELECT
                COALESCE(fo.recipient_country, 'RO') as country,
                COUNT(*) as total_orders,
                COUNTIF(f.status = 'Delivered') as delivered,
                COUNTIF(f.status = 'Returned' OR f.is_return_shipment = TRUE) as returned,
                ROUND(SAFE_DIVIDE(COUNTIF(f.status = 'Delivered'),
                    COUNTIF(f.status = 'Delivered') + COUNTIF(f.status = 'Returned' OR f.is_return_shipment = TRUE)) * 100, 1) as success_rate,
                ROUND(AVG(CASE WHEN f.status = 'Delivered' AND f.delivered_date IS NOT NULL AND f.created_date IS NOT NULL
                    THEN TIMESTAMP_DIFF(f.delivered_date, f.created_date, HOUR) / 24.0 END), 1) as avg_delivery_days,
                ROUND(SAFE_DIVIDE(SUM(f.price_incl_vat), COUNT(*)), 2) as cost_per_order
            FROM \`${BQ_DS}.ffm_shipments\` f
            LEFT JOIN \`${BQ_DS}.fulfillment_orders\` fo ON f.pos_order_id = fo.pos_order_id
            WHERE ${dateExpr} BETWEEN '${from}' AND '${to}'
            GROUP BY 1 ORDER BY total_orders DESC`).catch(() => []),

            // Q5: euShipments live inventory
            fetchEU("inventory").catch(() => []),

            // Q6: euShipments live orders
            fetchEU("orders").catch(() => []),
        ]).then(([ffm, daily, weekly, market, inv, orders]) => {
            setFfmStats((ffm as any[])[0] || {});
            setDailyFlow((daily as any[]).map((d: any) => ({
                ...d,
                day: String(d.day?.value || d.day || "").slice(5),
            })));
            setWeeklyTrend((weekly as any[]).map((w: any) => ({
                ...w,
                week_label: String(w.week_label || ""),
            })));
            setMarketComparison(market as any[]);
            if (Array.isArray(inv) && inv.length > 0) { setEuInventory(inv); setEuConnected(true); }
            if (Array.isArray(orders) && orders.length > 0) { setEuOrders(orders); setEuConnected(true); }
            if ((!inv || inv.length === 0) && (!orders || orders.length === 0)) setEuConnected(false);
        }).catch(() => {}).finally(() => setLoading(false));
    }, [dateRange]);

    // ── Fetch product list (for delivery-days filter dropdown) ──────────
    useEffect(() => {
        const from = dateRange?.from?.toISOString().slice(0, 10) || "2026-01-01";
        const to = dateRange?.to?.toISOString().slice(0, 10) || new Date().toISOString().slice(0, 10);
        queryBQ(`SELECT DISTINCT pt.custom_id as product_code
            FROM \`${BQ_DS}.sale_order\` so
            JOIN \`${BQ_DS}.order_items\` oi ON so.id = oi.order_id
            JOIN \`${BQ_DS}.product_template\` pt ON oi.product_id = pt.id
            WHERE pt.custom_id IS NOT NULL AND pt.custom_id != ''
              AND DATE(SAFE.PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at))
                  BETWEEN '${from}' AND '${to}'
            ORDER BY 1`)
            .then((rows: any[]) => setProductList(rows.map(r => r.product_code).filter(Boolean)))
            .catch(() => setProductList([]));
    }, [dateRange]);

    // ── Delivery-days distribution: POS order date → delivered date ─────
    useEffect(() => {
        setDeliveryDaysLoading(true);
        const from = dateRange?.from?.toISOString().slice(0, 10) || "2026-01-01";
        const to = dateRange?.to?.toISOString().slice(0, 10) || new Date().toISOString().slice(0, 10);

        const safeProduct = ddProductFilter.replace(/[^a-zA-Z0-9_-]/g, "");
        const safeCountry = ddCountryFilter.replace(/[^A-Z]/g, "");

        const productJoin = safeProduct === "ALL" || !safeProduct ? "" : `
            INNER JOIN (
                SELECT DISTINCT CAST(oi.order_id AS STRING) as order_id_str
                FROM \`${BQ_DS}.order_items\` oi
                JOIN \`${BQ_DS}.product_template\` pt ON oi.product_id = pt.id
                WHERE pt.custom_id = '${safeProduct}'
            ) prod ON prod.order_id_str = f.pos_order_id`;

        const countryCond = safeCountry === "ALL" || !safeCountry ? "" :
            `AND COALESCE(fo.recipient_country, 'RO') = '${safeCountry}'`;

        const sql = `WITH base AS (
            SELECT
                f.pos_order_id,
                f.status,
                f.is_return_shipment,
                CASE
                    WHEN f.status = 'Delivered' AND f.delivered_date IS NOT NULL
                        THEN DATE_DIFF(DATE(f.delivered_date),
                             DATE(SAFE.PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at)), DAY)
                    WHEN (f.status = 'Returned' OR f.is_return_shipment = TRUE) AND f.delivered_date IS NOT NULL
                        THEN DATE_DIFF(DATE(f.delivered_date),
                             DATE(SAFE.PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at)), DAY)
                    WHEN (f.status = 'Returned' OR f.is_return_shipment = TRUE) AND f.synced_at IS NOT NULL
                        THEN DATE_DIFF(DATE(f.synced_at),
                             DATE(SAFE.PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at)), DAY)
                    ELSE DATE_DIFF(CURRENT_DATE(),
                         DATE(SAFE.PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at)), DAY)
                END as days
            FROM \`${BQ_DS}.ffm_shipments\` f
            LEFT JOIN \`${BQ_DS}.fulfillment_orders\` fo ON f.pos_order_id = fo.pos_order_id
            INNER JOIN \`${BQ_DS}.sale_order\` so ON f.pos_order_id = CAST(so.id AS STRING)
            ${productJoin}
            WHERE DATE(SAFE.PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at))
                  BETWEEN '${from}' AND '${to}'
              ${countryCond}
              AND NOT (f.status = 'Returned'
                       AND f.delivered_date IS NOT NULL
                       AND f.created_date IS NOT NULL
                       AND DATE(f.delivered_date) = DATE(f.created_date))
        )
        SELECT
            CASE WHEN days < 0 THEN 0 WHEN days > 20 THEN 20 ELSE days END as days,
            COUNTIF(status = 'Delivered') as delivered,
            COUNTIF(status = 'Returned' OR is_return_shipment = TRUE) as returned,
            COUNTIF(status NOT IN ('Delivered','Returned')
                    AND (is_return_shipment = FALSE OR is_return_shipment IS NULL)) as in_transit,
            COUNT(*) as total
        FROM base
        WHERE days IS NOT NULL
        GROUP BY 1 ORDER BY 1`;

        queryBQ(sql)
            .then((raw: any[]) => {
                const total = raw.reduce((s, r) => s + (r.total || 0), 0);
                const byDay = new Map(raw.map(r => [Number(r.days), r]));
                let cumDelivered = 0;
                let cumReturned = 0;
                const enriched: any[] = [];
                for (let d = 0; d <= 20; d++) {
                    const r = byDay.get(d) || { delivered: 0, returned: 0, in_transit: 0, total: 0 };
                    cumDelivered += (r.delivered || 0);
                    cumReturned += (r.returned || 0);
                    const perDayFinalized = (r.delivered || 0) + (r.returned || 0);
                    enriched.push({
                        days: d,
                        days_label: d === 20 ? "20+ ngày" : `${d} ngày`,
                        delivered: r.delivered || 0,
                        returned: r.returned || 0,
                        in_transit: r.in_transit || 0,
                        total: r.total || 0,
                        cum_delivered: cumDelivered,
                        cum_returned: cumReturned,
                        cum_success_rate: total > 0
                            ? Math.round((cumDelivered / total) * 1000) / 10
                            : 0,
                        // Per-day: trong đơn đã "kết thúc" ĐÚNG tại N ngày (không cộng dồn),
                        // tỷ lệ giao thành công là bao nhiêu. Giúp nhìn biến động theo từng mốc.
                        at_day_success_rate: perDayFinalized > 0
                            ? Math.round(((r.delivered || 0) / perDayFinalized) * 1000) / 10
                            : null,
                    });
                }
                setDeliveryDaysData(enriched);
            })
            .catch(() => setDeliveryDaysData([]))
            .finally(() => setDeliveryDaysLoading(false));
    }, [dateRange, ddProductFilter, ddCountryFilter]);

    // ── Fetch audit proposals on mount + poll every 60s ──
    useEffect(() => {
        const fetchProposals = async () => {
            try {
                const resp = await fetch("/api/stramark/eushipments/status-audit");
                const data = await resp.json();
                const pending = (data.proposals || []).filter((p: any) => p.status === "pending");
                setAuditProposals(pending);
                setAuditPendingCount(data.pendingCount || pending.length);
                setLastAuditAt(data.lastAuditAt || null);
            } catch { /* silent */ }
        };
        fetchProposals();
        const interval = setInterval(fetchProposals, 60000);
        return () => clearInterval(interval);
    }, []);

    // ── Fetch ghost orders on mount + poll every 2 min ──
    useEffect(() => {
        const fetchGhosts = async () => {
            try {
                const resp = await fetch("/api/stramark/eushipments/ghost-orders");
                const data = await resp.json();
                setGhostOrders(data.ghostOrders || []);
            } catch { /* silent */ }
        };
        fetchGhosts();
        const interval = setInterval(fetchGhosts, 120000);
        return () => clearInterval(interval);
    }, []);

    // ── Fetch status sync history (audit log) ──
    const fetchSyncHistory = useCallback(async () => {
        try {
            const resp = await fetch("/api/stramark/eushipments/status-sync?action=history&limit=20");
            const data = await resp.json();
            setSyncHistory(data.entries || []);
        } catch { /* silent */ }
    }, []);

    useEffect(() => {
        fetchSyncHistory();
        const interval = setInterval(fetchSyncHistory, 60000);
        return () => clearInterval(interval);
    }, [fetchSyncHistory]);

    // ── Force re-push ghost orders ──
    const handleForceRepush = useCallback(async (orderIds: string[]) => {
        if (orderIds.length === 0) return;
        const confirmed = confirm(
            `Force re-push ${orderIds.length} đơn ghost?\n\n` +
            `Orders: ${orderIds.join(", ")}\n` +
            `Sẽ tạo clientReference mới (STR-{id}-R2)`
        );
        if (!confirmed) return;

        setRepushing(prev => new Set([...prev, ...orderIds]));
        setRepushResult(null);
        try {
            const resp = await fetch("/api/stramark/eushipments/force-repush", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderIds }),
            });
            const data = await resp.json();
            setRepushResult(data);
            // Refresh ghost orders
            const r2 = await fetch("/api/stramark/eushipments/ghost-orders");
            const d2 = await r2.json();
            setGhostOrders(d2.ghostOrders || []);
            if (data.success) {
                alert(`Force re-push: ${data.stats?.created || 0} tạo, ${data.stats?.failed || 0} lỗi, ${data.stats?.skipped || 0} bỏ qua`);
            } else {
                alert(`Lỗi: ${data.error || "Unknown"}`);
            }
        } catch (err: any) {
            alert(`Force re-push thất bại: ${err.message}`);
        } finally {
            setRepushing(prev => {
                const next = new Set(prev);
                orderIds.forEach(id => next.delete(id));
                return next;
            });
        }
    }, []);

    const handleTriggerAudit = useCallback(async () => {
        if (auditRunning) return;
        setAuditRunning(true);
        try {
            const resp = await fetch("/api/stramark/eushipments/status-audit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "trigger-audit" }),
            });
            const data = await resp.json();
            if (data.success) {
                // Refresh proposals
                const r2 = await fetch("/api/stramark/eushipments/status-audit");
                const d2 = await r2.json();
                const pending = (d2.proposals || []).filter((p: any) => p.status === "pending");
                setAuditProposals(pending);
                setAuditPendingCount(d2.pendingCount || pending.length);
                setLastAuditAt(d2.lastAuditAt || null);
                alert(`Audit xong! ${d2.pendingCount || 0} đề xuất chờ duyệt`);
            } else {
                alert(`Audit lỗi: ${data.error || "Unknown"}`);
            }
        } catch (err: any) {
            alert(`Audit thất bại: ${err.message}`);
        } finally { setAuditRunning(false); }
    }, [auditRunning]);

    const handleAuditAction = useCallback(async (action: "approve" | "reject", ids: string[]) => {
        if (ids.length === 0) return;
        const label = action === "approve" ? "Duyệt" : "Từ chối";
        if (action === "approve") {
            const ok = confirm(`${label} ${ids.length} đơn?\n\nStatus trên POS sẽ được cập nhật ngay sau khi duyệt.`);
            if (!ok) return;
        }
        setApprovingIds(prev => new Set([...prev, ...ids]));
        try {
            const resp = await fetch("/api/stramark/eushipments/status-audit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, proposalIds: ids }),
            });
            const data = await resp.json();
            if (data.success) {
                const resultMsgs = (data.results || []).map((r: any) => `#${r.orderId}: ${r.result}`).join("\n");
                alert(`${label} xong!\n\n${resultMsgs}`);
                // Refresh
                const r2 = await fetch("/api/stramark/eushipments/status-audit");
                const d2 = await r2.json();
                const pending = (d2.proposals || []).filter((p: any) => p.status === "pending");
                setAuditProposals(pending);
                setAuditPendingCount(d2.pendingCount || pending.length);
                setSelectedProposals(new Set());
            } else {
                alert(`Lỗi: ${data.error || "Unknown"}`);
            }
        } catch (err: any) {
            alert(`Thất bại: ${err.message}`);
        } finally {
            setApprovingIds(prev => {
                const next = new Set(prev);
                ids.forEach(id => next.delete(id));
                return next;
            });
        }
    }, []);

    const handleSync = useCallback(async () => {
        setSyncing(true);
        try {
            const result = await triggerSync();
            setLastSync(new Date().toISOString());
            const [inv, orders] = await Promise.all([
                fetchEU("inventory").catch(() => []),
                fetchEU("orders").catch(() => []),
            ]);
            if (Array.isArray(inv)) setEuInventory(inv);
            if (Array.isArray(orders)) setEuOrders(orders);
            setEuConnected(true);
            alert(`✅ Sync thành công!\n📦 Inventory: ${result.inventory?.synced || 0} SKUs\n📋 Orders: ${result.orders?.synced || 0} mới`);
        } catch (err: any) {
            alert(`❌ Sync thất bại: ${err.message}`);
        } finally { setSyncing(false); }
    }, []);

    // Push packing orders → euShipments (multi-country)
    const handlePushOrders = useCallback(async () => {
        if (pushing) return;
        const countryLabel = pushCountryFilter === "ALL" ? "TẤT CẢ quốc gia"
            : pushCountryFilter === "RO" ? "Romania" : pushCountryFilter === "SK" ? "Slovakia"
            : pushCountryFilter === "BG" ? "Bulgaria" : "Croatia";
        const confirmed = confirm(
            `Đẩy đơn "Đang đóng hàng" (status=8) lên euShipments?\n\n` +
            `Quốc gia: ${countryLabel}\n` +
            `Auto-routing: Tag Slovakia → GLS SK, Tag Bulgaria → Express One, Tag Croatia → DPD HR\n` +
            `Không có tag → Romania Cargus (mặc định)`
        );
        if (!confirmed) return;

        setPushing(true);
        setPushResult(null);
        try {
            const resp = await fetch("/api/stramark/eushipments/push-orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dryRun: false, filterCountry: pushCountryFilter, courier: pushCourier }),
            });
            const data = await resp.json();
            setPushResult(data);

            if (data.success) {
                const countryLines = Object.entries(data.byCountry || {}).map(([code, s]: [string, any]) =>
                    `  ${code}: ${s.created} ok, ${s.failed} fail, ${s.skipped} skip`
                );
                const posLine = (data.stats?.posUpdated || 0) > 0
                    ? `\nPOS: ${data.stats.posUpdated} đơn → Chờ chuyển hàng` +
                      ((data.stats?.posUpdateFailed || 0) > 0 ? ` (${data.stats.posUpdateFailed} lỗi)` : "")
                    : "";
                alert([
                    `Push hoàn tất!`,
                    `Tổng: ${data.stats?.total || 0} | OK: ${data.stats?.created || 0} | Lỗi: ${data.stats?.failed || 0} | Skip: ${data.stats?.skipped || 0}`,
                    countryLines.length > 0 ? `\nTheo quốc gia:\n${countryLines.join("\n")}` : "",
                    posLine,
                ].filter(Boolean).join("\n"));
            } else {
                alert(`Push lỗi: ${data.error || "Unknown"}`);
            }
        } catch (err: any) {
            setPushResult({ success: false, error: err.message });
            alert(`Push thất bại: ${err.message}`);
        } finally { setPushing(false); }
    }, [pushing, pushCountryFilter, pushCourier]);

    // Status sync: euShipments tracking → POS Cake status update (2-step: preview → confirm)
    const handleStatusSync = useCallback(async (dryRun: boolean) => {
        if (statusSyncing) return;
        setStatusSyncing(true);
        try {
            const resp = await fetch("/api/stramark/eushipments/status-sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dryRun }),
            });
            const data = await resp.json();
            if (data.success) {
                if (dryRun) {
                    setStatusSyncResult(data);
                    setShowSyncPreview(true);
                } else {
                    setShowSyncPreview(false);
                    setStatusSyncResult(null);
                    alert([
                        `Status Sync hoàn tất!`,
                        `Checked: ${data.stats?.checked || 0}`,
                        `Updated: ${data.stats?.updated || 0}`,
                        `Đã đúng: ${data.stats?.unchanged || 0}`,
                        `Bỏ qua: ${data.stats?.skipped || 0}`,
                        `Lỗi: ${data.stats?.errors || 0}`,
                    ].join("\n"));
                }
            } else {
                alert(`Status Sync lỗi: ${data.error || "Unknown"}`);
            }
        } catch (err: any) {
            alert(`Status Sync thất bại: ${err.message}`);
        } finally { setStatusSyncing(false); }
    }, [statusSyncing]);

    if (loading) return <TabSkeleton cards={4} showChart={true} rows={5} />;

    // ─── Compute metrics (100% from ffm_shipments / euShipments) ────────────
    const totalShipments = ffmStats?.total || 0;
    const fwdDelivered   = ffmStats?.fwd_delivered || 0;     // Giao TC: sender=Aurelia Wear
    const returnShipments = ffmStats?.return_shipments || 0;  // Đơn hoàn (tổng)
    const inTransit      = ffmStats?.in_transit || 0;
    const codCollected   = ffmStats?.cod_collected || 0;      // COD thu được (EUR)

    const deliveryRate = fwdDelivered + returnShipments > 0
        ? ((fwdDelivered / (fwdDelivered + returnShipments)) * 100).toFixed(1) : "0.0";
    const returnRate = fwdDelivered + returnShipments > 0
        ? ((returnShipments / (fwdDelivered + returnShipments)) * 100).toFixed(1) : "0.0";

    const pieData = [
        { name: "Giao thành công", value: fwdDelivered, color: "#34d399" },
        { name: "Đơn hoàn", value: returnShipments, color: "#f43f5e" },
        { name: "Đang vận chuyển", value: inTransit, color: "#38bdf8" },
    ].filter(d => d.value > 0);

    // ─── Trend comparison vs previous period ──────────────────────────────
    const calcTrend = (curr: number, prev: number): number | null => {
        if (!prev || prev === 0) return null;
        return Math.round(((curr - prev) / prev) * 100);
    };
    const trendTotal = calcTrend(totalShipments, ffmStats?.prev_total || 0);
    const trendDelivered = calcTrend(fwdDelivered, ffmStats?.prev_fwd_delivered || 0);
    const trendReturns = calcTrend(returnShipments, ffmStats?.prev_return_shipments || 0);
    const trendCod = calcTrend(codCollected, ffmStats?.prev_cod_collected || 0);
    const trendCost = calcTrend(ffmStats?.total_cost_eur || 0, ffmStats?.prev_total_cost_eur || 0);
    const avgDeliveryDays = ffmStats?.avg_delivery_days || 0;
    const trendAvgDelivery = calcTrend(avgDeliveryDays, ffmStats?.prev_avg_delivery_days || 0);

    const COUNTRY_FLAGS: Record<string, string> = { RO: "🇷🇴", SK: "🇸🇰", BG: "🇧🇬", HR: "🇭🇷" };
    const COUNTRY_NAMES: Record<string, string> = { RO: "Romania", SK: "Slovakia", BG: "Bulgaria", HR: "Croatia" };

    const totalAvailableQty = euInventory.reduce((s, i) => s + (i.availableQty || 0), 0);
    const totalReservedQty  = euInventory.reduce((s, i) => s + (i.reservedQty || 0), 0);
    const totalStockQty     = euInventory.reduce((s, i) => s + (i.totalQty || 0), 0);

    return (
        <div className="space-y-6">
            {/* ─── Sub-tab selector (top-level, prominent) ────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                    onClick={() => selectSubTab("ops")}
                    className={cn(
                        "group relative flex items-center gap-4 rounded-xl border p-4 text-left transition-all",
                        activeSubTab === "ops"
                            ? "border-orange-500 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/40 dark:to-amber-950/30 shadow-md ring-2 ring-orange-500/20"
                            : "border-border bg-card hover:border-orange-300 hover:bg-orange-50/40 dark:hover:bg-orange-950/20"
                    )}
                >
                    <div className={cn(
                        "flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                        activeSubTab === "ops"
                            ? "bg-orange-500 text-white shadow-lg shadow-orange-500/30"
                            : "bg-muted text-muted-foreground group-hover:bg-orange-100 group-hover:text-orange-600 dark:group-hover:bg-orange-900/40"
                    )}>
                        <Truck className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <h3 className={cn(
                                "text-sm font-bold",
                                activeSubTab === "ops" ? "text-orange-700 dark:text-orange-300" : "text-foreground"
                            )}>
                                Nghiệp vụ vận đơn
                            </h3>
                            {(auditPendingCount > 0 || ghostOrders.length > 0) && (
                                <span className="inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 min-w-[18px] h-[18px] shadow animate-pulse">
                                    {auditPendingCount + ghostOrders.length}
                                </span>
                            )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                            Push đơn · Sync status · Audit · Inventory
                        </p>
                    </div>
                    {activeSubTab === "ops" && (
                        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                    )}
                </button>

                <button
                    onClick={() => selectSubTab("metrics")}
                    className={cn(
                        "group relative flex items-center gap-4 rounded-xl border p-4 text-left transition-all",
                        activeSubTab === "metrics"
                            ? "border-emerald-500 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30 shadow-md ring-2 ring-emerald-500/20"
                            : "border-border bg-card hover:border-emerald-300 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20"
                    )}
                >
                    <div className={cn(
                        "flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                        activeSubTab === "metrics"
                            ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30"
                            : "bg-muted text-muted-foreground group-hover:bg-emerald-100 group-hover:text-emerald-600 dark:group-hover:bg-emerald-900/40"
                    )}>
                        <Activity className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className={cn(
                            "text-sm font-bold",
                            activeSubTab === "metrics" ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"
                        )}>
                            Chỉ số giao hàng
                        </h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                            KPI · Tỷ lệ giao · Phân bố theo ngày · So sánh thị trường
                        </p>
                    </div>
                    {activeSubTab === "metrics" && (
                        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    )}
                </button>
            </div>

            <ExchangeRateBanner />

            {/* ─── Header Banner ──────────────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-gradient-to-r from-orange-900 via-red-900 to-slate-900 p-5 text-white">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <Globe className="w-4 h-4 text-orange-300" />
                            <span className="text-xs text-orange-300">3PL Partner: euShipments (HelpShip Oradea)</span>
                            {euConnected ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-500/30">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> API Connected
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/20 px-2 py-0.5 text-[10px] font-semibold text-slate-300 border border-slate-500/30">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> BQ Only
                                </span>
                            )}
                        </div>
                        <h2 className="text-xl font-bold">Fulfillment — EU Markets</h2>
                        <div className="flex items-center gap-4 mt-1 text-sm text-slate-400">
                            <span>🇷🇴 Cargus/FAN/SameDay</span>
                            <span>🇸🇰 GLS SK</span>
                            <span>🇧🇬 Express One</span>
                            <span>🇭🇷 DPD</span>
                            <span>🏭 Kho: HelpShip Oradea</span>
                        </div>
                    </div>
                </div>

                {/* ─── Action Panels ── chỉ hiện ở tab Ops ─────────────── */}
                {activeSubTab === "ops" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

                    {/* ── Card 1: Đẩy đơn lên euShipments ── */}
                    <div className="rounded-lg bg-slate-800/50 border border-violet-500/20 p-3">
                        <div className="flex items-center gap-2 mb-2.5">
                            <div className="w-7 h-7 rounded-md bg-violet-500/20 flex items-center justify-center">
                                <Upload className="w-3.5 h-3.5 text-violet-300" />
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-violet-200">Đẩy đơn lên euShipments</h4>
                                <p className="text-[10px] text-slate-500">Đóng hàng xong → tạo vận đơn trên courier</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <select
                                value={pushCountryFilter}
                                onChange={(e) => setPushCountryFilter(e.target.value)}
                                className="rounded bg-slate-700/60 border border-slate-600 text-slate-200 text-[11px] px-2 py-1.5 cursor-pointer flex-1 min-w-0"
                            >
                                <option value="ALL">All Markets</option>
                                <option value="RO">Romania</option>
                                <option value="SK">Slovakia</option>
                                <option value="BG">Bulgaria</option>
                                <option value="HR">Croatia</option>
                            </select>
                            {(pushCountryFilter === "ALL" || pushCountryFilter === "RO") && (
                                <select
                                    value={pushCourier}
                                    onChange={(e) => setPushCourier(e.target.value)}
                                    className="rounded bg-slate-700/60 border border-slate-600 text-slate-200 text-[11px] px-2 py-1.5 cursor-pointer flex-1 min-w-0"
                                >
                                    <option value="gls">GLS RO</option>
                                    <option value="cheapest">Cargus</option>
                                    <option value="sameday">SameDay</option>
                                    <option value="fan">FAN</option>
                                </select>
                            )}
                        </div>
                        <button onClick={handlePushOrders} disabled={pushing}
                            className={cn(
                                "w-full mt-2 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all",
                                pushing
                                    ? "bg-slate-600/50 text-slate-400 cursor-not-allowed"
                                    : "bg-violet-500/20 text-violet-200 border border-violet-500/40 hover:bg-violet-500/30"
                            )}>
                            {pushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            {pushing ? "Đang đẩy đơn..." : "Đẩy đơn"}
                        </button>
                    </div>

                    {/* ── Card 2: Kiểm tra trạng thái ── */}
                    <div className="rounded-lg bg-slate-800/50 border border-amber-500/20 p-3 relative">
                        {auditPendingCount > 0 && (
                            <span className="absolute -top-2 -right-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-lg animate-pulse">
                                {auditPendingCount}
                            </span>
                        )}
                        <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-md bg-amber-500/20 flex items-center justify-center">
                                    <Activity className="w-3.5 h-3.5 text-amber-300" />
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-amber-200">Kiểm tra trạng thái đơn</h4>
                                    <p className="text-[10px] text-slate-500">So khớp POS vs euShipments · auto 8h &amp; 16h</p>
                                </div>
                            </div>
                            {/* Sync data nhỏ gọn ở góc */}
                            <button onClick={handleSync} disabled={syncing}
                                className={cn(
                                    "flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-all",
                                    syncing
                                        ? "text-slate-500 cursor-not-allowed"
                                        : "text-slate-400 hover:text-orange-300 hover:bg-slate-700/50"
                                )}
                                title="Sync dữ liệu euShipments → BigQuery (tự động 6h sáng)"
                            >
                                {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                {syncing ? "Syncing..." : "Sync Data"}
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                            <button onClick={() => handleStatusSync(true)} disabled={statusSyncing}
                                className={cn(
                                    "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-bold transition-all",
                                    statusSyncing
                                        ? "bg-slate-600/50 text-slate-400 cursor-not-allowed"
                                        : "bg-sky-500/20 text-sky-200 border border-sky-500/40 hover:bg-sky-500/30"
                                )}>
                                {statusSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                                {statusSyncing ? "Đang check..." : "Sync Status → POS"}
                            </button>
                            <button onClick={handleTriggerAudit} disabled={auditRunning}
                                className={cn(
                                    "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-bold transition-all",
                                    auditRunning
                                        ? "bg-slate-600/50 text-slate-400 cursor-not-allowed"
                                        : "bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30"
                                )}>
                                {auditRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                                {auditRunning ? "Đang kiểm tra..." : "Kiểm tra lệch status"}
                            </button>
                        </div>
                    </div>
                </div>
                )}
            </div>

            {/* ─── Status Sync Preview Panel ───────────────────── */}
            {activeSubTab === "ops" && showSyncPreview && statusSyncResult && (
                <div className="rounded-xl border border-sky-500/30 bg-sky-950/30 p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-sky-300">
                            Preview: Sync Status → POS
                        </h3>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400">
                                {statusSyncResult.stats?.checked || 0} checked ·{" "}
                                {statusSyncResult.stats?.updated || 0} sẽ cập nhật ·{" "}
                                {statusSyncResult.stats?.unchanged || 0} đã đúng ·{" "}
                                {statusSyncResult.stats?.skipped || 0} bỏ qua
                            </span>
                            <button
                                onClick={() => { setShowSyncPreview(false); setStatusSyncResult(null); }}
                                className="text-slate-500 hover:text-slate-300 text-xs px-2 py-1 rounded border border-slate-600 hover:border-slate-400"
                            >
                                Đóng
                            </button>
                            <button
                                onClick={() => handleStatusSync(false)}
                                disabled={statusSyncing || (statusSyncResult.stats?.updated || 0) === 0}
                                className={cn(
                                    "flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                                    statusSyncing || (statusSyncResult.stats?.updated || 0) === 0
                                        ? "bg-slate-600/50 text-slate-400 cursor-not-allowed"
                                        : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
                                )}
                            >
                                {statusSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                                {statusSyncing ? "Đang cập nhật..." : `Xác nhận cập nhật ${statusSyncResult.stats?.updated || 0} đơn`}
                            </button>
                        </div>
                    </div>
                    {(statusSyncResult.updates?.length || 0) > 0 ? (
                        <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-700/50 bg-slate-900/50">
                            <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-slate-800/90 text-slate-400">
                                    <tr>
                                        <th className="px-3 py-2 text-left">POS Order</th>
                                        <th className="px-3 py-2 text-left">euShipments Status</th>
                                        <th className="px-3 py-2 text-left">Hiện tại (POS)</th>
                                        <th className="px-3 py-2 text-left">→ Mới</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {statusSyncResult.updates.map((u: any, i: number) => (
                                        <tr key={i} className="border-t border-slate-700/30 hover:bg-slate-800/30">
                                            <td className="px-3 py-1.5 font-mono text-slate-300">#{u.posOrderId}</td>
                                            <td className="px-3 py-1.5 text-slate-400">{u.euStatus}</td>
                                            <td className="px-3 py-1.5">
                                                <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-slate-400">
                                                    {u.currentPosStatus || "—"}
                                                </span>
                                            </td>
                                            <td className="px-3 py-1.5">
                                                <span className={cn("rounded px-1.5 py-0.5 font-semibold", {
                                                    "bg-emerald-500/20 text-emerald-300": u.posStatus === "delivered",
                                                    "bg-red-500/20 text-red-300": u.posStatus === "returned",
                                                    "bg-amber-500/20 text-amber-300": u.posStatus === "returning",
                                                    "bg-sky-500/20 text-sky-300": u.posStatus === "shipped",
                                                })}>
                                                    {u.posStatus}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="text-xs text-slate-500">Không có đơn nào cần cập nhật status.</p>
                    )}
                </div>
            )}

            {/* ─── Sync History (Audit Log) ──────────────────────────────── */}
            {activeSubTab === "ops" && syncHistory.length > 0 && (
                <div className="rounded-xl border border-slate-500/30 bg-slate-950/20 p-4">
                    <button
                        onClick={() => setSyncHistoryOpen(v => !v)}
                        className="w-full flex items-center justify-between text-sm font-bold text-slate-300 hover:text-slate-100"
                    >
                        <span className="flex items-center gap-2">
                            <Activity className="w-4 h-4" />
                            Lịch sử cập nhật status ({syncHistory.length} lần gần nhất)
                            {syncHistory.some((h: any) => h.stats?.errors > 0) && (
                                <span className="inline-flex items-center rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-medium text-rose-300">
                                    {syncHistory.reduce((s: number, h: any) => s + (h.stats?.errors || 0), 0)} đơn lỗi
                                </span>
                            )}
                        </span>
                        <span className="text-xs text-slate-400">{syncHistoryOpen ? "▼ Ẩn" : "▶ Mở"}</span>
                    </button>

                    {syncHistoryOpen && (
                        <div className="mt-3 space-y-2">
                            <div className="overflow-x-auto rounded-lg border border-slate-700/50 bg-slate-900/50">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-800/90 text-slate-400">
                                        <tr>
                                            <th className="px-3 py-2 text-left">Thời gian</th>
                                            <th className="px-3 py-2 text-right">Tổng</th>
                                            <th className="px-3 py-2 text-right">Cập nhật</th>
                                            <th className="px-3 py-2 text-right">Đã đúng</th>
                                            <th className="px-3 py-2 text-right">Bỏ qua</th>
                                            <th className="px-3 py-2 text-right">Lỗi</th>
                                            <th className="px-3 py-2 text-right">Chi tiết</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {syncHistory.map((h: any, idx: number) => {
                                            const errors = h.stats?.errors || 0;
                                            const errorOrders = (h.updates || []).filter((u: any) => u.result === "error");
                                            return (
                                                <>
                                                    <tr key={idx} className={cn("border-t border-slate-700/30 hover:bg-slate-800/30",
                                                        errors > 0 && "bg-rose-950/20"
                                                    )}>
                                                        <td className="px-3 py-1.5 text-slate-300 font-mono text-[10px]">
                                                            {new Date(h.timestamp).toLocaleString("vi-VN")}
                                                        </td>
                                                        <td className="px-3 py-1.5 text-right text-slate-400">{h.stats?.checked || 0}</td>
                                                        <td className="px-3 py-1.5 text-right text-emerald-400 font-semibold">{h.stats?.updated || 0}</td>
                                                        <td className="px-3 py-1.5 text-right text-slate-500">{h.stats?.unchanged || 0}</td>
                                                        <td className="px-3 py-1.5 text-right text-amber-400">{h.stats?.skipped || 0}</td>
                                                        <td className={cn("px-3 py-1.5 text-right font-semibold",
                                                            errors > 0 ? "text-rose-400" : "text-slate-500"
                                                        )}>{errors}</td>
                                                        <td className="px-3 py-1.5 text-right">
                                                            {errorOrders.length > 0 ? (
                                                                <button
                                                                    onClick={() => setExpandedHistoryIdx(expandedHistoryIdx === idx ? null : idx)}
                                                                    className="rounded px-2 py-0.5 text-[10px] font-semibold bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                                                                >
                                                                    {expandedHistoryIdx === idx ? "Ẩn" : `Xem ${errorOrders.length} đơn lỗi`}
                                                                </button>
                                                            ) : (
                                                                <span className="text-[10px] text-slate-600">—</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    {expandedHistoryIdx === idx && errorOrders.length > 0 && (
                                                        <tr key={`${idx}-detail`} className="bg-rose-950/30">
                                                            <td colSpan={7} className="px-3 py-2">
                                                                <div className="text-[10px] text-rose-200 font-semibold mb-2">Đơn lỗi:</div>
                                                                <table className="w-full text-[10px]">
                                                                    <thead className="text-rose-300/70">
                                                                        <tr>
                                                                            <th className="px-2 py-1 text-left">POS ID</th>
                                                                            <th className="px-2 py-1 text-left">EU Status</th>
                                                                            <th className="px-2 py-1 text-left">POS hiện tại</th>
                                                                            <th className="px-2 py-1 text-left">Đề xuất</th>
                                                                            <th className="px-2 py-1 text-left">Label</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {errorOrders.map((u: any, i: number) => (
                                                                            <tr key={i} className="border-t border-rose-500/20">
                                                                                <td className="px-2 py-1 font-mono text-rose-200">#{u.posOrderId}</td>
                                                                                <td className="px-2 py-1 text-slate-300">{u.euStatus}</td>
                                                                                <td className="px-2 py-1 text-slate-400">{u.currentPosStatus || "—"}</td>
                                                                                <td className="px-2 py-1 text-amber-300">{u.posStatus}</td>
                                                                                <td className="px-2 py-1 text-slate-400">{u.label}</td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <div className="text-[10px] text-slate-500">
                                Lưu tối đa 50 lần sync gần nhất. Click "Xem N đơn lỗi" để xem chi tiết các đơn cập nhật thất bại.
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ─── Status Audit Proposals Panel ─────────────────────────── */}
            {activeSubTab === "ops" && auditProposals.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            Đề xuất cập nhật status ({auditProposals.length} đơn lệch)
                        </h3>
                        <div className="flex items-center gap-2">
                            {lastAuditAt && (
                                <span className="text-[10px] text-slate-500">
                                    Kiểm tra lúc: {new Date(lastAuditAt).toLocaleString("vi-VN")}
                                </span>
                            )}
                            <button
                                onClick={() => {
                                    const ids = Array.from(selectedProposals);
                                    if (ids.length === 0) return alert("Chọn ít nhất 1 đơn");
                                    handleAuditAction("reject", ids);
                                }}
                                disabled={selectedProposals.size === 0}
                                className={cn(
                                    "flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                                    selectedProposals.size === 0
                                        ? "bg-slate-600/50 text-slate-400 cursor-not-allowed"
                                        : "bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30"
                                )}
                            >
                                <XCircle className="w-3 h-3" />
                                Từ chối ({selectedProposals.size})
                            </button>
                            <button
                                onClick={() => {
                                    const ids = Array.from(selectedProposals);
                                    if (ids.length === 0) return alert("Chọn ít nhất 1 đơn");
                                    handleAuditAction("approve", ids);
                                }}
                                disabled={selectedProposals.size === 0 || approvingIds.size > 0}
                                className={cn(
                                    "flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                                    selectedProposals.size === 0 || approvingIds.size > 0
                                        ? "bg-slate-600/50 text-slate-400 cursor-not-allowed"
                                        : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
                                )}
                            >
                                {approvingIds.size > 0
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <CheckCircle className="w-3 h-3" />}
                                {approvingIds.size > 0 ? "Đang cập nhật..." : `Duyệt cập nhật (${selectedProposals.size})`}
                            </button>
                        </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-700/50 bg-slate-900/50">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-slate-800/90 text-slate-400">
                                <tr>
                                    <th className="px-2 py-2 w-8">
                                        <input
                                            type="checkbox"
                                            className="rounded"
                                            checked={selectedProposals.size === auditProposals.length && auditProposals.length > 0}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setSelectedProposals(new Set(auditProposals.map((p: any) => p.id)));
                                                } else {
                                                    setSelectedProposals(new Set());
                                                }
                                            }}
                                        />
                                    </th>
                                    <th className="px-3 py-2 text-left">Order</th>
                                    <th className="px-3 py-2 text-left">AWB</th>
                                    <th className="px-3 py-2 text-left">EU Status</th>
                                    <th className="px-3 py-2 text-left">POS hiện tại</th>
                                    <th className="px-3 py-2 text-left">Đề xuất</th>
                                    <th className="px-3 py-2 text-left">Thời gian EU</th>
                                    <th className="px-3 py-2 text-right">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {auditProposals.map((p: any) => (
                                    <tr key={p.id} className="border-t border-slate-700/30 hover:bg-slate-800/30">
                                        <td className="px-2 py-1.5">
                                            <input
                                                type="checkbox"
                                                className="rounded"
                                                checked={selectedProposals.has(p.id)}
                                                onChange={(e) => {
                                                    setSelectedProposals(prev => {
                                                        const next = new Set(prev);
                                                        e.target.checked ? next.add(p.id) : next.delete(p.id);
                                                        return next;
                                                    });
                                                }}
                                            />
                                        </td>
                                        <td className="px-3 py-1.5 font-mono text-slate-300">#{p.posOrderId}</td>
                                        <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">{p.awb || "—"}</td>
                                        <td className="px-3 py-1.5 text-slate-400">{p.euLastStatus}</td>
                                        <td className="px-3 py-1.5">
                                            <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-slate-400">
                                                {p.currentPosStatus}
                                            </span>
                                        </td>
                                        <td className="px-3 py-1.5">
                                            <span className={cn("rounded px-1.5 py-0.5 font-semibold", {
                                                "bg-emerald-500/20 text-emerald-300": p.proposedPosStatus === "delivered",
                                                "bg-red-500/20 text-red-300": p.proposedPosStatus === "returned",
                                                "bg-amber-500/20 text-amber-300": p.proposedPosStatus === "returning",
                                                "bg-sky-500/20 text-sky-300": p.proposedPosStatus === "shipped",
                                            })}>
                                                {p.proposedPosStatus}
                                            </span>
                                        </td>
                                        <td className="px-3 py-1.5 text-[10px] text-slate-500">
                                            {p.euLastDate || "—"}
                                        </td>
                                        <td className="px-3 py-1.5 text-right">
                                            <div className="flex items-center gap-1 justify-end">
                                                <button
                                                    onClick={() => handleAuditAction("approve", [p.id])}
                                                    disabled={approvingIds.has(p.id)}
                                                    className="rounded px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                                                >
                                                    {approvingIds.has(p.id) ? "..." : "Duyệt"}
                                                </button>
                                                <button
                                                    onClick={() => handleAuditAction("reject", [p.id])}
                                                    className="rounded px-2 py-0.5 text-[10px] font-semibold bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                                                >
                                                    Bỏ qua
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── Ghost Orders Alert Panel ─────────────────────────────── */}
            {activeSubTab === "ops" && ghostOrders.length > 0 && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-rose-300 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            Đơn hàng "ma" — Đã push nhưng euShipments không xử lý ({ghostOrders.length} đơn)
                        </h3>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => handleForceRepush(ghostOrders.filter(g => !g.alreadyRetried).map((g: any) => g.orderId))}
                                disabled={repushing.size > 0 || ghostOrders.filter((g: any) => !g.alreadyRetried).length === 0}
                                className={cn(
                                    "flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                                    repushing.size > 0
                                        ? "bg-slate-600/50 text-slate-400 cursor-not-allowed"
                                        : "bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30"
                                )}
                            >
                                {repushing.size > 0 ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                Re-Push tất cả ({ghostOrders.filter((g: any) => !g.alreadyRetried).length})
                            </button>
                        </div>
                    </div>
                    <div className="text-[10px] text-rose-400/70 mb-3">
                        Các đơn này đã báo thành công khi đẩy lên euShipments nhưng không có AWB/tracking sau {">"}48h. Cần force re-push với mã tham chiếu mới.
                    </div>
                    <div className="overflow-x-auto max-h-[250px] overflow-y-auto rounded-lg border border-rose-500/20 bg-slate-900/50">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-slate-800/90 text-rose-300">
                                <tr>
                                    <th className="px-3 py-2 text-left">POS ID</th>
                                    <th className="px-3 py-2 text-left">Người nhận</th>
                                    <th className="px-3 py-2 text-right">COD</th>
                                    <th className="px-3 py-2 text-left">Lý do</th>
                                    <th className="px-3 py-2 text-right">Tuổi (giờ)</th>
                                    <th className="px-3 py-2 text-left">Retry</th>
                                    <th className="px-3 py-2 text-right">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ghostOrders.map((g: any) => (
                                    <tr key={g.orderId} className="border-t border-slate-700/30 hover:bg-slate-800/30">
                                        <td className="px-3 py-1.5 font-mono text-slate-300 font-semibold">#{g.orderId}</td>
                                        <td className="px-3 py-1.5 text-slate-400">{g.recipient || "—"}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-slate-300">
                                            {g.cod > 0 ? `${g.cod.toFixed(2)}` : "—"}
                                        </td>
                                        <td className="px-3 py-1.5">
                                            <span className="inline-flex items-center rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-medium text-rose-300">
                                                {g.reasonLabel}
                                            </span>
                                        </td>
                                        <td className="px-3 py-1.5 text-right font-mono text-amber-400">{g.ageHours}h</td>
                                        <td className="px-3 py-1.5">
                                            {g.alreadyRetried ? (
                                                <span className="inline-flex items-center rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                                                    {g.retryRefs.join(", ")}
                                                </span>
                                            ) : (
                                                <span className="text-[10px] text-slate-500">Chưa retry</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-1.5 text-right">
                                            <button
                                                onClick={() => handleForceRepush([g.orderId])}
                                                disabled={repushing.has(g.orderId)}
                                                className={cn(
                                                    "rounded px-2 py-0.5 text-[10px] font-semibold transition-all",
                                                    repushing.has(g.orderId)
                                                        ? "bg-slate-600/50 text-slate-400 cursor-not-allowed"
                                                        : g.alreadyRetried
                                                            ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                                                            : "bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                                                )}
                                            >
                                                {repushing.has(g.orderId) ? "..." : g.alreadyRetried ? "Re-Push lại" : "Force Re-Push"}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {/* Re-push result */}
                    {repushResult && repushResult.results?.length > 0 && (
                        <div className="mt-3 rounded-lg border border-slate-700/50 bg-slate-900/50 p-3">
                            <h4 className="text-xs font-semibold text-slate-300 mb-2">Kết quả re-push:</h4>
                            <div className="space-y-1">
                                {repushResult.results.map((r: any, i: number) => (
                                    <div key={i} className="flex items-center gap-2 text-[10px]">
                                        <span className="font-mono text-slate-400">#{r.orderId}</span>
                                        <span className="text-slate-500">→</span>
                                        <span className="font-mono text-indigo-400">{r.retryRef}</span>
                                        <span className={cn("rounded-full px-2 py-0.5 font-medium",
                                            r.status === "created" ? "bg-emerald-500/20 text-emerald-300" :
                                            r.status === "failed" ? "bg-rose-500/20 text-rose-300" :
                                            "bg-amber-500/20 text-amber-300"
                                        )}>
                                            {r.status === "created" ? (r.verified ? `OK — AWB: ${r.awb || "pending"}` : "Tạo OK (chưa xác minh)") : r.status === "failed" ? "Lỗi" : "Skip"}
                                        </span>
                                        {r.error && <span className="text-rose-400 truncate max-w-[200px]">{r.error}</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ─── KPI Cards (100% euShipments data) ───────────────────── */}
            {activeSubTab === "metrics" && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
                <KPICard title="Tổng vận đơn" value={String(totalShipments)} icon={Package} subValue="euShipments"
                    trend={trendTotal !== null ? { value: trendTotal, label: "vs kỳ trước" } : undefined} />
                <KPICard title="Giao thành công" value={String(fwdDelivered)} icon={CheckCircle} status="success"
                    subValue={`${deliveryRate}% · Aurelia→KH`}
                    trend={trendDelivered !== null ? { value: trendDelivered, label: "vs kỳ trước" } : undefined} />
                <KPICard title="Đang vận chuyển" value={String(inTransit)} icon={Truck} subValue="Courier Romania" />
                <KPICard title="Đơn hoàn" value={String(returnShipments)} icon={RotateCcw} status="danger"
                    subValue={`${returnRate}% tỷ lệ hoàn`}
                    trend={trendReturns !== null ? { value: trendReturns, label: "vs kỳ trước" } : undefined} />
                <KPICard title="TG giao TB" value={avgDeliveryDays ? `${avgDeliveryDays}d` : "—"} icon={Clock}
                    subValue="created → delivered"
                    trend={trendAvgDelivery !== null ? { value: -trendAvgDelivery, label: "vs kỳ trước" } : undefined} />
                <KPICard title="COD thu được" value={`€${codCollected.toLocaleString()}`} icon={CheckCircle} status="success"
                    subValue="Forward delivered (EUR)"
                    trend={trendCod !== null ? { value: trendCod, label: "vs kỳ trước" } : undefined} />
                <KPICard title="Chi phí 3PL" value={fmtEUR(ffmStats?.total_cost_eur || 0)} icon={Warehouse}
                    subValue={`Giao: ${fmtEUR(ffmStats?.fwd_cost_eur || 0)} · Hoàn: ${fmtEUR(ffmStats?.rev_cost_eur || 0)}`}
                    trend={trendCost !== null ? { value: trendCost, label: "vs kỳ trước" } : undefined} />
            </div>
            )}

            {/* ─── Push Result Panel ─────────────────────────────────────── */}
            {activeSubTab === "ops" && pushResult && (
                <div className={cn(
                    "rounded-xl border p-4",
                    pushResult.success ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20"
                        : "border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-900/20"
                )}>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                            <Upload className="w-4 h-4" />
                            Kết quả đẩy đơn lên euShipments
                            {pushResult.courierName && (
                                <span className="text-[10px] text-muted-foreground">({pushResult.courierName})</span>
                            )}
                        </h3>
                        <button onClick={() => setPushResult(null)} className="text-xs text-muted-foreground hover:text-foreground">Đóng</button>
                    </div>
                    {pushResult.stats && (
                        <div className="space-y-3 mb-3">
                            <div className="grid grid-cols-4 gap-3 lg:grid-cols-6">
                                <div className="text-center rounded-lg bg-white dark:bg-slate-800 p-2">
                                    <div className="text-lg font-bold font-mono">{pushResult.stats.total}</div>
                                    <div className="text-[10px] text-muted-foreground">Tổng</div>
                                </div>
                                <div className="text-center rounded-lg bg-white dark:bg-slate-800 p-2">
                                    <div className="text-lg font-bold font-mono text-emerald-600">{pushResult.stats.created}</div>
                                    <div className="text-[10px] text-muted-foreground">Tạo thành công</div>
                                </div>
                                <div className="text-center rounded-lg bg-white dark:bg-slate-800 p-2">
                                    <div className="text-lg font-bold font-mono text-rose-600">{pushResult.stats.failed}</div>
                                    <div className="text-[10px] text-muted-foreground">Lỗi</div>
                                </div>
                                <div className="text-center rounded-lg bg-white dark:bg-slate-800 p-2">
                                    <div className="text-lg font-bold font-mono text-amber-600">{pushResult.stats.skipped}</div>
                                    <div className="text-[10px] text-muted-foreground">Bỏ qua</div>
                                </div>
                                {(pushResult.stats.posUpdated > 0 || pushResult.stats.posUpdateFailed > 0) && (
                                    <>
                                        <div className="text-center rounded-lg bg-white dark:bg-slate-800 p-2 border border-sky-200 dark:border-sky-800">
                                            <div className="text-lg font-bold font-mono text-sky-600">{pushResult.stats.posUpdated || 0}</div>
                                            <div className="text-[10px] text-muted-foreground">POS → Chờ VC</div>
                                        </div>
                                        {pushResult.stats.posUpdateFailed > 0 && (
                                            <div className="text-center rounded-lg bg-white dark:bg-slate-800 p-2 border border-rose-200 dark:border-rose-800">
                                                <div className="text-lg font-bold font-mono text-rose-600">{pushResult.stats.posUpdateFailed}</div>
                                                <div className="text-[10px] text-muted-foreground">POS lỗi</div>
                                            </div>
                                        )}
                                    </>
                                )}
                                {(pushResult.stats.unverified > 0) && (
                                    <div className="text-center rounded-lg bg-white dark:bg-slate-800 p-2 border border-amber-200 dark:border-amber-800">
                                        <div className="text-lg font-bold font-mono text-amber-600">{pushResult.stats.unverified}</div>
                                        <div className="text-[10px] text-muted-foreground">Chưa xác minh</div>
                                    </div>
                                )}
                            </div>
                            {/* Per-country breakdown */}
                            {pushResult.byCountry && Object.keys(pushResult.byCountry).length > 0 && (
                                <div className="flex gap-3 flex-wrap">
                                    {Object.entries(pushResult.byCountry).map(([code, s]: [string, any]) => (
                                        <div key={code} className="inline-flex items-center gap-1.5 rounded-lg bg-white dark:bg-slate-800 px-3 py-1.5 text-xs border border-border">
                                            <span className="font-semibold">{code}</span>
                                            <span className="text-muted-foreground">|</span>
                                            <span>{s.total} don</span>
                                            {s.created > 0 && <span className="text-emerald-600">{s.created} ok</span>}
                                            {s.failed > 0 && <span className="text-rose-600">{s.failed} fail</span>}
                                            {s.skipped > 0 && <span className="text-amber-600">{s.skipped} skip</span>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    {pushResult.results && pushResult.results.length > 0 && (
                        <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b text-muted-foreground">
                                        <th className="px-2 pb-1.5 text-left">POS ID</th>
                                        <th className="px-2 pb-1.5 text-center">QG</th>
                                        <th className="px-2 pb-1.5 text-left">Người nhận</th>
                                        <th className="px-2 pb-1.5 text-left">Thành phố</th>
                                        <th className="px-2 pb-1.5 text-left">Courier</th>
                                        <th className="px-2 pb-1.5 text-right">COD</th>
                                        <th className="px-2 pb-1.5 text-center">KQ</th>
                                        <th className="px-2 pb-1.5 text-center">POS Status</th>
                                        <th className="px-2 pb-1.5 text-center">Xác minh</th>
                                        <th className="px-2 pb-1.5 text-left">Ghi chú</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/30">
                                    {pushResult.results.map((r: any, i: number) => (
                                        <tr key={i} className="hover:bg-muted/30">
                                            <td className="px-2 py-1.5 font-mono">{r.posOrderId}</td>
                                            <td className="px-2 py-1.5 text-center" title={r.country}>
                                                {r.countryFlag || r.country || "—"}
                                            </td>
                                            <td className="px-2 py-1.5">{r.recipient}</td>
                                            <td className="px-2 py-1.5">{r.city || "—"}</td>
                                            <td className="px-2 py-1.5 text-muted-foreground text-[10px]">{r.courierName || "—"}</td>
                                            <td className="px-2 py-1.5 text-right font-mono">
                                                {r.cod > 0 ? `${r.cod.toFixed(2)} ${r.codCurrency || ""}` : "—"}
                                            </td>
                                            <td className="px-2 py-1.5 text-center">
                                                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                                                    r.status === "created" ? "bg-emerald-100 text-emerald-700" :
                                                    r.status === "failed" ? "bg-rose-100 text-rose-700" :
                                                    "bg-amber-100 text-amber-700"
                                                )}>
                                                    {r.status === "created" ? "OK" : r.status === "failed" ? "Lỗi" : "Skip"}
                                                </span>
                                            </td>
                                            <td className="px-2 py-1.5 text-center">
                                                {r.status === "created" ? (
                                                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                                                        r.posStatusUpdated
                                                            ? "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400"
                                                            : "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400"
                                                    )}>
                                                        {r.posStatusUpdated ? "→ Chờ VC" : "Lỗi POS"}
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-muted-foreground">—</span>
                                                )}
                                            </td>
                                            <td className="px-2 py-1.5 text-center">
                                                {r.status === "created" ? (
                                                    r.verified === false ? (
                                                        <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400" title={r.verificationWarning || ""}>
                                                            Chưa xác minh
                                                        </span>
                                                    ) : r.verified === true ? (
                                                        <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                                                            {r.awb ? `AWB: ${r.awb}` : "OK"}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] text-muted-foreground">—</span>
                                                    )
                                                ) : (
                                                    <span className="text-[10px] text-muted-foreground">—</span>
                                                )}
                                            </td>
                                            <td className="px-2 py-1.5 text-muted-foreground max-w-[200px] truncate">{r.error || r.verificationWarning || (r.euOrderId ? `EU#${r.euOrderId}` : "")}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ─── Charts Row ─────────────────────────────────────────────── */}
            {activeSubTab === "metrics" && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

                {/* Pie Chart */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-orange-500" />
                        Phân bố trạng thái đơn hàng
                    </h3>
                    <div className="h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={pieData} cx="45%" cy="50%" innerRadius={55} outerRadius={90}
                                    dataKey="value" nameKey="name" paddingAngle={2}>
                                    {pieData.map((entry, i) => (
                                        <Cell key={i} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: "#e2e8f0" }} labelStyle={{ color: "#94a3b8" }} formatter={(v: number, name: string) => [`${v} đơn`, name]} />
                                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Daily Flow Chart */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                        <Truck className="w-4 h-4 text-blue-500" />
                        Luồng đơn hàng theo ngày
                    </h3>
                    <div className="h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dailyFlow} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={20} />
                                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                                <Tooltip contentStyle={TOOLTIP_STYLE} />
                                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                                <Bar dataKey="success" name="Giao TC (Aurelia→KH)" fill="#34d399" radius={[3, 3, 0, 0]} stackId="a" />
                                <Bar dataKey="returned" name="Đơn hoàn" fill="#f43f5e" radius={[0, 0, 0, 0]} stackId="a" />
                                <Bar dataKey="in_transit" name="Đang VC" fill="#38bdf8" radius={[3, 3, 0, 0]} stackId="a" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
            )}

            {/* ─── Weekly Delivery Rate Trend ──────────────────────────────── */}
            {activeSubTab === "metrics" && weeklyTrend.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-emerald-500" />
                        Tỷ lệ giao hàng theo tuần
                    </h3>
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={weeklyTrend} margin={{ top: 5, right: 20, bottom: 0, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                <XAxis dataKey="week_label" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={30} />
                                <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} width={35} />
                                <YAxis yAxisId="right" orientation="right" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} width={40}
                                    tickFormatter={(v: number) => `${v}%`} domain={[0, 100]} />
                                <Tooltip contentStyle={TOOLTIP_STYLE}
                                    formatter={(v: number, name: string) =>
                                        name === "Tỷ lệ giao" ? [`${v}%`, name] : [`${v} đơn`, name]
                                    } />
                                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                                <Bar yAxisId="left" dataKey="delivered" name="Giao TC" fill="#34d399" radius={[3, 3, 0, 0]} />
                                <Bar yAxisId="left" dataKey="returned" name="Đơn hoàn" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                                <Line yAxisId="right" type="monotone" dataKey="success_rate" name="Tỷ lệ giao"
                                    stroke="#fbbf24" strokeWidth={2.5} dot={{ r: 4, fill: "#fbbf24" }} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* ─── Market Comparison ────────────────────────────────────────── */}
            {activeSubTab === "metrics" && marketComparison.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                        <Globe className="w-4 h-4 text-blue-500" />
                        So sánh theo thị trường
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="px-3 pb-2 text-left font-medium">Quốc gia</th>
                                    <th className="px-3 pb-2 text-right font-medium">Tổng đơn</th>
                                    <th className="px-3 pb-2 text-right font-medium text-emerald-600">Giao TC</th>
                                    <th className="px-3 pb-2 text-right font-medium text-rose-600">Đơn hoàn</th>
                                    <th className="px-3 pb-2 text-right font-medium">Tỷ lệ giao %</th>
                                    <th className="px-3 pb-2 text-right font-medium">TG giao TB</th>
                                    <th className="px-3 pb-2 text-right font-medium">Chi phí/đơn</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/30">
                                {marketComparison.map((m: any) => (
                                    <tr key={m.country} className="hover:bg-muted/30 transition-colors">
                                        <td className="px-3 py-2.5 font-semibold">
                                            <span className="inline-flex items-center gap-2">
                                                <span>{COUNTRY_FLAGS[m.country] || ""}</span>
                                                <span>{COUNTRY_NAMES[m.country] || m.country}</span>
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono">{m.total_orders}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-emerald-600">{m.delivered}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-rose-600">{m.returned}</td>
                                        <td className="px-3 py-2.5 text-right">
                                            <span className={cn("font-semibold",
                                                (m.success_rate || 0) >= 80 ? "text-emerald-600" :
                                                (m.success_rate || 0) >= 60 ? "text-amber-600" : "text-rose-600"
                                            )}>
                                                {m.success_rate ?? 0}%
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono">
                                            {m.avg_delivery_days ? `${m.avg_delivery_days}d` : "—"}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono text-violet-600">
                                            {m.cost_per_order ? fmtEUR(m.cost_per_order) : "—"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── Delivery-days Distribution ───────────────────────────────── */}
            {activeSubTab === "metrics" && (
            <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-500" />
                        Tỷ lệ giao hàng theo số ngày
                        <span className="text-[10px] text-muted-foreground font-normal">
                            POS đặt đơn → KH nhận hàng
                        </span>
                    </h3>
                    <div className="flex items-center gap-2 text-xs">
                        <select value={ddCountryFilter} onChange={e => setDdCountryFilter(e.target.value)}
                            className="rounded-md border border-border bg-background px-2 py-1 text-xs">
                            <option value="ALL">🌍 Tất cả thị trường</option>
                            <option value="RO">🇷🇴 Romania</option>
                            <option value="BG">🇧🇬 Bulgaria</option>
                            <option value="SK">🇸🇰 Slovakia</option>
                            <option value="HR">🇭🇷 Croatia</option>
                        </select>
                        <select value={ddProductFilter} onChange={e => setDdProductFilter(e.target.value)}
                            className="rounded-md border border-border bg-background px-2 py-1 text-xs">
                            <option value="ALL">📦 Tất cả sản phẩm</option>
                            {productList.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </div>
                </div>

                {deliveryDaysLoading ? (
                    <div className="h-[320px] flex items-center justify-center">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                ) : deliveryDaysData.filter(d => d.total > 0).length === 0 ? (
                    <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground">
                        Không có dữ liệu trong bộ lọc này
                    </div>
                ) : (() => {
                    const total = deliveryDaysData.reduce((s, r) => s + (r.total || 0), 0);
                    const totalDelivered = deliveryDaysData.reduce((s, r) => s + (r.delivered || 0), 0);
                    const totalReturned = deliveryDaysData.reduce((s, r) => s + (r.returned || 0), 0);
                    const totalInTransit = deliveryDaysData.reduce((s, r) => s + (r.in_transit || 0), 0);
                    const avgDays = totalDelivered > 0
                        ? (deliveryDaysData.reduce((s, r) => s + (r.days * r.delivered), 0) / totalDelivered).toFixed(1)
                        : "—";
                    return (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4 text-xs">
                                <div className="rounded-lg bg-muted/40 p-2.5">
                                    <div className="text-muted-foreground mb-1">Tổng đơn</div>
                                    <div className="font-bold text-foreground text-base font-mono">{total}</div>
                                </div>
                                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/10 p-2.5">
                                    <div className="text-emerald-600/70 mb-1">Tỷ lệ giao</div>
                                    <div className="font-bold text-emerald-600 text-base font-mono">
                                        {total > 0 ? `${((totalDelivered / total) * 100).toFixed(1)}%` : "—"}
                                    </div>
                                </div>
                                <div className="rounded-lg bg-rose-50 dark:bg-rose-900/10 p-2.5">
                                    <div className="text-rose-600/70 mb-1">Tỷ lệ hoàn</div>
                                    <div className="font-bold text-rose-600 text-base font-mono">
                                        {total > 0 ? `${((totalReturned / total) * 100).toFixed(1)}%` : "—"}
                                    </div>
                                </div>
                                <div className="rounded-lg bg-sky-50 dark:bg-sky-900/10 p-2.5">
                                    <div className="text-sky-600/70 mb-1">Đang giao</div>
                                    <div className="font-bold text-sky-600 text-base font-mono">{totalInTransit}</div>
                                </div>
                                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/10 p-2.5">
                                    <div className="text-amber-600/70 mb-1">TG giao TB</div>
                                    <div className="font-bold text-amber-600 text-base font-mono">{avgDays}{avgDays !== "—" ? "d" : ""}</div>
                                </div>
                            </div>
                            <div className="h-[320px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={deliveryDaysData} margin={{ top: 5, right: 20, bottom: 0, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                        <XAxis dataKey="days_label" tick={{ fill: "#94a3b8", fontSize: 10 }}
                                            axisLine={false} tickLine={false} interval={0} />
                                        <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 10 }}
                                            axisLine={false} tickLine={false} width={35} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fill: "#94a3b8", fontSize: 10 }}
                                            axisLine={false} tickLine={false} width={45}
                                            tickFormatter={(v: number) => `${v}%`} domain={[0, 100]} />
                                        <Tooltip contentStyle={TOOLTIP_STYLE}
                                            formatter={(v: any, name: string) =>
                                                String(name).startsWith("Tỷ lệ")
                                                    ? [v == null ? "—" : `${v}%`, name]
                                                    : [`${v} đơn`, name]
                                            } />
                                        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                                        <Bar yAxisId="left" dataKey="delivered" name="Giao TC"
                                            stackId="st" fill="#34d399" radius={[3, 3, 0, 0]} />
                                        <Bar yAxisId="left" dataKey="returned" name="Đơn hoàn"
                                            stackId="st" fill="#f43f5e" />
                                        <Bar yAxisId="left" dataKey="in_transit" name="Đang giao"
                                            stackId="st" fill="#38bdf8" />
                                        <Line yAxisId="right" type="monotone" dataKey="at_day_success_rate"
                                            name="Tỷ lệ giao TC (trong N ngày)"
                                            stroke="#a855f7" strokeWidth={3}
                                            dot={{ r: 4, fill: "#a855f7" }}
                                            connectNulls />
                                        <Line yAxisId="right" type="monotone" dataKey="cum_success_rate"
                                            name="Tỷ lệ giao (tích lũy/tổng đơn)" stroke="#fbbf24" strokeWidth={1.5}
                                            strokeDasharray="4 4" dot={false} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Per-day breakpoint table: success rate at each exact day */}
                            <div className="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3">
                                <div className="text-[11px] font-semibold text-foreground mb-2 flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-violet-500" />
                                    Tỷ lệ giao TC theo mốc SLA (đơn kết thúc ĐÚNG trong N ngày)
                                </div>
                                <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                                    {[1, 2, 3, 5, 7, 10].map(dayN => {
                                        const row = deliveryDaysData.find(r => r.days === dayN);
                                        const delivered = row?.delivered || 0;
                                        const returned = row?.returned || 0;
                                        const finalized = delivered + returned;
                                        const rate = finalized > 0
                                            ? Math.round((delivered / finalized) * 1000) / 10
                                            : null;
                                        return (
                                            <div key={dayN} className="rounded-md bg-background p-2 border border-border/40">
                                                <div className="text-[10px] text-muted-foreground mb-0.5">
                                                    Trong {dayN} ngày
                                                </div>
                                                <div className={cn("font-bold font-mono text-base",
                                                    rate == null ? "text-muted-foreground" :
                                                    rate >= 85 ? "text-emerald-600" :
                                                    rate >= 70 ? "text-amber-600" : "text-rose-600"
                                                )}>
                                                    {rate == null ? "—" : `${rate}%`}
                                                </div>
                                                <div className="text-[10px] text-muted-foreground font-mono">
                                                    {delivered}/{finalized} đơn
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="mt-2 text-[10px] text-muted-foreground italic">
                                    💡 VD: "Trong 3 ngày = 90%" nghĩa là đơn kết thúc ĐÚNG ở mốc 3 ngày (không tính 1-2 ngày), 90% giao thành công.
                                    So sánh giữa các mốc để thấy: đơn giao càng chậm, tỷ lệ hoàn càng tăng → cắt SLA hợp lý.
                                </div>
                            </div>
                        </>
                    );
                })()}
            </div>
            )}

            {/* ─── euShipments Live Inventory ─────────────────────────────── */}
            {activeSubTab === "ops" && euInventory.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Box className="w-4 h-4 text-indigo-500" />
                            Tồn kho 3PL — HelpShip Oradea (Live)
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
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
                                    <tr key={idx} className="hover:bg-muted/30 transition-colors">
                                        <td className="px-3 py-2.5 font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-400">{item.refNumber}</td>
                                        <td className="px-3 py-2.5 text-xs">{item.productName || "—"}</td>
                                        <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">{item.barcode || "—"}</td>
                                        <td className="px-3 py-2.5 text-xs text-right">{item.warehouse}</td>
                                        <td className={cn("px-3 py-2.5 text-right text-sm font-bold",
                                            item.availableQty > 10 ? "text-emerald-600" :
                                            item.availableQty > 0 ? "text-amber-600" : "text-rose-600")}>
                                            {item.availableQty}
                                        </td>
                                        <td className="px-3 py-2.5 text-right text-xs text-amber-600">{item.reservedQty}</td>
                                        <td className="px-3 py-2.5 text-right text-xs font-medium">{item.totalQty}</td>
                                        <td className="px-3 py-2.5 text-center">
                                            {item.availableQty > 10 ? (
                                                <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">✅ Đủ hàng</span>
                                            ) : item.availableQty > 0 ? (
                                                <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">⚠️ Sắp hết</span>
                                            ) : (
                                                <span className="inline-flex items-center rounded-full bg-rose-100 dark:bg-rose-900/30 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-400">🔴 Hết hàng</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                <tr className="bg-muted/40 font-semibold border-t border-border">
                                    <td className="px-3 py-2.5 text-xs" colSpan={4}>TỔNG</td>
                                    <td className="px-3 py-2.5 text-right text-sm font-bold text-emerald-600">{totalAvailableQty}</td>
                                    <td className="px-3 py-2.5 text-right text-xs text-amber-600">{totalReservedQty}</td>
                                    <td className="px-3 py-2.5 text-right text-xs font-medium">{totalStockQty}</td>
                                    <td />
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── euShipments Live Orders ─────────────────────────────────── */}
            {activeSubTab === "ops" && euOrders.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Truck className="w-4 h-4 text-blue-500" />
                            Đơn euShipments — Live
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /> {euOrders.length} đơn
                            </span>
                        </h3>
                    </div>
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-card z-10">
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="px-3 pb-2 text-left font-medium">AWB</th>
                                    <th className="px-3 pb-2 text-left font-medium">Ref / POS ID</th>
                                    <th className="px-3 pb-2 text-left font-medium">Trạng thái</th>
                                    <th className="px-3 pb-2 text-right font-medium">COD (RON)</th>
                                    <th className="px-3 pb-2 text-right font-medium">Chi phí (€)</th>
                                    <th className="px-3 pb-2 text-left font-medium">Ngày tạo</th>
                                    <th className="px-3 pb-2 text-left font-medium">Courier</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/30">
                                {euOrders.slice(0, 100).map((o: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-muted/30 transition-colors">
                                        <td className="px-3 py-2 font-mono text-[10px] text-indigo-600 dark:text-indigo-400">{o.awb || o.trackingNumber || "—"}</td>
                                        <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{o.refNumber || o.clientRef || "—"}</td>
                                        <td className="px-3 py-2">
                                            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                                                o.status === "Delivered" ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" :
                                                o.status === "Returned"  ? "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400" :
                                                o.status === "In Transit" ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" :
                                                "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                                            )}>
                                                {o.status || "—"}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-emerald-600 dark:text-emerald-400">
                                            {o.codAmount > 0 ? fmtRON(o.codAmount) : "—"}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-violet-600 dark:text-violet-400">
                                            {o.price ? fmtEUR(o.price) : "—"}
                                        </td>
                                        <td className="px-3 py-2 text-muted-foreground">
                                            {o.createdDate ? String(o.createdDate).slice(0, 10) : "—"}
                                        </td>
                                        <td className="px-3 py-2 text-muted-foreground">{o.courier || o.carrierName || "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── Empty euShipments state ─────────────────────────────────── */}
            {activeSubTab === "ops" && !euConnected && (
                <div className="rounded-xl border border-border bg-card p-6 text-center">
                    <Globe className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                    <div className="text-sm text-muted-foreground mb-1">euShipments Live API chưa kết nối</div>
                    <div className="text-xs text-muted-foreground/60 mb-3">
                        Cần cấu hình <code className="bg-muted px-1 rounded">STRAMARK_FFM_API_TOKEN</code> trong <code className="bg-muted px-1 rounded">.env</code>
                    </div>
                    <button onClick={handleSync} disabled={syncing}
                        className="bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 text-orange-400 text-xs px-4 py-2 rounded-lg transition">
                        Thử kết nối
                    </button>
                </div>
            )}
        </div>
    );
}
