import { NextResponse } from "next/server";
import { runQuery } from "@/lib/bigquery";
import fs from "fs";
import path from "path";

const OVERRIDES_PATH = path.join(process.cwd(), "..", "campaign_overrides.json");
const SETTINGS_PATH = path.join(process.cwd(), "..", "settings.json");

/* ─── Helpers ────────────────────────────────────────── */
function readOverrides(): Record<string, any> {
    try { if (fs.existsSync(OVERRIDES_PATH)) return JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf-8")); } catch { }
    return {};
}
function saveOverrides(o: Record<string, any>) { fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(o, null, 2), "utf-8"); }
function readThresholds(project: string) {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const d = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
            return d?.thresholds?.[project] || {};
        }
    } catch { }
    return {};
}

/* ─── AI Recommendation (Order-Created Model) ─────── */
interface SignalEval { signal: string; value: number | null; threshold: number; status: "pass" | "warn" | "fail"; reason: string }
interface CampaignRecommendation {
    action: "PAUSE" | "REDUCE_BUDGET" | "MONITOR" | "KEEP" | "SCALE_UP";
    narrative: string;
    signals: SignalEval[];
    fail_count: number;
    severity: number;
}

function evaluateCampaign(c: any, thresholds: any): CampaignRecommendation {
    const t = {
        target_roas: thresholds.target_roas ?? 2.5,
        max_cpo: thresholds.max_cpo ?? 15,     // max cost per order
        min_orders_per_day: thresholds.min_orders_per_day ?? 1,
    };
    const signals: SignalEval[] = [];
    const failR: string[] = [];
    const warnR: string[] = [];

    const orders = c.total_orders || 0;
    const days = c.active_days || 1;
    const opd = orders / days;
    const isActive = c.is_active;

    // 1. Orders (= "Leads" in COD model)
    if (orders === 0) {
        if (isActive) {
            signals.push({ signal: "Đơn hàng", value: 0, threshold: t.min_orders_per_day, status: "fail", reason: "0 đơn" });
            failR.push(`0 đơn sau ${days} ngày`);
        } else {
            signals.push({ signal: "Đơn hàng", value: 0, threshold: t.min_orders_per_day, status: "warn", reason: "Đã dừng" });
        }
    } else if (opd < t.min_orders_per_day) {
        signals.push({ signal: "Đơn hàng", value: orders, threshold: t.min_orders_per_day * days, status: "warn", reason: `${opd.toFixed(1)}/ngày` });
        warnR.push(`${orders} đơn (${opd.toFixed(1)}/ngày)`);
    } else {
        signals.push({ signal: "Đơn hàng", value: orders, threshold: t.min_orders_per_day * days, status: "pass", reason: "OK" });
    }

    // 2. CPO (Cost Per Order)
    const cpo = c.cpo;
    if (cpo != null && cpo > 0) {
        if (cpo > t.max_cpo * 2) {
            signals.push({ signal: "CPO", value: cpo, threshold: t.max_cpo, status: "fail", reason: `$${cpo.toFixed(1)} quá cao` });
            failR.push(`CPO ($${cpo.toFixed(1)}) gấp đôi ngưỡng`);
        } else if (cpo > t.max_cpo) {
            signals.push({ signal: "CPO", value: cpo, threshold: t.max_cpo, status: "warn", reason: "Vượt ngưỡng" });
            warnR.push(`CPO ($${cpo.toFixed(1)}) > $${t.max_cpo}`);
        } else {
            signals.push({ signal: "CPO", value: cpo, threshold: t.max_cpo, status: "pass", reason: "OK" });
        }
    } else {
        signals.push({ signal: "CPO", value: null, threshold: t.max_cpo, status: orders === 0 ? (isActive ? "fail" : "warn") : "warn", reason: orders === 0 ? "0 đơn" : "N/A" });
    }

    // 3. Revenue (Order-created, NOT confirmed delivery)
    const rev = c.order_revenue;
    if (rev == null || rev === 0) {
        signals.push({ signal: "Revenue*", value: 0, threshold: 0, status: orders === 0 ? (isActive ? "fail" : "warn") : "warn", reason: orders === 0 ? "Không có" : "Đơn chưa có giá" });
    } else {
        signals.push({ signal: "Revenue*", value: rev, threshold: 0, status: "pass", reason: `$${rev.toFixed(0)}` });
    }

    // 4. ROAS (based on order-created revenue)
    const roas = c.order_roas;
    if (roas != null && roas > 0) {
        if (roas < t.target_roas * 0.5) {
            signals.push({ signal: "ROAS*", value: roas, threshold: t.target_roas, status: "fail", reason: `${roas.toFixed(2)}x rất thấp` });
            failR.push(`ROAS (${roas.toFixed(2)}x) << ${t.target_roas}x`);
        } else if (roas < t.target_roas) {
            signals.push({ signal: "ROAS*", value: roas, threshold: t.target_roas, status: "warn", reason: "Chưa đạt" });
            warnR.push(`ROAS (${roas.toFixed(2)}x) < ${t.target_roas}x`);
        } else {
            signals.push({ signal: "ROAS*", value: roas, threshold: t.target_roas, status: "pass", reason: "OK" });
        }
    } else {
        signals.push({ signal: "ROAS*", value: 0, threshold: t.target_roas, status: rev === 0 ? (isActive ? "fail" : "warn") : "warn", reason: "Chưa có data" });
    }

    const failCount = signals.filter(s => s.status === "fail").length;
    const warnCount = signals.filter(s => s.status === "warn").length;
    const severity = failCount * 3 + warnCount;

    let action: CampaignRecommendation["action"];
    let narrative: string;

    if (!isActive) {
        action = "KEEP";
        narrative = `⏸️ ĐÃ DỪNG — Campaign không còn chi tiền.${failR.length ? " " + failR.join(". ") + "." : ""}`;
    } else if (failCount >= 3) {
        action = "PAUSE";
        narrative = `⛔ ĐỀ XUẤT TẮT — ${failR.join(". ")}.`;
    } else if (failCount >= 2) {
        action = "REDUCE_BUDGET";
        narrative = `📉 GIẢM N.SÁCH — ${failR.join(". ")}${warnR.length ? ". " + warnR.join(". ") : ""}.`;
    } else if (failCount >= 1) {
        action = "MONITOR";
        narrative = `👁️ THEO DÕI — ${failR.join(". ")}${warnR.length ? ". " + warnR.join(". ") : ""}.`;
    } else if (warnCount >= 2) {
        action = "KEEP";
        narrative = `✅ GIỮ NGUYÊN — ${warnR.join(". ")}.`;
    } else {
        action = "SCALE_UP";
        narrative = `🚀 TĂNG N.SÁCH — Đơn tốt, CPO hợp lý, ROAS* đạt target.`;
    }

    return { action, narrative, signals, fail_count: failCount, severity };
}

/* ─── GET ─────────────────────────────────────────────── */
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const project = searchParams.get("project") || "stramark";
    const days = parseInt(searchParams.get("days") || "7");
    const expandCampaign = searchParams.get("expand") || "";
    const dataset = project === "stramark" ? "STRAMARK_Dataset" : `${project.toUpperCase()}_Dataset`;

    // Helper: safe division
    const safeDivide = (a: number, b: number) => b === 0 ? 0 : a / b;

    let campaigns: any[] = [];
    let funnel: any = {};
    let trend: any[] = [];
    let contentMetrics: any[] = [];
    let adDetails: any[] = [];

    // Campaign-level
    try {
        campaigns = await runQuery(`
            WITH raw AS (
                SELECT
                    campaign_id, campaign_name, account_id,
                    ROUND(SUM(spend), 2) as total_spend,
                    SUM(impressions) as total_impressions,
                    SUM(clicks) as total_clicks,
                    SUM(IFNULL(leads, 0)) as sum_leads,
                    SUM(IFNULL(real_orders, 0)) as sum_orders,
                    ROUND(SUM(IFNULL(confirmed_revenue, 0)), 2) as order_revenue,
                    COUNT(DISTINCT report_date) as active_days,
                    COUNT(DISTINCT ad_id) as ad_count,
                    MIN(report_date) as first_date,
                    MAX(report_date) as last_date,
                    MAX(CASE WHEN report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY) AND spend > 0 THEN 1 ELSE 0 END) as is_active,
                    SUM(impressions) as sum_impressions,
                    SUM(IFNULL(reach, 0)) as sum_reach
                FROM \`levelup-465304.${dataset}.fact_ads_optimization\`
                WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY) AND spend > 0
                GROUP BY campaign_id, campaign_name, account_id
            )
            SELECT *, CAST(IF(sum_leads > sum_orders, sum_leads, sum_orders) AS INT64) as total_orders
            FROM raw ORDER BY total_spend DESC LIMIT 50
        `);
        // Compute derived metrics in JS
        campaigns = (campaigns as any[]).map((c: any) => ({
            ...c,
            order_roas: Math.round(safeDivide(c.order_revenue, c.total_spend) * 100) / 100,
            cpo: Math.round(safeDivide(c.total_spend, c.total_orders || 1) * 100) / 100,
            avg_frequency: Math.round(safeDivide(c.sum_impressions, c.sum_reach || 1) * 100) / 100,
        }));
    } catch (e: any) { console.error("Campaign query error:", e.message); }

    // Funnel
    try {
        const funnelRaw = await runQuery(`
            SELECT
                ROUND(SUM(spend), 2) as total_spend,
                SUM(impressions) as impressions,
                SUM(clicks) as clicks,
                SUM(IFNULL(leads, 0)) as sum_leads,
                SUM(IFNULL(real_orders, 0)) as sum_orders,
                ROUND(SUM(IFNULL(confirmed_revenue, 0)), 2) as order_revenue,
                COUNT(DISTINCT account_id) as account_count,
                COUNT(DISTINCT campaign_id) as campaign_count
            FROM \`levelup-465304.${dataset}.fact_ads_optimization\`
            WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY) AND spend > 0
        `);
        const f = (funnelRaw as any[])[0] || {};
        const leads = Number(f.sum_leads || 0);
        const ords = Number(f.sum_orders || 0);
        const orders = Math.max(leads, ords);
        const totalSpend = Number(f.total_spend || 0);
        const orderRev = Number(f.order_revenue || 0);
        funnel = {
            total_spend: totalSpend,
            impressions: Number(f.impressions || 0),
            clicks: Number(f.clicks || 0),
            orders,
            order_revenue: orderRev,
            account_count: Number(f.account_count || 0),
            campaign_count: Number(f.campaign_count || 0),
            overall_roas: Math.round(safeDivide(orderRev, totalSpend) * 100) / 100,
            overall_cpo: Math.round(safeDivide(totalSpend, orders || 1) * 100) / 100
        };
    } catch (e: any) { console.error("Funnel query error:", e?.message, e?.stack?.substring(0, 200)); }

    // Trend
    try {
        const trendRaw = await runQuery(`
            SELECT
                report_date as dt,
                ROUND(SUM(spend), 2) as spend,
                SUM(clicks) as clicks,
                SUM(IFNULL(leads, 0)) as sum_leads,
                SUM(IFNULL(real_orders, 0)) as sum_orders,
                ROUND(SUM(IFNULL(confirmed_revenue, 0)), 2) as revenue
            FROM \`levelup-465304.${dataset}.fact_ads_optimization\`
            WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND spend > 0
            GROUP BY report_date ORDER BY report_date
        `);
        trend = (trendRaw as any[]).map((r: any) => ({
            ...r,
            orders: Math.max(r.sum_leads || 0, r.sum_orders || 0),
            roas: Math.round(safeDivide(r.revenue, r.spend) * 100) / 100,
        }));
    } catch (e: any) { console.error("Trend query error:", e.message); }

    // Content Metrics: raw SUMs only, compute ratios in JS
    try {
        const contentRaw = await runQuery(`
            SELECT
                ad_id,
                MAX(ad_name) as ad_name,
                MAX(campaign_name) as campaign_name,
                IFNULL(MAX(creative_type), 'UNKNOWN') as creative_type,
                ROUND(SUM(spend), 2) as total_spend,
                SUM(impressions) as total_impressions,
                SUM(clicks) as total_clicks,
                SUM(IFNULL(leads, 0)) as sum_leads,
                SUM(IFNULL(real_orders, 0)) as sum_orders,
                ROUND(SUM(IFNULL(confirmed_revenue, 0)), 2) as total_revenue,
                SUM(IFNULL(video_views_p25, 0)) as vv_p25,
                SUM(IFNULL(video_views_p100, 0)) as vv_p100
            FROM \`levelup-465304.${dataset}.fact_ads_optimization\`
            WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY) AND spend > 0
            GROUP BY ad_id
            HAVING total_impressions > 100
            ORDER BY total_spend DESC
            LIMIT 20
        `);
        contentMetrics = (contentRaw as any[]).map((r: any) => {
            const ctr_pct = Math.round(safeDivide(r.total_clicks, r.total_impressions) * 10000) / 100;
            const hook_rate_pct = Math.round(safeDivide(r.vv_p25, r.total_impressions) * 10000) / 100;
            const hold_rate_pct = Math.round(safeDivide(r.vv_p100, r.vv_p25 || 1) * 10000) / 100;
            const roas = Math.round(safeDivide(r.total_revenue, r.total_spend) * 100) / 100;
            const orders = Math.max(r.sum_leads || 0, r.sum_orders || 0);
            const content_score = Math.round(
                (Math.min(hook_rate_pct / 30, 1) * 30 +
                    Math.min(hold_rate_pct / 20, 1) * 20 +
                    Math.min(ctr_pct / 3, 1) * 20 +
                    Math.min(roas / 5, 1) * 30) * 10
            ) / 10;
            return { ...r, spend: r.total_spend, impressions: r.total_impressions, clicks: r.total_clicks, revenue: r.total_revenue, ctr_pct, hook_rate_pct, hold_rate_pct, roas, orders, content_score };
        }).sort((a: any, b: any) => b.content_score - a.content_score).slice(0, 5);
    } catch (e: any) { console.error("Content query error:", e.message); }

    // Ad details (lazy expand)
    if (expandCampaign) {
        try {
            const adRaw = await runQuery(`
                SELECT
                    ad_id,
                    MAX(ad_name) as ad_name,
                    MAX(adset_name) as adset_name,
                    MAX(creative_type) as creative_type,
                    ROUND(SUM(spend), 2) as total_spend,
                    SUM(impressions) as total_impressions,
                    SUM(clicks) as total_clicks,
                    SUM(IFNULL(leads, 0)) as sum_leads,
                    SUM(IFNULL(real_orders, 0)) as sum_orders,
                    ROUND(SUM(IFNULL(confirmed_revenue, 0)), 2) as total_revenue,
                    MAX(CASE WHEN report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY) AND spend > 0 THEN 1 ELSE 0 END) as is_active
                FROM \`levelup-465304.${dataset}.fact_ads_optimization\`
                WHERE campaign_id = '${expandCampaign}'
                  AND report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY) AND spend > 0
                GROUP BY ad_id ORDER BY total_spend DESC LIMIT 30
            `) as any[];
            adDetails = adRaw.map((r: any) => ({
                ...r,
                spend: r.total_spend, impressions: r.total_impressions, clicks: r.total_clicks, revenue: r.total_revenue,
                ad_orders: Math.max(r.sum_leads || 0, r.sum_orders || 0),
                roas: Math.round(safeDivide(r.total_revenue, r.total_spend) * 100) / 100,
                cpo: Math.round(safeDivide(r.total_spend, Math.max(r.sum_leads || 0, r.sum_orders || 0) || 1) * 100) / 100,
                ctr_pct: Math.round(safeDivide(r.total_clicks, r.total_impressions) * 10000) / 100,
            }));
        } catch (e: any) { console.error("Ad details query error:", e.message); }
    }

    try {
        const thresholds = readThresholds(project);
        const overrides = readOverrides();

        const enriched = (campaigns as any[]).map((c: any) => {
            c.is_active = c.is_active === 1;
            const rec = evaluateCampaign(c, thresholds);
            return { ...c, recommendation: rec, override: overrides[c.campaign_id] || null };
        });
        enriched.sort((a: any, b: any) => {
            if (a.is_active && !b.is_active) return -1;
            if (!a.is_active && b.is_active) return 1;
            return b.recommendation.severity - a.recommendation.severity;
        });

        return NextResponse.json({
            campaigns: enriched,
            funnel,
            trend,
            contentMetrics,
            adDetails,
            thresholds,
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error("Diagnostic API error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/* ─── POST ────────────────────────────────────────────── */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { action } = body;
        if (action === "execute_recommendation") {
            const { campaignId, recommendation, campaignName } = body;
            const overrides = readOverrides();
            overrides[campaignId] = { action: recommendation, reason: `Marketer phê duyệt: ${recommendation}`, at: new Date().toISOString(), status: "approved" };
            saveOverrides(overrides);
            return NextResponse.json({ success: true, message: `✅ ${recommendation} → "${campaignName || campaignId}"` });
        }
        if (action === "dismiss_recommendation") {
            const { campaignId, campaignName } = body;
            const overrides = readOverrides();
            overrides[campaignId] = { action: "DISMISSED", reason: "Bỏ qua", at: new Date().toISOString(), status: "dismissed" };
            saveOverrides(overrides);
            return NextResponse.json({ success: true, message: `Bỏ qua "${campaignName || campaignId}"` });
        }
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
