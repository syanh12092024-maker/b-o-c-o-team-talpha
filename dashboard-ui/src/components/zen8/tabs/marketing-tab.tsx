"use client";

import { useEffect, useState, useRef } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line, Cell, PieChart, Pie,
} from "recharts";
import { formatCurrency as _fmtC, formatNumber, formatMoney as _fmtM, COLORS, cn } from "@/lib/utils";
import { DATASET, CURRENCY_TO_VND, FX_TO_VND } from "../constants";

/** Project-bound formatters */
const formatCurrency = (v: number) => _fmtC(v, CURRENCY_TO_VND);
const formatMoney = (v: number) => _fmtM(v, CURRENCY_TO_VND);
import { queryMarketingAdsKpis, queryMarketingDailyTrend, queryMarketingAdsByMarketer, queryMarketingMarketerPnl, queryMarketingDailyRevenue, queryMarketingDailyAds, queryMarketingDailyOrders } from "@/lib/bq-queries";
import { BQ_TABLES } from "@/lib/bq-schema";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { resolveMarketerName, isRealMarketer } from "@/lib/marketer-map";
import { ThemeToggle } from "@/components/ui/theme-toggle";

interface MarketingTabProps {
    dateRange?: { from: Date; to: Date };
    onDateRangeChange?: (range: { from: Date; to: Date }) => void;
}

// ── Theme colors (matching overview tab dark) ──
const C = {
    bg: "#0f172a", card: "#1e293b", cardAlt: "#162032", border: "#334155",
    text: "#f1f5f9", textMuted: "#94a3b8", textDim: "#64748b",
    green: "#22c55e", blue: "#3b82f6", amber: "#f59e0b", rose: "#f43f5e", orange: "#f97316",
};

/* ─── Time presets (same format as overview) ─── */
const TIME_PRESETS: { label: string; from: () => string; to: () => string }[] = [
    { label: "Hom nay", from: () => format(new Date(), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Hom qua", from: () => { const d = new Date(); d.setDate(d.getDate() - 1); return format(d, "yyyy-MM-dd"); }, to: () => { const d = new Date(); d.setDate(d.getDate() - 1); return format(d, "yyyy-MM-dd"); } },
    { label: "7 ngay", from: () => { const d = new Date(); d.setDate(d.getDate() - 6); return format(d, "yyyy-MM-dd"); }, to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Thang nay", from: () => format(new Date(), "yyyy-MM-01"), to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Thang truoc", from: () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return format(d, "yyyy-MM-01"); }, to: () => { const d = new Date(); d.setDate(0); return format(d, "yyyy-MM-dd"); } },
    { label: "Tuy chinh", from: () => "", to: () => "" },
];

/* ─── ZEN8 static lists ─── */
const MARKETS_ALL = ["KSA", "UAE", "KWT", "OMN", "BHR", "QAT"];
const MKTERS_ALL = ["NHAMHT", "LYVLN", "HUYTN", "DUNGNH", "TAIHH", "TUNPT", "LINHLTT", "VUONGNM"];

// ── TimePicker ──
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
                className="rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap bg-gray-100 dark:bg-[#162032] border border-gray-300 dark:border-[#334155] text-gray-700 dark:text-gray-200">
                📅 {displayLabel} <span style={{ fontSize: 8 }}>▼</span>
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-1 z-50 rounded-xl shadow-2xl overflow-hidden w-[260px] bg-white dark:bg-[#1e293b] border border-gray-200 dark:border-[#334155]">
                    <div className="p-1.5">
                        {presets.filter(p => p.label !== "Tuy chinh").map(p => (
                            <button key={p.label} onClick={() => { onPreset(p.label); setOpen(false); }}
                                className={cn("w-full text-left rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                                    selected === p.label ? "text-white bg-blue-500" : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10"
                                )}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <div className="border-t border-gray-200 dark:border-[#334155]" />
                    <div className="p-3 space-y-2.5">
                        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
                            <span className="text-xs text-amber-600 dark:text-amber-500">📅</span>
                            <span className="text-xs font-semibold text-amber-600 dark:text-amber-500">Tùy chọn khoảng thời gian</span>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs w-8 text-gray-400 dark:text-gray-500">Từ</span>
                                <input type="date" value={customFrom} onChange={e => onCustomFrom(e.target.value)}
                                    className="flex-1 rounded-lg px-3 py-2 text-xs outline-none bg-gray-50 dark:bg-[#0f172a] border border-gray-300 dark:border-[#334155] text-gray-800 dark:text-gray-200 dark:[color-scheme:dark]" />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs w-8 text-gray-400 dark:text-gray-500">Đến</span>
                                <input type="date" value={customTo} onChange={e => onCustomTo(e.target.value)}
                                    className="flex-1 rounded-lg px-3 py-2 text-xs outline-none bg-gray-50 dark:bg-[#0f172a] border border-gray-300 dark:border-[#334155] text-gray-800 dark:text-gray-200 dark:[color-scheme:dark]" />
                            </div>
                        </div>
                        <button onClick={() => { onApply(); setOpen(false); }}
                            className="w-full rounded-lg py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 bg-gradient-to-r from-orange-500 to-rose-500">
                            Áp dụng
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
    const hasSelection = selected.length > 0;

    return (
        <div ref={ref} className="relative">
            <button onClick={() => setOpen(!open)}
                className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap bg-gray-100 dark:bg-[#162032] border",
                    hasSelection ? "border-emerald-400 text-emerald-600 dark:text-emerald-500" : "border-gray-300 dark:border-[#334155] text-gray-700 dark:text-gray-200"
                )}>
                {btnLabel} <span style={{ fontSize: 8 }}>▼</span>
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-1 z-50 rounded-lg shadow-xl overflow-hidden min-w-[220px] bg-white dark:bg-[#1e293b] border border-gray-200 dark:border-[#334155]">
                    {searchable && (
                        <div className="p-2 border-b border-gray-200 dark:border-[#334155]">
                            <input type="text" placeholder="Tìm..." value={search} onChange={e => setSearch(e.target.value)}
                                className="w-full rounded px-2.5 py-1.5 text-xs outline-none bg-gray-50 dark:bg-[#162032] border border-gray-300 dark:border-[#334155] text-gray-800 dark:text-gray-200" />
                        </div>
                    )}
                    <div className="max-h-[280px] overflow-y-auto">
                        <button onClick={() => onChange(selected.length === options.length ? [] : [...options])}
                            className="w-full text-left px-3 py-2 text-xs font-semibold text-blue-500 hover:opacity-80 border-b border-gray-100 dark:border-[#334155]/30">
                            {selected.length === options.length ? "Bỏ chọn tất cả" : `Tất cả ${label}`}
                        </button>
                        {filtered.map(o => (
                            <label key={o} className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200">
                                <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)}
                                    className="rounded accent-emerald-500" />
                                <span className="truncate">{o}</span>
                            </label>
                        ))}
                        {filtered.length === 0 && (
                            <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">Không tìm thấy</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/* ─── Marketer performance merged row ─── */
interface MarketerRow {
    marketer_name: string;
    orders: number; success: number; returned: number;
    revenue: number; revenue_success: number;
    ads_spend: number; shipping: number; cogs: number;
    net_profit: number; roas: number; sr: number;
    impressions: number; clicks: number;
}

// ── MetricCell for dashboard panels ──
function MetricCell({ label, value, sub, color, tooltip }: {
    label: string; value: string; sub?: string; color: string;
    tooltip?: { lines: { label: string; value: string; color?: string }[] };
}) {
    const [showTip, setShowTip] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    return (
        <div className="text-center relative"
            ref={ref}
            onMouseEnter={() => tooltip && setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            style={{ cursor: tooltip ? "pointer" : undefined }}
        >
            <div className="text-[11px] font-medium mb-1.5 text-gray-500 dark:text-gray-400">{label}</div>
            <div className="text-lg font-bold" style={{ color }}>{value}</div>
            {sub && <div className="text-[10px] mt-0.5 text-gray-400 dark:text-gray-500">{sub}</div>}
            {showTip && tooltip && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 rounded-lg shadow-xl p-3 min-w-[180px] text-left bg-white dark:bg-[#1e293b] border border-gray-200 dark:border-[#334155]">
                    {tooltip.lines.map((l, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 py-0.5">
                            <span className="text-[11px] text-gray-500 dark:text-gray-400">{l.label}</span>
                            <span className="text-[11px] font-bold" style={{ color: l.color || undefined }}>{l.value}</span>
                        </div>
                    ))}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-gray-200 dark:border-t-[#334155]" />
                </div>
            )}
        </div>
    );
}

function gradeMarketer(roas: number, netProfit: number): { label: string; cls: string } {
    if (roas >= 5) return { label: "A+", cls: "bg-emerald-500/20 text-emerald-500" };
    if (roas >= 3.5) return { label: "A", cls: "bg-emerald-500/15 text-emerald-500" };
    if (roas >= 2.5) return { label: "B+", cls: "bg-amber-500/15 text-amber-500" };
    if (netProfit < 0) return { label: "C", cls: "bg-rose-500/15 text-rose-500" };
    return { label: "B", cls: "bg-blue-500/15 text-blue-400" };
}

const PIE_COLORS = ["#34d399", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7"];

export default function MarketingTab({ dateRange, onDateRangeChange }: MarketingTabProps) {
    const [loading, setLoading] = useState(true);

    // Filter state (pending = user selecting, applied = after "Loc")
    const [timePreset, setTimePreset] = useState("Thang nay");
    const [customFrom, setCustomFrom] = useState(format(new Date(), "yyyy-MM-01"));
    const [customTo, setCustomTo] = useState(format(new Date(), "yyyy-MM-dd"));
    const [selMarkets, setSelMarkets] = useState<string[]>([]);
    const [selMkts, setSelMkts] = useState<string[]>([]);
    const [selProducts, setSelProducts] = useState<string[]>([]);
    const [allProducts, setAllProducts] = useState<string[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);

    // Applied filters (only change on "Loc" or "Refresh")
    const [appliedMkts, setAppliedMkts] = useState<string[]>([]);

    const applyFilters = () => {
        setAppliedMkts([...selMkts]);
        setRefreshKey(k => k + 1);
    };

    const resetFilters = () => {
        setSelMarkets([]); setSelMkts([]); setSelProducts([]);
        setAppliedMkts([]);
        setRefreshKey(k => k + 1);
    };

    // Resolve date range from time preset
    const resolvedRange = (() => {
        if (timePreset === "Tuy chinh") return { from: customFrom, to: customTo };
        const preset = TIME_PRESETS.find(p => p.label === timePreset);
        if (preset) return { from: preset.from(), to: preset.to() };
        return {
            from: dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-01"),
            to: dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
        };
    })();

    // Fetch product names once
    useEffect(() => {
        fetch("/api/query", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: `SELECT DISTINCT product_name FROM \`levelup-465304.${DATASET}.order_items\` WHERE product_name IS NOT NULL AND product_name != '' ORDER BY product_name LIMIT 200` }),
        }).then(r => r.json()).then(r => setAllProducts((r.data || []).map((row: any) => row.product_name))).catch(() => {});
    }, []);

    // Aggregated state
    const [adsKpis, setAdsKpis] = useState({ spend: 0, impressions: 0, clicks: 0, ctr: 0, cpm: 0, adsOrders: 0, numCampaigns: 0, productCount: 0 });
    const [dailyTrend, setDailyTrend] = useState<any[]>([]);
    const [mkters, setMkters] = useState<MarketerRow[]>([]);
    const [dailyMkter, setDailyMkter] = useState<any[]>([]);
    const [mkterMarket, setMkterMarket] = useState<any[]>([]);
    const [selectedMkter, setSelectedMkter] = useState<string>("ALL");

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = resolvedRange.from || "2025-10-15";
                const to = resolvedRange.to || format(new Date(), "yyyy-MM-dd");

                const queries = [
                    queryMarketingAdsKpis(DATASET, from, to),        // Q0
                    queryMarketingDailyTrend(DATASET, from, to),      // Q1
                    queryMarketingAdsByMarketer(DATASET, from, to),   // Q2
                    // Q3: Marketer P&L with both revenue_lead (DT xuất kho) & delivered_revenue (DT thành công)
                    `SELECT marketer_name,
                        SUM(total_orders) as orders, SUM(success_orders) as success, SUM(returned_orders) as returned,
                        ROUND(SUM(COALESCE(revenue_lead, 0)),0) as revenue,
                        ROUND(SUM(COALESCE(delivered_revenue, 0)),0) as revenue_success,
                        ROUND(SUM(COALESCE(fulfillment_cost, 0)) + SUM(COALESCE(return_fulfillment_cost, 0)),0) as shipping,
                        ROUND(SUM(COALESCE(cogs, 0)),0) as cogs,
                        ROUND(SUM(COALESCE(net_profit, 0)),0) as net_profit
                    FROM ${DATASET}.mart_performance_master
                    WHERE report_date BETWEEN '${from}' AND '${to}' AND marketer_name IS NOT NULL
                    GROUP BY 1 ORDER BY revenue DESC`,
                    queryMarketingDailyRevenue(DATASET, from, to),    // Q4
                    queryMarketingDailyAds(DATASET, from, to),        // Q5
                    queryMarketingDailyOrders(DATASET, from, to),     // Q6
                    // Q7: Đơn Ads — đơn có ad_id tracking từ FB (raw lead, chưa trừ hoàn hủy, khác đơn POS)
                    `SELECT COUNT(DISTINCT id) as ads_orders FROM ${DATASET}.sale_order WHERE ad_id IS NOT NULL AND ad_id != '' AND DATE(inserted_at) BETWEEN '${from}' AND '${to}'`,
                    // Q8: SL CAMP — distinct campaigns đang spend
                    `SELECT COUNT(DISTINCT campaign_name) as num_campaigns FROM \`levelup-465304.${DATASET}.${BQ_TABLES.ADS_VIEW}\` WHERE report_date BETWEEN '${from}' AND '${to}' AND spend_ron > 0`,
                    // Q9: SL Sản Phẩm — distinct products tạo ra doanh thu
                    `SELECT COUNT(DISTINCT product_name) as product_count FROM ${DATASET}.${BQ_TABLES.ORDER_ITEMS} WHERE order_date BETWEEN '${from}' AND '${to}' AND product_name IS NOT NULL AND product_name != ''`,
                    // Q10: Marketer × Market breakdown (inline CTE without backtick-quoted names)
                    `WITH page_mkt_raw AS (
                        SELECT o.page_id, UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])) as mkter, COUNT(*) as cnt
                        FROM ${DATASET}.sale_order o
                        JOIN ${DATASET}.fb_ads_data a ON o.ad_id = a.ad_id
                        WHERE o.ad_id != '' AND o.page_id != '' AND o.page_id IS NOT NULL
                            AND UPPER(TRIM(SPLIT(a.campaign_name, '_')[SAFE_OFFSET(3)])) IN ('NHAMHT','LYVLN','HUYTN','TUNPT','LINHLTT','TAIHH','DUNGNH','VUONGNM')
                        GROUP BY 1,2
                    ), page_mkt_map AS (
                        SELECT page_id, ARRAY_AGG(mkter ORDER BY cnt DESC LIMIT 1)[OFFSET(0)] as mkter
                        FROM page_mkt_raw GROUP BY 1
                    )
                    SELECT pm.mkter as mkter_code,
                        CASE s.order_currency WHEN 'SAR' THEN 'KSA' WHEN 'AED' THEN 'UAE' WHEN 'KWD' THEN 'KWT' WHEN 'AUD' THEN 'AUS' ELSE s.order_currency END as market,
                        COUNT(*) as orders,
                        SUM(CASE WHEN s.status_category = 'GIAO_THANH_CONG' THEN 1 ELSE 0 END) as success,
                        SUM(CASE WHEN s.status_category = 'DON_HOAN' THEN 1 ELSE 0 END) as returned,
                        ROUND(SUM(CASE WHEN s.status_category = 'GIAO_THANH_CONG' THEN s.cod / 100.0 * (CASE s.order_currency WHEN 'SAR' THEN ${FX_TO_VND.SAR} WHEN 'AED' THEN ${FX_TO_VND.AED} WHEN 'KWD' THEN ${FX_TO_VND.KWD} WHEN 'AUD' THEN ${FX_TO_VND.AUD} ELSE ${FX_TO_VND.AED} END) ELSE 0 END),0) as revenue_success
                    FROM ${DATASET}.sale_order s
                    LEFT JOIN page_mkt_map pm ON s.page_id = pm.page_id
                    WHERE DATE(s.inserted_at) BETWEEN '${from}' AND '${to}'
                        AND pm.mkter IS NOT NULL
                    GROUP BY 1, 2
                    ORDER BY 1, orders DESC`,
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
                const adsOrdersRow = results[7]?.data?.[0] || {};
                const campRow = results[8]?.data?.[0] || {};
                const prodCountRow = results[9]?.data?.[0] || {};
                setAdsKpis({
                    spend: kpiRow.spend || 0,
                    impressions: kpiRow.impressions || 0,
                    clicks: kpiRow.clicks || 0,
                    ctr: kpiRow.ctr || 0,
                    cpm: kpiRow.cpm || 0,
                    adsOrders: adsOrdersRow.ads_orders || 0,
                    numCampaigns: campRow.num_campaigns || 0,
                    productCount: prodCountRow.product_count || 0,
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
                const pnlByName = new Map<string, { orders: number; success: number; returned: number; revenue: number; revenue_success: number; cogs: number; shipping: number }>();
                mkterPnl.forEach((m: any) => {
                    const name = resolveMarketerName(m.marketer_name || "");
                    if (!isRealMarketer(name)) return;
                    const prev = pnlByName.get(name) || { orders: 0, success: 0, returned: 0, revenue: 0, revenue_success: 0, cogs: 0, shipping: 0 };
                    pnlByName.set(name, {
                        orders: prev.orders + (m.orders || 0),
                        success: prev.success + (m.success || 0),
                        returned: prev.returned + (m.returned || 0),
                        revenue: prev.revenue + (m.revenue || 0),
                        revenue_success: prev.revenue_success + (m.revenue_success || 0),
                        cogs: prev.cogs + (m.cogs || 0),
                        shipping: prev.shipping + (m.shipping || 0),
                    });
                });

                // Merge both maps into final rows
                const allNames = new Set([...pnlByName.keys(), ...adsByName.keys()]);
                const merged: MarketerRow[] = [];
                allNames.forEach((name) => {
                    const pnl = pnlByName.get(name) || { orders: 0, success: 0, returned: 0, revenue: 0, revenue_success: 0, cogs: 0, shipping: 0 };
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
                        revenue, revenue_success: pnl.revenue_success,
                        ads_spend: ads.ads_spend,
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

                // Build ads lookup: date×marketer → ads_spend
                const adsMap = new Map<string, number>();
                dailyAdsRaw.forEach((d: any) => {
                    const name = resolveMarketerName(d.mkter_code || "");
                    if (!isRealMarketer(name)) return;
                    const key = `${d.report_date}|${name}`;
                    adsMap.set(key, (adsMap.get(key) || 0) + (d.ads_spend || 0));
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

                // Q10: Marketer × Market
                setMkterMarket(results[10]?.data || []);
            } catch (error) {
                console.error("Marketing data fetch error:", error);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [timePreset, customFrom, customTo, refreshKey]);

    if (loading) {
        return <TabSkeleton cards={4} showChart={true} rows={5} />;
    }

    // Filter mkters by applied MKT selections
    const displayMkters = appliedMkts.length === 0
        ? mkters
        : mkters.filter(m => {
            const code = m.marketer_name?.split(" ").pop()?.toUpperCase() || "";
            const fullUpper = m.marketer_name?.toUpperCase() || "";
            return appliedMkts.some(sel => fullUpper.includes(sel) || code === sel);
        });

    // Totals (use displayMkters for filtered view)
    const totalRevenue = displayMkters.reduce((s, m) => s + m.revenue, 0);          // revenue_lead = DT xuất kho
    const totalRevenueSuccess = displayMkters.reduce((s, m) => s + m.revenue_success, 0); // delivered_revenue = DT thành công
    const totalSpend = displayMkters.reduce((s, m) => s + m.ads_spend, 0);
    const totalCogs = displayMkters.reduce((s, m) => s + m.cogs, 0);
    const totalShipping = displayMkters.reduce((s, m) => s + m.shipping, 0);
    const totalCost = totalSpend + totalCogs + totalShipping;
    const totalProfit = displayMkters.reduce((s, m) => s + m.net_profit, 0);
    const totalOrders = displayMkters.reduce((s, m) => s + m.orders, 0);
    const totalSuccess = displayMkters.reduce((s, m) => s + m.success, 0);
    const totalReturned = displayMkters.reduce((s, m) => s + m.returned, 0);
    const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const overallSR = totalOrders > 0 ? (totalSuccess / totalOrders) * 100 : 0;
    const netProfitPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    // Chart data
    const roasChart = displayMkters.filter(m => m.ads_spend > 0).map((m) => ({
        name: m.marketer_name?.split(" ").slice(-2).join(" ") || "?",
        roas: m.roas || 0,
        spend: m.ads_spend,
        revenue: m.revenue,
    }));

    const spendPie = displayMkters.filter(m => m.ads_spend > 0).map((m) => ({
        name: m.marketer_name?.split(" ").slice(-2).join(" ") || "?",
        value: m.ads_spend,
    }));

    return (
        <div className="space-y-6">
            {/* ── Filter Bar (matching overview tab) ── */}
            <div className="sticky top-0 z-10 -mx-6 -mt-6 mb-0">
                <div className="flex flex-wrap items-center gap-3 px-6 py-3 bg-gray-50 dark:bg-[#1e293b] border-b border-gray-200 dark:border-[#334155]">
                    <div className="flex items-center gap-1.5 mr-2">
                        <span className="text-base">📈</span>
                        <span className="font-bold text-base text-gray-800 dark:text-gray-100">Tổng Quan</span>
                        <span className="font-bold text-base" style={{ color: C.green }}>Zen 8</span>
                    </div>
                    <div className="flex-1" />

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

                    <MultiSelect
                        label="Thi truong"
                        options={MARKETS_ALL}
                        selected={selMarkets}
                        onChange={setSelMarkets}
                    />

                    <MultiSelect
                        label="MKT"
                        options={MKTERS_ALL}
                        selected={selMkts}
                        onChange={setSelMkts}
                    />

                    <MultiSelect
                        label="San pham"
                        options={allProducts}
                        selected={selProducts}
                        onChange={setSelProducts}
                        searchable
                    />

                    <button onClick={applyFilters}
                        className="rounded-lg px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 transition-opacity bg-emerald-500 text-white shadow-sm">
                        Lọc
                    </button>

                    <ThemeToggle />
                </div>
            </div>

            {/* ── 📢 Chỉ số Quảng cáo ── */}
            <div className="rounded-xl p-5 bg-white dark:bg-[#1e293b] border border-gray-200 dark:border-[#334155] shadow-sm dark:shadow-none">
                <h3 className="text-sm font-bold mb-4 flex items-center gap-2 text-gray-800 dark:text-gray-100">
                    <span>📢</span> Chỉ số Quảng cáo
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                    <MetricCell label="Ads Spend" value={formatCurrency(totalSpend)} color={C.rose} />
                    <MetricCell label="Impressions" value={formatNumber(adsKpis.impressions)} color={C.blue} />
                    <MetricCell label="Clicks" value={formatNumber(adsKpis.clicks)} color={C.amber} />
                    <MetricCell label="CTR" value={`${adsKpis.ctr.toFixed(2)}%`} color={adsKpis.ctr > 3 ? C.green : C.amber} />
                    <MetricCell label="CPM" value={formatCurrency(adsKpis.cpm)} sub="VND/1000 impr" color={C.textMuted} />
                    <MetricCell label="Đơn Ads" value={formatNumber(adsKpis.adsOrders)} sub="theo ad_id FB" color={C.green} />
                    <MetricCell label="SL CAMP" value={formatNumber(adsKpis.numCampaigns)} color={C.blue} />
                </div>
            </div>

            {/* ── 🛒 Chỉ số Bán hàng ── */}
            <div className="rounded-xl p-5 bg-white dark:bg-[#1e293b] border border-gray-200 dark:border-[#334155] shadow-sm dark:shadow-none">
                <h3 className="text-sm font-bold mb-4 flex items-center gap-2 text-gray-800 dark:text-gray-100">
                    <span>🛒</span> Chỉ số Bán hàng
                </h3>
                {(() => {
                    const inTransit = Math.max(0, totalOrders - totalSuccess - totalReturned);
                    const pctReturn = totalOrders > 0 ? (totalReturned / totalOrders * 100) : 0;
                    const pctInTransit = totalOrders > 0 ? (inTransit / totalOrders * 100) : 0;
                    const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;
                    return (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                            <MetricCell label="DT Xuất kho" value={formatCurrency(totalRevenue)} color={C.green} />
                            <MetricCell label="DT Thành Công" value={formatCurrency(totalRevenueSuccess)} color={C.green} />
                            <MetricCell label="Tổng đơn" value={formatNumber(totalOrders)} color={C.blue} />
                            <MetricCell label="Thành công" value={formatNumber(totalSuccess)} sub={`SR: ${overallSR.toFixed(1)}%`} color={C.green}
                                tooltip={{ lines: [
                                    { label: "Thành công", value: `${formatNumber(totalSuccess)} (${overallSR.toFixed(1)}%)`, color: C.green },
                                    { label: "Hoàn / Huỷ", value: `${formatNumber(totalReturned)} (${pctReturn.toFixed(1)}%)`, color: C.rose },
                                    { label: "Đang giao", value: `${formatNumber(inTransit)} (${pctInTransit.toFixed(1)}%)`, color: C.amber },
                                ] }}
                            />
                            <MetricCell label="SL Sản Phẩm" value={formatNumber(adsKpis.productCount)} color={C.blue} />
                            <MetricCell label="Avg CPA" value={totalSuccess > 0 ? formatCurrency(totalSpend / totalSuccess) : "—"} sub="Ads/đơn TC" color={C.amber} />
                            <MetricCell label="AOV" value={formatCurrency(aov)} sub="DT XK / Tổng đơn" color={C.green} />
                        </div>
                    );
                })()}
            </div>

            {/* ── 💸 Chi phí chi tiết ── */}
            <div className="rounded-xl p-5 bg-white dark:bg-[#1e293b] border border-gray-200 dark:border-[#334155] shadow-sm dark:shadow-none">
                <h3 className="text-sm font-bold mb-4 flex items-center gap-2 text-gray-800 dark:text-gray-100">
                    <span>💸</span> Chi phí chi tiết
                </h3>
                {(() => {
                    const adsPctDtTc = totalRevenueSuccess > 0 ? (totalSpend / totalRevenueSuccess * 100) : 0;
                    return (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                    <MetricCell label="Ads Spend" value={formatCurrency(totalSpend)} color={C.rose} />
                    <MetricCell label="Vốn Thực Bán" value={formatCurrency(totalCogs)} color={C.amber} />
                    <MetricCell label="Shipping" value={formatCurrency(totalShipping)} color={C.blue} />
                    <MetricCell label="Tổng CP" value={formatCurrency(totalCost)} color={C.rose} />
                    <MetricCell label="Net P&L" value={formatCurrency(totalProfit)} color={totalProfit >= 0 ? C.green : C.rose} />
                    <MetricCell label="%Net Profit" value={`${netProfitPct.toFixed(1)}%`} color={netProfitPct >= 0 ? C.green : C.rose} />
                    <MetricCell label="%Ads/DT TC" value={`${adsPctDtTc.toFixed(1)}%`} sub="Ads / DT Thành Công" color={adsPctDtTc <= 30 ? C.green : adsPctDtTc <= 50 ? C.amber : C.rose} />
                </div>
                    );
                })()}
            </div>

            {/* ── Marketer Ranking Cards ── */}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {displayMkters.map((m, i) => {
                    const roasTC = m.ads_spend > 0 ? m.revenue_success / m.ads_spend : 0;
                    const grade = gradeMarketer(roasTC, m.net_profit);
                    const medal = ["🥇", "🥈", "🥉"][i] || "";
                    const rankColor = i === 0 ? "text-amber-400" : i === 1 ? "text-gray-300" : i === 2 ? "text-orange-400" : "text-muted-foreground";
                    const netPnl = m.revenue_success - m.cogs - m.shipping - m.ads_spend;
                    const borderColor = netPnl >= 0 ? "border-l-emerald-500" : "border-l-rose-500";
                    const cpa = m.success > 0 ? m.ads_spend / m.success : 0;
                    const adsPct = m.revenue_success > 0 ? (m.ads_spend / m.revenue_success * 100) : 0;
                    return (
                        <div key={m.marketer_name}
                            className={cn("rounded-lg border border-border border-l-[3px] bg-card p-4", borderColor)}>
                            <div className="mb-2 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className={cn("text-lg font-black", rankColor)}>#{i + 1}</span>
                                    <span className={cn("text-sm font-bold", i < 3 ? "text-orange-400" : "text-foreground")}>{medal} {m.marketer_name}</span>
                                </div>
                                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", grade.cls)}>{grade.label}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                <div>ROAS: <span className={cn("font-bold", roasTC >= 2.5 ? "text-emerald-500" : "text-amber-500")}>{roasTC.toFixed(2)}x</span></div>
                                <div>CPA: <span className="font-bold text-blue-400">{cpa > 0 ? formatMoney(cpa) : "—"}</span></div>
                                <div>Đơn: {formatNumber(m.orders)}</div>
                                <div>SR: <span className={cn(m.sr >= 60 ? "text-emerald-500" : "text-amber-500")}>{m.sr}%</span></div>
                                <div>DT TC: <span className="text-emerald-500">{formatMoney(m.revenue_success)}</span></div>
                                <div>Ads: <span className="text-amber-500">{formatMoney(m.ads_spend)}</span></div>
                                <div>COGS: <span className="text-orange-400">{formatMoney(m.cogs)}</span></div>
                                <div>%Ads/DT TC: <span className={cn(adsPct <= 30 ? "text-emerald-500" : adsPct <= 50 ? "text-amber-500" : "text-rose-500")}>{adsPct.toFixed(1)}%</span></div>
                            </div>
                            {(() => {
                                const profitPct = m.revenue_success > 0 ? (netPnl / m.revenue_success * 100) : 0;
                                return (
                            <div className="mt-2 border-t border-border pt-2 text-xs space-y-1">
                                <div className="flex justify-between">
                                    <span className="font-semibold">Net P&L:</span>
                                    <span className={cn("font-bold", netPnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                        {netPnl >= 0 ? "+" : ""}{formatMoney(netPnl)} VND
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="font-semibold">%Profit:</span>
                                    <span className={cn("font-bold", profitPct >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                        {profitPct.toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                                );
                            })()}
                        </div>
                    );
                })}
            </div>

            {/* ── Charts Row ── */}
            <div className="grid gap-4 lg:grid-cols-2">
                {/* Net P&L per Marketer */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        💰 Net P&L theo MKT
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={displayMkters.filter(m => m.revenue_success > 0 || m.ads_spend > 0).map(m => {
                            const net = m.revenue_success - m.cogs - m.shipping - m.ads_spend;
                            return {
                                name: m.marketer_name?.split(" ").slice(-2).join(" ") || "?",
                                net_pnl: net,
                                revenue: m.revenue_success,
                                cost: m.ads_spend + m.cogs + m.shipping,
                            };
                        })}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                                formatter={(val: any) => [formatMoney(val as number), ""]}
                                labelFormatter={(label) => `${label}`} />
                            <Legend />
                            <Bar dataKey="net_pnl" name="Net P&L" radius={[4, 4, 0, 0]}>
                                {displayMkters.filter(m => m.revenue_success > 0 || m.ads_spend > 0).map((m, i) => {
                                    const net = m.revenue_success - m.cogs - m.shipping - m.ads_spend;
                                    return <Cell key={i} fill={net >= 0 ? "#34d399" : "#ef4444"} />;
                                })}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Net P&L per Market */}
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-blue-400" />
                        🌍 Net P&L theo Thị trường
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={(() => {
                            // Aggregate mkterMarket by market
                            const byMarket = new Map<string, { orders: number; revSuccess: number }>();
                            (mkterMarket || []).forEach((r: any) => {
                                const prev = byMarket.get(r.market) || { orders: 0, revSuccess: 0 };
                                byMarket.set(r.market, { orders: prev.orders + (r.orders || 0), revSuccess: prev.revSuccess + (r.revenue_success || 0) });
                            });
                            const totalRevMkt = Array.from(byMarket.values()).reduce((s, v) => s + v.revSuccess, 0);
                            return Array.from(byMarket.entries())
                                .filter(([, v]) => v.revSuccess > 0 || v.orders > 0)
                                .map(([market, v]) => {
                                    const ratio = totalRevMkt > 0 ? v.revSuccess / totalRevMkt : 0;
                                    const costAlloc = (totalSpend + totalCogs + totalShipping) * ratio;
                                    const net = v.revSuccess - costAlloc;
                                    return { name: market, net_pnl: net };
                                })
                                .sort((a, b) => b.net_pnl - a.net_pnl);
                        })()}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} />
                            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                                formatter={(val: any) => [formatMoney(val as number), ""]} />
                            <Legend />
                            <Bar dataKey="net_pnl" name="Net P&L" radius={[4, 4, 0, 0]}>
                                {(() => {
                                    const byMarket = new Map<string, number>();
                                    (mkterMarket || []).forEach((r: any) => {
                                        byMarket.set(r.market, (byMarket.get(r.market) || 0) + (r.revenue_success || 0));
                                    });
                                    const totalRevMkt = Array.from(byMarket.values()).reduce((s, v) => s + v, 0);
                                    const MARKET_COLORS: Record<string, string> = { KSA: C.blue, UAE: C.green, KWT: C.amber, AUS: "#a855f7" };
                                    return Array.from(byMarket.entries())
                                        .filter(([, v]) => v > 0)
                                        .sort((a, b) => {
                                            const rA = totalRevMkt > 0 ? a[1] / totalRevMkt : 0;
                                            const rB = totalRevMkt > 0 ? b[1] / totalRevMkt : 0;
                                            const netA = a[1] - (totalSpend + totalCogs + totalShipping) * rA;
                                            const netB = b[1] - (totalSpend + totalCogs + totalShipping) * rB;
                                            return netB - netA;
                                        })
                                        .map(([market, rev], i) => {
                                            const ratio = totalRevMkt > 0 ? rev / totalRevMkt : 0;
                                            const net = rev - (totalSpend + totalCogs + totalShipping) * ratio;
                                            return <Cell key={i} fill={net >= 0 ? (MARKET_COLORS[market] || C.green) : "#ef4444"} />;
                                        });
                                })()}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* ── Marketer P&L Detail ── */}
            <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">📋 Marketer P&L Detail</h3>
                {/* MKT filter tags */}
                <div className="mb-4 flex flex-wrap gap-2">
                    <button onClick={() => setSelectedMkter("ALL")}
                        className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                            selectedMkter === "ALL" ? "bg-indigo-500 text-white" : "bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/20")}
                    >Tất cả</button>
                    {displayMkters.map(m => (
                        <button key={m.marketer_name} onClick={() => setSelectedMkter(m.marketer_name)}
                            className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                                selectedMkter === m.marketer_name ? "bg-emerald-500 text-white" : "bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/20")}
                        >{m.marketer_name}</button>
                    ))}
                </div>
                <div className="overflow-x-auto">
                    {(() => {
                        // When specific MKT selected → show market breakdown
                        const isSingleMkt = selectedMkter !== "ALL";

                        // Get market rows for selected marketer (resolve code → full name to match)
                        const marketRows = isSingleMkt
                            ? mkterMarket.filter((r: any) => {
                                const resolved = resolveMarketerName(r.mkter_code || "");
                                return resolved === selectedMkter;
                            })
                            : [];

                        // Column header label
                        const firstColLabel = isSingleMkt ? "Thị trường" : "Marketer";

                        return (
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground">
                                <th className="px-2 pb-2 text-left font-medium">{firstColLabel}</th>
                                <th className="px-2 pb-2 text-right font-medium">Đơn</th>
                                <th className="px-2 pb-2 text-right font-medium">DT Thành Công</th>
                                <th className="px-2 pb-2 text-right font-medium">% Giao</th>
                                <th className="px-2 pb-2 text-right font-medium">Ads Spend</th>
                                <th className="px-2 pb-2 text-right font-medium">Vốn Thực Bán</th>
                                <th className="px-2 pb-2 text-right font-medium">Shipping</th>
                                <th className="px-2 pb-2 text-right font-medium">Tổng CP</th>
                                <th className="px-2 pb-2 text-right font-medium">Net P&L</th>
                                <th className="px-2 pb-2 text-right font-medium">%Net Profit</th>
                                <th className="px-2 pb-2 text-right font-medium">Grade</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isSingleMkt ? (
                                /* ── Market breakdown for selected MKT ── */
                                (() => {
                                    // Get the marketer's total from mart to proportionally split costs
                                    const mkt = displayMkters.find(m => m.marketer_name === selectedMkter);
                                    const mktTotalRev = marketRows.reduce((s: number, r: any) => s + (r.revenue_success || 0), 0);

                                    return marketRows.map((r: any) => {
                                        const orders = r.orders || 0;
                                        const returned = r.returned || 0;
                                        const revSuccess = r.revenue_success || 0;
                                        const pctGiao = orders > 0 ? ((orders - returned) / orders * 100) : 0;

                                        // Proportional split by revenue ratio
                                        const ratio = mktTotalRev > 0 ? revSuccess / mktTotalRev : 0;
                                        const adsAlloc = Math.round((mkt?.ads_spend || 0) * ratio);
                                        const cogsAlloc = Math.round((mkt?.cogs || 0) * ratio);
                                        const shipAlloc = Math.round((mkt?.shipping || 0) * ratio);
                                        const totalCostR = adsAlloc + cogsAlloc + shipAlloc;
                                        const netPnlR = revSuccess - totalCostR;
                                        const netPctR = revSuccess > 0 ? (netPnlR / revSuccess * 100) : 0;
                                        const roasR = adsAlloc > 0 ? revSuccess / adsAlloc : 0;
                                        const grade = gradeMarketer(roasR, netPnlR);

                                        const MARKET_COLORS: Record<string, string> = { KSA: C.blue, UAE: C.green, KWT: C.amber, AUS: "#a855f7", VND: C.textMuted };
                                        return (
                                            <tr key={r.market} className="border-b border-border/30 hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
                                                <td className="px-2 py-2.5 font-semibold text-foreground whitespace-nowrap">
                                                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: MARKET_COLORS[r.market] || C.rose }} />
                                                    {r.market}
                                                </td>
                                                <td className="px-2 py-2.5 text-right">{formatNumber(orders)}</td>
                                                <td className="px-2 py-2.5 text-right font-semibold text-emerald-500">{formatMoney(revSuccess)}</td>
                                                <td className={cn("px-2 py-2.5 text-right font-bold", pctGiao >= 60 ? "text-emerald-500" : "text-amber-500")}>{pctGiao.toFixed(1)}%</td>
                                                <td className="px-2 py-2.5 text-right text-rose-500">{formatMoney(adsAlloc)}</td>
                                                <td className="px-2 py-2.5 text-right text-amber-500">{formatMoney(cogsAlloc)}</td>
                                                <td className="px-2 py-2.5 text-right text-cyan-500">{formatMoney(shipAlloc)}</td>
                                                <td className="px-2 py-2.5 text-right text-rose-500">{formatMoney(totalCostR)}</td>
                                                <td className={cn("px-2 py-2.5 text-right font-bold", netPnlR >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                                    {netPnlR >= 0 ? "+" : ""}{formatMoney(netPnlR)}
                                                </td>
                                                <td className={cn("px-2 py-2.5 text-right font-bold", netPctR >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                                    {netPctR.toFixed(1)}%
                                                </td>
                                                <td className="px-2 py-2.5 text-right">
                                                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", grade.cls)}>{grade.label}</span>
                                                </td>
                                            </tr>
                                        );
                                    });
                                })()
                            ) : (
                                /* ── All marketers view ── */
                                displayMkters.map((m) => {
                                const roasTC = m.ads_spend > 0 ? m.revenue_success / m.ads_spend : 0;
                                const netPnl = m.revenue_success - m.cogs - m.shipping - m.ads_spend;
                                const grade = gradeMarketer(roasTC, netPnl);
                                const totalCostM = m.ads_spend + m.cogs + m.shipping;
                                const pctGiao = m.orders > 0 ? ((m.orders - m.returned) / m.orders * 100) : 0;
                                const netProfitPctM = m.revenue_success > 0 ? (netPnl / m.revenue_success * 100) : 0;
                                return (
                                    <tr key={m.marketer_name} className="border-b border-border/30 hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
                                        <td className="px-2 py-2.5 font-semibold text-foreground whitespace-nowrap">{m.marketer_name}</td>
                                        <td className="px-2 py-2.5 text-right">{formatNumber(m.orders)}</td>
                                        <td className="px-2 py-2.5 text-right font-semibold text-emerald-500">{formatMoney(m.revenue_success)}</td>
                                        <td className={cn("px-2 py-2.5 text-right font-bold", pctGiao >= 60 ? "text-emerald-500" : "text-amber-500")}>{pctGiao.toFixed(1)}%</td>
                                        <td className="px-2 py-2.5 text-right text-rose-500">{formatMoney(m.ads_spend)}</td>
                                        <td className="px-2 py-2.5 text-right text-amber-500">{formatMoney(m.cogs)}</td>
                                        <td className="px-2 py-2.5 text-right text-cyan-500">{formatMoney(m.shipping)}</td>
                                        <td className="px-2 py-2.5 text-right text-rose-500">{formatMoney(totalCostM)}</td>
                                        <td className={cn("px-2 py-2.5 text-right font-bold", netPnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                            {netPnl >= 0 ? "+" : ""}{formatMoney(netPnl)}
                                        </td>
                                        <td className={cn("px-2 py-2.5 text-right font-bold", netProfitPctM >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                            {netProfitPctM.toFixed(1)}%
                                        </td>
                                        <td className="px-2 py-2.5 text-right">
                                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", grade.cls)}>{grade.label}</span>
                                        </td>
                                    </tr>
                                );
                                })
                            )}
                            {/* Totals row */}
                            {(() => {
                                const rows = selectedMkter === "ALL" ? displayMkters : displayMkters.filter(m => m.marketer_name === selectedMkter);
                                const tOrders = rows.reduce((s, m) => s + m.orders, 0);
                                const tReturned = rows.reduce((s, m) => s + m.returned, 0);
                                const tRevSuccess = rows.reduce((s, m) => s + m.revenue_success, 0);
                                const tAds = rows.reduce((s, m) => s + m.ads_spend, 0);
                                const tCogs = rows.reduce((s, m) => s + m.cogs, 0);
                                const tShip = rows.reduce((s, m) => s + m.shipping, 0);
                                const tCost = tAds + tCogs + tShip;
                                const tNet = tRevSuccess - tCost;
                                const tPctGiao = tOrders > 0 ? ((tOrders - tReturned) / tOrders * 100) : 0;
                                const tNetPct = tRevSuccess > 0 ? (tNet / tRevSuccess * 100) : 0;
                                return (
                                    <tr className="border-t-2 border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-500/5 font-bold">
                                        <td className="px-2 py-2.5 text-foreground">TỔNG</td>
                                        <td className="px-2 py-2.5 text-right">{formatNumber(tOrders)}</td>
                                        <td className="px-2 py-2.5 text-right text-emerald-500">{formatMoney(tRevSuccess)}</td>
                                        <td className="px-2 py-2.5 text-right">{tPctGiao.toFixed(1)}%</td>
                                        <td className="px-2 py-2.5 text-right text-rose-500">{formatMoney(tAds)}</td>
                                        <td className="px-2 py-2.5 text-right text-amber-500">{formatMoney(tCogs)}</td>
                                        <td className="px-2 py-2.5 text-right text-cyan-500">{formatMoney(tShip)}</td>
                                        <td className="px-2 py-2.5 text-right text-rose-500">{formatMoney(tCost)}</td>
                                        <td className={cn("px-2 py-2.5 text-right", tNet >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                            {tNet >= 0 ? "+" : ""}{formatMoney(tNet)}
                                        </td>
                                        <td className={cn("px-2 py-2.5 text-right", tNetPct >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                            {tNetPct.toFixed(1)}%
                                        </td>
                                        <td className="px-2 py-2.5"></td>
                                    </tr>
                                );
                            })()}
                        </tbody>
                    </table>
                        );
                    })()}
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
                    {displayMkters.map((m) => (
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
                                            <td className={cn("px-2 py-1.5 text-right", d.returned > 0 ? "text-rose-500" : "")}>{formatNumber(d.returned)}</td>
                                            <td className={cn("px-2 py-1.5 text-right font-semibold",
                                                (d.sr || 0) >= 45 ? "text-emerald-500" : (d.sr || 0) >= 30 ? "text-amber-500" : "text-rose-500")}>
                                                {d.sr != null ? `${d.sr}%` : "—"}
                                            </td>
                                            <td className="px-2 py-1.5 text-right font-semibold text-emerald-500">{formatMoney(d.revenue)}</td>
                                            <td className="px-2 py-1.5 text-right text-amber-500">{formatMoney(d.ads_spend)}</td>
                                            <td className="px-2 py-1.5 text-right text-orange-400">{formatMoney(d.cogs)}</td>
                                            <td className="px-2 py-1.5 text-right text-cyan-500">{formatMoney(d.shipping)}</td>
                                            <td className={cn("px-2 py-1.5 text-right font-bold",
                                                d.net_profit >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                                {d.net_profit >= 0 ? "+" : ""}{formatMoney(d.net_profit)}
                                            </td>
                                            <td className={cn("px-2 py-1.5 text-right font-semibold",
                                                (d.roas || 0) >= 3 ? "text-emerald-500" : (d.roas || 0) >= 1.5 ? "text-amber-500" : "text-rose-500")}>
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
