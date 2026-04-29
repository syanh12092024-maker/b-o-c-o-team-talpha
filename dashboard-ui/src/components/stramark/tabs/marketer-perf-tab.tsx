"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Cell,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency, formatNumber, formatMoney, COLORS, cn } from "@/lib/utils";
import ExchangeRateBanner from "@/components/stramark/exchange-rate-banner";
import { DATASET } from "../constants";
import { Users, Trophy, TrendingUp, TrendingDown, Target, DollarSign, Award, Star, AlertTriangle, Minus, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface MarketerPerfTabProps {
    dateRange?: { from: Date; to: Date };
}

interface MarketerSummary {
    marketer_name: string;
    orders: number;
    success: number;
    returned: number;
    revenue: number;
    ads_spend: number;
    shipping: number;
    cogs: number;
    net_profit: number;
    roas: number;
    sr: number;
}

interface DailyMarketer {
    report_date: string;
    marketer_name: string;
    orders: number;
    success: number;
    revenue: number;
    ads_spend: number;
    net_profit: number;
    sr: number;
}

const MARKETER_COLORS = ["#34d399", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4"];

function gradeMarketer(roas: number, netProfit: number): { label: string; cls: string } {
    if (roas >= 5) return { label: "A+", cls: "bg-emerald-500/20 text-emerald-400" };
    if (roas >= 3.5) return { label: "A", cls: "bg-emerald-500/15 text-emerald-400" };
    if (roas >= 2.5) return { label: "B+", cls: "bg-amber-500/15 text-amber-400" };
    if (netProfit < 0) return { label: "C", cls: "bg-rose-500/15 text-rose-400" };
    return { label: "B", cls: "bg-blue-500/15 text-blue-400" };
}

// ═══ Scorecard 100đ — Scoring Functions ═══
function scoreROAS(roas: number): number {
    if (roas >= 4) return 30;
    if (roas >= 3) return 25;
    if (roas >= 2) return 20;
    if (roas >= 1.5) return 15;
    if (roas >= 1) return 10;
    return 5;
}
function scoreSR(sr: number): number {
    if (sr >= 60) return 25;
    if (sr >= 45) return 20;
    if (sr >= 30) return 15;
    if (sr >= 15) return 10;
    return 5;
}
function scoreVolume(orders: number, maxOrders: number): number {
    if (maxOrders === 0) return 5;
    const ratio = orders / maxOrders;
    if (ratio >= 0.8) return 25;
    if (ratio >= 0.5) return 20;
    if (ratio >= 0.3) return 15;
    if (ratio >= 0.1) return 10;
    return 5;
}
function scoreCPA(cpaRon: number): number {
    // CPA in RON (1 USD ≈ 4.5 RON → $10=45, $15=67, $20=90, $30=135)
    if (cpaRon <= 0) return 5;
    if (cpaRon <= 45) return 20;
    if (cpaRon <= 67) return 16;
    if (cpaRon <= 90) return 12;
    if (cpaRon <= 135) return 8;
    return 4;
}
function getScorecardGrade(total: number): { label: string; color: string; bg: string; icon: any } {
    if (total >= 80) return { label: "Xuất sắc", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: Star };
    if (total >= 60) return { label: "Tốt", color: "text-blue-700", bg: "bg-blue-50 border-blue-200", icon: Award };
    if (total >= 40) return { label: "Trung bình", color: "text-amber-700", bg: "bg-amber-50 border-amber-200", icon: Minus };
    return { label: "Cần cải thiện", color: "text-rose-700", bg: "bg-rose-50 border-rose-200", icon: AlertTriangle };
}
function getPrediction(roas: number, sr: number, orders: number, adsSpendRon: number) {
    const efficiency = roas >= 2 && sr >= 30;
    const volume = orders >= 5;
    const spending = adsSpendRon >= 225; // ~$50 USD quy đổi RON
    if (efficiency && volume && spending) return { label: "📈 Tăng trưởng mạnh", detail: "ROAS tốt, volume cao → nên tăng ngân sách", color: "text-emerald-600", icon: ArrowUpRight };
    if (efficiency && !volume) return { label: "🌱 Tiềm năng cao", detail: "Hiệu quả tốt nhưng cần tăng volume đơn", color: "text-blue-600", icon: TrendingUp };
    if (!efficiency && volume) return { label: "⚠️ Cần tối ưu", detail: "Volume có nhưng ROAS/SR thấp → review creative & targeting", color: "text-amber-600", icon: AlertTriangle };
    if (spending && !efficiency) return { label: "🔴 Rủi ro", detail: "Chi nhiều nhưng hiệu quả thấp → cần xem lại chiến lược", color: "text-rose-600", icon: ArrowDownRight };
    return { label: "⏳ Chưa đủ data", detail: "Cần thêm thời gian để đánh giá chính xác", color: "text-gray-500", icon: Minus };
}

// ═══ Marketer Scorecard Component ═══
function MarketerScorecard({ marketers }: { marketers: MarketerSummary[] }) {
    const maxOrders = Math.max(...marketers.map((m) => m.orders || 0), 1);

    const scored = marketers.map((m) => {
        const cpaRon = m.success > 0 ? m.ads_spend / m.success : 0;
        const roasScore = scoreROAS(m.roas || 0);
        const srScore = scoreSR(m.sr || 0);
        const volScore = scoreVolume(m.orders || 0, maxOrders);
        const cpaScore = scoreCPA(cpaRon);
        const total = roasScore + srScore + volScore + cpaScore;
        const grade = getScorecardGrade(total);
        const prediction = getPrediction(m.roas || 0, m.sr || 0, m.orders || 0, m.ads_spend || 0);
        return { ...m, cpaRon, roasScore, srScore, volScore, cpaScore, total, grade, prediction };
    }).sort((a, b) => b.total - a.total);

    return (
        <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Award className="w-4 h-4 text-indigo-500" />
                Đánh giá năng lực Marketer & Dự đoán
            </h3>
            <div className="space-y-4">
                {scored.map((m, idx) => {
                    const GradeIcon = m.grade.icon;
                    const PredIcon = m.prediction.icon;
                    return (
                        <div key={m.marketer_name} className={cn("rounded-xl border p-4", m.grade.bg)}>
                            {/* Header: Rank + Name + Total Score */}
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        "w-10 h-10 rounded-full flex items-center justify-center text-lg font-black",
                                        m.grade.color,
                                        m.total >= 80 ? "bg-emerald-100" : m.total >= 60 ? "bg-blue-100" : m.total >= 40 ? "bg-amber-100" : "bg-rose-100"
                                    )}>
                                        {idx + 1}
                                    </div>
                                    <div>
                                        <div className="text-base font-bold text-foreground">{m.marketer_name}</div>
                                        <div className={cn("text-xs font-semibold flex items-center gap-1", m.grade.color)}>
                                            <GradeIcon className="w-3 h-3" /> {m.grade.label}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-center">
                                    <div className={cn("text-3xl font-black", m.grade.color)}>{m.total}</div>
                                    <div className="text-[10px] text-muted-foreground">/100 điểm</div>
                                </div>
                            </div>

                            {/* Score breakdown bars */}
                            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div>
                                    <div className="flex justify-between text-[10px] mb-1">
                                        <span className="text-muted-foreground">ROAS ({m.roas || 0}x)</span>
                                        <span className="font-bold">{m.roasScore}/30</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                                        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(m.roasScore / 30) * 100}%` }} />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex justify-between text-[10px] mb-1">
                                        <span className="text-muted-foreground">SR% ({m.sr || 0}%)</span>
                                        <span className="font-bold">{m.srScore}/25</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                                        <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${(m.srScore / 25) * 100}%` }} />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex justify-between text-[10px] mb-1">
                                        <span className="text-muted-foreground">Volume ({m.orders || 0} đơn)</span>
                                        <span className="font-bold">{m.volScore}/25</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                                        <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${(m.volScore / 25) * 100}%` }} />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex justify-between text-[10px] mb-1">
                                        <span className="text-muted-foreground">CPA ({m.cpaRon > 0 ? formatMoney(m.cpaRon) : "---"})</span>
                                        <span className="font-bold">{m.cpaScore}/20</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                                        <div className="h-full rounded-full bg-purple-500 transition-all" style={{ width: `${(m.cpaScore / 20) * 100}%` }} />
                                    </div>
                                </div>
                            </div>

                            {/* Stats row */}
                            <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
                                <span>💰 Spend: <b className="text-foreground">{formatMoney(m.ads_spend)}</b></span>
                                <span>📦 Đơn: <b className="text-foreground">{m.orders}</b></span>
                                <span>✅ T.Công: <b className="text-emerald-600">{m.success}</b></span>
                                <span>🔄 Hoàn: <b className="text-rose-500">{m.returned}</b></span>
                                <span>💵 Revenue: <b className="text-emerald-600">{formatMoney(m.revenue)}</b></span>
                                <span>📈 Net P&L: <b className={m.net_profit >= 0 ? "text-emerald-600" : "text-rose-500"}>{m.net_profit >= 0 ? "+" : ""}{formatMoney(m.net_profit)}</b></span>
                            </div>

                            {/* Prediction */}
                            <div className="mt-3 rounded-lg bg-white/60 border border-white p-3 flex items-start gap-2">
                                <PredIcon className={cn("w-4 h-4 mt-0.5 shrink-0", m.prediction.color)} />
                                <div>
                                    <div className={cn("text-xs font-bold", m.prediction.color)}>{m.prediction.label}</div>
                                    <div className="text-[11px] text-muted-foreground mt-0.5">{m.prediction.detail}</div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Scoring formula explanation */}
            <div className="mt-4 rounded-lg border border-dashed border-border bg-slate-50 p-3 text-[10px] text-muted-foreground">
                <strong className="text-foreground">Công thức chấm điểm:</strong>
                <span className="ml-2">ROAS (30đ) + Tỷ lệ TC (25đ) + Volume đơn (25đ) + CPA hiệu quả (20đ) = 100đ</span>
            </div>
        </div>
    );
}

export default function MarketerPerfTab({ dateRange }: MarketerPerfTabProps) {
    const [loading, setLoading] = useState(true);
    const [marketers, setMarketers] = useState<MarketerSummary[]>([]);
    const [daily, setDaily] = useState<DailyMarketer[]>([]);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    // Q0: Marketer summary with full P&L
                    `SELECT
                        marketer_name,
                        SUM(total_orders) as orders,
                        SUM(success_orders) as success,
                        SUM(returned_orders) as returned,
                        ROUND(SUM(delivered_revenue),0) as revenue,
                        ROUND(SUM(ads_spend_ron),0) as ads_spend,
                        ROUND(SUM(fulfillment_cost) + SUM(return_fulfillment_cost),0) as shipping,
                        ROUND(SUM(cogs),0) as cogs,
                        ROUND(SUM(net_profit),0) as net_profit,
                        ROUND(SAFE_DIVIDE(SUM(delivered_revenue), NULLIF(SUM(ads_spend_ron),0)),2) as roas,
                        ROUND(SAFE_DIVIDE(SUM(success_orders)*100, NULLIF(SUM(total_orders),0)),1) as sr
                    FROM ${DATASET}.mart_performance_master
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                        AND marketer_name IS NOT NULL
                    GROUP BY 1 ORDER BY revenue DESC`,

                    // Q1: Daily detail per marketer (last 14 days)
                    `SELECT
                        report_date,
                        marketer_name,
                        SUM(total_orders) as orders,
                        SUM(success_orders) as success,
                        ROUND(SUM(delivered_revenue),0) as revenue,
                        ROUND(SUM(ads_spend_ron),0) as ads_spend,
                        ROUND(SUM(net_profit),0) as net_profit,
                        ROUND(SAFE_DIVIDE(SUM(success_orders)*100, NULLIF(SUM(total_orders),0)),1) as sr
                    FROM ${DATASET}.mart_performance_master
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                        AND marketer_name IS NOT NULL
                    GROUP BY 1, 2
                    ORDER BY 1 DESC, revenue DESC
                    LIMIT 100`,
                ];

                const results = await Promise.all(
                    queries.map((q) =>
                        fetch("/api/query", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q }),
                        }).then((res) => res.json()).catch(() => ({ data: [] }))
                    )
                );

                setMarketers(results[0].data || []);
                setDaily(results[1].data || []);
            } catch (error) {
                console.error("Marketer Perf fetch error:", error);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [dateRange]);

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
            </div>
        );
    }

    // Chart data for ROAS
    const roasData = marketers.map((m) => ({
        name: m.marketer_name?.split(" ").slice(-2).join(" ") || "Unknown",
        roas: m.roas || 0,
        revenue: m.revenue,
        spend: m.ads_spend,
    }));

    // Group daily by date for table
    const dailyDates = Array.from(new Set(daily.map((d) => d.report_date))).slice(0, 10);

    return (
        <div className="space-y-6">
            <ExchangeRateBanner />
            {/* Marketer summary cards */}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {marketers.slice(0, 4).map((m, i) => {
                    const grade = gradeMarketer(m.roas || 0, m.net_profit);
                    const medal = ["🥇", "🥈", "🥉", ""][i] || "";
                    const borderColor = m.net_profit >= 0 ? "border-l-emerald-500" : "border-l-rose-500";
                    return (
                        <div key={m.marketer_name}
                            className={cn("rounded-lg border border-border border-l-[3px] bg-card p-4", borderColor)}>
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-semibold text-muted-foreground">{medal} {m.marketer_name}</span>
                                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", grade.cls)}>{grade.label}</span>
                            </div>
                            <div className="flex items-end gap-2">
                                <span className="text-lg font-bold text-foreground">ROAS</span>
                                <span className={cn("text-xl font-black", (m.roas || 0) >= 2.5 ? "text-emerald-400" : "text-amber-400")}>
                                    {m.roas ? `${m.roas}x` : "—"}
                                </span>
                            </div>
                            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                                <div className="flex justify-between">
                                    <span>Đơn: {formatNumber(m.orders)}</span>
                                    <span>SR: {m.sr}%</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Revenue: <span className="text-emerald-400">{formatMoney(m.revenue)}</span></span>
                                    <span>Ads: <span className="text-amber-400">{formatMoney(m.ads_spend)}</span></span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Shipping: <span className="text-cyan-400">{formatMoney(m.shipping)}</span></span>
                                    <span>COGS: <span className="text-orange-400">{formatMoney(m.cogs)}</span></span>
                                </div>
                                <div className="flex justify-between border-t border-border pt-1">
                                    <span className="font-semibold">Net P&L:</span>
                                    <span className={cn("font-bold", m.net_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                        {m.net_profit >= 0 ? "+" : ""}{formatMoney(m.net_profit)} VND
                                    </span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Charts */}
            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        🎯 ROAS Comparison
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={roasData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                            <Bar dataKey="roas" name="ROAS" radius={[6, 6, 0, 0]}>
                                {roasData.map((_, i) => (
                                    <Cell key={i} fill={MARKETER_COLORS[i % MARKETER_COLORS.length]} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-blue-400" />
                        💰 Revenue vs Spend
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={roasData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                            <Legend />
                            <Bar dataKey="revenue" name="Revenue" fill="#34d399" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="spend" name="Ads Spend" fill="#ef4444" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Full P&L Table */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">📊 Full Marketer P&L</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-3 pb-2 text-left font-medium">#</th>
                                <th className="px-3 pb-2 text-left font-medium">Marketer</th>
                                <th className="px-3 pb-2 text-right font-medium">Đơn</th>
                                <th className="px-3 pb-2 text-right font-medium">T.Công</th>
                                <th className="px-3 pb-2 text-right font-medium">Trả lại</th>
                                <th className="px-3 pb-2 text-right font-medium">SR%</th>
                                <th className="px-3 pb-2 text-right font-medium">Revenue</th>
                                <th className="px-3 pb-2 text-right font-medium">Ads</th>
                                <th className="px-3 pb-2 text-right font-medium">COGS</th>
                                <th className="px-3 pb-2 text-right font-medium">Ship</th>
                                <th className="px-3 pb-2 text-right font-medium">Tổng CP</th>
                                <th className="px-3 pb-2 text-right font-medium">Net P&L</th>
                                <th className="px-3 pb-2 text-right font-medium">ROAS</th>
                                <th className="px-3 pb-2 text-right font-medium">Grade</th>
                            </tr>
                        </thead>
                        <tbody>
                            {marketers.map((m, i) => {
                                const totalCost = m.ads_spend + m.cogs + m.shipping;
                                const grade = gradeMarketer(m.roas || 0, m.net_profit);
                                return (
                                    <tr key={m.marketer_name} className="border-b border-border/60 hover:bg-gray-50/50">
                                        <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                                        <td className="px-3 py-2 font-medium text-foreground">{m.marketer_name}</td>
                                        <td className="px-3 py-2 text-right">{formatNumber(m.orders)}</td>
                                        <td className="px-3 py-2 text-right">{formatNumber(m.success)}</td>
                                        <td className="px-3 py-2 text-right">{formatNumber(m.returned)}</td>
                                        <td className={cn("px-3 py-2 text-right font-semibold", m.sr >= 45 ? "text-emerald-400" : "text-amber-400")}>
                                            {m.sr}%
                                        </td>
                                        <td className="px-3 py-2 text-right font-semibold text-emerald-400">{formatMoney(m.revenue)}</td>
                                        <td className="px-3 py-2 text-right text-amber-400">{formatMoney(m.ads_spend)}</td>
                                        <td className="px-3 py-2 text-right text-orange-400">{formatMoney(m.cogs)}</td>
                                        <td className="px-3 py-2 text-right text-cyan-400">{formatMoney(m.shipping)}</td>
                                        <td className="px-3 py-2 text-right text-rose-400">{formatMoney(totalCost)}</td>
                                        <td className={cn("px-3 py-2 text-right font-bold", m.net_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {m.net_profit >= 0 ? "+" : ""}{formatMoney(m.net_profit)}
                                        </td>
                                        <td className={cn("px-3 py-2 text-right font-bold", (m.roas || 0) >= 2.5 ? "text-emerald-400" : "text-amber-400")}>
                                            {m.roas ? `${m.roas}x` : "—"}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", grade.cls)}>{grade.label}</span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Scorecard 100đ */}
            {marketers.length > 0 && <MarketerScorecard marketers={marketers} />}

            {/* Daily detail */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">📅 Daily Marketer Detail (Recent)</h3>
                <div className="max-h-[400px] overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-card">
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-3 pb-2 text-left font-medium">Ngày</th>
                                <th className="px-3 pb-2 text-left font-medium">Marketer</th>
                                <th className="px-3 pb-2 text-right font-medium">Đơn</th>
                                <th className="px-3 pb-2 text-right font-medium">T.Công</th>
                                <th className="px-3 pb-2 text-right font-medium">Revenue</th>
                                <th className="px-3 pb-2 text-right font-medium">Spend</th>
                                <th className="px-3 pb-2 text-right font-medium">Net P&L</th>
                                <th className="px-3 pb-2 text-right font-medium">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {daily.map((d, i) => {
                                const dateStr = typeof d.report_date === "string"
                                    ? d.report_date.split("T")[0]
                                    : d.report_date;
                                return (
                                    <tr key={`${dateStr}-${d.marketer_name}-${i}`}
                                        className="border-b border-border/60 hover:bg-gray-50/50">
                                        <td className="px-3 py-2 text-muted-foreground">{dateStr}</td>
                                        <td className="px-3 py-2 font-medium text-foreground">
                                            {d.marketer_name?.split(" ").slice(-2).join(" ")}
                                        </td>
                                        <td className="px-3 py-2 text-right">{d.orders}</td>
                                        <td className="px-3 py-2 text-right">{d.success}</td>
                                        <td className="px-3 py-2 text-right text-emerald-400">{formatMoney(d.revenue)}</td>
                                        <td className="px-3 py-2 text-right text-amber-400">{formatMoney(d.ads_spend)}</td>
                                        <td className={cn("px-3 py-2 text-right font-bold", d.net_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {d.net_profit >= 0 ? "+" : ""}{formatMoney(d.net_profit)}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {d.net_profit > 0
                                                ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">✓</span>
                                                : d.net_profit === 0
                                                    ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">—</span>
                                                    : <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-400">✗</span>
                                            }
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
