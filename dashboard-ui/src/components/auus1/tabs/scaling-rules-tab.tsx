"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Zap, Plus, Trash2, Power, PowerOff, History,
    ChevronDown, ChevronRight, AlertTriangle, CheckCircle2,
    XCircle, Clock, Settings2, Play, Pause, Brain
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───
interface Rule {
    id: string;
    name: string;
    entityType: string;
    conditions: any[];
    actions: { action: string; value?: number };
    frequency: number;
    isActive: boolean;
    campaignIds: string[];
    _count?: { logs: number };
    createdAt: string;
}

interface ExecutionLog {
    id: string;
    ruleId: string;
    targetId: string;
    actionTaken: string;
    status: string;
    details: any;
    createdAt: string;
    rule?: { name: string };
}

// ─── Constants ───
const SCALING_API = "/api/scaling";

const METRICS = [
    { value: "spend", label: "Spend (VND)", unit: "₫" },
    { value: "ctr", label: "CTR (%)", unit: "%" },
    { value: "roas", label: "ROAS", unit: "x" },
    { value: "purchases", label: "Purchases", unit: "" },
    { value: "impressions", label: "Impressions", unit: "" },
    { value: "clicks", label: "Clicks", unit: "" },
    { value: "true_profit", label: "True Profit (VND)", unit: "₫" },
    { value: "cost_per_message", label: "Cost/Message (VND)", unit: "₫" },
];

const ACTIONS = [
    { value: "pause", label: "⏸ Tắt quảng cáo", hasValue: false },
    { value: "enable", label: "▶ Bật quảng cáo", hasValue: false },
    { value: "increase_budget", label: "📈 Tăng budget (%)", hasValue: true },
    { value: "decrease_budget", label: "📉 Giảm budget (%)", hasValue: true },
    { value: "duplicate", label: "📋 Duplicate", hasValue: false },
];

const OPERATORS = [">", "<", ">=", "<=", "="];

const RULE_TEMPLATES = [
    {
        name: "🔴 Kill ads — Spend > 500k, 0 purchase",
        icon: "🔴",
        entityType: "CAMPAIGN",
        conditionGroups: [[{ metric: "spend", op: ">", val: 500000 }, { metric: "purchases", op: "=", val: 0 }]],
        actions: { action: "pause", value: 0 },
        frequency: 30,
    },
    {
        name: "🔴 Kill ads — Cost/Message > 200k",
        icon: "🔴",
        entityType: "AD",
        conditionGroups: [[{ metric: "cost_per_message", op: ">", val: 200000 }]],
        actions: { action: "pause", value: 0 },
        frequency: 30,
    },
    {
        name: "🟢 Scale winner — ROAS > 2, Purchase > 3",
        icon: "🟢",
        entityType: "CAMPAIGN",
        conditionGroups: [[{ metric: "roas", op: ">", val: 2 }, { metric: "purchases", op: ">", val: 3 }]],
        actions: { action: "increase_budget", value: 20 },
        frequency: 60,
    },
    {
        name: "🟡 CPA Guard — Spend > 300k, 0 purchase HOẶC CTR < 1%",
        icon: "🟡",
        entityType: "AD",
        conditionGroups: [
            [{ metric: "spend", op: ">", val: 300000 }, { metric: "purchases", op: "=", val: 0 }],
            [{ metric: "ctr", op: "<", val: 1 }, { metric: "spend", op: ">", val: 200000 }],
        ],
        actions: { action: "pause", value: 0 },
        frequency: 30,
    },
    {
        name: "🟢 Boost — True Profit > 500k",
        icon: "🟢",
        entityType: "CAMPAIGN",
        conditionGroups: [[{ metric: "true_profit", op: ">", val: 500000 }]],
        actions: { action: "increase_budget", value: 15 },
        frequency: 120,
    },
    {
        name: "🔴 Giảm budget — ROAS < 0.5, Spend > 200k",
        icon: "🔴",
        entityType: "CAMPAIGN",
        conditionGroups: [[{ metric: "roas", op: "<", val: 0.5 }, { metric: "spend", op: ">", val: 200000 }]],
        actions: { action: "decrease_budget", value: 30 },
        frequency: 60,
    },
    {
        name: "🔄 Tự bật lại — ROAS > 1.5, Purchase > 1",
        icon: "🔄",
        entityType: "CAMPAIGN",
        conditionGroups: [[{ metric: "roas", op: ">", val: 1.5 }, { metric: "purchases", op: ">", val: 1 }]],
        actions: { action: "enable", value: 0 },
        frequency: 60,
    },
    {
        name: "🔄 Tự bật lại — Cost/Message < 50k",
        icon: "🔄",
        entityType: "AD",
        conditionGroups: [[{ metric: "cost_per_message", op: "<", val: 50000 }]],
        actions: { action: "enable", value: 0 },
        frequency: 30,
    },
];

const ENTITY_TYPES = [
    { value: "CAMPAIGN", label: "Campaign" },
    { value: "ADSET", label: "Ad Set" },
    { value: "AD", label: "Ad" },
];

const FREQUENCIES = [
    { value: 5, label: "5 phút" },
    { value: 15, label: "15 phút" },
    { value: 30, label: "30 phút" },
    { value: 60, label: "1 giờ" },
    { value: 120, label: "2 giờ" },
    { value: 360, label: "6 giờ" },
    { value: 720, label: "12 giờ" },
    { value: 1440, label: "24 giờ" },
];

// ─── Scaling API helper ───
let authToken = "";

async function scalingFetch(path: string, options?: RequestInit) {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

    const res = await fetch(`${SCALING_API}/${path}`, {
        ...options,
        headers: { ...headers, ...(options?.headers || {}) },
    });
    return res.json();
}

// ─── Main Component ───
export default function ScalingRulesTab() {
    const [view, setView] = useState<"rules" | "logs" | "broadcast" | "advisor" | "login">("login");
    const [advisorData, setAdvisorData] = useState<any[]>([]);
    const [analyzing, setAnalyzing] = useState(false);
    const [rules, setRules] = useState<Rule[]>([]);
    const [logs, setLogs] = useState<ExecutionLog[]>([]);
    const [broadcasts, setBroadcasts] = useState<any[]>([]);
    const [fanpages, setFanpages] = useState<any[]>([]);
    const [allCampaigns, setAllCampaigns] = useState<any[]>([]);
    const [campaignSearch, setCampaignSearch] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // Login state
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loginError, setLoginError] = useState("");

    // Create rule state
    const [showCreate, setShowCreate] = useState(false);
    const [telegramChatId, setTelegramChatId] = useState("");
    const [telegramSaving, setTelegramSaving] = useState(false);
    
    const [systemToken, setSystemToken] = useState("");
    const [systemTokenSaving, setSystemTokenSaving] = useState(false);
    const [hasSystemToken, setHasSystemToken] = useState(false);

    const [newRule, setNewRule] = useState({
        name: "",
        entityType: "CAMPAIGN",
        conditionGroups: [[{ metric: "spend", op: ">", val: 0 }]] as { metric: string; op: string; val: number }[][],
        actions: { action: "pause", value: 20 },
        frequency: 30,
        campaignIds: [] as string[],
    });

    // Check stored token on mount
    useEffect(() => {
        const stored = localStorage.getItem("scaling_token");
        if (stored) {
            authToken = stored;
            setView("rules");
            loadRules();
        }
    }, []);

    // ─── Auth ───
    async function handleLogin() {
        setLoginError("");
        try {
            const data = await scalingFetch("auth/login", {
                method: "POST",
                body: JSON.stringify({ email, password }),
            });
            if (data.token) {
                authToken = data.token;
                localStorage.setItem("scaling_token", data.token);
                setView("rules");
                loadRules();
            } else {
                setLoginError(data.error || "Đăng nhập thất bại");
            }
        } catch (e: any) {
            setLoginError("Không thể kết nối Scaling API. Kiểm tra server đang chạy.");
        }
    }

    async function handleRegister() {
        setLoginError("");
        try {
            const data = await scalingFetch("auth/register", {
                method: "POST",
                body: JSON.stringify({ email, password, name: "AUUS1 Admin" }),
            });
            if (data.token) {
                authToken = data.token;
                localStorage.setItem("scaling_token", data.token);
                setView("rules");
                loadRules();
            } else {
                setLoginError(data.error || "Đăng ký thất bại");
            }
        } catch (e: any) {
            setLoginError("Không thể kết nối Scaling API.");
        }
    }

    // ─── Data Loading ───
    const loadProfile = useCallback(async () => {
        try {
            const data = await scalingFetch("auth/me");
            if (data?.user?.telegramChatId) {
                setTelegramChatId(data.user.telegramChatId);
            }
        } catch (e) {
            console.error(e);
        }
    }, []);

    const loadRules = useCallback(async () => {
        setLoading(true);
        try {
            const data = await scalingFetch("rules");
            setRules(data.rules || []);

            // Ưu tiên lấy campaigns từ Meta API trực tiếp (nhanh, không cần sync)
            const metaToken = localStorage.getItem("auus1_meta_token");
            const savedAccounts = localStorage.getItem("auus1_connected_accounts");
            let campaigns: any[] = [];

            if (metaToken && savedAccounts) {
                try {
                    const accounts = JSON.parse(savedAccounts);
                    for (const acc of accounts) {
                        const res = await fetch("/api/meta", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                action: "get_campaigns",
                                access_token: metaToken,
                                account_id: acc.id,
                            }),
                        });
                        const campData = await res.json();
                        if (campData.campaigns) {
                            campaigns.push(...campData.campaigns.map((c: any) => ({
                                id: c.id,
                                fbCampaignId: c.id,
                                name: c.name,
                                status: c.status || c.effective_status,
                            })));
                        }
                    }
                } catch (e) {
                    console.error("Lỗi khi lấy campaigns từ Meta:", e);
                }
            }

            // Fallback: lấy từ scaling DB nếu Meta không có
            if (campaigns.length === 0) {
                try {
                    const campData = await scalingFetch("campaigns");
                    campaigns = campData.campaigns || [];
                } catch (e) {}
            }

            setAllCampaigns(campaigns);
            setError("");
            loadProfile();
        } catch (e: any) {
            setError("Không thể load rules");
        } finally {
            setLoading(false);
        }
    }, [loadProfile]);

    const loadLogs = useCallback(async () => {
        setLoading(true);
        try {
            const data = await scalingFetch("rules/logs");
            setLogs(data.logs || []);
            setError("");
        } catch (e: any) {
            setError("Không thể load logs");
        } finally {
            setLoading(false);
        }
    }, []);

    const loadBroadcasts = useCallback(async () => {
        setLoading(true);
        try {
            const bData = await scalingFetch("broadcasts");
            setBroadcasts(bData || []);
            const pData = await scalingFetch("fanpages");
            setFanpages(pData?.fanpages || []);
            setError("");
        } catch (e: any) {
            setError("Không thể load broadcasts");
        } finally {
            setLoading(false);
        }
    }, []);

    // ─── Rule CRUD ───
    async function createRule() {
        if (!newRule.name.trim()) return;
        try {
            // Backend expects: flat array = AND only, nested array = OR groups
            const conditions = newRule.conditionGroups.length === 1
                ? newRule.conditionGroups[0]  // 1 group → flat (AND only)
                : newRule.conditionGroups;     // multiple groups → nested (OR)

            await scalingFetch("rules", {
                method: "POST",
                body: JSON.stringify({
                    ...newRule,
                    conditions,
                    conditionGroups: undefined,
                }),
            });
            setShowCreate(false);
            setNewRule({
                name: "",
                entityType: "CAMPAIGN",
                conditionGroups: [[{ metric: "spend", op: ">", val: 0 }]],
                actions: { action: "pause", value: 20 },
                frequency: 30,
                campaignIds: [],
            });
            loadRules();
        } catch (e: any) {
            setError("Tạo rule thất bại");
        }
    }

    async function toggleRule(id: string, isActive: boolean) {
        await scalingFetch(`rules/${id}/toggle`, {
            method: "PATCH",
            body: JSON.stringify({ isActive: !isActive }),
        });
        loadRules();
    }

    async function deleteRule(id: string) {
        if (!confirm("Xóa rule này?")) return;
        await scalingFetch(`rules/${id}`, { method: "DELETE" });
        loadRules();
    }

    async function analyzeCampaigns() {
        setAnalyzing(true);
        setError("");
        try {
            const res = await fetch("/api/scaling/ai-advisor", { method: "POST" });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setAdvisorData(data.recommendations || []);
        } catch(e: any) {
            setError(e.message || "Lỗi AI Phân tích");
        } finally {
            setAnalyzing(false);
        }
    }

    async function applyAction(campaignId: string, action: string, value?: number) {
        if (!confirm(`Xác nhận thực thi: ${action}?`)) return;
        try {
            const metaToken = localStorage.getItem("auus1_meta_token");
            if (!metaToken) {
                alert("Thiếu Meta Token! Qua tab Ads Settings để thiết lập.");
                return;
            }
            alert(`Sẽ gọi gửi lệnh ${action} cho Camp ${campaignId} vào bảng xếp hàng xử lý Meta API. Tính năng đang làm.`);
        } catch(e: any) {
            alert("Lỗi thực thi: " + e.message);
        }
    }

    async function saveTelegram() {
        if (!telegramChatId.trim()) {
            alert("Vui lòng nhập Chat ID!");
            return;
        }
        setTelegramSaving(true);
        try {
            const res = await scalingFetch("auth/profile", {
                method: "PUT",
                body: JSON.stringify({ telegramChatId }),
            });
            console.log("[Telegram] Save result:", res);
            alert("✅ Đã lưu Telegram Chat ID thành công!");
        } catch (e: any) {
            console.error("[Telegram] Save error:", e);
            alert("❌ Lưu thất bại: " + (e?.message || "Không thể kết nối server"));
            setError("Lưu Telegram ID thất bại");
        } finally {
            setTelegramSaving(false);
        }
    }

    // ─── Render: Login ───
    if (view === "login") {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-gradient-to-b from-slate-800 to-slate-900 p-8 shadow-2xl">
                    <div className="text-center mb-6">
                        <Zap className="h-12 w-12 text-amber-400 mx-auto mb-3" />
                        <h2 className="text-2xl font-bold text-white">Scaling Ads Engine</h2>
                        <p className="text-sm text-slate-400 mt-1">Đăng nhập để quản lý Auto Rules</p>
                    </div>

                    {loginError && (
                        <div className="mb-4 rounded-lg bg-rose-500/15 border border-rose-500/30 px-4 py-2 text-sm text-rose-400">
                            {loginError}
                        </div>
                    )}

                    <div className="space-y-4">
                        <input
                            type="email"
                            placeholder="Email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full rounded-lg bg-slate-700/50 border border-slate-600 px-4 py-3 text-white placeholder-slate-400 outline-none focus:border-amber-500 transition"
                        />
                        <input
                            type="password"
                            placeholder="Mật khẩu"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                            className="w-full rounded-lg bg-slate-700/50 border border-slate-600 px-4 py-3 text-white placeholder-slate-400 outline-none focus:border-amber-500 transition"
                        />
                        <button
                            onClick={handleLogin}
                            className="w-full rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 py-3 text-sm font-bold text-white hover:from-amber-400 hover:to-orange-400 transition shadow-lg"
                        >
                            Đăng nhập
                        </button>
                        <button
                            onClick={handleRegister}
                            className="w-full rounded-lg border border-slate-600 py-3 text-sm font-medium text-slate-300 hover:bg-slate-700/50 transition"
                        >
                            Tạo tài khoản mới
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ─── Render: Dashboard ───
    return (
        <div className="space-y-4">
            {/* Header Bar */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => { setView("rules"); loadRules(); }}
                        className={cn(
                            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition",
                            view === "rules"
                                ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                : "text-slate-400 hover:text-white hover:bg-slate-800"
                        )}
                    >
                        <Settings2 className="h-4 w-4" />
                        Rules ({rules.length})
                    </button>
                    <button
                        onClick={() => { setView("logs"); loadLogs(); }}
                        className={cn(
                            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition",
                            view === "logs"
                                ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                                : "text-slate-400 hover:text-white hover:bg-slate-800"
                        )}
                    >
                        <History className="h-4 w-4" />
                        Execution Logs
                    </button>
                    <button
                        onClick={() => { setView("broadcast"); loadBroadcasts(); }}
                        className={cn(
                            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition",
                            view === "broadcast"
                                ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                                : "text-slate-400 hover:text-white hover:bg-slate-800"
                        )}
                    >
                        <Zap className="h-4 w-4" />
                        Broadcast
                    </button>
                    <button
                        onClick={() => { setView("advisor"); analyzeCampaigns(); }}
                        className={cn(
                            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition",
                            view === "advisor"
                                ? "bg-pink-500/15 text-pink-400 border border-pink-500/30 font-bold"
                                : "text-slate-400 hover:text-white hover:bg-slate-800"
                        )}
                    >
                        <Brain className="h-4 w-4" />
                        AI Advisor
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    {view === "rules" && (
                        <button
                            onClick={() => setShowCreate(!showCreate)}
                            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-bold text-white hover:from-emerald-400 hover:to-teal-400 transition shadow-lg"
                        >
                            <Plus className="h-4 w-4" />
                            Tạo Rule Mới
                        </button>
                    )}
                </div>
            </div>

            {/* Telegram Notification Banner */}
            {view === "rules" && (
                <div className="flex items-center gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
                    <div className="flex bg-blue-500/20 p-2 rounded-lg">
                        <Zap className="h-5 w-5 text-blue-400" />
                    </div>
                    <div className="flex-1">
                        <h4 className="text-sm font-semibold text-blue-400">Nhận thông báo qua Telegram</h4>
                        <p className="text-xs text-slate-400">Điền Chat ID của bạn để nhận tin nhắn mỗi khi Rule tắt quảng cáo hoặc tăng ngân sách.</p>
                    </div>
                    <input
                        placeholder="VD: 123456789"
                        value={telegramChatId}
                        onChange={(e) => setTelegramChatId(e.target.value)}
                        className="rounded-lg bg-slate-800 border border-slate-600 px-3 py-1.5 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500 w-40"
                    />
                    <button
                        onClick={saveTelegram}
                        disabled={telegramSaving}
                        className="rounded-lg bg-blue-500 px-4 py-1.5 text-sm font-bold text-white hover:bg-blue-400 transition"
                    >
                        {telegramSaving ? "⏳" : "Lưu"}
                    </button>
                    {(!telegramChatId) && (
                        <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 hover:text-white underline ml-2">
                            Lấy Chat ID ở đâu?
                        </a>
                    )}
                </div>
            )}



            {error && (
                <div className="rounded-lg bg-rose-500/15 border border-rose-500/30 px-4 py-2 text-sm text-rose-400">
                    {error}
                </div>
            )}

            {/* Create Rule Form */}
            {view === "rules" && showCreate && (
                <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Zap className="h-5 w-5 text-amber-400" />
                            Tạo Auto Rule mới
                        </h3>
                        <button 
                            onClick={async () => {
                                setLoading(true);
                                try {
                                    const res = await fetch("/api/scaling/campaigns/sync", {
                                        method: "POST",
                                        headers: {
                                            "Content-Type": "application/json",
                                            "Authorization": `Bearer ${authToken}`
                                        }
                                    });
                                    const data = await res.json();
                                    if (!res.ok) {
                                        setError(data.error || "Khoan đã sếp ơi! Sếp phải qua tab 'Ads Command Center' bấm chọn Account xong nhấn nút SYNC một lần để kết nối tài khoản với máy chủ này trước nhé!");
                                    } else {
                                        setError("");
                                        await loadRules();
                                    }
                                } catch (e) {
                                    setError("Lỗi kết nối máy chủ");
                                    console.error(e);
                                }
                                setLoading(false);
                            }}
                            className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-3 py-1.5 rounded flex items-center gap-2 transition"
                        >
                            <svg className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Refresh list Campaign
                        </button>
                    </div>

                    {/* Quick Templates */}
                    <div>
                        <label className="text-xs text-slate-400 mb-2 block">⚡ Chọn mẫu có sẵn</label>
                        <div className="grid grid-cols-2 gap-2">
                            {RULE_TEMPLATES.map((t, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setNewRule({
                                        ...newRule,
                                        name: t.name,
                                        entityType: t.entityType,
                                        conditionGroups: t.conditionGroups,
                                        actions: t.actions,
                                        frequency: t.frequency,
                                    })}
                                    className="text-left p-2.5 rounded-lg border border-slate-700 hover:border-amber-500/50 hover:bg-amber-500/5 transition-all text-xs group"
                                >
                                    <div className="text-slate-300 font-medium group-hover:text-white truncate">{t.name}</div>
                                    <div className="text-slate-500 text-[10px] mt-0.5">
                                        {t.entityType} · {ACTIONS.find(a => a.value === t.actions.action)?.label}
                                        {t.actions.value ? ` ${t.actions.value}%` : ''} · {FREQUENCIES.find(f => f.value === t.frequency)?.label}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-3 my-1">
                        <div className="flex-1 border-t border-slate-700" />
                        <span className="text-[10px] text-slate-500">hoặc tạo thủ công</span>
                        <div className="flex-1 border-t border-slate-700" />
                    </div>

                    {/* Rule name */}
                    <div>
                        <label className="text-xs text-slate-400 mb-1 block">Tên Rule</label>
                        <input
                            value={newRule.name}
                            onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                            placeholder="VD: Tắt ads khi spend > 500k mà không có purchase"
                            className="w-full rounded-lg bg-slate-700/50 border border-slate-600 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500"
                        />
                    </div>

                    {/* Specific Campaigns Select */}
                    <div className="relative overflow-visible">
                        <div className="flex justify-between items-end mb-1">
                            <label className="text-xs text-slate-400 block">Áp dụng cho Campaigns cụ thể</label>
                            {newRule.campaignIds.length === 0 ? (
                                <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded font-medium">Tất cả Campaigns</span>
                            ) : (
                                <button onClick={() => setNewRule({ ...newRule, campaignIds: [] })} className="text-[10px] text-rose-400 hover:text-white underline">Clear tất cả</button>
                            )}
                        </div>
                        {newRule.campaignIds.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2 p-2 bg-slate-800/50 rounded-lg max-h-32 overflow-y-auto border border-slate-700">
                                {newRule.campaignIds.map((id) => {
                                    const c = allCampaigns.find(camp => camp.id === id || camp.fbCampaignId === id);
                                    return (
                                        <div key={id} className="flex items-center gap-1 bg-amber-500/20 text-amber-300 px-2 py-1 rounded text-xs border border-amber-500/30 max-w-full">
                                            <span className="truncate max-w-[200px]" title={c?.name || id}>{c?.name || id}</span>
                                            <button onClick={() => setNewRule({ ...newRule, campaignIds: newRule.campaignIds.filter(x => x !== id) })} className="hover:text-rose-400 ml-1">
                                                <XCircle className="h-3 w-3" />
                                            </button>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                        <input
                            placeholder="Gõ để tìm kiếm..."
                            value={campaignSearch}
                            onChange={(e) => setCampaignSearch(e.target.value)}
                            className="w-full rounded-lg bg-slate-700/50 border border-slate-600 px-4 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500"
                        />
                        {campaignSearch.trim() !== "" && (
                            <>
                            {/* Backdrop overlay — click bên ngoài để đóng dropdown */}
                            <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setCampaignSearch("")} />
                            <div className="absolute mt-1 left-0 right-0 max-h-60 overflow-y-auto overflow-x-hidden rounded-lg border border-slate-600 shadow-2xl" style={{ zIndex: 9999, backgroundColor: '#1e293b' }}>
                                {allCampaigns
                                    .filter(c => c.name.toLowerCase().includes(campaignSearch.toLowerCase()) || String(c.fbCampaignId || c.id).includes(campaignSearch))
                                    .slice(0, 20)
                                    .map(c => {
                                        const cId = c.fbCampaignId || c.id;
                                        const isSelected = newRule.campaignIds.includes(cId);
                                        return (
                                            <button
                                                key={cId}
                                                onClick={() => {
                                                    if (isSelected) {
                                                        setNewRule({ ...newRule, campaignIds: newRule.campaignIds.filter(x => x !== cId) });
                                                    } else {
                                                        setNewRule({ ...newRule, campaignIds: [...newRule.campaignIds, cId] });
                                                    }
                                                }}
                                                className="w-full text-left px-4 py-2 text-sm hover:bg-slate-700 flex items-center justify-between transition overflow-hidden"
                                            >
                                                <div className="flex-1 min-w-0 pr-2">
                                                    <div className="text-slate-300 truncate font-medium text-xs">{c.name}</div>
                                                    <div className="text-slate-500 text-[10px] truncate">ID: {cId}</div>
                                                </div>
                                                <div className="shrink-0 ml-2">
                                                    {isSelected ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <span className="text-[10px] text-slate-500 uppercase">{c.status}</span>}
                                                </div>
                                            </button>
                                        )
                                    })}
                                {allCampaigns.filter(c => c.name.toLowerCase().includes(campaignSearch.toLowerCase()) || String(c.fbCampaignId || c.id).includes(campaignSearch)).length === 0 && (
                                    <div className="p-4 text-center text-sm text-slate-500">Không tìm thấy campaign nào.</div>
                                )}
                                {/* Nút đóng dropdown */}
                                <button
                                    onClick={() => setCampaignSearch("")}
                                    className="w-full px-4 py-2 text-xs text-center text-amber-400 hover:bg-slate-700 border-t border-slate-600 font-medium"
                                >
                                    ✓ Xong — Đóng danh sách
                                </button>
                            </div>
                            </>
                        )}
                    </div>

                    {/* Entity type + frequency */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-slate-400 mb-1 block">Áp dụng cho</label>
                            <select
                                value={newRule.entityType}
                                onChange={(e) => setNewRule({ ...newRule, entityType: e.target.value })}
                                className="w-full rounded-lg bg-slate-700/50 border border-slate-600 px-4 py-2.5 text-sm text-white outline-none"
                            >
                                {ENTITY_TYPES.map((t) => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 mb-1 block">Tần suất kiểm tra</label>
                            <select
                                value={newRule.frequency}
                                onChange={(e) => setNewRule({ ...newRule, frequency: Number(e.target.value) })}
                                className="w-full rounded-lg bg-slate-700/50 border border-slate-600 px-4 py-2.5 text-sm text-white outline-none"
                            >
                                {FREQUENCIES.map((f) => (
                                    <option key={f.value} value={f.value}>{f.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Conditions — OR groups */}
                    <div>
                        <label className="text-xs text-slate-400 mb-2 block">Điều kiện kích hoạt</label>
                        {newRule.conditionGroups.map((group, gIdx) => (
                            <div key={gIdx}>
                                {gIdx > 0 && (
                                    <div className="flex items-center gap-3 my-3">
                                        <div className="flex-1 border-t border-dashed border-amber-500/40" />
                                        <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full">HOẶC</span>
                                        <div className="flex-1 border-t border-dashed border-amber-500/40" />
                                        <button onClick={() => {
                                            const g = newRule.conditionGroups.filter((_, i) => i !== gIdx);
                                            setNewRule({ ...newRule, conditionGroups: g });
                                        }} className="text-rose-400 hover:text-rose-300 text-[10px]">Xoá nhóm</button>
                                    </div>
                                )}
                                <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50">
                                    {gIdx === 0 && <div className="text-[10px] text-slate-500 mb-2">Tất cả điều kiện trong nhóm phải đúng (VÀ)</div>}
                                    {group.map((cond, cIdx) => (
                                        <div key={cIdx} className="flex items-center gap-2 mb-2">
                                            {cIdx > 0 && <span className="text-[10px] text-slate-500 w-6 text-center shrink-0">VÀ</span>}
                                            {cIdx === 0 && <span className="w-6 shrink-0" />}
                                            <select
                                                value={cond.metric}
                                                onChange={(e) => {
                                                    const g = [...newRule.conditionGroups];
                                                    g[gIdx] = [...g[gIdx]];
                                                    g[gIdx][cIdx] = { ...g[gIdx][cIdx], metric: e.target.value };
                                                    setNewRule({ ...newRule, conditionGroups: g });
                                                }}
                                                className="rounded-lg bg-slate-700/50 border border-slate-600 px-3 py-2 text-sm text-white outline-none flex-1"
                                            >
                                                {METRICS.map((m) => (
                                                    <option key={m.value} value={m.value}>{m.label}</option>
                                                ))}
                                            </select>
                                            <select
                                                value={cond.op}
                                                onChange={(e) => {
                                                    const g = [...newRule.conditionGroups];
                                                    g[gIdx] = [...g[gIdx]];
                                                    g[gIdx][cIdx] = { ...g[gIdx][cIdx], op: e.target.value };
                                                    setNewRule({ ...newRule, conditionGroups: g });
                                                }}
                                                className="rounded-lg bg-slate-700/50 border border-slate-600 px-3 py-2 text-sm text-white outline-none w-20"
                                            >
                                                {OPERATORS.map((op) => (
                                                    <option key={op} value={op}>{op}</option>
                                                ))}
                                            </select>
                                            <input
                                                type="number"
                                                value={cond.val}
                                                onChange={(e) => {
                                                    const g = [...newRule.conditionGroups];
                                                    g[gIdx] = [...g[gIdx]];
                                                    g[gIdx][cIdx] = { ...g[gIdx][cIdx], val: Number(e.target.value) };
                                                    setNewRule({ ...newRule, conditionGroups: g });
                                                }}
                                                className="rounded-lg bg-slate-700/50 border border-slate-600 px-3 py-2 text-sm text-white outline-none w-32"
                                            />
                                            {group.length > 1 && (
                                                <button
                                                    onClick={() => {
                                                        const g = [...newRule.conditionGroups];
                                                        g[gIdx] = g[gIdx].filter((_, i) => i !== cIdx);
                                                        setNewRule({ ...newRule, conditionGroups: g });
                                                    }}
                                                    className="text-rose-400 hover:text-rose-300 p-1"
                                                >
                                                    <XCircle className="h-4 w-4" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => {
                                            const g = [...newRule.conditionGroups];
                                            g[gIdx] = [...g[gIdx], { metric: "purchases", op: "=", val: 0 }];
                                            setNewRule({ ...newRule, conditionGroups: g });
                                        }}
                                        className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 ml-6"
                                    >
                                        <Plus className="h-3 w-3" /> Thêm điều kiện VÀ
                                    </button>
                                </div>
                            </div>
                        ))}
                        <button
                            onClick={() => setNewRule({
                                ...newRule,
                                conditionGroups: [...newRule.conditionGroups, [{ metric: "spend", op: ">", val: 0 }]]
                            })}
                            className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 mt-3 bg-amber-500/10 px-3 py-1.5 rounded-lg border border-amber-500/20"
                        >
                            <Plus className="h-3 w-3" /> Thêm nhóm điều kiện HOẶC
                        </button>
                    </div>

                    {/* Action */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-slate-400 mb-1 block">Hành động</label>
                            <select
                                value={newRule.actions.action}
                                onChange={(e) => setNewRule({
                                    ...newRule,
                                    actions: { ...newRule.actions, action: e.target.value }
                                })}
                                className="w-full rounded-lg bg-slate-700/50 border border-slate-600 px-4 py-2.5 text-sm text-white outline-none"
                            >
                                {ACTIONS.map((a) => (
                                    <option key={a.value} value={a.value}>{a.label}</option>
                                ))}
                            </select>
                        </div>
                        {ACTIONS.find((a) => a.value === newRule.actions.action)?.hasValue && (
                            <div>
                                <label className="text-xs text-slate-400 mb-1 block">Giá trị (%)</label>
                                <input
                                    type="number"
                                    value={newRule.actions.value || 20}
                                    onChange={(e) => setNewRule({
                                        ...newRule,
                                        actions: { ...newRule.actions, value: Number(e.target.value) }
                                    })}
                                    className="w-full rounded-lg bg-slate-700/50 border border-slate-600 px-4 py-2.5 text-sm text-white outline-none"
                                />
                            </div>
                        )}
                    </div>

                    {/* Save buttons */}
                    <div className="flex items-center gap-3 pt-2">
                        <button
                            onClick={createRule}
                            disabled={!newRule.name.trim()}
                            className="rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-2.5 text-sm font-bold text-white hover:from-amber-400 hover:to-orange-400 transition shadow-lg disabled:opacity-50"
                        >
                            Tạo Rule
                        </button>
                        <button
                            onClick={() => setShowCreate(false)}
                            className="rounded-lg border border-slate-600 px-6 py-2.5 text-sm text-slate-400 hover:bg-slate-700/50 transition"
                        >
                            Hủy
                        </button>
                    </div>
                </div>
            )}

            {/* Rules List */}
            {view === "rules" && (
                <div className="space-y-3">
                    {loading && <div className="text-center py-8 text-slate-400">Đang tải...</div>}

                    {!loading && rules.length === 0 && !showCreate && (
                        <div className="text-center py-16">
                            <Zap className="h-16 w-16 text-slate-600 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-slate-300">Chưa có Rule nào</h3>
                            <p className="text-sm text-slate-500 mt-1">Tạo rule đầu tiên để tự động quản lý ads</p>
                        </div>
                    )}

                    {rules.map((rule) => (
                        <div
                            key={rule.id}
                            className={cn(
                                "rounded-xl border p-4 transition",
                                rule.isActive
                                    ? "border-emerald-500/30 bg-emerald-500/5"
                                    : "border-slate-700 bg-slate-800/30 opacity-60"
                            )}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    {rule.isActive ? (
                                        <Power className="h-5 w-5 text-emerald-400" />
                                    ) : (
                                        <PowerOff className="h-5 w-5 text-slate-500" />
                                    )}
                                    <div>
                                        <h4 className="font-semibold text-white text-sm">{rule.name}</h4>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                                                {rule.entityType}
                                            </span>
                                            <span className="text-[10px] text-slate-500">
                                                Mỗi {FREQUENCIES.find((f) => f.value === rule.frequency)?.label || `${rule.frequency}m`}
                                            </span>
                                            <span className="text-[10px] text-slate-500">
                                                • {rule._count?.logs || 0} executions
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => toggleRule(rule.id, rule.isActive)}
                                        className={cn(
                                            "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                                            rule.isActive
                                                ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25"
                                                : "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                                        )}
                                    >
                                        {rule.isActive ? "Tạm dừng" : "Kích hoạt"}
                                    </button>
                                    <button
                                        onClick={() => deleteRule(rule.id)}
                                        className="rounded-lg p-1.5 text-slate-500 hover:text-rose-400 transition"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Conditions + Action summary */}
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                                <span className="text-slate-500">NẾU</span>
                                {(Array.isArray(rule.conditions) ? rule.conditions : []).map((c: any, i: number) => (
                                    <span key={i} className="flex items-center gap-1">
                                        {i > 0 && <span className="text-slate-600">VÀ</span>}
                                        <span className="rounded-md bg-slate-700/50 px-2 py-1 text-slate-300">
                                            {METRICS.find((m) => m.value === c.metric)?.label || c.metric}
                                            {" "}{c.op}{" "}
                                            <b className="text-white">{typeof c.val === 'number' ? c.val.toLocaleString() : c.val}</b>
                                        </span>
                                    </span>
                                ))}
                                <span className="text-slate-500">→</span>
                                <span className="rounded-md bg-amber-500/15 px-2 py-1 text-amber-400 font-semibold">
                                    {ACTIONS.find((a) => a.value === (rule.actions as any)?.action)?.label || JSON.stringify(rule.actions)}
                                    {(rule.actions as any)?.value ? ` (${(rule.actions as any).value}%)` : ""}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Logs View */}
            {view === "logs" && (
                <div className="rounded-xl border border-slate-700 bg-slate-800/30 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-700 text-xs text-slate-400">
                                <th className="px-4 py-3 text-left font-medium">Thời gian</th>
                                <th className="px-4 py-3 text-left font-medium">Rule</th>
                                <th className="px-4 py-3 text-left font-medium">Target</th>
                                <th className="px-4 py-3 text-left font-medium">Action</th>
                                <th className="px-4 py-3 text-center font-medium">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/50">
                            {loading && (
                                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Đang tải...</td></tr>
                            )}
                            {!loading && logs.length === 0 && (
                                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Chưa có execution nào</td></tr>
                            )}
                            {logs.map((log) => {
                                let actionLabel = log.actionTaken;
                                try { actionLabel = JSON.parse(log.actionTaken)?.action || log.actionTaken; } catch { }

                                const details: any = log.details || {};

                                return (
                                    <tr key={log.id} className="hover:bg-slate-700/20 transition">
                                        <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                                            {new Date(log.createdAt).toLocaleString("vi-VN", {
                                                timeZone: "Asia/Ho_Chi_Minh",
                                                day: "2-digit", month: "2-digit",
                                                hour: "2-digit", minute: "2-digit"
                                            })}
                                        </td>
                                        <td className="px-4 py-3 text-white font-medium text-xs">
                                            {log.rule?.name || "—"}
                                        </td>
                                        <td className="px-4 py-3 text-slate-300 text-xs max-w-[200px] truncate" title={details.campaignName || log.targetId}>
                                            {details.campaignName || log.targetId}
                                        </td>
                                        <td className="px-4 py-3 text-xs">
                                            <span className="rounded-md bg-amber-500/15 px-2 py-1 text-amber-400 font-medium">
                                                {actionLabel.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {log.status === "EXECUTED" && <CheckCircle2 className="h-4 w-4 text-emerald-400 mx-auto" />}
                                            {log.status === "PENDING_APPROVAL" && <Clock className="h-4 w-4 text-amber-400 mx-auto" />}
                                            {log.status === "FAILED" && <XCircle className="h-4 w-4 text-rose-400 mx-auto" />}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Broadcasts View */}
            {view === "broadcast" && (
                <div className="space-y-4">
                    <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-purple-400 flex items-center gap-2">
                                <Zap className="h-5 w-5" /> Quản lý Broadcast Messenger
                            </h3>
                            {fanpages.length === 0 && (
                                <button
                                    onClick={async () => {
                                        await scalingFetch("fanpages/sync", { method: "POST" });
                                        loadBroadcasts();
                                    }}
                                    className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded"
                                >
                                    Đồng bộ Page
                                </button>
                            )}
                        </div>
                        
                        {loading ? (
                            <div className="text-center py-4 text-slate-500">Đang tải...</div>
                        ) : broadcasts.length === 0 ? (
                            <div className="text-center py-8 text-slate-500">
                                Chưa có chiến dịch Broadcast nào. Yêu cầu tạo từ API backend hoặc tool nội bộ.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {broadcasts.map(b => (
                                    <div key={b.id} className="p-4 border border-slate-700 bg-slate-800 rounded-lg flex justify-between items-center">
                                        <div>
                                            <h4 className="text-sm font-bold text-white">{b.name}</h4>
                                            <div className="text-xs text-slate-400 mt-1">
                                                Page: {b.fanpage?.name || b.pageId} | Status: <span className="text-purple-400 font-semibold">{b.status}</span>
                                            </div>
                                            <div className="text-xs text-slate-500 mt-1">
                                                Gửi thành công: {b.successCount} / Thất bại: {b.failCount} / Tổng: {b.totalTarget}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            {b.status === 'PENDING' && (
                                                <button onClick={async () => { await scalingFetch(`broadcasts/${b.id}/run`, { method: "POST" }); loadBroadcasts() }} className="px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs hover:bg-emerald-500/30">Chạy</button>
                                            )}
                                            {b.status === 'RUNNING' && (
                                                <button onClick={async () => { await scalingFetch(`broadcasts/${b.id}/pause`, { method: "POST" }); loadBroadcasts() }} className="px-3 py-1 bg-amber-500/20 text-amber-400 rounded text-xs hover:bg-amber-500/30">Tạm Dừng</button>
                                            )}
                                            {b.status === 'PAUSED' && (
                                                <button onClick={async () => { await scalingFetch(`broadcasts/${b.id}/resume`, { method: "POST" }); loadBroadcasts() }} className="px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs hover:bg-emerald-500/30">Tiếp Tục</button>
                                            )}
                                            <button onClick={async () => { if(confirm("Xóa?")) { await scalingFetch(`broadcasts/${b.id}`, { method: "DELETE" }); loadBroadcasts()} }} className="px-3 py-1 bg-rose-500/20 text-rose-400 rounded text-xs hover:bg-rose-500/30">Xóa</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* AI Advisor View */}
            {view === "advisor" && (
                <div className="space-y-4 animate-in fade-in zoom-in duration-300">
                    <div className="flex justify-between items-center bg-slate-800/80 p-4 rounded-xl border border-slate-700">
                        <div>
                            <h3 className="text-white font-bold flex items-center gap-2">
                                <Brain className="h-5 w-5 text-pink-500" />
                                AI Campaign Advisor
                            </h3>
                            <p className="text-xs text-slate-400">GPT-4o tự động tính Lợi Nhuận Thực (Cost: $20/đơn) và đưa ra gợi ý Scale.</p>
                        </div>
                        <button 
                            onClick={analyzeCampaigns} 
                            disabled={analyzing}
                            className="bg-pink-600 hover:bg-pink-500 text-white px-4 py-2 rounded-lg font-bold shadow flex items-center gap-2"
                        >
                            {analyzing ? <span className="animate-spin text-lg">⏳</span> : <Brain className="h-4 w-4" />}
                            {analyzing ? 'AI Đang Phân Tích...' : 'Phân Tích Lại'}
                        </button>
                    </div>

                    {!analyzing && advisorData.length === 0 && (
                        <div className="text-center p-12 text-slate-500 border border-slate-800 rounded-xl">
                            Chưa lấy được dữ liệu phân tích.
                        </div>
                    )}

                    {!analyzing && advisorData.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* SCALE COLUMN */}
                            <div className="space-y-3">
                                <h4 className="flex items-center gap-2 text-emerald-400 font-bold bg-emerald-500/10 px-3 py-2 rounded-lg border border-emerald-500/20">
                                    🟢 TĂNG TỐC
                                    <span className="ml-auto text-xs bg-emerald-500/20 px-2 py-0.5 rounded-full text-emerald-300">{advisorData.filter((r: any) => r.classification === 'SCALE').length}</span>
                                </h4>
                                {advisorData.filter((r: any) => r.classification === 'SCALE').map((c: any, i: number) => (
                                    <div key={i} className="bg-slate-800 p-3 rounded-lg border border-slate-700 hover:border-emerald-500/50 transition">
                                        <div className="text-sm font-bold text-white mb-2 line-clamp-2" title={c.campaignName}>{c.campaignName}</div>
                                        <div className="grid grid-cols-2 text-xs gap-2 mb-3 bg-slate-900/50 p-2 rounded">
                                            <div className="text-slate-400">Lời: <span className="text-emerald-400 font-bold text-[13px]">{Number(c.netProfit)?.toLocaleString()}đ</span></div>
                                            <div className="text-slate-400">ROAS: <span className="text-white font-medium">{c.roas}</span></div>
                                            <div className="text-slate-400">Orders: <span className="text-white font-medium">{c.orders}</span></div>
                                            <div className="text-slate-400">CPA: <span className="text-white font-medium">{Number(c.cpa)?.toLocaleString()}đ</span></div>
                                        </div>
                                        <div className="text-xs text-emerald-100 bg-emerald-500/20 p-2.5 rounded-lg mb-3 border border-emerald-500/30 font-medium">
                                            💡 {c.reasoning}
                                        </div>
                                        <button onClick={() => applyAction(c.campaignId, c.suggestedAction, c.suggestedValue)} className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded shadow-lg">
                                            {c.suggestedAction} {c.suggestedValue ? `+${c.suggestedValue}%` : ''}
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* HOLD COLUMN */}
                            <div className="space-y-3">
                                <h4 className="flex items-center gap-2 text-amber-400 font-bold bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20">
                                    🟡 THEO DÕI
                                    <span className="ml-auto text-xs bg-amber-500/20 px-2 py-0.5 rounded-full text-amber-300">{advisorData.filter((r: any) => r.classification === 'HOLD').length}</span>
                                </h4>
                                {advisorData.filter((r: any) => r.classification === 'HOLD').map((c: any, i: number) => (
                                    <div key={i} className="bg-slate-800 p-3 rounded-lg border border-slate-700 hover:border-amber-500/50 transition">
                                        <div className="text-sm font-bold text-white mb-2 line-clamp-2" title={c.campaignName}>{c.campaignName}</div>
                                        <div className="grid grid-cols-2 text-xs gap-2 mb-3 bg-slate-900/50 p-2 rounded">
                                            <div className="text-slate-400">Profit: <span className={Number(c.netProfit) >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>{Number(c.netProfit)?.toLocaleString()}đ</span></div>
                                            <div className="text-slate-400">ROAS: <span className="text-white font-medium">{c.roas}</span></div>
                                            <div className="text-slate-400">Orders: <span className="text-white font-medium">{c.orders}</span></div>
                                            <div className="text-slate-400">Spend: <span className="text-white font-medium">{Number(c.spend)?.toLocaleString()}</span></div>
                                        </div>
                                        <div className="text-xs text-slate-200 bg-slate-700/50 p-2.5 rounded-lg border border-slate-600">
                                            👀 {c.reasoning}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* KILL COLUMN */}
                            <div className="space-y-3">
                                <h4 className="flex items-center gap-2 text-rose-400 font-bold bg-rose-500/10 px-3 py-2 rounded-lg border border-rose-500/20">
                                    🔴 CẮT LỖ
                                    <span className="ml-auto text-xs bg-rose-500/20 px-2 py-0.5 rounded-full text-rose-300">{advisorData.filter((r: any) => r.classification === 'KILL').length}</span>
                                </h4>
                                {advisorData.filter((r: any) => r.classification === 'KILL').map((c: any, i: number) => (
                                    <div key={i} className="bg-slate-800 p-3 rounded-lg border border-slate-700 hover:border-rose-500/50 transition">
                                        <div className="text-sm font-bold text-white mb-2 line-clamp-2" title={c.campaignName}>{c.campaignName}</div>
                                        <div className="grid grid-cols-2 text-xs gap-2 mb-3 bg-slate-900/50 p-2 rounded">
                                            <div className="text-slate-400">Lỗ: <span className="text-rose-500 font-bold text-[13px]">{Number(c.netProfit)?.toLocaleString()}đ</span></div>
                                            <div className="text-slate-400">ROAS: <span className="text-white font-medium">{c.roas}</span></div>
                                            <div className="text-slate-400">Spend: <span className="text-rose-300 font-medium">{Number(c.spend)?.toLocaleString()}đ</span></div>
                                            <div className="text-slate-400">Orders: <span className="text-white font-medium">{c.orders}</span></div>
                                        </div>
                                        <div className="text-xs text-rose-100 bg-rose-500/20 p-2.5 rounded-lg mb-3 border border-rose-500/30 font-medium">
                                            ⚠️ {c.reasoning}
                                        </div>
                                        <button onClick={() => applyAction(c.campaignId, "PAUSE", 0)} className="w-full py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded shadow-lg">
                                            Tắt Chiến Dịch
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
