"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Shield, Clock, Users, ChevronRight, MessageSquare,
    Send, Loader2, AlertTriangle, Bot, RefreshCw,
    Zap, DollarSign, Hash, Target, ChevronDown,
    ChevronUp, X, Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import MeetingDetail from "./meeting-detail";

// ── Types ──────────────────────────────────────────────────────
interface MeetingSummary {
    id: string;
    timestamp: string;
    meeting_type: string;
    agenda: string;
    agents: string[];
    duration_seconds: number;
    tokens: { total: number; prompt: number; completion: number };
    cost: { total_usd: number };
    message_count: number;
    proposals: string[];
    status: string;
}

interface QuickAction {
    id: string;
    label: string;
    description: string;
    agent: string;
    meeting_type: string;
    command: string;
}

// ── Config ─────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_WAR_ROOM_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

const AGENT_COLORS: Record<string, { text: string; bg: string; border: string }> = {
    CMO: { text: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500/30" },
    CFO: { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
    COO: { text: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
    CTO: { text: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/30" },
    CSO: { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
    Chairman: { text: "text-white", bg: "bg-white/10", border: "border-white/20" },
    CHAIRMAN: { text: "text-white", bg: "bg-white/10", border: "border-white/20" },
};

const MEETING_BADGES: Record<string, { label: string; color: string }> = {
    daily_standup: { label: "Daily Standup", color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30" },
    strategy: { label: "Strategy", color: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
    quick_ask: { label: "Quick Ask", color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30" },
    dashboard_restructure: { label: "Dashboard", color: "bg-violet-500/10 text-violet-400 border-violet-500/30" },
};

// ── Main Component ──────────────────────────────────────────────

export default function WarRoom() {
    const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
    const [quickActions, setQuickActions] = useState<QuickAction[]>([]);
    const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // CEO Command state
    const [command, setCommand] = useState("");
    const [selectedAgent, setSelectedAgent] = useState("chairman");
    const [commandLoading, setCommandLoading] = useState(false);
    const [commandResult, setCommandResult] = useState<string | null>(null);
    const [commandSessionId, setCommandSessionId] = useState<string | null>(null);

    // Fetch meetings + quick actions
    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [meetingsRes, actionsRes] = await Promise.all([
                fetch(`${API_BASE}/api/war-room/meetings`),
                fetch(`${API_BASE}/api/war-room/quick-actions`),
            ]);
            if (meetingsRes.ok) {
                const data = await meetingsRes.json();
                setMeetings(data.meetings || []);
            }
            if (actionsRes.ok) {
                const data = await actionsRes.json();
                setQuickActions(data.actions || []);
            }
        } catch (e: any) {
            setError(e.message || "Failed to load War Room data");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Poll for command result
    useEffect(() => {
        if (!commandSessionId) return;
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`${API_BASE}/api/war-room/command/${commandSessionId}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === "completed" || data.status === "error") {
                        setCommandResult(data.result || data.message || "Done");
                        setCommandLoading(false);
                        setCommandSessionId(null);
                        fetchData(); // Refresh meetings list
                    }
                }
            } catch { }
        }, 3000);
        return () => clearInterval(interval);
    }, [commandSessionId, fetchData]);

    // Send command
    const sendCommand = async (msg?: string, agent?: string, meetingType?: string) => {
        const finalMsg = msg || command;
        if (!finalMsg.trim()) return;

        setCommandLoading(true);
        setCommandResult(null);

        try {
            const res = await fetch(`${API_BASE}/api/war-room/command`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: finalMsg,
                    agent: agent || selectedAgent,
                    meeting_type: meetingType || "quick_ask",
                }),
            });
            if (res.ok) {
                const data = await res.json();
                setCommandSessionId(data.session_id);
                setCommand("");
            } else {
                setCommandResult("Error sending command");
                setCommandLoading(false);
            }
        } catch (e: any) {
            setCommandResult(`Error: ${e.message}`);
            setCommandLoading(false);
        }
    };

    // Meeting detail modal
    if (selectedMeeting) {
        return (
            <div className="space-y-4">
                <button
                    onClick={() => setSelectedMeeting(null)}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-white transition-colors"
                >
                    ← Back to War Room
                </button>
                <MeetingDetail meetingId={selectedMeeting} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
                        <Shield className="h-5 w-5 text-red-400" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-white">War Room</h2>
                        <p className="text-sm text-muted-foreground">
                            Agent meetings • {meetings.length} sessions logged
                        </p>
                    </div>
                </div>
                <button
                    onClick={fetchData}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    Refresh
                </button>
            </div>

            {/* Quick Actions */}
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                <h3 className="mb-3 text-sm font-semibold text-red-400 flex items-center gap-2">
                    <Target className="h-4 w-4" /> Quick Actions
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    {quickActions.map((action) => (
                        <button
                            key={action.id}
                            disabled={commandLoading}
                            onClick={() => sendCommand(action.command, action.agent, action.meeting_type)}
                            className="group rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-red-500/30 hover:bg-red-500/5 disabled:opacity-50"
                        >
                            <span className="text-sm font-medium text-white block">{action.label}</span>
                            <span className="text-xs text-muted-foreground mt-1 block">{action.description}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
                {/* Meeting History — 3 cols */}
                <div className="lg:col-span-3 rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-4 text-sm font-semibold text-white flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        Meeting History
                    </h3>
                    {meetings.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                            <MessageSquare className="h-10 w-10 mb-3 opacity-30" />
                            <p className="text-sm">Chưa có meeting nào được ghi lại.</p>
                            <p className="text-xs mt-1">Chạy <code className="rounded bg-muted/50 px-1.5 py-0.5">python agents/crew/run.py --meeting daily_standup</code> để tạo meeting đầu tiên.</p>
                        </div>
                    ) : (
                        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                            {meetings.map((m) => {
                                const badge = MEETING_BADGES[m.meeting_type] || MEETING_BADGES.quick_ask;
                                return (
                                    <button
                                        key={m.id}
                                        onClick={() => setSelectedMeeting(m.id)}
                                        className="w-full flex items-center justify-between rounded-lg bg-muted/30 px-4 py-3 text-left transition-all hover:bg-muted/50 group"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", badge.color)}>
                                                    {badge.label}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {new Date(m.timestamp).toLocaleString("vi-VN")}
                                                </span>
                                            </div>
                                            {m.agenda && (
                                                <p className="mt-1 text-sm text-white truncate">{m.agenda}</p>
                                            )}
                                            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                                                <span className="flex items-center gap-1">
                                                    <Users className="h-3 w-3" />{m.agents.join(", ")}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <MessageSquare className="h-3 w-3" />{m.message_count} msgs
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3" />{Math.round(m.duration_seconds)}s
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-right ml-3 shrink-0">
                                            <span className="text-sm font-mono text-white">
                                                ${m.cost?.total_usd?.toFixed(4) || "0.0000"}
                                            </span>
                                            <p className="text-xs text-muted-foreground">
                                                {(m.tokens?.total || 0).toLocaleString()} tokens
                                            </p>
                                            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-white transition-colors mt-1 ml-auto" />
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* CEO Command Center — 2 cols */}
                <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5 flex flex-col">
                    <h3 className="mb-4 text-sm font-semibold text-white flex items-center gap-2">
                        <Terminal className="h-4 w-4 text-red-400" />
                        CEO Command Center
                    </h3>

                    {/* Agent selector */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                        {["chairman", "cmo", "cfo", "coo", "cto", "cso"].map((agent) => {
                            const colors = AGENT_COLORS[agent.toUpperCase()] || AGENT_COLORS.Chairman;
                            return (
                                <button
                                    key={agent}
                                    onClick={() => setSelectedAgent(agent)}
                                    className={cn(
                                        "rounded-md border px-2.5 py-1 text-xs font-medium transition-all",
                                        selectedAgent === agent
                                            ? `${colors.bg} ${colors.text} ${colors.border}`
                                            : "border-border text-muted-foreground hover:text-white"
                                    )}
                                >
                                    {agent.toUpperCase()}
                                </button>
                            );
                        })}
                    </div>

                    {/* Result area */}
                    <div className="flex-1 rounded-lg bg-muted/20 p-3 mb-3 min-h-[200px] max-h-[400px] overflow-y-auto">
                        {commandLoading ? (
                            <div className="flex flex-col items-center justify-center h-full py-8">
                                <Loader2 className="h-8 w-8 animate-spin text-red-400 mb-3" />
                                <p className="text-sm text-muted-foreground">
                                    {selectedAgent.toUpperCase()} đang xử lý...
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Có thể mất 1-5 phút tùy loại meeting
                                </p>
                            </div>
                        ) : commandResult ? (
                            <div className="prose prose-invert prose-sm max-w-none">
                                <pre className="whitespace-pre-wrap text-xs text-white/80 font-mono leading-relaxed">
                                    {commandResult}
                                </pre>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full py-8 text-muted-foreground">
                                <Bot className="h-10 w-10 mb-3 opacity-30" />
                                <p className="text-sm">Giao việc cho AI agents</p>
                                <p className="text-xs mt-1">Chọn agent → nhập lệnh → Enter</p>
                            </div>
                        )}
                    </div>

                    {/* Command input */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && sendCommand()}
                            placeholder={`Hỏi ${selectedAgent.toUpperCase()}...`}
                            disabled={commandLoading}
                            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-muted-foreground focus:border-red-500/50 focus:outline-none focus:ring-1 focus:ring-red-500/20 disabled:opacity-50"
                        />
                        <button
                            onClick={() => sendCommand()}
                            disabled={commandLoading || !command.trim()}
                            className="inline-flex items-center justify-center rounded-lg bg-red-500/20 border border-red-500/30 px-3 py-2 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-30"
                        >
                            <Send className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </div>

            {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {error}
                </div>
            )}
        </div>
    );
}
