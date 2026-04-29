"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, Cell, PieChart, Pie,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency, formatNumber, formatMoney, COLORS, cn, USD_TO_VND, RON_TO_VND, EUR_TO_VND } from "@/lib/utils";
import ExchangeRateBanner from "@/components/stramark/exchange-rate-banner";
import { DATASET } from "../constants";
import { queryMarketingAdsKpis, queryMarketingDailyTrend, queryMarketingAdsByMarketer, queryMarketingMarketerPnl, queryMarketingDailyRevenue, queryMarketingDailyAds, queryMarketingDailyOrders } from "@/lib/bq-queries";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { resolveMarketerName, isRealMarketer } from "@/lib/marketer-map";
import {
    Megaphone, MousePointer, Eye, Percent, Coins, Users,
    TrendingUp, Target, DollarSign, Trophy, Info, Globe, Package, X, ShoppingCart, Wallet,
} from "lucide-react";

interface MarketingTabProps {
    dateRange?: { from: Date; to: Date };
}

/* ─── Marketer performance merged row ─── */
interface MarketerRow {
    marketer_name: string;
    orders: number; success: number; returned: number;
    revenue: number; ads_spend: number; shipping: number; cogs: number;
    net_profit: number; roas: number; sr: number;
    impressions: number; clicks: number;
}

interface ProductRow {
    product_code: string; product_name: string;
    orders: number; success: number; returned: number;
    revenue: number; cogs: number;
}
interface MarketRow {
    market: string;
    orders: number; success: number;
    revenue: number; ads_spend: number;
}

function InfoTip({ content }: { content: string }) {
    return (
        <span className="group/tip relative inline-flex align-middle">
            <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
            <span className="pointer-events-none absolute left-1/2 bottom-full z-50 mb-1.5 w-60 -translate-x-1/2 rounded-md border border-border bg-popover p-2 text-[11px] font-normal leading-relaxed text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100">
                {content}
            </span>
        </span>
    );
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
    const [dailyMkter, setDailyMkter] = useState<any[]>([]);
    const [selectedMkter, setSelectedMkter] = useState<string>("ALL");
    const [products, setProducts] = useState<ProductRow[]>([]);
    const [markets, setMarkets] = useState<MarketRow[]>([]);
    // Per-SKU ads (RON-equiv) from Q9 — proportional UTM attribution. Replaces the
    // old global revenue-share allocation that overstated cross-product spend.
    const [adsByProduct, setAdsByProduct] = useState<Map<string, number>>(new Map());
    // Team totals across ALL marketers (incl non-canonical) — needed for summary KPIs to
    // match CEO Intelligence. mkters[] alone excludes orders without a canonical marketer.
    const [teamTotals, setTeamTotals] = useState<{ revenue: number; cogs: number; shipping: number; orders: number; success: number; returned: number }>({ revenue: 0, cogs: 0, shipping: 0, orders: 0, success: 0, returned: 0 });

    // Filter state — single-select mode: đổi 1 dropdown sẽ reset 2 cái còn lại
    const [marketerFilter, setMarketerFilter] = useState<string>("");
    const [productFilter, setProductFilter] = useState<string>("");
    const [marketFilter, setMarketFilter] = useState<string>("");
    const selectMarketer = (v: string) => { setMarketerFilter(v); setProductFilter(""); setMarketFilter(""); };
    const selectProduct = (v: string) => { setProductFilter(v); setMarketerFilter(""); setMarketFilter(""); };
    const selectMarket = (v: string) => { setMarketFilter(v); setMarketerFilter(""); setProductFilter(""); };
    const resetFilters = () => { setMarketerFilter(""); setProductFilter(""); setMarketFilter(""); };

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    queryMarketingAdsKpis(DATASET, from, to),        // Q0
                    queryMarketingDailyTrend(DATASET, from, to),      // Q1
                    queryMarketingAdsByMarketer(DATASET, from, to),   // Q2
                    queryMarketingMarketerPnl(DATASET, from, to),     // Q3
                    queryMarketingDailyRevenue(DATASET, from, to),    // Q4
                    queryMarketingDailyAds(DATASET, from, to),        // Q5
                    queryMarketingDailyOrders(DATASET, from, to),     // Q6

                    // Q7: Products (same as CEO Intel Q2 — 3-level COGS fallback)
                    `WITH cogs_fallback AS (
                        SELECT
                            COALESCE(pt.custom_id, 'UNKNOWN') as product_code,
                            ROUND(SUM(
                                CASE WHEN so.status_name IN ('delivered', 'received_money')
                                THEN SAFE_CAST(oi.quantity AS INT64) * COALESCE(
                                    NULLIF(pc.cost_raw, 0),
                                    NULLIF(SAFE_CAST(oi.avg_imported_price AS FLOAT64), 0),
                                    NULLIF(SAFE_CAST(pv.imported_price AS FLOAT64), 0),
                                    0
                                ) / 100.0 ELSE 0 END
                            ), 0) as delivered_cogs_fixed
                        FROM ${DATASET}.sale_order so
                        JOIN ${DATASET}.order_items oi ON so.id = oi.order_id
                        LEFT JOIN ${DATASET}.product_cogs pc ON oi.variation_id = pc.variation_id
                        LEFT JOIN ${DATASET}.product_variations pv ON oi.variation_id = pv.id
                        LEFT JOIN ${DATASET}.product_template pt ON oi.product_id = pt.id
                        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at))
                            BETWEEN '${from}' AND '${to}'
                        GROUP BY 1
                    ),
                    mart_agg AS (
                        SELECT product_code, product_name,
                            SUM(order_count) as orders,
                            SUM(units_delivered) as success,
                            SUM(units_returned) as returned,
                            ROUND(SUM(delivered_revenue),0) as revenue
                        FROM ${DATASET}.mart_product_insights
                        WHERE report_date BETWEEN '${from}' AND '${to}'
                        GROUP BY 1,2
                    )
                    SELECT m.product_code, m.product_name, m.orders, m.success, m.returned, m.revenue,
                        COALESCE(cf.delivered_cogs_fixed, 0) as cogs
                    FROM mart_agg m
                    LEFT JOIN cogs_fallback cf ON UPPER(TRIM(m.product_code)) = UPPER(TRIM(cf.product_code))
                    ORDER BY revenue DESC
                    LIMIT 50`,

                    // Q8: Markets (same as CEO Intel Q3)
                    `SELECT
                        market,
                        SUM(order_count) as orders,
                        SUM(units_delivered) as success,
                        ROUND(SUM(delivered_revenue),0) as revenue,
                        ROUND(SUM(ads_spend_ron),0) as ads_spend
                    FROM ${DATASET}.mart_product_insights
                    WHERE report_date BETWEEN '${from}' AND '${to}'
                        AND market IS NOT NULL AND market != 'Unknown'
                        AND market NOT IN ('CĐ', 'DS')
                    GROUP BY 1 ORDER BY revenue DESC
                    LIMIT 20`,

                    // Q9: Per-product ads spend (proportional UTM attribution).
                    // Same methodology as CEO Q12 / Ads Command Center: per campaign,
                    // allocate spend by SKU's share of the campaign's POS orders.
                    `WITH order_codes AS (
                        SELECT
                            so.id, so.p_utm_term, so.p_utm_campaign,
                            ARRAY_AGG(DISTINCT COALESCE(
                                pt.custom_id,
                                REGEXP_EXTRACT(oi.product_name, r'^([A-Z]\\d+)'),
                                REGEXP_EXTRACT(oi.variation_name, r'^([A-Z]\\d+)')
                            ) IGNORE NULLS) AS product_codes
                        FROM ${DATASET}.sale_order so
                        JOIN ${DATASET}.order_items oi ON so.id = oi.order_id
                        LEFT JOIN ${DATASET}.product_template pt ON oi.product_id = pt.id
                        WHERE DATE(CAST(so.inserted_at AS TIMESTAMP)) BETWEEN '${from}' AND '${to}'
                          AND COALESCE(SAFE_CAST(so.status AS INT64), 0) != 7
                        GROUP BY so.id, so.p_utm_term, so.p_utm_campaign
                    ),
                    order_to_campaign AS (
                        SELECT DISTINCT oc.id AS order_id, oc.product_codes, fa.campaign_id
                        FROM order_codes oc
                        JOIN ${DATASET}.fb_ads_data fa
                          ON fa.date BETWEEN '${from}' AND '${to}'
                         AND (
                            CAST(fa.ad_id AS STRING) = oc.p_utm_term
                            OR fa.campaign_name = oc.p_utm_campaign
                         )
                    ),
                    campaign_totals AS (
                        SELECT campaign_id, COUNT(DISTINCT order_id) AS total_orders
                        FROM order_to_campaign
                        GROUP BY 1
                    ),
                    campaign_product_orders AS (
                        SELECT campaign_id, UPPER(code) AS product_code, COUNT(DISTINCT order_id) AS product_orders
                        FROM order_to_campaign, UNNEST(product_codes) AS code
                        WHERE code IS NOT NULL
                        GROUP BY 1, 2
                    ),
                    campaign_spend AS (
                        SELECT campaign_id, SUM(spend) AS spend_usd
                        FROM ${DATASET}.fb_ads_data
                        WHERE date BETWEEN '${from}' AND '${to}'
                        GROUP BY 1
                    )
                    SELECT
                        cpo.product_code,
                        ROUND(SUM(cs.spend_usd * cpo.product_orders / ct.total_orders), 2) AS ads_spend_usd
                    FROM campaign_product_orders cpo
                    JOIN campaign_totals ct ON cpo.campaign_id = ct.campaign_id
                    JOIN campaign_spend cs ON cpo.campaign_id = cs.campaign_id
                    WHERE ct.total_orders > 0
                    GROUP BY 1`,

                    // Q10: Actual FFM total from ffm_shipments (EUR -> RON). Same source CEO uses,
                    // so Marketing Ship/FFM matches CEO Intelligence instead of mart's per-marketer
                    // shipping field which understates 3PL cost.
                    `WITH fx_eur AS (
                        SELECT rate FROM ${DATASET}.cost_exchange_rates
                        WHERE from_currency = 'EUR' AND to_currency = 'RON'
                        ORDER BY effective_date DESC LIMIT 1
                    ),
                    ffm AS (
                        SELECT SUM(f.price_incl_vat) AS ffm_eur
                        FROM ${DATASET}.ffm_shipments f
                        WHERE DATE(COALESCE(
                                f.created_date,
                                PARSE_TIMESTAMP('%Y-%m-%d %H:%M:%S', JSON_VALUE(f.raw_response, '$.WAYBILL_AVAILABLE_DATE')),
                                f.synced_at
                            )) BETWEEN '${from}' AND '${to}'
                    )
                    SELECT ROUND(f.ffm_eur * fx.rate, 0) AS ffm_actual_ron
                    FROM ffm f CROSS JOIN fx_eur fx`,
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

                // KPIs — USD → "fake RON" for formatCurrency(×RON_TO_VND)
                const usdToFakeRon = USD_TO_VND / RON_TO_VND;
                const kpiRow = results[0].data?.[0] || {};
                setAdsKpis({
                    spend: Math.round((kpiRow.spend_usd || 0) * usdToFakeRon),
                    impressions: kpiRow.impressions || 0,
                    clicks: kpiRow.clicks || 0,
                    ctr: kpiRow.ctr || 0,
                    cpm: (kpiRow.cpm_usd || 0) * usdToFakeRon,
                });

                // Daily trend: merge ads spend (USD→fakeRON) + revenue
                const adsDaily = results[1].data || [];
                const revDaily = results[4].data || [];
                const revMap = new Map<string, number>();
                revDaily.forEach((r: any) => revMap.set(r.report_date, r.revenue || 0));
                const combinedTrend = adsDaily.map((d: any) => {
                    const spend = Math.round((d.spend_usd || 0) * usdToFakeRon);
                    return {
                        report_date: d.report_date,
                        spend,
                        impressions: d.impressions || 0,
                        clicks: d.clicks || 0,
                        revenue: revMap.get(d.report_date) || 0,
                        roas: spend > 0 ? ((revMap.get(d.report_date) || 0) / spend) : 0,
                    };
                });
                setDailyTrend(combinedTrend);

                // Merge ads spend by marketer (USD→fakeRON): aggregate by CANONICAL name
                const adsPerCode = results[2].data || [];
                const adsByName = new Map<string, { ads_spend: number; impressions: number; clicks: number }>();
                adsPerCode.forEach((row: any) => {
                    const name = resolveMarketerName(row.mkter_code || "");
                    if (!isRealMarketer(name)) return;
                    const prev = adsByName.get(name) || { ads_spend: 0, impressions: 0, clicks: 0 };
                    adsByName.set(name, {
                        ads_spend: prev.ads_spend + Math.round((row.ads_spend_usd || 0) * usdToFakeRon),
                        impressions: prev.impressions + (row.impressions || 0),
                        clicks: prev.clicks + (row.clicks || 0),
                    });
                });

                // Aggregate mart_performance_master P&L by CANONICAL name too.
                // Also compute TEAM TOTALS (no canonical filter) so summary KPIs include
                // every order — orders attributed to non-canonical marketers still cost COGS
                // and shipping. Without this the team P&L overstated margin vs CEO Intelligence.
                const mkterPnl = results[3].data || [];
                let teamRev = 0, teamCogs = 0, teamShipMart = 0, teamOrders = 0, teamSuccess = 0, teamReturned = 0;
                mkterPnl.forEach((m: any) => {
                    teamRev += m.revenue || 0;
                    teamCogs += m.cogs || 0;
                    teamShipMart += m.shipping || 0;
                    teamOrders += m.orders || 0;
                    teamSuccess += m.success || 0;
                    teamReturned += m.returned || 0;
                });
                // Override shipping with actual FFM cost from ffm_shipments (CEO's methodology)
                const ffmActualRow = results[10]?.data?.[0];
                const ffmActual = ffmActualRow?.ffm_actual_ron || 0;
                const teamShip = ffmActual > 0 ? ffmActual : teamShipMart;
                setTeamTotals({ revenue: teamRev, cogs: teamCogs, shipping: teamShip, orders: teamOrders, success: teamSuccess, returned: teamReturned });

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

                // Merge daily ads (Q5) with daily orders (Q6) for complete daily view
                const dailyAdsRaw = results[5]?.data || [];
                const dailyOrdersRaw = results[6]?.data || [];

                // Build orders lookup: date×marketer → orders data
                const ordersMap = new Map<string, any>();
                dailyOrdersRaw.forEach((d: any) => {
                    const name = resolveMarketerName(d.marketer_name || "");
                    if (!isRealMarketer(name)) return;
                    const key = `${d.report_date}|${name}`;
                    const prev = ordersMap.get(key) || { orders: 0, success: 0, returned: 0, revenue: 0, cogs: 0, shipping: 0 };
                    ordersMap.set(key, {
                        orders: prev.orders + (d.orders || 0),
                        success: prev.success + (d.success || 0),
                        returned: prev.returned + (d.returned || 0),
                        revenue: prev.revenue + (d.revenue || 0),
                        cogs: prev.cogs + (d.cogs || 0),
                        shipping: prev.shipping + (d.shipping || 0),
                    });
                });

                // Build ads lookup: date×marketer → ads_spend (USD → fake RON)
                const adsMap = new Map<string, number>();
                dailyAdsRaw.forEach((d: any) => {
                    const name = resolveMarketerName(d.mkter_code || "");
                    if (!isRealMarketer(name)) return;
                    const key = `${d.report_date}|${name}`;
                    adsMap.set(key, (adsMap.get(key) || 0) + Math.round((d.ads_spend || 0) * usdToFakeRon));
                });

                // Merge: union of all date×marketer combos
                const allDailyKeys = new Set([...ordersMap.keys(), ...adsMap.keys()]);
                const dailyMerged: any[] = [];
                allDailyKeys.forEach((key) => {
                    const [date, mkter] = key.split("|");
                    const ord = ordersMap.get(key) || { orders: 0, success: 0, returned: 0, revenue: 0, cogs: 0, shipping: 0 };
                    const ads_spend = adsMap.get(key) || 0;
                    const sr = ord.orders > 0 ? Math.round(ord.success / ord.orders * 1000) / 10 : 0;
                    const net_profit = ord.revenue - ord.cogs - ord.shipping - ads_spend;
                    const roas = ads_spend > 0 ? Math.round(ord.revenue / ads_spend * 100) / 100 : 0;
                    dailyMerged.push({
                        report_date: date,
                        marketer_name: mkter,
                        orders: ord.orders, success: ord.success, returned: ord.returned,
                        revenue: ord.revenue, ads_spend, cogs: ord.cogs, shipping: ord.shipping,
                        net_profit, roas, sr,
                    });
                });
                dailyMerged.sort((a, b) => {
                    const dateCmp = String(b.report_date).localeCompare(String(a.report_date));
                    return dateCmp !== 0 ? dateCmp : b.revenue - a.revenue;
                });
                setDailyMkter(dailyMerged);

                // Products (Q7) + Markets (Q8)
                setProducts(results[7]?.data || []);
                setMarkets(results[8]?.data || []);

                // Q9: per-SKU ads (USD → fake RON for formatCurrency × RON_TO_VND)
                const adsByProductMap = new Map<string, number>();
                (results[9]?.data || []).forEach((r: any) => {
                    const code = String(r.product_code || "").toUpperCase();
                    if (!code) return;
                    adsByProductMap.set(code, Math.round((r.ads_spend_usd || 0) * usdToFakeRon));
                });
                setAdsByProduct(adsByProductMap);
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

    // Totals — use TEAM TOTALS (incl. non-canonical marketers) for summary KPIs to match
    // CEO Intelligence. mkters[] (canonical-only) is still used for the detail table below.
    // adsKpis.spend = ALL fb_ads_data spend (no canonical filter), aligns with CEO totals.ads.
    const totalRevenue = teamTotals.revenue;
    const totalSpend = adsKpis.spend;
    const totalOrders = teamTotals.orders;
    const totalSuccess = teamTotals.success;
    const totalReturned = teamTotals.returned;
    const totalCogs = teamTotals.cogs;
    const totalShipping = teamTotals.shipping;
    const totalProfit = totalRevenue - totalCogs - totalShipping - totalSpend;
    const totalImpressions = adsKpis.impressions;
    const totalClicks = adsKpis.clicks;
    const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const overallSR = totalOrders > 0 ? (totalSuccess / totalOrders) * 100 : 0;

    // ── Filter-aware aggregates ──
    const filteredBase: {
        source: "marketer" | "product" | "market";
        revenue: number; cogs: number; shipping: number; ads: number;
        orders: number; success: number; returned: number;
        impressions: number; clicks: number;
        hasAdsBreakdown: boolean; // true khi source có impressions/clicks chính xác
    } | null = (() => {
        if (marketerFilter) {
            const m = mkters.find(x => x.marketer_name === marketerFilter);
            if (!m) return null;
            return {
                source: "marketer",
                revenue: m.revenue, cogs: m.cogs, shipping: m.shipping, ads: m.ads_spend,
                orders: m.orders, success: m.success, returned: m.returned,
                impressions: m.impressions, clicks: m.clicks,
                hasAdsBreakdown: true,
            };
        }
        if (productFilter) {
            const p = products.find(x => x.product_code === productFilter);
            if (!p) return null;
            const revShare = totalRevenue > 0 ? p.revenue / totalRevenue : 0;
            // Ads: proportional UTM attribution (Q9). Falls back to revenue-share
            // allocation only when Q9 has no entry for this SKU.
            const adsAttributed = adsByProduct.get(productFilter.toUpperCase());
            const ads = adsAttributed != null ? adsAttributed : Math.round(totalSpend * revShare);
            // Impressions/Clicks: still revenue-share approximation (ad-level breakdown
            // would need extending Q9 to also aggregate impressions/clicks).
            return {
                source: "product",
                revenue: p.revenue, cogs: p.cogs,
                shipping: Math.round(totalShipping * revShare),
                ads,
                orders: p.orders, success: p.success, returned: p.returned,
                impressions: Math.round(totalImpressions * revShare),
                clicks: Math.round(totalClicks * revShare),
                hasAdsBreakdown: false,
            };
        }
        if (marketFilter) {
            const mk = markets.find(x => x.market === marketFilter);
            if (!mk) return null;
            const revShare = totalRevenue > 0 ? mk.revenue / totalRevenue : 0;
            return {
                source: "market",
                revenue: mk.revenue,
                cogs: Math.round(totalCogs * revShare),
                shipping: Math.round(totalShipping * revShare),
                ads: mk.ads_spend,
                orders: mk.orders, success: mk.success, returned: 0,
                impressions: Math.round(totalImpressions * revShare),
                clicks: Math.round(totalClicks * revShare),
                hasAdsBreakdown: false,
            };
        }
        return null;
    })();

    const isFiltered = !!filteredBase;
    const filterLabel = marketerFilter || productFilter || marketFilter || "";
    const filterSourceLabel = filteredBase?.source === "marketer" ? "Marketer" :
        filteredBase?.source === "product" ? "Sản phẩm" :
            filteredBase?.source === "market" ? "Thị trường" : "";

    // Effective values (có filter hoặc toàn team)
    const eff = {
        revenue: filteredBase?.revenue ?? totalRevenue,
        cogs: filteredBase?.cogs ?? totalCogs,
        shipping: filteredBase?.shipping ?? totalShipping,
        ads: filteredBase?.ads ?? totalSpend,
        orders: filteredBase?.orders ?? totalOrders,
        success: filteredBase?.success ?? totalSuccess,
        returned: filteredBase?.returned ?? totalReturned,
        impressions: filteredBase?.impressions ?? totalImpressions,
        clicks: filteredBase?.clicks ?? totalClicks,
    };
    const effNet = eff.revenue - eff.cogs - eff.shipping - eff.ads;
    const effMargin = eff.revenue > 0 ? (effNet / eff.revenue) * 100 : 0;
    const effRoas = eff.ads > 0 ? eff.revenue / eff.ads : 0;
    const effSr = eff.orders > 0 ? (eff.success / eff.orders) * 100 : 0;
    const effCtr = eff.impressions > 0 ? (eff.clicks / eff.impressions) * 100 : 0;
    const effCpm = eff.impressions > 0 ? (eff.ads / eff.impressions) * 1000 : 0;
    const effCpa = eff.success > 0 ? eff.ads / eff.success : 0;
    const effAov = eff.success > 0 ? eff.revenue / eff.success : 0;

    // Options cho dropdown
    const marketerOptions = [...mkters].filter(m => m.marketer_name).sort((a, b) => b.revenue - a.revenue);
    const productOptions = [...products].filter(p => p.product_code).sort((a, b) => b.revenue - a.revenue);
    const marketOptions = [...markets].filter(m => m.market).sort((a, b) => b.revenue - a.revenue);

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
            <ExchangeRateBanner />

            {/* ─── Bộ lọc: Thị trường / Marketer / Sản phẩm ─── */}
            <div className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">
                        <Target className="h-3.5 w-3.5" /> Bộ lọc
                    </div>

                    <label className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-cyan-500" />
                        <select
                            value={marketFilter}
                            onChange={e => selectMarket(e.target.value)}
                            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 focus:outline-none"
                        >
                            <option value="">Tất cả Thị trường</option>
                            {marketOptions.map(m => (
                                <option key={m.market} value={m.market}>{m.market}</option>
                            ))}
                        </select>
                    </label>

                    <label className="flex items-center gap-2">
                        <Users className="h-3.5 w-3.5 text-blue-500" />
                        <select
                            value={marketerFilter}
                            onChange={e => selectMarketer(e.target.value)}
                            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 focus:outline-none"
                        >
                            <option value="">Tất cả MKT</option>
                            {marketerOptions.map(m => (
                                <option key={m.marketer_name} value={m.marketer_name}>{m.marketer_name}</option>
                            ))}
                        </select>
                    </label>

                    <label className="flex items-center gap-2">
                        <Package className="h-3.5 w-3.5 text-emerald-500" />
                        <select
                            value={productFilter}
                            onChange={e => selectProduct(e.target.value)}
                            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30 focus:outline-none"
                        >
                            <option value="">Tất cả Sản phẩm</option>
                            {productOptions.map(p => (
                                <option key={p.product_code} value={p.product_code}>
                                    {p.product_code}{p.product_name ? ` — ${p.product_name.substring(0, 30)}` : ""}
                                </option>
                            ))}
                        </select>
                    </label>

                    {isFiltered && (
                        <>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                                Đang lọc: {filterSourceLabel} = {filterLabel}
                            </span>
                            <button
                                onClick={resetFilters}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rose-500 hover:bg-rose-500/10 transition"
                                title="Xoá tất cả bộ lọc"
                            >
                                <X className="h-3.5 w-3.5" /> Xoá lọc
                            </button>
                        </>
                    )}
                    {!isFiltered && (
                        <span className="text-xs text-muted-foreground">Mặc định: toàn team. Chọn 1 trong 3 dropdown để lọc — chỉ 1 bộ lọc được áp dụng tại 1 thời điểm.</span>
                    )}
                </div>
            </div>

            {/* ─── Nhóm 1: CHỈ SỐ QUẢNG CÁO ─── */}
            <section className="rounded-xl border-2 border-amber-500/40 bg-amber-500/[0.08] dark:bg-amber-500/[0.06] p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-base font-bold text-amber-600 dark:text-amber-400 flex items-center gap-2">
                            📣 Chỉ số quảng cáo
                            <InfoTip content="Các chỉ số đo hiệu quả Facebook Ads: spend, impressions, clicks, CTR, CPM, ROAS, CPA." />
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            {isFiltered && filteredBase?.source !== "marketer"
                                ? `Impressions/Clicks phân bổ theo tỷ lệ revenue của ${filterSourceLabel.toLowerCase()} — CTR/CPM là giá trị team`
                                : "Facebook Ads performance"}
                        </p>
                    </div>
                    {isFiltered && (
                        <span className="hidden md:inline-flex rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                            {filterSourceLabel}: {filterLabel}
                        </span>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                    <KPICard
                        title="💰 Ads Spend"
                        value={formatCurrency(eff.ads)}
                        icon={Megaphone}
                        tooltip={filteredBase?.source === "product" ? "Ads được phân bổ theo tỷ lệ revenue của sản phẩm (approximation — vì ads không tag theo product)." : "Tổng chi phí quảng cáo Facebook từ fb_ads_data (USD → RON → VND). Spend thô chưa trừ fee/VAT."}
                    />
                    <KPICard
                        title="🎯 ROAS"
                        value={`${effRoas.toFixed(2)}x`}
                        icon={Target}
                        status={effRoas >= 3 ? "success" : effRoas >= 2 ? "warning" : "danger"}
                        tooltip="Return On Ad Spend = Revenue / Ads Spend. ≥ 3x: tốt · 2–3x: cảnh báo · < 2x: lỗ."
                    />
                    <KPICard
                        title="👁 Impressions"
                        value={formatNumber(eff.impressions)}
                        icon={Eye}
                        tooltip={filteredBase?.source === "marketer" ? "Tổng lượt hiển thị ad của marketer này (từ fb_ads_data)." : filteredBase ? "Phân bổ theo revShare — xấp xỉ vì impressions không tag theo product/market." : "Tổng lượt hiển thị ad toàn team trong khoảng thời gian."}
                    />
                    <KPICard
                        title="🖱 Clicks"
                        value={formatNumber(eff.clicks)}
                        icon={MousePointer}
                        tooltip={filteredBase?.source === "marketer" ? "Tổng lượt click ad của marketer này." : filteredBase ? "Phân bổ theo revShare — xấp xỉ." : "Tổng lượt click ad toàn team."}
                    />
                    <KPICard
                        title="📊 CTR"
                        value={`${effCtr.toFixed(2)}%`}
                        icon={Percent}
                        status={effCtr > 3 ? "success" : effCtr > 1.5 ? "warning" : "danger"}
                        tooltip="Click-Through Rate = Clicks / Impressions. > 3%: tốt · 1.5–3%: trung bình · < 1.5%: cần tối ưu creative/targeting."
                    />
                    <KPICard
                        title="💵 CPM"
                        value={formatCurrency(effCpm)}
                        icon={Coins}
                        subValue="/1000 impr"
                        tooltip="Cost Per Mille = Ads Spend / Impressions × 1000. Giá cho mỗi 1000 lượt hiển thị. CPM cao → audience đắt, bidding cạnh tranh."
                    />
                </div>
            </section>

            {/* ─── Nhóm 2: CHỈ SỐ BÁN HÀNG ─── */}
            <section className="rounded-xl border-2 border-blue-500/40 bg-blue-500/[0.08] dark:bg-blue-500/[0.06] p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-base font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                            🛒 Chỉ số bán hàng
                            <InfoTip content="Doanh thu, số đơn, tỷ lệ thành công, CPA và giá trị đơn trung bình. Đều tính trên các đơn đã có kết quả cuối cùng." />
                        </h2>
                        <p className="text-xs text-muted-foreground">Kết quả bán hàng từ ads đang chạy</p>
                    </div>
                    {isFiltered && (
                        <span className="hidden md:inline-flex rounded-full bg-blue-500/20 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
                            {formatNumber(eff.success)} đơn TC · {filterSourceLabel}: {filterLabel}
                        </span>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                    <KPICard
                        title="💰 Revenue"
                        value={formatCurrency(eff.revenue)}
                        icon={DollarSign}
                        status="success"
                        tooltip="Doanh thu từ các đơn đã giao thành công (delivered / received_money). Nguồn: mart_performance_master.delivered_revenue."
                    />
                    <KPICard
                        title="📦 Tổng đơn"
                        value={formatNumber(eff.orders)}
                        icon={Trophy}
                        tooltip="Tổng đơn đã có kết quả cuối cùng (TC + Hoàn). Không tính đơn đang waitting/ordered."
                    />
                    <KPICard
                        title="✅ Thành công"
                        value={formatNumber(eff.success)}
                        icon={TrendingUp}
                        subValue={`SR: ${effSr.toFixed(1)}%`}
                        status={effSr >= 60 ? "success" : effSr >= 45 ? "warning" : "danger"}
                        tooltip="Số đơn đã giao thành công. SR (Success Rate) = TC / Tổng đơn. ≥ 60%: tốt · 45–60%: ổn · < 45%: cần tối ưu."
                    />
                    <KPICard
                        title="↩️ Hoàn"
                        value={formatNumber(eff.returned)}
                        icon={ShoppingCart}
                        status={eff.returned > 0 ? "warning" : "neutral"}
                        tooltip="Số đơn khách đã hoàn. Nguồn: sale_order status = returned."
                    />
                    <KPICard
                        title="💸 CPA"
                        value={effCpa > 0 ? formatCurrency(effCpa) : "—"}
                        icon={Wallet}
                        subValue="/đơn TC"
                        tooltip="Cost Per Acquisition = Ads Spend / Đơn TC. Giá để có được 1 đơn thành công. CPA thấp + AOV cao → profit cao."
                    />
                    <KPICard
                        title="🎫 AOV"
                        value={effAov > 0 ? formatCurrency(effAov) : "—"}
                        icon={DollarSign}
                        subValue="/đơn TC"
                        tooltip="Average Order Value = Revenue / Đơn TC. Giá trị trung bình của 1 đơn đã giao. Muốn tăng profit: ↑AOV hoặc ↓CPA."
                    />
                </div>
            </section>

            {/* ─── Nhóm 3: CHI PHÍ CHI TIẾT ─── */}
            <section className="rounded-xl border-2 border-rose-500/40 bg-rose-500/[0.08] dark:bg-rose-500/[0.06] p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-base font-bold text-rose-600 dark:text-rose-400 flex items-center gap-2">
                            💸 Chi phí chi tiết
                            <InfoTip content="Breakdown các chi phí thực tế và lãi ròng. Các số dưới dòng trên = Tổng CP + Lãi ròng." />
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            {isFiltered && filteredBase?.source !== "marketer"
                                ? `COGS/Ship/FFM được phân bổ theo revShare cho ${filterSourceLabel.toLowerCase()}`
                                : "Chi phí đã phát sinh trên đơn đã settle"}
                        </p>
                    </div>
                </div>
                <div className="rounded-lg border border-rose-500/30 bg-white/70 dark:bg-card/50 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-base">
                        <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Ads:</span>
                            <span className="text-lg font-bold text-amber-500">{formatCurrency(eff.ads)}</span>
                            <InfoTip content={filteredBase?.source === "product" ? "Ads phân bổ theo revShare (ads không tag per-product)." : "Chi phí quảng cáo từ fb_ads_data."} />
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">COGS:</span>
                            <span className="text-lg font-bold text-orange-500">{formatCurrency(eff.cogs)}</span>
                            <InfoTip content={filteredBase?.source === "market" ? "COGS phân bổ theo revShare của thị trường." : "Giá vốn hàng bán trên đơn đã TC. 3-level fallback: product_cogs → avg_imported_price → product_variations."} />
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Ship/FFM:</span>
                            <span className="text-lg font-bold text-cyan-500">{formatCurrency(eff.shipping)}</span>
                            <InfoTip content={filteredBase && filteredBase.source !== "marketer" ? "Ship/FFM phân bổ theo revShare." : "Phí 3PL thực tế (EU Shipment, đã gồm VAT, EUR → RON). Forward + return cost."} />
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Tổng CP:</span>
                            <span className="text-lg font-bold text-rose-500">{formatCurrency(eff.ads + eff.cogs + eff.shipping)}</span>
                            <InfoTip content="Tổng CP = Ads + COGS + Ship/FFM. Chưa gồm nhân sự, văn phòng, công cụ." />
                        </div>
                        <div className="ml-auto flex items-center gap-1.5 border-l border-rose-500/30 pl-4">
                            <span className="text-muted-foreground">→ Lãi ròng:</span>
                            <span className={cn("text-lg font-bold", effNet >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                {effNet >= 0 ? "+" : ""}{formatCurrency(effNet)}
                            </span>
                            <span className={cn("text-xs", effMargin >= 0 ? "text-muted-foreground" : "text-rose-500/70")}>
                                ({effMargin.toFixed(1)}%)
                            </span>
                        </div>
                    </div>
                </div>
            </section>

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
                                    {m.net_profit >= 0 ? "+" : ""}{formatMoney(m.net_profit)}
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
                            <Bar yAxisId="left" dataKey="spend" name="Spend" fill="#ef4444" radius={[4, 4, 0, 0]} />
                            <Line yAxisId="left" type="monotone" dataKey="revenue" name="Revenue" stroke="#34d399" strokeWidth={2} dot={false} />
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

            {/* ── Daily Marketer P&L Detail ── */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">📅 Chi Tiết P&L Theo Ngày</h3>
                {/* Marketer filter tabs */}
                <div className="mb-4 flex flex-wrap gap-2">
                    <button
                        onClick={() => setSelectedMkter("ALL")}
                        className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                            selectedMkter === "ALL" ? "bg-indigo-500 text-foreground" : "bg-white/10 text-gray-400 hover:bg-white/20")}
                    >Tất cả</button>
                    {mkters.map((m) => (
                        <button
                            key={m.marketer_name}
                            onClick={() => setSelectedMkter(m.marketer_name)}
                            className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                                selectedMkter === m.marketer_name ? "bg-emerald-500 text-foreground" : "bg-white/10 text-gray-400 hover:bg-white/20")}
                        >{m.marketer_name}</button>
                    ))}
                </div>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-card z-10">
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">Ngày</th>
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
                            </tr>
                        </thead>
                        <tbody>
                            {dailyMkter
                                .filter((d) => selectedMkter === "ALL" || d.marketer_name === selectedMkter)
                                .map((d, i) => {
                                    const cpa = d.orders > 0 ? Math.round(d.ads_spend / d.orders) : 0;
                                    const dateStr = typeof d.report_date === "string" ? d.report_date : "";
                                    // Group styling: alternating date backgrounds
                                    return (
                                        <tr key={`${d.report_date}-${d.marketer_name}`}
                                            className="border-b border-border/20 hover:bg-gray-50/50">
                                            <td className="px-2 py-1.5 font-mono text-[11px] text-foreground whitespace-nowrap">
                                                {dateStr.slice(0, 10)}
                                            </td>
                                            <td className="px-2 py-1.5 font-medium text-foreground whitespace-nowrap">{d.marketer_name}</td>
                                            <td className="px-2 py-1.5 text-right">{formatNumber(d.orders)}</td>
                                            <td className="px-2 py-1.5 text-right">{formatNumber(d.success)}</td>
                                            <td className={cn("px-2 py-1.5 text-right", d.returned > 0 ? "text-rose-400" : "")}>{formatNumber(d.returned)}</td>
                                            <td className={cn("px-2 py-1.5 text-right font-semibold",
                                                (d.sr || 0) >= 45 ? "text-emerald-400" : (d.sr || 0) >= 30 ? "text-amber-400" : "text-rose-400")}>
                                                {d.sr != null ? `${d.sr}%` : "—"}
                                            </td>
                                            <td className="px-2 py-1.5 text-right font-semibold text-emerald-400">{formatMoney(d.revenue)}</td>
                                            <td className="px-2 py-1.5 text-right text-amber-400">{formatMoney(d.ads_spend)}</td>
                                            <td className="px-2 py-1.5 text-right text-orange-400">{formatMoney(d.cogs)}</td>
                                            <td className="px-2 py-1.5 text-right text-cyan-400">{formatMoney(d.shipping)}</td>
                                            <td className={cn("px-2 py-1.5 text-right font-bold",
                                                d.net_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                                {d.net_profit >= 0 ? "+" : ""}{formatMoney(d.net_profit)}
                                            </td>
                                            <td className={cn("px-2 py-1.5 text-right font-semibold",
                                                (d.roas || 0) >= 3 ? "text-emerald-400" : (d.roas || 0) >= 1.5 ? "text-amber-400" : "text-rose-400")}>
                                                {d.roas ? `${d.roas}x` : "—"}
                                            </td>
                                            <td className="px-2 py-1.5 text-right">{formatMoney(cpa)}</td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div >
    );
}
