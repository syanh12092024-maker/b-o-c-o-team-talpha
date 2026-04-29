"use client";

import React, { useEffect, useState } from "react";
import {
    TrendingUp, TrendingDown, Minus, RefreshCw,
    ArrowUpCircle, ArrowDownCircle, PauseCircle,
    DollarSign, AlertTriangle
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Suggestion {
    campaign_id: string;
    campaign_name: string;
    market: string;
    current_spend_daily: number;
    roas_3d: number;
    roas_7d: number;
    roas_trend: string;
    action: string;
    suggested_change_pct: number;
    reason: string;
    priority: string;
}

interface BudgetData {
    total_campaigns: number;
    increase_count: number;
    decrease_count: number;
    hold_count: number;
    suggestions: Suggestion[];
}

const ACTION_STYLES: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    INCREASE: { bg: "bg-emerald-500/10 border-emerald-500/30", text: "text-emerald-400", icon: <ArrowUpCircle className="w-4 h-4" /> },
    DECREASE: { bg: "bg-red-500/10 border-red-500/30", text: "text-red-400", icon: <ArrowDownCircle className="w-4 h-4" /> },
    HOLD: { bg: "bg-zinc-500/10 border-zinc-500/30", text: "text-zinc-400", icon: <PauseCircle className="w-4 h-4" /> },
};

const TREND_ICONS: Record<string, React.ReactNode> = {
    improving: <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />,
    declining: <TrendingDown className="w-3.5 h-3.5 text-red-400" />,
    stable: <Minus className="w-3.5 h-3.5 text-zinc-400" />,
};

export default function BudgetTab() {
    const [data, setData] = useState<BudgetData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [market, setMarket] = useState("ALL");

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API}/api/budget/suggestions?market=${market}`);
            if (!res.ok) throw new Error(`API error: ${res.status}`);
            const json = await res.json();
            // Ensure suggestions is always an array
            setData({
                total_campaigns: json.total_campaigns || 0,
                increase_count: json.increase_count || 0,
                decrease_count: json.decrease_count || 0,
                hold_count: json.hold_count || 0,
                suggestions: Array.isArray(json.suggestions) ? json.suggestions : [],
            });
        } catch (e: any) {
            console.error("Budget fetch error:", e);
            setError(e.message || "Không thể kết nối Budget API");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, [market]);

    if (loading) return <div className="p-8 text-muted-foreground animate-pulse">Loading budget suggestions...</div>;

    if (error) return (
        <div className="flex flex-col items-center justify-center p-12 text-center space-y-3">
            <AlertTriangle className="h-10 w-10 text-amber-500" />
            <h3 className="text-lg font-semibold text-foreground">Budget Optimizer chưa sẵn sàng</h3>
            <p className="text-sm text-muted-foreground max-w-md">
                API backend (<code className="text-xs bg-muted px-1.5 py-0.5 rounded">{API}/api/budget/suggestions</code>) chưa có endpoint này.
                Cần triển khai thêm trên FAOS Brain.
            </p>
            <button onClick={fetchData} className="mt-2 flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition">
                <RefreshCw className="h-4 w-4" /> Thử lại
            </button>
        </div>
    );

    if (!data) return <div className="p-8 text-muted-foreground">No data available</div>;

    const suggestions = data.suggestions || [];

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-amber-400" />
                        Budget Optimizer
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        AI-powered budget reallocation based on ROAS trends
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={market}
                        onChange={(e) => setMarket(e.target.value)}
                        className="bg-muted text-foreground text-xs rounded px-2 py-1.5 border border-border"
                    >
                        <option value="ALL">All Markets</option>
                        <option value="AU">AU Only</option>
                        <option value="US">US Only</option>
                    </select>
                    <button onClick={fetchData} className="p-1.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground">
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-emerald-500 dark:text-emerald-400">{data.increase_count}</div>
                    <div className="text-xs text-muted-foreground">Scale Up</div>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-red-500 dark:text-red-400">{data.decrease_count}</div>
                    <div className="text-xs text-muted-foreground">Cut Budget</div>
                </div>
                <div className="bg-zinc-500/5 border border-zinc-500/20 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-muted-foreground">{data.hold_count}</div>
                    <div className="text-xs text-muted-foreground">Hold</div>
                </div>
            </div>

            {/* Table */}
            <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-muted/50 text-muted-foreground">
                            <th className="text-left py-2.5 px-3 font-medium">Campaign</th>
                            <th className="text-center py-2.5 px-2 font-medium">Market</th>
                            <th className="text-right py-2.5 px-2 font-medium">$/Day</th>
                            <th className="text-right py-2.5 px-2 font-medium">3d ROAS</th>
                            <th className="text-right py-2.5 px-2 font-medium">7d ROAS</th>
                            <th className="text-center py-2.5 px-2 font-medium">Trend</th>
                            <th className="text-center py-2.5 px-3 font-medium">Action</th>
                            <th className="text-left py-2.5 px-3 font-medium">Reason</th>
                        </tr>
                    </thead>
                    <tbody>
                        {suggestions.map((s, i) => {
                            const style = ACTION_STYLES[s.action] || ACTION_STYLES.HOLD;
                            return (
                                <tr key={i} className={`border-t border-border hover:bg-muted/30 ${style.bg}`}>
                                    <td className="py-2 px-3 text-foreground font-medium truncate max-w-[200px]">
                                        {s.campaign_name.length > 35 ? s.campaign_name.slice(0, 35) + "..." : s.campaign_name}
                                    </td>
                                    <td className="py-2 px-2 text-center">
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{s.market}</span>
                                    </td>
                                    <td className="py-2 px-2 text-right text-foreground">${s.current_spend_daily.toFixed(0)}</td>
                                    <td className={`py-2 px-2 text-right font-medium ${s.roas_3d >= 2 ? "text-emerald-500 dark:text-emerald-400" : s.roas_3d < 1 ? "text-red-500 dark:text-red-400" : "text-amber-500 dark:text-amber-400"}`}>
                                        {s.roas_3d.toFixed(1)}x
                                    </td>
                                    <td className="py-2 px-2 text-right text-muted-foreground">{s.roas_7d.toFixed(1)}x</td>
                                    <td className="py-2 px-2 text-center">{TREND_ICONS[s.roas_trend]}</td>
                                    <td className="py-2 px-3 text-center">
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${style.text} ${style.bg} border`}>
                                            {style.icon}
                                            {s.action} {s.suggested_change_pct !== 0 && `${s.suggested_change_pct > 0 ? "+" : ""}${s.suggested_change_pct}%`}
                                        </span>
                                    </td>
                                    <td className="py-2 px-3 text-muted-foreground truncate max-w-[200px]">{s.reason}</td>
                                </tr>
                            );
                        })}
                        {suggestions.length === 0 && (
                            <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">No campaigns with enough spend data</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
