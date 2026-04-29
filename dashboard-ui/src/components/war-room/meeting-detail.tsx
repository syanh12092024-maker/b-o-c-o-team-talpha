"use client";

import { useState, useEffect } from "react";
import {
    Users, Clock, DollarSign, Hash, Bot,
    Loader2, Wrench, Brain, CheckCircle2,
    AlertTriangle, MessageSquare, Lightbulb,
    ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────
interface MeetingMessage {
    seq: number;
    timestamp: string;
    agent: string;
    type: string; // "reasoning" | "tool_call" | "final_answer" | "step" | "error"
    content: string;
    thought: string;
    tool_used: string;
    tool_input: string;
}

interface MeetingRecord {
    id: string;
    timestamp: string;
    end_time: string;
    meeting_type: string;
    agenda: string;
    agents: string[];
    duration_seconds: number;
    tokens: { total: number; prompt: number; completion: number };
    cost: { total_usd: number };
    message_count: number;
    messages: MeetingMessage[];
    proposals: string[];
    final_summary: string;
    status: string;
}

// ── Config ─────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_WAR_ROOM_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

const AGENT_AVATARS: Record<string, { emoji: string; color: string; bg: string }> = {
    CMO: { emoji: "🎯", color: "text-pink-400", bg: "bg-pink-500/10 border-pink-500/30" },
    CFO: { emoji: "💰", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
    COO: { emoji: "📦", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/30" },
    CTO: { emoji: "⚙️", color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/30" },
    CSO: { emoji: "🧭", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
    Chairman: { emoji: "🏛️", color: "text-white", bg: "bg-white/10 border-white/20" },
    CHAIRMAN: { emoji: "🏛️", color: "text-white", bg: "bg-white/10 border-white/20" },
    Unknown: { emoji: "🤖", color: "text-gray-400", bg: "bg-gray-500/10 border-gray-500/30" },
};

const MSG_TYPE_ICON: Record<string, { icon: any; color: string }> = {
    reasoning: { icon: Brain, color: "text-indigo-400" },
    tool_call: { icon: Wrench, color: "text-cyan-400" },
    final_answer: { icon: CheckCircle2, color: "text-emerald-400" },
    step: { icon: Bot, color: "text-muted-foreground" },
    error: { icon: AlertTriangle, color: "text-red-400" },
};

// ── Component ──────────────────────────────────────────────────

interface Props {
    meetingId: string;
}

export default function MeetingDetail({ meetingId }: Props) {
    const [meeting, setMeeting] = useState<MeetingRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedMsgs, setExpandedMsgs] = useState<Set<number>>(new Set());
    const [showAllMessages, setShowAllMessages] = useState(false);

    useEffect(() => {
        async function fetchDetail() {
            setLoading(true);
            try {
                const res = await fetch(`${API_BASE}/api/war-room/meetings/${meetingId}`);
                if (!res.ok) throw new Error("Meeting not found");
                setMeeting(await res.json());
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        }
        fetchDetail();
    }, [meetingId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-red-400" />
            </div>
        );
    }

    if (error || !meeting) {
        return (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-red-400">
                {error || "Meeting not found"}
            </div>
        );
    }

    const toggleMsg = (seq: number) => {
        setExpandedMsgs((prev) => {
            const next = new Set(prev);
            if (next.has(seq)) next.delete(seq);
            else next.add(seq);
            return next;
        });
    };

    // Group messages by agent for final answers only
    const displayMessages = showAllMessages
        ? meeting.messages
        : meeting.messages.filter(m => m.type === "final_answer" || m.type === "reasoning");

    return (
        <div className="space-y-6">
            {/* Meeting Header */}
            <div className="rounded-xl border border-red-500/20 bg-gradient-to-r from-red-500/5 to-transparent p-5">
                <div className="flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
                                {meeting.meeting_type.replace(/_/g, " ").toUpperCase()}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                {new Date(meeting.timestamp).toLocaleString("vi-VN")}
                            </span>
                        </div>
                        {meeting.agenda && (
                            <h3 className="text-lg font-semibold text-white mb-2">{meeting.agenda}</h3>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                            {meeting.agents.map((agent) => {
                                const av = AGENT_AVATARS[agent] || AGENT_AVATARS.Unknown;
                                return (
                                    <span
                                        key={agent}
                                        className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium", av.bg, av.color)}
                                    >
                                        {av.emoji} {agent}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                    <div className="text-right shrink-0">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <span className="text-muted-foreground flex items-center gap-1">
                                <DollarSign className="h-3 w-3" /> Cost
                            </span>
                            <span className="text-white font-mono">
                                ${meeting.cost?.total_usd?.toFixed(4) || "0.0000"}
                            </span>
                            <span className="text-muted-foreground flex items-center gap-1">
                                <Hash className="h-3 w-3" /> Tokens
                            </span>
                            <span className="text-white font-mono">
                                {(meeting.tokens?.total || 0).toLocaleString()}
                            </span>
                            <span className="text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" /> Duration
                            </span>
                            <span className="text-white">
                                {Math.round(meeting.duration_seconds)}s
                            </span>
                            <span className="text-muted-foreground flex items-center gap-1">
                                <MessageSquare className="h-3 w-3" /> Steps
                            </span>
                            <span className="text-white">
                                {meeting.message_count}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Proposals */}
            {meeting.proposals.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                    <h4 className="text-sm font-semibold text-amber-400 flex items-center gap-2 mb-3">
                        <Lightbulb className="h-4 w-4" /> Đề xuất sau cuộc họp
                    </h4>
                    <ul className="space-y-1.5">
                        {meeting.proposals.map((p, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-white/80">
                                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-xs text-amber-400 font-medium">
                                    {i + 1}
                                </span>
                                {p}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Chat Timeline */}
            <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        Agent Conversations
                    </h4>
                    <button
                        onClick={() => setShowAllMessages(!showAllMessages)}
                        className="text-xs text-muted-foreground hover:text-white transition-colors"
                    >
                        {showAllMessages ? "Show key messages only" : `Show all ${meeting.messages.length} steps`}
                    </button>
                </div>

                <div className="space-y-3">
                    {displayMessages.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                            Không có messages. Hãy chạy một meeting mới để xem agent conversations.
                        </p>
                    ) : (
                        displayMessages.map((msg) => {
                            const av = AGENT_AVATARS[msg.agent] || AGENT_AVATARS.Unknown;
                            const typeInfo = MSG_TYPE_ICON[msg.type] || MSG_TYPE_ICON.step;
                            const TypeIcon = typeInfo.icon;
                            const isExpanded = expandedMsgs.has(msg.seq);
                            const isLong = msg.content.length > 300;

                            return (
                                <div
                                    key={msg.seq}
                                    className={cn(
                                        "rounded-lg border p-3 transition-colors",
                                        msg.type === "final_answer"
                                            ? "border-emerald-500/20 bg-emerald-500/5"
                                            : msg.type === "error"
                                                ? "border-red-500/20 bg-red-500/5"
                                                : "border-border bg-muted/20"
                                    )}
                                >
                                    {/* Agent header */}
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className={cn("flex h-7 w-7 items-center justify-center rounded-md border text-sm", av.bg)}>
                                                {av.emoji}
                                            </span>
                                            <span className={cn("text-sm font-medium", av.color)}>
                                                {msg.agent || "System"}
                                            </span>
                                            <span className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium", typeInfo.color, "bg-white/5")}>
                                                <TypeIcon className="h-3 w-3" />
                                                {msg.type.replace(/_/g, " ")}
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-muted-foreground">
                                            #{msg.seq} • {new Date(msg.timestamp).toLocaleTimeString("vi-VN")}
                                        </span>
                                    </div>

                                    {/* Tool info */}
                                    {msg.tool_used && (
                                        <div className="mb-2 flex items-center gap-2 text-xs text-cyan-400">
                                            <Wrench className="h-3 w-3" />
                                            <code className="rounded bg-cyan-500/10 px-1.5 py-0.5">{msg.tool_used}</code>
                                        </div>
                                    )}

                                    {/* Content */}
                                    <div className="text-sm text-white/80 whitespace-pre-wrap font-mono leading-relaxed">
                                        {isLong && !isExpanded
                                            ? msg.content.slice(0, 300) + "..."
                                            : msg.content}
                                    </div>

                                    {/* Expand button */}
                                    {isLong && (
                                        <button
                                            onClick={() => toggleMsg(msg.seq)}
                                            className="mt-2 text-xs text-muted-foreground hover:text-white transition-colors"
                                        >
                                            {isExpanded ? "Thu gọn ↑" : `Xem thêm (${msg.content.length} chars) ↓`}
                                        </button>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Final Summary */}
            {meeting.final_summary && (
                <div className="rounded-xl border border-border bg-card p-5">
                    <h4 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        Final Summary
                    </h4>
                    <div className="text-sm text-white/80 whitespace-pre-wrap font-mono leading-relaxed max-h-[400px] overflow-y-auto">
                        {meeting.final_summary}
                    </div>
                </div>
            )}
        </div>
    );
}
