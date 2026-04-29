"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
    Activity, Brain, Bot, Database, Send, Shield, Eye, FileText, Download,
    Search, RefreshCw, Cpu, Clock, Wifi, WifiOff, ArrowLeft,
    Zap, MemoryStick, Server, Terminal, MessageSquare,
    Globe, CheckCircle2, Loader2, Upload, DollarSign,
    TrendingUp, BarChart3, Package, Layers, ArrowUpRight,
    PlayCircle, BookOpen, AlertTriangle, Inbox, History,
    Settings, Key, ToggleLeft, ToggleRight, Save, ExternalLink,
} from "lucide-react";
import Link from "next/link";

// ─── Types ───
interface Service { name: string; status: string; icon: string; port: string; description: string; url: string; }
interface SystemInfo { hostname: string; cpus: number; totalMemGB: string; usedMemGB: string; freeMemGB: string; memUsagePercent: string; uptimeHours: string; }
interface Agent { id: string; name: string; nameVi: string; description: string; scheduleLabel: string; llm: string; channels: string[]; icon: string; color: string; status: string; nextRun: string; }
interface SyncScript { id: string; name: string; file: string; description: string; schedule: string; tables: string[]; status: string; lastRun: string | null; lastStatus: string; nextRun: string; successRate: number; totalRuns: number; lastError: string | null; }
interface SyncRecord { id: string; project: string; project_id: string; description: string; started_at: string; finished_at: string | null; status: string; duration_seconds: number; error_message: string | null; details: Record<string, number>; trigger: string; }
interface SyncStats { totalSyncs: number; last24h: number; successRate: number; lastSync: string | null; lastSyncStatus: string; }
interface KGData { entities: { name: string; type: string; facts: number }[]; totalEntities: number; totalEpisodes: number; totalFacts: number; }
interface ChatMessage { role: "user" | "assistant"; content: string; timestamp: string; }
interface TelegramHistoryItem { text: string; date: string; ok: boolean; }
interface SettingsKey { label: string; category: string; value: string; hasValue: boolean; }
interface SettingsData { keys: Record<string, SettingsKey>; settings: { features: Record<string, boolean>; ui: Record<string, string | number> }; }

const AGENT_ICONS: Record<string, typeof Shield> = { shield: Shield, eye: Eye, "file-text": FileText, download: Download, search: Search };
const COLOR_MAP: Record<string, { bg: string; text: string; border: string; dot: string }> = {
    emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20", dot: "bg-emerald-500" },
    amber: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20", dot: "bg-amber-500" },
    blue: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20", dot: "bg-blue-500" },
    violet: { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/20", dot: "bg-violet-500" },
    rose: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/20", dot: "bg-rose-500" },
};

function StatusDot({ status }: { status: string }) {
    const c = status === "healthy" ? "bg-emerald-500" : status === "degraded" ? "bg-amber-500" : status === "unconfigured" ? "bg-slate-400" : "bg-red-500";
    return (<span className="relative flex h-2.5 w-2.5">{status === "healthy" && <span className={`absolute inline-flex h-full w-full rounded-full ${c} opacity-40 animate-ping`} />}<span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${c}`} /></span>);
}

function StatusBadge({ status }: { status: string }) {
    const cfg = status === "healthy" ? { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "Healthy" }
        : status === "degraded" ? { bg: "bg-amber-500/15", text: "text-amber-400", label: "Degraded" }
            : status === "unconfigured" ? { bg: "bg-slate-500/15", text: "text-slate-400", label: "Setup" }
                : { bg: "bg-red-500/15", text: "text-red-400", label: "Offline" };
    return <span className={`${cfg.bg} ${cfg.text} text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full`}>{cfg.label}</span>;
}

function Panel({ children, title, icon: Icon, badge, className = "" }: { children: React.ReactNode; title: string; icon: typeof Brain; badge?: string; className?: string }) {
    return (
        <div className={`rounded-2xl bg-white/[0.03] border border-white/5 overflow-hidden ${className}`}>
            <div className="px-5 py-3.5 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2"><Icon className="h-4 w-4 text-cyan-400" /><h2 className="text-sm font-bold text-white">{title}</h2></div>
                {badge && <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full font-medium">{badge}</span>}
            </div>
            {children}
        </div>
    );
}

// ─── Main Component ───
export default function AIBrainDashboard() {
    const [services, setServices] = useState<Service[]>([]);
    const [system, setSystem] = useState<SystemInfo | null>(null);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [syncs, setSyncs] = useState<SyncScript[]>([]);
    const [syncHistory, setSyncHistory] = useState<SyncRecord[]>([]);
    const [syncStats, setSyncStats] = useState<SyncStats | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [syncMsg, setSyncMsg] = useState<string | null>(null);
    const [kgData, setKgData] = useState<KGData | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    // Telegram
    const [telegramMsg, setTelegramMsg] = useState("");
    const [telegramSending, setTelegramSending] = useState(false);
    const [telegramStatus, setTelegramStatus] = useState<string | null>(null);
    const [telegramHistory, setTelegramHistory] = useState<TelegramHistoryItem[]>([]);
    // Chat
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [chatLoading, setChatLoading] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const chatLockRef = useRef(false);
    // KG Search
    const [kgSearch, setKgSearch] = useState("");
    // Upload
    const [uploadDrag, setUploadDrag] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<string | null>(null);
    // Settings
    const [settingsData, setSettingsData] = useState<SettingsData | null>(null);
    const [editingKeys, setEditingKeys] = useState<Record<string, string>>({});
    const [savingKey, setSavingKey] = useState<string | null>(null);
    const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
    // Tab control
    const [activeTab, setActiveTab] = useState<"overview" | "agents" | "knowledge" | "operations" | "settings">("overview");

    const fetchData = useCallback(async () => {
        try {
            const [healthRes, agentsRes, syncRes, kgRes] = await Promise.all([
                fetch("/api/ai-brain/health"), fetch("/api/ai-brain/agents"),
                fetch("/api/ai-brain/sync"), fetch("/api/ai-brain/knowledge"),
            ]);
            const [hd, ad, sd, kd] = await Promise.all([healthRes.json(), agentsRes.json(), syncRes.json(), kgRes.json()]);
            setServices(hd.services || []); setSystem(hd.system || null); setAgents(ad.agents || []);
            setSyncs(sd.scripts || []); setSyncHistory(sd.history || []); setSyncStats(sd.stats || null);
            setKgData(kd.data || null); setLastRefresh(new Date());
        } catch (err) { console.error("Fetch error:", err); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchData(); const id = setInterval(fetchData, 30000); return () => clearInterval(id); }, [fetchData]);

    // Fetch settings when Settings tab is activated
    useEffect(() => {
        if (activeTab === "settings" && !settingsData) {
            fetch("/api/ai-brain/settings").then(r => r.json()).then(d => { if (d.success) setSettingsData(d); }).catch(() => { });
        }
    }, [activeTab, settingsData]);

    const saveKey = async (key: string) => {
        const value = editingKeys[key];
        if (!value) return;
        setSavingKey(key); setSettingsMsg(null);
        try {
            const res = await fetch("/api/ai-brain/settings", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "updateKey", key, value }),
            });
            const data = await res.json();
            setSettingsMsg(data.success ? `✅ ${key} saved` : `❌ ${data.error}`);
            if (data.success) {
                setEditingKeys(prev => { const n = { ...prev }; delete n[key]; return n; });
                setSettingsData(null); // Refresh
                fetch("/api/ai-brain/settings").then(r => r.json()).then(d => { if (d.success) setSettingsData(d); });
            }
        } catch { setSettingsMsg("❌ Connection error"); }
        finally { setSavingKey(null); }
    };

    const toggleFeature = async (feature: string, value: boolean) => {
        if (!settingsData) return;
        const newFeatures = { ...settingsData.settings.features, [feature]: value };
        setSettingsData({ ...settingsData, settings: { ...settingsData.settings, features: newFeatures } });
        try {
            await fetch("/api/ai-brain/settings", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "updateSettings", settings: { features: { [feature]: value } } }),
            });
        } catch { /* silent */ }
    };

    const sendTelegram = async () => {
        setTelegramSending(true); setTelegramStatus(null);
        const msg = telegramMsg || "📊 Test from FAOS Dashboard";
        try {
            const res = await fetch("/api/ai-brain/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: msg }) });
            const data = await res.json();
            setTelegramStatus(data.success ? "✅ Đã gửi!" : "❌ Lỗi");
            if (data.success) { setTelegramHistory(prev => [{ text: msg, date: new Date().toISOString(), ok: true }, ...prev.slice(0, 9)]); }
            setTelegramMsg("");
        } catch { setTelegramStatus("❌ Không kết nối"); }
        finally { setTelegramSending(false); }
    };

    const sendChat = async () => {
        if (!chatInput.trim() || chatLockRef.current) return;
        chatLockRef.current = true;
        const userMsg: ChatMessage = { role: "user", content: chatInput, timestamp: new Date().toISOString() };
        setChatMessages(prev => [...prev, userMsg]); setChatInput(""); setChatLoading(true);
        try {
            const res = await fetch("/api/ai-brain/chat", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: userMsg.content })
            });
            const data = await res.json();
            const botMsg: ChatMessage = {
                role: "assistant",
                content: data.reply || data.error || "⚠️ Không có phản hồi.",
                timestamp: new Date().toISOString()
            };
            setChatMessages(prev => [...prev, botMsg]);
        } catch { setChatMessages(prev => [...prev, { role: "assistant", content: "❌ Không thể kết nối tới AI.", timestamp: new Date().toISOString() }]); }
        finally { setChatLoading(false); chatLockRef.current = false; setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100); }
    };

    const triggerSync = async (project?: string) => {
        setSyncing(true); setSyncMsg(null);
        try {
            const res = await fetch("/api/ai-brain/sync", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ project: project || null, days: 1 }),
            });
            const data = await res.json();
            setSyncMsg(data.success ? `✅ Sync triggered: ${data.message}` : `❌ ${data.error}`);
            // Refresh data after a short delay
            setTimeout(fetchData, 5000);
        } catch { setSyncMsg("❌ Connection error"); }
        finally { setSyncing(false); setTimeout(() => setSyncMsg(null), 8000); }
    };

    const handleFileDrop = (e: React.DragEvent) => {
        e.preventDefault(); setUploadDrag(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            setUploadStatus(`📄 ${files.map(f => f.name).join(", ")} — Kreuzberg processing...`);
            setTimeout(() => setUploadStatus(`✅ ${files.length} file(s) queued for ingestion → Knowledge Graph`), 2000);
        }
    };

    const healthyCount = services.filter(s => s.status === "healthy").length;
    const memPercent = system ? parseInt(system.memUsagePercent) : 0;

    const TABS = [
        { id: "overview" as const, label: "Overview", icon: BarChart3 },
        { id: "agents" as const, label: "Agents & Ops", icon: Bot },
        { id: "knowledge" as const, label: "Knowledge", icon: Brain },
        { id: "operations" as const, label: "Comms", icon: MessageSquare },
        { id: "settings" as const, label: "Settings", icon: Settings },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
            {/* Header */}
            <header className="border-b border-white/5">
                <div className="max-w-[1400px] mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <Link href="/" className="h-9 w-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors"><ArrowLeft className="h-4 w-4 text-slate-400" /></Link>
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-cyan-500 via-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20"><Brain className="h-5 w-5 text-white" /></div>
                                <div><h1 className="text-lg font-bold text-white tracking-tight">AI Brain</h1><p className="text-[11px] text-slate-500 font-medium">Command Center • FAOS v5</p></div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 text-xs text-slate-500"><Clock className="h-3 w-3" /><span>{lastRefresh.toLocaleTimeString()}</span></div>
                            <button onClick={fetchData} disabled={loading} className="h-8 px-3 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400 hover:bg-white/10 hover:text-white transition-all flex items-center gap-2 disabled:opacity-50"><RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />Refresh</button>
                            <a href="http://164.68.101.179:3580" target="_blank" rel="noopener noreferrer" className="h-8 px-4 rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 border border-amber-500/30 text-xs text-white font-semibold transition-all flex items-center gap-2 shadow-lg shadow-amber-500/20"><Bot className="h-3.5 w-3.5" />BizClaw Admin<ExternalLink className="h-3 w-3 opacity-60" /></a>
                            <div className="flex items-center gap-2">{healthyCount > 0 ? <Wifi className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-red-400" />}<span className={`text-xs font-bold ${healthyCount > 0 ? "text-emerald-400" : "text-red-400"}`}>{healthyCount}/{services.length}</span></div>
                        </div>
                    </div>
                    {/* Tabs */}
                    <div className="flex items-center gap-1 mt-4">
                        {TABS.map(t => (
                            <button key={t.id} onClick={() => setActiveTab(t.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${activeTab === t.id ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300 hover:bg-white/5"}`}>
                                <t.icon className="h-3.5 w-3.5" />{t.label}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <main className="max-w-[1400px] mx-auto px-6 py-5 space-y-5">

                {/* ═══════════════════════════════════ OVERVIEW TAB ═══════════════════════════════════ */}
                {activeTab === "overview" && (<>
                    {/* KPI Cards */}
                    <div className="grid grid-cols-5 gap-3">
                        <div className="rounded-2xl bg-gradient-to-br from-cyan-500/10 to-blue-500/5 border border-cyan-500/20 p-4">
                            <div className="flex items-center gap-2 mb-2"><Server className="h-3.5 w-3.5 text-cyan-400" /><span className="text-[10px] text-cyan-400 font-semibold uppercase tracking-wider">VPS</span></div>
                            <p className="text-xl font-bold text-white">{system?.hostname?.split(".")[0] || "—"}</p>
                            <p className="text-[10px] text-slate-500 mt-1">{system?.cpus || "—"} vCPU • {system?.uptimeHours || "—"}h</p>
                        </div>
                        <div className="rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/20 p-4">
                            <div className="flex items-center gap-2 mb-2"><Activity className="h-3.5 w-3.5 text-emerald-400" /><span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">Services</span></div>
                            <p className="text-xl font-bold text-white">{healthyCount}<span className="text-sm text-slate-500">/{services.length}</span></p>
                            <p className="text-[10px] text-slate-500 mt-1">Healthy running</p>
                        </div>
                        <div className="rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/5 border border-violet-500/20 p-4">
                            <div className="flex items-center gap-2 mb-2"><MemoryStick className="h-3.5 w-3.5 text-violet-400" /><span className="text-[10px] text-violet-400 font-semibold uppercase tracking-wider">Memory</span></div>
                            <p className="text-xl font-bold text-white">{system?.usedMemGB || "—"}<span className="text-sm text-slate-500">/{system?.totalMemGB}GB</span></p>
                            <div className="mt-1.5 h-1 bg-white/5 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${memPercent > 80 ? "bg-red-500" : memPercent > 60 ? "bg-amber-500" : "bg-violet-500"}`} style={{ width: `${memPercent}%` }} /></div>
                        </div>
                        <div className="rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/20 p-4">
                            <div className="flex items-center gap-2 mb-2"><Bot className="h-3.5 w-3.5 text-amber-400" /><span className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider">Agents</span></div>
                            <p className="text-xl font-bold text-white">{agents.length}</p>
                            <p className="text-[10px] text-slate-500 mt-1">OpenFang configured</p>
                        </div>
                        <div className="rounded-2xl bg-gradient-to-br from-rose-500/10 to-pink-500/5 border border-rose-500/20 p-4">
                            <div className="flex items-center gap-2 mb-2"><BookOpen className="h-3.5 w-3.5 text-rose-400" /><span className="text-[10px] text-rose-400 font-semibold uppercase tracking-wider">Knowledge</span></div>
                            <p className="text-xl font-bold text-white">{kgData?.totalEntities || 0}</p>
                            <p className="text-[10px] text-slate-500 mt-1">{kgData?.totalFacts || 0} facts • {kgData?.totalEpisodes || 0} episodes</p>
                        </div>
                    </div>

                    {/* Services + Activity */}
                    <div className="grid grid-cols-5 gap-4">
                        <Panel title="Service Health" icon={Cpu} badge="Auto-refresh 30s" className="col-span-3">
                            <div className="divide-y divide-white/5">
                                {loading ? <div className="p-8 flex items-center justify-center"><Loader2 className="h-5 w-5 text-slate-600 animate-spin" /></div>
                                    : services.map(svc => (
                                        <div key={svc.name} className="flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors group">
                                            <div className="flex items-center gap-3"><StatusDot status={svc.status} /><div><p className="text-sm font-semibold text-white">{svc.name}</p><p className="text-[11px] text-slate-500">{svc.description}</p></div></div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-[11px] text-slate-600 font-mono">:{svc.port}</span>
                                                <StatusBadge status={svc.status} />
                                                {svc.url && svc.url !== "/" && <a href={svc.url} target="_blank" rel="noopener" className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10"><Globe className="h-3 w-3 text-slate-400" /></a>}
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </Panel>
                        <Panel title="Data Sync" icon={RefreshCw} badge={syncStats ? `${syncStats.successRate}% success` : "—"} className="col-span-2">
                            <div className="p-4 space-y-3">
                                {/* Sync trigger button + msg */}
                                <div className="flex items-center gap-2">
                                    <button onClick={() => triggerSync()} disabled={syncing}
                                        className="flex-1 h-9 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                                        {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                        {syncing ? "Đang sync..." : "Sync Now (All)"}
                                    </button>
                                </div>
                                {syncMsg && <p className={`text-xs px-3 py-1.5 rounded-lg ${syncMsg.startsWith("✅") ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>{syncMsg}</p>}
                                {/* Per-project status */}
                                {syncs.map(s => (
                                    <div key={s.id} className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <div className="flex items-center gap-2">
                                                <span className={`h-2 w-2 rounded-full ${s.status === "success" ? "bg-emerald-500" : s.status === "error" ? "bg-red-500" : "bg-slate-500"}`} />
                                                <p className="text-xs font-semibold text-white">{s.name}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${s.status === "success" ? "bg-emerald-500/15 text-emerald-400" : s.status === "error" ? "bg-red-500/15 text-red-400" : "bg-slate-500/15 text-slate-400"}`}>{s.status === "unknown" ? "chưa chạy" : s.status}</span>
                                                <button onClick={() => triggerSync(s.id)} disabled={syncing} className="h-6 w-6 rounded-lg bg-white/5 flex items-center justify-center hover:bg-cyan-500/20 transition-colors" title="Sync project này">
                                                    <RefreshCw className={`h-3 w-3 text-slate-500 hover:text-cyan-400 ${syncing ? "animate-spin" : ""}`} />
                                                </button>
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-slate-500 mb-1">{s.description}</p>
                                        <div className="flex items-center gap-3">
                                            <span className="text-[10px] text-slate-600"><Clock className="h-2.5 w-2.5 inline mr-1" />{s.lastRun ? new Date(s.lastRun).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Chưa chạy"}</span>
                                            <span className="text-[10px] text-slate-600"><Database className="h-2.5 w-2.5 inline mr-1" />{s.tables.length} tables</span>
                                            {s.totalRuns > 0 && <span className={`text-[10px] font-semibold ${s.successRate >= 80 ? "text-emerald-500" : s.successRate >= 50 ? "text-amber-500" : "text-red-500"}`}>{s.successRate}% ({s.totalRuns} lần)</span>}
                                        </div>
                                        {s.lastError && <p className="text-[10px] text-red-400/70 mt-1 truncate" title={s.lastError}>❌ {s.lastError.slice(0, 80)}</p>}
                                    </div>
                                ))}
                            </div>
                        </Panel>
                    </div>

                    {/* Sync History Table */}
                    <Panel title="Sync History" icon={History} badge={`${syncHistory.length} records`}>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-white/5 text-[10px] text-slate-500 uppercase tracking-wider">
                                        <th className="px-4 py-2.5 text-left font-semibold">Thời gian</th>
                                        <th className="px-4 py-2.5 text-left font-semibold">Dự án</th>
                                        <th className="px-4 py-2.5 text-center font-semibold">Trạng thái</th>
                                        <th className="px-4 py-2.5 text-right font-semibold">Thời gian chạy</th>
                                        <th className="px-4 py-2.5 text-left font-semibold">Trigger</th>
                                        <th className="px-4 py-2.5 text-left font-semibold">Chi tiết</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.03]">
                                    {syncHistory.length === 0 ? (
                                        <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-600">Chưa có lịch sử sync nào. Nhấn &quot;Sync Now&quot; để bắt đầu.</td></tr>
                                    ) : syncHistory.slice(0, 20).map((h, i) => (
                                        <tr key={h.id || i} className="hover:bg-white/[0.02] transition-colors">
                                            <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">
                                                {new Date(h.started_at).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <span className="text-white font-semibold">{h.project}</span>
                                            </td>
                                            <td className="px-4 py-2.5 text-center">
                                                <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${h.status === "success" ? "bg-emerald-500/15 text-emerald-400" :
                                                        h.status === "error" ? "bg-red-500/15 text-red-400" :
                                                            "bg-amber-500/15 text-amber-400"
                                                    }`}>
                                                    {h.status === "success" ? "✅" : h.status === "error" ? "❌" : "⏳"} {h.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 text-right text-slate-300 font-mono">{h.duration_seconds.toFixed(1)}s</td>
                                            <td className="px-4 py-2.5">
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${h.trigger === "manual" ? "bg-blue-500/10 text-blue-400" : "bg-slate-500/10 text-slate-400"}`}>{h.trigger}</span>
                                            </td>
                                            <td className="px-4 py-2.5 text-slate-500 max-w-[200px] truncate">
                                                {h.status === "error" && h.error_message ? (
                                                    <span className="text-red-400/70" title={h.error_message}>{h.error_message.slice(0, 60)}</span>
                                                ) : h.details && Object.keys(h.details).length > 0 ? (
                                                    Object.entries(h.details).map(([k, v]) => `${k}: ${v}`).join(" • ")
                                                ) : "—"}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Panel>

                    {/* Cost Tracker + Quick Links */}
                    <div className="grid grid-cols-5 gap-4">
                        <Panel title="LLM Cost Tracker" icon={DollarSign} className="col-span-2">
                            <div className="p-5 space-y-3">
                                {[{ name: "Gemini 2.5 Flash", cost: "$0.00", calls: "0", color: "text-blue-400" },
                                { name: "GPT-4o Mini", cost: "$0.00", calls: "0", color: "text-emerald-400" },
                                { name: "BizClaw (Telegram)", cost: "$0.00", calls: "0", color: "text-amber-400" }
                                ].map(m => (
                                    <div key={m.name} className="flex items-center justify-between">
                                        <div className="flex items-center gap-2"><div className={`h-2 w-2 rounded-full ${m.color.replace("text-", "bg-")}`} /><span className="text-xs text-slate-300">{m.name}</span></div>
                                        <div className="flex items-center gap-3"><span className="text-xs text-slate-500">{m.calls} calls</span><span className={`text-xs font-bold ${m.color}`}>{m.cost}</span></div>
                                    </div>
                                ))}
                                <div className="pt-3 border-t border-white/5 flex items-center justify-between">
                                    <span className="text-xs text-slate-400 font-semibold">Total This Month</span>
                                    <span className="text-sm font-bold text-white">$0.00</span>
                                </div>
                                <p className="text-[10px] text-slate-600 italic">Cost tracking bắt đầu khi agents chạy</p>
                            </div>
                        </Panel>
                        <Panel title="Quick Links" icon={ArrowUpRight} className="col-span-3">
                            <div className="p-5 grid grid-cols-3 gap-3">
                                {[
                                    { label: "FalkorDB UI", url: "http://164.68.101.179:3001", icon: Database, color: "from-emerald-500/20 to-teal-500/10 border-emerald-500/20" },
                                    { label: "Dashboard", url: "http://164.68.101.179:3000", icon: BarChart3, color: "from-blue-500/20 to-indigo-500/10 border-blue-500/20" },
                                    { label: "Telegram Bot", url: "https://t.me/FaosLvu_bot", icon: Send, color: "from-sky-500/20 to-blue-500/10 border-sky-500/20" },
                                    { label: "BizClaw Admin", url: "http://164.68.101.179:3580", icon: Bot, color: "from-amber-500/20 to-orange-500/10 border-amber-500/20" },
                                    { label: "Ads Command", url: "/ads-command-center", icon: TrendingUp, color: "from-rose-500/20 to-pink-500/10 border-rose-500/20" },
                                    { label: "Admin Panel", url: "/admin", icon: Layers, color: "from-violet-500/20 to-purple-500/10 border-violet-500/20" },
                                ].map(l => (
                                    <a key={l.label} href={l.url} target={l.url.startsWith("http") ? "_blank" : undefined} rel="noopener"
                                        className={`flex items-center gap-3 p-3 rounded-xl bg-gradient-to-br ${l.color} border hover:scale-[1.02] transition-transform`}>
                                        <l.icon className="h-4 w-4 text-white/70" />
                                        <span className="text-xs font-semibold text-white/80">{l.label}</span>
                                    </a>
                                ))}
                            </div>
                        </Panel>
                    </div>
                </>)}

                {/* ═══════════════════════════════════ AGENTS TAB ═══════════════════════════════════ */}
                {activeTab === "agents" && (<>
                    <div className="grid grid-cols-5 gap-4">
                        <Panel title="AI Agents (OpenFang)" icon={Zap} badge={`${agents.length} agents`} className="col-span-3">
                            <div className="divide-y divide-white/5">
                                {agents.map(agent => {
                                    const IconCmp = AGENT_ICONS[agent.icon] || Shield;
                                    const colors = COLOR_MAP[agent.color] || COLOR_MAP.emerald;
                                    return (
                                        <div key={agent.id} className="flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className={`h-8 w-8 rounded-xl ${colors.bg} ${colors.border} border flex items-center justify-center`}><IconCmp className={`h-3.5 w-3.5 ${colors.text}`} /></div>
                                                <div>
                                                    <div className="flex items-center gap-2"><p className="text-sm font-semibold text-white">{agent.name}</p><span className="text-[10px] text-slate-500">({agent.nameVi})</span></div>
                                                    <p className="text-[11px] text-slate-500">{agent.description}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="text-right"><p className="text-[10px] text-slate-500 uppercase tracking-wider">Schedule</p><p className="text-xs text-slate-300 font-mono">{agent.scheduleLabel}</p></div>
                                                <div className="text-right"><p className="text-[10px] text-slate-500 uppercase tracking-wider">LLM</p><p className="text-xs text-slate-300 font-mono">{agent.llm}</p></div>
                                                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${agent.status === "running" ? "bg-emerald-500/15 text-emerald-400" : agent.status === "error" ? "bg-red-500/15 text-red-400" : "bg-slate-500/15 text-slate-400"}`}>{agent.status}</span>
                                                <button className="h-7 w-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-emerald-500/20 transition-colors group" title="Run Now">
                                                    <PlayCircle className="h-3.5 w-3.5 text-slate-500 group-hover:text-emerald-400" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </Panel>
                        <div className="col-span-2 space-y-4">
                            <Panel title="Agent Output History" icon={Terminal}>
                                <div className="p-5 text-center">
                                    <Inbox className="h-8 w-8 text-slate-700 mx-auto mb-2" />
                                    <p className="text-xs text-slate-500">Chưa có agent nào chạy.</p>
                                    <p className="text-[10px] text-slate-600 mt-1">Output sẽ hiện ở đây khi OpenFang được cài đặt.</p>
                                </div>
                            </Panel>
                            <Panel title="Agent Schedule" icon={Clock}>
                                <div className="p-5 space-y-2">
                                    {agents.map(a => (
                                        <div key={a.id} className="flex items-center justify-between">
                                            <span className="text-xs text-slate-400">{a.name.replace("FAOS ", "")}</span>
                                            <span className="text-xs text-slate-300 font-mono">{a.scheduleLabel}</span>
                                        </div>
                                    ))}
                                </div>
                            </Panel>
                        </div>
                    </div>
                </>)}

                {/* ═══════════════════════════════════ KNOWLEDGE TAB ═══════════════════════════════════ */}
                {activeTab === "knowledge" && (<>
                    <div className="grid grid-cols-5 gap-4">
                        <Panel title="Knowledge Graph Explorer" icon={Brain} className="col-span-3">
                            <div className="p-5 space-y-4">
                                <div className="flex gap-2">
                                    <div className="flex-1 relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                                        <input value={kgSearch} onChange={e => setKgSearch(e.target.value)} placeholder="Search entities, facts..." className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
                                    </div>
                                    <button className="px-4 py-2 rounded-xl bg-cyan-600 text-white text-xs font-semibold hover:bg-cyan-500 transition-colors">Search</button>
                                </div>
                                {/* KG Stats */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="text-center p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                                        <p className="text-lg font-bold text-cyan-400">{kgData?.totalEntities || 0}</p>
                                        <p className="text-[10px] text-slate-500 uppercase">Entities</p>
                                    </div>
                                    <div className="text-center p-3 rounded-xl bg-violet-500/10 border border-violet-500/20">
                                        <p className="text-lg font-bold text-violet-400">{kgData?.totalFacts || 0}</p>
                                        <p className="text-[10px] text-slate-500 uppercase">Facts</p>
                                    </div>
                                    <div className="text-center p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                        <p className="text-lg font-bold text-amber-400">{kgData?.totalEpisodes || 0}</p>
                                        <p className="text-[10px] text-slate-500 uppercase">Episodes</p>
                                    </div>
                                </div>
                                {/* Entity List */}
                                <div className="space-y-2">
                                    {(kgData?.entities || []).filter(e => !kgSearch || e.name.toLowerCase().includes(kgSearch.toLowerCase())).map(e => (
                                        <div key={e.name} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className="h-7 w-7 rounded-lg bg-cyan-500/10 flex items-center justify-center"><BookOpen className="h-3 w-3 text-cyan-400" /></div>
                                                <div><p className="text-sm font-semibold text-white">{e.name}</p><p className="text-[10px] text-slate-500">{e.type}</p></div>
                                            </div>
                                            <span className="text-xs text-slate-400">{e.facts} facts</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </Panel>
                        <div className="col-span-2 space-y-4">
                            {/* Document Upload */}
                            <Panel title="Document Ingestion" icon={Upload}>
                                <div className="p-5">
                                    <div onDragOver={e => { e.preventDefault(); setUploadDrag(true); }} onDragLeave={() => setUploadDrag(false)} onDrop={handleFileDrop}
                                        className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${uploadDrag ? "border-cyan-500 bg-cyan-500/5" : "border-white/10 hover:border-white/20"}`}>
                                        <Upload className={`h-8 w-8 mx-auto mb-3 ${uploadDrag ? "text-cyan-400" : "text-slate-600"}`} />
                                        <p className="text-xs text-slate-400">Kéo thả PDF, DOCX, TXT...</p>
                                        <p className="text-[10px] text-slate-600 mt-1">Kreuzberg → extract → Knowledge Graph</p>
                                    </div>
                                    {uploadStatus && <p className="text-xs text-cyan-400 mt-3">{uploadStatus}</p>}
                                </div>
                            </Panel>
                            <Panel title="Quick Actions" icon={Zap}>
                                <div className="p-5 space-y-2">
                                    {[
                                        { label: "Open FalkorDB Browser", url: "http://164.68.101.179:3001", icon: Database },
                                        { label: "Query BigQuery", url: "/admin", icon: Search },
                                        { label: "View Graphiti Docs", url: "https://github.com/getzep/graphiti", icon: BookOpen },
                                    ].map(a => (
                                        <a key={a.label} href={a.url} target="_blank" rel="noopener" className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors text-xs text-slate-300 hover:text-white">
                                            <a.icon className="h-3.5 w-3.5 text-slate-500" />{a.label}<ArrowUpRight className="h-3 w-3 ml-auto text-slate-600" />
                                        </a>
                                    ))}
                                </div>
                            </Panel>
                        </div>
                    </div>
                </>)}

                {/* ═══════════════════════════════════ COMMS TAB ═══════════════════════════════════ */}
                {activeTab === "operations" && (<>
                    <div className="grid grid-cols-5 gap-4">
                        {/* Chat */}
                        <Panel title="Chat with AI (BizClaw)" icon={MessageSquare} className="col-span-3">
                            <div className="flex flex-col h-[400px]">
                                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                                    {chatMessages.length === 0 && (
                                        <div className="text-center py-10">
                                            <Bot className="h-10 w-10 text-slate-700 mx-auto mb-3" />
                                            <p className="text-xs text-slate-500">Gửi tin nhắn để chat với BizClaw AI</p>
                                            <p className="text-[10px] text-slate-600 mt-1">Powered by Gemini 2.5 Flash — phản hồi trực tiếp</p>
                                        </div>
                                    )}
                                    {chatMessages.map((m, i) => (
                                        <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                                            <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-xs leading-relaxed ${m.role === "user" ? "bg-blue-600 text-white rounded-br-sm" : "bg-white/5 text-slate-300 rounded-bl-sm"}`}>
                                                {m.content}
                                                <p className={`text-[9px] mt-1 ${m.role === "user" ? "text-blue-200" : "text-slate-600"}`}>{new Date(m.timestamp).toLocaleTimeString()}</p>
                                            </div>
                                        </div>
                                    ))}
                                    {chatLoading && <div className="flex justify-start"><div className="bg-white/5 px-4 py-3 rounded-2xl rounded-bl-sm"><Loader2 className="h-4 w-4 text-slate-500 animate-spin" /></div></div>}
                                    <div ref={chatEndRef} />
                                </div>
                                <div className="border-t border-white/5 p-4 flex gap-2">
                                    <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendChat()} placeholder="Hỏi BizClaw AI..."
                                        className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50" />
                                    <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} className="px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-2">
                                        <Send className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        </Panel>
                        {/* Telegram */}
                        <div className="col-span-2 space-y-4">
                            <Panel title="Telegram" icon={Send} badge="@FaosLvu_bot">
                                <div className="p-5 space-y-3">
                                    <div className="flex gap-2">
                                        <input value={telegramMsg} onChange={e => setTelegramMsg(e.target.value)} onKeyDown={e => e.key === "Enter" && sendTelegram()} placeholder="Gửi tin nhắn test..."
                                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50" />
                                        <button onClick={sendTelegram} disabled={telegramSending} className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-2">
                                            {telegramSending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}Gửi
                                        </button>
                                    </div>
                                    {telegramStatus && <p className={`text-xs ${telegramStatus.startsWith("✅") ? "text-emerald-400" : "text-red-400"}`}>{telegramStatus}</p>}
                                </div>
                            </Panel>
                            <Panel title="Telegram History" icon={History}>
                                <div className="divide-y divide-white/5 max-h-[200px] overflow-y-auto">
                                    {telegramHistory.length === 0 ? (
                                        <div className="p-5 text-center"><p className="text-xs text-slate-500">Chưa có tin nhắn nào được gửi từ dashboard.</p></div>
                                    ) : telegramHistory.map((h, i) => (
                                        <div key={i} className="px-5 py-2.5 flex items-center gap-3">
                                            <CheckCircle2 className={`h-3 w-3 ${h.ok ? "text-emerald-400" : "text-red-400"}`} />
                                            <p className="text-xs text-slate-300 flex-1 truncate">{h.text}</p>
                                            <p className="text-[10px] text-slate-600">{new Date(h.date).toLocaleTimeString()}</p>
                                        </div>
                                    ))}
                                </div>
                            </Panel>
                            <Panel title="BizClaw Status" icon={Bot}>
                                <div className="p-5 space-y-2.5">
                                    {[{ l: "Gateway", v: ":3580" }, { l: "Platform", v: "v0.2.0" }, { l: "Channels", v: "Telegram + 8 more" }, { l: "Providers", v: "15 available" }, { l: "Mode", v: "Local", c: "text-emerald-400 font-semibold" }].map(r => (
                                        <div key={r.l} className="flex items-center justify-between"><span className="text-xs text-slate-400">{r.l}</span><span className={`text-xs ${r.c || "text-slate-300 font-mono"}`}>{r.v}</span></div>
                                    ))}
                                </div>
                            </Panel>
                        </div>
                    </div>
                </>)}

                {/* ═══════════════════════════════════ SETTINGS TAB ═══════════════════════════════════ */}
                {activeTab === "settings" && (<>
                    {settingsMsg && <div className={`rounded-xl px-4 py-2.5 text-xs font-medium ${settingsMsg.startsWith("✅") ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>{settingsMsg}</div>}

                    <div className="grid grid-cols-2 gap-4">
                        {/* LLM API Keys */}
                        <Panel title="LLM API Keys" icon={Key} badge="Sensitive">
                            <div className="p-5 space-y-3">
                                {settingsData ? Object.entries(settingsData.keys).filter(([, v]) => v.category === "llm").map(([key, meta]) => (
                                    <div key={key} className="space-y-1">
                                        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{meta.label}</label>
                                        <div className="flex gap-2">
                                            <input
                                                type={editingKeys[key] !== undefined ? "text" : "password"}
                                                value={editingKeys[key] !== undefined ? editingKeys[key] : meta.value}
                                                onChange={e => setEditingKeys(prev => ({ ...prev, [key]: e.target.value }))}
                                                onFocus={() => { if (editingKeys[key] === undefined && meta.hasValue) setEditingKeys(prev => ({ ...prev, [key]: "" })); }}
                                                placeholder={meta.hasValue ? "••••••••" : "Enter API key..."}
                                                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
                                            />
                                            {editingKeys[key] !== undefined && (
                                                <button onClick={() => saveKey(key)} disabled={savingKey === key}
                                                    className="px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5">
                                                    {savingKey === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Save
                                                </button>
                                            )}
                                        </div>
                                        {meta.hasValue && <p className="text-[9px] text-emerald-500/50 flex items-center gap-1"><CheckCircle2 className="h-2.5 w-2.5" />Configured</p>}
                                    </div>
                                )) : <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 text-slate-600 animate-spin" /></div>}
                            </div>
                        </Panel>

                        {/* Channels */}
                        <Panel title="Communication Channels" icon={MessageSquare}>
                            <div className="p-5 space-y-3">
                                {settingsData ? Object.entries(settingsData.keys).filter(([, v]) => v.category === "channels").map(([key, meta]) => (
                                    <div key={key} className="space-y-1">
                                        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{meta.label}</label>
                                        <div className="flex gap-2">
                                            <input
                                                type={editingKeys[key] !== undefined ? "text" : "password"}
                                                value={editingKeys[key] !== undefined ? editingKeys[key] : meta.value}
                                                onChange={e => setEditingKeys(prev => ({ ...prev, [key]: e.target.value }))}
                                                onFocus={() => { if (editingKeys[key] === undefined && meta.hasValue) setEditingKeys(prev => ({ ...prev, [key]: "" })); }}
                                                placeholder={`Enter ${meta.label.toLowerCase()}...`}
                                                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
                                            />
                                            {editingKeys[key] !== undefined && (
                                                <button onClick={() => saveKey(key)} disabled={savingKey === key}
                                                    className="px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5">
                                                    {savingKey === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Save
                                                </button>
                                            )}
                                        </div>
                                        {meta.hasValue && <p className="text-[9px] text-emerald-500/50 flex items-center gap-1"><CheckCircle2 className="h-2.5 w-2.5" />Configured</p>}
                                    </div>
                                )) : <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 text-slate-600 animate-spin" /></div>}
                            </div>
                        </Panel>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        {/* Data Sources */}
                        <Panel title="Data Sources" icon={Database}>
                            <div className="p-5 space-y-3">
                                {settingsData ? Object.entries(settingsData.keys).filter(([, v]) => v.category === "data").map(([key, meta]) => (
                                    <div key={key} className="space-y-1">
                                        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{meta.label}</label>
                                        <div className="flex gap-2">
                                            <input
                                                type={meta.label.includes("Token") || meta.label.includes("Key") ? (editingKeys[key] !== undefined ? "text" : "password") : "text"}
                                                value={editingKeys[key] !== undefined ? editingKeys[key] : meta.value}
                                                onChange={e => setEditingKeys(prev => ({ ...prev, [key]: e.target.value }))}
                                                onFocus={() => { if (editingKeys[key] === undefined && meta.hasValue) setEditingKeys(prev => ({ ...prev, [key]: "" })); }}
                                                placeholder={`Enter ${meta.label.toLowerCase()}...`}
                                                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
                                            />
                                            {editingKeys[key] !== undefined && (
                                                <button onClick={() => saveKey(key)} disabled={savingKey === key}
                                                    className="px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5">
                                                    {savingKey === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Save
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )) : <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 text-slate-600 animate-spin" /></div>}
                            </div>
                        </Panel>

                        {/* Services */}
                        <Panel title="Service URLs" icon={Server}>
                            <div className="p-5 space-y-3">
                                {settingsData ? Object.entries(settingsData.keys).filter(([, v]) => v.category === "services").map(([key, meta]) => (
                                    <div key={key} className="space-y-1">
                                        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{meta.label}</label>
                                        <div className="flex gap-2">
                                            <input
                                                value={editingKeys[key] !== undefined ? editingKeys[key] : meta.value}
                                                onChange={e => setEditingKeys(prev => ({ ...prev, [key]: e.target.value }))}
                                                placeholder={`Enter URL...`}
                                                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
                                            />
                                            {editingKeys[key] !== undefined && (
                                                <button onClick={() => saveKey(key)} disabled={savingKey === key}
                                                    className="px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5">
                                                    {savingKey === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Save
                                                </button>
                                            )}
                                        </div>
                                        {meta.hasValue && meta.value && (
                                            <a href={meta.value.startsWith("http") ? meta.value : `http://${meta.value}`} target="_blank" rel="noopener"
                                                className="text-[9px] text-cyan-400/60 hover:text-cyan-400 flex items-center gap-1"><ExternalLink className="h-2.5 w-2.5" />Open</a>
                                        )}
                                    </div>
                                )) : <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 text-slate-600 animate-spin" /></div>}
                            </div>
                        </Panel>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        {/* Feature Toggles */}
                        <Panel title="Feature Toggles" icon={ToggleLeft} badge="On/Off">
                            <div className="p-5 space-y-3">
                                {settingsData ? Object.entries(settingsData.settings.features).map(([key, enabled]) => {
                                    const labels: Record<string, { name: string; desc: string }> = {
                                        syncStramark: { name: "STRAMARK Sync", desc: "Daily data sync from Poscake + Meta Ads" },
                                        syncAuus1: { name: "AUUS1 Sync", desc: "AU/US market data pipeline" },
                                        syncTalpha: { name: "TALPHA Sync", desc: "Middle East market data pipeline" },
                                        autoRefresh: { name: "Auto Refresh", desc: "Dashboard auto-refreshes every 30s" },
                                        costTracking: { name: "Cost Tracking", desc: "Track LLM API costs per agent" },
                                        knowledgeGraph: { name: "Knowledge Graph", desc: "Graphiti MCP temporal knowledge" },
                                        telegramBot: { name: "Telegram Bot", desc: "@FaosLvu_bot active" },
                                        bizclawAgents: { name: "BizClaw Agents", desc: "BizClaw multi-agent platform" },
                                    };
                                    const info = labels[key] || { name: key, desc: "" };
                                    return (
                                        <div key={key} className="flex items-center justify-between">
                                            <div>
                                                <p className="text-xs text-white font-semibold">{info.name}</p>
                                                <p className="text-[10px] text-slate-500">{info.desc}</p>
                                            </div>
                                            <button onClick={() => toggleFeature(key, !enabled)}
                                                className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? "bg-cyan-600" : "bg-white/10"}`}>
                                                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`} />
                                            </button>
                                        </div>
                                    );
                                }) : <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 text-slate-600 animate-spin" /></div>}
                            </div>
                        </Panel>

                        {/* System */}
                        <Panel title="System Info" icon={Cpu}>
                            <div className="p-5 space-y-3">
                                {system ? (
                                    <>
                                        {[
                                            { l: "Hostname", v: system.hostname },
                                            { l: "CPUs", v: `${system.cpus} vCPU` },
                                            { l: "RAM", v: `${system.usedMemGB} / ${system.totalMemGB} GB (${system.memUsagePercent}%)` },
                                            { l: "Uptime", v: `${system.uptimeHours} hours` },
                                            { l: "Healthy Services", v: `${healthyCount} / ${services.length}` },
                                        ].map(r => (
                                            <div key={r.l} className="flex items-center justify-between">
                                                <span className="text-xs text-slate-400">{r.l}</span>
                                                <span className="text-xs text-slate-200 font-mono">{r.v}</span>
                                            </div>
                                        ))}
                                        <div className="pt-3 border-t border-white/5 space-y-2">
                                            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Port Map</p>
                                            {[
                                                { port: "3000", svc: "Dashboard (Next.js)" },
                                                { port: "3001", svc: "FalkorDB Browser" },
                                                { port: "3580", svc: "BizClaw Gateway" },
                                                { port: "6379", svc: "FalkorDB Redis" },
                                                { port: "8200", svc: "Graphiti MCP" },
                                            ].map(p => (
                                                <div key={p.port} className="flex items-center justify-between">
                                                    <span className="text-[11px] text-slate-400 font-mono">:{p.port}</span>
                                                    <span className="text-[11px] text-slate-300">{p.svc}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                ) : <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 text-slate-600 animate-spin" /></div>}
                            </div>
                        </Panel>
                    </div>
                </>)}

                {/* Footer */}
                <div className="text-center pb-4">
                    <p className="text-[10px] text-slate-700 uppercase tracking-widest">FAOS AI Brain • VPS 164.68.101.179 • Contabo 48GB</p>
                </div>
            </main>
        </div>
    );
}
