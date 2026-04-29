"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ComposedChart, Line, Legend,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatNumber, cn } from "@/lib/utils";
import TabSkeleton from "@/components/ui/tab-skeleton";
import {
    Satellite, Target, TrendingUp, TrendingDown, Zap, DollarSign, ShoppingCart,
    Award, Star, AlertTriangle, Minus, ArrowUpRight, ArrowDownRight,
} from "lucide-react";

const DS = "levelup-465304.T1_Dataset";
const EUR_TO_VND = 28000;
const USD_TO_VND = 25000;

async function queryBQ(sql: string) {
    const r = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }) });
    return (await r.json()).data || [];
}
function fmtUSD(v: number) { return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`; }
function fmtVND(v: number) {
    const a = Math.abs(v); const s = v < 0 ? "-" : "";
    if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}ty`;
    if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}tr`;
    if (a >= 1e3) return `${s}${Math.round(a / 1e3)}K`;
    return `${s}${Math.round(a)}`;
}

interface Props { dateRange?: { from: Date; to: Date }; }

export default function AdsTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [summary, setSummary] = useState<any>(null);
    const [posSummary, setPosSummary] = useState<any>(null);
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [daily, setDaily] = useState<any[]>([]);
    const [marketers, setMarketers] = useState<any[]>([]);

    useEffect(() => {
        setLoading(true);
        const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
        const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

        Promise.all([
            // Q0: FB Ads summary (deduped)
            queryBQ(`WITH fb_dedup AS (
                SELECT * FROM \`${DS}.fb_ads_data\`
                WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
            )
            SELECT ROUND(SUM(spend),2) as total_spend, SUM(impressions) as total_impressions,
                SUM(clicks) as total_clicks, SUM(purchases) as total_purchases,
                COUNT(DISTINCT campaign_id) as active_campaigns,
                ROUND(SAFE_DIVIDE(SUM(clicks)*100, NULLIF(SUM(impressions),0)),2) as ctr,
                ROUND(SAFE_DIVIDE(SUM(spend)*1000, NULLIF(SUM(impressions),0)),2) as cpm
            FROM fb_dedup`),

            // Q1: POS orders matched by UTM campaign → actual revenue from Đã thu tiền (status 16)
            queryBQ(`SELECT
                COUNT(DISTINCT id) as total_pos_orders,
                COUNT(DISTINCT CASE WHEN status = 16 THEN id END) as paid_orders,
                ROUND(SUM(CASE WHEN status = 16 THEN total_price ELSE 0 END) * ${EUR_TO_VND / 100}, 0) as paid_revenue_vnd,
                COUNT(DISTINCT CASE WHEN status = 5 THEN id END) as returned_orders,
                COUNT(DISTINCT CASE WHEN status = 6 THEN id END) as cancelled_orders
            FROM \`${DS}.sale_order\`
            WHERE SAFE_CAST(SUBSTR(updated_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
                AND p_utm_campaign IS NOT NULL AND p_utm_campaign != ''`),

            // Q2: Campaign performance — FB metrics + POS orders (deduped)
            queryBQ(`WITH fb_dedup AS (
                SELECT * FROM \`${DS}.fb_ads_data\`
                WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
            ),
            fb AS (
                SELECT campaign_id, campaign_name,
                    ROUND(SUM(spend),2) as spend, SUM(impressions) as impressions,
                    SUM(clicks) as clicks, SUM(purchases) as fb_purchases,
                    ROUND(SAFE_DIVIDE(SUM(clicks)*100, NULLIF(SUM(impressions),0)),2) as ctr,
                    ROUND(SAFE_DIVIDE(SUM(spend), NULLIF(SUM(purchases),0)),2) as cpa
                FROM fb_dedup
                GROUP BY 1,2
            ),
            pos AS (
                SELECT p_utm_campaign as campaign_id,
                    COUNT(DISTINCT id) as pos_orders,
                    COUNT(DISTINCT CASE WHEN status = 16 THEN id END) as pos_paid,
                    COUNT(DISTINCT CASE WHEN status = 5 THEN id END) as pos_returned,
                    ROUND(SUM(CASE WHEN status = 16 THEN total_price ELSE 0 END) * ${EUR_TO_VND / 100}, 0) as pos_revenue
                FROM \`${DS}.sale_order\`
                WHERE SAFE_CAST(SUBSTR(updated_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
                    AND p_utm_campaign IS NOT NULL AND p_utm_campaign != ''
                GROUP BY 1
            )
            SELECT fb.campaign_name, fb.spend, fb.impressions, fb.clicks, fb.ctr,
                fb.fb_purchases, fb.cpa as fb_cpa,
                COALESCE(pos.pos_orders, 0) as pos_orders,
                COALESCE(pos.pos_paid, 0) as pos_paid,
                COALESCE(pos.pos_returned, 0) as pos_returned,
                COALESCE(pos.pos_revenue, 0) as pos_revenue,
                ROUND(SAFE_DIVIDE(COALESCE(pos.pos_revenue, 0), NULLIF(fb.spend * ${USD_TO_VND}, 0)), 2) as roas
            FROM fb LEFT JOIN pos ON fb.campaign_id = pos.campaign_id
            ORDER BY fb.spend DESC`),

            // Q3: Daily trend (deduped)
            queryBQ(`WITH fb_dedup AS (
                SELECT * FROM \`${DS}.fb_ads_data\`
                WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
            )
            SELECT SAFE_CAST(date AS STRING) as day,
                ROUND(SUM(spend),2) as spend, SUM(purchases) as purchases,
                SUM(impressions) as impressions, SUM(clicks) as clicks
            FROM fb_dedup
            GROUP BY 1 ORDER BY 1`),

            // Q4: Marketer performance (extracted from campaign_name + POS fallback)
            queryBQ(`WITH fb_dedup AS (
                SELECT * FROM \`${DS}.fb_ads_data\`
                WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
            ),
            fb_by_camp AS (
                SELECT campaign_id, campaign_name,
                    UPPER(REGEXP_EXTRACT(campaign_name, r'^([A-Za-z]+)')) AS marketer,
                    ROUND(SUM(spend), 2) AS spend, SUM(impressions) AS impressions,
                    SUM(clicks) AS clicks, SUM(purchases) AS purchases,
                    COUNT(DISTINCT date) AS active_days
                FROM fb_dedup GROUP BY 1, 2
            ),
            pos_by_camp AS (
                SELECT p_utm_campaign AS campaign_id,
                    MAX(marketer) AS pos_marketer,
                    COUNT(DISTINCT id) AS orders,
                    COUNT(DISTINCT CASE WHEN status = 16 THEN id END) AS paid,
                    COUNT(DISTINCT CASE WHEN status = 5 THEN id END) AS returned,
                    ROUND(SUM(CASE WHEN status = 16 THEN total_price ELSE 0 END) * ${EUR_TO_VND / 100}, 0) AS revenue
                FROM \`${DS}.sale_order\`
                WHERE SAFE_CAST(SUBSTR(updated_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
                    AND p_utm_campaign IS NOT NULL AND p_utm_campaign != ''
                GROUP BY 1
            )
            SELECT COALESCE(NULLIF(f.marketer, ''), NULLIF(UPPER(p.pos_marketer), ''), 'Unknown') AS marketer,
                COUNT(DISTINCT f.campaign_id) AS campaigns,
                SUM(f.active_days) AS active_days,
                ROUND(SUM(f.spend), 2) AS spend,
                SUM(f.impressions) AS impressions,
                SUM(f.clicks) AS clicks,
                SUM(f.purchases) AS fb_purchases,
                SUM(COALESCE(p.orders, 0)) AS pos_orders,
                SUM(COALESCE(p.paid, 0)) AS pos_paid,
                SUM(COALESCE(p.returned, 0)) AS pos_returned,
                SUM(COALESCE(p.revenue, 0)) AS revenue,
                ROUND(SAFE_DIVIDE(SUM(COALESCE(p.revenue, 0)), NULLIF(SUM(f.spend) * ${USD_TO_VND}, 0)), 2) AS roas,
                ROUND(SAFE_DIVIDE(SUM(COALESCE(p.paid, 0)) * 100, NULLIF(SUM(COALESCE(p.orders, 0)), 0)), 1) AS sr,
                ROUND(SAFE_DIVIDE(SUM(f.spend), NULLIF(SUM(COALESCE(p.paid, 0)), 0)), 2) AS real_cpa,
                ROUND(SAFE_DIVIDE(SUM(f.clicks) * 100, NULLIF(SUM(f.impressions), 0)), 2) AS ctr
            FROM fb_by_camp f
            LEFT JOIN pos_by_camp p ON f.campaign_id = p.campaign_id
            GROUP BY 1
            ORDER BY revenue DESC`),
        ]).then(([sum, pos, camps, h, mkts]) => {
            setSummary(sum[0] || {});
            setPosSummary(pos[0] || {});
            setCampaigns(camps);
            setDaily(h);
            setMarketers(mkts || []);
        }).catch(() => { }).finally(() => setLoading(false));
    }, [dateRange]);

    if (loading) return <TabSkeleton cards={4} showChart={true} rows={5} />;
    if (!summary) return null;

    const totalSpend = summary.total_spend || 0;
    const totalSpendVND = totalSpend * USD_TO_VND;
    const fbPurchases = summary.total_purchases || 0;
    const posRevenue = posSummary?.paid_revenue_vnd || 0;
    const posPaid = posSummary?.paid_orders || 0;
    const posOrders = posSummary?.total_pos_orders || 0;
    const roas = totalSpendVND > 0 ? posRevenue / totalSpendVND : 0;
    const cpa = fbPurchases > 0 ? totalSpend / fbPurchases : 0;
    const realCPA = posPaid > 0 ? totalSpend / posPaid : 0;

    return (
        <div className="space-y-6">
            {/* KPI Row 1: FB Ads Metrics */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
                <KPICard title="Ads Spend" value={fmtUSD(totalSpend)} icon={Zap} status="warning"
                    subValue={`= ${fmtVND(totalSpendVND)} VND`} />
                <KPICard title="Campaigns" value={String(summary.active_campaigns || 0)} icon={Satellite} />
                <KPICard title="Impressions" value={formatNumber(summary.total_impressions || 0)} icon={Target} />
                <KPICard title="Clicks" value={formatNumber(summary.total_clicks || 0)} icon={TrendingUp}
                    subValue={`CTR: ${summary.ctr || 0}%`} />
                <KPICard title="FB Purchases" value={formatNumber(fbPurchases)} icon={ShoppingCart}
                    subValue={`CPA: ${cpa > 0 ? fmtUSD(cpa) : '---'}`} />
                <KPICard title="POS Đã Thu" value={String(posPaid)} icon={DollarSign} status="success"
                    subValue={`/ ${posOrders} tổng đơn`} />
                <KPICard title="Doanh Thu Thực" value={fmtVND(posRevenue)} icon={DollarSign} status="success"
                    subValue="Chỉ đơn Đã thu tiền" />
                <KPICard title="ROAS (Thực)" value={`${roas.toFixed(2)}x`} icon={Target}
                    status={roas >= 2.5 ? "success" : roas >= 1.5 ? "warning" : "danger"}
                    subValue={`CPA thực: ${realCPA > 0 ? fmtUSD(realCPA) : '---'}`} />
            </div>

            {/* Charts Row */}
            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Daily Spend vs Purchases</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={daily}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="day" tickFormatter={(v) => String(v).slice(5)} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
                            <Legend />
                            <Bar yAxisId="left" dataKey="spend" name="Spend ($)" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                            <Line yAxisId="right" type="monotone" dataKey="purchases" name="Purchases" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Spend vs Impressions</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={daily}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="day" tickFormatter={(v) => String(v).slice(5)} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
                            <Legend />
                            <Bar yAxisId="left" dataKey="spend" name="Spend ($)" fill="#ef4444" radius={[4, 4, 0, 0]} />
                            <Line yAxisId="right" type="monotone" dataKey="impressions" name="Impressions" stroke="#34d399" strokeWidth={2} dot={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Campaign Performance Table — combined FB + POS */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Campaign Performance — FB Ads + POS ({campaigns.length})</h3>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-card z-10">
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">Campaign</th>
                                <th className="px-2 pb-2 text-right font-medium">Spend</th>
                                <th className="px-2 pb-2 text-right font-medium">Impr.</th>
                                <th className="px-2 pb-2 text-right font-medium">Clicks</th>
                                <th className="px-2 pb-2 text-right font-medium">CTR</th>
                                <th className="px-2 pb-2 text-right font-medium">FB Purch.</th>
                                <th className="px-2 pb-2 text-right font-medium">FB CPA</th>
                                <th className="px-2 pb-2 text-right font-medium text-sky-600">POS Đơn</th>
                                <th className="px-2 pb-2 text-right font-medium text-emerald-600">Đã Thu</th>
                                <th className="px-2 pb-2 text-right font-medium text-rose-600">Hoàn</th>
                                <th className="px-2 pb-2 text-right font-medium text-emerald-600">Revenue</th>
                                <th className="px-2 pb-2 text-right font-medium">ROAS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {campaigns.map((a, i) => (
                                <tr key={i} className="border-b border-border/30 hover:bg-gray-50/50">
                                    <td className="px-2 py-2.5 text-foreground max-w-[200px] truncate" title={a.campaign_name}>{a.campaign_name?.substring(0, 30)}</td>
                                    <td className="px-2 py-2.5 text-right text-amber-500">{fmtUSD(a.spend)}</td>
                                    <td className="px-2 py-2.5 text-right">{formatNumber(a.impressions)}</td>
                                    <td className="px-2 py-2.5 text-right">{formatNumber(a.clicks)}</td>
                                    <td className="px-2 py-2.5 text-right">{a.ctr?.toFixed(2)}%</td>
                                    <td className="px-2 py-2.5 text-right">{a.fb_purchases || 0}</td>
                                    <td className={cn("px-2 py-2.5 text-right",
                                        (a.fb_cpa || 0) > 0 && (a.fb_cpa || 0) < 15 ? "text-emerald-500" : (a.fb_cpa || 0) >= 25 ? "text-rose-500" : "text-amber-500")}>
                                        {a.fb_cpa > 0 ? fmtUSD(a.fb_cpa) : "---"}
                                    </td>
                                    <td className="px-2 py-2.5 text-right text-sky-600 font-semibold">{a.pos_orders || 0}</td>
                                    <td className="px-2 py-2.5 text-right text-emerald-600 font-semibold">{a.pos_paid || 0}</td>
                                    <td className={cn("px-2 py-2.5 text-right", (a.pos_returned || 0) > 0 ? "text-rose-500 font-semibold" : "")}>
                                        {a.pos_returned || 0}
                                    </td>
                                    <td className="px-2 py-2.5 text-right font-semibold text-emerald-500">{a.pos_revenue > 0 ? fmtVND(a.pos_revenue) : "---"}</td>
                                    <td className={cn("px-2 py-2.5 text-right font-semibold",
                                        (a.roas || 0) >= 2.5 ? "text-emerald-500" : (a.roas || 0) >= 1.5 ? "text-amber-500" : "text-rose-500")}>
                                        {a.roas > 0 ? `${a.roas}x` : "---"}
                                    </td>
                                </tr>
                            ))}
                            {/* TONG row */}
                            {(() => {
                                const t = campaigns.reduce((a, c) => ({
                                    spend: a.spend + (c.spend || 0),
                                    impressions: a.impressions + (c.impressions || 0),
                                    clicks: a.clicks + (c.clicks || 0),
                                    fb_purchases: a.fb_purchases + (c.fb_purchases || 0),
                                    pos_orders: a.pos_orders + (c.pos_orders || 0),
                                    pos_paid: a.pos_paid + (c.pos_paid || 0),
                                    pos_returned: a.pos_returned + (c.pos_returned || 0),
                                    pos_revenue: a.pos_revenue + (c.pos_revenue || 0),
                                }), { spend: 0, impressions: 0, clicks: 0, fb_purchases: 0, pos_orders: 0, pos_paid: 0, pos_returned: 0, pos_revenue: 0 });
                                const tRoas = t.spend > 0 ? Math.round(t.pos_revenue / (t.spend * USD_TO_VND) * 100) / 100 : 0;
                                return (
                                    <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                        <td className="px-2 py-2 text-foreground">TỔNG</td>
                                        <td className="px-2 py-2 text-right text-amber-500">{fmtUSD(t.spend)}</td>
                                        <td className="px-2 py-2 text-right">{formatNumber(t.impressions)}</td>
                                        <td className="px-2 py-2 text-right">{formatNumber(t.clicks)}</td>
                                        <td className="px-2 py-2 text-right">{t.impressions > 0 ? (t.clicks / t.impressions * 100).toFixed(2) : 0}%</td>
                                        <td className="px-2 py-2 text-right">{t.fb_purchases}</td>
                                        <td className="px-2 py-2 text-right">{t.fb_purchases > 0 ? fmtUSD(t.spend / t.fb_purchases) : "---"}</td>
                                        <td className="px-2 py-2 text-right text-sky-600">{t.pos_orders}</td>
                                        <td className="px-2 py-2 text-right text-emerald-600">{t.pos_paid}</td>
                                        <td className="px-2 py-2 text-right text-rose-500">{t.pos_returned}</td>
                                        <td className="px-2 py-2 text-right text-emerald-500">{fmtVND(t.pos_revenue)}</td>
                                        <td className="px-2 py-2 text-right">{tRoas}x</td>
                                    </tr>
                                );
                            })()}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ═══ Marketer Evaluation Scorecard ═══ */}
            {marketers.length > 0 && <MarketerEvaluation marketers={marketers} />}
        </div>
    );
}

// ═══ Scoring Functions ═══
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
function scoreCPA(cpa: number): number {
    if (cpa <= 0) return 5;
    if (cpa <= 10) return 20;
    if (cpa <= 15) return 16;
    if (cpa <= 20) return 12;
    if (cpa <= 30) return 8;
    return 4;
}
function getGrade(total: number): { label: string; color: string; bg: string; icon: any } {
    if (total >= 80) return { label: "Xuất sắc", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: Star };
    if (total >= 60) return { label: "Tốt", color: "text-blue-700", bg: "bg-blue-50 border-blue-200", icon: Award };
    if (total >= 40) return { label: "Trung bình", color: "text-amber-700", bg: "bg-amber-50 border-amber-200", icon: Minus };
    return { label: "Cần cải thiện", color: "text-rose-700", bg: "bg-rose-50 border-rose-200", icon: AlertTriangle };
}
function getPrediction(roas: number, sr: number, orders: number, spend: number) {
    // Simple heuristic: market efficiency + volume trajectory
    const efficiency = roas >= 2 && sr >= 30;
    const volume = orders >= 5;
    const spending = spend >= 50;
    if (efficiency && volume && spending) return { label: "📈 Tăng trưởng mạnh", detail: "ROAS tốt, volume cao → nên tăng ngân sách", color: "text-emerald-600", icon: ArrowUpRight };
    if (efficiency && !volume) return { label: "🌱 Tiềm năng cao", detail: "Hiệu quả tốt nhưng cần tăng volume", color: "text-blue-600", icon: TrendingUp };
    if (!efficiency && volume) return { label: "⚠️ Cần tối ưu", detail: "Volume có nhưng chi phí/hoàn cao → review creative & targeting", color: "text-amber-600", icon: AlertTriangle };
    if (spending && !efficiency) return { label: "🔴 Rủi ro", detail: "Chi nhiều nhưng hiệu quả thấp → cần xem lại chiến lược", color: "text-rose-600", icon: ArrowDownRight };
    return { label: "⏳ Chưa đủ data", detail: "Cần thêm thời gian để đánh giá chính xác", color: "text-gray-500", icon: Minus };
}

function MarketerEvaluation({ marketers }: { marketers: any[] }) {
    const maxOrders = Math.max(...marketers.map(m => m.pos_orders || 0), 1);

    const scored = marketers.map(m => {
        const roasScore = scoreROAS(m.roas || 0);
        const srScore = scoreSR(m.sr || 0);
        const volScore = scoreVolume(m.pos_orders || 0, maxOrders);
        const cpaScore = scoreCPA(m.real_cpa || 0);
        const total = roasScore + srScore + volScore + cpaScore;
        const grade = getGrade(total);
        const prediction = getPrediction(m.roas || 0, m.sr || 0, m.pos_orders || 0, m.spend || 0);
        return { ...m, roasScore, srScore, volScore, cpaScore, total, grade, prediction };
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
                        <div key={m.marketer} className={cn("rounded-xl border p-4", m.grade.bg)}>
                            <div className="flex items-start justify-between gap-4">
                                {/* Left: Name + Score */}
                                <div className="flex items-center gap-3">
                                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-lg font-black", m.grade.color,
                                        m.total >= 80 ? "bg-emerald-100" : m.total >= 60 ? "bg-blue-100" : m.total >= 40 ? "bg-amber-100" : "bg-rose-100")}>
                                        {idx + 1}
                                    </div>
                                    <div>
                                        <div className="text-base font-bold text-foreground">{m.marketer}</div>
                                        <div className={cn("text-xs font-semibold flex items-center gap-1", m.grade.color)}>
                                            <GradeIcon className="w-3 h-3" /> {m.grade.label}
                                        </div>
                                    </div>
                                </div>

                                {/* Right: Total score */}
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
                                        <span className="text-muted-foreground">Volume ({m.pos_orders || 0} đơn)</span>
                                        <span className="font-bold">{m.volScore}/25</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                                        <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${(m.volScore / 25) * 100}%` }} />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex justify-between text-[10px] mb-1">
                                        <span className="text-muted-foreground">CPA (${m.real_cpa > 0 ? m.real_cpa.toFixed(0) : '---'})</span>
                                        <span className="font-bold">{m.cpaScore}/20</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                                        <div className="h-full rounded-full bg-purple-500 transition-all" style={{ width: `${(m.cpaScore / 20) * 100}%` }} />
                                    </div>
                                </div>
                            </div>

                            {/* Stats row */}
                            <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
                                <span>💰 Spend: <b className="text-foreground">{fmtUSD(m.spend || 0)}</b></span>
                                <span>📦 Đơn: <b className="text-foreground">{m.pos_orders || 0}</b></span>
                                <span>✅ Thu tiền: <b className="text-emerald-600">{m.pos_paid || 0}</b></span>
                                <span>🔄 Hoàn: <b className="text-rose-500">{m.pos_returned || 0}</b></span>
                                <span>💵 Revenue: <b className="text-emerald-600">{fmtVND(m.revenue || 0)}</b></span>
                                <span>📊 Campaigns: <b className="text-foreground">{m.campaigns}</b></span>
                            </div>

                            {/* Prediction */}
                            <div className={cn("mt-3 rounded-lg bg-white/60 border border-white p-3 flex items-start gap-2")}>
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

            {/* Scoring explanation */}
            <div className="mt-4 rounded-lg border border-dashed border-border bg-slate-50 p-3 text-[10px] text-muted-foreground">
                <strong className="text-foreground">Công thức chấm điểm:</strong>
                <span className="ml-2">ROAS (30đ) + Tỷ lệ TC (25đ) + Volume đơn (25đ) + CPA hiệu quả (20đ) = 100đ</span>
            </div>
        </div>
    );
}
