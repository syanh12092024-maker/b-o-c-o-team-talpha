"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Coins, TrendingDown, Cpu, Zap, RefreshCw,
    ArrowDownRight, ArrowUpRight, Loader2,
} from "lucide-react";
import { cn } from "../utils";

// ── Types ──────────────────────────────────────────────────────
interface TokenSummary {
    date: string;
    total_runs: number;
    total_cost_usd: number;
    total_tokens: number;
    total_savings_usd: number;
    avg_cache_rate: number;
    by_agent: Record<string, { runs: number; cost_usd: number; tokens: number }>;
}

interface RunEntry {
    timestamp: string;
    date: string;
    meeting_type: string;
    model: string;
    agents_used: string[];
    tokens: { prompt: number; completion: number; cached: number; total: number };
    cost: {
        input: number; cached_input: number; output: number;
        total_usd: number; savings_usd: number; savings_pct: number;
    };
    duration_seconds: number;
}

// ── API Base ───────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function TokenCostTab() {
    const [summary, setSummary] = useState<TokenSummary | null>(null);
    const [runs, setRuns] = useState<RunEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [summaryRes, runsRes] = await Promise.all([
                fetch(`${API_BASE}/api/token-usage/summary`),
                fetch(`${API_BASE}/api/token-usage/all-runs`),
            ]);
            if (!summaryRes.ok || !runsRes.ok) throw new Error("API error");
            setSummary(await summaryRes.json());
            setRuns(await runsRes.json());
        } catch (e: any) {
            setError(e.message || "Failed to load data");
            // Fallback: try to show local data
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Calculate MTD totals from all runs
    const mtdCost = runs.reduce((s, r) => s + r.cost.total_usd, 0);
    const mtdTokens = runs.reduce((s, r) => s + r.tokens.total, 0);
    const mtdSavings = runs.reduce((s, r) => s + r.cost.savings_usd, 0);
    const avgCostPerRun = runs.length > 0 ? mtdCost / runs.length : 0;

    // Agent breakdown across all runs
    const agentMap: Record<string, { runs: number; cost: number; tokens: number }> = {};
    runs.forEach(r => {
        const perAgent = r.cost.total_usd / Math.max(r.agents_used.length, 1);
        const tokPerAgent = r.tokens.total / Math.max(r.agents_used.length, 1);
        r.agents_used.forEach(a => {
            if (!agentMap[a]) agentMap[a] = { runs: 0, cost: 0, tokens: 0 };
            agentMap[a].runs += 1;
            agentMap[a].cost += perAgent;
            agentMap[a].tokens += tokPerAgent;
        });
    });

    const agentColors: Record<string, string> = {
        CMO: "text-pink-400", CFO: "text-green-400", COO: "text-blue-400",
        CTO: "text-purple-400", CSO: "text-amber-400", CHAIRMAN: "text-foreground",
    };

    return (
        <div className="space-y-6">
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-foreground">AI Token Cost Tracker</h2>
                        <p className="text-sm text-muted-foreground">
                            Realtime monitoring — OpenAI GPT-4o-mini
                        </p>
                    </div>
                    <button
                        onClick={fetchData}
                        disabled={loading}
                        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                        Refresh
                    </button>
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <KPICard
                        label="Today's Cost"
                        value={`$${(summary?.total_cost_usd ?? 0).toFixed(4)}`}
                        sub={`${summary?.total_runs ?? 0} runs`}
                        icon={Coins}
                        color="text-amber-400"
                        bgColor="bg-amber-500/10"
                    />
                    <KPICard
                        label="Month-to-Date"
                        value={`$${mtdCost.toFixed(4)}`}
                        sub={`${mtdTokens.toLocaleString()} tokens`}
                        icon={TrendingDown}
                        color="text-indigo-400"
                        bgColor="bg-indigo-500/10"
                    />
                    <KPICard
                        label="Avg Cost / Run"
                        value={`$${avgCostPerRun.toFixed(4)}`}
                        sub={`${runs.length} total runs`}
                        icon={Cpu}
                        color="text-cyan-400"
                        bgColor="bg-cyan-500/10"
                    />
                    <KPICard
                        label="Cache Savings"
                        value={`$${mtdSavings.toFixed(4)}`}
                        sub={
                            <span className="inline-flex items-center gap-1 text-emerald-400">
                                <ArrowDownRight className="h-3 w-3" />
                                {summary?.avg_cache_rate ?? 0}% cache hit
                            </span>
                        }
                        icon={Zap}
                        color="text-emerald-400"
                        bgColor="bg-emerald-500/10"
                    />
                </div>

                {/* Prompt Caching Status */}
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                            <Zap className="h-5 w-5 text-emerald-400" />
                        </div>
                        <div>
                            <h3 className="font-medium text-emerald-400">OpenAI Prompt Caching — Active</h3>
                            <p className="text-xs text-muted-foreground">
                                System prompts ({">"}1024 tokens) tự động cached, giảm 50% input cost.
                                GPT-4o-mini: $0.15/M input → $0.075/M cached.
                            </p>
                        </div>
                        <span className="ml-auto rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-400">
                            ON
                        </span>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {/* Agent Cost Breakdown */}
                    <div className="rounded-xl border border-border bg-card p-5">
                        <h3 className="mb-4 text-sm font-semibold text-foreground">Cost per Agent</h3>
                        {Object.keys(agentMap).length === 0 ? (
                            <p className="text-sm text-muted-foreground">Chưa có dữ liệu. Chạy một meeting để bắt đầu tracking.</p>
                        ) : (
                            <div className="space-y-3">
                                {Object.entries(agentMap)
                                    .sort((a, b) => b[1].cost - a[1].cost)
                                    .map(([agent, data]) => (
                                        <div key={agent} className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <span className={cn(
                                                    "flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold",
                                                    agentColors[agent] || "text-foreground",
                                                    "bg-gray-50"
                                                )}>
                                                    {agent.slice(0, 3)}
                                                </span>
                                                <div>
                                                    <span className="text-sm font-medium text-foreground">{agent}</span>
                                                    <p className="text-xs text-muted-foreground">
                                                        {data.runs} runs • {Math.round(data.tokens).toLocaleString()} tokens
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-sm font-mono text-foreground">
                                                    ${data.cost.toFixed(4)}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>

                    {/* Recent Runs */}
                    <div className="rounded-xl border border-border bg-card p-5">
                        <h3 className="mb-4 text-sm font-semibold text-foreground">Recent Runs</h3>
                        {runs.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Chưa có dữ liệu.</p>
                        ) : (
                            <div className="space-y-2 max-h-80 overflow-y-auto">
                                {runs.slice().reverse().slice(0, 20).map((run, idx) => (
                                    <div
                                        key={idx}
                                        className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2"
                                    >
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className={cn(
                                                    "rounded px-1.5 py-0.5 text-xs font-medium",
                                                    run.meeting_type === "daily_standup" ? "bg-indigo-500/10 text-indigo-400" :
                                                        run.meeting_type === "strategy" ? "bg-amber-500/10 text-amber-400" :
                                                            "bg-cyan-500/10 text-cyan-400"
                                                )}>
                                                    {run.meeting_type.replace("_", " ")}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {new Date(run.timestamp).toLocaleTimeString()}
                                                </span>
                                            </div>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {run.agents_used.join(", ")} • {run.tokens.total.toLocaleString()} tokens
                                                {run.tokens.cached > 0 && (
                                                    <span className="text-emerald-400"> ({run.cost.savings_pct}% cached)</span>
                                                )}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-sm font-mono text-foreground">
                                                ${run.cost.total_usd.toFixed(4)}
                                            </span>
                                            <p className="text-xs text-muted-foreground">
                                                {run.duration_seconds.toFixed(0)}s
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Pricing Reference */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Pricing Reference — GPT-4o-mini</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="pb-2 text-left font-medium text-muted-foreground">Type</th>
                                    <th className="pb-2 text-right font-medium text-muted-foreground">Price / 1M tokens</th>
                                    <th className="pb-2 text-right font-medium text-muted-foreground">Per 1K tokens</th>
                                </tr>
                            </thead>
                            <tbody className="text-foreground">
                                <tr className="border-b border-border/50">
                                    <td className="py-2">Input</td>
                                    <td className="py-2 text-right font-mono">$0.150</td>
                                    <td className="py-2 text-right font-mono text-muted-foreground">$0.00015</td>
                                </tr>
                                <tr className="border-b border-border/50">
                                    <td className="py-2">
                                        Cached Input
                                        <span className="ml-2 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-400">-50%</span>
                                    </td>
                                    <td className="py-2 text-right font-mono text-emerald-400">$0.075</td>
                                    <td className="py-2 text-right font-mono text-muted-foreground">$0.000075</td>
                                </tr>
                                <tr>
                                    <td className="py-2">Output</td>
                                    <td className="py-2 text-right font-mono">$0.600</td>
                                    <td className="py-2 text-right font-mono text-muted-foreground">$0.0006</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                {error && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── KPI Card Component ─────────────────────────────────────────
function KPICard({ label, value, sub, icon: Icon, color, bgColor }: {
    label: string;
    value: string;
    sub: React.ReactNode;
    icon: any;
    color: string;
    bgColor: string;
}) {
    return (
        <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{label}</span>
                <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", bgColor)}>
                    <Icon className={cn("h-4 w-4", color)} />
                </div>
            </div>
            <div className="mt-2">
                <span className="text-2xl font-bold text-foreground">{value}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
        </div>
    );
}
