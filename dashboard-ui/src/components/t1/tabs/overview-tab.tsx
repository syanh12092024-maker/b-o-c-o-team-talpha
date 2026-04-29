"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, Cell, ReferenceLine,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatNumber, cn } from "@/lib/utils";
import TabSkeleton from "@/components/ui/tab-skeleton";
import {
    DollarSign, TrendingUp, TrendingDown, Activity,
    Users, Package, Target, Megaphone, Phone, Truck, Receipt,
} from "lucide-react";

// ═══ Constants ═══
const DS = "levelup-465304.T1_Dataset";
const EUR_TO_VND = 28000;
const USD_TO_VND = 25000;
const EUR_F = EUR_TO_VND / 100;
const REVENUE_STATUS = 16;
const SUCCESS_STATUSES = '3,16';
const COGS_PER_UNIT_VND = 0.90 * EUR_TO_VND; // €0.90 per unit
const CALL_CENTER_PER_ORDER_VND = 0.40 * USD_TO_VND; // $0.40 per call

// ═══ Helpers ═══
async function queryBQ(sql: string) {
    const r = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }) });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    return data.data || [];
}
function fmtVND(v: number) { const a = Math.abs(v); const s = v < 0 ? "-" : ""; if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}ty`; if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}tr`; if (a >= 1e3) return `${s}${Math.round(a / 1e3)}K`; return `${s}${Math.round(a)}`; }
function fmtMoney(v: number) { return new Intl.NumberFormat("vi-VN").format(Math.round(v)); }
function fmtUSD(usd: number) { return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; }

interface Props { dateRange?: { from: Date; to: Date }; }

export default function OverviewTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [totals, setTotals] = useState<any>(null);
    const [adsTotals, setAdsTotals] = useState<any>(null);
    const [marketers, setMarketers] = useState<any[]>([]);
    const [daily, setDaily] = useState<any[]>([]);
    const [pnlSummary, setPnlSummary] = useState<any>(null);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const results = await Promise.all([
                    // Q0: Order totals
                    queryBQ(`SELECT
                        COUNT(DISTINCT id) AS total_orders,
                        COUNT(DISTINCT CASE WHEN status = ${REVENUE_STATUS} THEN id END) AS paid_orders,
                        COUNT(DISTINCT CASE WHEN status IN (${SUCCESS_STATUSES}) THEN id END) AS success_orders,
                        COUNT(DISTINCT CASE WHEN status = 3 THEN id END) AS received_orders,
                        COUNT(DISTINCT CASE WHEN status = 5 THEN id END) AS returned_orders,
                        COUNT(DISTINCT CASE WHEN status = 6 THEN id END) AS cancelled_orders,
                        COUNT(DISTINCT CASE WHEN status = 8 THEN id END) AS packing_orders,
                        COUNT(DISTINCT CASE WHEN status = 4 THEN id END) AS returning_orders,
                        ROUND(SUM(CASE WHEN status = ${REVENUE_STATUS} THEN total_price ELSE 0 END), 0) AS gross_revenue,
                        ROUND(SUM(CASE WHEN status = 3 THEN total_price ELSE 0 END), 0) AS pending_revenue,
                        COUNT(DISTINCT bill_phone_number) AS unique_customers
                    FROM \`${DS}.sale_order\`
                    WHERE SAFE_CAST(SUBSTR(updated_at, 1, 10) AS DATE) BETWEEN '${from}' AND '${to}'`).catch(() => []),

                    // Q1: Ads totals (deduped)
                    queryBQ(`WITH fb_dedup AS (
                        SELECT * FROM \`${DS}.fb_ads_data\`
                        WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                        QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
                    )
                    SELECT ROUND(SUM(spend), 2) AS total_spend, SUM(impressions) AS total_impressions,
                        SUM(clicks) AS total_clicks, SUM(purchases) AS total_purchases
                    FROM fb_dedup`).catch(() => []),

                    // Q2: Marketer performance
                    queryBQ(`WITH orders_by_campaign AS (
                        SELECT o.p_utm_campaign AS campaign_id,
                            MAX(o.marketer) AS pos_marketer,
                            COUNT(DISTINCT o.id) AS orders,
                            COUNT(DISTINCT CASE WHEN o.status = ${REVENUE_STATUS} THEN o.id END) AS success,
                            COUNT(DISTINCT CASE WHEN o.status = 5 THEN o.id END) AS returned,
                            ROUND(SUM(CASE WHEN o.status = ${REVENUE_STATUS} THEN o.total_price ELSE 0 END), 0) AS revenue
                        FROM \`${DS}.sale_order\` o
                        WHERE o.p_utm_campaign IS NOT NULL AND o.p_utm_campaign != ''
                            AND SAFE_CAST(SUBSTR(o.updated_at, 1, 10) AS DATE) BETWEEN '${from}' AND '${to}'
                        GROUP BY 1
                    ),
                    fb_dedup AS (
                        SELECT * FROM \`${DS}.fb_ads_data\`
                        WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                        QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
                    ),
                    campaign_ads AS (
                        SELECT campaign_id, campaign_name, ROUND(SUM(spend), 2) AS spend
                        FROM fb_dedup GROUP BY 1, 2
                    ),
                    merged AS (
                        SELECT
                            COALESCE(ca.campaign_name, CONCAT('Campaign ', oc.campaign_id)) AS campaign_name,
                            COALESCE(
                                NULLIF(UPPER(REGEXP_EXTRACT(COALESCE(ca.campaign_name, ''), r'^([A-Za-z]+)')), ''),
                                NULLIF(UPPER(oc.pos_marketer), ''),
                                'Unknown'
                            ) AS marketer,
                            oc.orders, oc.success, oc.returned,
                            oc.revenue * ${EUR_F} AS revenue_vnd,
                            COALESCE(ca.spend, 0) AS ads_spend_usd
                        FROM orders_by_campaign oc
                        LEFT JOIN campaign_ads ca ON oc.campaign_id = ca.campaign_id
                    )
                    SELECT marketer,
                        SUM(orders) AS orders, SUM(success) AS success, SUM(returned) AS returned,
                        ROUND(SUM(revenue_vnd), 0) AS revenue_vnd,
                        ROUND(SUM(ads_spend_usd), 2) AS ads_spend_usd,
                        ROUND(SAFE_DIVIDE(SUM(success)*100, NULLIF(SUM(orders),0)), 1) AS sr,
                        ROUND(SAFE_DIVIDE(SUM(revenue_vnd), NULLIF(SUM(ads_spend_usd) * ${USD_TO_VND}, 0)), 2) AS roas
                    FROM merged GROUP BY 1 ORDER BY revenue_vnd DESC`).catch(() => []),

                    // Q3: Daily P&L data (orders)
                    queryBQ(`SELECT SAFE_CAST(SUBSTR(o.updated_at,1,10) AS STRING) as report_date,
                        COUNT(DISTINCT CASE WHEN o.status = 16 THEN o.id END) as paid_orders,
                        ROUND(SUM(CASE WHEN o.status = 16 THEN o.total_price ELSE 0 END) * ${EUR_F}, 0) as revenue,
                        SUM(CASE WHEN o.status = 16 THEN o.total_quantity ELSE 0 END) as paid_qty,
                        COUNT(DISTINCT o.id) as total_orders
                    FROM \`${DS}.sale_order\` o
                    WHERE SAFE_CAST(SUBSTR(o.updated_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
                    GROUP BY 1 ORDER BY 1 DESC`).catch(() => []),

                    // Q4: Daily ads spend (deduped)
                    queryBQ(`WITH fb_dedup AS (
                        SELECT * FROM \`${DS}.fb_ads_data\`
                        WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                        QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
                    )
                    SELECT SAFE_CAST(date AS STRING) as report_date, ROUND(SUM(spend) * ${USD_TO_VND}, 0) as ads
                    FROM fb_dedup GROUP BY 1`).catch(() => []),

                    // Q5: Call center cost
                    queryBQ(`SELECT SAFE_CAST(SUBSTR(o.updated_at,1,10) AS STRING) as report_date,
                        COUNT(DISTINCT o.id) as confirmed_calls
                    FROM \`${DS}.sale_order\` o,
                    UNNEST(JSON_EXTRACT_ARRAY(o.tags)) AS raw_tag,
                    UNNEST([STRUCT(JSON_EXTRACT_SCALAR(raw_tag, '$.name') AS tag_name)]) AS t
                    WHERE t.tag_name = 'Xác nhận'
                        AND SAFE_CAST(SUBSTR(o.updated_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
                    GROUP BY 1`).catch(() => []),

                    // Q6: Fulfillment cost
                    queryBQ(`SELECT
                        ROUND(SUM(IFNULL(total_3pl_cost_eur, 0)) * ${EUR_TO_VND}, 0) as total_ffm_vnd,
                        SUM(IFNULL(total_3pl_cost_eur, 0)) as total_ffm_eur,
                        COUNT(*) as ffm_orders
                    FROM \`${DS}.fulfillment_orders\`
                    WHERE status NOT IN ('validation_failed', 'cancelled')
                        AND SAFE_CAST(SUBSTR(created_at, 1, 10) AS DATE) BETWEEN '${from}' AND '${to}'`).catch(() => []),
                ]);

                const orderTotals = results[0]?.[0] || {};
                const adsTotal = results[1]?.[0] || {};
                const orders = results[3] || [];
                const adsDaily = results[4] || [];
                const calls = results[5] || [];
                const ffmData = results[6] || [];

                setTotals(orderTotals);
                setAdsTotals(adsTotal);
                setMarketers(results[2] || []);

                // Build P&L daily
                const adsMap = new Map<string, number>();
                adsDaily.forEach((a: any) => adsMap.set(a.report_date, a.ads || 0));
                const callMap = new Map<string, number>();
                calls.forEach((c: any) => callMap.set(c.report_date, c.confirmed_calls || 0));

                const ffmInfo = ffmData[0] || {};
                const totalFfmVND = Number(ffmInfo.total_ffm_vnd || 0);
                const daysWithOrders = orders.filter((r: any) => (r.paid_orders || 0) > 0).length || 1;
                const ffmPerDay = daysWithOrders > 0 ? totalFfmVND / daysWithOrders : 0;

                let totRev = 0, totAds = 0, totCogs = 0, totCall = 0;
                const rows = orders.map((r: any) => {
                    const rev = r.revenue || 0;
                    const qty = r.paid_qty || 0;
                    const adsV = adsMap.get(r.report_date) || 0;
                    const cogs = qty * COGS_PER_UNIT_VND;
                    const callCount = callMap.get(r.report_date) || 0;
                    const callCost = callCount * CALL_CENTER_PER_ORDER_VND;
                    const fulfillment = (r.paid_orders || 0) > 0 ? ffmPerDay : 0;
                    const totalCost = adsV + cogs + callCost + fulfillment;
                    const profit = rev - totalCost;
                    totRev += rev; totAds += adsV; totCogs += cogs; totCall += callCost;
                    return { date: r.report_date, revenue: rev, ads: adsV, cogs, callCost, callCount, fulfillment, totalCost, profit, paidOrders: r.paid_orders || 0, paidQty: qty };
                });
                setDaily(rows);

                const totCost = totAds + totCogs + totCall + totalFfmVND;
                setPnlSummary({
                    revenue: totRev, ads: totAds, cogs: totCogs, callCenter: totCall, fulfillment: totalFfmVND,
                    totalCost: totCost, profit: totRev - totCost,
                    margin: totRev > 0 ? ((totRev - totCost) / totRev * 100) : 0,
                });
            } catch (error) {
                console.error("Overview fetch error:", error);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [dateRange]);

    if (loading) return <TabSkeleton cards={6} showChart={true} rows={5} />;

    const revenueVND = (totals?.gross_revenue || 0) * EUR_F;
    const pendingVND = (totals?.pending_revenue || 0) * EUR_F;
    const totalAdsUSD = adsTotals?.total_spend || 0;
    const totalAdsVND = totalAdsUSD * USD_TO_VND;
    const roas = totalAdsVND > 0 ? revenueVND / totalAdsVND : 0;
    const paidOrders = totals?.paid_orders || 0;

    const waterfallData = pnlSummary ? [
        { name: "Doanh thu", value: pnlSummary.revenue, fill: "#34d399" },
        { name: "Giá vốn", value: -pnlSummary.cogs, fill: "#f87171" },
        { name: "Ads", value: -pnlSummary.ads, fill: "#fbbf24" },
        { name: "Call", value: -pnlSummary.callCenter, fill: "#60a5fa" },
        { name: "3PL", value: -pnlSummary.fulfillment, fill: "#a78bfa" },
        { name: "Lợi nhuận", value: pnlSummary.profit, fill: pnlSummary.profit >= 0 ? "#34d399" : "#f87171" },
    ] : [];

    return (
        <div className="space-y-6">
            {/* ═══ KPI Cards ═══ */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard title="Đã Thu Tiền" value={fmtVND(revenueVND)} icon={DollarSign}
                    status={revenueVND > 0 ? "success" : "neutral"} subValue={`${paidOrders} đơn đã thu tiền`} />
                <KPICard title="Ads Spend" value={fmtUSD(totalAdsUSD)} icon={Megaphone}
                    status="warning" subValue={`= ${fmtVND(totalAdsVND)} VND`} />
                <KPICard title="ROAS" value={`${roas.toFixed(2)}x`} icon={Target}
                    status={roas >= 2.5 ? "success" : roas >= 1.5 ? "warning" : "danger"}
                    subValue={`${adsTotals?.total_purchases || 0} purchases`} />
                <KPICard title="Lợi nhuận" value={pnlSummary ? fmtVND(pnlSummary.profit) : "---"} icon={pnlSummary?.profit >= 0 ? TrendingUp : TrendingDown}
                    status={pnlSummary?.profit >= 0 ? "success" : "danger"}
                    subValue={pnlSummary ? `Biên ${pnlSummary.margin.toFixed(1)}%` : ""} />
                <KPICard title="Khách hàng" value={String(totals?.unique_customers || 0)} icon={Users} status="neutral" subValue="Unique" />
                <KPICard title="Đơn hàng" value={`${paidOrders} / ${totals?.total_orders || 0}`} icon={Package}
                    status="neutral" subValue={`Nhận: ${totals?.received_orders || 0} | Đóng: ${totals?.packing_orders || 0}`} />
            </div>

            {/* ═══ Order Status ═══ */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Tình trạng đơn hàng (theo POS Cake)</h3>
                <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
                    <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-center">
                        <div className="text-xs text-amber-600">Đang đóng hàng</div>
                        <div className="mt-1 text-2xl font-bold text-amber-600">{totals?.packing_orders || 0}</div>
                    </div>
                    <div className="rounded-lg bg-sky-50 border border-sky-200 p-3 text-center">
                        <div className="text-xs text-sky-600">Đã nhận (chờ đối soát)</div>
                        <div className="mt-1 text-2xl font-bold text-sky-600">{totals?.received_orders || 0}</div>
                        <div className="text-[10px] text-sky-500 mt-0.5">{fmtVND(pendingVND)}</div>
                    </div>
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-center">
                        <div className="text-xs text-emerald-600 font-semibold">✅ Đã thu tiền</div>
                        <div className="mt-1 text-2xl font-bold text-emerald-600">{paidOrders}</div>
                        <div className="text-[10px] text-emerald-500 mt-0.5">{fmtVND(revenueVND)}</div>
                    </div>
                    <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 text-center">
                        <div className="text-xs text-orange-600">Đang hoàn</div>
                        <div className="mt-1 text-2xl font-bold text-orange-600">{totals?.returning_orders || 0}</div>
                    </div>
                    <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-center">
                        <div className="text-xs text-red-600">Đã hoàn</div>
                        <div className="mt-1 text-2xl font-bold text-red-600">{totals?.returned_orders || 0}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-center">
                        <div className="text-xs text-gray-500">Đã hủy</div>
                        <div className="mt-1 text-2xl font-bold text-gray-500">{totals?.cancelled_orders || 0}</div>
                    </div>
                </div>
            </div>

            {/* ═══ Cost Breakdown ═══ */}
            {pnlSummary && (
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Cơ cấu chi phí</h3>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-700 mb-1"><Package className="w-3 h-3" /> Giá vốn (COGS)</div>
                            <div className="text-xl font-bold text-rose-700">{fmtVND(pnlSummary.cogs)}</div>
                        </div>
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 mb-1"><Receipt className="w-3 h-3" /> Chi phí Ads</div>
                            <div className="text-xl font-bold text-amber-700">{fmtVND(pnlSummary.ads)}</div>
                        </div>
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-blue-700 mb-1"><Phone className="w-3 h-3" /> Call Center</div>
                            <div className="text-xl font-bold text-blue-700">{fmtVND(pnlSummary.callCenter)}</div>
                        </div>
                        <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-purple-700 mb-1"><Truck className="w-3 h-3" /> Fulfillment</div>
                            <div className="text-xl font-bold text-purple-700">{pnlSummary.fulfillment > 0 ? fmtVND(pnlSummary.fulfillment) : "—"}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ Charts ═══ */}
            <div className="grid gap-4 lg:grid-cols-2">
                {/* P&L Waterfall */}
                {waterfallData.length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-5">
                        <h3 className="mb-3 text-sm font-semibold text-foreground">P&L Waterfall</h3>
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={waterfallData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => fmtVND(Math.abs(v))} />
                                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
                                    formatter={(v: any) => fmtVND(Math.abs(v))} />
                                <ReferenceLine y={0} stroke="#94a3b8" />
                                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                    {waterfallData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* Daily Rev vs Cost */}
                {daily.length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-5">
                        <h3 className="mb-3 text-sm font-semibold text-foreground">Doanh thu vs Chi phí hàng ngày</h3>
                        <ResponsiveContainer width="100%" height={280}>
                            <ComposedChart data={daily.slice().reverse()}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                <XAxis dataKey="date" tickFormatter={(v) => String(v).slice(5)} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => fmtVND(v)} />
                                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }}
                                    formatter={(v: any) => fmtMoney(v) + " đ"} />
                                <Bar dataKey="revenue" name="Doanh thu" fill="#34d399" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="ads" name="Ads" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                                <Line type="monotone" dataKey="profit" name="Lợi nhuận" stroke="#6366f1" strokeWidth={2} dot={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>

            {/* ═══ Marketer P&L ═══ */}
            {marketers.length > 0 && (
                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" /> Marketer P&L Detail
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="px-2 pb-2 text-left font-medium">Marketer</th>
                                    <th className="px-2 pb-2 text-right font-medium">Đơn</th>
                                    <th className="px-2 pb-2 text-right font-medium">TC</th>
                                    <th className="px-2 pb-2 text-right font-medium">Hoàn</th>
                                    <th className="px-2 pb-2 text-right font-medium">SR%</th>
                                    <th className="px-2 pb-2 text-right font-medium">Revenue (VND)</th>
                                    <th className="px-2 pb-2 text-right font-medium">Ads Spend (USD)</th>
                                    <th className="px-2 pb-2 text-right font-medium">ROAS</th>
                                </tr>
                            </thead>
                            <tbody>
                                {marketers.map((m) => (
                                    <tr key={m.marketer} className="border-b border-border/60 hover:bg-gray-50/50">
                                        <td className="px-2 py-2 font-medium text-foreground">{m.marketer}</td>
                                        <td className="px-2 py-2 text-right">{formatNumber(m.orders)}</td>
                                        <td className="px-2 py-2 text-right">{formatNumber(m.success)}</td>
                                        <td className={cn("px-2 py-2 text-right", m.returned > 0 ? "text-rose-400" : "")}>{formatNumber(m.returned)}</td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", m.sr >= 45 ? "text-emerald-400" : m.sr >= 30 ? "text-amber-400" : "text-rose-400")}>{m.sr}%</td>
                                        <td className="px-2 py-2 text-right font-semibold text-emerald-400">{fmtMoney(m.revenue_vnd)}</td>
                                        <td className="px-2 py-2 text-right text-amber-400">{fmtUSD(m.ads_spend_usd)}</td>
                                        <td className={cn("px-2 py-2 text-right font-semibold", m.roas >= 3 ? "text-emerald-400" : m.roas >= 1.5 ? "text-amber-400" : "text-rose-400")}>
                                            {m.roas ? `${m.roas}x` : "---"}
                                        </td>
                                    </tr>
                                ))}
                                {(() => {
                                    const t = marketers.reduce((a, m) => ({
                                        orders: a.orders + m.orders, success: a.success + m.success,
                                        returned: a.returned + m.returned, revenue: a.revenue + m.revenue_vnd, ads: a.ads + m.ads_spend_usd,
                                    }), { orders: 0, success: 0, returned: 0, revenue: 0, ads: 0 });
                                    const tsr = t.orders > 0 ? Math.round(t.success / t.orders * 1000) / 10 : 0;
                                    const troas = t.ads > 0 ? Math.round(t.revenue / (t.ads * USD_TO_VND) * 100) / 100 : 0;
                                    return (
                                        <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                            <td className="px-2 py-2">TỔNG</td>
                                            <td className="px-2 py-2 text-right">{formatNumber(t.orders)}</td>
                                            <td className="px-2 py-2 text-right">{formatNumber(t.success)}</td>
                                            <td className="px-2 py-2 text-right text-rose-400">{formatNumber(t.returned)}</td>
                                            <td className="px-2 py-2 text-right">{tsr}%</td>
                                            <td className="px-2 py-2 text-right text-emerald-400">{fmtMoney(t.revenue)}</td>
                                            <td className="px-2 py-2 text-right text-amber-400">{fmtUSD(t.ads)}</td>
                                            <td className="px-2 py-2 text-right">{troas}x</td>
                                        </tr>
                                    );
                                })()}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ═══ Daily P&L Table ═══ */}
            {daily.length > 0 && pnlSummary && (
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Chi tiết P&L hàng ngày</h3>
                    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-card z-10">
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="px-2 pb-2 text-left font-medium">Ngày</th>
                                    <th className="px-2 pb-2 text-right font-medium">Đơn TC</th>
                                    <th className="px-2 pb-2 text-right font-medium text-emerald-600">Doanh thu</th>
                                    <th className="px-2 pb-2 text-right font-medium text-rose-500">COGS</th>
                                    <th className="px-2 pb-2 text-right font-medium text-amber-500">Ads</th>
                                    <th className="px-2 pb-2 text-right font-medium text-blue-500">Call</th>
                                    <th className="px-2 pb-2 text-right font-medium">Tổng CP</th>
                                    <th className="px-2 pb-2 text-right font-medium">Lợi nhuận</th>
                                    <th className="px-2 pb-2 text-right font-medium">Biên%</th>
                                </tr>
                            </thead>
                            <tbody>
                                {daily.map((d) => {
                                    const margin = d.revenue > 0 ? (d.profit / d.revenue * 100) : 0;
                                    return (
                                        <tr key={d.date} className="border-b border-border/30 hover:bg-gray-50/50">
                                            <td className="px-2 py-2 font-mono text-foreground">{d.date}</td>
                                            <td className="px-2 py-2 text-right">{d.paidOrders}</td>
                                            <td className="px-2 py-2 text-right text-emerald-500 font-semibold">{d.revenue > 0 ? fmtMoney(d.revenue) : 0}</td>
                                            <td className="px-2 py-2 text-right text-rose-500">{d.cogs > 0 ? fmtMoney(d.cogs) : "—"}</td>
                                            <td className="px-2 py-2 text-right text-amber-500">{d.ads > 0 ? fmtMoney(d.ads) : "—"}</td>
                                            <td className="px-2 py-2 text-right text-blue-500">{d.callCost > 0 ? fmtMoney(d.callCost) : "—"}</td>
                                            <td className="px-2 py-2 text-right text-slate-600">{fmtMoney(d.totalCost)}</td>
                                            <td className={cn("px-2 py-2 text-right font-bold", d.profit >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                                {d.profit >= 0 ? "+" : ""}{fmtMoney(d.profit)}
                                            </td>
                                            <td className={cn("px-2 py-2 text-right", margin >= 30 ? "text-emerald-500" : margin >= 0 ? "text-amber-500" : "text-rose-500")}>
                                                {d.revenue > 0 ? `${margin.toFixed(1)}%` : "—"}
                                            </td>
                                        </tr>
                                    );
                                })}
                                <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                    <td className="px-2 py-2 text-foreground">TỔNG</td>
                                    <td className="px-2 py-2 text-right">{daily.reduce((s, d) => s + d.paidOrders, 0)}</td>
                                    <td className="px-2 py-2 text-right text-emerald-500">{fmtMoney(pnlSummary.revenue)}</td>
                                    <td className="px-2 py-2 text-right text-rose-500">{fmtMoney(pnlSummary.cogs)}</td>
                                    <td className="px-2 py-2 text-right text-amber-500">{fmtMoney(pnlSummary.ads)}</td>
                                    <td className="px-2 py-2 text-right text-blue-500">{fmtMoney(pnlSummary.callCenter)}</td>
                                    <td className="px-2 py-2 text-right text-slate-600">{fmtMoney(pnlSummary.totalCost)}</td>
                                    <td className={cn("px-2 py-2 text-right", pnlSummary.profit >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                        {pnlSummary.profit >= 0 ? "+" : ""}{fmtMoney(pnlSummary.profit)}
                                    </td>
                                    <td className="px-2 py-2 text-right">{pnlSummary.margin.toFixed(1)}%</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
