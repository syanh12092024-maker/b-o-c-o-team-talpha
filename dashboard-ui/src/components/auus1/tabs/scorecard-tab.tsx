"use client";

import React, { useEffect, useState } from "react";
import { Trophy, Medal, Users, TrendingUp, ChevronRight, RefreshCw, X } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Marketer {
    mkter_code: string;
    total_spend: number;
    total_revenue: number;
    total_orders: number;
    avg_roas: number;
    products_tested: number;
    products_winning: number;
    cpa_usd: number;
    overall_rank: number;
    roas_rank: number;
}

interface DetailData {
    mkter_code: string;
    weekly_history: Array<{
        week_start: string;
        spend: number;
        revenue: number;
        orders: number;
        roas: number;
        products: number;
    }>;
    top_campaigns_this_week: Array<{
        campaign_name: string;
        spend: number;
        roas: number;
        orders: number;
    }>;
}

const RANK_STYLES: Record<number, { bg: string; icon: React.ReactNode; label: string }> = {
    1: { bg: "from-amber-500/20 to-amber-600/5 border-amber-500/40", icon: <Trophy className="w-5 h-5 text-amber-400" />, label: "🥇" },
    2: { bg: "from-zinc-300/15 to-zinc-400/5 border-zinc-400/30", icon: <Medal className="w-5 h-5 text-zinc-300" />, label: "🥈" },
    3: { bg: "from-orange-600/15 to-orange-700/5 border-orange-600/30", icon: <Medal className="w-5 h-5 text-orange-400" />, label: "🥉" },
};

export default function ScorecardTab() {
    const [marketers, setMarketers] = useState<Marketer[]>([]);
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState<DetailData | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API}/api/scorecard`);
            const json = await res.json();
            setMarketers(json.leaderboard || []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const fetchDetail = async (code: string) => {
        setDetailLoading(true);
        try {
            const res = await fetch(`${API}/api/scorecard/${code}`);
            const json = await res.json();
            setDetail(json);
        } catch (e) { console.error(e); }
        finally { setDetailLoading(false); }
    };

    useEffect(() => { fetchData(); }, []);

    if (loading) return <div className="p-8 text-zinc-400 animate-pulse">Loading scorecard...</div>;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <Trophy className="w-5 h-5 text-amber-400" />
                        Marketer Scorecard
                    </h2>
                    <p className="text-xs text-zinc-400 mt-0.5">Weekly performance leaderboard</p>
                </div>
                <button onClick={fetchData} className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400">
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Leaderboard */}
                <div className="space-y-2">
                    {marketers.length === 0 && (
                        <div className="text-center py-12 text-zinc-500">No marketer data this week</div>
                    )}
                    {marketers.map((m, i) => {
                        const rank = i + 1;
                        const style = RANK_STYLES[rank] || {
                            bg: "from-zinc-800/50 to-zinc-900/50 border-zinc-700/50",
                            icon: <Users className="w-5 h-5 text-zinc-500" />,
                            label: `#${rank}`,
                        };
                        return (
                            <div
                                key={m.mkter_code}
                                onClick={() => fetchDetail(m.mkter_code)}
                                className={`bg-gradient-to-r ${style.bg} border rounded-lg p-3 cursor-pointer hover:brightness-110 transition-all`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="text-xl">{style.label}</span>
                                        <div>
                                            <div className="text-white font-semibold text-sm">{m.mkter_code}</div>
                                            <div className="text-[10px] text-zinc-400">
                                                {m.products_tested} products tested · {m.products_winning} winning
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className={`text-sm font-bold ${m.avg_roas >= 2 ? "text-emerald-400" : m.avg_roas >= 1 ? "text-amber-400" : "text-red-400"}`}>
                                            {m.avg_roas.toFixed(1)}x ROAS
                                        </div>
                                        <div className="text-[10px] text-zinc-400">
                                            ${m.total_spend.toFixed(0)} spent · {m.total_orders} orders
                                        </div>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-zinc-500 ml-2" />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Detail panel */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 min-h-[300px]">
                    {!detail && !detailLoading && (
                        <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
                            Click a marketer to see details
                        </div>
                    )}
                    {detailLoading && <div className="text-zinc-400 animate-pulse p-4">Loading...</div>}
                    {detail && !detailLoading && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-white font-semibold">{detail.mkter_code}</h3>
                                <button onClick={() => setDetail(null)} className="text-zinc-500 hover:text-white">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            <div>
                                <h4 className="text-xs text-zinc-400 mb-2 font-medium">Weekly History</h4>
                                <div className="space-y-1.5">
                                    {detail.weekly_history.map((w, i) => (
                                        <div key={i} className="flex items-center justify-between text-xs bg-zinc-800/50 rounded px-2.5 py-1.5">
                                            <span className="text-zinc-400 w-20">{w.week_start}</span>
                                            <span className={`font-medium ${w.roas >= 2 ? "text-emerald-400" : "text-zinc-300"}`}>{w.roas.toFixed(1)}x</span>
                                            <span className="text-zinc-400">${w.spend.toFixed(0)}</span>
                                            <span className="text-zinc-300">{w.orders} orders</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {detail.top_campaigns_this_week.length > 0 && (
                                <div>
                                    <h4 className="text-xs text-zinc-400 mb-2 font-medium">Top Campaigns This Week</h4>
                                    {detail.top_campaigns_this_week.map((c, i) => (
                                        <div key={i} className="text-xs text-zinc-300 py-1 border-b border-zinc-800/50">
                                            <div className="truncate">{c.campaign_name}</div>
                                            <div className="flex gap-3 mt-0.5 text-[10px] text-zinc-500">
                                                <span>ROAS: {c.roas}x</span>
                                                <span>${c.spend}</span>
                                                <span>{c.orders} orders</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
