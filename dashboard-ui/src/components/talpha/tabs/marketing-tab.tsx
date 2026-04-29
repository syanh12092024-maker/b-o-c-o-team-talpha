"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer,
} from "recharts";
import { Megaphone, TrendingUp, DollarSign, Users, MessageCircle } from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { DATASET } from "../constants";
import { formatVNDCompact, toVND } from "../utils";

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

export default function TALPHAMarketingTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [marketers, setMarketers] = useState<any[]>([]);
    const [accounts, setAccounts] = useState<any[]>([]);
    const [summary, setSummary] = useState({ spend: 0, messages: 0, impressions: 0, cpm: 0 });

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    // Q0: Marketer performance with shop for VND conversion
                    `SELECT
                        COALESCE(NULLIF(o.marketer, ''), NULLIF(o.pke_mkter, ''), 'Unknown') as marketer,
                        o.shop_name,
                        COUNT(DISTINCT o.id) as orders,
                        ROUND(SUM(o.total_price), 2) as revenue
                    FROM \`levelup-465304.${DATASET}.sale_order\` o
                    WHERE DATE(o.inserted_at) BETWEEN '${from}' AND '${to}'
                      AND o.total_price > 0
                    GROUP BY 1, 2 ORDER BY revenue DESC`,

                    // Q1: Account breakdown (spend already VND)
                    `SELECT
                        account_id,
                        ROUND(SUM(spend), 0) as spend,
                        SUM(CAST(actions_message AS INT64)) as messages,
                        SUM(impressions) as impressions,
                        SUM(clicks) as clicks,
                        COUNT(DISTINCT campaign_id) as campaigns
                    FROM \`levelup-465304.${DATASET}.fb_ads_data\`
                    WHERE DATE(date_start) BETWEEN '${from}' AND '${to}' AND spend > 0
                    GROUP BY 1 ORDER BY spend DESC`,

                    // Q2: Total (spend already VND)
                    `SELECT
                        ROUND(SUM(spend), 0) as spend,
                        SUM(CAST(actions_message AS INT64)) as messages,
                        SUM(impressions) as impressions
                    FROM \`levelup-465304.${DATASET}.fb_ads_data\`
                    WHERE DATE(date_start) BETWEEN '${from}' AND '${to}' AND spend > 0`,
                ];

                const results = await Promise.all(
                    queries.map(q =>
                        fetch("/api/query", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q })
                        }).then(r => r.json()).catch(() => ({ data: [] }))
                    )
                );

                // Aggregate marketers across shops with VND
                const mkMap = new Map<string, { marketer: string; orders: number; revenue: number }>();
                for (const r of results[0].data || []) {
                    const name = r.marketer || "Unknown";
                    const rev = toVND(r.revenue || 0, r.shop_name);
                    const ex = mkMap.get(name);
                    if (ex) { ex.orders += r.orders || 0; ex.revenue += rev; }
                    else mkMap.set(name, { marketer: name, orders: r.orders || 0, revenue: rev });
                }
                setMarketers(Array.from(mkMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 20));

                // Account names map
                const ACCOUNT_NAMES: Record<string, string> = {
                    "act_1503790877534258": "Tiểu Alpha 3",
                    "act_855567553811483": "Sỹ Lộc 01",
                    "act_833593695771745": "Chu Thuý 01",
                    "act_848995974322757": "Chu Thuý 02",
                    "act_3534017756739334": "Kuwait +3",
                    "act_703242242813144": "Trang Sức +1",
                    "act_1119368126847210": "Trang sức 2 Dubai",
                };

                setAccounts((results[1].data || []).map((r: any) => ({
                    account_id: ACCOUNT_NAMES[r.account_id] || r.account_id,
                    spend: r.spend || 0, messages: r.messages || 0,
                    impressions: r.impressions || 0, clicks: r.clicks || 0, campaigns: r.campaigns || 0,
                })));

                const s = results[2].data?.[0] || {};
                setSummary({
                    spend: s.spend || 0, messages: s.messages || 0,
                    impressions: s.impressions || 0,
                    cpm: s.impressions > 0 ? (s.spend / s.impressions) * 1000 : 0,
                });
            } catch (e) { console.error(e); } finally { setLoading(false); }
        }
        fetchData();
    }, [dateRange]);

    if (loading) return <TabSkeleton />;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: "Chi phí Ads (VND)", value: formatVNDCompact(summary.spend), icon: DollarSign, color: "text-amber-400" },
                    { label: "Messages", value: summary.messages.toLocaleString("vi-VN"), icon: MessageCircle, color: "text-blue-400" },
                    { label: "Impressions", value: summary.impressions.toLocaleString("vi-VN"), icon: Users, color: "text-purple-400" },
                    { label: "CPM (VND)", value: formatVNDCompact(summary.cpm), icon: TrendingUp, color: "text-cyan-400" },
                ].map((kpi, i) => (
                    <div key={i} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                            <span className="text-xs text-slate-400">{kpi.label}</span>
                        </div>
                        <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-4">👤 Hiệu suất Marketer (DT quy VND)</h3>
                    <div className="overflow-auto max-h-[400px]">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-slate-400 text-xs border-b border-slate-700">
                                    <th className="text-left py-2 pl-2">#</th>
                                    <th className="text-left py-2">Marketer</th>
                                    <th className="text-right py-2">Đơn</th>
                                    <th className="text-right py-2 pr-2">DT (VND)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {marketers.map((m: any, i: number) => (
                                    <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                                        <td className="py-2 pl-2 text-slate-500">{i + 1}</td>
                                        <td className="py-2 text-foreground font-medium">{m.marketer}</td>
                                        <td className="py-2 text-right text-blue-400 font-mono">{m.orders}</td>
                                        <td className="py-2 text-right pr-2 text-emerald-400 font-mono">{formatVNDCompact(m.revenue)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-4">📊 Tài khoản quảng cáo (VND)</h3>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={accounts} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => formatVNDCompact(v)} />
                            <YAxis type="category" dataKey="account_id" tick={{ fill: "#94a3b8", fontSize: 10 }} width={140} />
                            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8 }}
                                formatter={(v: number) => [formatVNDCompact(v), ""]} />
                            <Bar dataKey="spend" name="Spend (VND)" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-4 space-y-2">
                        {accounts.map((a: any, i: number) => (
                            <div key={i} className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-700/30 pb-1">
                                <span className="font-medium text-slate-300">{a.account_id}</span>
                                <div className="flex gap-4">
                                    <span>{a.campaigns} campaigns</span>
                                    <span>{a.messages.toLocaleString("vi-VN")} msgs</span>
                                    <span className="text-amber-400 font-mono">{formatVNDCompact(a.spend)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
