"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatNumber, cn } from "@/lib/utils";
import TabSkeleton from "@/components/ui/tab-skeleton";
import {
    Crown, TrendingUp, TrendingDown, DollarSign,
    Users, Globe, Package, Target, Megaphone,
} from "lucide-react";

// ═══ T1 uses EUR cents (POS) + USD (FB Ads) ═══
// EUR → VND rates (approximate)
const EUR_TO_VND = 28000;
const USD_TO_VND = 25000;

// ═══ Pancake POS Status Mapping (matched to POS UI) ═══
// Status 16 = "Đã thu tiền" = REAL REVENUE (money collected)
// Status 3  = "Đã nhận"     = received, pending reconciliation
// Status 4  = "Đang hoàn"   = returning
// Status 5  = "Đã hoàn"     = returned
// Status 6  = "Đã hủy"      = canceled
// Status 8  = "Đang đóng hàng" = packing
// Status 9  = "Đã gửi hàng" = shipped
const REVENUE_STATUS = 16;         // Đã thu tiền — the ONLY real revenue
const SUCCESS_STATUSES = '3,16';   // Đã nhận + Đã thu tiền (completed delivery)
const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
    paid: { label: 'Đã thu tiền', cls: 'bg-emerald-100 text-emerald-700' },
    received: { label: 'Đã nhận', cls: 'bg-sky-100 text-sky-700' },
    shipped: { label: 'Đã gửi hàng', cls: 'bg-blue-100 text-blue-700' },
    packing: { label: 'Đang đóng', cls: 'bg-amber-100 text-amber-700' },
    returning: { label: 'Đang hoàn', cls: 'bg-orange-100 text-orange-700' },
    returned: { label: 'Đã hoàn', cls: 'bg-red-100 text-red-700' },
    canceled: { label: 'Đã hủy', cls: 'bg-gray-100 text-gray-600' },
    unknown: { label: 'Đã thu tiền', cls: 'bg-emerald-100 text-emerald-700' }, // status 16 currently stored as "unknown"
    confirmed: { label: 'Đã xác nhận', cls: 'bg-indigo-100 text-indigo-700' },
    new: { label: 'Mới', cls: 'bg-gray-100 text-gray-600' },
};

// Format VND compact
function fmtVND(vnd: number) {
    const abs = Math.abs(vnd);
    const sign = vnd < 0 ? "-" : "";
    if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(".", ",")}ty`;
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(".", ",")}tr`;
    if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000).toLocaleString("vi-VN")}K`;
    return `${sign}${Math.round(abs).toLocaleString("vi-VN")}`;
}

function fmtMoney(vnd: number) {
    return new Intl.NumberFormat("vi-VN").format(Math.round(vnd));
}

function fmtUSD(usd: number) {
    return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ═══ Types ═══
interface CeoOverviewTabProps {
    dateRange?: { from: Date; to: Date };
}

interface MarketerRank {
    marketer: string;
    orders: number;
    success: number;
    returned: number;
    cancelled: number;
    revenue_vnd: number;
    ads_spend_usd: number;
    sr: number;
    roas: number;
}

interface ProductRank {
    product_name: string;
    total_qty: number;
    order_count: number;
    total_revenue: number;
}

interface CampaignRank {
    campaign_name: string;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    ctr: number;
}

// ═══ BQ Query Helper ═══
async function queryBQ(sql: string) {
    const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.data || [];
}

const DS = "levelup-465304.T1_Dataset";

export default function CeoOverviewTab({ dateRange }: CeoOverviewTabProps) {
    const [loading, setLoading] = useState(true);
    const [totals, setTotals] = useState<any>(null);
    const [marketers, setMarketers] = useState<MarketerRank[]>([]);
    const [products, setProducts] = useState<ProductRank[]>([]);
    const [campaigns, setCampaigns] = useState<CampaignRank[]>([]);
    const [daily, setDaily] = useState<any[]>([]);
    const [adsTotals, setAdsTotals] = useState<any>(null);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    // Q0: Order totals — Pancake POS status mapping
                    // Revenue = status 16 (Đã thu tiền) ONLY
                    // Success = status IN (3,16) = Đã nhận + Đã thu tiền
                    `SELECT
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
                    WHERE SAFE_CAST(SUBSTR(updated_at, 1, 10) AS DATE) BETWEEN '${from}' AND '${to}'`,

                    // Q1: Ads totals (deduped)
                    `WITH fb_dedup AS (
                        SELECT * FROM \`${DS}.fb_ads_data\`
                        WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                        QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
                    )
                    SELECT
                        ROUND(SUM(spend), 2) AS total_spend,
                        SUM(impressions) AS total_impressions,
                        SUM(clicks) AS total_clicks,
                        SUM(purchases) AS total_purchases
                    FROM fb_dedup`,

                    // Q2: Marketer performance (from p_utm_campaign → campaign_name → extract marketer)
                    `WITH orders_by_campaign AS (
                        SELECT
                            o.p_utm_campaign AS campaign_id,
                            COUNT(DISTINCT o.id) AS orders,
                            COUNT(DISTINCT CASE WHEN o.status = ${REVENUE_STATUS} THEN o.id END) AS success,
                            COUNT(DISTINCT CASE WHEN o.status = 5 THEN o.id END) AS returned,
                            COUNT(DISTINCT CASE WHEN o.status = 6 THEN o.id END) AS cancelled,
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
                        SELECT
                            campaign_id, campaign_name,
                            ROUND(SUM(spend), 2) AS spend
                        FROM fb_dedup
                        GROUP BY 1, 2
                    ),
                    merged AS (
                        SELECT
                            COALESCE(ca.campaign_name, CONCAT('Campaign ', oc.campaign_id)) AS campaign_name,
                            REGEXP_EXTRACT(COALESCE(ca.campaign_name, ''), r'^([A-Za-z]+[A-Za-z]+)') AS marketer,
                            oc.orders, oc.success, oc.returned, oc.cancelled,
                            oc.revenue * ${EUR_TO_VND / 100} AS revenue_vnd,
                            COALESCE(ca.spend, 0) AS ads_spend_usd
                        FROM orders_by_campaign oc
                        LEFT JOIN campaign_ads ca ON oc.campaign_id = ca.campaign_id
                    )
                    SELECT
                        COALESCE(NULLIF(marketer, ''), 'Unknown') AS marketer,
                        SUM(orders) AS orders,
                        SUM(success) AS success,
                        SUM(returned) AS returned,
                        SUM(cancelled) AS cancelled,
                        ROUND(SUM(revenue_vnd), 0) AS revenue_vnd,
                        ROUND(SUM(ads_spend_usd), 2) AS ads_spend_usd,
                        ROUND(SAFE_DIVIDE(SUM(success)*100, NULLIF(SUM(orders),0)), 1) AS sr,
                        ROUND(SAFE_DIVIDE(SUM(revenue_vnd), NULLIF(SUM(ads_spend_usd) * ${USD_TO_VND}, 0)), 2) AS roas
                    FROM merged
                    GROUP BY 1
                    ORDER BY revenue_vnd DESC`,

                    // Q3: Product performance (use sale_order to avoid row multiplication)
                    `SELECT
                        'MK01TITANIUM' as product_name,
                        SUM(o.total_quantity) AS total_qty,
                        COUNT(DISTINCT o.id) AS order_count,
                        SUM(o.total_price) * ${EUR_TO_VND / 100} AS total_revenue
                    FROM \`${DS}.sale_order\` o
                    WHERE SAFE_CAST(SUBSTR(o.updated_at, 1, 10) AS DATE) BETWEEN '${from}' AND '${to}'`,

                    // Q4: Campaign performance (deduped)
                    `WITH fb_dedup AS (
                        SELECT * FROM \`${DS}.fb_ads_data\`
                        WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                        QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
                    )
                    SELECT
                        campaign_name,
                        ROUND(SUM(spend), 2) AS spend,
                        SUM(impressions) AS impressions,
                        SUM(clicks) AS clicks,
                        SUM(purchases) AS purchases,
                        ROUND(SAFE_DIVIDE(SUM(clicks), NULLIF(SUM(impressions), 0)) * 100, 2) AS ctr
                    FROM fb_dedup
                    GROUP BY 1
                    ORDER BY spend DESC`,

                    // Q5: Daily trend (deduped)
                    `WITH fb_dedup AS (
                        SELECT * FROM \`${DS}.fb_ads_data\`
                        WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                        QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
                    )
                    SELECT
                        SAFE_CAST(date AS STRING) AS day,
                        ROUND(SUM(spend), 2) AS ads_spend,
                        SUM(purchases) AS purchases
                    FROM fb_dedup
                    GROUP BY 1
                    ORDER BY 1`,
                ];

                const results = await Promise.all(
                    queries.map((q) =>
                        queryBQ(q).catch(() => [])
                    )
                );

                const orderTotals = results[0]?.[0] || {};
                const adsTotal = results[1]?.[0] || {};
                setTotals(orderTotals);
                setAdsTotals(adsTotal);
                setMarketers(results[2] || []);
                setProducts(results[3] || []);
                setCampaigns(results[4] || []);
                setDaily(results[5] || []);

            } catch (error) {
                console.error("CEO Overview fetch error:", error);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [dateRange]);

    if (loading) {
        return <TabSkeleton cards={6} showChart={true} rows={5} />;
    }

    // Calculations
    const revenueVND = (totals?.gross_revenue || 0) * (EUR_TO_VND / 100);
    const pendingVND = (totals?.pending_revenue || 0) * (EUR_TO_VND / 100);
    const totalAdsUSD = adsTotals?.total_spend || 0;
    const totalAdsVND = totalAdsUSD * USD_TO_VND;
    const roas = totalAdsVND > 0 ? revenueVND / totalAdsVND : 0;
    const paidOrders = totals?.paid_orders || 0;
    const sr = totals?.total_orders > 0 ? (paidOrders / totals.total_orders * 100) : 0;

    return (
        <div className="space-y-6">
            {/* ═══ KPI Cards (6-column, same as STRAMARK) ═══ */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <KPICard
                    title="Đã Thu Tiền"
                    value={fmtVND(revenueVND)}
                    icon={DollarSign}
                    status={revenueVND > 0 ? "success" : "neutral"}
                    subValue={`${paidOrders} đơn đã thu tiền`}
                />
                <KPICard
                    title="Ads Spend"
                    value={fmtUSD(totalAdsUSD)}
                    icon={Megaphone}
                    status="warning"
                    subValue={`= ${fmtVND(totalAdsVND)} VND`}
                />
                <KPICard
                    title="Đã Thu / Tổng Đơn"
                    value={`${formatNumber(paidOrders)} / ${formatNumber(totals?.total_orders || 0)}`}
                    icon={Package}
                    status="neutral"
                    subValue={`Đã nhận: ${totals?.received_orders || 0} | Đóng: ${totals?.packing_orders || 0}`}
                />
                <KPICard
                    title="ROAS"
                    value={`${roas.toFixed(2)}x`}
                    icon={Target}
                    status={roas >= 2.5 ? "success" : roas >= 1.5 ? "warning" : "danger"}
                    subValue={`${adsTotals?.total_purchases || 0} purchases`}
                />
                <KPICard
                    title="Khach hang"
                    value={String(totals?.unique_customers || 0)}
                    icon={Users}
                    status="neutral"
                    subValue="Unique"
                />
                <KPICard
                    title="Campaigns"
                    value={String(campaigns.length)}
                    icon={Globe}
                    status="neutral"
                    subValue={campaigns.slice(0, 2).map((c) => c.campaign_name?.substring(0, 15)).join(", ")}
                />
            </div>

            {/* ═══ Order Status Breakdown (matching POS) ═══ */}
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

            {/* ═══ Financial Overview ═══ */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Tổng quan tài chính</h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Đã thu tiền (Revenue)</div>
                        <div className="mt-1 text-lg font-bold text-emerald-500">{fmtVND(revenueVND)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Chờ đối soát</div>
                        <div className="mt-1 text-lg font-bold text-sky-500">{fmtVND(pendingVND)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Ads Spend</div>
                        <div className="mt-1 text-lg font-bold text-amber-500">{fmtUSD(totalAdsUSD)} = {fmtVND(totalAdsVND)}</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Hoàn + Hủy</div>
                        <div className="mt-1 text-lg font-bold text-rose-400">
                            {formatNumber((totals?.cancelled_orders || 0) + (totals?.returned_orders || 0))} đơn
                        </div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-muted-foreground">Lãi ròng (thu - ads)</div>
                        <div className={cn("mt-1 text-lg font-bold", (revenueVND - totalAdsVND) >= 0 ? "text-emerald-500" : "text-rose-500")}>
                            {fmtVND(revenueVND - totalAdsVND)}
                        </div>
                    </div>
                </div>
            </div>

            {/* ═══ Marketer P&L Detail ═══ */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    Marketer P&L Detail
                </h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">Marketer</th>
                                <th className="px-2 pb-2 text-right font-medium">Don</th>
                                <th className="px-2 pb-2 text-right font-medium">TC</th>
                                <th className="px-2 pb-2 text-right font-medium">Hoan</th>
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
                                    <td className={cn("px-2 py-2 text-right font-semibold", m.sr >= 45 ? "text-emerald-400" : m.sr >= 30 ? "text-amber-400" : "text-rose-400")}>
                                        {m.sr}%
                                    </td>
                                    <td className="px-2 py-2 text-right font-semibold text-emerald-400">{fmtMoney(m.revenue_vnd)}</td>
                                    <td className="px-2 py-2 text-right text-amber-400">{fmtUSD(m.ads_spend_usd)}</td>
                                    <td className={cn("px-2 py-2 text-right font-semibold", m.roas >= 3 ? "text-emerald-400" : m.roas >= 1.5 ? "text-amber-400" : "text-rose-400")}>
                                        {m.roas ? `${m.roas}x` : "---"}
                                    </td>
                                </tr>
                            ))}
                            {/* TONG row */}
                            {(() => {
                                const t = marketers.reduce((a, m) => ({
                                    orders: a.orders + m.orders, success: a.success + m.success,
                                    returned: a.returned + m.returned, revenue: a.revenue + m.revenue_vnd, ads: a.ads + m.ads_spend_usd,
                                }), { orders: 0, success: 0, returned: 0, revenue: 0, ads: 0 });
                                const tsr = t.orders > 0 ? Math.round(t.success / t.orders * 1000) / 10 : 0;
                                const troas = t.ads > 0 ? Math.round(t.revenue / (t.ads * USD_TO_VND) * 100) / 100 : 0;
                                return (
                                    <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                        <td className="px-2 py-2 text-foreground">TONG</td>
                                        <td className="px-2 py-2 text-right text-foreground">{formatNumber(t.orders)}</td>
                                        <td className="px-2 py-2 text-right text-foreground">{formatNumber(t.success)}</td>
                                        <td className="px-2 py-2 text-right text-rose-400">{formatNumber(t.returned)}</td>
                                        <td className="px-2 py-2 text-right text-foreground">{tsr}%</td>
                                        <td className="px-2 py-2 text-right text-emerald-400">{fmtMoney(t.revenue)}</td>
                                        <td className="px-2 py-2 text-right text-amber-400">{fmtUSD(t.ads)}</td>
                                        <td className="px-2 py-2 text-right text-foreground">{troas}x</td>
                                    </tr>
                                );
                            })()}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ═══ Product + Campaign Performance (2 columns) ═══ */}
            <div className="grid gap-4 lg:grid-cols-2">
                {/* Product Performance */}
                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-blue-400" />
                        Product Performance
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="px-2 pb-2 text-left font-medium">San pham</th>
                                    <th className="px-2 pb-2 text-right font-medium">SL</th>
                                    <th className="px-2 pb-2 text-right font-medium">Don</th>
                                    <th className="px-2 pb-2 text-right font-medium">Revenue</th>
                                </tr>
                            </thead>
                            <tbody>
                                {products.slice(0, 10).map((p, i) => (
                                    <tr key={i} className="border-b border-border/60 hover:bg-gray-50/50">
                                        <td className="px-2 py-2 font-medium text-foreground max-w-[200px] truncate" title={p.product_name}>
                                            {p.product_name?.substring(0, 30)}
                                        </td>
                                        <td className="px-2 py-2 text-right">{formatNumber(p.total_qty)}</td>
                                        <td className="px-2 py-2 text-right">{formatNumber(p.order_count)}</td>
                                        <td className="px-2 py-2 text-right font-semibold text-emerald-400">{fmtVND(p.total_revenue)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Campaign Performance */}
                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-cyan-400" />
                        Campaign Performance
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="px-2 pb-2 text-left font-medium">Campaign</th>
                                    <th className="px-2 pb-2 text-right font-medium">Spend</th>
                                    <th className="px-2 pb-2 text-right font-medium">Clicks</th>
                                    <th className="px-2 pb-2 text-right font-medium">CTR</th>
                                    <th className="px-2 pb-2 text-right font-medium">Purchases</th>
                                    <th className="px-2 pb-2 text-right font-medium">CPA</th>
                                </tr>
                            </thead>
                            <tbody>
                                {campaigns.slice(0, 8).map((c, i) => {
                                    const cpa = c.purchases > 0 ? c.spend / c.purchases : 0;
                                    return (
                                        <tr key={i} className="border-b border-border/60 hover:bg-gray-50/50">
                                            <td className="px-2 py-2 font-medium text-foreground max-w-[150px] truncate" title={c.campaign_name}>
                                                {c.campaign_name?.substring(0, 25)}
                                            </td>
                                            <td className="px-2 py-2 text-right text-amber-400">{fmtUSD(c.spend)}</td>
                                            <td className="px-2 py-2 text-right">{formatNumber(c.clicks)}</td>
                                            <td className="px-2 py-2 text-right">{c.ctr?.toFixed(2)}%</td>
                                            <td className="px-2 py-2 text-right font-semibold">{c.purchases}</td>
                                            <td className="px-2 py-2 text-right">{cpa > 0 ? fmtUSD(cpa) : "---"}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* ═══ Daily Ads Trend Chart ═══ */}
            {daily.length > 0 && (
                <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-indigo-400" />
                        Daily Ads Trend
                    </h3>
                    <ResponsiveContainer width="100%" height={260}>
                        <ComposedChart data={daily}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip
                                contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
                            />
                            <Legend />
                            <Bar dataKey="ads_spend" name="Spend (USD)" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                            <Line type="monotone" dataKey="purchases" name="Purchases" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4 }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* ═══ Recent Orders ═══ */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Don hang gan nhat</h3>
                <RecentOrdersTable ds={DS} dateRange={dateRange} />
            </div>
        </div>
    );
}

// Sub-component: Recent Orders
function RecentOrdersTable({ ds, dateRange }: { ds: string; dateRange?: { from: Date; to: Date } }) {
    const [orders, setOrders] = useState<any[]>([]);
    useEffect(() => {
        const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-01-01";
        const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
        queryBQ(`
            SELECT id, status_name, total_price, bill_full_name,
                   bill_phone_number, inserted_at, items_length, order_sources_name
            FROM \`${ds}.sale_order\`
            WHERE SAFE_CAST(SUBSTR(inserted_at, 1, 10) AS DATE) BETWEEN '${from}' AND '${to}'
            ORDER BY inserted_at DESC
            LIMIT 15
        `).then(setOrders).catch(() => setOrders([]));
    }, [ds, dateRange]);

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-border text-muted-foreground">
                        <th className="px-2 pb-2 text-left font-medium">ID</th>
                        <th className="px-2 pb-2 text-left font-medium">Khach hang</th>
                        <th className="px-2 pb-2 text-left font-medium">SDT</th>
                        <th className="px-2 pb-2 text-right font-medium">Gia tri</th>
                        <th className="px-2 pb-2 text-left font-medium">Trang thai</th>
                        <th className="px-2 pb-2 text-left font-medium">Thoi gian</th>
                    </tr>
                </thead>
                <tbody>
                    {orders.map((o, i) => (
                        <tr key={i} className="border-b border-border/60 hover:bg-gray-50/50">
                            <td className="px-2 py-2 font-mono text-xs">{o.id}</td>
                            <td className="px-2 py-2">{o.bill_full_name || "---"}</td>
                            <td className="px-2 py-2 text-xs">{o.bill_phone_number || "---"}</td>
                            <td className="px-2 py-2 text-right font-medium">{fmtVND((o.total_price || 0) * EUR_TO_VND / 100)}</td>
                            <td className="px-2 py-2">
                                {(() => {
                                    const sl = STATUS_LABELS[o.status_name] || { label: o.status_name, cls: 'bg-gray-100 text-gray-600' };
                                    return (
                                        <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium", sl.cls)}>
                                            {sl.label}
                                        </span>
                                    );
                                })()}
                            </td>
                            <td className="px-2 py-2 text-xs text-muted-foreground">
                                {o.inserted_at ? o.inserted_at.substring(0, 16).replace("T", " ") : "---"}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div >
    );
}
