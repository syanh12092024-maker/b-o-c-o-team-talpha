"use client";

import { useState } from "react";
import { Send, Bot, User, Loader2 } from "lucide-react";
import { cn } from "../utils";

interface Message {
    role: "user" | "agent";
    content: string;
}

export default function AssistantTab() {
    const [query, setQuery] = useState("");
    const [messages, setMessages] = useState<Message[]>([
        { role: "agent", content: "Xin chào! Tôi là Trợ lý AI của Stramark. Tôi đã được học toàn bộ quy trình và hướng dẫn của bạn. Bạn cần tìm thông tin gì?" }
    ]);
    const [loading, setLoading] = useState(false);

    const handleSearch = async () => {
        if (!query.trim()) return;

        const userMsg = query;
        setQuery("");
        setMessages(prev => [...prev, { role: "user", content: userMsg }]);
        setLoading(true);

        try {
            const res = await fetch("/api/agent/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: userMsg }),
            });

            const data = await res.json();

            if (data.error) {
                setMessages(prev => [...prev, { role: "agent", content: `Lỗi: ${data.error}` }]);
            } else {
                // Formatting the raw output a bit if needed, or just displaying
                setMessages(prev => [...prev, { role: "agent", content: data.result || "Không tìm thấy thông tin phù hợp." }]);
            }
        } catch (error) {
            setMessages(prev => [...prev, { role: "agent", content: "Lỗi kết nối đến Server." }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-[calc(100vh-10rem)] flex-col rounded-xl border border-border bg-card shadow-sm">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg, idx) => (
                    <div
                        key={idx}
                        className={cn(
                            "flex w-full gap-3",
                            msg.role === "user" ? "flex-row-reverse" : "flex-row"
                        )}
                    >
                        <div className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                            msg.role === "agent" ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-500" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                        )}>
                            {msg.role === "agent" ? <Bot className="h-5 w-5" /> : <User className="h-5 w-5" />}
                        </div>
                        <div className={cn(
                            "max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap",
                            msg.role === "agent" ? "bg-muted/50 text-foreground" : "bg-indigo-500 text-foreground"
                        )}>
                            {msg.content}
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="flex w-full gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-indigo-500/10 border-indigo-500/20 text-indigo-500">
                            <Bot className="h-5 w-5" />
                        </div>
                        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-4 py-2 text-sm text-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Đang tra cứu Knowledge Base...</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="border-t border-border p-4">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                        placeholder="Hỏi về quy trình, chính sách, hướng dẫn UTM..."
                        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={loading}
                    />
                    <button
                        onClick={handleSearch}
                        disabled={loading}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                        <Send className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
