"use client";

import React, { useState, useRef, useEffect } from "react";

import { API_BASE } from "@/lib/constants";

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    data?: any[];
}

export function CMOChat() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([
        {
            role: "assistant",
            content: "👋 Tôi là **CMO Agent**. Hỏi tôi về campaigns!\n\nVí dụ:\n• \"Camp nào chạy tốt hôm qua?\"\n• \"Nên tắt camp nào?\"\n• \"Trend tuần này\"\n• \"So sánh camp A vs camp B\""
        }
    ]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const sendMessage = async () => {
        if (!input.trim() || loading) return;
        const q = input.trim();
        setInput("");
        setMessages(prev => [...prev, { role: "user", content: q }]);
        setLoading(true);

        try {
            const res = await fetch(`${API_BASE}/api/cmo/ask`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: q }),
            });
            const data = await res.json();
            setMessages(prev => [...prev, {
                role: "assistant",
                content: data.answer || "Không có kết quả.",
                data: data.data
            }]);
        } catch (err) {
            setMessages(prev => [...prev, {
                role: "assistant",
                content: "❌ Lỗi kết nối server. Kiểm tra backend đang chạy."
            }]);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    // Safe markdown-like rendering (no dangerouslySetInnerHTML)
    const renderBoldText = (text: string): React.ReactNode[] => {
        const parts = text.split(/\*\*(.+?)\*\*/g);
        return parts.map((part, j) =>
            j % 2 === 1
                ? <strong key={j} className="text-white">{part}</strong>
                : <React.Fragment key={j}>{part}</React.Fragment>
        );
    };

    const renderContent = (text: string) => {
        return text.split("\n").map((line, i) => {
            // Bullet points
            if (line.startsWith("• ") || line.startsWith("- ")) {
                return <div key={i} className="ml-2 text-slate-300">{renderBoldText(line)}</div>;
            }
            // Table rows
            if (line.startsWith("|") && line.endsWith("|")) {
                if (line.includes("---|")) return null; // Skip separator
                const cells = line.split("|").filter(Boolean).map(c => c.trim());
                return (
                    <div key={i} className="grid grid-cols-3 gap-1 text-[10px] px-1 py-0.5 even:bg-slate-700/30">
                        {cells.map((cell, j) => (
                            <span key={j} className={j === 0 ? "text-slate-400" : "text-slate-200 text-right"}>
                                {cell}
                            </span>
                        ))}
                    </div>
                );
            }
            // Number list
            if (/^\d+\./.test(line)) {
                return <div key={i} className="ml-1 text-emerald-300">{renderBoldText(line)}</div>;
            }
            return <div key={i} className="text-slate-300">{renderBoldText(line)}</div>;
        });
    };

    // Quick action buttons
    const quickActions = [
        "Camp nào tốt hôm qua?",
        "Nên tắt camp nào?",
        "Báo cáo hôm nay",
        "Trend tuần này",
    ];

    return (
        <>
            {/* Floating button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-2xl shadow-indigo-500/30 flex items-center justify-center text-2xl hover:scale-110 transition-all duration-200 border-2 border-indigo-400/30"
            >
                {isOpen ? "✕" : "🤖"}
            </button>

            {/* Chat panel */}
            {isOpen && (
                <div className="fixed bottom-24 right-6 z-50 w-[380px] h-[520px] bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/40 flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="px-4 py-3 bg-gradient-to-r from-indigo-600/80 to-purple-600/80 border-b border-slate-700/50">
                        <div className="flex items-center gap-2">
                            <span className="text-xl">🤖</span>
                            <div>
                                <div className="text-sm font-bold text-white">CMO Agent</div>
                                <div className="text-[10px] text-indigo-200">
                                    Phân tích campaigns • Bộ nhớ lịch sử
                                </div>
                            </div>
                            <div className="ml-auto flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                <span className="text-[10px] text-emerald-300">Online</span>
                            </div>
                        </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                        {messages.map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${msg.role === "user"
                                    ? "bg-indigo-600/80 text-white rounded-br-sm"
                                    : "bg-slate-800/80 text-slate-200 border border-slate-700/50 rounded-bl-sm"
                                    }`}>
                                    {renderContent(msg.content)}
                                </div>
                            </div>
                        ))}
                        {loading && (
                            <div className="flex justify-start">
                                <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl px-4 py-3 text-xs">
                                    <div className="flex gap-1">
                                        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }}></span>
                                        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "150ms" }}></span>
                                        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "300ms" }}></span>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={chatEndRef} />
                    </div>

                    {/* Quick actions */}
                    <div className="px-3 pb-1 flex gap-1 flex-wrap">
                        {quickActions.map((qa, i) => (
                            <button
                                key={i}
                                onClick={() => { setInput(qa); }}
                                className="text-[10px] px-2 py-1 rounded-full bg-slate-800 border border-slate-700/50 text-slate-400 hover:text-indigo-300 hover:border-indigo-500/50 transition-all"
                            >
                                {qa}
                            </button>
                        ))}
                    </div>

                    {/* Input */}
                    <div className="p-3 border-t border-slate-700/50">
                        <div className="flex gap-2">
                            <input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Hỏi CMO..."
                                className="flex-1 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                            />
                            <button
                                onClick={sendMessage}
                                disabled={loading || !input.trim()}
                                className="px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm disabled:opacity-30 disabled:hover:bg-indigo-600 transition-colors"
                            >
                                ➤
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
