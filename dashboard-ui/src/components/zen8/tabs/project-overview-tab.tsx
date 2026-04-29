"use client";

import { useEffect, useState, useRef } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, PieChart, Pie, Cell,
} from "recharts";
import { cn } from "@/lib/utils";
import { DATASET, CURRENCY_TO_VND, REVENUE_COL, FX_TO_VND, POS_TIMEZONE, pageMktCTE } from "../constants";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { resolveMarketerName, isRealMarketer } from "@/lib/marketer-map";

// ── Theme colors (matching superbot dark) ──
const C = {
    bg:        "#0f172a",
    card:      "#1e293b",
    cardAlt:   "#162032",
    border:    "#334155",
    text:      "#f1f5f9",
    textMuted: "#94a3b8",
    textDim:   "#64748b",
    green:     "#22c55e",
    blue:      "#3b82f6",
    purple:    "#a855f7",
    amber:     "#f59e0b",
    cyan:      "#06b6d4",
    rose:      "#f43f5e",
    orange:    "#f97316",
    teal:      "#14b8a6",
};

const TOOLTIP_STYLE = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text };

const USD_TO_VND = FX_TO_VND.USD;
const fmtVND = (v: number) => v >= 1_000_000_000 ? `${(v / 1_000_000_000).toFixed(1)}B` : v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : `${v.toFixed(0)}`;
const fmtFull = (v: number) => new Intl.NumberFormat("vi-VN").format(Math.round(v));

const MARKET_COLORS: Record<string, string> = { KSA: C.blue, UAE: C.green, KWT: C.purple, AUS: C.amber, Unknown: C.textDim };
const MARKET_LABELS: Record<string, string> = { KSA: "KSA SA", UAE: "UAE AE", KWT: "KWT KW", AUS: "AUS AU" };
const PODIUM_COLORS = [C.amber, "#6b7280", "#a16207"];

interface Props { dateRange?: { from: Date; to: Date } }

async function runQuery(q: string) {
    return fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }).then(r => r.json()).then(r => r.data || []).catch(() => []);
}

const MARKETS_ALL = ["KSA", "UAE", "KWT", "AUS"];
const MKTERS_ALL = ["NHAMHT", "LYVLN", "HUYTN", "DUNGNH", "TAIHH", "TUNPT", "LINHLTT", "VUONGNM"];

const TIME_PRESETS: { label: string; from: () => string; to: () => string }[] = [
    { label: "Hom nay", from: () => format(new Date(), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Hom qua", from: () => { const d = new Date(); d.setDate(d.getDate() - 1); return format(d, "yyyy-MM-dd"); }, to: () => { const d = new Date(); d.setDate(d.getDate() - 1); return format(d, "yyyy-MM-dd"); } },
    { label: "7 ngay", from: () => { const d = new Date(); d.setDate(d.getDate() - 6); return format(d, "yyyy-MM-dd"); }, to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Thang nay", from: () => format(new Date(), "yyyy-MM-01"), to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Thang truoc", from: () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return format(d, "yyyy-MM-01"); }, to: () => { const d = new Date(); d.setDate(0); return format(d, "yyyy-MM-dd"); } },
    { label: "Tuy chinh", from: () => "", to: () => "" },
];

export default function ProjectOverviewTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [kpis, setKpis] = useState<any>(null);
    const [dailyRevenue, setDailyRevenue] = useState<any[]>([]);
    const [dailyOrders, setDailyOrders] = useState<any[]>([]);
    const [dailyPct, setDailyPct] = useState<any[]>([]);
    const [byMarket, setByMarket] = useState<any[]>([]);
    const [byMkter, setByMkter] = useState<any[]>([]);
    const [byProduct, setByProduct] = useState<any[]>([]);
    const [mktMarket, setMktMarket] = useState<any[]>([]);

    // Filters (pending = user is selecting, applied = after "Loc" click)
    const [timePreset, setTimePreset] = useState("Thang nay");
    const [customFrom, setCustomFrom] = useState(format(new Date(), "yyyy-MM-01"));
    const [customTo, setCustomTo] = useState(format(new Date(), "yyyy-MM-dd"));
    const [selMarkets, setSelMarkets] = useState<string[]>([]);
    const [selMkts, setSelMkts] = useState<string[]>([]);
    const [selProducts, setSelProducts] = useState<string[]>([]);
    const [productSearch, setProductSearch] = useState("");
    const [allProducts, setAllProducts] = useState<string[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);

    // Applied filters (only change on "Loc" or "Refresh")
    const [appliedMarkets, setAppliedMarkets] = useState<string[]>([]);
    const [appliedMkts, setAppliedMkts] = useState<string[]>([]);
    const [appliedProducts, setAppliedProducts] = useState<string[]>([]);

    const applyFilters = () => {
        setAppliedMarkets([...selMarkets]);
        setAppliedMkts([...selMkts]);
        setAppliedProducts([...selProducts]);
        setRefreshKey(k => k + 1);
    };

    // Fetch product names once
    useEffect(() => {
        runQuery(`SELECT DISTINCT product_name FROM \`levelup-465304.${DATASET}.order_items\` WHERE product_name IS NOT NULL AND product_name != '' ORDER BY product_name LIMIT 200`)
            .then((rows: any[]) => setAllProducts(rows.map(r => r.product_name)));
    }, []);

    // Resolve date range
    const resolvedRange = (() => {
        if (timePreset === "Tuy chinh") return { from: customFrom, to: customTo };
        const preset = TIME_PRESETS.find(p => p.label === timePreset);
        if (preset) return { from: preset.from(), to: preset.to() };
        return {
            from: dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-01"),
            to: dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
        };
    })();

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = resolvedRange.from;
                const to = resolvedRange.to;
                const ds = DATASET;

                // Build WHERE filters for sale_order
                const currencyMap: Record<string,string> = { KSA: "SAR", UAE: "AED", KWT: "KWD", AUS: "AUD" };
                const marketFilter = appliedMarkets.length > 0
                    ? `AND order_currency IN (${appliedMarkets.map(m => `'${currencyMap[m] || m}'`).join(",")})`
                    : "";
                // Same filter but with s. alias for CTE-based queries
                const marketFilter_s = appliedMarkets.length > 0
                    ? `AND s.order_currency IN (${appliedMarkets.map(m => `'${currencyMap[m] || m}'`).join(",")})`
                    : "";
                // MKT filter (legacy ad_id-based, for chart queries)
                const mktFilter = appliedMkts.length > 0
                    ? `AND ad_id IN (SELECT DISTINCT ad_id FROM \`levelup-465304.${ds}.fb_ads_data\` WHERE UPPER(TRIM(SPLIT(campaign_name, '_')[SAFE_OFFSET(3)])) IN (${appliedMkts.map(m => `'${m}'`).join(",")}))`
                    : "";
                // MKT filter via page_mkt_map (page_id fallback, for KPI & marketer queries)
                const mktFilter_page = appliedMkts.length > 0
                    ? `AND pm.mkter IN (${appliedMkts.map(m => `'${m}'`).join(",")})`
                    : "";
                const productFilter = appliedProducts.length > 0
                    ? `AND i.product_name IN (${appliedProducts.map(p => `'${p.replace(/'/g, "\\'")}'`).join(",")})`
                    : "";

                // Multi-currency conversion SQL: total_price × rate → VND
                const FX_CASE = `CASE order_currency
                    WHEN 'SAR' THEN ${FX_TO_VND.SAR}
                    WHEN 'AED' THEN ${FX_TO_VND.AED}
                    WHEN 'KWD' THEN ${FX_TO_VND.KWD}
                    WHEN 'AUD' THEN ${FX_TO_VND.AUD}
                    WHEN 'VND' THEN 1
                    ELSE ${FX_TO_VND.AED}
                END`;
                // POS "Tổng tiền" = cod field (money_to_collect), stored ×100
                const PRICE_VND = `ROUND(cod / 100.0 * (${FX_CASE}), 0)`;
                const TZ = POS_TIMEZONE;

                const [r0, r1, r2, r3, r4, r5, r6] = await Promise.all([
                    // Q0: KPIs from sale_order + page_mkt_map (multi-currency + VN timezone)
                    runQuery(`WITH ${pageMktCTE(ds)}
                    SELECT
                        ROUND(SUM(CASE WHEN s.status_category NOT IN ('HUY','DON_THO') THEN ROUND(s.cod / 100.0 * (${FX_CASE}), 0) ELSE 0 END), 0) as dt_xuat_kho,
                        ROUND(SUM(CASE WHEN s.status_category = 'GIAO_THANH_CONG' THEN ROUND(s.cod / 100.0 * (${FX_CASE}), 0) ELSE 0 END), 0) as dt_thanh_cong,
                        COUNT(CASE WHEN s.status_category NOT IN ('HUY','DON_THO') THEN 1 END) as don_xk,
                        SUM(CASE WHEN s.status_category = 'GIAO_THANH_CONG' THEN 1 ELSE 0 END) as don_tc,
                        COUNT(*) as tong_don
                    FROM \`levelup-465304.${ds}.sale_order\` s
                    LEFT JOIN page_mkt_map pm ON s.page_id = pm.page_id
                    WHERE DATE(TIMESTAMP(s.inserted_at), '${TZ}') BETWEEN '${from}' AND '${to}' ${marketFilter_s} ${mktFilter_page}`),
                    // Q1: Ads spend
                    runQuery(`SELECT ROUND(SUM(spend_usd), 2) as ads_usd FROM \`levelup-465304.${ds}.vw_fact_ads_performance\` WHERE report_date BETWEEN '${from}' AND '${to}'`),
                    // Q2: Daily revenue (DTXK + DTTC) multi-currency + VN timezone, exclude cancelled
                    runQuery(`SELECT DATE(TIMESTAMP(inserted_at), '${TZ}') as d,
                        ROUND(SUM(CASE WHEN status_category IN ('GIAO_THANH_CONG','DANG_GIAO','DA_XAC_NHAN') THEN ${PRICE_VND} ELSE 0 END), 0) as dtxk,
                        ROUND(SUM(CASE WHEN status_category='GIAO_THANH_CONG' THEN ${PRICE_VND} ELSE 0 END), 0) as dttc
                    FROM \`levelup-465304.${ds}.sale_order\`
                    WHERE DATE(TIMESTAMP(inserted_at), '${TZ}') BETWEEN '${from}' AND '${to}'
                        AND status_category NOT IN ('HUY') ${marketFilter} ${mktFilter}
                    GROUP BY 1 ORDER BY 1`),
                    // Q3: Daily orders + VN timezone
                    runQuery(`SELECT DATE(TIMESTAMP(inserted_at), '${TZ}') as d,
                        COUNT(*) as total,
                        SUM(CASE WHEN status_category='GIAO_THANH_CONG' THEN 1 ELSE 0 END) as success,
                        SUM(CASE WHEN status_category='DON_HOAN' OR status_category='HUY' THEN 1 ELSE 0 END) as fail
                    FROM \`levelup-465304.${ds}.sale_order\`
                    WHERE DATE(TIMESTAMP(inserted_at), '${TZ}') BETWEEN '${from}' AND '${to}' ${marketFilter} ${mktFilter}
                    GROUP BY 1 ORDER BY 1`),
                    // Q4: By market (currency-based: SAR=KSA, AED=UAE, KWD=KWT, AUD=AUS)
                    runQuery(`SELECT
                        CASE order_currency
                            WHEN 'SAR' THEN 'KSA'
                            WHEN 'AED' THEN 'UAE'
                            WHEN 'KWD' THEN 'KWT'
                            WHEN 'AUD' THEN 'AUS'
                            ELSE 'Unknown'
                        END as market,
                        ROUND(SUM(${PRICE_VND}), 0) as revenue,
                        COUNT(*) as orders
                    FROM \`levelup-465304.${ds}.sale_order\`
                    WHERE DATE(TIMESTAMP(inserted_at), '${TZ}') BETWEEN '${from}' AND '${to}'
                        AND order_currency != 'VND'
                        AND status_category NOT IN ('HUY') ${marketFilter} ${mktFilter}
                    GROUP BY 1 ORDER BY revenue DESC`),
                    // Q5: Marketer ranking (from sale_order + page_mkt_map, page_id fallback)
                    runQuery(`WITH ${pageMktCTE(ds)}
                    SELECT
                        COALESCE(pm.mkter, 'UNKNOWN') as marketer_name,
                        ROUND(SUM(CASE WHEN s.status_category NOT IN ('HUY','DON_THO') THEN ROUND(s.cod / 100.0 * (${FX_CASE}), 0) ELSE 0 END), 0) as revenue,
                        COUNT(CASE WHEN s.status_category NOT IN ('HUY','DON_THO') THEN 1 END) as orders
                    FROM \`levelup-465304.${ds}.sale_order\` s
                    LEFT JOIN page_mkt_map pm ON s.page_id = pm.page_id
                    WHERE DATE(TIMESTAMP(s.inserted_at), '${TZ}') BETWEEN '${from}' AND '${to}' ${marketFilter_s} ${mktFilter_page}
                    GROUP BY 1 ORDER BY revenue DESC`),
                    // Q6: Product ranking (from order_items + sale_order, multi-currency)
                    runQuery(`SELECT i.product_name,
                        ROUND(SUM(i.retail_price / 100.0 * i.quantity * (${FX_CASE})), 0) as revenue,
                        SUM(i.quantity) as qty
                    FROM \`levelup-465304.${ds}.order_items\` i
                    JOIN \`levelup-465304.${ds}.sale_order\` o ON i.order_id = o.id
                    WHERE DATE(TIMESTAMP(o.inserted_at), '${TZ}') BETWEEN '${from}' AND '${to}'
                        AND o.status_category NOT IN ('HUY') ${marketFilter} ${productFilter}
                    GROUP BY 1 ORDER BY revenue DESC LIMIT 15`),
                ]);

                const r7 = await runQuery(`SELECT
                    campaign_mkter_code as mkter,
                    CASE UPPER(TRIM(SPLIT(campaign_name, '_')[SAFE_OFFSET(2)]))
                        WHEN 'AE' THEN 'UAE' WHEN 'UAE01' THEN 'UAE'
                        WHEN 'SA' THEN 'KSA' WHEN 'KSA' THEN 'KSA' WHEN 'KSA01' THEN 'KSA'
                        WHEN 'KW' THEN 'KWT' WHEN 'AU' THEN 'AUS'
                        ELSE 'Unknown'
                    END as market,
                    ROUND(SUM(spend_usd) * ${FX_TO_VND.USD}, 0) as ads_vnd,
                    ROUND(SUM(spend_usd), 2) as ads_usd
                FROM \`levelup-465304.${ds}.vw_fact_ads_performance\`
                WHERE report_date BETWEEN '${from}' AND '${to}'
                    AND campaign_mkter_code NOT IN ('UNKNOWN','UNMATCHED','AE','SA','KW','QA','AU')
                    AND spend_usd > 0
                GROUP BY 1, 2`);

                const k = r0[0] || {};
                const adsUsd = r1[0]?.ads_usd || 0;
                const aov = k.don_xk > 0 ? Math.round((k.dt_xuat_kho || 0) / k.don_xk) : 0;
                setKpis({ ...k, ads_usd: adsUsd, ads_vnd: Math.round(adsUsd * USD_TO_VND), aov });

                setDailyRevenue(r2.map((r: any) => ({ d: format(new Date(r.d), "dd/MM"), dtxk: r.dtxk, dttc: r.dttc })));
                setDailyOrders(r3.map((r: any) => ({ d: format(new Date(r.d), "dd/MM"), total: r.total, success: r.success, fail: r.fail })));

                if (r2.length > 0 && r1[0]?.ads_usd > 0) {
                    const totalAds = adsUsd * USD_TO_VND;
                    const deliveryRate = k.tong_don > 0 ? (k.don_tc / k.tong_don) * 100 : 0;
                    setDailyPct(r2.map((r: any) => {
                        const dayAds = totalAds / r2.length;
                        return {
                            d: format(new Date(r.d), "dd/MM"),
                            ads_pct: r.dtxk > 0 ? (dayAds / r.dtxk) * 100 : 0,
                            cpqc_nmv: r.dttc > 0 ? (dayAds / r.dttc) * 100 : 0,
                            delivery: deliveryRate,
                        };
                    }));
                }

                setByMarket(r4);
                const mkters = (r5 || [])
                    .map((m: any) => ({ ...m, name: resolveMarketerName(m.marketer_name) }))
                    .filter((m: any) => isRealMarketer(m.name) && m.revenue > 0);
                setByMkter(mkters);
                setByProduct(r6 || []);
                setMktMarket(r7 || []);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [dateRange, timePreset, refreshKey]);

    if (loading) return <TabSkeleton />;
    if (!kpis) return <div style={{ color: C.textMuted }} className="p-8">Khong co du lieu</div>;

    return (
        <div className="space-y-5 -m-6 p-6 min-h-screen" style={{ background: C.bg }}>

            {/* ── Filter Bar ── */}
            <div className="flex flex-wrap items-center gap-3 rounded-xl px-5 py-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <div className="flex items-center gap-1.5 mr-2">
                    <span className="text-base">📈</span>
                    <span className="font-bold text-base" style={{ color: C.text }}>Tổng Quan</span>
                    <span className="font-bold text-base" style={{ color: C.green }}>Zen 8</span>
                </div>
                <div className="flex-1" />

                {/* Time preset + custom date picker */}
                <TimePicker
                    presets={TIME_PRESETS}
                    selected={timePreset}
                    onPreset={(label) => { setTimePreset(label); if (label !== "Tuy chinh") setRefreshKey(k => k + 1); }}
                    customFrom={customFrom}
                    customTo={customTo}
                    onCustomFrom={setCustomFrom}
                    onCustomTo={setCustomTo}
                    onApply={() => { setTimePreset("Tuy chinh"); setRefreshKey(k => k + 1); }}
                />

                {/* Market multi-select */}
                <MultiSelect
                    label="Thi truong"
                    options={MARKETS_ALL}
                    selected={selMarkets}
                    onChange={setSelMarkets}
                />

                {/* MKT multi-select */}
                <MultiSelect
                    label="MKT"
                    options={MKTERS_ALL}
                    selected={selMkts}
                    onChange={setSelMkts}
                />

                {/* Product multi-select with search */}
                <MultiSelect
                    label="San pham"
                    options={allProducts}
                    selected={selProducts}
                    onChange={setSelProducts}
                    searchable
                />

                {/* Loc (Apply) */}
                <button onClick={applyFilters}
                    className="rounded-lg px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 transition-opacity"
                    style={{ background: C.green, color: "#fff" }}>
                    Loc
                </button>

                {/* Refresh */}
                <button onClick={() => { setSelMarkets([]); setSelMkts([]); setSelProducts([]); setAppliedMarkets([]); setAppliedMkts([]); setAppliedProducts([]); setRefreshKey(k => k + 1); }}
                    className="rounded-lg px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 transition-opacity"
                    style={{ background: C.blue, color: "#fff" }}>
                    🔄 Refresh
                </button>
            </div>

            {/* ── KPI Cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPIBox icon="$" color={C.green} label="DT Xuat Kho" value={`${fmtFull(kpis.dt_xuat_kho || 0)} d`} sub={`${fmtFull(kpis.don_xk || 0)} don`} />
                <KPIBox icon="📈" color={C.blue} label="DT Thanh Cong" value={`${fmtFull(kpis.dt_thanh_cong || 0)} d`} sub={`${fmtFull(kpis.don_tc || 0)} don da nhan`} />
                <KPIBox icon="📦" color={C.purple} label="Tong Don" value={fmtFull(kpis.tong_don || 0)} sub={`AOV: ${fmtFull(kpis.aov)} d`} />
                <KPIBox icon="🔗" color={C.rose} label="Chi Phi QC" value={`${fmtFull(kpis.ads_vnd)} d`} sub={`$${fmtFull(kpis.ads_usd)} USD`} />
            </div>

            {/* ── Bieu do Doanh Thu theo Ngay ── */}
            <DarkCard title="📈 Bieu do Doanh Thu theo Ngay">
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={dailyRevenue}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} opacity={0.4} />
                        <XAxis dataKey="d" tick={{ fill: C.textDim, fontSize: 11 }} axisLine={{ stroke: C.border }} tickLine={false} />
                        <YAxis tick={{ fill: C.textDim, fontSize: 11 }} tickFormatter={fmtVND} axisLine={false} tickLine={false} />
                        <Tooltip formatter={(v: number) => `${fmtFull(v)} d`} contentStyle={TOOLTIP_STYLE} labelStyle={{ color: C.text }} />
                        <Legend wrapperStyle={{ color: C.textMuted, fontSize: 12 }} />
                        <Bar dataKey="dttc" name="DTTC (Thanh Cong)" fill={C.green} radius={[3, 3, 0, 0]} />
                        <Bar dataKey="dtxk" name="DTXK (Xuat Kho)" fill={C.blue} radius={[3, 3, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </DarkCard>

            {/* ── %ADS ── */}
            {dailyPct.length > 0 && (
                <DarkCard title="📊 %ADS" sub="CPQC/NMV (cam) · %ADS Thuc (xanh) · Ti le giao thuc (xanh la)">
                    <ResponsiveContainer width="100%" height={250}>
                        <ComposedChart data={dailyPct}>
                            <CartesianGrid strokeDasharray="3 3" stroke={C.border} opacity={0.4} />
                            <XAxis dataKey="d" tick={{ fill: C.textDim, fontSize: 11 }} axisLine={{ stroke: C.border }} tickLine={false} />
                            <YAxis tick={{ fill: C.textDim, fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(0)}%`} axisLine={false} tickLine={false} />
                            <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} contentStyle={TOOLTIP_STYLE} labelStyle={{ color: C.text }} />
                            <Legend wrapperStyle={{ color: C.textMuted, fontSize: 12 }} />
                            <Line type="monotone" dataKey="ads_pct" name="%ADS Thuc" stroke={C.cyan} strokeWidth={2} dot={{ r: 3, fill: C.cyan }} />
                            <Line type="monotone" dataKey="cpqc_nmv" name="CPQC/NMV" stroke={C.orange} strokeWidth={2} dot={{ r: 3, fill: C.orange }} />
                            <Line type="monotone" dataKey="delivery" name="Ti le giao thuc" stroke={C.green} strokeWidth={2} dot={{ r: 3, fill: C.green }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </DarkCard>
            )}

            {/* ── Bieu do So Don theo Ngay ── */}
            <DarkCard title="📦 Bieu do So Don theo Ngay">
                <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={dailyOrders}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} opacity={0.4} />
                        <XAxis dataKey="d" tick={{ fill: C.textDim, fontSize: 11 }} axisLine={{ stroke: C.border }} tickLine={false} />
                        <YAxis tick={{ fill: C.textDim, fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: C.text }} />
                        <Legend wrapperStyle={{ color: C.textMuted, fontSize: 12 }} />
                        <Bar dataKey="success" name="Thanh cong" fill={C.green} stackId="a" />
                        <Bar dataKey="fail" name="Hoan/Huy" fill={C.purple} stackId="a" radius={[3, 3, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </DarkCard>

            {/* ── Row: Market + Ranking MKT ── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                <div className="lg:col-span-3">
                    <DarkCard title="🌍 Doanh Thu & So Don theo Thi Truong">
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={byMarket} barGap={4}>
                                <CartesianGrid strokeDasharray="3 3" stroke={C.border} opacity={0.4} />
                                <XAxis dataKey="market" tick={{ fill: C.textMuted, fontSize: 12 }} tickFormatter={(v) => MARKET_LABELS[v] || v} axisLine={{ stroke: C.border }} tickLine={false} />
                                <YAxis yAxisId="left" tick={{ fill: C.textDim, fontSize: 11 }} tickFormatter={fmtVND} axisLine={false} tickLine={false} />
                                <YAxis yAxisId="right" orientation="right" tick={{ fill: C.textDim, fontSize: 11 }} axisLine={false} tickLine={false} />
                                <Tooltip formatter={(v: number, name: string) => name.includes("Doanh") ? `${fmtFull(v)} d` : v} contentStyle={TOOLTIP_STYLE} labelStyle={{ color: C.text }} />
                                <Legend wrapperStyle={{ color: C.textMuted, fontSize: 12 }} />
                                <Bar yAxisId="left" dataKey="revenue" name="Doanh Thu (VND)" radius={[4, 4, 0, 0]}>
                                    {byMarket.map((m, i) => <Cell key={i} fill={MARKET_COLORS[m.market] || C.textDim} />)}
                                </Bar>
                                <Bar yAxisId="right" dataKey="orders" name="So Don" radius={[4, 4, 0, 0]}>
                                    {byMarket.map((m, i) => <Cell key={i} fill={MARKET_COLORS[m.market] || C.textDim} opacity={0.5} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </DarkCard>
                </div>

                {/* Ranking Marketing */}
                <div className="lg:col-span-2 rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                    <h3 className="text-sm font-semibold mb-1" style={{ color: C.text }}>👑 Ranking Marketing</h3>
                    <p className="text-xs mb-4" style={{ color: C.textDim }}>Doanh thu thanh cong</p>

                    {byMkter.length >= 3 && (
                        <div className="flex items-end justify-center gap-4 mb-5">
                            {[1, 0, 2].map((idx) => {
                                const m = byMkter[idx];
                                if (!m) return null;
                                const sizes = [14, 11, 11];
                                const rings = [48, 40, 36];
                                return (
                                    <div key={idx} className="flex flex-col items-center">
                                        <div className="rounded-full flex items-center justify-center text-white font-bold mb-1.5"
                                            style={{ width: rings[idx], height: rings[idx], background: PODIUM_COLORS[idx], fontSize: sizes[idx] }}>
                                            {idx + 1}
                                        </div>
                                        <span className="text-xs font-semibold" style={{ color: C.text }}>{m.name.split(' ').pop()}</span>
                                        <span className="font-bold" style={{ color: C.green, fontSize: idx === 0 ? 16 : 13 }}>{fmtFull(m.revenue)}</span>
                                        <span className="text-[10px]" style={{ color: C.textDim }}>{fmtFull(m.orders)} don</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="space-y-2.5">
                        {byMkter.slice(3).map((m, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                    <span className="w-5 text-right" style={{ color: C.textDim }}>{i + 4}</span>
                                    <span className="font-medium" style={{ color: C.text }}>{m.name.split(' ').pop()}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="font-semibold" style={{ color: C.green }}>{fmtFull(m.revenue)}</span>
                                    <span className="text-xs" style={{ color: C.textDim }}>{fmtFull(m.orders)} don</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Row: Phan Bo Doanh Thu + Ranking San Pham ── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                <div className="lg:col-span-3">
                    <DarkCard title="🤝 Phan Bo Doanh Thu">
                        <ResponsiveContainer width="100%" height={280}>
                            <PieChart>
                                <Pie data={byMarket} dataKey="revenue" nameKey="market" cx="50%" cy="50%" innerRadius={65} outerRadius={105} paddingAngle={3}
                                    label={({ market, revenue }) => `${MARKET_LABELS[market] || market}  ${fmtFull(revenue)}`}
                                    labelLine={{ stroke: C.textDim }}>
                                    {byMarket.map((m, i) => <Cell key={i} fill={MARKET_COLORS[m.market] || C.textDim} />)}
                                </Pie>
                                <Legend wrapperStyle={{ color: C.textMuted, fontSize: 12 }} formatter={(v) => MARKET_LABELS[v] || v} />
                                <Tooltip formatter={(v: number) => `${fmtFull(v)} d`} contentStyle={TOOLTIP_STYLE} />
                            </PieChart>
                        </ResponsiveContainer>
                    </DarkCard>
                </div>

                {/* Product ranking */}
                <div className="lg:col-span-2 rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                    <h3 className="text-sm font-semibold mb-3" style={{ color: C.text }}>🏆 Ranking San Pham ({byProduct.length})</h3>
                    <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                        {byProduct.map((p, i) => (
                            <div key={i} className="flex items-center gap-3 text-sm">
                                <span className="w-5 text-right font-bold" style={{ color: i < 3 ? C.amber : C.textDim }}>{i + 1}</span>
                                <span className="flex-1 font-medium truncate" style={{ color: C.text }}>{p.product_name}</span>
                                <span className="font-semibold whitespace-nowrap" style={{ color: C.green }}>{fmtFull(p.revenue)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── MKT x Thi Truong matrix ── */}
            <MktMarketMatrix data={mktMarket} />
        </div>
    );
}

// ── Time Picker with popover ──
function TimePicker({ presets, selected, onPreset, customFrom, customTo, onCustomFrom, onCustomTo, onApply }: {
    presets: typeof TIME_PRESETS; selected: string;
    onPreset: (label: string) => void;
    customFrom: string; customTo: string;
    onCustomFrom: (v: string) => void; onCustomTo: (v: string) => void;
    onApply: () => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const displayLabel = selected === "Tuy chinh"
        ? `${customFrom.split("-").reverse().join("/")} - ${customTo.split("-").reverse().join("/")}`
        : selected;

    return (
        <div ref={ref} className="relative">
            <button onClick={() => setOpen(!open)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
                style={{ background: C.cardAlt, border: `1px solid ${C.border}`, color: C.text }}>
                📅 {displayLabel} <span style={{ fontSize: 8 }}>▼</span>
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-1 z-50 rounded-xl shadow-2xl overflow-hidden w-[260px]"
                    style={{ background: C.card, border: `1px solid ${C.border}` }}>
                    {/* Presets */}
                    <div className="p-1.5">
                        {presets.filter(p => p.label !== "Tuy chinh").map(p => (
                            <button key={p.label} onClick={() => { onPreset(p.label); setOpen(false); }}
                                className={cn("w-full text-left rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                                    selected === p.label ? "text-white" : "hover:opacity-80"
                                )}
                                style={{
                                    color: selected === p.label ? "#fff" : C.text,
                                    background: selected === p.label ? C.blue : "transparent",
                                }}>
                                {p.label}
                            </button>
                        ))}
                    </div>

                    {/* Divider */}
                    <div style={{ borderTop: `1px solid ${C.border}` }} />

                    {/* Custom date range */}
                    <div className="p-3 space-y-2.5">
                        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                            style={{ background: `${C.amber}15`, border: `1px solid ${C.amber}40` }}>
                            <span style={{ color: C.amber }} className="text-xs">📅</span>
                            <span style={{ color: C.amber }} className="text-xs font-semibold">Tuy chon khoang thoi gian</span>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs w-8" style={{ color: C.textDim }}>Tu</span>
                                <input type="date" value={customFrom} onChange={e => onCustomFrom(e.target.value)}
                                    className="flex-1 rounded-lg px-3 py-2 text-xs outline-none"
                                    style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, colorScheme: "dark" }} />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs w-8" style={{ color: C.textDim }}>Den</span>
                                <input type="date" value={customTo} onChange={e => onCustomTo(e.target.value)}
                                    className="flex-1 rounded-lg px-3 py-2 text-xs outline-none"
                                    style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, colorScheme: "dark" }} />
                            </div>
                        </div>

                        <button onClick={() => { onApply(); setOpen(false); }}
                            className="w-full rounded-lg py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                            style={{ background: `linear-gradient(135deg, ${C.orange}, ${C.rose})` }}>
                            Ap dung
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── MultiSelect Dropdown ──
function MultiSelect({ label, options, selected, onChange, searchable }: {
    label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void; searchable?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const filtered = searchable && search
        ? options.filter(o => o.toLowerCase().includes(search.toLowerCase()))
        : options;

    const toggle = (v: string) => {
        onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v]);
    };

    const btnLabel = selected.length === 0 ? `Tat ca ${label}` : `${label} (${selected.length})`;

    return (
        <div ref={ref} className="relative">
            <button onClick={() => setOpen(!open)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
                style={{ background: C.cardAlt, border: `1px solid ${selected.length > 0 ? C.green : C.border}`, color: selected.length > 0 ? C.green : C.text }}>
                {btnLabel} <span style={{ fontSize: 8 }}>▼</span>
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-1 z-50 rounded-lg shadow-xl overflow-hidden min-w-[220px]"
                    style={{ background: C.card, border: `1px solid ${C.border}` }}>
                    {searchable && (
                        <div className="p-2" style={{ borderBottom: `1px solid ${C.border}` }}>
                            <input type="text" placeholder="Tim san pham..." value={search} onChange={e => setSearch(e.target.value)}
                                className="w-full rounded px-2.5 py-1.5 text-xs outline-none"
                                style={{ background: C.cardAlt, border: `1px solid ${C.border}`, color: C.text }} />
                        </div>
                    )}
                    <div className="max-h-[280px] overflow-y-auto">
                        {/* Select all */}
                        <button onClick={() => onChange(selected.length === options.length ? [] : [...options])}
                            className="w-full text-left px-3 py-2 text-xs font-semibold hover:opacity-80"
                            style={{ color: C.blue, borderBottom: `1px solid ${C.border}30` }}>
                            {selected.length === options.length ? "Bo chon tat ca" : `Tat ca ${label}`}
                        </button>
                        {filtered.map(o => (
                            <label key={o} className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:opacity-80"
                                style={{ color: C.text }}>
                                <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)}
                                    className="rounded" style={{ accentColor: C.green }} />
                                <span className="truncate">{o}</span>
                            </label>
                        ))}
                        {filtered.length === 0 && (
                            <div className="px-3 py-2 text-xs" style={{ color: C.textDim }}>Khong tim thay</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Sub-components ──

function KPIBox({ icon, color, label, value, sub }: { icon: string; color: string; label: string; value: string; sub?: string }) {
    return (
        <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg mb-3 text-lg"
                style={{ background: `${color}20`, color }}>
                {icon}
            </div>
            <div className="text-xl font-bold" style={{ color: C.text }}>{value}</div>
            <div className="text-xs mt-0.5" style={{ color: C.textDim }}>{label}</div>
            {sub && <div className="text-[11px] mt-0.5" style={{ color: C.textDim, opacity: 0.7 }}>{sub}</div>}
        </div>
    );
}

function DarkCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <h3 className="text-sm font-semibold mb-1" style={{ color: C.text }}>{title}</h3>
            {sub && <p className="text-[11px] mb-3" style={{ color: C.textDim }}>{sub}</p>}
            {children}
        </div>
    );
}

function MktMarketMatrix({ data }: { data: any[] }) {
    if (!data.length) return null;

    const mkters = [...new Set(data.map(r => r.mkter))];
    const markets = [...new Set(data.map(r => r.market))].sort((a, b) => {
        const order = ["KSA", "UAE", "KWT", "AUS", "Unknown"];
        return order.indexOf(a) - order.indexOf(b);
    });

    const cell = (mk: string, m: string) => data.find(r => r.mkter === mk && r.market === m);
    const mkterTotal = (mk: string) => data.filter(r => r.mkter === mk).reduce((s, r) => s + (r.ads_vnd || 0), 0);
    const sorted = [...mkters].sort((a, b) => mkterTotal(b) - mkterTotal(a));

    return (
        <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="px-5 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
                <h3 className="text-sm font-semibold" style={{ color: C.text }}>📊 MKT x Thi Truong</h3>
                <p className="text-xs mt-0.5" style={{ color: C.textDim }}>Chi phi QC theo MKT x Market (VND)</p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr style={{ borderBottom: `1px solid ${C.border}`, background: C.cardAlt }}>
                            <th className="px-4 py-2.5 text-left sticky left-0 z-10" style={{ color: C.textMuted, background: C.cardAlt }}>MKT</th>
                            <th className="px-4 py-2.5 text-left" style={{ color: C.textMuted }}>TT</th>
                            {markets.map(m => (
                                <th key={m} className="px-4 py-2.5 text-right" style={{ color: C.textMuted }}>{MARKET_LABELS[m] || m}</th>
                            ))}
                            <th className="px-4 py-2.5 text-right font-bold" style={{ color: C.textMuted }}>Tong</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((mk, i) => {
                            const name = resolveMarketerName(mk);
                            const shortName = name.split(' ').pop() || mk;
                            const total = mkterTotal(mk);
                            return markets.map((m, mi) => {
                                const c = cell(mk, m);
                                if (!c && mi > 0) return null;
                                return (
                                    <tr key={`${mk}-${m}`} style={{ borderBottom: `1px solid ${C.border}30` }}>
                                        {mi === 0 && (
                                            <td className="px-4 py-2.5 font-semibold sticky left-0 z-10" style={{ color: C.text, background: C.card }}
                                                rowSpan={markets.filter(mm => cell(mk, mm)).length || 1}>
                                                {shortName}
                                            </td>
                                        )}
                                        <td className="px-4 py-2.5" style={{ color: C.textDim }}>{m}</td>
                                        {markets.map(mm => {
                                            const cc = cell(mk, mm);
                                            return (
                                                <td key={mm} className="px-4 py-2.5 text-right">
                                                    {cc && mm === m ? (
                                                        <span style={{ color: C.green }} className="font-medium">d{fmtFull(cc.ads_vnd)}</span>
                                                    ) : mm === m ? (
                                                        <span style={{ color: C.textDim, opacity: 0.3 }}>-</span>
                                                    ) : null}
                                                </td>
                                            );
                                        })}
                                        {mi === 0 && (
                                            <td className="px-4 py-2.5 text-right font-bold" style={{ color: C.amber }}
                                                rowSpan={markets.filter(mm => cell(mk, mm)).length || 1}>
                                                d{fmtFull(total)}
                                            </td>
                                        )}
                                    </tr>
                                );
                            }).filter(Boolean);
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
