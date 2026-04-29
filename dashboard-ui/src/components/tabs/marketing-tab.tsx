"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, Cell, PieChart, Pie,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency, formatNumber, formatMoney, COLORS, cn } from "@/lib/utils";
import { DATASET, CURRENCY_SYMBOL } from "@/lib/constants";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { resolveMarketerName, isRealMarketer } from "@/lib/marketer-map";
import {
    Megaphone, MousePointer, Eye, Percent, Coins, Users,
    TrendingUp, Target, DollarSign, Trophy, FlaskConical, ShoppingBag,
} from "lucide-react";

// Campaign product_code → POS SKU mapping
const SELLING_PRODUCTS: Record<string, string> = {
    'MỌCTOC': '097', 'MỌC TÓC': '097', 'Mọc tóc': '097',
    'SERUMNHANSAM': '071', 'PAGEMOISERUMNHANSAM': '071',
    'Retinol Cream': '119', 'Kem xoá nhăn hồng': '119',
    'dầu gội  Fa Le Mei': '116',
    'Kem nở mông ngực': '114', 'AONGUC': 'BRA',
    'Đồng hồ 18k': '103', 'Lotion tắm trắng': '112',
    'Body Lotion': '112', 'Hally Body Lotion': '088',
    'kemchongnangI': '087',
};

interface TestProduct {
    product_code: string;
    marketer: string;
    spend: number;
    impressions: number;
    reach: number;
    messages: number;
    clicks: number;
    purchases: number;
    purchase_value: number;
    campaigns: number;
    cpm: number;
    ctr: number;
    msg_rate: number;
    cost_per_msg: number;
    cpa: number;
    roas: number;
    evaluation: string;
}

interface MarketingTabProps {
    dateRange?: { from: Date; to: Date };
    projectId?: string;
}

/* ─── Marketer performance merged row ─── */
interface MarketerRow {
    marketer_name: string;
    orders: number; success: number; returned: number;
    revenue: number; ads_spend: number; shipping: number; cogs: number;
    net_profit: number; roas: number; sr: number;
    impressions: number; clicks: number;
}

function gradeMarketer(roas: number, netProfit: number): { label: string; cls: string } {
    if (roas >= 5) return { label: "A+", cls: "bg-emerald-500/20 text-emerald-400" };
    if (roas >= 3.5) return { label: "A", cls: "bg-emerald-500/15 text-emerald-400" };
    if (roas >= 2.5) return { label: "B+", cls: "bg-amber-500/15 text-amber-400" };
    if (netProfit < 0) return { label: "C", cls: "bg-rose-500/15 text-rose-400" };
    return { label: "B", cls: "bg-blue-500/15 text-blue-400" };
}

const PIE_COLORS = ["#34d399", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7"];

export default function MarketingTab({ dateRange }: MarketingTabProps) {
    const [loading, setLoading] = useState(true);

    // Aggregated state
    const [adsKpis, setAdsKpis] = useState({ spend: 0, impressions: 0, clicks: 0, ctr: 0, cpm: 0 });
    const [dailyTrend, setDailyTrend] = useState<any[]>([]);
    const [mkters, setMkters] = useState<MarketerRow[]>([]);
    const [testProducts, setTestProducts] = useState<TestProduct[]>([]);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    // Q0: Ads KPIs from vw_fact_ads_performance (the REAL source)
                    `SELECT
                        ROUND(SUM(spend_ron),0) as spend,
                        SUM(impressions) as impressions,
                        SUM(clicks) as clicks,
                        ROUND(SAFE_DIVIDE(SUM(clicks)*100, NULLIF(SUM(impressions),0)),2) as ctr,
                        ROUND(SAFE_DIVIDE(SUM(spend_ron)*1000, NULLIF(SUM(impressions),0)),2) as cpm
                    FROM ${DATASET}.vw_fact_ads_performance
                    WHERE report_date BETWEEN '${from}' AND '${to}'`,

                    // Q1: Daily ads trend from vw_fact_ads_performance
                    `SELECT
                        report_date,
                        ROUND(SUM(spend_ron),0) as spend,
                        SUM(impressions) as impressions,
                        SUM(clicks) as clicks
                    FROM ${DATASET}.vw_fact_ads_performance
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                    GROUP BY 1 ORDER BY 1`,

                    // Q2: Ads spend per MARKETER CODE from vw_fact_ads_performance
                    `SELECT
                        campaign_mkter_code as mkter_code,
                        ROUND(SUM(spend_ron),0) as ads_spend,
                        SUM(impressions) as impressions,
                        SUM(clicks) as clicks
                    FROM ${DATASET}.vw_fact_ads_performance
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                    GROUP BY 1`,

                    // Q3: Marketer orders/revenue P&L from mart_performance_master
                    `SELECT
                        marketer_name,
                        SUM(total_orders) as orders,
                        SUM(success_orders) as success,
                        SUM(returned_orders) as returned,
                        ROUND(SUM(delivered_revenue),0) as revenue,
                        ROUND(SUM(revenue_total),0) as revenue_total,
                        ROUND(SUM(shipping_cost),0) as shipping,
                        ROUND(SUM(cogs),0) as cogs,
                        ROUND(SUM(net_profit),0) as net_profit
                    FROM ${DATASET}.mart_performance_master
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                        AND marketer_name IS NOT NULL
                    GROUP BY 1 ORDER BY revenue DESC`,

                    // Q4: Daily revenue for chart overlay
                    `SELECT
                        report_date,
                        ROUND(SUM(delivered_revenue),0) as revenue
                    FROM ${DATASET}.mart_performance_master
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                    GROUP BY 1 ORDER BY 1`,

                    // Q5: Test product performance per marketer (from fb_ads_data)
                    `SELECT
                        TRIM(SPLIT(CAST(campaign_name AS STRING), '/')[SAFE_OFFSET(2)]) as product_code,
                        TRIM(SPLIT(CAST(campaign_name AS STRING), '/')[SAFE_OFFSET(1)]) as marketer,
                        ROUND(SUM(SAFE_CAST(spend AS FLOAT64)), 0) as spend,
                        SUM(SAFE_CAST(impressions AS INT64)) as impressions,
                        SUM(SAFE_CAST(reach AS INT64)) as reach,
                        SUM(SAFE_CAST(messaging_conversation_started AS INT64)) as messages,
                        SUM(SAFE_CAST(clicks AS INT64)) as clicks,
                        SUM(SAFE_CAST(link_clicks AS INT64)) as link_clicks,
                        SUM(SAFE_CAST(purchases AS INT64)) as purchases,
                        ROUND(SUM(SAFE_CAST(purchase_value AS FLOAT64)), 0) as purchase_value,
                        COUNT(DISTINCT CAST(campaign_name AS STRING)) as campaigns
                    FROM ${DATASET}.fb_ads_data
                    WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                    GROUP BY 1, 2
                    ORDER BY spend DESC`,
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

                // KPIs
                const kpiRow = results[0].data?.[0] || {};
                setAdsKpis({
                    spend: kpiRow.spend || 0,
                    impressions: kpiRow.impressions || 0,
                    clicks: kpiRow.clicks || 0,
                    ctr: kpiRow.ctr || 0,
                    cpm: kpiRow.cpm || 0,
                });

                // Daily trend: merge ads spend + revenue
                const adsDaily = results[1].data || [];
                const revDaily = results[4].data || [];
                const revMap = new Map<string, number>();
                revDaily.forEach((r: any) => revMap.set(r.report_date, r.revenue || 0));
                const combinedTrend = adsDaily.map((d: any) => ({
                    report_date: d.report_date,
                    spend: d.spend || 0,
                    impressions: d.impressions || 0,
                    clicks: d.clicks || 0,
                    revenue: revMap.get(d.report_date) || 0,
                    roas: d.spend > 0 ? ((revMap.get(d.report_date) || 0) / d.spend) : 0,
                }));
                setDailyTrend(combinedTrend);

                // Merge ads spend by marketer: aggregate by CANONICAL name
                const adsPerCode = results[2].data || [];
                const adsByName = new Map<string, { ads_spend: number; impressions: number; clicks: number }>();
                adsPerCode.forEach((row: any) => {
                    const name = resolveMarketerName(row.mkter_code || "");
                    if (!isRealMarketer(name)) return;
                    const prev = adsByName.get(name) || { ads_spend: 0, impressions: 0, clicks: 0 };
                    adsByName.set(name, {
                        ads_spend: prev.ads_spend + (row.ads_spend || 0),
                        impressions: prev.impressions + (row.impressions || 0),
                        clicks: prev.clicks + (row.clicks || 0),
                    });
                });

                // Aggregate mart_performance_master P&L by CANONICAL name too
                const mkterPnl = results[3].data || [];
                const pnlByName = new Map<string, { orders: number; success: number; returned: number; revenue: number; cogs: number; shipping: number }>();
                mkterPnl.forEach((m: any) => {
                    const name = resolveMarketerName(m.marketer_name || "");
                    if (!isRealMarketer(name)) return;
                    const prev = pnlByName.get(name) || { orders: 0, success: 0, returned: 0, revenue: 0, cogs: 0, shipping: 0 };
                    pnlByName.set(name, {
                        orders: prev.orders + (m.orders || 0),
                        success: prev.success + (m.success || 0),
                        returned: prev.returned + (m.returned || 0),
                        revenue: prev.revenue + (m.revenue || 0),
                        cogs: prev.cogs + (m.cogs || 0),
                        shipping: prev.shipping + (m.shipping || 0),
                    });
                });

                // Merge both maps into final rows
                const allNames = new Set([...pnlByName.keys(), ...adsByName.keys()]);
                const merged: MarketerRow[] = [];
                allNames.forEach((name) => {
                    const pnl = pnlByName.get(name) || { orders: 0, success: 0, returned: 0, revenue: 0, cogs: 0, shipping: 0 };
                    const ads = adsByName.get(name) || { ads_spend: 0, impressions: 0, clicks: 0 };
                    const revenue = pnl.revenue;
                    const roas = ads.ads_spend > 0 ? revenue / ads.ads_spend : 0;
                    const sr = pnl.orders > 0 ? (pnl.success / pnl.orders) * 100 : 0;
                    const net_profit = revenue - pnl.cogs - pnl.shipping - ads.ads_spend;
                    merged.push({
                        marketer_name: name,
                        orders: pnl.orders,
                        success: pnl.success,
                        returned: pnl.returned,
                        revenue, ads_spend: ads.ads_spend,
                        shipping: pnl.shipping, cogs: pnl.cogs,
                        net_profit,
                        roas: Math.round(roas * 100) / 100,
                        sr: Math.round(sr * 10) / 10,
                        impressions: ads.impressions,
                        clicks: ads.clicks,
                    });
                });

                merged.sort((a, b) => b.revenue - a.revenue);
                setMkters(merged);

                // Process test products from Q5
                const testData = (results[5]?.data || []) as any[];
                const testItems: TestProduct[] = [];
                testData.forEach((row: any) => {
                    const code = (row.product_code || '').trim();
                    const mkter = (row.marketer || '').trim();
                    if (!code || !mkter) return;
                    // Skip selling products
                    if (SELLING_PRODUCTS[code]) return;
                    const spend = row.spend || 0;
                    const imp = row.impressions || 0;
                    const reach = row.reach || 0;
                    const msgs = row.messages || 0;
                    const clicks = row.clicks || 0;
                    const purchases = row.purchases || 0;
                    const purchaseValue = row.purchase_value || 0;
                    const cpm = imp > 0 ? Math.round(spend / imp * 1000) : 0;
                    const ctrVal = imp > 0 ? Math.round(clicks / imp * 10000) / 100 : 0;
                    const msgRate = reach > 0 ? Math.round(msgs / reach * 10000) / 100 : 0;
                    const cpa = purchases > 0 ? Math.round(spend / purchases) : 0;
                    const roas = spend > 0 ? Math.round(purchaseValue / spend * 100) / 100 : 0;
                    let evaluation = 'FAIL';
                    if (spend < 300000) evaluation = 'MICRO';
                    else if (msgRate > 3) evaluation = 'WIN';
                    else if (msgRate > 1.5) evaluation = 'POTENTIAL';
                    else if (msgRate > 0.5) evaluation = 'AVERAGE';
                    testItems.push({
                        product_code: code, marketer: mkter,
                        spend, impressions: imp, reach, messages: msgs,
                        clicks, purchases, purchase_value: purchaseValue,
                        campaigns: row.campaigns || 0,
                        cpm, ctr: ctrVal, msg_rate: msgRate,
                        cost_per_msg: msgs > 0 ? Math.round(spend / msgs) : 0,
                        cpa, roas, evaluation,
                    });
                });
                setTestProducts(testItems);
            } catch (error) {
                console.error("Marketing data fetch error:", error);
            } finally {
                setLoading(false);
            }
        }

        if (dateRange?.from && dateRange?.to) fetchData();
    }, [dateRange]);

    if (loading) {
        return <TabSkeleton cards={4} showChart={true} rows={5} />;
    }

    // Totals
    const totalRevenue = mkters.reduce((s, m) => s + m.revenue, 0);
    const totalSpend = mkters.reduce((s, m) => s + m.ads_spend, 0);
    const totalProfit = mkters.reduce((s, m) => s + m.net_profit, 0);
    const totalOrders = mkters.reduce((s, m) => s + m.orders, 0);
    const totalSuccess = mkters.reduce((s, m) => s + m.success, 0);
    const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const overallSR = totalOrders > 0 ? (totalSuccess / totalOrders) * 100 : 0;

    // Chart data
    const roasChart = mkters.filter(m => m.ads_spend > 0).map((m) => ({
        name: m.marketer_name?.split(" ").slice(-2).join(" ") || "?",
        roas: m.roas || 0,
        spend: m.ads_spend,
        revenue: m.revenue,
    }));

    const spendPie = mkters.filter(m => m.ads_spend > 0).map((m) => ({
        name: m.marketer_name?.split(" ").slice(-2).join(" ") || "?",
        value: m.ads_spend,
    }));

    return (
        <div className="space-y-6">
            {/* ── KPIs Row 1: Ads Metrics ── */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard title="💰 Total Ads Spend" value={formatCurrency(adsKpis.spend)} icon={Megaphone} />
                <KPICard title="🎯 ROAS (Overall)" value={`${overallRoas.toFixed(2)}x`} icon={Target}
                    status={overallRoas >= 3 ? "success" : overallRoas >= 2 ? "warning" : "danger"} />
                <KPICard title="📈 Net P&L" value={formatCurrency(totalProfit)} icon={TrendingUp}
                    status={totalProfit >= 0 ? "success" : "danger"} />
                <KPICard title="👁 Impressions" value={formatNumber(adsKpis.impressions)} icon={Eye} />
                <KPICard title="📊 CTR" value={`${adsKpis.ctr.toFixed(2)}%`} icon={Percent}
                    status={adsKpis.ctr > 3 ? "success" : "warning"} />
                <KPICard title="💵 CPM" value={formatCurrency(adsKpis.cpm)} icon={Coins}
                    subValue={`${CURRENCY_SYMBOL}/1000 impr`} />
            </div>

            {/* ── KPIs Row 2: Revenue & Orders ── */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard title="💰 Revenue (TC)" value={formatCurrency(totalRevenue)} icon={DollarSign} status="success" />
                <KPICard title="📦 Tổng đơn" value={formatNumber(totalOrders)} icon={Trophy} />
                <KPICard title="✅ Thành công" value={formatNumber(totalSuccess)} icon={TrendingUp}
                    subValue={`SR: ${overallSR.toFixed(1)}%`} status="success" />
                <KPICard title="🖱 Clicks" value={formatNumber(adsKpis.clicks)} icon={MousePointer} />
                <KPICard title="👥 Marketers" value={String(mkters.length)} icon={Users} />
                <KPICard title="💸 Avg CPA" value={totalSuccess > 0 ? formatCurrency(totalSpend / totalSuccess) : "—"} icon={Coins}
                    subValue={`${CURRENCY_SYMBOL}/đơn TC`} />
            </div>

            {/* ── Top 4 Marketer Cards ── */}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {mkters.slice(0, 4).map((m, i) => {
                    const grade = gradeMarketer(m.roas || 0, m.net_profit);
                    const medal = ["🥇", "🥈", "🥉", ""][i] || "";
                    const borderColor = m.net_profit >= 0 ? "border-l-emerald-500" : "border-l-rose-500";
                    const cpa = m.success > 0 ? m.ads_spend / m.success : 0;
                    return (
                        <div key={m.marketer_name}
                            className={cn("rounded-lg border border-border border-l-[3px] bg-card p-4", borderColor)}>
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-semibold text-muted-foreground">{medal} {m.marketer_name}</span>
                                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", grade.cls)}>{grade.label}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                <div>ROAS: <span className={cn("font-bold", m.roas >= 2.5 ? "text-emerald-400" : "text-amber-400")}>{m.roas}x</span></div>
                                <div>CPA: <span className="font-bold text-blue-400">{cpa > 0 ? formatMoney(cpa) : "—"}</span></div>
                                <div>Đơn: {formatNumber(m.orders)}</div>
                                <div>SR: <span className={cn(m.sr >= 60 ? "text-emerald-400" : "text-amber-400")}>{m.sr}%</span></div>
                                <div>Revenue: <span className="text-emerald-400">{formatMoney(m.revenue)}</span></div>
                                <div>Ads: <span className="text-amber-400">{formatMoney(m.ads_spend)}</span></div>
                                <div>COGS: <span className="text-orange-400">{formatMoney(m.cogs)}</span></div>
                                <div>Shipping: <span className="text-cyan-400">{formatMoney(m.shipping)}</span></div>
                            </div>
                            <div className="mt-2 flex justify-between border-t border-border pt-2 text-xs">
                                <span className="font-semibold">Net P&L:</span>
                                <span className={cn("font-bold", m.net_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {m.net_profit >= 0 ? "+" : ""}{formatMoney(m.net_profit)} {CURRENCY_SYMBOL}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── Charts Row ── */}
            <div className="grid gap-4 lg:grid-cols-2">
                {/* Daily Spend vs Revenue */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        💰 Daily: Spend vs Revenue vs ROAS
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={dailyTrend}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="report_date"
                                tickFormatter={(v) => { try { return format(new Date(v), "dd/MM"); } catch { return String(v).slice(5); } }}
                                tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                            <Legend />
                            <Bar yAxisId="left" dataKey="spend" name={`Spend (${CURRENCY_SYMBOL})`} fill="#ef4444" radius={[4, 4, 0, 0]} />
                            <Line yAxisId="left" type="monotone" dataKey="revenue" name={`Revenue (${CURRENCY_SYMBOL})`} stroke="#34d399" strokeWidth={2} dot={false} />
                            <Line yAxisId="right" type="monotone" dataKey="roas" name="ROAS" stroke="#818cf8" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>

                {/* ROAS per Marketer */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-indigo-400" />
                        🎯 ROAS per Marketer
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={roasChart}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                                formatter={(val: any, name: string) => [name === "roas" ? `${val}x` : formatMoney(val as number), name]} />
                            <Legend />
                            <Bar dataKey="roas" name="ROAS" fill="#34d399" radius={[4, 4, 0, 0]}>
                                {roasChart.map((e, i) => (
                                    <Cell key={i} fill={e.roas >= 3 ? "#34d399" : e.roas >= 2 ? "#f59e0b" : "#ef4444"} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Spend Distribution Pie */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-pink-400" />
                        📊 Ads Spend Distribution
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                            <Pie data={spendPie} dataKey="value" nameKey="name" cx="50%" cy="50%"
                                outerRadius={100} innerRadius={45}
                                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}>
                                {spendPie.map((_, i) => (
                                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                {/* Revenue vs Cost Stack per Marketer */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-amber-400" />
                        💰 Revenue vs Costs per Marketer
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={mkters.filter(m => m.revenue > 0 || m.ads_spend > 0).map(m => ({
                            name: m.marketer_name?.split(" ").slice(-2).join(" ") || "?",
                            revenue: m.revenue,
                            ads: m.ads_spend,
                            cogs: m.cogs,
                            shipping: m.shipping,
                        }))} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis dataKey="name" type="category" tick={{ fill: "#94a3b8", fontSize: 10 }} width={80} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                            <Legend />
                            <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" barSize={8} />
                            <Bar dataKey="ads" name="Ads" fill="#f59e0b" barSize={8} />
                            <Bar dataKey="cogs" name="COGS" fill="#f97316" barSize={8} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* ── Full Marketer P&L Table ── */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">📋 Marketer P&L Detail</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">Marketer</th>
                                <th className="px-2 pb-2 text-right font-medium">Đơn</th>
                                <th className="px-2 pb-2 text-right font-medium">TC</th>
                                <th className="px-2 pb-2 text-right font-medium">Hoàn</th>
                                <th className="px-2 pb-2 text-right font-medium">SR%</th>
                                <th className="px-2 pb-2 text-right font-medium">Revenue</th>
                                <th className="px-2 pb-2 text-right font-medium">Ads Spend</th>
                                <th className="px-2 pb-2 text-right font-medium">COGS</th>
                                <th className="px-2 pb-2 text-right font-medium">Shipping</th>
                                <th className="px-2 pb-2 text-right font-medium">Net P&L</th>
                                <th className="px-2 pb-2 text-right font-medium">ROAS</th>
                                <th className="px-2 pb-2 text-right font-medium">CPA</th>
                                <th className="px-2 pb-2 text-right font-medium">Impr.</th>
                                <th className="px-2 pb-2 text-right font-medium">Clicks</th>
                                <th className="px-2 pb-2 text-right font-medium">Grade</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mkters.map((m) => {
                                const grade = gradeMarketer(m.roas || 0, m.net_profit);
                                const cpa = m.success > 0 ? m.ads_spend / m.success : 0;
                                return (
                                    <tr key={m.marketer_name} className="border-b border-border/30 hover:bg-gray-50/50">
                                        <td className="px-2 py-2.5 font-semibold text-foreground whitespace-nowrap">{m.marketer_name}</td>
                                        <td className="px-2 py-2.5 text-right">{formatNumber(m.orders)}</td>
                                        <td className="px-2 py-2.5 text-right text-emerald-400">{formatNumber(m.success)}</td>
                                        <td className="px-2 py-2.5 text-right text-rose-400">{formatNumber(m.returned)}</td>
                                        <td className={cn("px-2 py-2.5 text-right font-bold", m.sr >= 60 ? "text-emerald-400" : "text-amber-400")}>{m.sr}%</td>
                                        <td className="px-2 py-2.5 text-right font-semibold text-blue-400">{formatMoney(m.revenue)}</td>
                                        <td className={cn("px-2 py-2.5 text-right font-medium", m.ads_spend > 0 ? "text-amber-400" : "text-muted-foreground")}>{formatMoney(m.ads_spend)}</td>
                                        <td className="px-2 py-2.5 text-right text-orange-400">{formatMoney(m.cogs)}</td>
                                        <td className="px-2 py-2.5 text-right text-cyan-400">{formatMoney(m.shipping)}</td>
                                        <td className={cn("px-2 py-2.5 text-right font-bold", m.net_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {m.net_profit >= 0 ? "+" : ""}{formatMoney(m.net_profit)}
                                        </td>
                                        <td className={cn("px-2 py-2.5 text-right font-bold", m.roas >= 3 ? "text-emerald-400" : m.roas >= 2 ? "text-amber-400" : "text-rose-400")}>
                                            {m.roas > 0 ? `${m.roas}x` : "—"}
                                        </td>
                                        <td className="px-2 py-2.5 text-right text-muted-foreground">
                                            {cpa > 0 ? formatMoney(cpa) : "—"}
                                        </td>
                                        <td className="px-2 py-2.5 text-right text-muted-foreground">{formatNumber(m.impressions)}</td>
                                        <td className="px-2 py-2.5 text-right text-muted-foreground">{formatNumber(m.clicks)}</td>
                                        <td className="px-2 py-2.5 text-right">
                                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", grade.cls)}>{grade.label}</span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {/* Totals */}
                            <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                <td className="px-2 py-2.5 text-foreground">TỔNG</td>
                                <td className="px-2 py-2.5 text-right">{formatNumber(totalOrders)}</td>
                                <td className="px-2 py-2.5 text-right text-emerald-400">{formatNumber(totalSuccess)}</td>
                                <td className="px-2 py-2.5 text-right text-rose-400">{formatNumber(mkters.reduce((s, m) => s + m.returned, 0))}</td>
                                <td className="px-2 py-2.5 text-right">{overallSR.toFixed(1)}%</td>
                                <td className="px-2 py-2.5 text-right text-blue-400">{formatMoney(totalRevenue)}</td>
                                <td className="px-2 py-2.5 text-right text-amber-400">{formatMoney(totalSpend)}</td>
                                <td className="px-2 py-2.5 text-right text-orange-400">{formatMoney(mkters.reduce((s, m) => s + m.cogs, 0))}</td>
                                <td className="px-2 py-2.5 text-right text-cyan-400">{formatMoney(mkters.reduce((s, m) => s + m.shipping, 0))}</td>
                                <td className={cn("px-2 py-2.5 text-right", totalProfit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {totalProfit >= 0 ? "+" : ""}{formatMoney(totalProfit)}
                                </td>
                                <td className="px-2 py-2.5 text-right">{overallRoas.toFixed(2)}x</td>
                                <td className="px-2 py-2.5" colSpan={4}></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── 🧪 Test Product Tables per Marketer ── */}
            {(() => {
                const testMkters = Array.from(new Set(testProducts.map(t => t.marketer))).sort();
                return (
                    <div className="space-y-4">
                        <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
                            <FlaskConical className="h-5 w-5 text-purple-400" />
                            🧪 Sản Phẩm Test — Đánh giá theo Marketer
                        </h3>
                        <p className="text-xs text-muted-foreground">
                            Chỉ số từ Meta Ads: Spend, Impressions, Reach, Messages, CPM, Message Rate, Chi phí/Tin nhắn.
                            Đánh giá: 🏆 WIN (msg rate &gt; 3%) | 📈 Potential (&gt; 1.5%) | ⚖️ TB (&gt; 0.5%) | ❌ Fail (&lt; 0.5%) | 🔬 Micro (spend &lt; 300K)
                        </p>

                        {testMkters.length === 0 && (
                            <div className="text-sm text-muted-foreground p-4 border border-border rounded-lg">
                                Không có sản phẩm test trong giai đoạn này.
                            </div>
                        )}

                        {testMkters.map((mName) => {
                            const items = testProducts
                                .filter(t => t.marketer === mName)
                                .sort((a, b) => b.spend - a.spend);
                            const totalSpendMk = items.reduce((s, t) => s + t.spend, 0);
                            const totalMsgsMk = items.reduce((s, t) => s + t.messages, 0);
                            const winCount = items.filter(t => t.evaluation === 'WIN').length;
                            const failCount = items.filter(t => t.evaluation === 'FAIL').length;

                            return (
                                <div key={mName} className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-5">
                                    <div className="flex items-center justify-between mb-3">
                                        <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
                                            <ShoppingBag className="h-4 w-4 text-purple-400" />
                                            {resolveMarketerName(mName)}
                                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                                {items.length} SP test | Spend: {formatMoney(totalSpendMk)} | Msgs: {totalMsgsMk}
                                            </span>
                                        </h4>
                                        <div className="flex gap-2 text-xs">
                                            <span className="rounded-full bg-emerald-500/20 text-emerald-400 px-2 py-0.5 font-bold">
                                                {winCount} WIN
                                            </span>
                                            <span className="rounded-full bg-rose-500/20 text-rose-400 px-2 py-0.5 font-bold">
                                                {failCount} FAIL
                                            </span>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="border-b border-purple-500/20 text-muted-foreground">
                                                    <th className="px-2 pb-2 text-left font-medium">SP test</th>
                                                    <th className="px-2 pb-2 text-right font-medium">Spend</th>
                                                    <th className="px-2 pb-2 text-right font-medium">Impr</th>
                                                    <th className="px-2 pb-2 text-right font-medium">Reach</th>
                                                    <th className="px-2 pb-2 text-right font-medium">Clicks</th>
                                                    <th className="px-2 pb-2 text-right font-medium">Msgs</th>
                                                    <th className="px-2 pb-2 text-right font-medium">CPM</th>
                                                    <th className="px-2 pb-2 text-right font-medium">CTR</th>
                                                    <th className="px-2 pb-2 text-right font-medium">Msg%</th>
                                                    <th className="px-2 pb-2 text-right font-medium">CP/Msg</th>
                                                    <th className="px-2 pb-2 text-right font-medium">Purch</th>
                                                    <th className="px-2 pb-2 text-right font-medium">CPA</th>
                                                    <th className="px-2 pb-2 text-right font-medium">ROAS</th>
                                                    <th className="px-2 pb-2 text-center font-medium">Đánh giá</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {items.map((t) => {
                                                    const evalColor = t.evaluation === 'WIN'
                                                        ? 'bg-emerald-500/20 text-emerald-400'
                                                        : t.evaluation === 'POTENTIAL'
                                                            ? 'bg-blue-500/20 text-blue-400'
                                                            : t.evaluation === 'AVERAGE'
                                                                ? 'bg-amber-500/20 text-amber-400'
                                                                : t.evaluation === 'MICRO'
                                                                    ? 'bg-slate-500/20 text-slate-400'
                                                                    : 'bg-rose-500/20 text-rose-400';
                                                    return (
                                                        <tr key={t.product_code} className="hover:bg-purple-500/5">
                                                            <td className="px-2 py-2 font-medium text-foreground">{t.product_code}</td>
                                                            <td className="px-2 py-2 text-right text-amber-400 font-bold">{formatMoney(t.spend)}</td>
                                                            <td className="px-2 py-2 text-right text-muted-foreground">{formatNumber(t.impressions)}</td>
                                                            <td className="px-2 py-2 text-right text-muted-foreground">{formatNumber(t.reach)}</td>
                                                            <td className="px-2 py-2 text-right text-muted-foreground">{t.clicks > 0 ? formatNumber(t.clicks) : '—'}</td>
                                                            <td className="px-2 py-2 text-right text-indigo-400 font-bold">{formatNumber(t.messages)}</td>
                                                            <td className="px-2 py-2 text-right text-muted-foreground">{formatMoney(t.cpm)}</td>
                                                            <td className="px-2 py-2 text-right text-muted-foreground">{t.ctr > 0 ? t.ctr.toFixed(1) + '%' : '—'}</td>
                                                            <td className={cn("px-2 py-2 text-right font-bold",
                                                                t.msg_rate >= 3 ? 'text-emerald-400' : t.msg_rate >= 1.5 ? 'text-amber-400' : 'text-rose-400'
                                                            )}>{t.msg_rate.toFixed(1)}%</td>
                                                            <td className={cn("px-2 py-2 text-right font-bold",
                                                                t.cost_per_msg > 0 && t.cost_per_msg < 20000 ? 'text-emerald-400' : t.cost_per_msg < 50000 ? 'text-amber-400' : 'text-rose-400'
                                                            )}>{t.cost_per_msg > 0 ? formatMoney(t.cost_per_msg) : '—'}</td>
                                                            <td className="px-2 py-2 text-right text-emerald-400 font-bold">{t.purchases > 0 ? formatNumber(t.purchases) : '—'}</td>
                                                            <td className="px-2 py-2 text-right text-amber-400">{t.cpa > 0 ? formatMoney(t.cpa) : '—'}</td>
                                                            <td className={cn("px-2 py-2 text-right font-bold",
                                                                t.roas >= 3 ? 'text-emerald-400' : t.roas >= 1 ? 'text-amber-400' : 'text-rose-400'
                                                            )}>{t.roas > 0 ? t.roas.toFixed(2) + 'x' : '—'}</td>
                                                            <td className="px-2 py-2 text-center">
                                                                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', evalColor)}>
                                                                    {t.evaluation === 'WIN' ? '🏆 WIN' : t.evaluation === 'POTENTIAL' ? '📈 Pot' : t.evaluation === 'AVERAGE' ? '⚖️ TB' : t.evaluation === 'MICRO' ? '🔬 Mc' : '❌ F'}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                                <tr className="border-t-2 border-purple-500/30 bg-purple-500/10 font-bold">
                                                    <td className="px-2 py-2 text-foreground">{items.length} SP test</td>
                                                    <td className="px-2 py-2 text-right text-amber-400">{formatMoney(totalSpendMk)}</td>
                                                    <td className="px-2 py-2 text-right">{formatNumber(items.reduce((s, t) => s + t.impressions, 0))}</td>
                                                    <td className="px-2 py-2 text-right">{formatNumber(items.reduce((s, t) => s + t.reach, 0))}</td>
                                                    <td className="px-2 py-2 text-right">{formatNumber(items.reduce((s, t) => s + t.clicks, 0)) || '—'}</td>
                                                    <td className="px-2 py-2 text-right text-indigo-400">{formatNumber(totalMsgsMk)}</td>
                                                    <td colSpan={8}></td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Show marketers with NO test products */}
                        {mkters.filter(m => !testMkters.includes(m.marketer_name) && !testMkters.some(t => resolveMarketerName(t) === m.marketer_name)).map(m => (
                            <div key={m.marketer_name} className="rounded-xl border border-slate-500/20 bg-slate-500/5 p-4 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <ShoppingBag className="h-4 w-4 text-slate-400" />
                                    <span className="text-sm font-bold text-foreground">{m.marketer_name}</span>
                                    <span className="text-xs text-muted-foreground ml-2">
                                        Chỉ chạy SP bán hàng, không có SP test trong giai đoạn này
                                    </span>
                                </div>
                                <span className="rounded-full bg-blue-500/20 text-blue-400 px-2 py-0.5 text-[10px] font-bold">
                                    SELLING ONLY
                                </span>
                            </div>
                        ))}
                    </div>
                );
            })()}
        </div>
    );
}
