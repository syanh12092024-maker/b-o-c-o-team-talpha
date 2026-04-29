"use client";

import { useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
    Brain, Sparkles, AlertTriangle, Lightbulb, TrendingUp,
    BarChart3, Loader2, RefreshCw, ShieldCheck, Activity,
} from "lucide-react";

const DS = "levelup-465304.T1_Dataset";
const EUR_TO_VND = 28000;
const USD_TO_VND = 25000;
const EUR_F = EUR_TO_VND / 100;

async function queryBQ(sql: string) {
    const r = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
    });
    return (await r.json()).data || [];
}

function fmtVND(v: number) {
    const a = Math.abs(v);
    const s = v < 0 ? "-" : "";
    if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}tỷ`;
    if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}tr`;
    if (a >= 1e3) return `${s}${Math.round(a / 1e3)}K`;
    return `${s}${Math.round(a)}`;
}

interface Props {
    dateRange?: { from: Date; to: Date };
}

export default function AIInsightsTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(false);
    const [insights, setInsights] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [lastRun, setLastRun] = useState<Date | null>(null);

    async function runAnalysis() {
        setLoading(true);
        setError(null);

        try {
            const from = dateRange?.from
                ? format(dateRange.from, "yyyy-MM-dd")
                : "2025-01-01";
            const to = dateRange?.to
                ? format(dateRange.to, "yyyy-MM-dd")
                : format(new Date(), "yyyy-MM-dd");

            // Fetch data from BQ via existing /api/query (same as other tabs)
            const [orders, ads, marketers, fulfillment] = await Promise.all([
                // Orders
                queryBQ(`SELECT
                    COUNT(DISTINCT id) AS total_orders,
                    COUNT(DISTINCT CASE WHEN status = 16 THEN id END) AS paid_orders,
                    COUNT(DISTINCT CASE WHEN status = 3 THEN id END) AS received_orders,
                    COUNT(DISTINCT CASE WHEN status = 5 THEN id END) AS returned_orders,
                    COUNT(DISTINCT CASE WHEN status = 6 THEN id END) AS cancelled_orders,
                    COUNT(DISTINCT CASE WHEN status = 8 THEN id END) AS packing_orders,
                    ROUND(SUM(CASE WHEN status = 16 THEN total_price ELSE 0 END), 0) AS gross_revenue,
                    ROUND(SUM(CASE WHEN status = 3 THEN total_price ELSE 0 END), 0) AS pending_revenue,
                    COUNT(DISTINCT bill_phone_number) AS unique_customers,
                    SUM(CASE WHEN status = 16 THEN total_quantity ELSE 0 END) AS paid_qty
                FROM \`${DS}.sale_order\`
                WHERE SAFE_CAST(SUBSTR(updated_at, 1, 10) AS DATE) BETWEEN '${from}' AND '${to}'`),

                // Ads
                queryBQ(`WITH fb_dedup AS (
                    SELECT * FROM \`${DS}.fb_ads_data\`
                    WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                    QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
                )
                SELECT ROUND(SUM(spend), 2) AS total_spend, SUM(impressions) AS impressions,
                    SUM(clicks) AS clicks, SUM(purchases) AS purchases,
                    COUNT(DISTINCT campaign_id) AS campaigns
                FROM fb_dedup`),

                // Marketer performance
                queryBQ(`WITH fb_dedup AS (
                    SELECT * FROM \`${DS}.fb_ads_data\`
                    WHERE SAFE_CAST(date AS DATE) BETWEEN '${from}' AND '${to}'
                    QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY sync_time DESC) = 1
                ),
                fb AS (
                    SELECT campaign_id, UPPER(REGEXP_EXTRACT(campaign_name, r'^([A-Za-z]+)')) AS marketer,
                        ROUND(SUM(spend), 2) AS spend, SUM(purchases) AS purchases
                    FROM fb_dedup GROUP BY 1, 2
                ),
                pos AS (
                    SELECT p_utm_campaign AS campaign_id,
                        COUNT(DISTINCT id) AS orders,
                        COUNT(DISTINCT CASE WHEN status = 16 THEN id END) AS paid,
                        COUNT(DISTINCT CASE WHEN status = 5 THEN id END) AS returned,
                        ROUND(SUM(CASE WHEN status = 16 THEN total_price ELSE 0 END) * ${EUR_F}, 0) AS revenue
                    FROM \`${DS}.sale_order\`
                    WHERE SAFE_CAST(SUBSTR(updated_at,1,10) AS DATE) BETWEEN '${from}' AND '${to}'
                        AND p_utm_campaign IS NOT NULL AND p_utm_campaign != ''
                    GROUP BY 1
                )
                SELECT COALESCE(NULLIF(fb.marketer, ''), 'Unknown') AS marketer,
                    ROUND(SUM(fb.spend), 2) AS spend,
                    SUM(COALESCE(pos.orders, 0)) AS orders,
                    SUM(COALESCE(pos.paid, 0)) AS paid,
                    SUM(COALESCE(pos.returned, 0)) AS returned,
                    SUM(COALESCE(pos.revenue, 0)) AS revenue
                FROM fb LEFT JOIN pos ON fb.campaign_id = pos.campaign_id
                GROUP BY 1 ORDER BY revenue DESC`),

                // Fulfillment
                queryBQ(`SELECT
                    COUNT(*) AS total_shipments,
                    COUNT(CASE WHEN status = 'delivered' THEN 1 END) AS delivered,
                    COUNT(CASE WHEN status = 'returned' THEN 1 END) AS returned,
                    COUNT(CASE WHEN status IN ('on_delivery', 'in_transit') THEN 1 END) AS in_transit,
                    ROUND(SUM(IFNULL(total_3pl_cost_eur, 0)), 2) AS total_cost_eur
                FROM \`${DS}.fulfillment_orders\`
                WHERE SAFE_CAST(SUBSTR(created_at, 1, 10) AS DATE) BETWEEN '${from}' AND '${to}'
                    AND status NOT IN ('validation_failed', 'cancelled')`),
            ]);

            const o = orders[0] || {};
            const a = ads[0] || {};
            const f = fulfillment[0] || {};

            const revenueVND = (o.gross_revenue || 0) * EUR_F;
            const pendingVND = (o.pending_revenue || 0) * EUR_F;
            const adsSpendVND = (a.total_spend || 0) * USD_TO_VND;
            const roas = adsSpendVND > 0 ? (revenueVND / adsSpendVND).toFixed(2) : "0";
            const cogsVND = (o.paid_qty || 0) * 0.9 * EUR_TO_VND;

            // Build context string for Gemini
            const dataContext = `
DỮ LIỆU KINH DOANH T1 — Giai đoạn ${from} đến ${to}

📦 ĐƠN HÀNG (POS Cake):
- Tổng đơn: ${o.total_orders || 0}
- Đã thu tiền: ${o.paid_orders || 0} đơn → Doanh thu: ${fmtVND(revenueVND)} VND (${(o.gross_revenue || 0).toFixed(0)} EUR)
- Đã nhận (chờ đối soát): ${o.received_orders || 0} đơn → ${fmtVND(pendingVND)} VND
- Đang đóng hàng: ${o.packing_orders || 0}
- Đã hoàn: ${o.returned_orders || 0}
- Đã hủy: ${o.cancelled_orders || 0}
- Khách hàng unique: ${o.unique_customers || 0}
- Tỷ lệ thành công (TC): ${o.total_orders > 0 ? ((o.paid_orders / o.total_orders) * 100).toFixed(1) : 0}%
- Tỷ lệ hoàn: ${o.total_orders > 0 ? ((o.returned_orders / o.total_orders) * 100).toFixed(1) : 0}%

📢 QUẢNG CÁO (Facebook Ads):
- Chi tiêu: $${a.total_spend || 0} (= ${fmtVND(adsSpendVND)} VND)
- Impressions: ${a.impressions || 0}
- Clicks: ${a.clicks || 0}
- CTR: ${a.impressions > 0 ? ((a.clicks / a.impressions) * 100).toFixed(2) : 0}%
- FB Purchases: ${a.purchases || 0}
- CPA: ${a.purchases > 0 ? `$${(a.total_spend / a.purchases).toFixed(2)}` : "N/A"}
- Campaigns chạy: ${a.campaigns || 0}
- ROAS (thực): ${roas}x

💰 CHI PHÍ:
- Giá vốn (COGS): ${fmtVND(cogsVND)} VND
- Ads: ${fmtVND(adsSpendVND)} VND
- 3PL: ${fmtVND((f.total_cost_eur || 0) * EUR_TO_VND)} VND
- Lợi nhuận ước tính: ${fmtVND(revenueVND - cogsVND - adsSpendVND - (f.total_cost_eur || 0) * EUR_TO_VND)} VND

🚚 FULFILLMENT (euShipments):
- Tổng shipment: ${f.total_shipments || 0}
- Delivered: ${f.delivered || 0}
- Returned: ${f.returned || 0}
- Đang vận chuyển: ${f.in_transit || 0}
- Chi phí 3PL: €${f.total_cost_eur || 0}

👥 MARKETER PERFORMANCE:
${(marketers || []).map((m: any) => `- ${m.marketer}: Spend $${m.spend}, Đơn ${m.orders}, Thu tiền ${m.paid}, Hoàn ${m.returned}, Revenue ${fmtVND(m.revenue)} VND`).join("\n")}

Hãy phân tích dữ liệu trên và đưa ra nhận xét, đề xuất hành động cụ thể, và cảnh báo rủi ro.`;

            // Send to Gemini API
            const res = await fetch("/api/ai-insights", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dataContext }),
            });

            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setInsights(data.insights);
            setLastRun(new Date());
        } catch (err: any) {
            setError(err.message || "Phân tích thất bại");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="space-y-6">
            {/* Hero */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-700 via-indigo-700 to-blue-700 p-6 text-white shadow-xl">
                <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
                <div className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-white/5" />
                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-1">
                        <Brain className="w-5 h-5" />
                        <span className="text-sm font-bold tracking-wider uppercase">AI Business Insights</span>
                    </div>
                    <p className="text-sm text-white/70 mb-4">
                        Powered by Gemini — Phân tích dữ liệu tự động và đề xuất hành động
                    </p>
                    <button
                        onClick={runAnalysis}
                        disabled={loading}
                        className="flex items-center gap-2 rounded-lg bg-white/15 hover:bg-white/25 px-5 py-2.5 text-sm font-semibold transition-all disabled:opacity-50"
                    >
                        {loading ? (
                            <><Loader2 className="w-4 h-4 animate-spin" />Đang phân tích...</>
                        ) : (
                            <><Sparkles className="w-4 h-4" />Phân tích ngay</>
                        )}
                    </button>
                    {lastRun && (
                        <p className="mt-2 text-[11px] text-white/50">
                            Lần chạy cuối: {format(lastRun, "HH:mm:ss dd/MM/yyyy")}
                        </p>
                    )}
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>{error}</div>
                </div>
            )}

            {/* Results */}
            {insights && (
                <div className="space-y-4">
                    {/* Health Score */}
                    <div className="rounded-xl border border-border bg-card p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <Activity className="w-4 h-4 text-indigo-500" />
                                Điểm sức khỏe kinh doanh
                            </h3>
                            <button onClick={runAnalysis} disabled={loading} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                                <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} /> Chạy lại
                            </button>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className={cn("text-5xl font-black",
                                (insights.score || 0) >= 75 ? "text-emerald-500" :
                                    (insights.score || 0) >= 50 ? "text-amber-500" : "text-rose-500"
                            )}>
                                {insights.score || 50}
                            </div>
                            <div className="flex-1">
                                <div className="h-3 rounded-full bg-gray-200 overflow-hidden">
                                    <div
                                        className={cn("h-full rounded-full transition-all duration-1000",
                                            (insights.score || 0) >= 75 ? "bg-emerald-500" :
                                                (insights.score || 0) >= 50 ? "bg-amber-500" : "bg-rose-500"
                                        )}
                                        style={{ width: `${insights.score || 50}%` }}
                                    />
                                </div>
                                <p className="mt-2 text-sm text-muted-foreground">{insights.summary}</p>
                            </div>
                        </div>
                    </div>

                    {/* Observations */}
                    {insights.observations?.length > 0 && (
                        <div className="rounded-xl border border-border bg-card p-5">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                                <BarChart3 className="w-4 h-4 text-blue-500" />
                                Điểm đáng chú ý
                            </h3>
                            <div className="space-y-2">
                                {insights.observations.map((obs: string, i: number) => (
                                    <div key={i} className="flex items-start gap-2 text-sm text-foreground bg-blue-50 rounded-lg p-3 border border-blue-100">
                                        <span className="text-blue-500 font-bold mt-0.5">{i + 1}.</span>
                                        <span>{obs}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    {insights.actions?.length > 0 && (
                        <div className="rounded-xl border border-border bg-card p-5">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                                <Lightbulb className="w-4 h-4 text-amber-500" />
                                Đề xuất hành động
                            </h3>
                            <div className="space-y-2">
                                {insights.actions.map((act: string, i: number) => (
                                    <div key={i} className="flex items-start gap-2 text-sm text-foreground bg-amber-50 rounded-lg p-3 border border-amber-100">
                                        <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                        <span>{act}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Risks */}
                    {insights.risks?.length > 0 && (
                        <div className="rounded-xl border border-border bg-card p-5">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                                <ShieldCheck className="w-4 h-4 text-rose-500" />
                                Cảnh báo rủi ro
                            </h3>
                            <div className="space-y-2">
                                {insights.risks.map((risk: string, i: number) => (
                                    <div key={i} className="flex items-start gap-2 text-sm text-foreground bg-rose-50 rounded-lg p-3 border border-rose-100">
                                        <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                                        <span>{risk}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Empty state */}
            {!insights && !loading && !error && (
                <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
                    <Brain className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">
                        Bấm <strong>"Phân tích ngay"</strong> để AI đọc toàn bộ dữ liệu trên dashboard và đưa ra nhận xét
                    </p>
                </div>
            )}
        </div>
    );
}
