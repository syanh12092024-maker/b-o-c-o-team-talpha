"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
    RotateCw, Key, LogOut, Check, X, ChevronDown,
    Layers, AlertTriangle, CalendarDays, Loader2,
    TrendingUp, DollarSign, Eye, MousePointerClick,
    Unplug, Plug2, MessageSquare
} from "lucide-react";
import { formatVND } from "@/components/ads-command-center/types";

// Local storage keys
const LS_TOKEN = "auus1_meta_token";
const LS_ACCOUNTS = "auus1_connected_accounts";

interface MetaUser {
    id: string;
    name: string;
}

interface MetaBusiness {
    id: string;
    name: string;
}

interface AdAccount {
    id: string;
    name: string;
    status: string;
    status_code: number;
    currency: string;
    timezone: string;
    amount_spent: number;
    connected?: boolean;
}

interface InsightRow {
    date: string;
    account_id: string;
    campaign_name: string;
    campaign_id: string;
    adset_name: string;
    ad_name: string;
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    cpm: number;
    ctr: number;
    messages: number;
    leads: number;
    purchases: number;
    purchase_value: number;
    pos_purchases?: number;
}

interface AccountInsight {
    account_id: string;
    rows: InsightRow[];
    total_spend: number;
    total_impressions: number;
    total_clicks: number;
    error?: string;
}

type Step = "login" | "select_accounts" | "dashboard";

function localDate(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Lấy thời gian hiện tại theo đúng múi giờ Los Angeles (UTC-7/UTC-8)
function getPSTNow() {
    const str = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour12: false });
    return new Date(str);
}

export default function AdsCommandTab() {
    // Auth state
    const [step, setStep] = useState<Step>("login");
    const [token, setToken] = useState("");
    const [tokenInput, setTokenInput] = useState("");
    const [user, setUser] = useState<MetaUser | null>(null);
    const [businesses, setBusinesses] = useState<MetaBusiness[]>([]);
    const [verifying, setVerifying] = useState(false);
    const [verifyError, setVerifyError] = useState("");

    // Account selection state
    const [availableAccounts, setAvailableAccounts] = useState<AdAccount[]>([]);
    const [connectedAccounts, setConnectedAccounts] = useState<AdAccount[]>([]);
    const [selectedBusiness, setSelectedBusiness] = useState<string>("");
    const [loadingAccounts, setLoadingAccounts] = useState(false);
    const [selectAll, setSelectAll] = useState(false);
    const [tempSelected, setTempSelected] = useState<Set<string>>(new Set());

    // Dashboard state
    const [insights, setInsights] = useState<AccountInsight[]>([]);
    const [syncing, setSyncing] = useState(false);
    const [syncError, setSyncError] = useState("");
    const [syncedAt, setSyncedAt] = useState<string | null>(null);
    const [dateRange, setDateRange] = useState(() => {
        const today = getPSTNow();
        const since = new Date(today);
        since.setDate(since.getDate() - 6);
        return {
            since: localDate(since),
            until: localDate(today),
        };
    });
    const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
    const [hideZeroSpend, setHideZeroSpend] = useState(true);

    // Load from localStorage on mount
    useEffect(() => {
        const savedToken = localStorage.getItem(LS_TOKEN);
        const savedAccounts = localStorage.getItem(LS_ACCOUNTS);
        if (savedToken) {
            setToken(savedToken);
            if (savedAccounts) {
                try {
                    const accounts = JSON.parse(savedAccounts);
                    setConnectedAccounts(accounts);
                    setStep("dashboard");

                    const cachedInsights = sessionStorage.getItem("auus1_ads_insights");
                    const cachedSyncedAt = sessionStorage.getItem("auus1_ads_synced_at");
                    if (cachedInsights) {
                        try {
                            setInsights(JSON.parse(cachedInsights));
                            if (cachedSyncedAt) setSyncedAt(cachedSyncedAt);
                        } catch (e) {}
                    }
                } catch { setStep("login"); }
            } else {
                // Has token but no accounts — re-verify
                reverifyToken(savedToken);
            }
        }
    }, []);

    async function reverifyToken(t: string) {
        try {
            const res = await fetch("/api/meta", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "verify_token", access_token: t }),
            });
            const data = await res.json();
            if (data.valid) {
                setUser(data.user);
                setBusinesses(data.businesses || []);
                setToken(t);
                setStep("select_accounts");
            } else {
                localStorage.removeItem(LS_TOKEN);
                setStep("login");
            }
        } catch {
            setStep("login");
        }
    }

    // Step 1: Verify token
    async function handleVerifyToken() {
        if (!tokenInput.trim()) return;
        setVerifying(true);
        setVerifyError("");
        try {
            const res = await fetch("/api/meta", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "verify_token", access_token: tokenInput.trim() }),
            });
            const data = await res.json();
            if (data.valid) {
                setUser(data.user);
                setBusinesses(data.businesses || []);
                setToken(tokenInput.trim());
                localStorage.setItem(LS_TOKEN, tokenInput.trim());

                // Đồng bộ System Token xuống cho Backend Scaling Ads
                fetch("/api/scaling/setup/system-token", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ accessToken: tokenInput.trim() }),
                }).catch(err => console.error("Could not sync token to backend:", err));

                // Auto-login vào Scaling backend → tab Auto Rule tự động nhận auth
                fetch("/api/scaling/auth/token-login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ accessToken: tokenInput.trim() }),
                }).then(r => r.json()).then(d => {
                    if (d.token) {
                        localStorage.setItem("scaling_token", d.token);
                        console.log("[AdsCommand] Auto-login scaling backend OK");
                    }
                }).catch(err => console.error("Auto-login scaling failed:", err));

                setStep("select_accounts");
            } else {
                setVerifyError(data.error || "Token invalid");
            }
        } catch (e: any) {
            setVerifyError(e.message || "Connection error");
        } finally {
            setVerifying(false);
        }
    }

    // Step 2: Load accounts from selected business
    async function loadAccounts(businessId?: string) {
        setLoadingAccounts(true);
        try {
            const res = await fetch("/api/meta", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "list_accounts",
                    access_token: token,
                    business_id: businessId === "me" ? undefined : businessId,
                }),
            });
            const data = await res.json();
            if (data.error) {
                setVerifyError(data.error);
            } else {
                setAvailableAccounts(data.accounts || []);
            }
        } catch (e: any) {
            setVerifyError(e.message);
        } finally {
            setLoadingAccounts(false);
        }
    }

    useEffect(() => {
        if (step === "select_accounts" && token) {
            // Auto-select first BM if not yet selected
            const biz = selectedBusiness || (businesses.length > 0 ? businesses[0].id : "me");
            if (!selectedBusiness && businesses.length > 0) {
                setSelectedBusiness(businesses[0].id);
            } else {
                loadAccounts(biz === "me" ? undefined : biz);
            }
        }
    }, [step, selectedBusiness]);

    function toggleAccountSelection(id: string) {
        setTempSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function handleSelectAll() {
        if (selectAll) {
            setTempSelected(new Set());
        } else {
            setTempSelected(new Set(availableAccounts.map((a) => a.id)));
        }
        setSelectAll(!selectAll);
    }

    function handleConnectAccounts() {
        const selected = availableAccounts.filter((a) => tempSelected.has(a.id));
        setConnectedAccounts(selected);
        localStorage.setItem(LS_ACCOUNTS, JSON.stringify(selected));

        // Đồng bộ danh sách accounts xuống cho Backend Scaling Ads
        fetch("/api/scaling/setup/accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accounts: selected }),
        }).catch(err => console.error("Could not sync accounts to backend:", err));

        setStep("dashboard");
    }

    // Step 3: Sync insights
    const handleSync = useCallback(async () => {
        if (connectedAccounts.length === 0) return;
        setSyncing(true);
        setSyncError("");
        try {
            const [res, posRes] = await Promise.all([
                fetch("/api/meta", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "fetch_insights",
                        access_token: token,
                        account_ids: connectedAccounts.map((a) => a.id),
                        since: dateRange.since,
                        until: dateRange.until,
                    }),
                }),
                fetch("/api/auus1/pos", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        since: dateRange.since,
                        until: dateRange.until,
                    }),
                }).catch(() => null)
            ]);
            
            const data = await res.json();
            const posData = posRes ? await posRes.json().catch(() => null) : null;
            console.log("POS Fetch Result:", posData);

            if (data.error) {
                setSyncError(data.error);
            } else {
                let mergedAccounts = data.accounts || [];
                if (posData && posData.posData) {
                    // Simple: map ad_id → order count from POS
                    const posByAdId = new Map<string, number>();
                    for (const p of posData.posData) {
                        if (p.ad_id) {
                            posByAdId.set(p.ad_id, (posByAdId.get(p.ad_id) || 0) + (p.orders || 0));
                        }
                    }
                    mergedAccounts = mergedAccounts.map((acct: any) => ({
                        ...acct,
                        rows: (acct.rows || []).map((r: any) => ({
                            ...r,
                            pos_purchases: posByAdId.get(r.ad_id) || 0
                        }))
                    }));
                }
                
                setInsights(mergedAccounts);
                const syncTime = new Date().toLocaleTimeString();
                setSyncedAt(syncTime);
                
                try {
                    sessionStorage.setItem("auus1_ads_insights", JSON.stringify(mergedAccounts));
                    sessionStorage.setItem("auus1_ads_synced_at", syncTime);
                } catch (err) {
                    console.warn("Could not save to sessionStorage:", err);
                }

                // Auto-save to BigQuery → CEO tab picks up new spend data
                try {
                    const bqRes = await fetch("/api/sync-bq", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            accounts: data.accounts,
                            since: dateRange.since,
                            until: dateRange.until,
                        }),
                    });
                    const bqData = await bqRes.json();
                    if (bqData.success) {
                        console.log(`✅ BQ sync: ${bqData.totalInserted} rows inserted, ${bqData.totalDeleted} deleted`);
                    } else {
                        console.warn("⚠️ BQ sync error:", bqData.error);
                    }
                } catch (bqErr) {
                    console.warn("⚠️ BQ sync failed:", bqErr);
                }
            }
        } catch (e: any) {
            setSyncError(e.message);
        } finally {
            setSyncing(false);
        }
    }, [connectedAccounts, token, dateRange]);

    async function handleLogout() {
        // Xoá DB bên backend scaling ads
        try {
            await fetch("/api/scaling/setup/clear", { method: "DELETE" });
            // Logout khỏi scaling backend
            const scalingToken = localStorage.getItem("scaling_token");
            if (scalingToken) {
                await fetch("/api/scaling/auth/logout", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${scalingToken}` },
                }).catch(() => {});
            }
        } catch (e) {
            console.error("Lỗi khi xoá database:", e);
        }

        localStorage.removeItem(LS_TOKEN);
        localStorage.removeItem(LS_ACCOUNTS);
        localStorage.removeItem("scaling_token");
        sessionStorage.removeItem("auus1_ads_insights");
        sessionStorage.removeItem("auus1_ads_synced_at");
        setToken("");
        setUser(null);
        setConnectedAccounts([]);
        setInsights([]);
        setStep("login");
        setTokenInput("");
    }

    function handleManageAccounts() {
        setTempSelected(new Set(connectedAccounts.map((a) => a.id)));
        setStep("select_accounts");
    }

    // Aggregation
    const visibleInsights = useMemo(() => {
        if (!hideZeroSpend) return insights;
        return insights.filter((a) => (a.total_spend || 0) > 0);
    }, [insights, hideZeroSpend]);

    const totalSpend = useMemo(() => visibleInsights.reduce((s, a) => s + (a.total_spend || 0), 0), [visibleInsights]);
    const totalImpressions = useMemo(() => visibleInsights.reduce((s, a) => s + (a.total_impressions || 0), 0), [visibleInsights]);
    const totalClicks = useMemo(() => visibleInsights.reduce((s, a) => s + (a.total_clicks || 0), 0), [visibleInsights]);
    const totalRows = useMemo(() => visibleInsights.reduce((s, a) => s + (a.rows?.length || 0), 0), [visibleInsights]);

    // ═══════════════════════════ RENDER ═══════════════════════════

    // ─── STEP 1: LOGIN ───
    if (step === "login") {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="w-full max-w-xl">
                    <div className="rounded-2xl border border-slate-700 bg-gradient-to-b from-[#1E293B] to-[#0F172A] p-8 shadow-2xl">
                        <div className="text-center mb-8">
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-lg shadow-blue-500/25 mb-4">
                                <Key className="h-8 w-8 text-white" />
                            </div>
                            <h2 className="text-2xl font-bold text-white">Connect Meta Ads</h2>
                            <p className="text-slate-400 mt-2 text-sm">
                                Nhập Access Token từ Meta Business để kết nối tài khoản quảng cáo
                            </p>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Meta Access Token
                                </label>
                                <textarea
                                    value={tokenInput}
                                    onChange={(e) => setTokenInput(e.target.value)}
                                    placeholder="EAAxxxxxxxx..."
                                    rows={3}
                                    className="w-full rounded-xl border border-slate-600 bg-slate-900/80 px-4 py-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none font-mono resize-none"
                                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleVerifyToken(); } }}
                                />
                            </div>

                            {verifyError && (
                                <div className="flex items-center gap-2 bg-rose-950/60 border border-rose-800 rounded-xl p-3 text-rose-300 text-sm">
                                    <AlertTriangle className="h-4 w-4 shrink-0" />
                                    {verifyError}
                                </div>
                            )}

                            <button
                                onClick={handleVerifyToken}
                                disabled={verifying || !tokenInput.trim()}
                                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-4 py-3 rounded-xl text-sm font-semibold shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {verifying ? (
                                    <><Loader2 className="h-4 w-4 animate-spin" /> Đang xác thực...</>
                                ) : (
                                    <><Plug2 className="h-4 w-4" /> Kết nối</>
                                )}
                            </button>

                            <div className="text-center">
                                <a
                                    href="https://business.facebook.com/settings/system-users"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2"
                                >
                                    Lấy token từ Meta Business Settings →
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ─── STEP 2: SELECT ACCOUNTS ───
    if (step === "select_accounts") {
        return (
            <div className="max-w-3xl mx-auto space-y-6">
                {/* Header */}
                <div className="rounded-2xl border border-slate-700 bg-gradient-to-b from-[#1E293B] to-[#0F172A] p-6 shadow-2xl">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-emerald-600/20 flex items-center justify-center">
                                <Check className="h-5 w-5 text-emerald-400" />
                            </div>
                            <div>
                                <div className="text-sm font-semibold text-white">Đã xác thực: {user?.name}</div>
                                <div className="text-xs text-slate-400">ID: {user?.id}</div>
                            </div>
                        </div>
                        <button onClick={handleLogout} className="text-slate-400 hover:text-rose-400 transition text-xs flex items-center gap-1">
                            <LogOut className="h-3 w-3" /> Đăng xuất
                        </button>
                    </div>

                    {/* Business selector */}
                    {businesses.length > 0 && (
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Business Manager</label>
                            <select
                                value={selectedBusiness}
                                onChange={(e) => setSelectedBusiness(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200"
                            >
                                <option value="me">👤 Tài khoản cá nhân</option>
                                {businesses.map((b) => (
                                    <option key={b.id} value={b.id}>🏢 {b.name} ({b.id})</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                {/* Account list */}
                <div className="rounded-2xl border border-slate-700 bg-[#1E293B] overflow-hidden shadow-2xl">
                    <div className="px-5 py-4 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <Layers className="h-4 w-4 text-blue-400" />
                            Tài khoản quảng cáo ({availableAccounts.length})
                        </h3>
                        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                            <input type="checkbox" checked={selectAll} onChange={handleSelectAll}
                                className="rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500" />
                            Chọn tất cả
                        </label>
                    </div>

                    {loadingAccounts ? (
                        <div className="flex items-center justify-center h-40 text-slate-400">
                            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Đang tải danh sách...
                        </div>
                    ) : availableAccounts.length === 0 ? (
                        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
                            Không tìm thấy tài khoản quảng cáo nào
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-700/50 max-h-[400px] overflow-y-auto">
                            {availableAccounts.map((acc) => {
                                const isSelected = tempSelected.has(acc.id);
                                const isActive = acc.status === "ACTIVE";
                                return (
                                    <button
                                        key={acc.id}
                                        onClick={() => toggleAccountSelection(acc.id)}
                                        className={`w-full flex items-center gap-4 px-5 py-3.5 text-left transition hover:bg-slate-700/40 ${isSelected ? "bg-blue-600/10" : ""}`}
                                    >
                                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition ${isSelected ? "bg-blue-600 border-blue-600" : "border-slate-600"}`}>
                                            {isSelected && <Check className="h-3 w-3 text-white" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-white truncate">{acc.name}</div>
                                            <div className="text-xs text-slate-400 font-mono">{acc.id}</div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider ${isActive ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>
                                                {acc.status}
                                            </span>
                                            <div className="text-xs text-slate-500 mt-0.5">{acc.currency}</div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    <div className="px-5 py-4 bg-slate-800 border-t border-slate-700 flex items-center justify-between">
                        <span className="text-xs text-slate-400">
                            Đã chọn: <b className="text-blue-400">{tempSelected.size}</b> tài khoản
                        </span>
                        <button
                            onClick={handleConnectAccounts}
                            disabled={tempSelected.size === 0}
                            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-5 py-2 rounded-lg text-sm font-semibold shadow-lg flex items-center gap-2 transition disabled:opacity-50"
                        >
                            <Plug2 className="h-4 w-4" /> Kết nối ({tempSelected.size})
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ─── STEP 3: DASHBOARD ───
    return (
        <div className="space-y-4">
            {/* ═══ TOOLBAR ═══ */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-[#1E293B] p-3">
                <div className="flex items-center gap-3">
                    {/* Connected accounts */}
                    <div className="flex items-center gap-2">
                        <Layers className="h-4 w-4 text-blue-400" />
                        <span className="text-sm text-slate-300">
                            {connectedAccounts.length} tài khoản
                        </span>
                        <button
                            onClick={handleManageAccounts}
                            className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2"
                        >
                            Quản lý
                        </button>
                    </div>

                    <div className="w-px h-6 bg-slate-600" />
                    
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer hover:text-white transition">
                        <input 
                            type="checkbox" 
                            checked={hideZeroSpend} 
                            onChange={(e) => setHideZeroSpend(e.target.checked)}
                            className="rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500"
                        />
                        Ẩn TK 0đ
                    </label>

                    <div className="w-px h-6 bg-slate-600" />

                    {/* Date Range — FB-style presets */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <CalendarDays className="h-4 w-4 text-slate-400 shrink-0" />
                        {[
                            { label: "Trọn đời", days: "lifetime" },
                            { label: "Hôm nay", days: 0 },
                            { label: "Hôm qua", days: -1 },
                            { label: "7 ngày", days: 6 },
                            { label: "14 ngày", days: 13 },
                            { label: "30 ngày", days: 29 },
                            { label: "Tháng này", days: "this_month" },
                            { label: "Tháng trước", days: "last_month" },
                        ].map((preset) => {
                            const getRange = () => {
                                const today = getPSTNow();
                                if (preset.days === "lifetime") {
                                    return { since: "2024-01-01", until: localDate(today) };
                                }
                                if (preset.days === "this_month") {
                                    const start = new Date(today.getFullYear(), today.getMonth(), 1);
                                    return { since: localDate(start), until: localDate(today) };
                                }
                                if (preset.days === "last_month") {
                                    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                                    const end = new Date(today.getFullYear(), today.getMonth(), 0);
                                    return { since: localDate(start), until: localDate(end) };
                                }
                                if (preset.days === -1) {
                                    const yd = new Date(today); yd.setDate(yd.getDate() - 1);
                                    return { since: localDate(yd), until: localDate(yd) };
                                }
                                if (preset.days === 0) {
                                    return { since: localDate(today), until: localDate(today) };
                                }
                                const start = new Date(today); start.setDate(start.getDate() - (preset.days as number));
                                return { since: localDate(start), until: localDate(today) };
                            };
                            const range = getRange();
                            const isActive = dateRange.since === range.since && dateRange.until === range.until;
                            return (
                                <button
                                    key={preset.label}
                                    onClick={() => setDateRange(range)}
                                    className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                                        isActive
                                            ? "bg-blue-600 border-blue-500 text-white"
                                            : "bg-slate-800 border-slate-600 text-slate-400 hover:border-blue-500 hover:text-blue-300"
                                    }`}
                                >
                                    {preset.label}
                                </button>
                            );
                        })}
                        <div className="w-px h-5 bg-slate-600" />
                        <input
                            type="date"
                            value={dateRange.since}
                            onChange={(e) => setDateRange((d) => ({ ...d, since: e.target.value }))}
                            className="bg-slate-900 border border-slate-600 rounded-md px-2 py-1 text-xs text-slate-300 focus:border-blue-500 focus:outline-none w-[120px]"
                        />
                        <span className="text-slate-500 text-xs">→</span>
                        <input
                            type="date"
                            value={dateRange.until}
                            onChange={(e) => setDateRange((d) => ({ ...d, until: e.target.value }))}
                            className="bg-slate-900 border border-slate-600 rounded-md px-2 py-1 text-xs text-slate-300 focus:border-blue-500 focus:outline-none w-[120px]"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {syncedAt && (
                        <div className="text-xs text-slate-400">
                            Synced: <span className="text-emerald-400 font-mono">{syncedAt}</span>
                        </div>
                    )}
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white px-5 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-indigo-500/20 border border-indigo-500/50 flex items-center gap-2 transition hover:scale-105 active:scale-95 disabled:opacity-50"
                    >
                        <RotateCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                        {syncing ? "Syncing..." : "SYNC"}
                    </button>
                    <button
                        onClick={handleLogout}
                        className="text-slate-400 hover:text-rose-400 transition p-2 rounded-lg hover:bg-slate-800"
                        title="Đăng xuất"
                    >
                        <LogOut className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* ═══ SYNC ERROR ═══ */}
            {syncError && (
                <div className="flex items-center gap-3 bg-rose-950/50 border border-rose-800 rounded-xl p-4 text-rose-300">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <div className="text-sm flex-1">{syncError}</div>
                    <button onClick={() => setSyncError("")} className="text-rose-400 hover:text-white"><X className="h-4 w-4" /></button>
                </div>
            )}

            {/* ═══ NO DATA YET ═══ */}
            {insights.length === 0 && !syncing && (
                <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-800/30 p-12 text-center">
                    <RotateCw className="h-12 w-12 text-slate-600 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-slate-300 mb-2">Chưa có dữ liệu</h3>
                    <p className="text-sm text-slate-500 mb-4">
                        Chọn khoảng thời gian và bấm <b className="text-indigo-400">SYNC</b> để tải dữ liệu từ Meta
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center text-xs text-slate-500">
                        {connectedAccounts.map((a) => (
                            <span key={a.id} className="bg-slate-700/50 px-2 py-1 rounded-lg font-mono">{a.name || a.id}</span>
                        ))}
                    </div>
                </div>
            )}

            {/* ═══ SYNCING STATE ═══ */}
            {syncing && insights.length === 0 && (
                <div className="flex items-center justify-center h-64 text-slate-400 animate-pulse">
                    <Loader2 className="h-8 w-8 animate-spin mr-3" />
                    Đang đồng bộ dữ liệu từ Meta...
                </div>
            )}

            {/* ═══ SUMMARY CARDS ═══ */}
            {insights.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <SummaryCard icon={DollarSign} label="Total Spend" value={formatVND(totalSpend)} color="text-blue-400" bgColor="from-blue-600/20 to-blue-800/10" />
                    <SummaryCard icon={Eye} label="Impressions" value={totalImpressions.toLocaleString()} color="text-purple-400" bgColor="from-purple-600/20 to-purple-800/10" />
                    <SummaryCard icon={MousePointerClick} label="Clicks" value={totalClicks.toLocaleString()} color="text-emerald-400" bgColor="from-emerald-600/20 to-emerald-800/10" />
                    <SummaryCard icon={TrendingUp} label="CTR" value={totalImpressions > 0 ? `${((totalClicks / totalImpressions) * 100).toFixed(2)}%` : "—"} color="text-amber-400" bgColor="from-amber-600/20 to-amber-800/10" />
                </div>
            )}

            {/* ═══ ACCOUNT DATA ═══ */}
            {visibleInsights.map((acct) => {
                const connInfo = connectedAccounts.find((c) => c.id === acct.account_id || c.id === `act_${acct.account_id}`);
                const isExpanded = expandedAccount === acct.account_id || visibleInsights.length === 1;

                // Group by campaign
                const campaignMap = new Map<string, { name: string; spend: number; impressions: number; clicks: number; messages: number; purchases: number; pos_purchases: number; rows: number }>();
                for (const r of acct.rows || []) {
                    const key = r.campaign_id || r.campaign_name;
                    const prev = campaignMap.get(key) || { name: r.campaign_name, spend: 0, impressions: 0, clicks: 0, messages: 0, purchases: 0, pos_purchases: 0, rows: 0 };
                    prev.spend += r.spend;
                    prev.impressions += r.impressions;
                    prev.clicks += r.clicks;
                    prev.messages += r.messages;
                    prev.purchases += r.purchases;
                    prev.pos_purchases += (r.pos_purchases || 0);
                    prev.rows += 1;
                    campaignMap.set(key, prev);
                }
                const campaigns = Array.from(campaignMap.values()).sort((a, b) => b.spend - a.spend);

                return (
                    <div key={acct.account_id} className="rounded-xl border border-slate-700 bg-[#1E293B] overflow-hidden shadow-2xl">
                        {/* Account header */}
                        <button
                            onClick={() => setExpandedAccount(expandedAccount === acct.account_id ? null : acct.account_id)}
                            className="w-full px-5 py-3.5 bg-slate-800 border-b border-slate-700 flex items-center justify-between hover:bg-slate-750 transition"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-2 h-8 bg-blue-500 rounded-full" />
                                <div className="text-left">
                                    <h2 className="text-sm font-bold text-white">{connInfo?.name || acct.account_id}</h2>
                                    <div className="text-xs text-slate-400 font-mono">
                                        {acct.account_id} • {connInfo?.currency || "VND"} • {campaigns.length} campaigns
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-6 text-xs text-slate-400">
                                {acct.error ? (
                                    <span className="text-rose-400">❌ {acct.error.substring(0, 40)}</span>
                                ) : (
                                    <>
                                        <span>Spend: <b className="text-blue-400">{formatVND(acct.total_spend || 0)}</b></span>
                                        <span>Clicks: <b className="text-emerald-400">{(acct.total_clicks || 0).toLocaleString()}</b></span>
                                    </>
                                )}
                                <ChevronDown className={`h-4 w-4 transition ${isExpanded ? "rotate-180" : ""}`} />
                            </div>
                        </button>

                        {/* Campaign table */}
                        {isExpanded && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-xs text-slate-400 border-b border-slate-700">
                                            <th className="text-left px-4 py-2.5 font-medium">Campaign</th>
                                            <th className="text-right px-3 py-2.5 font-medium">Spend</th>
                                            <th className="text-right px-3 py-2.5 font-medium">Impr.</th>
                                            <th className="text-right px-3 py-2.5 font-medium">Clicks</th>
                                            <th className="text-right px-3 py-2.5 font-medium">CTR</th>
                                            <th className="text-right px-3 py-2.5 font-medium">CPM</th>
                                            <th className="text-right px-3 py-2.5 font-medium">Msgs</th>
                                            <th className="text-right px-3 py-2.5 font-medium">Purchases</th>
                                            <th className="text-right px-3 py-2.5 font-medium border-l border-slate-700" title="Purchase on POS (Realized Sales)">POS Purchases</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700/50">
                                        {campaigns.map((c, i) => (
                                            <tr key={i} className="hover:bg-slate-700/30 transition">
                                                <td className="px-4 py-2.5 text-slate-200 max-w-[300px] truncate">{c.name}</td>
                                                <td className="px-3 py-2.5 text-right font-mono text-blue-400">{formatVND(c.spend)}</td>
                                                <td className="px-3 py-2.5 text-right text-slate-300">{c.impressions.toLocaleString()}</td>
                                                <td className="px-3 py-2.5 text-right text-emerald-400">{c.clicks.toLocaleString()}</td>
                                                <td className="px-3 py-2.5 text-right text-slate-300">
                                                    {c.impressions > 0 ? `${((c.clicks / c.impressions) * 100).toFixed(2)}%` : "—"}
                                                </td>
                                                <td className="px-3 py-2.5 text-right text-slate-300">
                                                    {c.impressions > 0 ? formatVND((c.spend / c.impressions) * 1000) : "—"}
                                                </td>
                                                <td className="px-3 py-2.5 text-right text-purple-400">{c.messages || "—"}</td>
                                                <td className="px-3 py-2.5 text-right text-amber-400">{c.purchases || "—"}</td>
                                                <td className="px-3 py-2.5 text-right text-green-400 font-bold border-l border-slate-700/50 bg-slate-800/30">{c.pos_purchases || "—"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="border-t border-slate-600 bg-slate-800/50 font-semibold">
                                            <td className="px-4 py-2.5 text-slate-200">TOTAL ({campaigns.length})</td>
                                            <td className="px-3 py-2.5 text-right font-mono text-blue-400">{formatVND(acct.total_spend || 0)}</td>
                                            <td className="px-3 py-2.5 text-right text-slate-300">{(acct.total_impressions || 0).toLocaleString()}</td>
                                            <td className="px-3 py-2.5 text-right text-emerald-400">{(acct.total_clicks || 0).toLocaleString()}</td>
                                            <td className="px-3 py-2.5 text-right text-slate-300">
                                                {(acct.total_impressions || 0) > 0 ? `${(((acct.total_clicks || 0) / acct.total_impressions!) * 100).toFixed(2)}%` : "—"}
                                            </td>
                                            <td colSpan={2} />
                                            <td className="px-3 py-2.5 text-right text-amber-400 font-medium">
                                                {campaigns.reduce((s, c) => s + (c.purchases || 0), 0) || "—"}
                                            </td>
                                            <td className="px-3 py-2.5 text-right text-green-400 font-bold border-l border-slate-700 bg-slate-800/50">
                                                {campaigns.reduce((s, c) => s + (c.pos_purchases || 0), 0) || "—"}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Summary Card Component ───
function SummaryCard({ icon: Icon, label, value, color, bgColor }: {
    icon: any; label: string; value: string; color: string; bgColor: string;
}) {
    return (
        <div className={`rounded-xl border border-slate-700 bg-gradient-to-br ${bgColor} p-4 shadow-lg`}>
            <div className="flex items-center gap-2 mb-1">
                <Icon className={`h-4 w-4 ${color}`} />
                <span className="text-xs text-slate-400 font-medium">{label}</span>
            </div>
            <div className={`text-xl font-bold ${color}`}>{value}</div>
        </div>
    );
}
