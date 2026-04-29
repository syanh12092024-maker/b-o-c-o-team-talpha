"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import axios from "axios";
import { AdsCommandCenterResponse, CampaignData, DashboardSummary, usdToVnd, localToVnd, formatVND } from "@/components/ads-command-center/types";
import { CampaignTable } from "@/components/ads-command-center/CampaignTable";
import { SummaryCards } from "@/components/ads-command-center/SummaryCards";
import { ColumnSelector } from "@/components/ads-command-center/ColumnSelector";
import { CMOChat } from "@/components/ads-command-center/CMOChat";
import { VisibilityState } from "@tanstack/react-table";
import { RotateCw, Layers, AlertTriangle, ChevronDown, Check } from "lucide-react";

import { API_BASE as BASE_URL } from "@/lib/constants";

const API_BASE = `${BASE_URL}/api/dashboard`;

interface AccountInfo {
    id: string;
    source?: string;
    campaign_count?: number;
}

/**
 * Embedded version of Ads Command Center — designed to live inside DashboardShell.
 * No h-screen, no own header. Uses shell's layout.
 */
export default function AdsCommandTab() {
    const [data, setData] = useState<AdsCommandCenterResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [syncedAt, setSyncedAt] = useState<Date | null>(null);

    const [dateUsage, setDateUsage] = useState("today");
    const [selectedAccount, setSelectedAccount] = useState("all");
    const [accounts, setAccounts] = useState<AccountInfo[]>([]);
    const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
        spend: true, meta_efficiency: true, meta_results: true,
        real_orders: true, real_revenue: true, real_roas: true,
        real_cpa: false, cmo_action: true,
    });
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    useEffect(() => {
        axios.get(`${API_BASE}/ads-command-center/accounts`)
            .then(res => setAccounts(res.data.accounts || []))
            .catch(() => { });
    }, []);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsAccountDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await axios.get(`${API_BASE}/ads-command-center`, {
                params: { date_preset: dateUsage, account_id: selectedAccount },
                timeout: 30000,
            });
            setData(res.data);
            setSyncedAt(new Date());
        } catch (err: any) {
            const msg = err.response?.data?.detail || err.message || "Unknown error";
            setError(`API Error: ${msg}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, [dateUsage, selectedAccount]);

    const allCampaigns = data?.campaigns || [];
    const groupedCampaigns = useMemo(() => {
        const groups: Record<string, CampaignData[]> = {};
        allCampaigns.forEach(c => {
            const key = c.account_id || "unknown";
            if (!groups[key]) groups[key] = [];
            groups[key].push(c);
        });
        return groups;
    }, [allCampaigns]);

    const summary: DashboardSummary = useMemo(() => {
        let total_spend = 0, total_meta_messages = 0, total_real_leads = 0;
        let total_real_orders = 0, total_real_revenue = 0;
        allCampaigns.forEach(c => {
            total_spend += c.metrics_meta?.spend || 0;
            total_meta_messages += c.metrics_meta?.messages || 0;
            total_real_leads += c.metrics_real?.created_orders || 0;
            total_real_orders += c.metrics_real?.orders || 0;
            total_real_revenue += c.metrics_real?.revenue || 0;
        });
        const spendVnd = usdToVnd(total_spend);
        const revenueVnd = localToVnd(total_real_revenue);
        const blended_roas = spendVnd > 0 ? revenueVnd / spendVnd : 0;
        return { total_spend, total_meta_messages, total_real_leads, total_real_orders, total_real_revenue, blended_roas };
    }, [allCampaigns]);

    const accountLabel = selectedAccount === "all"
        ? `All Accounts (${Object.keys(groupedCampaigns).length})`
        : selectedAccount;

    return (
        <div className="space-y-4">
            {/* ═══ TOOLBAR ═══ */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-[#1E293B] p-3">
                <div className="flex items-center gap-3">
                    {/* Account Dropdown */}
                    <div className="relative" ref={dropdownRef}>
                        <button
                            onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
                            className="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:border-slate-400 transition"
                        >
                            <Layers className="h-4 w-4" />
                            <span>{accountLabel}</span>
                            <ChevronDown className={`h-3 w-3 transition ${isAccountDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isAccountDropdownOpen && (
                            <div className="absolute top-full left-0 mt-1 w-72 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl z-50 overflow-hidden">
                                <button
                                    onClick={() => { setSelectedAccount("all"); setIsAccountDropdownOpen(false); }}
                                    className={`w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-slate-700 transition ${selectedAccount === "all" ? "bg-indigo-600/20 text-indigo-300" : "text-slate-300"}`}
                                >
                                    <span className="font-medium">🌐 All Accounts</span>
                                    {selectedAccount === "all" && <Check className="h-4 w-4 text-indigo-400" />}
                                </button>
                                <div className="border-t border-slate-700" />
                                {(accounts.length > 0 ? accounts : Object.keys(groupedCampaigns).map(id => ({ id }))).map((acc: any) => (
                                    <button
                                        key={acc.id}
                                        onClick={() => { setSelectedAccount(acc.id); setIsAccountDropdownOpen(false); }}
                                        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-700 transition ${selectedAccount === acc.id ? "bg-indigo-600/20 text-indigo-300" : "text-slate-300"}`}
                                    >
                                        <div className="font-mono text-xs">{acc.id}</div>
                                        {selectedAccount === acc.id && <Check className="h-4 w-4 text-indigo-400" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Date Range */}
                    <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-600">
                        {[
                            { key: 'today', label: 'Today', badge: 'LIVE' },
                            { key: 'yesterday', label: 'Yesterday', badge: 'BQ' },
                            { key: 'last_7d', label: 'Last 7d', badge: 'BQ' },
                        ].map(({ key, label, badge }) => (
                            <button
                                key={key}
                                onClick={() => setDateUsage(key)}
                                className={`px-3 py-1 rounded-md text-sm font-medium transition flex items-center gap-1.5 ${dateUsage === key ? 'bg-indigo-600 text-foreground shadow-sm' : 'text-slate-400 hover:text-foreground'}`}
                            >
                                {label}
                                {dateUsage === key && (
                                    <span className={`text-[0.6rem] px-1 py-0.5 rounded font-bold ${badge === 'LIVE' ? 'bg-emerald-500/30 text-emerald-300' : 'bg-amber-500/30 text-amber-300'}`}>
                                        {badge}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <ColumnSelector
                        visibility={columnVisibility}
                        onChange={setColumnVisibility}
                        isOpen={isSettingsOpen}
                        onToggle={() => setIsSettingsOpen(!isSettingsOpen)}
                    />
                    <div className="text-right text-xs text-slate-400">
                        Synced: <span className="text-emerald-400 font-mono">{syncedAt?.toLocaleTimeString() || '--:--:--'}</span>
                        {data?.meta && (
                            <div className="text-[0.6rem] text-slate-500 uppercase tracking-wider">
                                {data.meta.source} • {data.meta.sync_duration_ms}ms
                            </div>
                        )}
                    </div>
                    <button
                        onClick={fetchData}
                        disabled={loading}
                        className="bg-indigo-600 hover:bg-indigo-500 text-foreground px-4 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-indigo-500/20 border border-indigo-500 flex items-center gap-2 transition hover:scale-105 active:scale-95 disabled:opacity-50"
                    >
                        <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> SYNC
                    </button>
                </div>
            </div>

            {/* ═══ SUMMARY CARDS ═══ */}
            <SummaryCards summary={summary} isLoading={loading && !data} />

            {/* ═══ ATTRIBUTION WARNING ═══ */}
            {data?._warning && (
                <div className="flex items-center gap-3 bg-amber-950/50 border border-amber-700 rounded-xl p-4 text-amber-300">
                    <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
                    <div className="text-sm">{data._warning}</div>
                </div>
            )}

            {/* ═══ ERROR ═══ */}
            {error && (
                <div className="flex items-center gap-3 bg-rose-950/50 border border-rose-800 rounded-xl p-4 text-rose-300">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <div>
                        <div className="font-semibold">Failed to load data</div>
                        <div className="text-sm text-rose-400/80">{error}</div>
                    </div>
                    <button onClick={fetchData} className="ml-auto bg-rose-800 hover:bg-rose-700 px-3 py-1 rounded text-sm text-foreground">Retry</button>
                </div>
            )}

            {/* ═══ CAMPAIGNS ═══ */}
            {loading && !data ? (
                <div className="flex items-center justify-center h-64 text-slate-500 animate-pulse">
                    Loading Real-time Data...
                </div>
            ) : (
                Object.entries(groupedCampaigns).map(([accId, campaigns]) => {
                    const accSpend = campaigns.reduce((s, c) => s + (c.metrics_meta?.spend || 0), 0);
                    const accRevRon = campaigns.reduce((s, c) => s + (c.metrics_real?.revenue || 0), 0);
                    const accOrders = campaigns.reduce((s, c) => s + (c.metrics_real?.created_orders || 0), 0);
                    const accSpendVnd = usdToVnd(accSpend);
                    const accRevVnd = localToVnd(accRevRon);
                    const accRoas = accSpendVnd ? accRevVnd / accSpendVnd : 0;

                    return (
                        <div key={accId} className="rounded-xl border border-slate-700 bg-[#1E293B] overflow-hidden shadow-2xl">
                            <div className="px-4 py-3 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-8 bg-blue-500 rounded-full"></div>
                                    <div>
                                        <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">TK: {accId}</h2>
                                        <div className="text-xs text-slate-400">
                                            {campaigns.length} campaigns •
                                            Spend: <span className="text-foreground font-mono">{formatVND(accSpendVnd)}</span>
                                            {accOrders > 0 && <> • Đơn tạo: <span className="text-emerald-400 font-mono">{accOrders}</span></>}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-slate-400">
                                    <span>ROAS: <b className={accRoas > 2.5 ? "text-emerald-400" : "text-amber-400"}>{accRoas.toFixed(2)}</b></span>
                                    {accRevVnd > 0 && <span>DT: <b className="text-emerald-400">{formatVND(accRevVnd)}</b></span>}
                                </div>
                            </div>
                            <CampaignTable data={campaigns} columnVisibility={columnVisibility} />
                        </div>
                    )
                })
            )}

            <CMOChat />
        </div>
    );
}
