"use client";

import { useEffect, useState, useMemo } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ComposedChart, Line, Cell, PieChart, Pie,
} from "recharts";
import {
    Landmark, AlertTriangle, Clock, CheckCircle, XCircle,
    Search, ChevronDown, ChevronUp, TrendingUp, Globe,
    ArrowRight, Banknote, ShieldAlert, Timer,
    ShieldCheck, Upload, FileSpreadsheet, UserCheck, RefreshCw,
} from "lucide-react";
import { KPICard } from "@/components/ui/kpi-card";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { formatNumber, formatCurrency, cn, COLORS } from "@/lib/utils";
import { DATASET } from "../constants";
import {
    queryFinCtrlOverview, queryFinCtrlAging,
    queryFinCtrlCashReconciliation, queryFinCtrlPendingOrders, queryFinCtrlTceDebt,
    queryFinCtrlWeeklyCashFlow, queryFinCtrlCashCycle,
    queryFinCtrlPendingReceivables, queryFinCtrlMarketBreakdown,
} from "@/lib/bq-queries";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
    dateRange?: { from: Date; to: Date };
    subSlug?: string;
    onSubTabChange?: (subPath: string) => void;
}

type SubSection = "overview" | "reconciliation" | "cashflow" | "markets" | "verification";

const SUB_SECTION_SLUG_MAP: Record<string, SubSection> = {
    "overview": "overview",
    "reconciliation": "reconciliation",
    "cashflow": "cashflow",
    "markets": "markets",
    "verification": "verification",
};

interface Alert {
    severity: "danger" | "warning";
    title: string;
    message: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ALERT_THRESHOLDS = {
    DEBT_DANGER_EUR: 5000,
    DEBT_WARNING_EUR: 2000,
    OVERDUE_DAYS: 14,
    TCE_DEBT_DANGER_EUR: 1000,
};

const AGING_COLORS: Record<string, string> = {
    "0-7 days": COLORS.emerald,
    "8-14 days": COLORS.amber,
    "15-30 days": "#f97316",
    "30+ days": COLORS.rose,
};

const COUNTRY_FLAGS: Record<string, string> = {
    RO: "RO",
    SK: "SK",
    BG: "BG",
    HR: "HR",
};

const COUNTRY_NAMES: Record<string, string> = {
    RO: "Romania",
    SK: "Slovakia",
    BG: "Bulgaria",
    HR: "Croatia",
};

const PAYOUT_STATUS_STYLES: Record<string, string> = {
    Paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    Pending: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    Overdue: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    "In Transit": "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400",
    Returned: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400",
};

const VERIFICATION_STATUS_STYLES: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    verified: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
    anomaly: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    confirmed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    disputed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
};

const PAYOUT_TYPE_STYLES: Record<string, { label: string; style: string }> = {
    gross: { label: "Gross Payout", style: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" },
    compensation: { label: "Net (deducted)", style: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400" },
};

const MATCH_STATUS_STYLES: Record<string, string> = {
    matched: "text-emerald-600 dark:text-emerald-400",
    amount_mismatch: "text-rose-600 dark:text-rose-400 font-semibold",
    count_mismatch: "text-amber-600 dark:text-amber-400 font-semibold",
    unknown_awb: "text-red-600 dark:text-red-400 font-semibold",
    api_not_updated: "text-blue-600 dark:text-blue-400",
};

const SUB_SECTIONS: { id: SubSection; label: string; icon: typeof Landmark; desc: string; color: string }[] = [
    { id: "overview", label: "Overview", icon: Landmark, desc: "Sức khỏe tài chính · Pending · Aging", color: "indigo" },
    { id: "reconciliation", label: "Reconciliation", icon: Search, desc: "Đối soát COD · So khớp tiền · Per-market", color: "amber" },
    { id: "cashflow", label: "Cash Flow", icon: TrendingUp, desc: "Revenue · Ads · COGS · FFM · Net Profit", color: "emerald" },
    { id: "markets", label: "Markets", icon: Globe, desc: "RO · BG · SK · HR · Settlement rate", color: "blue" },
    { id: "verification", label: "Verification", icon: ShieldCheck, desc: "Protokol · 2-person approval · POS sync", color: "rose" },
];

const COLOR_MAP: Record<string, { border: string; bg: string; icon: string; iconBg: string; text: string; hoverBg: string; hoverBorder: string; ring: string; dot: string }> = {
    indigo: { border: "border-indigo-500", bg: "bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950/40 dark:to-violet-950/30", icon: "bg-indigo-500 text-white shadow-lg shadow-indigo-500/30", iconBg: "group-hover:bg-indigo-100 group-hover:text-indigo-600 dark:group-hover:bg-indigo-900/40", text: "text-indigo-700 dark:text-indigo-300", hoverBg: "hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20", hoverBorder: "hover:border-indigo-300", ring: "ring-2 ring-indigo-500/20", dot: "bg-indigo-500" },
    amber: { border: "border-amber-500", bg: "bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/30", icon: "bg-amber-500 text-white shadow-lg shadow-amber-500/30", iconBg: "group-hover:bg-amber-100 group-hover:text-amber-600 dark:group-hover:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300", hoverBg: "hover:bg-amber-50/40 dark:hover:bg-amber-950/20", hoverBorder: "hover:border-amber-300", ring: "ring-2 ring-amber-500/20", dot: "bg-amber-500" },
    emerald: { border: "border-emerald-500", bg: "bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30", icon: "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30", iconBg: "group-hover:bg-emerald-100 group-hover:text-emerald-600 dark:group-hover:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300", hoverBg: "hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20", hoverBorder: "hover:border-emerald-300", ring: "ring-2 ring-emerald-500/20", dot: "bg-emerald-500" },
    blue: { border: "border-blue-500", bg: "bg-gradient-to-r from-blue-50 to-sky-50 dark:from-blue-950/40 dark:to-sky-950/30", icon: "bg-blue-500 text-white shadow-lg shadow-blue-500/30", iconBg: "group-hover:bg-blue-100 group-hover:text-blue-600 dark:group-hover:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300", hoverBg: "hover:bg-blue-50/40 dark:hover:bg-blue-950/20", hoverBorder: "hover:border-blue-300", ring: "ring-2 ring-blue-500/20", dot: "bg-blue-500" },
    rose: { border: "border-rose-500", bg: "bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-950/40 dark:to-pink-950/30", icon: "bg-rose-500 text-white shadow-lg shadow-rose-500/30", iconBg: "group-hover:bg-rose-100 group-hover:text-rose-600 dark:group-hover:bg-rose-900/40", text: "text-rose-700 dark:text-rose-300", hoverBg: "hover:bg-rose-50/40 dark:hover:bg-rose-950/20", hoverBorder: "hover:border-rose-300", ring: "ring-2 ring-rose-500/20", dot: "bg-rose-500" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function queryBQ(sql: string) {
    try {
        const r = await fetch("/api/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: sql }),
        });
        const json = await r.json();
        return json.data || [];
    } catch {
        return [];
    }
}

function fmtEur(v: number | null | undefined) {
    if (v == null) return "-";
    return `${v < 0 ? "-" : ""}${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtEurFull(v: number | null | undefined) {
    if (v == null) return "-";
    return `${v < 0 ? "-" : ""}${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtRon(v: number | null | undefined) {
    if (v == null) return "-";
    return formatNumber(Math.round(v));
}

function fmtPct(v: number | null | undefined) {
    if (v == null) return "-";
    return `${v.toFixed(1)}%`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FinancialControlTab({ dateRange, subSlug, onSubTabChange }: Props) {
    const resolvedSection: SubSection = (subSlug && SUB_SECTION_SLUG_MAP[subSlug]) || "overview";
    const [internalSection, setInternalSection] = useState<SubSection>(resolvedSection);
    const activeSection = onSubTabChange ? resolvedSection : internalSection;
    const setActiveSection = (s: SubSection) => {
        if (onSubTabChange) onSubTabChange(s);
        else setInternalSection(s);
    };
    const [loading, setLoading] = useState(true);

    // Overview data
    const [overview, setOverview] = useState<any>(null);
    const [aging, setAging] = useState<any[]>([]);
    const [cashCycle, setCashCycle] = useState<any>(null);
    const [tceDebt, setTceDebt] = useState<any[]>([]);
    const [markets, setMarkets] = useState<any[]>([]);

    // Lazy-loaded data
    const [reconData, setReconData] = useState<any[]>([]);
    const [reconLoaded, setReconLoaded] = useState(false);
    const [cashFlowWeekly, setCashFlowWeekly] = useState<any[]>([]);
    // pendingReceivables removed — Cash Flow now uses mart_performance_master
    const [cashflowLoaded, setCashflowLoaded] = useState(false);

    // Verification data
    const [verificationProtocols, setVerificationProtocols] = useState<any[]>([]);
    const [verificationLoaded, setVerificationLoaded] = useState(false);
    const [expandedProtocol, setExpandedProtocol] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [confirmingId, setConfirmingId] = useState<string | null>(null);

    // Filters
    const [reconMarketFilter, setReconMarketFilter] = useState("ALL");
    const [reconStatusFilter, setReconStatusFilter] = useState("ALL");
    const [reconSearch, setReconSearch] = useState("");
    const [tceExpanded, setTceExpanded] = useState(false);

    // ── Initial load ─────────────────────────────────────────────────────────
    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            setReconLoaded(false);
            setCashflowLoaded(false);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const [ovRes, agRes, mkRes, ccRes, tceRes] = await Promise.all([
                    queryBQ(queryFinCtrlOverview(DATASET, from, to)),
                    queryBQ(queryFinCtrlAging(DATASET, from, to)),
                    queryBQ(queryFinCtrlMarketBreakdown(DATASET, from, to)),
                    queryBQ(queryFinCtrlCashCycle(DATASET, from, to)),
                    queryBQ(queryFinCtrlTceDebt(DATASET)),
                ]);

                setOverview(ovRes?.[0] || null);
                setAging(agRes || []);
                setMarkets(mkRes || []);
                setCashCycle(ccRes?.[0] || null);
                setTceDebt(tceRes || []);
            } catch (e) {
                console.error("FinCtrl fetch error", e);
            } finally {
                setLoading(false);
            }
        }
        if (dateRange?.from && dateRange?.to) fetchData();
    }, [dateRange]);

    const [pendingOrders, setPendingOrders] = useState<any[]>([]);

    // ── Lazy load reconciliation (cash flow matching + pending orders) ────
    useEffect(() => {
        if (activeSection === "reconciliation" && !reconLoaded && dateRange?.from && dateRange?.to) {
            const from = format(dateRange.from, "yyyy-MM-dd");
            const to = format(dateRange.to, "yyyy-MM-dd");
            Promise.all([
                queryBQ(queryFinCtrlCashReconciliation(DATASET, from, to)),
                queryBQ(queryFinCtrlPendingOrders(DATASET, from, to)),
            ]).then(([recon, pending]) => {
                setReconData(recon || []);
                setPendingOrders((pending || []).filter((r: any) => r.cod_amount && r.cod_amount > 0));
                setReconLoaded(true);
            });
        }
    }, [activeSection, reconLoaded, dateRange]);

    // ── Lazy load cash flow ──────────────────────────────────────────────────
    useEffect(() => {
        if (activeSection === "cashflow" && !cashflowLoaded && dateRange?.from && dateRange?.to) {
            const from = format(dateRange.from, "yyyy-MM-dd");
            const to = format(dateRange.to, "yyyy-MM-dd");
            queryBQ(queryFinCtrlWeeklyCashFlow(DATASET, from, to)).then(cf => {
                setCashFlowWeekly(cf || []);
                setCashflowLoaded(true);
            });
        }
    }, [activeSection, cashflowLoaded, dateRange]);

    // ── Lazy load verification ───────────────────────────────────────────────
    const [codCrossCheck, setCodCrossCheck] = useState<any>(null);
    const [posStatusCheck, setPosStatusCheck] = useState<any>(null);
    const [checkingPos, setCheckingPos] = useState(false);

    const loadVerification = () => {
        fetch("/api/stramark/eushipments/payment-verification")
            .then(r => r.json())
            .then(data => {
                setVerificationProtocols(data.protocols || []);
                setCodCrossCheck(data.codCrossCheck || null);
                setPosStatusCheck(data.posStatusCheck || null);
                setVerificationLoaded(true);
            })
            .catch(() => setVerificationLoaded(true));
    };

    useEffect(() => {
        if (activeSection === "verification" && !verificationLoaded) {
            loadVerification();
        }
    }, [activeSection, verificationLoaded]);

    const handleSyncFromEmail = async () => {
        setUploading(true);
        try {
            const resp = await fetch("/api/stramark/eushipments/payment-verification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "sync-email" }),
            });
            const result = await resp.json();
            if (result.success) {
                setVerificationLoaded(false); // Trigger reload
            } else {
                alert(result.error || "Sync failed");
            }
        } catch (e) {
            console.error("Email sync failed:", e);
        } finally {
            setUploading(false);
        }
    };

    const handleConfirm = async (protocolNumber: string, confirmer: string, transactionId?: string) => {
        setConfirmingId(protocolNumber);
        try {
            const resp = await fetch("/api/stramark/eushipments/payment-verification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "confirm", protocolNumber, confirmer, transactionId }),
            });
            const result = await resp.json();
            if (result.success) {
                setVerificationLoaded(false);
            } else {
                alert(result.error || "Confirmation failed");
            }
        } catch (e) {
            console.error("Confirm failed:", e);
        } finally {
            setConfirmingId(null);
        }
    };

    const handleDispute = async (protocolNumber: string, disputedBy: string, reason: string) => {
        try {
            const resp = await fetch("/api/stramark/eushipments/payment-verification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "dispute", protocolNumber, disputedBy, reason }),
            });
            const result = await resp.json();
            if (result.success) {
                setVerificationLoaded(false);
            }
        } catch (e) {
            console.error("Dispute failed:", e);
        }
    };

    // ── Alerts ───────────────────────────────────────────────────────────────
    const alerts = useMemo<Alert[]>(() => {
        if (!overview) return [];
        const a: Alert[] = [];
        const pending = overview.pending_cod_eur || 0;

        if (pending > ALERT_THRESHOLDS.DEBT_DANGER_EUR) {
            a.push({ severity: "danger", title: "Partner Debt cao", message: `EUR ${fmtEur(pending)} cho thanh toan tu 3PL` });
        } else if (pending > ALERT_THRESHOLDS.DEBT_WARNING_EUR) {
            a.push({ severity: "warning", title: "Partner Debt tang", message: `EUR ${fmtEur(pending)} dang cho` });
        }

        const overdue30 = aging.find(r => r.aging_bucket === "30+ days");
        if (overdue30 && overdue30.order_count > 0) {
            a.push({ severity: "danger", title: `${overdue30.order_count} don 30+ ngay chua thanh toan`, message: `EUR ${fmtEur(overdue30.pending_cod_eur)} chua thu` });
        }

        const tceUnpaid = tceDebt.filter(t => t.debt_status === "Unpaid");
        const tceTotal = tceUnpaid.reduce((s: number, t: any) => s + (t.cod_amount_eur || 0), 0);
        if (tceTotal > ALERT_THRESHOLDS.TCE_DEBT_DANGER_EUR) {
            a.push({ severity: "warning", title: "TCE no chua thanh toan", message: `${tceUnpaid.length} don, EUR ${fmtEur(tceTotal)}` });
        }
        return a;
    }, [overview, aging, tceDebt]);

    // ── Filtered reconciliation data ─────────────────────────────────────────
    const filteredRecon = useMemo(() => {
        return reconData.filter(r => {
            if (reconMarketFilter !== "ALL" && r.market !== reconMarketFilter) return false;
            if (reconStatusFilter !== "ALL" && r.payout_status !== reconStatusFilter) return false;
            if (reconSearch && !String(r.order_id).includes(reconSearch) && !(r.awb || "").toLowerCase().includes(reconSearch.toLowerCase())) return false;
            return true;
        });
    }, [reconData, reconMarketFilter, reconStatusFilter, reconSearch]);

    // ── Loading ──────────────────────────────────────────────────────────────
    if (loading) return <TabSkeleton cards={4} showChart rows={5} />;

    const eurToRon = overview?.eur_to_ron || 4.97;

    return (
        <div className="space-y-6">
            {/* ─── Sub-tab selector (top-level, prominent cards) ────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {SUB_SECTIONS.map(s => {
                    const c = COLOR_MAP[s.color];
                    const isActive = activeSection === s.id;
                    return (
                        <button
                            key={s.id}
                            onClick={() => setActiveSection(s.id)}
                            className={cn(
                                "group relative flex items-center gap-3 rounded-xl border p-4 text-left transition-all",
                                isActive
                                    ? `${c.border} ${c.bg} shadow-md ${c.ring}`
                                    : `border-border bg-card ${c.hoverBorder} ${c.hoverBg}`
                            )}
                        >
                            <div className={cn(
                                "flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition-colors",
                                isActive
                                    ? c.icon
                                    : `bg-muted text-muted-foreground ${c.iconBg}`
                            )}>
                                <s.icon className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className={cn(
                                    "text-sm font-bold",
                                    isActive ? c.text : "text-foreground"
                                )}>
                                    {s.label}
                                </h3>
                                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                                    {s.desc}
                                </p>
                            </div>
                            {isActive && (
                                <div className={cn("absolute top-2 right-2 w-2 h-2 rounded-full animate-pulse", c.dot)} />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Alert Banners */}
            {alerts.map((alert, i) => (
                <div key={i} className={cn(
                    "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm",
                    alert.severity === "danger"
                        ? "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400"
                        : "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400"
                )}>
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span className="font-semibold">{alert.title}</span>
                    <span className="text-xs opacity-80">{alert.message}</span>
                </div>
            ))}

            {/* ═══════ OVERVIEW ═══════ */}
            {activeSection === "overview" && (
                <div className="space-y-6">
                    {/* KPI Cards */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <KPICard
                            title="Pending Payout (3PL)"
                            value={`EUR ${fmtEur(overview?.pending_cod_eur)}`}
                            icon={Banknote}
                            status={(overview?.pending_cod_eur || 0) > ALERT_THRESHOLDS.DEBT_DANGER_EUR ? "danger"
                                : (overview?.pending_cod_eur || 0) > ALERT_THRESHOLDS.DEBT_WARNING_EUR ? "warning" : "success"}
                            subValue={`~ RON ${fmtRon(overview?.pending_cod_ron)}`}
                        />
                        <KPICard
                            title="Settlement Rate"
                            value={fmtPct(overview?.settlement_rate_pct)}
                            icon={CheckCircle}
                            status={(overview?.settlement_rate_pct || 0) > 80 ? "success"
                                : (overview?.settlement_rate_pct || 0) > 50 ? "warning" : "danger"}
                            subValue={`${overview?.total_settled || 0} / ${overview?.total_delivered || 0} delivered`}
                        />
                        <KPICard
                            title="Avg Days to Payout"
                            value={overview?.avg_days_to_payout != null ? `${overview.avg_days_to_payout}d` : "-"}
                            icon={Timer}
                            status={(overview?.avg_days_to_payout || 0) <= 7 ? "success"
                                : (overview?.avg_days_to_payout || 0) <= 14 ? "warning" : "danger"}
                            subValue="Delivery -> 3PL payout"
                        />
                        <KPICard
                            title="TCE Unpaid"
                            value={`EUR ${fmtEur(tceDebt.filter(t => t.debt_status === "Unpaid").reduce((s: number, t: any) => s + (t.cod_amount_eur || 0), 0))}`}
                            icon={ShieldAlert}
                            status={tceDebt.filter(t => t.debt_status === "Unpaid").length > 0 ? "warning" : "success"}
                            subValue={`${tceDebt.filter(t => t.debt_status === "Unpaid").length} don chua thanh toan`}
                        />
                    </div>

                    {/* Cash Cycle Timeline */}
                    {cashCycle && (
                        <div className="rounded-xl border border-border bg-card p-6">
                            <h3 className="text-sm font-semibold text-foreground mb-4">Cash Cycle Timeline</h3>
                            <div className="flex items-center justify-center gap-2 py-6">
                                <div className="flex flex-col items-center">
                                    <div className="w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-500/15 flex items-center justify-center">
                                        <span className="text-xs font-bold text-blue-700 dark:text-blue-400">Order</span>
                                    </div>
                                    <span className="text-xs text-muted-foreground mt-1">{cashCycle.orders_delivered || 0} orders</span>
                                </div>
                                <div className="flex flex-col items-center flex-1 max-w-[140px]">
                                    <ArrowRight className="h-5 w-5 text-muted-foreground" />
                                    <span className="text-sm font-bold text-foreground mt-1">{cashCycle.avg_days_to_delivery ?? "-"}d</span>
                                    <span className="text-[10px] text-muted-foreground">to delivery</span>
                                </div>
                                <div className="flex flex-col items-center">
                                    <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center">
                                        <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Delivered</span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-center flex-1 max-w-[140px]">
                                    <ArrowRight className="h-5 w-5 text-muted-foreground" />
                                    <span className="text-sm font-bold text-foreground mt-1">{cashCycle.avg_days_delivery_to_payout ?? "-"}d</span>
                                    <span className="text-[10px] text-muted-foreground">to payout</span>
                                </div>
                                <div className="flex flex-col items-center">
                                    <div className="w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center">
                                        <span className="text-xs font-bold text-amber-700 dark:text-amber-400">Payout</span>
                                    </div>
                                    <span className="text-xs text-muted-foreground mt-1">{cashCycle.orders_with_payout || 0} settled</span>
                                </div>
                                <div className="flex flex-col items-center ml-4 pl-4 border-l border-border">
                                    <span className="text-lg font-bold text-foreground">{cashCycle.avg_days_total_cycle ?? "-"}d</span>
                                    <span className="text-[10px] text-muted-foreground">total cycle</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Aging Breakdown */}
                    {aging.length > 0 && (
                        <div className="rounded-xl border border-border bg-card p-6">
                            <h3 className="text-sm font-semibold text-foreground mb-4">Aging - Don chua thanh toan</h3>
                            {/* Stacked bar */}
                            <div className="h-8 rounded-full overflow-hidden flex mb-4">
                                {aging.map((a, i) => {
                                    const total = aging.reduce((s, x) => s + (x.order_count || 0), 0);
                                    const pct = total > 0 ? (a.order_count / total) * 100 : 0;
                                    return (
                                        <div
                                            key={i}
                                            style={{ width: `${pct}%`, backgroundColor: AGING_COLORS[a.aging_bucket] || COLORS.slate }}
                                            className="flex items-center justify-center text-[10px] font-bold text-white min-w-[30px]"
                                            title={`${a.aging_bucket}: ${a.order_count} orders`}
                                        >
                                            {a.order_count}
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Aging table */}
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border text-xs text-muted-foreground">
                                        <th className="pb-2 text-left font-medium">Bucket</th>
                                        <th className="pb-2 text-right font-medium">Orders</th>
                                        <th className="pb-2 text-right font-medium">Pending COD (EUR)</th>
                                        <th className="pb-2 text-right font-medium">FFM Cost (EUR)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40">
                                    {aging.map((a, i) => (
                                        <tr key={i} className="hover:bg-muted/30">
                                            <td className="py-2 text-left">
                                                <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ backgroundColor: AGING_COLORS[a.aging_bucket] }} />
                                                {a.aging_bucket}
                                            </td>
                                            <td className="py-2 text-right font-medium">{a.order_count}</td>
                                            <td className="py-2 text-right">{fmtEurFull(a.pending_cod_eur)}</td>
                                            <td className="py-2 text-right">{fmtEurFull(a.ffm_cost_eur)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2 border-border font-semibold">
                                        <td className="pt-2">Total</td>
                                        <td className="pt-2 text-right">{aging.reduce((s, a) => s + (a.order_count || 0), 0)}</td>
                                        <td className="pt-2 text-right">{fmtEurFull(aging.reduce((s, a) => s + (a.pending_cod_eur || 0), 0))}</td>
                                        <td className="pt-2 text-right">{fmtEurFull(aging.reduce((s, a) => s + (a.ffm_cost_eur || 0), 0))}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ═══════ RECONCILIATION (Cash Flow Matching) ═══════ */}
            {activeSection === "reconciliation" && (
                <div className="space-y-6">
                    {!reconLoaded ? (
                        <TabSkeleton cards={4} showChart rows={5} />
                    ) : (() => {
                        // Compute totals from reconData (now cash reconciliation data)
                        const totals = reconData.reduce((acc: any, r: any) => {
                            const cod = r.total_cod || 0;
                            const paid = r.paid_cod || 0;
                            const pending = r.pending_cod || 0;
                            const ffm = r.total_ffm_cost || 0;
                            acc.totalCod += cod;
                            acc.paidCod += paid;
                            acc.pendingCod += pending;
                            acc.ffmCost += ffm;
                            acc.totalOrders += (r.total_delivered || 0);
                            acc.paidOrders += (r.paid_count || 0);
                            return acc;
                        }, { totalCod: 0, paidCod: 0, pendingCod: 0, ffmCost: 0, totalOrders: 0, paidOrders: 0 });
                        const netReceived = totals.paidCod - totals.ffmCost;
                        const collectionRate = totals.totalOrders > 0 ? (totals.paidOrders / totals.totalOrders * 100) : 0;

                        return <>
                            {/* Waterfall Summary */}
                            <div className="rounded-xl border border-border bg-card p-6">
                                <h3 className="text-sm font-semibold text-foreground mb-4">Cash Flow Reconciliation</h3>
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                                    <div className="text-center">
                                        <div className="text-xs text-muted-foreground mb-1">COD Total</div>
                                        <div className="text-xl font-bold text-foreground">EUR {fmtEur(totals.totalCod)}</div>
                                        <div className="text-[10px] text-muted-foreground">{totals.totalOrders} orders delivered</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-xs text-muted-foreground mb-1">COD Received</div>
                                        <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">EUR {fmtEur(totals.paidCod)}</div>
                                        <div className="text-[10px] text-muted-foreground">{totals.paidOrders} orders paid</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-xs text-muted-foreground mb-1">FFM Cost Deducted</div>
                                        <div className="text-xl font-bold text-rose-600 dark:text-rose-400">-EUR {fmtEur(totals.ffmCost)}</div>
                                    </div>
                                    <div className="text-center border-l border-border pl-4">
                                        <div className="text-xs text-muted-foreground mb-1">Net Received</div>
                                        <div className={cn("text-xl font-bold", netReceived >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                                            EUR {fmtEur(netReceived)}
                                        </div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-xs text-muted-foreground mb-1">Pending</div>
                                        <div className="text-xl font-bold text-amber-600 dark:text-amber-400">EUR {fmtEur(totals.pendingCod)}</div>
                                        <div className="text-[10px] text-muted-foreground">{totals.totalOrders - totals.paidOrders} orders</div>
                                    </div>
                                </div>

                                {/* Progress bar */}
                                <div className="mt-4">
                                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                                        <span>Collection Rate</span>
                                        <span>{collectionRate.toFixed(1)}%</span>
                                    </div>
                                    <div className="h-3 rounded-full bg-muted overflow-hidden flex">
                                        <div style={{ width: `${collectionRate}%` }} className="bg-emerald-500 rounded-full transition-all" />
                                    </div>
                                </div>
                            </div>

                            {/* Per-Market Breakdown */}
                            <div className="rounded-xl border border-border bg-card p-5">
                                <h3 className="text-sm font-semibold text-foreground mb-4">Per-Market Breakdown</h3>
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-border text-xs text-muted-foreground">
                                            <th className="pb-3 text-left font-medium">Market</th>
                                            <th className="pb-3 text-right font-medium">Orders</th>
                                            <th className="pb-3 text-right font-medium">COD Total</th>
                                            <th className="pb-3 text-right font-medium">COD Received</th>
                                            <th className="pb-3 text-right font-medium">FFM Cost</th>
                                            <th className="pb-3 text-right font-medium">Net</th>
                                            <th className="pb-3 text-right font-medium">Pending</th>
                                            <th className="pb-3 text-right font-medium">Rate</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/40">
                                        {reconData.map((r: any, i: number) => {
                                            const net = (r.paid_cod || 0) - (r.total_ffm_cost || 0);
                                            const rate = r.total_delivered > 0 ? (r.paid_count / r.total_delivered * 100) : 0;
                                            return (
                                                <tr key={i} className="hover:bg-muted/30">
                                                    <td className="py-2.5 font-medium">
                                                        {COUNTRY_FLAGS[r.market] || r.market} {COUNTRY_NAMES[r.market] || r.market}
                                                    </td>
                                                    <td className="py-2.5 text-right">{r.total_delivered}</td>
                                                    <td className="py-2.5 text-right font-medium">{r.currency} {fmtEurFull(r.total_cod)}</td>
                                                    <td className="py-2.5 text-right text-emerald-600 dark:text-emerald-400">{fmtEurFull(r.paid_cod)}</td>
                                                    <td className="py-2.5 text-right text-rose-600 dark:text-rose-400">-{fmtEurFull(r.total_ffm_cost)}</td>
                                                    <td className={cn("py-2.5 text-right font-semibold", net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                                                        {fmtEurFull(net)}
                                                    </td>
                                                    <td className="py-2.5 text-right text-amber-600 dark:text-amber-400 font-medium">{fmtEurFull(r.pending_cod)}</td>
                                                    <td className="py-2.5 text-right">
                                                        <span className={cn("font-medium", rate > 80 ? "text-emerald-600" : rate > 50 ? "text-amber-600" : "text-rose-600")}>
                                                            {rate.toFixed(1)}%
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    {reconData.length > 1 && (
                                        <tfoot>
                                            <tr className="border-t-2 border-border font-semibold">
                                                <td className="pt-2">Total</td>
                                                <td className="pt-2 text-right">{totals.totalOrders}</td>
                                                <td className="pt-2 text-right">EUR {fmtEurFull(totals.totalCod)}</td>
                                                <td className="pt-2 text-right text-emerald-600">{fmtEurFull(totals.paidCod)}</td>
                                                <td className="pt-2 text-right text-rose-600">-{fmtEurFull(totals.ffmCost)}</td>
                                                <td className="pt-2 text-right">{fmtEurFull(netReceived)}</td>
                                                <td className="pt-2 text-right text-amber-600">{fmtEurFull(totals.pendingCod)}</td>
                                                <td className="pt-2 text-right">{collectionRate.toFixed(1)}%</td>
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                        </>;
                    })()}

                    {/* Pending Orders List */}
                    {pendingOrders.length > 0 && (
                        <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-card p-5">
                            <h3 className="text-sm font-semibold text-foreground mb-1">Orders Pending Payment</h3>
                            <p className="text-xs text-muted-foreground mb-4">Delivered but euShipments has not yet paid — {pendingOrders.length} orders</p>
                            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 bg-card z-10">
                                        <tr className="border-b border-border text-xs text-muted-foreground">
                                            <th className="pb-2 pl-2 text-left font-medium">Order ID</th>
                                            <th className="pb-2 text-left font-medium">AWB</th>
                                            <th className="pb-2 text-center font-medium">Market</th>
                                            <th className="pb-2 text-left font-medium">Delivered</th>
                                            <th className="pb-2 text-right font-medium">COD</th>
                                            <th className="pb-2 text-right font-medium">FFM Cost (EUR)</th>
                                            <th className="pb-2 text-right font-medium">Days</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/40">
                                        {pendingOrders.map((r: any, i: number) => (
                                            <tr key={i} className={cn(
                                                "hover:bg-muted/30",
                                                (r.days_since_delivery || 0) > 14 ? "bg-rose-50/50 dark:bg-rose-500/5" : ""
                                            )}>
                                                <td className="py-2 pl-2 font-mono text-xs">{r.order_id}</td>
                                                <td className="py-2 font-mono text-xs">{r.awb}</td>
                                                <td className="py-2 text-center text-xs">{r.market}</td>
                                                <td className="py-2 text-xs">{r.delivered_date || "-"}</td>
                                                <td className="py-2 text-right font-medium">
                                                    {(r.order_currency === "EUR" || r.market !== "RO")
                                                        ? `EUR ${fmtEurFull(r.cod_amount)}`
                                                        : `RON ${fmtRon(r.cod_amount)}`}
                                                </td>
                                                <td className="py-2 text-right text-xs">{fmtEurFull(r.ffm_cost_eur)}</td>
                                                <td className="py-2 text-right">
                                                    <span className={cn(
                                                        "text-xs font-medium",
                                                        (r.days_since_delivery || 0) > 14 ? "text-rose-600 dark:text-rose-400" :
                                                        (r.days_since_delivery || 0) > 7 ? "text-amber-600 dark:text-amber-400" : ""
                                                    )}>
                                                        {r.days_since_delivery != null ? `${r.days_since_delivery}d` : "-"}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="border-t-2 border-border font-semibold text-sm">
                                            <td colSpan={4} className="pt-2">Total: {pendingOrders.length} orders</td>
                                            <td className="pt-2 text-right text-amber-600">
                                                {fmtEurFull(pendingOrders.reduce((s: number, r: any) => s + (r.cod_amount || 0), 0))}
                                            </td>
                                            <td className="pt-2 text-right">
                                                {fmtEurFull(pendingOrders.reduce((s: number, r: any) => s + (r.ffm_cost_eur || 0), 0))}
                                            </td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* TCE Debt Section */}
                    {tceDebt.length > 0 && (
                        <div className="rounded-xl border border-border bg-card">
                            <button
                                onClick={() => setTceExpanded(!tceExpanded)}
                                className="flex w-full items-center justify-between p-5 text-left"
                            >
                                <div className="flex items-center gap-3">
                                    <ShieldAlert className="h-5 w-5 text-amber-500" />
                                    <div>
                                        <span className="text-sm font-semibold text-foreground">TCE Legacy Debt</span>
                                        <span className="ml-2 text-xs text-muted-foreground">(discontinued partner)</span>
                                    </div>
                                    <span className="rounded-full bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                                        {tceDebt.filter(t => t.debt_status === "Unpaid").length} unpaid
                                    </span>
                                </div>
                                {tceExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                            {tceExpanded && (
                                <div className="border-t border-border p-5">
                                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                                        <table className="w-full text-sm">
                                            <thead className="sticky top-0 bg-card z-10">
                                                <tr className="border-b border-border text-xs text-muted-foreground">
                                                    <th className="pb-2 text-left font-medium">AWB</th>
                                                    <th className="pb-2 text-left font-medium">POS Order</th>
                                                    <th className="pb-2 text-left font-medium">Status</th>
                                                    <th className="pb-2 text-right font-medium">COD (EUR)</th>
                                                    <th className="pb-2 text-right font-medium">FFM Cost (EUR)</th>
                                                    <th className="pb-2 text-left font-medium">Delivered</th>
                                                    <th className="pb-2 text-center font-medium">Debt Status</th>
                                                    <th className="pb-2 text-right font-medium">Days</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/40">
                                                {tceDebt.map((t: any, i: number) => (
                                                    <tr key={i} className="hover:bg-muted/30">
                                                        <td className="py-2 font-mono text-xs">{t.awb}</td>
                                                        <td className="py-2 text-xs">{t.pos_order_id || "-"}</td>
                                                        <td className="py-2 text-xs">{t.status}</td>
                                                        <td className="py-2 text-right">{fmtEurFull(t.cod_amount_eur)}</td>
                                                        <td className="py-2 text-right">{fmtEurFull(t.ffm_cost_eur)}</td>
                                                        <td className="py-2 text-xs">{t.delivered_date || "-"}</td>
                                                        <td className="py-2 text-center">
                                                            <span className={cn(
                                                                "inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                                                t.debt_status === "Unpaid" ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
                                                                    : t.debt_status === "Settled" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                                                                    : "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400"
                                                            )}>
                                                                {t.debt_status}
                                                            </span>
                                                        </td>
                                                        <td className="py-2 text-right text-xs">
                                                            <span className={t.debt_status === "Unpaid" ? "text-rose-500 font-semibold" : ""}>
                                                                {t.days_outstanding}d
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr className="border-t-2 border-border font-semibold text-sm">
                                                    <td colSpan={3} className="pt-2">Total Unpaid</td>
                                                    <td className="pt-2 text-right text-rose-500">
                                                        {fmtEurFull(tceDebt.filter(t => t.debt_status === "Unpaid").reduce((s: number, t: any) => s + (t.cod_amount_eur || 0), 0))}
                                                    </td>
                                                    <td className="pt-2 text-right">
                                                        {fmtEurFull(tceDebt.filter(t => t.debt_status === "Unpaid").reduce((s: number, t: any) => s + (t.ffm_cost_eur || 0), 0))}
                                                    </td>
                                                    <td colSpan={3}></td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ═══════ CASH FLOW ═══════ */}
            {activeSection === "cashflow" && (
                <div className="space-y-6">
                    {!cashflowLoaded ? (
                        <TabSkeleton cards={4} showChart rows={5} />
                    ) : (() => {
                        // Compute period totals
                        const t = cashFlowWeekly.reduce((acc: any, w: any) => {
                            acc.revenue += (w.revenue || 0);
                            acc.ads += (w.ads_spend || 0);
                            acc.cogs += (w.cogs || 0);
                            acc.ffm += (w.ffm_cost || 0);
                            acc.retFfm += (w.return_ffm_cost || 0);
                            acc.net += (w.net_profit || 0);
                            return acc;
                        }, { revenue: 0, ads: 0, cogs: 0, ffm: 0, retFfm: 0, net: 0 });
                        const totalCost = t.ads + t.cogs + t.ffm + t.retFfm;
                        const R = 5946; // RON_TO_VND
                        const fmtV = (ron: number) => formatCurrency(ron, R);

                        // Cumulative data for line chart (VND)
                        let cumulative = 0;
                        const chartData = cashFlowWeekly.map((w: any) => {
                            cumulative += (w.net_profit || 0) * R;
                            return {
                                ...w,
                                revenue_vnd: (w.revenue || 0) * R,
                                ads_vnd: (w.ads_spend || 0) * R,
                                cogs_vnd: (w.cogs || 0) * R,
                                ffm_vnd: (w.ffm_cost || 0) * R,
                                cumulative_net: cumulative,
                            };
                        });

                        return <>
                            {/* Exchange Rate Banner */}
                            <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">Ty gia:</span>
                                <span>1 USD = <span className="font-semibold text-foreground">26.325</span> VND</span>
                                <span className="text-border">|</span>
                                <span>1 RON = <span className="font-semibold text-foreground">5.946</span> VND</span>
                                <span className="text-border">|</span>
                                <span>1 EUR = <span className="font-semibold text-foreground">30.667</span> VND</span>
                            </div>

                            {/* Summary KPIs (VND) */}
                            <div className="rounded-xl border border-border bg-card p-6">
                                <h3 className="text-sm font-semibold text-foreground mb-4">Cash Flow Summary (VND)</h3>
                                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 p-3 text-center">
                                        <div className="text-xs text-muted-foreground mb-1">Revenue</div>
                                        <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{fmtV(t.revenue)}</div>
                                        <div className="text-[10px] text-emerald-600">TIEN VAO</div>
                                    </div>
                                    <div className="rounded-lg bg-purple-50 dark:bg-purple-500/10 p-3 text-center">
                                        <div className="text-xs text-muted-foreground mb-1">Ads Spend</div>
                                        <div className="text-lg font-bold text-purple-700 dark:text-purple-400">-{fmtV(t.ads)}</div>
                                    </div>
                                    <div className="rounded-lg bg-orange-50 dark:bg-orange-500/10 p-3 text-center">
                                        <div className="text-xs text-muted-foreground mb-1">COGS (Nhap hang)</div>
                                        <div className="text-lg font-bold text-orange-700 dark:text-orange-400">-{fmtV(t.cogs)}</div>
                                    </div>
                                    <div className="rounded-lg bg-rose-50 dark:bg-rose-500/10 p-3 text-center">
                                        <div className="text-xs text-muted-foreground mb-1">Fulfillment</div>
                                        <div className="text-lg font-bold text-rose-700 dark:text-rose-400">-{fmtV(t.ffm + t.retFfm)}</div>
                                    </div>
                                    <div className="rounded-lg bg-slate-100 dark:bg-slate-500/10 p-3 text-center">
                                        <div className="text-xs text-muted-foreground mb-1">Total Cost</div>
                                        <div className="text-lg font-bold text-slate-700 dark:text-slate-400">-{fmtV(totalCost)}</div>
                                        <div className="text-[10px] text-muted-foreground">TIEN RA</div>
                                    </div>
                                    <div className={cn("rounded-lg p-3 text-center border-2",
                                        t.net >= 0 ? "border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10"
                                            : "border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10"
                                    )}>
                                        <div className="text-xs text-muted-foreground mb-1">Net Profit</div>
                                        <div className={cn("text-lg font-bold", t.net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>
                                            {fmtV(t.net)}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Stacked Bar Chart: Revenue vs Costs (VND) */}
                            <div className="rounded-xl border border-border bg-card p-6">
                                <h3 className="text-sm font-semibold text-foreground mb-4">Weekly: Revenue vs Costs (VND)</h3>
                                <div className="h-[320px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.2} />
                                            <XAxis dataKey="week_label" stroke="#888" fontSize={11} />
                                            <YAxis stroke="#888" fontSize={11} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px" }}
                                                labelStyle={{ color: "var(--foreground)" }}
                                                formatter={(value: number, name: string) => {
                                                    const labels: Record<string, string> = {
                                                        revenue_vnd: "Revenue",
                                                        ads_vnd: "Ads Spend",
                                                        cogs_vnd: "COGS (Nhap hang)",
                                                        ffm_vnd: "Fulfillment",
                                                        cumulative_net: "Cumulative Net",
                                                    };
                                                    return [formatCurrency(value / R, R), labels[name] || name];
                                                }}
                                            />
                                            <Bar dataKey="revenue_vnd" name="revenue_vnd" fill={COLORS.emerald} radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="ads_vnd" name="ads_vnd" fill="#a855f7" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="cogs_vnd" name="cogs_vnd" fill="#f97316" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="ffm_vnd" name="ffm_vnd" fill={COLORS.rose} radius={[4, 4, 0, 0]} />
                                            <Line type="monotone" dataKey="cumulative_net" name="cumulative_net" stroke={COLORS.indigo} strokeWidth={2} dot={{ r: 3 }} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Weekly Breakdown Table (VND) */}
                            {cashFlowWeekly.length > 0 && (() => {
                                const R = 5946; // RON_TO_VND
                                const fmtV = (ron: number) => formatCurrency(ron, R);
                                return (
                                <div className="rounded-xl border border-border bg-card p-5">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-sm font-semibold text-foreground">Weekly Breakdown (VND)</h3>
                                        <div className="flex gap-3 text-[10px] text-muted-foreground">
                                            <span>1 USD = 26.325 VND</span>
                                            <span className="text-border">|</span>
                                            <span>1 RON = 5.946 VND</span>
                                            <span className="text-border">|</span>
                                            <span>1 EUR = 30.667 VND</span>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-border text-xs text-muted-foreground">
                                                    <th className="pb-2 text-left font-medium">Week</th>
                                                    <th className="pb-2 text-right font-medium">Revenue</th>
                                                    <th className="pb-2 text-right font-medium">Ads</th>
                                                    <th className="pb-2 text-right font-medium">COGS</th>
                                                    <th className="pb-2 text-right font-medium">FFM</th>
                                                    <th className="pb-2 text-right font-medium">Return FFM</th>
                                                    <th className="pb-2 text-right font-medium">Net Profit</th>
                                                    <th className="pb-2 text-right font-medium">Margin</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/40">
                                                {cashFlowWeekly.map((w: any, i: number) => {
                                                    const margin = w.revenue > 0 ? ((w.net_profit || 0) / w.revenue * 100) : 0;
                                                    return (
                                                        <tr key={i} className="hover:bg-muted/30">
                                                            <td className="py-2 font-medium">{w.week_label}</td>
                                                            <td className="py-2 text-right text-emerald-600 dark:text-emerald-400">{fmtV(w.revenue)}</td>
                                                            <td className="py-2 text-right text-purple-600 dark:text-purple-400">-{fmtV(w.ads_spend)}</td>
                                                            <td className="py-2 text-right text-orange-600 dark:text-orange-400">-{fmtV(w.cogs)}</td>
                                                            <td className="py-2 text-right text-rose-600 dark:text-rose-400">-{fmtV(w.ffm_cost)}</td>
                                                            <td className="py-2 text-right text-rose-500">-{fmtV(w.return_ffm_cost)}</td>
                                                            <td className={cn("py-2 text-right font-semibold",
                                                                (w.net_profit || 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                                            )}>{fmtV(w.net_profit)}</td>
                                                            <td className={cn("py-2 text-right text-xs",
                                                                margin >= 20 ? "text-emerald-600" : margin >= 0 ? "text-amber-600" : "text-rose-600"
                                                            )}>{margin.toFixed(1)}%</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                            <tfoot>
                                                <tr className="border-t-2 border-border font-semibold">
                                                    <td className="pt-2">Total</td>
                                                    <td className="pt-2 text-right text-emerald-600">{fmtV(t.revenue)}</td>
                                                    <td className="pt-2 text-right text-purple-600">-{fmtV(t.ads)}</td>
                                                    <td className="pt-2 text-right text-orange-600">-{fmtV(t.cogs)}</td>
                                                    <td className="pt-2 text-right text-rose-600">-{fmtV(t.ffm)}</td>
                                                    <td className="pt-2 text-right text-rose-500">-{fmtV(t.retFfm)}</td>
                                                    <td className={cn("pt-2 text-right", t.net >= 0 ? "text-emerald-600" : "text-rose-600")}>{fmtV(t.net)}</td>
                                                    <td className="pt-2 text-right text-xs">{t.revenue > 0 ? (t.net / t.revenue * 100).toFixed(1) : 0}%</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                </div>
                                );
                            })()}
                        </>;
                    })()}
                </div>
            )}

            {/* ═══════ MARKETS ═══════ */}
            {activeSection === "markets" && (
                <div className="space-y-6">
                    <div className="rounded-xl border border-border bg-card p-5">
                        <h3 className="text-sm font-semibold text-foreground mb-4">Per-Market Financial Summary</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border text-xs text-muted-foreground">
                                        <th className="pb-3 text-left font-medium">Market</th>
                                        <th className="pb-3 text-right font-medium">Orders</th>
                                        <th className="pb-3 text-right font-medium">Delivered</th>
                                        <th className="pb-3 text-right font-medium">Returned</th>
                                        <th className="pb-3 text-right font-medium">COD Total (EUR)</th>
                                        <th className="pb-3 text-right font-medium">FFM Cost (EUR)</th>
                                        <th className="pb-3 text-right font-medium">Net (EUR)</th>
                                        <th className="pb-3 text-right font-medium">Pending (EUR)</th>
                                        <th className="pb-3 text-right font-medium">Avg Days</th>
                                        <th className="pb-3 text-right font-medium">Settlement %</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40">
                                    {markets.map((m: any, i: number) => (
                                        <tr key={i} className="hover:bg-muted/30">
                                            <td className="py-2.5 font-medium">
                                                <span className="mr-2">{COUNTRY_FLAGS[m.market] || m.market}</span>
                                                {COUNTRY_NAMES[m.market] || m.market}
                                            </td>
                                            <td className="py-2.5 text-right">{m.total_orders}</td>
                                            <td className="py-2.5 text-right text-emerald-600 dark:text-emerald-400">{m.delivered}</td>
                                            <td className="py-2.5 text-right text-rose-600 dark:text-rose-400">{m.returned}</td>
                                            <td className="py-2.5 text-right">{fmtEurFull(m.total_cod_eur)}</td>
                                            <td className="py-2.5 text-right">{fmtEurFull(m.total_ffm_cost_eur)}</td>
                                            <td className={cn("py-2.5 text-right font-semibold",
                                                (m.net_eur || 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                            )}>{fmtEurFull(m.net_eur)}</td>
                                            <td className="py-2.5 text-right">
                                                <span className={(m.pending_payout_eur || 0) > 0 ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>
                                                    {fmtEurFull(m.pending_payout_eur)}
                                                </span>
                                            </td>
                                            <td className="py-2.5 text-right">{m.avg_days_to_payout != null ? `${m.avg_days_to_payout}d` : "-"}</td>
                                            <td className="py-2.5 text-right">
                                                <span className={cn(
                                                    "font-medium",
                                                    (m.settlement_rate_pct || 0) > 80 ? "text-emerald-600 dark:text-emerald-400"
                                                        : (m.settlement_rate_pct || 0) > 50 ? "text-amber-600 dark:text-amber-400"
                                                        : "text-rose-600 dark:text-rose-400"
                                                )}>
                                                    {fmtPct(m.settlement_rate_pct)}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {markets.length === 0 && (
                                        <tr>
                                            <td colSpan={10} className="py-8 text-center text-muted-foreground">
                                                No market data available
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                                {markets.length > 0 && (
                                    <tfoot>
                                        <tr className="border-t-2 border-border font-semibold">
                                            <td className="pt-2">Total</td>
                                            <td className="pt-2 text-right">{markets.reduce((s: number, m: any) => s + (m.total_orders || 0), 0)}</td>
                                            <td className="pt-2 text-right">{markets.reduce((s: number, m: any) => s + (m.delivered || 0), 0)}</td>
                                            <td className="pt-2 text-right">{markets.reduce((s: number, m: any) => s + (m.returned || 0), 0)}</td>
                                            <td className="pt-2 text-right">{fmtEurFull(markets.reduce((s: number, m: any) => s + (m.total_cod_eur || 0), 0))}</td>
                                            <td className="pt-2 text-right">{fmtEurFull(markets.reduce((s: number, m: any) => s + (m.total_ffm_cost_eur || 0), 0))}</td>
                                            <td className="pt-2 text-right">{fmtEurFull(markets.reduce((s: number, m: any) => s + (m.net_eur || 0), 0))}</td>
                                            <td className="pt-2 text-right">{fmtEurFull(markets.reduce((s: number, m: any) => s + (m.pending_payout_eur || 0), 0))}</td>
                                            <td className="pt-2 text-right">-</td>
                                            <td className="pt-2 text-right">-</td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══════ VERIFICATION ═══════ */}
            {activeSection === "verification" && (
                <div className="space-y-6">
                    {!verificationLoaded ? (
                        <TabSkeleton cards={2} rows={5} />
                    ) : (
                        <>
                            {/* Action Bar: Sync + COD Check */}
                            <div className="flex flex-wrap gap-3">
                                {/* Sync from Email */}
                                <div className="flex-1 flex items-center justify-between rounded-xl border border-border bg-card p-4">
                                    <div className="flex items-center gap-3">
                                        <FileSpreadsheet className="h-5 w-5 text-orange-500" />
                                        <div>
                                            <span className="text-sm font-medium text-foreground">Protokol Email Sync</span>
                                            <p className="text-xs text-muted-foreground">Auto-fetch from finance@levelupvn.com</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleSyncFromEmail}
                                        disabled={uploading}
                                        className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50 transition-colors"
                                    >
                                        {uploading ? (
                                            <>
                                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                                Syncing...
                                            </>
                                        ) : (
                                            <>
                                                <Upload className="h-4 w-4" />
                                                Sync from Email
                                            </>
                                        )}
                                    </button>
                                </div>

                                {/* Resync Payout Data */}
                                <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4 min-w-[280px]">
                                    <div className="flex items-center gap-3">
                                        <RefreshCw className="h-5 w-5 text-blue-500" />
                                        <div>
                                            <span className="text-sm font-medium text-foreground">Resync Payout</span>
                                            <p className="text-xs text-muted-foreground">Update payout data from API</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            setUploading(true);
                                            try {
                                                const resp = await fetch("/api/stramark/eushipments/payment-verification", {
                                                    method: "POST",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify({ action: "resync-payout" }),
                                                });
                                                const result = await resp.json();
                                                if (result.success) {
                                                    alert(`Resync complete: ${result.message || "OK"}`);
                                                    setVerificationLoaded(false);
                                                } else {
                                                    alert(`Error: ${result.error || "Unknown"}`);
                                                }
                                            } catch (e) { console.error(e); }
                                            finally { setUploading(false); }
                                        }}
                                        disabled={uploading}
                                        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                                    >
                                        <RefreshCw className="h-4 w-4" />
                                        Resync
                                    </button>
                                </div>
                            </div>

                            {/* Summary KPIs */}
                            {verificationProtocols.length > 0 && (
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                    <KPICard
                                        title="Pending Verification"
                                        value={String(verificationProtocols.filter(p => p.verification_status !== "confirmed" && p.verification_status !== "disputed").length)}
                                        icon={FileSpreadsheet}
                                        status={verificationProtocols.some(p => p.verification_status === "anomaly") ? "warning" : "neutral"}
                                    />
                                    <KPICard
                                        title="Total AWBs Pending"
                                        value={String(verificationProtocols.filter(p => p.verification_status !== "confirmed").reduce((s: number, p: any) => s + (p.awb_count || 0), 0))}
                                        icon={ShieldCheck}
                                    />
                                    <KPICard
                                        title="COD Pending (RON)"
                                        value={`RON ${fmtRon(verificationProtocols.filter(p => p.verification_status !== "confirmed").reduce((s: number, p: any) => s + (p.total_amount_ron || 0), 0))}`}
                                        icon={Banknote}
                                    />
                                </div>
                            )}

                            {/* POS Status Check */}
                            <div className="rounded-xl border border-purple-200 dark:border-purple-500/20 bg-card p-5">
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <h3 className="text-sm font-semibold text-foreground">POS Status Cross-Check</h3>
                                        <p className="text-[10px] text-muted-foreground">
                                            Orders paid by euShipments — check if POS updated to "Payment Collected"
                                            {posStatusCheck?.checked_at && ` | Last: ${new Date(posStatusCheck.checked_at).toLocaleString()}`}
                                        </p>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            setCheckingPos(true);
                                            try {
                                                const resp = await fetch("/api/stramark/eushipments/payment-verification", {
                                                    method: "POST",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify({ action: "check-pos-status" }),
                                                });
                                                const result = await resp.json();
                                                if (result.success) setPosStatusCheck(result.posStatusCheck);
                                            } catch (e) { console.error(e); }
                                            finally { setCheckingPos(false); }
                                        }}
                                        disabled={checkingPos}
                                        className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
                                    >
                                        {checkingPos ? (
                                            <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Checking...</>
                                        ) : (
                                            <><Search className="h-4 w-4" /> Check POS Status</>
                                        )}
                                    </button>
                                </div>
                                {posStatusCheck && (
                                    <>
                                        <div className="grid grid-cols-3 gap-3 mb-3">
                                            <div className="rounded-lg bg-slate-50 dark:bg-slate-500/10 p-3 text-center">
                                                <div className="text-lg font-bold">{posStatusCheck.checked}/{posStatusCheck.total_orders}</div>
                                                <div className="text-[10px] text-muted-foreground">Checked</div>
                                            </div>
                                            <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 p-3 text-center">
                                                <div className="text-lg font-bold text-amber-700 dark:text-amber-400">{posStatusCheck.needs_update}</div>
                                                <div className="text-[10px] text-muted-foreground">Needs Update</div>
                                            </div>
                                            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 p-3 text-center">
                                                <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{posStatusCheck.already_collected}</div>
                                                <div className="text-[10px] text-muted-foreground">Already Collected</div>
                                            </div>
                                        </div>
                                        {/* Orders needing update */}
                                        {posStatusCheck.orders?.filter((o: any) => o.needsUpdate).length > 0 && (
                                            <div className="rounded-lg bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 p-3">
                                                <div className="flex items-center justify-between mb-2">
                                                    <h4 className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                                                        Orders to update: Delivered → Payment Collected
                                                    </h4>
                                                    <button
                                                        onClick={async () => {
                                                            const orders = posStatusCheck.orders.filter((o: any) => o.needsUpdate);
                                                            if (!confirm(`Update ${orders.length} orders to "Payment Collected" on POS?`)) return;
                                                            setCheckingPos(true);
                                                            try {
                                                                const resp = await fetch("/api/stramark/eushipments/payment-verification", {
                                                                    method: "POST",
                                                                    headers: { "Content-Type": "application/json" },
                                                                    body: JSON.stringify({
                                                                        action: "update-pos",
                                                                        orderIds: orders.map((o: any) => o.orderId),
                                                                    }),
                                                                });
                                                                const result = await resp.json();
                                                                if (result.success) {
                                                                    alert(`Updated ${result.posUpdates?.updated || 0} orders`);
                                                                    setVerificationLoaded(false);
                                                                }
                                                            } catch (e) { console.error(e); }
                                                            finally { setCheckingPos(false); }
                                                        }}
                                                        disabled={checkingPos}
                                                        className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                                                    >
                                                        <ArrowRight className="h-3 w-3" />
                                                        Update {posStatusCheck.orders.filter((o: any) => o.needsUpdate).length} orders
                                                    </button>
                                                </div>
                                                <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
                                                    <table className="w-full text-xs">
                                                        <thead>
                                                            <tr className="text-muted-foreground">
                                                                <th className="pb-1 text-left">Order ID</th>
                                                                <th className="pb-1 text-left">Current Status</th>
                                                                <th className="pb-1 text-center">Action</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-border/40">
                                                            {posStatusCheck.orders.filter((o: any) => o.needsUpdate).map((o: any, i: number) => (
                                                                <tr key={i}>
                                                                    <td className="py-1 font-mono">{o.orderId}</td>
                                                                    <td className="py-1 text-amber-600">{o.currentStatus}</td>
                                                                    <td className="py-1 text-center text-muted-foreground">→ received_money</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* Protocol List */}
                            <div className="rounded-xl border border-border bg-card p-5">
                                <h3 className="text-sm font-semibold text-foreground mb-4">Payment Protocols</h3>
                                {verificationProtocols.length === 0 ? (
                                    <p className="py-8 text-center text-muted-foreground">No protocols uploaded yet</p>
                                ) : (
                                    <div className="space-y-3">
                                        {[...verificationProtocols].sort((a: any, b: any) => {
                                            // Sort by protocol_number descending (newest first)
                                            return (b.protocol_number || "").localeCompare(a.protocol_number || "");
                                        }).map((p: any) => (
                                            <div key={p.protocol_number} className="rounded-lg border border-border">
                                                {/* Protocol Header */}
                                                <div
                                                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30"
                                                    onClick={() => setExpandedProtocol(expandedProtocol === p.protocol_number ? null : p.protocol_number)}
                                                >
                                                    <div className="flex items-center gap-4">
                                                        <div>
                                                            <span className="text-sm font-semibold">#{p.protocol_number}</span>
                                                            <span className="text-xs text-muted-foreground ml-2">{p.protocol_date || ""}</span>
                                                            <span className="text-xs text-muted-foreground ml-2">Client: {p.client_id}</span>
                                                        </div>
                                                        <span className={cn(
                                                            "inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold",
                                                            VERIFICATION_STATUS_STYLES[p.verification_status] || ""
                                                        )}>
                                                            {p.verification_status}
                                                        </span>
                                                        {p.payout_type && PAYOUT_TYPE_STYLES[p.payout_type] && (
                                                            <span className={cn(
                                                                "inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold",
                                                                PAYOUT_TYPE_STYLES[p.payout_type].style
                                                            )}>
                                                                {PAYOUT_TYPE_STYLES[p.payout_type].label}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                                        <span>{p.awb_count} AWBs</span>
                                                        <span className="text-emerald-600 dark:text-emerald-400">{p.matched_count} matched</span>
                                                        {p.anomaly_count > 0 && (
                                                            <span className="text-rose-600 dark:text-rose-400 font-semibold">{p.anomaly_count} anomalies</span>
                                                        )}
                                                        <span>RON {fmtRon(p.total_amount_ron)}</span>
                                                        {p.net_paid_eur ? (
                                                            <span className="text-orange-600 dark:text-orange-400 font-medium">NET EUR {fmtEurFull(p.net_paid_eur)}</span>
                                                        ) : p.paid_eur ? (
                                                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">EUR {fmtEurFull(p.paid_eur)}</span>
                                                        ) : null}
                                                        {/* Confirmation badges */}
                                                        <div className="flex items-center gap-1">
                                                            {p.confirmed_by_1 ? (
                                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400" title={p.transaction_id_1 ? `TxID: ${p.transaction_id_1}` : undefined}>
                                                                    <UserCheck className="h-3 w-3" />{p.confirmed_by_1}
                                                                </span>
                                                            ) : null}
                                                            {p.confirmed_by_2 ? (
                                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400" title={p.transaction_id_2 ? `TxID: ${p.transaction_id_2}` : undefined}>
                                                                    <UserCheck className="h-3 w-3" />{p.confirmed_by_2}
                                                                </span>
                                                            ) : null}
                                                            <span className="text-[10px] font-medium">
                                                                {p.confirmed_by_2 ? "2/2" : p.confirmed_by_1 ? "1/2" : "0/2"}
                                                            </span>
                                                        </div>
                                                        {/* Show Transaction ID if available */}
                                                        {(p.transaction_id_1 || p.transaction_id_2) && (
                                                            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-mono">
                                                                TxID: {p.transaction_id_1 || p.transaction_id_2}
                                                            </span>
                                                        )}
                                                        {expandedProtocol === p.protocol_number ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                    </div>
                                                </div>

                                                {/* Expanded Detail */}
                                                {expandedProtocol === p.protocol_number && (
                                                    <div className="border-t border-border p-4">
                                                        {/* EUR + Exchange Rate Info */}
                                                        {(p.paid_eur || p.exchange_rate || p.transaction_id) && (
                                                            <div className="flex flex-wrap items-center gap-4 mb-4 text-xs">
                                                                {p.paid_eur && (
                                                                    <span className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                                                                        Paid: EUR {fmtEurFull(p.paid_eur)}
                                                                    </span>
                                                                )}
                                                                {p.exchange_rate && (
                                                                    <span className="rounded-lg bg-blue-50 dark:bg-blue-500/10 px-3 py-1.5 text-blue-700 dark:text-blue-400">
                                                                        Rate: 1 RON = {p.exchange_rate} EUR
                                                                    </span>
                                                                )}
                                                                {p.transaction_id && (
                                                                    <span className="rounded-lg bg-slate-100 dark:bg-slate-500/10 px-3 py-1.5 text-slate-700 dark:text-slate-400">
                                                                        TX: {p.transaction_id}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Compensation Breakdown */}
                                                        {p.payout_type === "compensation" && p.deductions && (
                                                            <div className="mb-4 rounded-lg border border-orange-200 dark:border-orange-500/20 bg-orange-50 dark:bg-orange-500/5 p-3">
                                                                <h4 className="text-xs font-semibold text-orange-700 dark:text-orange-400 mb-2">Compensation Breakdown</h4>
                                                                <div className="space-y-1 text-xs">
                                                                    <div className="flex justify-between">
                                                                        <span>COD Gross</span>
                                                                        <span className="font-medium">EUR {fmtEurFull(p.cod_gross_eur)}</span>
                                                                    </div>
                                                                    {(p.deductions || []).map((d: any, i: number) => (
                                                                        <div key={i} className="flex justify-between text-rose-600 dark:text-rose-400">
                                                                            <span>- Invoice {d.invoice_number}</span>
                                                                            <span>-EUR {fmtEurFull(d.amount_eur)}</span>
                                                                        </div>
                                                                    ))}
                                                                    <div className="flex justify-between border-t border-orange-200 dark:border-orange-500/20 pt-1 font-semibold">
                                                                        <span>Net Paid</span>
                                                                        <span className="text-orange-700 dark:text-orange-400">EUR {fmtEurFull(p.net_paid_eur)}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Action Buttons */}
                                                        {p.verification_status !== "confirmed" && p.verification_status !== "disputed" && (
                                                            <div className="flex flex-wrap items-center gap-3 mb-4">
                                                                <select
                                                                    id={`confirmer-${p.protocol_number}`}
                                                                    className="h-8 rounded-lg border border-border bg-background px-3 text-xs"
                                                                    defaultValue=""
                                                                >
                                                                    <option value="" disabled>Select approver...</option>
                                                                    <option value="Trà My">Tra My</option>
                                                                    <option value="Grace Kim">Grace Kim</option>
                                                                </select>
                                                                <input
                                                                    id={`txid-${p.protocol_number}`}
                                                                    type="text"
                                                                    placeholder="Transaction ID (bank)"
                                                                    className="h-8 rounded-lg border border-border bg-background px-3 text-xs w-48"
                                                                />
                                                                <button
                                                                    onClick={() => {
                                                                        const sel = (document.getElementById(`confirmer-${p.protocol_number}`) as HTMLSelectElement)?.value;
                                                                        const txid = (document.getElementById(`txid-${p.protocol_number}`) as HTMLInputElement)?.value;
                                                                        if (!sel) { alert("Vui long chon nguoi duyet"); return; }
                                                                        if (sel === "Trà My" && !txid?.trim()) {
                                                                            alert("Tra My can nhap Transaction ID ngan hang de xac nhan tien da ve tai khoan");
                                                                            return;
                                                                        }
                                                                        handleConfirm(p.protocol_number, sel, txid || undefined);
                                                                    }}
                                                                    disabled={confirmingId === p.protocol_number}
                                                                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                                                                >
                                                                    <CheckCircle className="h-3.5 w-3.5" />
                                                                    {confirmingId === p.protocol_number ? "Confirming..." : "Confirm"}
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        const reason = prompt("Dispute reason:");
                                                                        if (reason !== null) handleDispute(p.protocol_number, "Admin", reason);
                                                                    }}
                                                                    className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
                                                                >
                                                                    <XCircle className="h-3.5 w-3.5" />
                                                                    Dispute
                                                                </button>
                                                            </div>
                                                        )}

                                                        {/* POS Status Check Results (after 2/2 confirm) */}
                                                        {p.verification_status === "confirmed" && p.pos_check && (
                                                            <div className="mb-4 rounded-lg border border-blue-200 dark:border-blue-500/20 bg-blue-50 dark:bg-blue-500/5 p-3">
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <h4 className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                                                                        POS Status Check ({p.pos_check.checked}/{p.pos_check.total} orders)
                                                                    </h4>
                                                                    {p.pos_check.needs_update > 0 && !p.pos_updated_at && (
                                                                        <button
                                                                            onClick={async () => {
                                                                                if (!confirm(`Update ${p.pos_check.needs_update} orders to "Payment Collected" on POS?`)) return;
                                                                                const resp = await fetch("/api/stramark/eushipments/payment-verification", {
                                                                                    method: "POST",
                                                                                    headers: { "Content-Type": "application/json" },
                                                                                    body: JSON.stringify({ action: "update-pos", protocolNumber: p.protocol_number }),
                                                                                });
                                                                                const result = await resp.json();
                                                                                if (result.success) {
                                                                                    alert(`Updated ${result.posUpdates.updated} orders`);
                                                                                    setVerificationLoaded(false);
                                                                                }
                                                                            }}
                                                                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-blue-700"
                                                                        >
                                                                            <ArrowRight className="h-3 w-3" />
                                                                            Update {p.pos_check.needs_update} orders to Payment Collected
                                                                        </button>
                                                                    )}
                                                                    {p.pos_updated_at && (
                                                                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                                                                            POS updated: {p.pos_update_results?.updated || 0} orders
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="flex gap-4 text-xs">
                                                                    <span className="text-amber-600 dark:text-amber-400">
                                                                        {p.pos_check.needs_update} need update (Delivered → Payment Collected)
                                                                    </span>
                                                                    <span className="text-emerald-600 dark:text-emerald-400">
                                                                        {p.pos_check.already_collected} already collected
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Per-AWB Table */}
                                                        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                                                            <table className="w-full text-sm">
                                                                <thead className="sticky top-0 bg-card z-10">
                                                                    <tr className="border-b border-border text-xs text-muted-foreground">
                                                                        <th className="pb-2 text-left font-medium">AWB</th>
                                                                        <th className="pb-2 text-left font-medium">Receiver</th>
                                                                        <th className="pb-2 text-right font-medium">Protokol (RON)</th>
                                                                        <th className="pb-2 text-right font-medium">BQ COD (RON)</th>
                                                                        <th className="pb-2 text-left font-medium">POS Order</th>
                                                                        <th className="pb-2 text-center font-medium">Match</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-border/40">
                                                                    {(p.items || []).map((item: any, idx: number) => (
                                                                        <tr key={idx} className={cn(
                                                                            "hover:bg-muted/30",
                                                                            item.match_status !== "matched" ? "bg-rose-50/50 dark:bg-rose-500/5" : ""
                                                                        )}>
                                                                            <td className="py-1.5 font-mono text-xs">{item.awb}</td>
                                                                            <td className="py-1.5 text-xs">{item.receiver}</td>
                                                                            <td className="py-1.5 text-right">{fmtEurFull(item.protokol_amount)}</td>
                                                                            <td className="py-1.5 text-right">{item.bq_cod_amount != null ? fmtEurFull(item.bq_cod_amount) : "-"}</td>
                                                                            <td className="py-1.5 text-xs">{item.pos_order_id || "-"}</td>
                                                                            <td className={cn("py-1.5 text-center text-xs", MATCH_STATUS_STYLES[item.match_status] || "")}>
                                                                                {item.match_status}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>

                                                        {/* Anomaly Summary */}
                                                        {p.anomalies && p.anomalies.length > 0 && (
                                                            <div className="mt-4 rounded-lg bg-rose-50 dark:bg-rose-500/5 border border-rose-200 dark:border-rose-500/20 p-3">
                                                                <h4 className="text-xs font-semibold text-rose-700 dark:text-rose-400 mb-2">Anomalies ({p.anomalies.length})</h4>
                                                                <div className="space-y-1 text-xs">
                                                                    {p.anomalies.slice(0, 10).map((a: any, i: number) => (
                                                                        <div key={i} className="text-rose-600 dark:text-rose-400">
                                                                            <span className="font-mono">{a.awb}</span> — {a.type}
                                                                            {a.protokol_amount != null && a.bq_amount != null && (
                                                                                <span className="text-muted-foreground ml-1">(Protokol: {a.protokol_amount}, BQ: {a.bq_amount})</span>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                    {p.anomalies.length > 10 && (
                                                                        <div className="text-muted-foreground">... and {p.anomalies.length - 10} more</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
