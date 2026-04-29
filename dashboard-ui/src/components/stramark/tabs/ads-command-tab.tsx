"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import axios from "axios";
import { RotateCw, Satellite, Layers, AlertTriangle, ChevronDown, ChevronRight, Check, Zap, Target, TrendingUp, BarChart2, Upload, Radio, Search, User, Package, X } from "lucide-react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

// ── helpers ──
function cn(...classes: (string | false | undefined)[]) { return classes.filter(Boolean).join(" "); }
// ── Tỷ giá cố định (cập nhật 2026-03-18) ──
const USD_TO_VND = 26325;    // 1 USD = 26,325 VND
const RON_TO_VND = 5946;     // 1 LEI/RON = 5,946 VND
const EUR_TO_VND = 30667;    // 1 EUR = 30,667 VND
function formatVND(val: number) {
    if (Math.abs(val) >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return `${Math.round(val)}`;
}
function usdToVnd(usd: number) { return usd * USD_TO_VND; }
function ronToVnd(ron: number) { return ron * RON_TO_VND; }
/** Correct ROAS: convert both to VND before dividing */
function calcRoas(revRon: number, spendUsd: number): number {
    const revVnd = ronToVnd(revRon);
    const spendVnd = usdToVnd(spendUsd);
    return spendVnd > 0 ? revVnd / spendVnd : 0;
}

// ── date helpers ──
function todayStr() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }); }
const DATE_PRESETS: { label: string; from: () => string; to: () => string }[] = [
    { label: "Hôm nay", from: todayStr, to: todayStr },
    { label: "Hôm qua", from: () => daysAgo(1), to: () => daysAgo(1) },
    { label: "3 ngày", from: () => daysAgo(2), to: todayStr },
    { label: "7 ngày", from: () => daysAgo(6), to: todayStr },
    { label: "14 ngày", from: () => daysAgo(13), to: todayStr },
    { label: "30 ngày", from: () => daysAgo(29), to: todayStr },
];

// ── types ──
interface AdDetail {
    ad_id: string; ad_name: string; adset_id?: string; adset_name: string;
    ad_status?: string; adset_status?: string;
    spend: number; impressions: number; cpm: number; cpc: number; ctr: number;
    messages: number; purchases: number; orders: number; revenue_ron: number; roas: number;
}

interface RealtimeCampaign {
    account_id: string; account_name: string; campaign_id: string; campaign_name: string;
    campaign_status?: string;
    spend: number; impressions: number; cpm: number; ctr: number;
    messages: number; purchases: number; orders: number; revenue_ron: number; roas: number;
    ads_count: number; ads: AdDetail[];
    orders_by_product?: Record<string, { orders: number; revenue_ron: number }>;
}

interface Summary {
    total_spend: number; total_revenue_ron: number; total_orders: number;
    total_messages: number; matched_orders: number; unmatched_orders: number;
    campaign_matched_orders: number; total_matched_orders: number; lookup_matched_orders: number;
    total_pos_orders: number; total_meta_purchases: number; blended_roas: number;
    accounts_fetched: number; shops_fetched: number;
    matched_revenue_ron: number; unmatched_revenue_ron: number;
}

interface MetaStatus {
    token_valid: boolean;
    error_code?: number;
    error_message?: string;
    accounts_ok: string[];
    accounts_blocked: string[];
    rate_limit_pct?: number;
}

interface RealtimeData {
    source: string; fetched_at: string; duration_ms: number;
    summary: Summary; campaigns: RealtimeCampaign[];
    meta_status?: MetaStatus;
    unmatched_orders: any[]; unmatched_by_shop: Record<string, { count: number; revenue_ron: number }>;
    pos_orders_by_product?: Record<string, { orders: number; revenue_ron: number }>;
    unmatched_by_product?: Record<string, { orders: number; revenue_ron: number }>;
}

// ── Market detection ──
// Campaign name convention: "22.1 - D04 - Romania - CĐ - Aurelia Wear - TÚ"
// Market nằm ở phần tử thứ 3 (index 2) dưới dạng tên đầy đủ tiếng Anh.
const MARKETS = ["RO", "SK", "BG", "HR"] as const;
type Market = typeof MARKETS[number];
const MARKET_LABELS: Record<Market, string> = { RO: "Romania", SK: "Slovakia", BG: "Bulgaria", HR: "Croatia" };
const MARKET_FLAGS: Record<Market, string> = { RO: "🇷🇴", SK: "🇸🇰", BG: "🇧🇬", HR: "🇭🇷" };
// Match cả tên đầy đủ (Romania/Slovakia/Bulgaria/Croatia) và code 2 ký tự (RO/SK/BG/HR),
// có word boundary để tránh false positive. Case-insensitive.
const MARKET_PATTERNS: Record<Market, RegExp> = {
    RO: /\b(Romania|Rumania|RO)\b/i,
    SK: /\b(Slovakia|Slovak|SK)\b/i,
    BG: /\b(Bulgaria|Bulgarian|BG)\b/i,
    HR: /\b(Croatia|Croatian|HR)\b/i,
};
function detectMarket(campaignName: string): Market | null {
    for (const m of MARKETS) {
        if (MARKET_PATTERNS[m].test(campaignName)) return m;
    }
    return null;
}

const ACCOUNT_NAMES: Record<string, string> = {
    "act_817501334775697": "STRAMARK TK1",
    "act_1369010934859968": "STRAMARK TK2",
    "act_1528285295107514": "STRAMARK TK3",
};
const getAccountName = (id: string) => ACCOUNT_NAMES[id] || id;

export default function AdsCommandTab() {
    const [data, setData] = useState<RealtimeData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [syncedAt, setSyncedAt] = useState<Date | null>(null);
    const [dailyTrend, setDailyTrend] = useState<{ date: string; spend_vnd: number; revenue_vnd: number; roas: number; orders: number }[]>([]);
    const [selectedAccount, setSelectedAccount] = useState("all");
    const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
    const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
    const [expandedAdset, setExpandedAdset] = useState<string | null>(null);
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [activePreset, setActivePreset] = useState("Hôm nay");
    const [, setMounted] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [marketerFilter, setMarketerFilter] = useState("");
    const [productFilter, setProductFilter] = useState("");
    // Track what date range the currently-loaded data actually corresponds to,
    // so the picker can flag when its inputs diverge from the displayed data.
    const [loadedRange, setLoadedRange] = useState<{ from: string; to: string } | null>(null);
    const [marketFilter, setMarketFilter] = useState<"ALL" | "RO" | "SK" | "BG" | "HR">("ALL");
    const [togglingCampaign, setTogglingCampaign] = useState<string | null>(null);
    const [, setBqAdsSpendUsd] = useState<number | null>(null);
    // Per-SKU and per-campaign daily breakdowns for the filtered chart.
    // Map keys: date string (YYYY-MM-DD) → second-level key (SKU or campaign_name) → metrics.
    const [dailyByProduct, setDailyByProduct] = useState<Map<string, Map<string, { spend_vnd: number; revenue_vnd: number }>>>(new Map());
    const [dailyByCampaign, setDailyByCampaign] = useState<Map<string, Map<string, { spend_vnd: number; revenue_vnd: number }>>>(new Map());
    // CAPI Push state
    const [capiStatus, setCapiStatus] = useState<{
        pending_push: number; already_pushed: number; total_confirmed_orders: number;
        last_push_at: string | null; total_value_pending: number; pixel_id?: string;
    } | null>(null);
    const [capiPushing, setCapiPushing] = useState(false);
    const [capiResult, setCapiResult] = useState<{
        status: string; events_pushed?: number; order_count?: number; errors?: string[];
    } | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const dateRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsAccountDropdownOpen(false);
            if (dateRef.current && !dateRef.current.contains(e.target as Node)) setShowDatePicker(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const fetchData = async (fd?: string, td?: string) => {
        const f = fd || fromDate;
        const t = td || toDate;
        setLoading(true); setError(null);
        try {
            const [realtimeRes] = await Promise.all([
                axios.get(`/api/stramark/realtime`, {
                    params: { from_date: f, to_date: t },
                    timeout: 60000,
                }),
                // Fetch daily trend + total spend from BQ in parallel (non-blocking)
                fetch("/api/query", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        query: `WITH daily_ads AS (
                            SELECT a.date AS report_date, ROUND(SUM(a.spend),2) as spend_usd
                            FROM STRAMARK_Dataset.fb_ads_data a
                            WHERE a.date BETWEEN '${f}' AND '${t}'
                            GROUP BY 1
                        ),
                        daily_rev AS (
                            SELECT
                                CAST(DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at)) AS STRING) AS report_date,
                                COUNT(*) AS total_orders,
                                ROUND(SUM(
                                    SAFE_CAST(COALESCE(cod, total_price, 0) AS FLOAT64) / 100.0
                                    * CASE WHEN UPPER(order_currency) = 'EUR' THEN ${EUR_TO_VND / RON_TO_VND} ELSE 1 END
                                ), 2) AS revenue_ron
                            FROM STRAMARK_Dataset.sale_order
                            WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at))
                                BETWEEN '${f}' AND '${t}'
                            GROUP BY 1
                        )
                        SELECT
                            COALESCE(a.report_date, r.report_date) AS report_date,
                            COALESCE(a.spend_usd, 0) AS spend_usd,
                            COALESCE(r.revenue_ron, 0) AS revenue_ron,
                            COALESCE(r.total_orders, 0) AS total_orders
                        FROM daily_ads a
                        FULL OUTER JOIN daily_rev r ON a.report_date = r.report_date
                        ORDER BY 1`
                    }),
                }).then(r => r.json()).then(d => {
                    const rows = d.data || [];
                    setDailyTrend(rows.map((r: any) => {
                        const spendVnd = Math.round((r.spend_usd || 0) * USD_TO_VND);
                        const revenueVnd = Math.round((r.revenue_ron || 0) * RON_TO_VND);
                        return {
                            date: String(r.report_date?.value || r.report_date || "").slice(5),
                            spend_vnd: spendVnd,
                            revenue_vnd: revenueVnd,
                            roas: spendVnd > 0 ? +(revenueVnd / spendVnd).toFixed(2) : 0,
                            orders: r.total_orders || 0,
                        };
                    }));
                    // Total BQ ads spend in USD — canonical source
                    const totalUsd = rows.reduce((s: number, r: any) => s + (r.spend_usd || 0), 0);
                    setBqAdsSpendUsd(totalUsd);
                }).catch(() => {}),
                // Daily per-SKU spend (proportional UTM allocation) + booking revenue (cod allocated by qty).
                // Lets the chart redraw correctly when productFilter is active.
                fetch("/api/query", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        query: `WITH order_codes AS (
                            SELECT so.id, so.p_utm_term, so.p_utm_campaign,
                                CAST(DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at)) AS STRING) AS order_date,
                                ARRAY_AGG(DISTINCT COALESCE(
                                    pt.custom_id,
                                    REGEXP_EXTRACT(oi.product_name, r'^([A-Z]\\d+)'),
                                    REGEXP_EXTRACT(oi.variation_name, r'^([A-Z]\\d+)')
                                ) IGNORE NULLS) AS product_codes,
                                SAFE_CAST(COALESCE(so.cod, so.total_price, 0) AS FLOAT64) / 100.0
                                  * CASE WHEN UPPER(so.order_currency) = 'EUR' THEN ${EUR_TO_VND / RON_TO_VND} ELSE 1 END AS cod_ron
                            FROM STRAMARK_Dataset.sale_order so
                            JOIN STRAMARK_Dataset.order_items oi ON so.id = oi.order_id
                            LEFT JOIN STRAMARK_Dataset.product_template pt ON oi.product_id = pt.id
                            WHERE DATE(CAST(so.inserted_at AS TIMESTAMP)) BETWEEN '${f}' AND '${t}'
                              AND COALESCE(SAFE_CAST(so.status AS INT64), 0) != 7
                            GROUP BY so.id, so.p_utm_term, so.p_utm_campaign, order_date,
                                so.cod, so.total_price, so.order_currency
                        ),
                        order_to_campaign AS (
                            SELECT DISTINCT oc.id AS order_id, oc.product_codes, oc.order_date, oc.cod_ron, fa.campaign_id
                            FROM order_codes oc
                            JOIN STRAMARK_Dataset.fb_ads_data fa
                              ON fa.date BETWEEN '${f}' AND '${t}'
                             AND (CAST(fa.ad_id AS STRING) = oc.p_utm_term OR fa.campaign_name = oc.p_utm_campaign)
                        ),
                        campaign_totals AS (
                            SELECT campaign_id, COUNT(DISTINCT order_id) AS total_orders
                            FROM order_to_campaign GROUP BY 1
                        ),
                        campaign_product_orders AS (
                            SELECT campaign_id, UPPER(code) AS product_code, COUNT(DISTINCT order_id) AS product_orders
                            FROM order_to_campaign, UNNEST(product_codes) AS code
                            WHERE code IS NOT NULL GROUP BY 1, 2
                        ),
                        spend_per_sku AS (
                            SELECT CAST(fa.date AS STRING) AS date, cpo.product_code,
                                ROUND(SUM(fa.spend * cpo.product_orders / ct.total_orders), 4) AS ads_spend_usd
                            FROM STRAMARK_Dataset.fb_ads_data fa
                            JOIN campaign_product_orders cpo ON fa.campaign_id = cpo.campaign_id
                            JOIN campaign_totals ct ON cpo.campaign_id = ct.campaign_id
                            WHERE fa.date BETWEEN '${f}' AND '${t}' AND ct.total_orders > 0
                            GROUP BY 1, 2
                        ),
                        item_qty AS (
                            SELECT oi.order_id,
                                UPPER(COALESCE(pt.custom_id,
                                    REGEXP_EXTRACT(oi.product_name, r'^([A-Z]\\d+)'),
                                    REGEXP_EXTRACT(oi.variation_name, r'^([A-Z]\\d+)'))) AS product_code,
                                SAFE_CAST(oi.quantity AS INT64) AS qty
                            FROM STRAMARK_Dataset.order_items oi
                            LEFT JOIN STRAMARK_Dataset.product_template pt ON oi.product_id = pt.id
                        ),
                        order_total_qty AS (
                            SELECT order_id, SUM(qty) AS total_qty FROM item_qty
                            WHERE product_code IS NOT NULL GROUP BY 1
                        ),
                        revenue_per_sku AS (
                            SELECT oc.order_date AS date, iq.product_code,
                                ROUND(SUM(oc.cod_ron * iq.qty / NULLIF(otq.total_qty, 0)), 0) AS revenue_ron
                            FROM order_codes oc
                            JOIN item_qty iq ON oc.id = iq.order_id
                            JOIN order_total_qty otq ON oc.id = otq.order_id
                            WHERE iq.product_code IS NOT NULL AND otq.total_qty > 0
                            GROUP BY 1, 2
                        )
                        SELECT
                            COALESCE(s.date, r.date) AS date,
                            COALESCE(s.product_code, r.product_code) AS product_code,
                            COALESCE(s.ads_spend_usd, 0) AS ads_spend_usd,
                            COALESCE(r.revenue_ron, 0) AS revenue_ron
                        FROM spend_per_sku s
                        FULL OUTER JOIN revenue_per_sku r ON s.date = r.date AND s.product_code = r.product_code`
                    }),
                }).then(r => r.json()).then(d => {
                    const map = new Map<string, Map<string, { spend_vnd: number; revenue_vnd: number }>>();
                    (d.data || []).forEach((r: any) => {
                        const date = String(r.date?.value || r.date || "");
                        if (!date || !r.product_code) return;
                        const code = String(r.product_code).toUpperCase();
                        let day = map.get(date); if (!day) { day = new Map(); map.set(date, day); }
                        day.set(code, {
                            spend_vnd: Math.round((r.ads_spend_usd || 0) * USD_TO_VND),
                            revenue_vnd: Math.round((r.revenue_ron || 0) * RON_TO_VND),
                        });
                    });
                    setDailyByProduct(map);
                }).catch(() => {}),
                // Daily per-campaign spend + UTM-attributed booking revenue.
                // Powers the marketer filter — substring-matches campaign_name on the frontend.
                fetch("/api/query", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        query: `WITH daily_spend AS (
                            SELECT CAST(date AS STRING) AS date, campaign_id, campaign_name, SUM(spend) AS spend_usd
                            FROM STRAMARK_Dataset.fb_ads_data
                            WHERE date BETWEEN '${f}' AND '${t}'
                            GROUP BY 1, 2, 3
                        ),
                        order_attr AS (
                            -- Each order goes to ONE attributed campaign (prefer ad_id match, fall back to campaign_name).
                            SELECT
                                CAST(DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at)) AS STRING) AS order_date,
                                so.id AS order_id,
                                SAFE_CAST(COALESCE(so.cod, so.total_price, 0) AS FLOAT64) / 100.0
                                  * CASE WHEN UPPER(so.order_currency) = 'EUR' THEN ${EUR_TO_VND / RON_TO_VND} ELSE 1 END AS cod_ron,
                                ARRAY_AGG(DISTINCT fa.campaign_id LIMIT 1)[OFFSET(0)] AS campaign_id,
                                ARRAY_AGG(DISTINCT fa.campaign_name LIMIT 1)[OFFSET(0)] AS campaign_name
                            FROM STRAMARK_Dataset.sale_order so
                            JOIN STRAMARK_Dataset.fb_ads_data fa
                              ON fa.date BETWEEN '${f}' AND '${t}'
                             AND (CAST(fa.ad_id AS STRING) = so.p_utm_term OR fa.campaign_name = so.p_utm_campaign)
                            WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at)) BETWEEN '${f}' AND '${t}'
                              AND COALESCE(SAFE_CAST(so.status AS INT64), 0) != 7
                            GROUP BY 1, 2, cod_ron
                        ),
                        daily_revenue AS (
                            SELECT order_date AS date, campaign_id, campaign_name, ROUND(SUM(cod_ron), 0) AS revenue_ron
                            FROM order_attr
                            GROUP BY 1, 2, 3
                        )
                        SELECT
                            COALESCE(s.date, r.date) AS date,
                            COALESCE(s.campaign_name, r.campaign_name) AS campaign_name,
                            COALESCE(s.spend_usd, 0) AS spend_usd,
                            COALESCE(r.revenue_ron, 0) AS revenue_ron
                        FROM daily_spend s
                        FULL OUTER JOIN daily_revenue r ON s.campaign_id = r.campaign_id AND s.date = r.date
                        WHERE COALESCE(s.campaign_name, r.campaign_name) IS NOT NULL`
                    }),
                }).then(r => r.json()).then(d => {
                    const map = new Map<string, Map<string, { spend_vnd: number; revenue_vnd: number }>>();
                    (d.data || []).forEach((r: any) => {
                        const date = String(r.date?.value || r.date || "");
                        if (!date || !r.campaign_name) return;
                        let day = map.get(date); if (!day) { day = new Map(); map.set(date, day); }
                        const existing = day.get(r.campaign_name) || { spend_vnd: 0, revenue_vnd: 0 };
                        day.set(r.campaign_name, {
                            spend_vnd: existing.spend_vnd + Math.round((r.spend_usd || 0) * USD_TO_VND),
                            revenue_vnd: existing.revenue_vnd + Math.round((r.revenue_ron || 0) * RON_TO_VND),
                        });
                    });
                    setDailyByCampaign(map);
                }).catch(() => {}),
            ]);
            setData(realtimeRes.data); setSyncedAt(new Date()); setLoadedRange({ from: f, to: t });
            // Fetch CAPI status in background (non-blocking)
            fetch(`/api/stramark/capi-push?from_date=${f}&to_date=${t}`)
                .then(r => r.json())
                .then(d => { if (!d.error) setCapiStatus(d); })
                .catch(() => {});
        } catch (err: any) {
            setError(err.response?.data?.error || err.message || "Failed to fetch");
        } finally { setLoading(false); }
    };

    const applyPreset = (preset: typeof DATE_PRESETS[0]) => {
        const f = preset.from(); const t = preset.to();
        setFromDate(f); setToDate(t);
        setActivePreset(preset.label);
        setShowDatePicker(false);
        fetchData(f, t);
    };

    const applyCustom = () => {
        setActivePreset(`${fromDate} → ${toDate}`);
        setShowDatePicker(false);
        fetchData();
    };

    useEffect(() => {
        setMounted(true);
        const today = todayStr();
        setFromDate(today);
        setToDate(today);
        fetchData(today, today);
    }, []);
    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(() => fetchData(), 60000);
        return () => clearInterval(interval);
    }, [autoRefresh, fromDate, toDate]);

    // SKU-mode filter activates when the input matches a real product code (D04, A03, T12, …)
    // and the API has data for that SKU. Other inputs ("d", "Aurelia") fall back to the legacy
    // campaign-name substring match so partial typing keeps working.
    const productRaw = productFilter.trim();
    const productUpper = productRaw.toUpperCase();
    const skuMode = /^[A-Z]\d+$/.test(productUpper) && (data?.pos_orders_by_product?.[productUpper]?.orders ?? 0) > 0;
    const productCode = skuMode ? productUpper : "";

    const campaigns = useMemo(() => {
        if (!data) return [];
        let filtered = selectedAccount === "all" ? data.campaigns : data.campaigns.filter(c => c.account_id === selectedAccount);
        const mq = marketerFilter.toLowerCase().trim();
        if (mq) filtered = filtered.filter(c => c.campaign_name.toLowerCase().includes(mq));
        if (productCode) {
            // SKU filter — keep campaigns that attributed this product, and ALLOCATE
            // spend/impressions/messages/purchases proportionally by D04_orders / total_orders
            // in the campaign. A "D07 - …" campaign that drove 1 D06 order out of 386 only
            // contributes 1/386 of its spend to D06's total — fixes the cross-product overcount.
            filtered = filtered
                .filter(c => (c.orders_by_product?.[productCode]?.orders || 0) > 0)
                .map(c => {
                    const slice = c.orders_by_product![productCode];
                    const orderShare = c.orders > 0 ? slice.orders / c.orders : 1;
                    return {
                        ...c,
                        orders: slice.orders,
                        revenue_ron: slice.revenue_ron,
                        spend: c.spend * orderShare,
                        impressions: Math.round(c.impressions * orderShare),
                        messages: Math.round(c.messages * orderShare),
                        purchases: Math.round(c.purchases * orderShare),
                    };
                });
        } else if (productRaw) {
            // Legacy partial-text fallback for non-SKU input.
            const pq = productRaw.toLowerCase();
            filtered = filtered.filter(c => c.campaign_name.toLowerCase().includes(pq));
        }
        if (marketFilter !== "ALL") filtered = filtered.filter(c => detectMarket(c.campaign_name) === marketFilter);
        return filtered;
    }, [data, selectedAccount, marketerFilter, productCode, productRaw, marketFilter]);

    const grouped = useMemo(() => {
        const groups: Record<string, RealtimeCampaign[]> = {};
        campaigns.forEach(c => {
            if (!groups[c.account_id]) groups[c.account_id] = [];
            groups[c.account_id].push(c);
        });
        return groups;
    }, [campaigns]);

    const rawSummary = data?.summary;
    const accountIds = Object.keys(ACCOUNT_NAMES);

    // Compute filtered summary from visible campaigns.
    // When a SKU filter is active, "Đơn POS" must equal POS UI count for that SKU —
    // include matched (in-campaign) orders + unmatched orders carrying the same SKU.
    const filteredSummary = useMemo(() => {
        const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
        const totalRevenueRon = campaigns.reduce((s, c) => s + c.revenue_ron, 0);
        const matchedCampaignOrders = campaigns.reduce((s, c) => s + c.orders, 0);
        const totalMessages = campaigns.reduce((s, c) => s + c.messages, 0);
        const totalPurchases = campaigns.reduce((s, c) => s + c.purchases, 0);
        const matchedMetaOrders = campaigns.reduce((s, c) => s + Math.min(c.orders, c.purchases), 0);

        const skuPosTotal = productCode ? (data?.pos_orders_by_product?.[productCode]?.orders || 0) : matchedCampaignOrders;
        const skuPosRevenue = productCode ? (data?.pos_orders_by_product?.[productCode]?.revenue_ron || 0) : totalRevenueRon;
        // Without SKU filter we keep the original Meta-matched semantics; with SKU filter
        // "Chưa" = POS orders carrying this SKU that no campaign attributed to.
        const unmatchedDisplay = productCode
            ? Math.max(0, skuPosTotal - matchedCampaignOrders)
            : matchedCampaignOrders - matchedMetaOrders;

        return {
            total_spend: totalSpend,
            total_revenue_ron: skuPosRevenue,
            total_orders: matchedCampaignOrders,
            total_pos_orders: skuPosTotal,
            total_messages: totalMessages,
            total_meta_purchases: totalPurchases,
            total_matched_orders: matchedMetaOrders,
            matched_orders: matchedMetaOrders,
            unmatched_orders: unmatchedDisplay,
        };
    }, [campaigns, productCode, data]);

    // Use filtered summary for all KPIs
    const isFiltered = marketerFilter.trim() !== "" || productFilter.trim() !== "" || selectedAccount !== "all" || marketFilter !== "ALL";
    const summary = isFiltered ? filteredSummary : rawSummary;

    // ── Filtered daily chart ──
    // Picks per-SKU data when productCode resolves to a real SKU; per-campaign data
    // (substring-matched against campaign_name) when only marketer filter is active.
    // Falls back to the original aggregate dailyTrend when no relevant filter.
    const filteredDailyTrend = useMemo(() => {
        const mq = marketerFilter.toLowerCase().trim();
        const useSku = !!productCode;
        const useMarketer = !useSku && !!mq;
        if (!useSku && !useMarketer) return dailyTrend;

        const dates = useSku
            ? Array.from(dailyByProduct.keys()).sort()
            : Array.from(dailyByCampaign.keys()).sort();

        return dates.map((date) => {
            let spend_vnd = 0, revenue_vnd = 0;
            if (useSku) {
                const cell = dailyByProduct.get(date)?.get(productCode);
                if (cell) { spend_vnd = cell.spend_vnd; revenue_vnd = cell.revenue_vnd; }
            } else {
                const day = dailyByCampaign.get(date);
                if (day) day.forEach((cell, name) => {
                    if (name.toLowerCase().includes(mq)) {
                        spend_vnd += cell.spend_vnd; revenue_vnd += cell.revenue_vnd;
                    }
                });
            }
            return {
                date: date.slice(5),
                spend_vnd, revenue_vnd,
                roas: spend_vnd > 0 ? +(revenue_vnd / spend_vnd).toFixed(2) : 0,
                orders: 0,
            };
        });
    }, [dailyTrend, dailyByProduct, dailyByCampaign, productCode, marketerFilter]);

    // Projected success rate
    const DELIVERY_SR = 0.56; // STRAMARK ~56% success rate
    const revVnd = ronToVnd(summary?.total_revenue_ron || 0);
    const spendVnd = usdToVnd(summary?.total_spend || 0);
    const projectedRev = revVnd * DELIVERY_SR;
    const projectedRoas = spendVnd > 0 ? projectedRev / spendVnd : 0;
    const projectedProfit = projectedRev - spendVnd;

    const toggleCampaign = (id: string) => setExpandedCampaign(prev => prev === id ? null : id);

    const toggleCampaignStatus = async (campaignId: string, currentStatus: string) => {
        const newStatus = currentStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
        if (!confirm(`${newStatus === "PAUSED" ? "Tắt" : "Bật"} campaign này?`)) return;
        setTogglingCampaign(campaignId);
        try {
            const res = await axios.post("/api/stramark/realtime", {
                action: "toggle_campaign",
                campaign_id: campaignId,
                status: newStatus,
            });
            if (res.data?.success) {
                // Update local state
                setData(prev => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        campaigns: prev.campaigns.map(c =>
                            c.campaign_id === campaignId ? { ...c, campaign_status: newStatus } : c
                        ),
                    };
                });
            } else {
                alert(`Lỗi: ${res.data?.error || "Unknown error"}`);
            }
        } catch (err: any) {
            alert(`Lỗi: ${err.response?.data?.error || err.message}`);
        } finally {
            setTogglingCampaign(null);
        }
    };

    const pushToMetaCAPI = async (dryRun = false) => {
        setCapiPushing(true); setCapiResult(null);
        try {
            const res = await axios.post("/api/stramark/capi-push", {
                from_date: fromDate, to_date: toDate, dry_run: dryRun,
            }, { timeout: 60000 });
            setCapiResult(res.data);
            // Refresh CAPI status after push
            if (!dryRun && res.data.status === "SUCCESS") {
                fetch(`/api/stramark/capi-push?from_date=${fromDate}&to_date=${toDate}`)
                    .then(r => r.json())
                    .then(d => { if (!d.error) setCapiStatus(d); })
                    .catch(() => {});
            }
        } catch (err: any) {
            setCapiResult({ status: "ERROR", errors: [err.response?.data?.error || err.message] });
        } finally { setCapiPushing(false); }
    };

    return (
        <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-sans rounded-xl border border-slate-200 dark:border-slate-700">

            {/* ═══ HEADER ═══ */}
            <header className="h-14 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 flex items-center justify-between shrink-0 z-50">
                <div className="flex items-center gap-3">
                    <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                        <Satellite className="h-5 w-5 text-blue-600 dark:text-blue-400" /> ADS COMMAND
                    </h1>
                    {/* Account dropdown */}
                    <div className="relative" ref={dropdownRef}>
                        <button onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
                            className="flex items-center gap-2 bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:border-blue-400 transition">
                            <Layers className="h-3 w-3" />
                            {selectedAccount === "all" ? `All (${Object.keys(grouped).length})` : getAccountName(selectedAccount)}
                            <ChevronDown className={`h-3 w-3 transition ${isAccountDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isAccountDropdownOpen && (
                            <div className="absolute top-full left-0 mt-1 w-64 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl z-50 overflow-hidden max-h-96 overflow-y-auto">
                                <button onClick={() => { setSelectedAccount("all"); setIsAccountDropdownOpen(false); }}
                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-700 ${selectedAccount === "all" ? "bg-blue-600/20 text-blue-300" : "text-slate-300"}`}>
                                    <span>🌐 All ({accountIds.length} TKQC)</span>
                                    {selectedAccount === "all" && <Check className="h-4 w-4 text-blue-400" />}
                                </button>
                                {accountIds.map(accId => (
                                    <button key={accId} onClick={() => { setSelectedAccount(accId); setIsAccountDropdownOpen(false); }}
                                        className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-slate-700 ${selectedAccount === accId ? "bg-blue-600/20 text-blue-300" : "text-slate-300"}`}>
                                        <div>
                                            <div className="font-medium text-xs">{getAccountName(accId)}</div>
                                            <div className="font-mono text-[9px] text-slate-500">{accId}</div>
                                        </div>
                                        {selectedAccount === accId && <Check className="h-3 w-3 text-blue-400" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {/* Date Range Picker */}
                    <div className="relative" ref={dateRef}>
                        {(() => {
                            const stale = loadedRange && (loadedRange.from !== fromDate || loadedRange.to !== toDate);
                            return (
                                <button onClick={() => setShowDatePicker(!showDatePicker)}
                                    title={stale ? `⚠️ Dữ liệu đang hiển thị: ${loadedRange!.from} → ${loadedRange!.to}. Bấm "Áp dụng" để load range hiện tại.` : ""}
                                    className={cn("flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition",
                                        stale
                                            ? "bg-amber-100 dark:bg-amber-900/30 border border-amber-400 text-amber-700 dark:text-amber-300 hover:border-amber-500"
                                            : "bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-blue-400")}>
                                    📅 {activePreset}{stale && " ⚠"}
                                    <ChevronDown className={`h-3 w-3 transition ${showDatePicker ? 'rotate-180' : ''}`} />
                                </button>
                            );
                        })()}
                        {showDatePicker && (
                            <div className="absolute top-full left-0 mt-1 w-72 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl z-50 overflow-hidden">
                                <div className="p-2 border-b border-slate-700">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 px-1">Khoảng thời gian</div>
                                    <div className="grid grid-cols-3 gap-1">
                                        {DATE_PRESETS.map(p => (
                                            <button key={p.label} onClick={() => applyPreset(p)}
                                                className={cn("px-2 py-1.5 rounded-lg text-xs text-center transition",
                                                    activePreset === p.label
                                                        ? "bg-blue-600/30 text-blue-300 border border-blue-500/50"
                                                        : "bg-slate-700 text-slate-300 hover:bg-slate-600")}>
                                                {p.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="p-2">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1.5 px-1">Tuỳ chỉnh</div>
                                    <div className="flex items-center gap-2">
                                        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                                            className="bg-slate-900 border border-slate-600 text-slate-300 text-xs rounded px-2 py-1 w-full" />
                                        <span className="text-slate-500 text-xs">→</span>
                                        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                                            className="bg-slate-900 border border-slate-600 text-slate-300 text-xs rounded px-2 py-1 w-full" />
                                    </div>
                                    <button onClick={applyCustom}
                                        className="w-full mt-2 bg-blue-600 hover:bg-blue-500 text-foreground text-xs font-bold px-3 py-1.5 rounded-lg transition">
                                        Áp dụng
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                    <span className="flex items-center gap-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-bold">
                        <Zap className="h-3 w-3" /> LIVE • Direct API
                    </span>
                    <label className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
                        <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-emerald-500 w-3 h-3" />
                        Auto 60s
                    </label>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-right text-[10px] text-slate-400">
                        <div>Synced: <span className="text-emerald-400 font-mono">{syncedAt?.toLocaleTimeString() || '--'}</span></div>
                        {data && <div className="text-slate-500">{data.source} • {data.duration_ms}ms • {rawSummary?.accounts_fetched}TK • {rawSummary?.shops_fetched}shops</div>}
                    </div>
                    <button onClick={() => fetchData()} disabled={loading}
                        className="bg-blue-600 hover:bg-blue-500 text-foreground px-3 py-1.5 rounded-lg text-xs font-bold shadow-lg shadow-blue-500/20 border border-blue-500 flex items-center gap-1 transition disabled:opacity-50">
                        <RotateCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> SYNC
                    </button>
                </div>
            </header>

            {/* ═══ EXCHANGE RATE ═══ */}
            <div className="shrink-0 px-4 py-1.5 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700 flex items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Tỷ giá:</span>
                <span>1 USD = <b className="text-blue-600 dark:text-blue-400">{USD_TO_VND.toLocaleString()}</b> VND</span>
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <span>1 RON = <b className="text-emerald-600 dark:text-emerald-400">{RON_TO_VND.toLocaleString()}</b> VND</span>
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <span>1 EUR = <b className="text-amber-600 dark:text-amber-400">{EUR_TO_VND.toLocaleString()}</b> VND</span>
            </div>

            {/* ═══ FILTER BAR ═══ */}
            <div className="shrink-0 px-4 py-2 bg-white dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    <Search className="h-3.5 w-3.5" /> Bộ lọc
                </div>

                {/* Market filter (chips) */}
                <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg p-0.5">
                    {(["ALL", ...MARKETS] as const).map(m => {
                        const active = marketFilter === m;
                        const count = m === "ALL"
                            ? (data?.campaigns.length || 0)
                            : (data?.campaigns.filter(c => detectMarket(c.campaign_name) === m).length || 0);
                        return (
                            <button key={m} onClick={() => setMarketFilter(m)}
                                title={m === "ALL" ? "Tất cả thị trường" : MARKET_LABELS[m as Market]}
                                className={cn("px-2.5 py-1 rounded-md text-[11px] font-semibold transition flex items-center gap-1",
                                    active
                                        ? "bg-amber-500 text-white shadow-sm"
                                        : "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700")}>
                                {m === "ALL" ? "🌍" : MARKET_FLAGS[m as Market]} {m}
                                <span className={cn("text-[9px] font-mono px-1 rounded",
                                    active ? "bg-white/25 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-500")}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Marketer filter */}
                <div className="relative flex items-center">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 pointer-events-none">
                        <User className="h-3 w-3" /> Marketer
                    </span>
                    <input
                        type="text"
                        placeholder=""
                        value={marketerFilter}
                        onChange={e => setMarketerFilter(e.target.value)}
                        className="bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg pl-[72px] pr-7 py-1.5 text-xs text-slate-700 dark:text-slate-200 w-56 focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 focus:outline-none transition"
                    />
                    {marketerFilter && (
                        <button onClick={() => setMarketerFilter("")}
                            title="Xoá lọc marketer"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500 transition">
                            <X className="h-3 w-3" />
                        </button>
                    )}
                </div>

                {/* Product filter */}
                <div className="relative flex items-center">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 pointer-events-none">
                        <Package className="h-3 w-3" /> Sản phẩm
                    </span>
                    <input
                        type="text"
                        placeholder=""
                        value={productFilter}
                        onChange={e => setProductFilter(e.target.value)}
                        className="bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg pl-[76px] pr-7 py-1.5 text-xs text-slate-700 dark:text-slate-200 w-56 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30 focus:outline-none transition"
                    />
                    {productFilter && (
                        <button onClick={() => setProductFilter("")}
                            title="Xoá lọc sản phẩm"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500 transition">
                            <X className="h-3 w-3" />
                        </button>
                    )}
                </div>

                {/* Active filter chips + reset */}
                {(marketerFilter || productFilter || marketFilter !== "ALL") && (
                    <>
                        <span className="text-slate-300 dark:text-slate-600">|</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                            Hiển thị <b className="text-blue-600 dark:text-blue-400">{campaigns.length}</b> campaign
                        </span>
                        <button onClick={() => { setMarketerFilter(""); setProductFilter(""); setMarketFilter("ALL"); }}
                            className="ml-auto flex items-center gap-1 text-[10px] text-rose-500 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300 transition">
                            <X className="h-3 w-3" /> Xoá tất cả
                        </button>
                    </>
                )}
            </div>

            {/* ═══ SUMMARY CARDS ═══ */}
            {summary && (
                <div className="shrink-0 border-b border-slate-200 dark:border-slate-700">
                    {/* Row 1: Key metrics */}
                    <div className="grid grid-cols-5 gap-px bg-slate-200 dark:bg-slate-700">
                        <div className="p-4 bg-white dark:bg-slate-800">
                            <div className="text-slate-500 dark:text-slate-400 text-xs font-medium mb-1">Ads Spend</div>
                            <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white">{formatVND(spendVnd)}đ</div>
                            <div className="text-xs text-slate-400 mt-1">${(summary?.total_spend || 0).toFixed(0)} USD</div>
                        </div>
                        <div className="p-4 bg-white dark:bg-slate-800">
                            <div className="text-purple-600 dark:text-purple-400 text-xs font-medium mb-1">Purchase Meta</div>
                            <div className="text-2xl font-bold font-mono text-purple-600 dark:text-purple-400">{summary.total_meta_purchases}</div>
                            <div className="text-xs text-slate-400 mt-1">Từ Meta API</div>
                        </div>
                        <div className="p-4 bg-white dark:bg-slate-800">
                            <div className="text-blue-600 dark:text-blue-400 text-xs font-medium mb-1">Đơn POS</div>
                            <div className="text-2xl font-bold font-mono text-blue-600 dark:text-blue-400">{summary.total_pos_orders}</div>
                            <div className="text-xs text-slate-400 mt-1">Match: {summary.total_matched_orders} | Chưa: {summary.unmatched_orders}</div>
                        </div>
                        <div className="p-4 bg-white dark:bg-slate-800">
                            <div className="text-emerald-600 dark:text-emerald-400 text-xs font-medium mb-1">Doanh thu ({summary.total_pos_orders} đơn)</div>
                            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">{formatVND(revVnd)}đ</div>
                            <div className="text-xs text-slate-400 mt-1">{summary.total_matched_orders || summary.matched_orders} match</div>
                        </div>
                        <div className="p-4 bg-white dark:bg-slate-800">
                            <div className="text-amber-600 dark:text-amber-400 text-xs font-medium mb-1">ROAS (100%)</div>
                            <div className={`text-2xl font-bold font-mono ${(spendVnd > 0 ? revVnd / spendVnd : 0) >= 2.5 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                {spendVnd > 0 ? (revVnd / spendVnd).toFixed(2) : '0.00'}x
                            </div>
                        </div>
                    </div>
                    {/* Row 2: Projected */}
                    <div className="grid grid-cols-5 gap-px bg-slate-200 dark:bg-slate-700">
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/60">
                            <div className="text-slate-500 text-xs font-medium mb-1">Messages</div>
                            <div className="text-xl font-bold font-mono text-indigo-600 dark:text-indigo-400">{summary.total_messages}</div>
                            <div className="text-xs text-slate-400 mt-0.5">CPA: {summary.total_messages > 0 ? `${formatVND(usdToVnd(summary.total_spend / summary.total_messages))}đ` : '-'}</div>
                        </div>
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/60">
                            <div className="text-teal-600 dark:text-teal-400 text-xs font-medium mb-1 flex items-center gap-1">
                                <Target className="h-3.5 w-3.5" /> DT Dự kiến (56%)
                            </div>
                            <div className="text-xl font-bold font-mono text-teal-600 dark:text-teal-400">{formatVND(projectedRev)}đ</div>
                        </div>
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/60">
                            <div className="text-teal-600 dark:text-teal-400 text-xs font-medium mb-1 flex items-center gap-1">
                                <TrendingUp className="h-3.5 w-3.5" /> ROAS Dự kiến (56%)
                            </div>
                            <div className={`text-xl font-bold font-mono ${projectedRoas >= 2.5 ? 'text-emerald-600 dark:text-emerald-400' : projectedRoas > 1 ? 'text-teal-600 dark:text-teal-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {projectedRoas.toFixed(2)}x
                            </div>
                        </div>
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/60">
                            <div className={`text-xs font-medium mb-1 ${projectedProfit >= 0 ? 'text-teal-600 dark:text-teal-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                Lãi/Lỗ Dự kiến (56%)
                            </div>
                            <div className={`text-xl font-bold font-mono ${projectedProfit >= 0 ? 'text-teal-600 dark:text-teal-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {formatVND(projectedProfit)}đ
                            </div>
                        </div>
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/60">
                            <div className={`text-xs font-medium mb-1 ${(revVnd - spendVnd) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                Lãi/Lỗ (100%)
                            </div>
                            <div className={`text-xl font-bold font-mono ${(revVnd - spendVnd) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {formatVND(revVnd - spendVnd)}đ
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ CAPI PUSH PANEL — hidden, kept for future use ═══ */}
            {false && capiStatus && (
                <div className="shrink-0 px-4 py-2.5 bg-white dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <Radio className="h-4 w-4 text-violet-500" />
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">Meta CAPI</span>
                                {capiStatus?.pixel_id && <span className="text-[10px] font-mono text-slate-400">Pixel: {capiStatus?.pixel_id}</span>}
                            </div>
                            <div className="flex items-center gap-3 text-xs">
                                <span className="text-slate-500">
                                    POS confirmed: <b className="text-blue-500 dark:text-blue-400">{capiStatus?.total_confirmed_orders}</b>
                                </span>
                                <span className="text-slate-500">
                                    Pushed: <b className="text-emerald-500 dark:text-emerald-400">{capiStatus?.already_pushed}</b>
                                </span>
                                {(capiStatus?.pending_push ?? 0) > 0 ? (
                                    <span className="bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-bold text-[11px]">
                                        {capiStatus!.pending_push} pending ({capiStatus!.total_value_pending.toFixed(0)} RON)
                                    </span>
                                ) : (
                                    <span className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full font-bold text-[11px]">
                                        All synced
                                    </span>
                                )}
                                {capiStatus?.last_push_at && (
                                    <span className="text-[10px] text-slate-400">
                                        Last push: {new Date(capiStatus!.last_push_at as string).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {capiResult && (
                                <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded",
                                    capiResult!.status === "SUCCESS" ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" :
                                    capiResult!.status === "DRY_RUN" ? "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400" :
                                    capiResult!.status === "SKIPPED" ? "bg-slate-100 dark:bg-slate-700 text-slate-500" :
                                    "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400")}>
                                    {capiResult!.status === "SUCCESS" ? `Pushed ${capiResult!.events_pushed} events` :
                                     capiResult!.status === "DRY_RUN" ? `Preview: ${capiResult!.order_count} orders` :
                                     capiResult!.status === "SKIPPED" ? "No pending orders" :
                                     capiResult!.errors?.[0]?.slice(0, 60) || "Error"}
                                </span>
                            )}
                            <button onClick={() => pushToMetaCAPI(true)} disabled={capiPushing || !(capiStatus?.pending_push)}
                                className="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition disabled:opacity-40">
                                Preview
                            </button>
                            <button onClick={() => {
                                if (!confirm(`Push ${capiStatus?.pending_push} Purchase events to Meta CAPI?\nPixel: ${capiStatus?.pixel_id}\nValue: ${capiStatus?.total_value_pending?.toFixed(0)} RON`)) return;
                                pushToMetaCAPI(false);
                            }} disabled={capiPushing || !(capiStatus?.pending_push)}
                                className="bg-violet-600 hover:bg-violet-500 text-white px-3 py-1 rounded-lg text-[11px] font-bold shadow-lg shadow-violet-500/20 border border-violet-500 flex items-center gap-1.5 transition disabled:opacity-40">
                                <Upload className={cn("h-3 w-3", capiPushing && "animate-spin")} />
                                {capiPushing ? "Pushing..." : `Push ${capiStatus?.pending_push ?? 0} to Meta`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ DAILY TREND CHART ═══ */}
            {/* Filter-aware: per-SKU when productCode resolves, per-marketer (campaign-name
                substring match) otherwise; falls back to total dailyTrend with no filter. */}
            {filteredDailyTrend.length > 0 && (
                <div className="shrink-0 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                        <BarChart2 className="h-3.5 w-3.5 text-blue-500" />
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Daily Spend × ROAS</span>
                        <span className="text-[10px] text-slate-400">
                            {productCode
                                ? `(VND • SKU: ${productCode})`
                                : marketerFilter.trim()
                                    ? `(VND • Marketer: "${marketerFilter.trim()}")`
                                    : "(VND • toàn bộ)"}
                        </span>
                    </div>
                    <ResponsiveContainer width="100%" height={180}>
                        <ComposedChart data={filteredDailyTrend} margin={{ top: 5, right: 45, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-700" vertical={false} />
                            <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                            <YAxis yAxisId="vnd" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false}
                                tickFormatter={(v) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}tr` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}`} width={45} />
                            <YAxis yAxisId="roas" orientation="right" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false}
                                tickFormatter={(v) => `${Number(v).toFixed(1)}x`} width={40} />
                            <Tooltip
                                contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                                labelStyle={{ color: "#94a3b8" }}
                                formatter={(v: any, name: string) => {
                                    if (name === "ROAS") return [`${Number(v).toFixed(2)}x`, name];
                                    if (name === "Đơn hàng") return [Number(v).toLocaleString(), name];
                                    return [`${formatVND(Number(v))}đ`, name];
                                }}
                            />
                            <Legend iconSize={8} wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
                            <Bar yAxisId="vnd" dataKey="spend_vnd" name="Ads Spend" fill="#f59e0b" radius={[3, 3, 0, 0]} opacity={0.8} />
                            <Line yAxisId="roas" type="monotone" dataKey="roas" name="ROAS" stroke="#10b981" strokeWidth={2}
                                dot={{ fill: "#10b981", r: 3 }} activeDot={{ r: 5 }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* ═══ MAIN CONTENT ═══ */}
            <main className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-900 p-4 space-y-4">
                {error && (
                    <div className="flex items-center gap-3 bg-rose-950/50 border border-rose-800 rounded-xl p-3 text-rose-300">
                        <AlertTriangle className="h-5 w-5 shrink-0" />
                        <div className="flex-1">
                            <div className="font-semibold text-sm">Failed to load</div>
                            <div className="text-xs text-rose-400/80">{error}</div>
                        </div>
                        <button onClick={() => fetchData()} className="bg-rose-800 hover:bg-rose-700 px-3 py-1 rounded text-xs text-foreground">Retry</button>
                    </div>
                )}

                {/* Meta API Token/Access Warning */}
                {data?.meta_status && !data.meta_status.token_valid && (
                    <div className="flex items-center gap-3 bg-amber-950/50 border border-amber-700 rounded-xl p-3 text-amber-300">
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
                        <div className="flex-1">
                            <div className="font-bold text-sm text-amber-200">
                                ⚠️ Meta API Token bị chặn (Error {data.meta_status.error_code})
                            </div>
                            <div className="text-xs text-amber-400/80 mt-0.5">
                                {data.meta_status.error_message || 'API access blocked'}
                            </div>
                            <div className="text-[10px] text-amber-500/70 mt-1">
                                {data.meta_status.accounts_blocked.length > 0 && (
                                    <span>TK bị chặn: {data.meta_status.accounts_blocked.map(a => getAccountName(a)).join(', ')} • </span>
                                )}
                                Cần tạo lại token trong Meta Business Settings → System Users
                            </div>
                        </div>
                    </div>
                )}

                {data?.meta_status && data.meta_status.token_valid && data.meta_status.accounts_blocked.length > 0 && (
                    <div className="flex items-center gap-3 bg-amber-950/30 border border-amber-800/50 rounded-xl p-2.5 text-amber-400">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <div className="text-xs">
                            <span className="font-semibold">Một số TK quảng cáo bị chặn: </span>
                            {data.meta_status.accounts_blocked.map(a => getAccountName(a)).join(', ')}
                            {data.meta_status.rate_limit_pct && data.meta_status.rate_limit_pct > 50 && (
                                <span className="ml-2 text-orange-400">• Rate limit: {data.meta_status.rate_limit_pct}%</span>
                            )}
                        </div>
                    </div>
                )}

                {loading && !data ? (
                    <div className="flex items-center justify-center h-64 text-slate-500 animate-pulse text-lg">
                        <Zap className="h-6 w-6 mr-2 text-blue-500 animate-bounce" />
                        Đang tải realtime từ Meta + POS...
                    </div>
                ) : Object.keys(grouped).length === 0 && data ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
                        <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center">
                            <AlertTriangle className="h-7 w-7 text-amber-400" />
                        </div>
                        <div>
                            <div className="text-slate-300 font-semibold text-base mb-1">Không có dữ liệu campaign từ Meta API</div>
                            <div className="text-slate-500 text-sm max-w-md">
                                Token Meta bị block — cần tạo lại tại <span className="text-amber-400 font-mono text-xs">Meta Business Settings → System Users</span>
                            </div>
                            <div className="text-slate-600 text-xs mt-2">
                                Dữ liệu lịch sử (BigQuery) vẫn khả dụng — chọn khoảng thời gian &gt; 1 ngày để xem biểu đồ Spend
                            </div>
                        </div>
                        <button onClick={() => applyPreset(DATE_PRESETS[3])}
                            className="bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 px-4 py-2 rounded-lg text-sm transition">
                            Xem 7 ngày gần đây (BQ)
                        </button>
                    </div>
                ) : (
                    Object.entries(grouped).map(([accId, accCampaigns]) => {
                        const accSpend = accCampaigns.reduce((s, c) => s + c.spend, 0);
                        const accRevenue = accCampaigns.reduce((s, c) => s + c.revenue_ron, 0);
                        const accOrders = accCampaigns.reduce((s, c) => s + c.orders, 0);
                        const accPurchases = accCampaigns.reduce((s, c) => s + c.purchases, 0);
                        const accRoas = calcRoas(accRevenue, accSpend);

                        return (
                            <div key={accId} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden shadow-sm">
                                {/* Account header */}
                                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between sticky top-0 z-20">
                                    <div className="flex items-center gap-3">
                                        <div className="w-1.5 h-7 bg-blue-600 dark:bg-blue-500 rounded-full" />
                                        <div>
                                            <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">{getAccountName(accId)}</h2>
                                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                                {accCampaigns.length} campaigns • Spend: <span className="text-foreground font-mono">{formatVND(usdToVnd(accSpend))}đ</span>
                                                {accOrders > 0 && <> • POS: <span className="text-emerald-400 font-mono">{accOrders}</span></>}
                                                {accPurchases > 0 && <> • Meta: <span className="text-purple-400 font-mono">{accPurchases}</span></>}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4 text-[10px]">
                                        <span className="text-slate-500 text-xs">ROAS: <b className={accRoas > 2.5 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{accRoas.toFixed(2)}</b></span>
                                        {accRevenue > 0 && <span className="text-slate-500 text-xs">DT: <b className="text-emerald-600 dark:text-emerald-400">{formatVND(ronToVnd(accRevenue))}đ</b></span>}
                                    </div>
                                </div>

                                {/* Campaign table */}
                                <div className="overflow-auto max-h-[600px]">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/80 sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700">
                                            <tr>
                                                <th className="px-3 py-2.5 w-6"></th>
                                                <th className="px-3 py-2.5">Campaign</th>
                                                <th className="px-3 py-2.5 text-center">Status</th>
                                                <th className="px-3 py-2.5 text-right">Spend (VND)</th>
                                                <th className="px-3 py-2.5 text-right">CPM / CTR</th>
                                                <th className="px-3 py-2.5 text-right">MSG</th>
                                                <th className="px-3 py-2.5 text-right text-purple-600 dark:text-purple-300">CPA Purchase</th>
                                                <th className="px-3 py-2.5 text-right text-purple-600 dark:text-purple-300">META</th>
                                                <th className="px-3 py-2.5 text-right text-emerald-600 dark:text-emerald-300">POS</th>
                                                <th className="px-3 py-2.5 text-right text-emerald-600 dark:text-emerald-300">DT</th>
                                                <th className="px-3 py-2.5 text-right text-emerald-600 dark:text-emerald-300">ROAS</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                            {accCampaigns.map(c => {
                                                const isExpanded = expandedCampaign === c.campaign_id;
                                                return (
                                                    <>
                                                        {/* Campaign row */}
                                                        <tr key={c.campaign_id}
                                                            onClick={() => toggleCampaign(c.campaign_id)}
                                                            className="hover:bg-blue-50 dark:hover:bg-slate-700/30 transition cursor-pointer group">
                                                            <td className="px-3 py-3 text-slate-400">
                                                                {isExpanded
                                                                    ? <ChevronDown className="h-3.5 w-3.5 text-blue-400" />
                                                                    : <ChevronRight className="h-3.5 w-3.5 group-hover:text-blue-400" />}
                                                            </td>
                                                            <td className="px-3 py-3">
                                                                <div className="text-sm text-slate-800 dark:text-slate-100 max-w-[300px] whitespace-normal leading-snug font-medium">{c.campaign_name}</div>
                                                                <div className="text-xs text-slate-400 mt-0.5">{c.ads_count} ads</div>
                                                            </td>
                                                            <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
                                                                {(() => {
                                                                    const st = c.campaign_status || "UNKNOWN";
                                                                    const isToggling = togglingCampaign === c.campaign_id;
                                                                    if (st === "ACTIVE") return (
                                                                        <button onClick={() => toggleCampaignStatus(c.campaign_id, st)} disabled={isToggling}
                                                                            title="Click để tắt campaign"
                                                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-500/30 transition cursor-pointer">
                                                                            <span className={cn("w-1.5 h-1.5 rounded-full bg-emerald-500", isToggling ? "animate-spin" : "animate-pulse")} /> {isToggling ? "..." : "Active"}
                                                                        </button>
                                                                    );
                                                                    if (st === "PAUSED") return (
                                                                        <button onClick={() => toggleCampaignStatus(c.campaign_id, st)} disabled={isToggling}
                                                                            title="Click để bật campaign"
                                                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-500/30 transition cursor-pointer">
                                                                            <span className={cn("w-1.5 h-1.5 rounded-full bg-amber-500", isToggling && "animate-spin")} /> {isToggling ? "..." : "Paused"}
                                                                        </button>
                                                                    );
                                                                    return (
                                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-500">
                                                                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> {st.charAt(0) + st.slice(1).toLowerCase()}
                                                                        </span>
                                                                    );
                                                                })()}
                                                            </td>
                                                            <td className="px-3 py-3 text-right font-mono text-sm text-slate-700 dark:text-slate-200 font-semibold">{formatVND(usdToVnd(c.spend))}đ</td>
                                                            <td className="px-3 py-3 text-right font-mono text-xs">
                                                                <div className="text-slate-500 dark:text-slate-400">CPM: {formatVND(usdToVnd(c.cpm))}đ</div>
                                                                <div className="text-indigo-600 dark:text-indigo-400 font-medium">CTR: {c.ctr.toFixed(2)}%</div>
                                                            </td>
                                                            <td className="px-3 py-3 text-right font-mono text-sm text-indigo-600 dark:text-indigo-400">{c.messages || 0}</td>
                                                            <td className="px-3 py-3 text-right font-mono text-sm text-purple-600 dark:text-purple-300">
                                                                {c.purchases > 0 ? `${formatVND(usdToVnd(c.spend / c.purchases))}đ` : '–'}
                                                            </td>
                                                            <td className={cn("px-3 py-3 text-right font-mono text-sm font-bold",
                                                                c.purchases > 0 ? 'text-purple-600 dark:text-purple-400' : 'text-slate-300 dark:text-slate-600')}>{c.purchases || 0}</td>
                                                            <td className={cn("px-3 py-3 text-right font-mono text-sm font-bold",
                                                                c.orders > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300 dark:text-slate-600')}>{c.orders}</td>
                                                            <td className={cn("px-3 py-3 text-right font-mono text-sm",
                                                                c.revenue_ron > 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-slate-300 dark:text-slate-600')}>
                                                                {c.revenue_ron > 0 ? `${formatVND(ronToVnd(c.revenue_ron))}đ` : '–'}
                                                            </td>
                                                            {(() => {
                                                                const roas = calcRoas(c.revenue_ron, c.spend);
                                                                return (
                                                                    <td className={cn("px-3 py-3 text-right font-mono text-sm font-bold",
                                                                        roas > 2.5 ? 'text-emerald-600 dark:text-emerald-400' : roas > 0 ? 'text-rose-500 dark:text-rose-400' : 'text-slate-300 dark:text-slate-600')}>
                                                                        {roas > 0 ? roas.toFixed(2) : '–'}
                                                                    </td>
                                                                );
                                                            })()}
                                                        </tr>

                                                        {/* Expanded: Level 2 — Ad Sets */}
                                                        {isExpanded && (() => {
                                                            // Group ads by adset
                                                            const adsetMap = new Map<string, { id: string; name: string; status: string; ads: AdDetail[]; spend: number; impressions: number; cpm: number; ctr: number; messages: number; purchases: number; orders: number; revenue_ron: number }>();
                                                            c.ads.forEach((ad: AdDetail) => {
                                                                const key = ad.adset_name || ad.ad_id;
                                                                const existing = adsetMap.get(key);
                                                                if (existing) {
                                                                    existing.ads.push(ad);
                                                                    existing.spend += ad.spend;
                                                                    existing.impressions += ad.impressions;
                                                                    existing.messages += (ad.messages || 0);
                                                                    existing.purchases += (ad.purchases || 0);
                                                                    existing.orders += (ad.orders || 0);
                                                                    existing.revenue_ron += (ad.revenue_ron || 0);
                                                                } else {
                                                                    adsetMap.set(key, {
                                                                        id: ad.adset_id || ad.adset_name || ad.ad_id,
                                                                        name: ad.adset_name || 'Unknown',
                                                                        status: ad.adset_status || 'UNKNOWN',
                                                                        ads: [ad],
                                                                        spend: ad.spend, impressions: ad.impressions,
                                                                        cpm: 0, ctr: 0,
                                                                        messages: ad.messages || 0, purchases: ad.purchases || 0,
                                                                        orders: ad.orders || 0, revenue_ron: ad.revenue_ron || 0,
                                                                    });
                                                                }
                                                            });
                                                            return Array.from(adsetMap.values()).sort((a, b) => b.spend - a.spend).map(adset => {
                                                                const adsetKey = `${c.campaign_id}__${adset.id}`;
                                                                const isAdsetExpanded = expandedAdset === adsetKey;
                                                                const adsetCpm = adset.impressions > 0 ? adset.spend / adset.impressions * 1000 : 0;
                                                                const adsetCtr = adset.impressions > 0 ? (adset.ads.reduce((s, a) => s + (a.impressions > 0 ? a.ctr * a.impressions : 0), 0) / adset.impressions) : 0;
                                                                const adsetRoas = calcRoas(adset.revenue_ron, adset.spend);
                                                                // If status came back UNKNOWN, infer from children: any ACTIVE child ⇒ adset is ACTIVE.
                                                                // Effective status would propagate down (ADSET_PAUSED) if the adset itself were paused.
                                                                const rawStatus = adset.status || "UNKNOWN";
                                                                const adsetStatus = rawStatus === "UNKNOWN" && adset.ads.some(a => a.ad_status === "ACTIVE")
                                                                    ? "ACTIVE"
                                                                    : rawStatus;
                                                                return (
                                                                    <React.Fragment key={adsetKey}>
                                                                        {/* Ad Set row */}
                                                                        <tr onClick={() => setExpandedAdset(isAdsetExpanded ? null : adsetKey)}
                                                                            className="bg-blue-50/50 dark:bg-slate-800/60 border-l-2 border-blue-400/40 hover:bg-blue-100/50 dark:hover:bg-slate-700/40 transition cursor-pointer group">
                                                                            <td className="px-3 py-2 pl-6 text-slate-400">
                                                                                {isAdsetExpanded
                                                                                    ? <ChevronDown className="h-3 w-3 text-blue-400" />
                                                                                    : <ChevronRight className="h-3 w-3 group-hover:text-blue-400" />}
                                                                            </td>
                                                                            <td className="px-3 py-2">
                                                                                <div className="text-xs text-slate-700 dark:text-slate-200 max-w-[280px] whitespace-normal leading-snug font-medium">📦 {adset.name}</div>
                                                                                <div className="text-[10px] text-slate-400 mt-0.5">{adset.ads.length} ads</div>
                                                                            </td>
                                                                            <td className="px-3 py-2 text-center">
                                                                                <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold",
                                                                                    adsetStatus === "ACTIVE" ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" : "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400")}>
                                                                                    <span className={cn("w-1.5 h-1.5 rounded-full", adsetStatus === "ACTIVE" ? "bg-emerald-500" : "bg-amber-500")} />
                                                                                    {adsetStatus === "ACTIVE" ? "Active" : "Paused"}
                                                                                </span>
                                                                            </td>
                                                                            <td className="px-3 py-2 text-right font-mono text-xs text-slate-600 dark:text-slate-300 font-semibold">{formatVND(usdToVnd(adset.spend))}đ</td>
                                                                            <td className="px-3 py-2 text-right font-mono text-[10px]">
                                                                                <div className="text-slate-400">CPM: {formatVND(usdToVnd(adsetCpm))}đ</div>
                                                                                <div className="text-indigo-500 dark:text-indigo-400/70">CTR: {adsetCtr.toFixed(2)}%</div>
                                                                            </td>
                                                                            <td className="px-3 py-2 text-right font-mono text-xs text-indigo-500/70">{adset.messages || 0}</td>
                                                                            <td className="px-3 py-2 text-right font-mono text-xs text-purple-500/70">
                                                                                {adset.purchases > 0 ? `${formatVND(usdToVnd(adset.spend / adset.purchases))}đ` : '–'}
                                                                            </td>
                                                                            <td className={cn("px-3 py-2 text-right font-mono text-xs", adset.purchases > 0 ? 'text-purple-600 dark:text-purple-400' : 'text-slate-300 dark:text-slate-600')}>{adset.purchases || 0}</td>
                                                                            <td className={cn("px-3 py-2 text-right font-mono text-xs font-bold", adset.orders > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300 dark:text-slate-600')}>{adset.orders}</td>
                                                                            <td className={cn("px-3 py-2 text-right font-mono text-xs", adset.revenue_ron > 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-slate-300 dark:text-slate-600')}>
                                                                                {adset.revenue_ron > 0 ? `${formatVND(ronToVnd(adset.revenue_ron))}đ` : '–'}
                                                                            </td>
                                                                            <td className={cn("px-3 py-2 text-right font-mono text-xs font-semibold",
                                                                                adsetRoas > 2.5 ? 'text-emerald-600 dark:text-emerald-400' : adsetRoas > 0 ? 'text-rose-500 dark:text-rose-400' : 'text-slate-300 dark:text-slate-600')}>
                                                                                {adsetRoas > 0 ? adsetRoas.toFixed(2) : '–'}
                                                                            </td>
                                                                        </tr>
                                                                        {/* Level 3 — Individual Ads */}
                                                                        {isAdsetExpanded && adset.ads.sort((a, b) => b.spend - a.spend).map((ad: AdDetail) => {
                                                                            const adRoas = calcRoas(ad.revenue_ron, ad.spend);
                                                                            const adSt = ad.ad_status || "UNKNOWN";
                                                                            return (
                                                                                <tr key={ad.ad_id} className="bg-slate-50 dark:bg-slate-900/80 border-l-4 border-indigo-400/30">
                                                                                    <td className="px-3 py-1.5"></td>
                                                                                    <td className="px-3 py-1.5 pl-12">
                                                                                        <div className="text-[11px] text-slate-500 dark:text-slate-400 max-w-[260px] whitespace-normal leading-snug">🎯 {ad.ad_name}</div>
                                                                                    </td>
                                                                                    <td className="px-3 py-1.5 text-center">
                                                                                        <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold",
                                                                                            adSt === "ACTIVE" ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400")}>
                                                                                            <span className={cn("w-1 h-1 rounded-full", adSt === "ACTIVE" ? "bg-emerald-500" : "bg-amber-500")} />
                                                                                            {adSt === "ACTIVE" ? "Active" : adSt === "PAUSED" ? "Paused" : adSt.charAt(0) + adSt.slice(1).toLowerCase()}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td className="px-3 py-1.5 text-right font-mono text-[11px] text-slate-500 dark:text-slate-400">{formatVND(usdToVnd(ad.spend))}đ</td>
                                                                                    <td className="px-3 py-1.5 text-right font-mono text-[10px]">
                                                                                        <div className="text-slate-400">CPM: {formatVND(usdToVnd(ad.cpm))}đ</div>
                                                                                        <div className="text-indigo-500/70">CTR: {ad.ctr.toFixed(2)}%</div>
                                                                                    </td>
                                                                                    <td className="px-3 py-1.5 text-right font-mono text-[11px] text-indigo-500/60">{ad.messages || 0}</td>
                                                                                    <td className="px-3 py-1.5 text-right font-mono text-[11px] text-purple-500/60">
                                                                                        {ad.purchases > 0 ? `${formatVND(usdToVnd(ad.spend / ad.purchases))}đ` : '–'}
                                                                                    </td>
                                                                                    <td className={cn("px-3 py-1.5 text-right font-mono text-[11px]", ad.purchases > 0 ? 'text-purple-500' : 'text-slate-300 dark:text-slate-600')}>{ad.purchases || 0}</td>
                                                                                    <td className={cn("px-3 py-1.5 text-right font-mono text-[11px]", ad.orders > 0 ? 'text-emerald-500 font-bold' : 'text-slate-300 dark:text-slate-600')}>{ad.orders}</td>
                                                                                    <td className={cn("px-3 py-1.5 text-right font-mono text-[11px]", ad.revenue_ron > 0 ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600')}>
                                                                                        {ad.revenue_ron > 0 ? `${formatVND(ronToVnd(ad.revenue_ron))}đ` : '–'}
                                                                                    </td>
                                                                                    <td className={cn("px-3 py-1.5 text-right font-mono text-[11px] font-semibold",
                                                                                        adRoas > 2.5 ? 'text-emerald-500' : adRoas > 0 ? 'text-rose-400' : 'text-slate-300 dark:text-slate-600')}>
                                                                                        {adRoas > 0 ? adRoas.toFixed(2) : '–'}
                                                                                    </td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </React.Fragment>
                                                                );
                                                            });
                                                        })()}
                                                    </>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })
                )}

                {/* Unmatched Orders */}
                {data && data.unmatched_by_shop && Object.keys(data.unmatched_by_shop).length > 0 && (
                    <div className="rounded-xl border border-amber-200 dark:border-slate-700 bg-amber-50 dark:bg-slate-800 p-4">
                        <h3 className="text-xs font-bold text-amber-400 mb-2">
                            ⚠️ Đơn chưa match ad_id — {data.summary.unmatched_orders} đơn • {formatVND(ronToVnd(data.summary.unmatched_revenue_ron))}đ
                        </h3>
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                            {Object.entries(data.unmatched_by_shop)
                                .sort(([, a], [, b]) => b.revenue_ron - a.revenue_ron)
                                .map(([shop, info]) => (
                                    <div key={shop} className="bg-slate-800 rounded-lg p-2.5 border border-slate-700">
                                        <div className="text-foreground font-bold text-xs">{shop}</div>
                                        <div className="text-emerald-400 font-mono text-sm font-bold">{formatVND(ronToVnd(info.revenue_ron))}đ</div>
                                        <div className="text-slate-500 text-[10px]">{info.count} đơn</div>
                                    </div>
                                ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
