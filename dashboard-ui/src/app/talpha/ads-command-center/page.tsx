"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import axios from "axios";
import { RotateCw, Satellite, Layers, AlertTriangle, ChevronDown, ChevronRight, Check, Zap, ShoppingCart, Target, TrendingUp } from "lucide-react";
import { formatVNDCompact, cn } from "@/components/talpha/utils";

// ── constants ──
const DELIVERY_SUCCESS_RATE = 0.65;
const ACCOUNT_NAMES: Record<string, string> = {
    "act_1503790877534258": "Tiểu Alpha 3",
    "act_855567553811483": "Sỹ Lộc 01",
    "act_833593695771745": "Chu Thuý 01",
    "act_848995974322757": "Chu Thuý 02",
    "act_3534017756739334": "Kuwait +3",
    "act_703242242813144": "Trang Sức +1",
    "act_1119368126847210": "Trang sức 2 Dubai",
    "act_719840753771124": "Tiểu Alpha 4",
};
const getAccountName = (id: string) => ACCOUNT_NAMES[id] || id;

// ── types ──
interface AdDetail {
    ad_id: string; ad_name: string; adset_name: string;
    spend_vnd: number; impressions: number; cpm_vnd: number; cpc_vnd: number; ctr: number;
    messages: number; purchases: number; orders: number; revenue_vnd: number; roas: number;
}

interface RealtimeCampaign {
    account_id: string; account_name: string; campaign_id: string; campaign_name: string;
    spend_vnd: number; impressions: number; cpm_vnd: number; ctr: number;
    messages: number; purchases: number; orders: number; revenue_vnd: number; roas: number;
    bot_orders?: number; bot_revenue_vnd?: number;
    ads_count: number; ads: AdDetail[];
}

interface Summary {
    total_spend_vnd: number; total_revenue_vnd: number; total_orders: number;
    total_messages: number; matched_orders: number; unmatched_orders: number;
    bot_orders?: number; bot_revenue_vnd?: number;
    total_pos_orders: number; total_meta_purchases: number; blended_roas: number;
    accounts_fetched: number; shops_fetched: number;
    matched_revenue_vnd: number; unmatched_revenue_vnd: number;
}

interface RealtimeData {
    source: string; fetched_at: string; duration_ms: number;
    summary: Summary; campaigns: RealtimeCampaign[]; unmatched_orders: any[];
    unmatched_by_shop: Record<string, { count: number; revenue_vnd: number }>;
}

// ── date helpers (ad account timezone +4 = Asia/Dubai) ──
const AD_TZ = 'Asia/Dubai';
function todayStr() { return new Date().toLocaleDateString('sv-SE', { timeZone: AD_TZ }); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('sv-SE', { timeZone: AD_TZ }); }
const DATE_PRESETS: { label: string; from: () => string; to: () => string }[] = [
    { label: "Hôm nay", from: todayStr, to: todayStr },
    { label: "Hôm qua", from: () => daysAgo(1), to: () => daysAgo(1) },
    { label: "3 ngày", from: () => daysAgo(2), to: todayStr },
    { label: "7 ngày", from: () => daysAgo(6), to: todayStr },
    { label: "14 ngày", from: () => daysAgo(13), to: todayStr },
    { label: "30 ngày", from: () => daysAgo(29), to: todayStr },
];

export default function TALPHAAdsCommandCenterPage() {
    const [data, setData] = useState<RealtimeData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [syncedAt, setSyncedAt] = useState<Date | null>(null);
    const [selectedAccount, setSelectedAccount] = useState("all");
    const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
    const [fromDate, setFromDate] = useState(todayStr());
    const [toDate, setToDate] = useState(todayStr());
    const [activePreset, setActivePreset] = useState("Hôm nay");
    const [showDatePicker, setShowDatePicker] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const dateRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsAccountDropdownOpen(false);
            }
            if (dateRef.current && !dateRef.current.contains(e.target as Node)) {
                setShowDatePicker(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const fetchData = async (fd?: string, td?: string) => {
        const f = fd || fromDate;
        const t = td || toDate;
        setLoading(true); setError(null);
        try {
            const res = await axios.get(`/api/talpha/realtime`, {
                params: { from_date: f, to_date: t },
                timeout: 60000, // longer timeout for bigger date ranges
            });
            setData(res.data); setSyncedAt(new Date());
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || "Failed to fetch");
        } finally { setLoading(false); }
    };

    const applyPreset = (preset: typeof DATE_PRESETS[0]) => {
        const f = preset.from();
        const t = preset.to();
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

    // ── projected 65% ──
    const projected65Rev = (summary?.total_revenue_vnd || 0) * DELIVERY_SUCCESS_RATE;
    const projected65Roas = (summary?.total_spend_vnd || 0) > 0 ? projected65Rev / summary!.total_spend_vnd : 0;
    const projected65Profit = projected65Rev - (summary?.total_spend_vnd || 0);

    const toggleCampaign = (id: string) => {
        setExpandedCampaign(prev => prev === id ? null : id);
    };

    return (
        <div className="h-screen flex flex-col overflow-hidden bg-[#0F172A] text-slate-100 font-sans">

            {/* ═══ HEADER ═══ */}
            <header className="h-14 border-b border-slate-700 bg-[#1E293B] px-5 flex items-center justify-between shrink-0 z-50">
                <div className="flex items-center gap-3">
                    <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                        <Satellite className="h-5 w-5 text-amber-500" /> TALPHA ADS COMMAND
                    </h1>
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
                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-700 ${selectedAccount === "all" ? "bg-amber-600/20 text-amber-300" : "text-slate-300"}`}>
                                    <span>🌐 All ({accountIds.length} TKQC)</span>
                                    {selectedAccount === "all" && <Check className="h-4 w-4 text-amber-400" />}
                                </button>
                                {accountIds.map(accId => (
                                    <button key={accId} onClick={() => { setSelectedAccount(accId); setIsAccountDropdownOpen(false); }}
                                        className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-slate-700 ${selectedAccount === accId ? "bg-amber-600/20 text-amber-300" : "text-slate-300"}`}>
                                        <div>
                                            <div className="font-medium text-xs">{getAccountName(accId)}</div>
                                            <div className="font-mono text-[9px] text-slate-500">{accId}</div>
                                        </div>
                                        {selectedAccount === accId && <Check className="h-3 w-3 text-amber-400" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {/* ── Date Range Picker ── */}
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
                                                        ? "bg-amber-600/30 text-amber-300 border border-amber-500/50"
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
                                        className="w-full mt-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition">
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
                        className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-lg shadow-amber-500/20 border border-amber-500 flex items-center gap-1 transition disabled:opacity-50">
                        <RotateCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> SYNC
                    </button>
                </div>
            </header>

            {/* ═══ SUMMARY CARDS — 2 rows ═══ */}
            {summary && (
                <div className="shrink-0 border-b border-slate-700">
                    {/* Row 1: Actual metrics */}
                    <div className="grid grid-cols-5 gap-0 bg-slate-900/50">
                        <div className="p-3 border-r border-slate-700">
                            <div className="text-slate-400 text-[10px] font-semibold uppercase">💰 Chi phí Ads</div>
                            <div className="text-xl font-bold font-mono text-white">{formatVNDCompact(summary.total_spend_vnd)}</div>
                        </div>
                        <div className="p-3 border-r border-slate-700 bg-purple-500/5">
                            <div className="text-purple-400 text-[10px] font-semibold uppercase">🛒 Đơn Meta</div>
                            <div className="text-xl font-bold font-mono text-purple-400">{summary.total_meta_purchases}</div>
                            <div className="text-[10px] text-slate-500">Purchases từ Meta API</div>
                        </div>
                        <div className="p-3 border-r border-slate-700 bg-blue-500/5">
                            <div className="text-blue-400 text-[10px] font-semibold uppercase">📦 Đơn POS</div>
                            <div className="text-xl font-bold font-mono text-blue-400">{summary.total_pos_orders}</div>
                            <div className="text-[10px] text-slate-500">
                                Match: {summary.matched_orders} | 🤖 Bot: {summary.bot_orders || 0} | Chưa: {summary.unmatched_orders}
                            </div>
                        </div>
                        <div className="p-3 border-r border-slate-700 bg-emerald-500/5">
                            <div className="text-emerald-400 text-[10px] font-semibold uppercase">💵 Doanh thu ({summary.total_pos_orders} đơn)</div>
                            <div className="text-xl font-bold font-mono text-emerald-400">{formatVNDCompact(summary.total_revenue_vnd)}</div>
                            <div className="text-[10px] text-slate-500">
                                {formatVNDCompact(summary.matched_revenue_vnd)} match + {formatVNDCompact(summary.bot_revenue_vnd || 0)} bot + {formatVNDCompact(summary.unmatched_revenue_vnd)} chưa
                            </div>
                        </div>
                        <div className="p-3">
                            <div className="text-amber-400 text-[10px] font-semibold uppercase">📈 ROAS (100%)</div>
                            <div className={`text-xl font-bold font-mono ${summary.blended_roas >= 2.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {summary.blended_roas.toFixed(2)}x
                            </div>
                        </div>
                    </div>
                    {/* Row 2: Projected 65% */}
                    <div className="grid grid-cols-5 gap-0 bg-slate-800/30 border-t border-slate-700/50">
                        <div className="p-2.5 border-r border-slate-700">
                            <div className="text-slate-500 text-[10px] font-semibold uppercase">💬 Messages</div>
                            <div className="text-lg font-bold font-mono text-indigo-400">{summary.total_messages}</div>
                            <div className="text-[10px] text-slate-500">CPA: {summary.total_messages > 0 ? formatVNDCompact(summary.total_spend_vnd / summary.total_messages) : '-'}</div>
                        </div>
                        <div className="col-span-1 p-2.5 border-r border-slate-700 bg-cyan-500/5">
                            <div className="text-cyan-400 text-[10px] font-semibold uppercase flex items-center gap-1">
                                <Target className="h-3 w-3" /> DT Dự kiến (65%)
                            </div>
                            <div className="text-lg font-bold font-mono text-cyan-400">{formatVNDCompact(projected65Rev)}</div>
                            <div className="text-[10px] text-slate-500">= {Math.round((summary.total_orders || 0) * DELIVERY_SUCCESS_RATE)} đơn thành</div>
                        </div>
                        <div className="p-2.5 border-r border-slate-700 bg-cyan-500/5">
                            <div className="text-cyan-400 text-[10px] font-semibold uppercase flex items-center gap-1">
                                <TrendingUp className="h-3 w-3" /> ROAS Dự kiến (65%)
                            </div>
                            <div className={`text-lg font-bold font-mono ${projected65Roas >= 2.5 ? 'text-emerald-400' : projected65Roas > 1 ? 'text-cyan-400' : 'text-rose-400'}`}>
                                {projected65Roas.toFixed(2)}x
                            </div>
                        </div>
                        <div className="p-2.5 border-r border-slate-700 bg-cyan-500/5">
                            <div className={`text-[10px] font-semibold uppercase ${projected65Profit >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
                                📊 Lãi/Lỗ Dự kiến (65%)
                            </div>
                            <div className={`text-lg font-bold font-mono ${projected65Profit >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
                                {formatVNDCompact(projected65Profit)}
                            </div>
                        </div>
                        <div className="p-2.5">
                            <div className={`text-[10px] font-semibold uppercase ${(summary.total_revenue_vnd - summary.total_spend_vnd) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                📊 Lãi/Lỗ (100%)
                            </div>
                            <div className={`text-lg font-bold font-mono ${(summary.total_revenue_vnd - summary.total_spend_vnd) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {formatVNDCompact(summary.total_revenue_vnd - summary.total_spend_vnd)}
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
                        <button onClick={() => fetchData()} className="bg-rose-800 hover:bg-rose-700 px-3 py-1 rounded text-xs text-white">Retry</button>
                    </div>
                )}

                {loading && !data ? (
                    <div className="flex items-center justify-center h-64 text-slate-500 animate-pulse text-lg">
                        <Zap className="h-6 w-6 mr-2 text-amber-500 animate-bounce" />
                        Đang tải realtime từ Meta + POS...
                    </div>
                ) : (
                    Object.entries(grouped).map(([accId, accCampaigns]) => {
                        const accSpend = accCampaigns.reduce((s, c) => s + c.spend_vnd, 0);
                        const accRevenue = accCampaigns.reduce((s, c) => s + c.revenue_vnd + (c.bot_revenue_vnd || 0), 0);
                        const accOrders = accCampaigns.reduce((s, c) => s + c.orders + (c.bot_orders || 0), 0);
                        const accPurchases = accCampaigns.reduce((s, c) => s + c.purchases, 0);
                        const accRoas = accSpend > 0 ? accRevenue / accSpend : 0;

                        return (
                            <div key={accId} className="rounded-xl border border-slate-700 bg-[#1E293B] overflow-hidden shadow-2xl">
                                {/* Account header */}
                                <div className="px-4 py-2.5 bg-slate-800 border-b border-slate-700 flex items-center justify-between sticky top-0 z-20">
                                    <div className="flex items-center gap-3">
                                        <div className="w-1.5 h-7 bg-amber-500 rounded-full" />
                                        <div>
                                            <h2 className="text-sm font-bold text-white uppercase tracking-wider">{getAccountName(accId)}</h2>
                                            <div className="text-[10px] text-slate-400">
                                                {accCampaigns.length} campaigns • Spend: <span className="text-white font-mono">{formatVNDCompact(accSpend)}</span>
                                                {accOrders > 0 && <> • POS: <span className="text-emerald-400 font-mono">{accOrders}</span></>}
                                                {accPurchases > 0 && <> • Meta: <span className="text-purple-400 font-mono">{accPurchases}</span></>}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4 text-[10px]">
                                        <span className="text-slate-400">ROAS: <b className={accRoas > 2.5 ? "text-emerald-400" : "text-amber-400"}>{accRoas.toFixed(2)}</b></span>
                                        {accRevenue > 0 && <span className="text-slate-400">DT: <b className="text-emerald-400">{formatVNDCompact(accRevenue)}</b></span>}
                                    </div>
                                </div>

                                {/* Campaign table */}
                                <div className="overflow-auto max-h-[600px]">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-[10px] font-semibold uppercase text-slate-400 bg-slate-800/80 sticky top-0 z-10">
                                            <tr>
                                                <th className="px-2 py-2 w-6"></th>
                                                <th className="px-2 py-2">Campaign</th>
                                                <th className="px-2 py-2 text-right">SPEND (₫)</th>
                                                <th className="px-2 py-2 text-right">CPM / CTR</th>
                                                <th className="px-2 py-2 text-right">MSG</th>
                                                <th className="px-2 py-2 text-right text-indigo-300">CPA MSG</th>
                                                <th className="px-2 py-2 text-right bg-purple-500/10 text-purple-300">🛒 META</th>
                                                <th className="px-2 py-2 text-right bg-emerald-500/10 text-emerald-300">📦 POS</th>
                                                <th className="px-2 py-2 text-right bg-teal-500/10 text-teal-300">🤖 BOT</th>
                                                <th className="px-2 py-2 text-right bg-emerald-500/10 text-emerald-300">💰 DT</th>
                                                <th className="px-2 py-2 text-right bg-emerald-500/10 text-emerald-300">📈 ROAS</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-700/50">
                                            {accCampaigns.map(c => {
                                                const isExpanded = expandedCampaign === c.campaign_id;
                                                const totalCampRevenue = c.revenue_vnd + (c.bot_revenue_vnd || 0);
                                                return (
                                                    <>
                                                        {/* Campaign row */}
                                                        <tr key={c.campaign_id}
                                                            onClick={() => toggleCampaign(c.campaign_id)}
                                                            className="hover:bg-slate-700/30 transition cursor-pointer group">
                                                            <td className="px-2 py-2.5 text-slate-500">
                                                                {isExpanded
                                                                    ? <ChevronDown className="h-3.5 w-3.5 text-amber-400" />
                                                                    : <ChevronRight className="h-3.5 w-3.5 group-hover:text-amber-400" />}
                                                            </td>
                                                            <td className="px-2 py-2.5">
                                                                <div className="text-xs text-white max-w-[280px] whitespace-normal leading-tight">{c.campaign_name}</div>
                                                                <div className="text-[9px] text-slate-500 mt-0.5">{c.ads_count} ads</div>
                                                            </td>
                                                            <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-300">{formatVNDCompact(c.spend_vnd)}</td>
                                                            <td className="px-2 py-2.5 text-right font-mono text-[10px]">
                                                                <div className="text-slate-400">CPM: {formatVNDCompact(c.cpm_vnd)}</div>
                                                                <div className="text-indigo-400">CTR: {c.ctr.toFixed(2)}%</div>
                                                            </td>
                                                            <td className="px-2 py-2.5 text-right font-mono text-xs text-indigo-400">{c.messages || 0}</td>
                                                            <td className="px-2 py-2.5 text-right font-mono text-xs text-indigo-300">
                                                                {c.messages > 0 ? formatVNDCompact(c.spend_vnd / c.messages) : '-'}
                                                            </td>
                                                            <td className={cn("px-2 py-2.5 text-right font-mono font-bold bg-purple-500/5",
                                                                c.purchases > 0 ? 'text-purple-400' : 'text-slate-600')}>{c.purchases || 0}</td>
                                                            <td className={cn("px-2 py-2.5 text-right font-mono font-bold bg-emerald-500/5",
                                                                c.orders > 0 ? 'text-emerald-400' : 'text-slate-600')}>{c.orders}</td>
                                                            <td className={cn("px-2 py-2.5 text-right font-mono font-bold bg-teal-500/5",
                                                                c.bot_orders && c.bot_orders > 0 ? 'text-teal-400' : 'text-slate-600')}>{c.bot_orders || 0}</td>
                                                            <td className={cn("px-2 py-2.5 text-right font-mono bg-emerald-500/5 text-xs",
                                                                totalCampRevenue > 0 ? 'text-emerald-400 font-bold' : 'text-slate-600')}>
                                                                {totalCampRevenue > 0 ? formatVNDCompact(totalCampRevenue) : '-'}
                                                            </td>
                                                            <td className={cn("px-2 py-2.5 text-right font-mono font-bold bg-emerald-500/5",
                                                                c.roas > 2.5 ? 'text-emerald-400' : c.roas > 0 ? 'text-rose-400' : 'text-slate-600')}>
                                                                {c.roas > 0 ? c.roas.toFixed(2) : '-'}
                                                            </td>
                                                        </tr>

                                                        {/* Expanded ads detail */}
                                                        {isExpanded && c.ads.map((ad: AdDetail) => (
                                                            <tr key={ad.ad_id} className="bg-slate-900/80 border-l-2 border-amber-500/30">
                                                                <td className="px-2 py-1.5"></td>
                                                                <td className="px-2 py-1.5 pl-6">
                                                                    <div className="text-[10px] text-slate-300 max-w-[260px] whitespace-normal leading-tight">{ad.ad_name}</div>
                                                                    <div className="text-[9px] text-slate-600">{ad.adset_name} • {ad.ad_id}</div>
                                                                </td>
                                                                <td className="px-2 py-1.5 text-right font-mono text-[10px] text-slate-400">{formatVNDCompact(ad.spend_vnd)}</td>
                                                                <td className="px-2 py-1.5 text-right font-mono text-[9px]">
                                                                    <div className="text-slate-500">CPM: {formatVNDCompact(ad.cpm_vnd)}</div>
                                                                    <div className="text-indigo-400/70">CTR: {ad.ctr.toFixed(2)}%</div>
                                                                </td>
                                                                <td className="px-2 py-1.5 text-right font-mono text-[10px] text-indigo-400/70">{ad.messages || 0}</td>
                                                                <td className="px-2 py-1.5 text-right font-mono text-[10px] text-indigo-300/70">
                                                                    {ad.messages > 0 ? formatVNDCompact(ad.spend_vnd / ad.messages) : '-'}
                                                                </td>
                                                                <td className={cn("px-2 py-1.5 text-right font-mono text-[10px] bg-purple-500/5",
                                                                    ad.purchases > 0 ? 'text-purple-400' : 'text-slate-600')}>{ad.purchases || 0}</td>
                                                                <td className={cn("px-2 py-1.5 text-right font-mono text-[10px] bg-emerald-500/5",
                                                                    ad.orders > 0 ? 'text-emerald-400 font-bold' : 'text-slate-600')}>{ad.orders}</td>
                                                                <td className="px-2 py-1.5 text-right font-mono text-[10px] bg-teal-500/5 text-slate-600">-</td>
                                                                <td className={cn("px-2 py-1.5 text-right font-mono text-[10px] bg-emerald-500/5",
                                                                    ad.revenue_vnd > 0 ? 'text-emerald-400' : 'text-slate-600')}>
                                                                    {ad.revenue_vnd > 0 ? formatVNDCompact(ad.revenue_vnd) : '-'}
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
                            ⚠️ Đơn chưa match ad_id — {data.summary.unmatched_orders} đơn • {formatVNDCompact(data.summary.unmatched_revenue_vnd)}
                        </h3>
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                            {Object.entries(data.unmatched_by_shop)
                                .sort(([, a], [, b]) => b.revenue_vnd - a.revenue_vnd)
                                .map(([shop, info]) => (
                                    <div key={shop} className="bg-slate-800 rounded-lg p-2.5 border border-slate-700">
                                        <div className="text-white font-bold text-xs">{shop}</div>
                                        <div className="text-emerald-400 font-mono text-sm font-bold">{formatVNDCompact(info.revenue_vnd)}</div>
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
