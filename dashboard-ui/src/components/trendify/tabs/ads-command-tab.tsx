"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import axios from "axios";
import { RotateCw, Satellite, Layers, AlertTriangle, ChevronDown, ChevronRight, Check, Zap, Target, TrendingUp } from "lucide-react";

// ── helpers ──
function cn(...classes: (string | false | undefined)[]) { return classes.filter(Boolean).join(" "); }
const USD_TO_VND = 25500;
import { CURRENCY_TO_VND } from "../constants";
function formatVND(val: number) {
    if (Math.abs(val) >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return `${Math.round(val)}`;
}
function usdToVnd(usd: number) { return usd * USD_TO_VND; }
function ronToVnd(val: number) { return val * CURRENCY_TO_VND; }

// ── date helpers ──
function todayStr() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }); }
const DATE_PRESETS: { label: string; from: () => string; to: () => string }[] = [
    { label: "Hôm nay", from: todayStr, to: todayStr },
    { label: "Hôm qua", from: () => daysAgo(1), to: () => daysAgo(1) },
    { label: "3 ngày", from: () => daysAgo(2), to: todayStr },
    { label: "7 ngày", from: () => daysAgo(6), to: todayStr },
    { label: "14 ngày", from: () => daysAgo(13), to: todayStr },
    { label: "30 ngày", from: () => daysAgo(29), to: todayStr },
];

// ── types ──
interface AdDetail {
    ad_id: string; ad_name: string; adset_name: string;
    spend: number; impressions: number; cpm: number; cpc: number; ctr: number;
    messages: number; purchases: number; orders: number; revenue_ron: number; roas: number;
}

interface RealtimeCampaign {
    account_id: string; account_name: string; campaign_id: string; campaign_name: string;
    spend: number; impressions: number; cpm: number; ctr: number;
    messages: number; purchases: number; orders: number; revenue_ron: number; roas: number;
    ads_count: number; ads: AdDetail[];
}

interface Summary {
    total_spend: number; total_revenue_ron: number; total_orders: number;
    total_messages: number; matched_orders: number; unmatched_orders: number;
    campaign_matched_orders: number; total_matched_orders: number; lookup_matched_orders: number;
    total_pos_orders: number; total_meta_purchases: number; blended_roas: number;
    accounts_fetched: number; shops_fetched: number;
    matched_revenue_ron: number; unmatched_revenue_ron: number;
}

interface MetaStatus {
    token_valid: boolean;
    error_code?: number;
    error_message?: string;
    accounts_ok: string[];
    accounts_blocked: string[];
    rate_limit_pct?: number;
}

interface RealtimeData {
    source: string; fetched_at: string; duration_ms: number;
    summary: Summary; campaigns: RealtimeCampaign[];
    meta_status?: MetaStatus;
    unmatched_orders: any[]; unmatched_by_shop: Record<string, { count: number; revenue_ron: number }>;
}

const ACCOUNT_NAMES: Record<string, string> = {
    "act_817501334775697": "TRENDIFY TK1",
    "act_1369010934859968": "TRENDIFY TK2",
};
const getAccountName = (id: string) => ACCOUNT_NAMES[id] || id;

export default function AdsCommandTab() {
    const [data, setData] = useState<RealtimeData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [syncedAt, setSyncedAt] = useState<Date | null>(null);
    const [selectedAccount, setSelectedAccount] = useState("all");
    const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
    const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
    const [fromDate, setFromDate] = useState(todayStr());
    const [toDate, setToDate] = useState(todayStr());
    const [activePreset, setActivePreset] = useState("Hôm nay");
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const dateRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsAccountDropdownOpen(false);
            if (dateRef.current && !dateRef.current.contains(e.target as Node)) setShowDatePicker(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const fetchData = async (fd?: string, td?: string) => {
        const f = fd || fromDate;
        const t = td || toDate;
        setLoading(true); setError(null);
        try {
            const res = await axios.get(`/api/stramark/realtime`, {
                params: { from_date: f, to_date: t },
                timeout: 60000,
            });
            setData(res.data); setSyncedAt(new Date());
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || "Failed to fetch");
        } finally { setLoading(false); }
    };

    const applyPreset = (preset: typeof DATE_PRESETS[0]) => {
        const f = preset.from(); const t = preset.to();
        setFromDate(f); setToDate(t);
        setActivePreset(preset.label);
        setShowDatePicker(false);
        fetchData(f, t);
    };

    const applyCustom = () => {
        setActivePreset(`${fromDate} → ${toDate}`);
        setShowDatePicker(false);
        fetchData();
    };

    useEffect(() => { fetchData(); }, []);
    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(() => fetchData(), 60000);
        return () => clearInterval(interval);
    }, [autoRefresh, fromDate, toDate]);

    const campaigns = useMemo(() => {
        if (!data) return [];
        if (selectedAccount === "all") return data.campaigns;
        return data.campaigns.filter(c => c.account_id === selectedAccount);
    }, [data, selectedAccount]);

    const grouped = useMemo(() => {
        const groups: Record<string, RealtimeCampaign[]> = {};
        campaigns.forEach(c => {
            if (!groups[c.account_id]) groups[c.account_id] = [];
            groups[c.account_id].push(c);
        });
        return groups;
    }, [campaigns]);

    const summary = data?.summary;
    const accountIds = Object.keys(ACCOUNT_NAMES);

    // Projected success rate
    const DELIVERY_SR = 0.75; // TRENDIFY ~75% success rate
    const revVnd = ronToVnd(summary?.total_revenue_ron || 0);
    const spendVnd = usdToVnd(summary?.total_spend || 0);
    const projectedRev = revVnd * DELIVERY_SR;
    const projectedRoas = spendVnd > 0 ? projectedRev / spendVnd : 0;
    const projectedProfit = projectedRev - spendVnd;

    const toggleCampaign = (id: string) => setExpandedCampaign(prev => prev === id ? null : id);

    return (
        <div className="h-full flex flex-col overflow-hidden bg-[#0F172A] text-slate-100 font-sans rounded-xl border border-slate-700">

            {/* ═══ HEADER ═══ */}
            <header className="h-14 border-b border-slate-700 bg-[#1E293B] px-5 flex items-center justify-between shrink-0 z-50">
                <div className="flex items-center gap-3">
                    <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                        <Satellite className="h-5 w-5 text-blue-500" /> TRENDIFY ADS COMMAND
                    </h1>
                    {/* Account dropdown */}
                    <div className="relative" ref={dropdownRef}>
                        <button onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
                            className="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:border-slate-400 transition">
                            <Layers className="h-3 w-3" />
                            {selectedAccount === "all" ? `All (${Object.keys(grouped).length})` : getAccountName(selectedAccount)}
                            <ChevronDown className={`h-3 w-3 transition ${isAccountDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isAccountDropdownOpen && (
                            <div className="absolute top-full left-0 mt-1 w-64 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl z-50 overflow-hidden max-h-96 overflow-y-auto">
                                <button onClick={() => { setSelectedAccount("all"); setIsAccountDropdownOpen(false); }}
                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-700 ${selectedAccount === "all" ? "bg-blue-600/20 text-blue-300" : "text-slate-300"}`}>
                                    <span>🌐 All ({accountIds.length} TKQC)</span>
                                    {selectedAccount === "all" && <Check className="h-4 w-4 text-blue-400" />}
                                </button>
                                {accountIds.map(accId => (
                                    <button key={accId} onClick={() => { setSelectedAccount(accId); setIsAccountDropdownOpen(false); }}
                                        className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-slate-700 ${selectedAccount === accId ? "bg-blue-600/20 text-blue-300" : "text-slate-300"}`}>
                                        <div>
                                            <div className="font-medium text-xs">{getAccountName(accId)}</div>
                                            <div className="font-mono text-[9px] text-slate-500">{accId}</div>
                                        </div>
                                        {selectedAccount === accId && <Check className="h-3 w-3 text-blue-400" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {/* Date Range Picker */}
                    <div className="relative" ref={dateRef}>
                        <button onClick={() => setShowDatePicker(!showDatePicker)}
                            className="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:border-slate-400 transition">
                            📅 {activePreset}
                            <ChevronDown className={`h-3 w-3 transition ${showDatePicker ? 'rotate-180' : ''}`} />
                        </button>
                        {showDatePicker && (
                            <div className="absolute top-full left-0 mt-1 w-72 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl z-50 overflow-hidden">
                                <div className="p-2 border-b border-slate-700">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 px-1">Khoảng thời gian</div>
                                    <div className="grid grid-cols-3 gap-1">
                                        {DATE_PRESETS.map(p => (
                                            <button key={p.label} onClick={() => applyPreset(p)}
                                                className={cn("px-2 py-1.5 rounded-lg text-xs text-center transition",
                                                    activePreset === p.label
                                                        ? "bg-blue-600/30 text-blue-300 border border-blue-500/50"
                                                        : "bg-slate-700 text-slate-300 hover:bg-slate-600")}>
                                                {p.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="p-2">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 px-1">Tuỳ chỉnh</div>
                                    <div className="flex items-center gap-2">
                                        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                                            className="bg-slate-900 border border-slate-600 text-slate-300 text-xs rounded px-2 py-1 w-full" />
                                        <span className="text-slate-500 text-xs">→</span>
                                        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                                            className="bg-slate-900 border border-slate-600 text-slate-300 text-xs rounded px-2 py-1 w-full" />
                                    </div>
                                    <button onClick={applyCustom}
                                        className="w-full mt-2 bg-blue-600 hover:bg-blue-500 text-foreground text-xs font-bold px-3 py-1.5 rounded-lg transition">
                                        Áp dụng
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                    <span className="flex items-center gap-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-bold">
                        <Zap className="h-3 w-3" /> LIVE • Direct API
                    </span>
                    <label className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
                        <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-emerald-500 w-3 h-3" />
                        Auto 60s
                    </label>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-right text-[10px] text-slate-400">
                        <div>Synced: <span className="text-emerald-400 font-mono">{syncedAt?.toLocaleTimeString() || '--'}</span></div>
                        {data && <div className="text-slate-500">{data.source} • {data.duration_ms}ms • {summary?.accounts_fetched}TK • {summary?.shops_fetched}shops</div>}
                    </div>
                    <button onClick={() => fetchData()} disabled={loading}
                        className="bg-blue-600 hover:bg-blue-500 text-foreground px-3 py-1.5 rounded-lg text-xs font-bold shadow-lg shadow-blue-500/20 border border-blue-500 flex items-center gap-1 transition disabled:opacity-50">
                        <RotateCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> SYNC
                    </button>
                </div>
            </header>

            {/* ═══ SUMMARY CARDS ═══ */}
            {summary && (
                <div className="shrink-0 border-b border-slate-700">
                    {/* Row 1: Actual */}
                    <div className="grid grid-cols-5 gap-0 bg-slate-900/50">
                        <div className="p-3 border-r border-slate-700">
                            <div className="text-slate-400 text-[10px] font-semibold uppercase">💰 Ads Spend</div>
                            <div className="text-xl font-bold font-mono text-foreground">{formatVND(spendVnd)}đ</div>
                            <div className="text-[10px] text-slate-500">${summary.total_spend.toFixed(0)} USD</div>
                        </div>
                        <div className="p-3 border-r border-slate-700 bg-purple-500/5">
                            <div className="text-purple-400 text-[10px] font-semibold uppercase">🛒 Purchase Meta</div>
                            <div className="text-xl font-bold font-mono text-purple-400">{summary.total_meta_purchases}</div>
                            <div className="text-[10px] text-slate-500">Purchases từ Meta API</div>
                        </div>
                        <div className="p-3 border-r border-slate-700 bg-blue-500/5">
                            <div className="text-blue-400 text-[10px] font-semibold uppercase">📦 Đơn POS</div>
                            <div className="text-xl font-bold font-mono text-blue-400">{summary.total_pos_orders}</div>
                            <div className="text-[10px] text-slate-500">Match: {summary.total_matched_orders} ({summary.matched_orders} ad + {summary.lookup_matched_orders || 0} lookup + {summary.campaign_matched_orders} campaign) | Chưa: {summary.unmatched_orders}</div>
                        </div>
                        <div className="p-3 border-r border-slate-700 bg-emerald-500/5">
                            <div className="text-emerald-400 text-[10px] font-semibold uppercase">💵 Doanh thu ({summary.total_pos_orders} đơn)</div>
                            <div className="text-xl font-bold font-mono text-emerald-400">{formatVND(revVnd)}đ</div>
                            <div className="text-[10px] text-slate-500">{summary.total_matched_orders || summary.matched_orders} match + {summary.unmatched_orders} chưa match</div>
                        </div>
                        <div className="p-3">
                            <div className="text-amber-400 text-[10px] font-semibold uppercase">📈 ROAS (100%)</div>
                            <div className={`text-xl font-bold font-mono ${(spendVnd > 0 ? revVnd / spendVnd : 0) >= 2.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {spendVnd > 0 ? (revVnd / spendVnd).toFixed(2) : '0.00'}x
                            </div>
                        </div>
                    </div>
                    {/* Row 2: Projected */}
                    <div className="grid grid-cols-5 gap-0 bg-slate-800/30 border-t border-slate-700/50">
                        <div className="p-2.5 border-r border-slate-700">
                            <div className="text-slate-500 text-[10px] font-semibold uppercase">💬 Messages</div>
                            <div className="text-lg font-bold font-mono text-indigo-400">{summary.total_messages}</div>
                            <div className="text-[10px] text-slate-500">CPA: {summary.total_messages > 0 ? `${formatVND(usdToVnd(summary.total_spend / summary.total_messages))}đ` : '-'}</div>
                        </div>
                        <div className="p-2.5 border-r border-slate-700 bg-cyan-500/5">
                            <div className="text-cyan-400 text-[10px] font-semibold uppercase flex items-center gap-1">
                                <Target className="h-3 w-3" /> DT Dự kiến (75%)
                            </div>
                            <div className="text-lg font-bold font-mono text-cyan-400">{formatVND(projectedRev)}đ</div>
                        </div>
                        <div className="p-2.5 border-r border-slate-700 bg-cyan-500/5">
                            <div className="text-cyan-400 text-[10px] font-semibold uppercase flex items-center gap-1">
                                <TrendingUp className="h-3 w-3" /> ROAS Dự kiến (75%)
                            </div>
                            <div className={`text-lg font-bold font-mono ${projectedRoas >= 2.5 ? 'text-emerald-400' : projectedRoas > 1 ? 'text-cyan-400' : 'text-rose-400'}`}>
                                {projectedRoas.toFixed(2)}x
                            </div>
                        </div>
                        <div className="p-2.5 border-r border-slate-700 bg-cyan-500/5">
                            <div className={`text-[10px] font-semibold uppercase ${projectedProfit >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
                                📊 Lãi/Lỗ Dự kiến (75%)
                            </div>
                            <div className={`text-lg font-bold font-mono ${projectedProfit >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
                                {formatVND(projectedProfit)}đ
                            </div>
                        </div>
                        <div className="p-2.5">
                            <div className={`text-[10px] font-semibold uppercase ${(revVnd - spendVnd) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                📊 Lãi/Lỗ (100%)
                            </div>
                            <div className={`text-lg font-bold font-mono ${(revVnd - spendVnd) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {formatVND(revVnd - spendVnd)}đ
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ MAIN CONTENT ═══ */}
            <main className="flex-1 overflow-auto bg-[#0F172A] p-3 space-y-3">
                {error && (
                    <div className="flex items-center gap-3 bg-rose-950/50 border border-rose-800 rounded-xl p-3 text-rose-300">
                        <AlertTriangle className="h-5 w-5 shrink-0" />
                        <div className="flex-1">
                            <div className="font-semibold text-sm">Failed to load</div>
                            <div className="text-xs text-rose-400/80">{error}</div>
                        </div>
                        <button onClick={() => fetchData()} className="bg-rose-800 hover:bg-rose-700 px-3 py-1 rounded text-xs text-foreground">Retry</button>
                    </div>
                )}

                {/* Meta API Token/Access Warning */}
                {data?.meta_status && !data.meta_status.token_valid && (
                    <div className="flex items-center gap-3 bg-amber-950/50 border border-amber-700 rounded-xl p-3 text-amber-300">
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
                        <div className="flex-1">
                            <div className="font-bold text-sm text-amber-200">
                                ⚠️ Meta API Token bị chặn (Error {data.meta_status.error_code})
                            </div>
                            <div className="text-xs text-amber-400/80 mt-0.5">
                                {data.meta_status.error_message || 'API access blocked'}
                            </div>
                            <div className="text-[10px] text-amber-500/70 mt-1">
                                {data.meta_status.accounts_blocked.length > 0 && (
                                    <span>TK bị chặn: {data.meta_status.accounts_blocked.map(a => getAccountName(a)).join(', ')} • </span>
                                )}
                                Cần tạo lại token trong Meta Business Settings → System Users
                            </div>
                        </div>
                    </div>
                )}

                {data?.meta_status && data.meta_status.token_valid && data.meta_status.accounts_blocked.length > 0 && (
                    <div className="flex items-center gap-3 bg-amber-950/30 border border-amber-800/50 rounded-xl p-2.5 text-amber-400">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <div className="text-xs">
                            <span className="font-semibold">Một số TK quảng cáo bị chặn: </span>
                            {data.meta_status.accounts_blocked.map(a => getAccountName(a)).join(', ')}
                            {data.meta_status.rate_limit_pct && data.meta_status.rate_limit_pct > 50 && (
                                <span className="ml-2 text-orange-400">• Rate limit: {data.meta_status.rate_limit_pct}%</span>
                            )}
                        </div>
                    </div>
                )}

                {loading && !data ? (
                    <div className="flex items-center justify-center h-64 text-slate-500 animate-pulse text-lg">
                        <Zap className="h-6 w-6 mr-2 text-blue-500 animate-bounce" />
                        Đang tải realtime từ Meta + POS...
                    </div>
                ) : (
                    Object.entries(grouped).map(([accId, accCampaigns]) => {
                        const accSpend = accCampaigns.reduce((s, c) => s + c.spend, 0);
                        const accRevenue = accCampaigns.reduce((s, c) => s + c.revenue_ron, 0);
                        const accOrders = accCampaigns.reduce((s, c) => s + c.orders, 0);
                        const accPurchases = accCampaigns.reduce((s, c) => s + c.purchases, 0);
                        const accRoas = accSpend > 0 ? accRevenue / accSpend : 0;

                        return (
                            <div key={accId} className="rounded-xl border border-slate-700 bg-[#1E293B] overflow-hidden shadow-2xl">
                                {/* Account header */}
                                <div className="px-4 py-2.5 bg-slate-800 border-b border-slate-700 flex items-center justify-between sticky top-0 z-20">
                                    <div className="flex items-center gap-3">
                                        <div className="w-1.5 h-7 bg-blue-500 rounded-full" />
                                        <div>
                                            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">{getAccountName(accId)}</h2>
                                            <div className="text-[10px] text-slate-400">
                                                {accCampaigns.length} campaigns • Spend: <span className="text-foreground font-mono">{formatVND(usdToVnd(accSpend))}đ</span>
                                                {accOrders > 0 && <> • POS: <span className="text-emerald-400 font-mono">{accOrders}</span></>}
                                                {accPurchases > 0 && <> • Meta: <span className="text-purple-400 font-mono">{accPurchases}</span></>}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4 text-[10px]">
                                        <span className="text-slate-400">ROAS: <b className={accRoas > 2.5 ? "text-emerald-400" : "text-amber-400"}>{accRoas.toFixed(2)}</b></span>
                                        {accRevenue > 0 && <span className="text-slate-400">DT: <b className="text-emerald-400">{formatVND(ronToVnd(accRevenue))}đ</b></span>}
                                    </div>
                                </div>

                                {/* Campaign table */}
                                <div className="overflow-auto max-h-[600px]">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-[10px] font-semibold uppercase text-slate-400 bg-slate-800/80 sticky top-0 z-10">
                                            <tr>
                                                <th className="px-2 py-2 w-6"></th>
                                                <th className="px-2 py-2">Campaign</th>
                                                <th className="px-2 py-2 text-right">SPEND (VND)</th>
                                                <th className="px-2 py-2 text-right">CPM / CTR</th>
                                                <th className="px-2 py-2 text-right">MSG</th>
                                                <th className="px-2 py-2 text-right text-purple-300">CPA Purchase</th>
                                                <th className="px-2 py-2 text-right bg-purple-500/10 text-purple-300">🛒 META</th>
                                                <th className="px-2 py-2 text-right bg-emerald-500/10 text-emerald-300">📦 POS</th>
                                                <th className="px-2 py-2 text-right bg-emerald-500/10 text-emerald-300">💰 DT</th>
                                                <th className="px-2 py-2 text-right bg-emerald-500/10 text-emerald-300">📈 ROAS</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-700/50">
                                            {accCampaigns.map(c => {
                                                const isExpanded = expandedCampaign === c.campaign_id;
                                                return (
                                                    <>
                                                        {/* Campaign row */}
                                                        <tr key={c.campaign_id}
                                                            onClick={() => toggleCampaign(c.campaign_id)}
                                                            className="hover:bg-slate-700/30 transition cursor-pointer group">
                                                            <td className="px-2 py-2.5 text-slate-500">
                                                                {isExpanded
                                                                    ? <ChevronDown className="h-3.5 w-3.5 text-blue-400" />
                                                                    : <ChevronRight className="h-3.5 w-3.5 group-hover:text-blue-400" />}
                                                            </td>
                                                            <td className="px-2 py-2.5">
                                                                <div className="text-xs text-foreground max-w-[280px] whitespace-normal leading-tight">{c.campaign_name}</div>
                                                                <div className="text-[9px] text-slate-500 mt-0.5">{c.ads_count} ads</div>
                                                            </td>
                                                            <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-300">{formatVND(usdToVnd(c.spend))}đ</td>
                                                            <td className="px-2 py-2.5 text-right font-mono text-[10px]">
                                                                <div className="text-slate-400">CPM: {formatVND(usdToVnd(c.cpm))}đ</div>
                                                                <div className="text-indigo-400">CTR: {c.ctr.toFixed(2)}%</div>
                                                            </td>
                                                            <td className="px-2 py-2.5 text-right font-mono text-xs text-indigo-400">{c.messages || 0}</td>
                                                            <td className="px-2 py-2.5 text-right font-mono text-xs text-purple-300">
                                                                {c.purchases > 0 ? `${formatVND(usdToVnd(c.spend / c.purchases))}đ` : '-'}
                                                            </td>
                                                            <td className={cn("px-2 py-2.5 text-right font-mono font-bold bg-purple-500/5",
                                                                c.purchases > 0 ? 'text-purple-400' : 'text-slate-600')}>{c.purchases || 0}</td>
                                                            <td className={cn("px-2 py-2.5 text-right font-mono font-bold bg-emerald-500/5",
                                                                c.orders > 0 ? 'text-emerald-400' : 'text-slate-600')}>{c.orders}</td>
                                                            <td className={cn("px-2 py-2.5 text-right font-mono bg-emerald-500/5 text-xs",
                                                                c.revenue_ron > 0 ? 'text-emerald-400 font-bold' : 'text-slate-600')}>
                                                                {c.revenue_ron > 0 ? `${formatVND(ronToVnd(c.revenue_ron))}đ` : '-'}
                                                            </td>
                                                            <td className={cn("px-2 py-2.5 text-right font-mono font-bold bg-emerald-500/5",
                                                                c.roas > 2.5 ? 'text-emerald-400' : c.roas > 0 ? 'text-rose-400' : 'text-slate-600')}>
                                                                {c.roas > 0 ? c.roas.toFixed(2) : '-'}
                                                            </td>
                                                        </tr>

                                                        {/* Expanded ads detail */}
                                                        {isExpanded && c.ads.map((ad: AdDetail) => (
                                                            <tr key={ad.ad_id} className="bg-slate-900/80 border-l-2 border-blue-500/30">
                                                                <td className="px-2 py-1.5"></td>
                                                                <td className="px-2 py-1.5 pl-6">
                                                                    <div className="text-[10px] text-slate-300 max-w-[260px] whitespace-normal leading-tight">{ad.ad_name}</div>
                                                                    <div className="text-[9px] text-slate-600">{ad.adset_name} • {ad.ad_id}</div>
                                                                </td>
                                                                <td className="px-2 py-1.5 text-right font-mono text-[10px] text-slate-400">{formatVND(usdToVnd(ad.spend))}đ</td>
                                                                <td className="px-2 py-1.5 text-right font-mono text-[9px]">
                                                                    <div className="text-slate-500">CPM: {formatVND(usdToVnd(ad.cpm))}đ</div>
                                                                    <div className="text-indigo-400/70">CTR: {ad.ctr.toFixed(2)}%</div>
                                                                </td>
                                                                <td className="px-2 py-1.5 text-right font-mono text-[10px] text-indigo-400/70">{ad.messages || 0}</td>
                                                                <td className="px-2 py-1.5 text-right font-mono text-[10px] text-purple-300/70">
                                                                    {ad.purchases > 0 ? `${formatVND(usdToVnd(ad.spend / ad.purchases))}đ` : '-'}
                                                                </td>
                                                                <td className={cn("px-2 py-1.5 text-right font-mono text-[10px] bg-purple-500/5",
                                                                    ad.purchases > 0 ? 'text-purple-400' : 'text-slate-600')}>{ad.purchases || 0}</td>
                                                                <td className={cn("px-2 py-1.5 text-right font-mono text-[10px] bg-emerald-500/5",
                                                                    ad.orders > 0 ? 'text-emerald-400 font-bold' : 'text-slate-600')}>{ad.orders}</td>
                                                                <td className={cn("px-2 py-1.5 text-right font-mono text-[10px] bg-emerald-500/5",
                                                                    ad.revenue_ron > 0 ? 'text-emerald-400' : 'text-slate-600')}>
                                                                    {ad.revenue_ron > 0 ? `${formatVND(ronToVnd(ad.revenue_ron))}đ` : '-'}
                                                                </td>
                                                                <td className={cn("px-2 py-1.5 text-right font-mono text-[10px] bg-emerald-500/5",
                                                                    ad.roas > 2.5 ? 'text-emerald-400' : ad.roas > 0 ? 'text-rose-400' : 'text-slate-600')}>
                                                                    {ad.roas > 0 ? ad.roas.toFixed(2) : '-'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })
                )}

                {/* Unmatched Orders */}
                {data && data.unmatched_by_shop && Object.keys(data.unmatched_by_shop).length > 0 && (
                    <div className="rounded-xl border border-slate-700 bg-[#1E293B] p-3">
                        <h3 className="text-xs font-bold text-amber-400 mb-2">
                            ⚠️ Đơn chưa match ad_id — {data.summary.unmatched_orders} đơn • {formatVND(ronToVnd(data.summary.unmatched_revenue_ron))}đ
                        </h3>
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                            {Object.entries(data.unmatched_by_shop)
                                .sort(([, a], [, b]) => b.revenue_ron - a.revenue_ron)
                                .map(([shop, info]) => (
                                    <div key={shop} className="bg-slate-800 rounded-lg p-2.5 border border-slate-700">
                                        <div className="text-foreground font-bold text-xs">{shop}</div>
                                        <div className="text-emerald-400 font-mono text-sm font-bold">{formatVND(ronToVnd(info.revenue_ron))}đ</div>
                                        <div className="text-slate-500 text-[10px]">{info.count} đơn</div>
                                    </div>
                                ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
