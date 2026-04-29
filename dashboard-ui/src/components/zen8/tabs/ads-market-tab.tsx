"use client";

import React, { useEffect, useState, useRef } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { DATASET, FX_TO_VND } from "../constants";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const USD_TO_VND = FX_TO_VND?.USD || 25400;

const fmtV = (usd: number) => {
    const v = usd * USD_TO_VND;
    return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}tr` : `${(v / 1_000).toFixed(0)}k`;
};

const MARKET_ORDER = ["Saudi", "UAE", "Kuwait", "Qatar", "Australia", "USA", "Romania", "Unknown"];

const MARKET_COLOR: Record<string, string> = {
    Saudi:     "#f59e0b",
    UAE:       "#3b82f6",
    Kuwait:    "#10b981",
    Qatar:     "#a855f7",
    Australia: "#06b6d4",
    USA:       "#f97316",
    Romania:   "#ec4899",
    Unknown:   "#6b7280",
};

interface Row { mkter: string; market: string; spend_usd: number }
interface Props { dateRange?: { from: Date; to: Date } }

// ── Tooltip component ──
function Tooltip({ children, lines }: { children: React.ReactNode; lines: string[] }) {
    return (
        <div className="relative group/tip inline-block">
            {children}
            <div className={cn(
                "absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5",
                "invisible group-hover/tip:visible opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150",
                "bg-gray-900 dark:bg-gray-700 text-white rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-xl",
                "pointer-events-none"
            )}>
                {lines.map((l, i) => <div key={i}>{l}</div>)}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
            </div>
        </div>
    );
}

// ── Filter constants ──
const MARKETS_ALL = ["Saudi", "UAE", "Kuwait", "Qatar", "Australia"];
const MKTERS_ALL = ["NHAMHT", "LYVLN", "HUYTN", "DUNGNH", "TAIHH", "TUNPT", "LINHLTT", "VUONGNM"];
const TIME_PRESETS = [
    { label: "Hôm nay", from: () => format(new Date(), "yyyy-MM-dd"), to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Hôm qua", from: () => { const d = new Date(); d.setDate(d.getDate() - 1); return format(d, "yyyy-MM-dd"); }, to: () => { const d = new Date(); d.setDate(d.getDate() - 1); return format(d, "yyyy-MM-dd"); } },
    { label: "7 ngày", from: () => { const d = new Date(); d.setDate(d.getDate() - 6); return format(d, "yyyy-MM-dd"); }, to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Tháng này", from: () => format(new Date(), "yyyy-MM-01"), to: () => format(new Date(), "yyyy-MM-dd") },
    { label: "Tháng trước", from: () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return format(d, "yyyy-MM-01"); }, to: () => { const d = new Date(); d.setDate(0); return format(d, "yyyy-MM-dd"); } },
];

export default function AdsMarketTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<Row[]>([]);
    // Filters
    const [timePreset, setTimePreset] = useState("Tháng này");
    const [selMarkets, setSelMarkets] = useState<string[]>([]);
    const [selMkts, setSelMkts] = useState<string[]>([]);
    const [appliedMarkets, setAppliedMarkets] = useState<string[]>([]);
    const [appliedMkts, setAppliedMkts] = useState<string[]>([]);
    const [selProducts, setSelProducts] = useState<string[]>([]);
    const [appliedProducts, setAppliedProducts] = useState<string[]>([]);
    const [productList, setProductList] = useState<string[]>([]);
    const [customFrom, setCustomFrom] = useState(format(new Date(), "yyyy-MM-01"));
    const [customTo, setCustomTo] = useState(format(new Date(), "yyyy-MM-dd"));
    const [refreshKey, setRefreshKey] = useState(0);

    const applyFilters = () => { setAppliedMarkets([...selMarkets]); setAppliedMkts([...selMkts]); setAppliedProducts([...selProducts]); setRefreshKey(k => k + 1); };

    const resolvedRange = (() => {
        if (timePreset === "Tùy chỉnh") return { from: customFrom, to: customTo };
        const preset = TIME_PRESETS.find(p => p.label === timePreset);
        if (preset) return { from: preset.from(), to: preset.to() };
        return { from: format(new Date(), "yyyy-MM-01"), to: format(new Date(), "yyyy-MM-dd") };
    })();

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = resolvedRange.from;
                const to = resolvedRange.to;
                const marketFilter = appliedMarkets.length > 0
                    ? `AND CASE UPPER(TRIM(SPLIT(campaign_name, '_')[SAFE_OFFSET(2)])) WHEN 'AE' THEN 'UAE' WHEN 'UAE01' THEN 'UAE' WHEN 'SA' THEN 'Saudi' WHEN 'KSA' THEN 'Saudi' WHEN 'KSA01' THEN 'Saudi' WHEN 'KW' THEN 'Kuwait' WHEN 'QA' THEN 'Qatar' WHEN 'AU' THEN 'Australia' ELSE 'Unknown' END IN (${appliedMarkets.map(m => `'${m}'`).join(",")})`
                    : "";
                const mktFilter = appliedMkts.length > 0
                    ? `AND campaign_mkter_code IN (${appliedMkts.map(m => `'${m}'`).join(",")})`
                    : "";

                const res = await fetch("/api/query", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: `
                        SELECT
                            campaign_mkter_code AS mkter,
                            CASE UPPER(TRIM(SPLIT(campaign_name, '_')[SAFE_OFFSET(2)]))
                                WHEN 'AE'    THEN 'UAE'
                                WHEN 'UAE01' THEN 'UAE'
                                WHEN 'SA'    THEN 'Saudi'
                                WHEN 'KSA'   THEN 'Saudi'
                                WHEN 'KSA01' THEN 'Saudi'
                                WHEN 'KW'    THEN 'Kuwait'
                                WHEN 'QA'    THEN 'Qatar'
                                WHEN 'AU'    THEN 'Australia'
                                WHEN 'US'    THEN 'USA'
                                WHEN 'RO'    THEN 'Romania'
                                ELSE 'Unknown'
                            END AS market,
                            ROUND(SUM(spend_usd), 2) AS spend_usd
                        FROM \`levelup-465304.${DATASET}.vw_fact_ads_performance\`
                        WHERE report_date BETWEEN '${from}' AND '${to}'
                            AND campaign_mkter_code NOT IN ('UNKNOWN','UNMATCHED','AE','SA','KW','QA','AU')
                            AND spend_usd > 0
                            ${marketFilter} ${mktFilter}
                        GROUP BY 1, 2
                    ` }),
                }).then(r => r.json());

                setRows(res.data || []);
                // Fetch product list for filter
                if (productList.length === 0) {
                    fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ query: `SELECT DISTINCT product_name FROM \`levelup-465304.${DATASET}.order_items\` WHERE product_name IS NOT NULL AND product_name != '' ORDER BY product_name` })
                    }).then(r => r.json()).then(d => setProductList((d.data || []).map((r: any) => r.product_name))).catch(() => {});
                }
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [timePreset, refreshKey]);

    if (loading) return <TabSkeleton />;

    const markets = [...new Set(rows.map(r => r.market))]
        .sort((a, b) => MARKET_ORDER.indexOf(a) - MARKET_ORDER.indexOf(b));

    const totalUSD = rows.reduce((s, r) => s + r.spend_usd, 0);

    const byMarket = markets.map(m => ({
        market: m,
        spend_usd: rows.filter(r => r.market === m).reduce((s, r) => s + r.spend_usd, 0),
    })).sort((a, b) => b.spend_usd - a.spend_usd);

    const mkterTotal = (mk: string) => rows.filter(r => r.mkter === mk).reduce((s, r) => s + r.spend_usd, 0);
    const mktersSorted = [...new Set(rows.map(r => r.mkter))].sort((a, b) => mkterTotal(b) - mkterTotal(a));

    const cell = (mk: string, m: string) => rows.find(r => r.mkter === mk && r.market === m)?.spend_usd ?? 0;

    return (
        <div className="space-y-6">
            {/* ── Filter Bar ── */}
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-[#0f172a] px-5 py-3">
                <div className="flex-1" />
                <FilterTimePicker presets={[...TIME_PRESETS, { label: "Tùy chỉnh", from: () => "", to: () => "" }]} selected={timePreset}
                    onPreset={(l: string) => { setTimePreset(l); if (l !== "Tùy chỉnh") setRefreshKey(k => k + 1); }}
                    customFrom={customFrom} customTo={customTo}
                    onCustomFrom={setCustomFrom} onCustomTo={setCustomTo}
                    onApply={() => { setTimePreset("Tùy chỉnh"); setRefreshKey(k => k + 1); }} />
                <FilterMultiSelect label="Thị trường" options={MARKETS_ALL} selected={selMarkets} onChange={setSelMarkets} />
                <FilterMultiSelect label="MKT" options={MKTERS_ALL} selected={selMkts} onChange={setSelMkts} />
                <FilterMultiSelect label="Sản phẩm" options={productList} selected={selProducts} onChange={setSelProducts} searchable />
                <button onClick={applyFilters}
                    className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white bg-emerald-500 hover:opacity-90">Lọc</button>
                <ThemeToggle />
            </div>

            {/* ── Bảng 1: Tổng theo Market ── */}
            <div className="rounded-xl border border-border bg-white dark:bg-[#0d1117] overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold text-foreground">Tổng Ads Spend theo Thị trường</h2>
                    <span className="text-xs text-muted-foreground">
                        Tổng: <span className="font-semibold text-amber-500">{fmtV(totalUSD)}đ</span>
                        <span className="ml-2 opacity-60">1 USD = {USD_TO_VND.toLocaleString()}đ</span>
                    </span>
                </div>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-xs text-muted-foreground border-b border-border bg-gray-50 dark:bg-white/[0.02]">
                            <th className="px-5 py-2.5 text-left">Thị trường</th>
                            <th className="px-5 py-2.5 text-right">USD</th>
                            <th className="px-5 py-2.5 text-right">VND</th>
                            <th className="px-5 py-2.5 text-right">% tổng</th>
                        </tr>
                    </thead>
                    <tbody>
                        {byMarket.map(({ market, spend_usd }) => {
                            const pct = totalUSD > 0 ? (spend_usd / totalUSD) * 100 : 0;
                            const color = MARKET_COLOR[market] ?? "#6b7280";
                            return (
                                <tr key={market} className="border-b border-border/40 last:border-0 hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors">
                                    <td className="px-5 py-3">
                                        <div className="flex items-center gap-2">
                                            <span className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                                            <span className="font-medium text-foreground">{market}</span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3 text-right text-muted-foreground text-xs">
                                        ${spend_usd >= 1000 ? `${(spend_usd / 1000).toFixed(1)}k` : spend_usd.toFixed(0)}
                                    </td>
                                    <td className="px-5 py-3 text-right">
                                        <Tooltip lines={[`${pct.toFixed(1)}% tổng ads spend`]}>
                                            <span className="font-bold text-amber-500 cursor-default">{fmtV(spend_usd)}đ</span>
                                        </Tooltip>
                                    </td>
                                    <td className="px-5 py-3 text-right font-semibold text-foreground">{pct.toFixed(1)}%</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="border-t-2 border-border bg-gray-50 dark:bg-white/[0.02]">
                            <td className="px-5 py-2.5 font-bold text-foreground">TỔNG</td>
                            <td className="px-5 py-2.5 text-right text-xs text-muted-foreground">
                                ${totalUSD >= 1000 ? `${(totalUSD / 1000).toFixed(1)}k` : totalUSD.toFixed(0)}
                            </td>
                            <td className="px-5 py-2.5 text-right font-bold text-amber-500">{fmtV(totalUSD)}đ</td>
                            <td className="px-5 py-2.5 text-right font-bold text-foreground">100%</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* ── Bảng 2: Matrix MKT × Market ── */}
            <div className="rounded-xl border border-border bg-white dark:bg-[#0d1117] overflow-hidden">
                <div className="px-5 py-3 border-b border-border">
                    <h2 className="text-sm font-semibold text-foreground">Ma trận MKT × Thị trường</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Số tiền VND · <span className="text-blue-400">row%</span> = % trên tổng MKT đó · hover để xem chi tiết
                    </p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-xs text-muted-foreground border-b border-border bg-gray-50 dark:bg-white/[0.02]">
                                <th className="px-5 py-2.5 text-left sticky left-0 bg-gray-50 dark:bg-[#161b22] z-10 min-w-[100px]">MKT</th>
                                {markets.map(m => (
                                    <th key={m} className="px-4 py-2.5 text-center min-w-[110px]">
                                        <div className="flex items-center justify-center gap-1.5">
                                            <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ background: MARKET_COLOR[m] ?? "#6b7280" }} />
                                            {m}
                                        </div>
                                    </th>
                                ))}
                                <th className="px-5 py-2.5 text-right font-bold min-w-[100px]">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mktersSorted.map((mk, i) => {
                                const rowTotal = mkterTotal(mk);
                                return (
                                    <tr key={mk} className={cn(
                                        "border-b border-border/40 last:border-0 hover:bg-amber-50/30 dark:hover:bg-amber-500/5 transition-colors",
                                        i % 2 !== 0 && "bg-gray-50/30 dark:bg-white/[0.01]"
                                    )}>
                                        <td className="px-5 py-3 font-semibold text-foreground sticky left-0 bg-white dark:bg-[#0d1117] z-10">{mk}</td>
                                        {markets.map(m => {
                                            const v = cell(mk, m);
                                            if (v === 0) return (
                                                <td key={m} className="px-4 py-3 text-center text-muted-foreground/30 text-xs">—</td>
                                            );
                                            const rowPct  = rowTotal  > 0 ? (v / rowTotal)  * 100 : 0;
                                            const colTotal = byMarket.find(b => b.market === m)?.spend_usd ?? 0;
                                            const colPct  = colTotal  > 0 ? (v / colTotal)  * 100 : 0;
                                            const intensity = colTotal > 0 ? v / colTotal : 0;
                                            return (
                                                <td key={m} className="px-3 py-2.5 text-center">
                                                    <div className={cn(
                                                        "group/cell inline-flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl w-full max-w-[110px] cursor-default",
                                                        intensity > 0.5
                                                            ? "bg-amber-50 dark:bg-amber-500/15 ring-1 ring-amber-200 dark:ring-amber-500/30"
                                                            : intensity > 0.2
                                                            ? "bg-blue-50 dark:bg-blue-500/10 ring-1 ring-blue-100 dark:ring-blue-500/20"
                                                            : "bg-gray-50 dark:bg-white/[0.04] ring-1 ring-gray-100 dark:ring-white/10"
                                                    )}>
                                                        {/* VND amount */}
                                                        <span className={cn(
                                                            "font-bold text-sm leading-tight",
                                                            intensity > 0.5
                                                                ? "text-amber-700 dark:text-amber-400"
                                                                : intensity > 0.2
                                                                ? "text-blue-700 dark:text-blue-400"
                                                                : "text-foreground"
                                                        )}>
                                                            {fmtV(v)}đ
                                                        </span>
                                                        {/* % breakdown — chỉ hiện khi hover */}
                                                        <div className="overflow-hidden max-h-0 group-hover/cell:max-h-10 transition-all duration-200 w-full">
                                                            <div className="w-full h-px bg-current opacity-10 my-0.5" />
                                                            <div className="flex items-center justify-center gap-1.5 text-[10px] leading-tight">
                                                                <span className="text-rose-500 dark:text-rose-400 font-semibold">{rowPct.toFixed(0)}%</span>
                                                                <span className="text-muted-foreground/50">·</span>
                                                                <span className="text-sky-500 dark:text-sky-400 font-medium">{colPct.toFixed(0)}%</span>
                                                            </div>
                                                            <div className="flex items-center justify-center gap-1.5 text-[9px] text-muted-foreground/50 leading-tight">
                                                                <span>MKT</span>
                                                                <span>·</span>
                                                                <span>Market</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            );
                                        })}
                                        <td className="px-5 py-3 text-right font-bold text-amber-500">{fmtV(rowTotal)}đ</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-border bg-gray-50 dark:bg-white/[0.02]">
                                <td className="px-5 py-2.5 font-bold text-foreground sticky left-0 bg-gray-50 dark:bg-[#161b22] z-10">TỔNG</td>
                                {markets.map(m => {
                                    const s = byMarket.find(b => b.market === m)?.spend_usd ?? 0;
                                    return (
                                        <td key={m} className="px-4 py-2.5 text-center font-bold text-foreground">{fmtV(s)}đ</td>
                                    );
                                })}
                                <td className="px-5 py-2.5 text-right font-bold text-amber-500">{fmtV(totalUSD)}đ</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

        </div>
    );
}

// ── Reusable Filter Components ──

function FilterTimePicker({ presets, selected, onPreset, customFrom, customTo, onCustomFrom, onCustomTo, onApply }: any) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
    }, []);
    return (
        <div ref={ref} className="relative">
            <button onClick={() => setOpen(!open)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap border border-amber-500 text-amber-500 bg-gray-800">
                📅 {selected} <span style={{ fontSize: 8 }}>▼</span>
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-1 z-50 rounded-lg shadow-xl overflow-hidden min-w-[220px] bg-gray-800 border border-gray-600">
                    {presets.filter((p: any) => p.label !== "Tùy chỉnh").map((p: any) => (
                        <button key={p.label} onClick={() => { onPreset(p.label); setOpen(false); }}
                            className={cn("w-full text-left px-3 py-2 text-xs hover:bg-gray-700", selected === p.label ? "text-amber-500 font-semibold bg-blue-600" : "text-gray-200")}>
                            {p.label}
                        </button>
                    ))}
                    <div className="border-t border-gray-600" />
                    <div className="p-3 space-y-2.5">
                        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40">
                            <span className="text-amber-500 text-xs font-semibold">📅 Tùy chọn khoảng thời gian</span>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs w-8 text-gray-400">Từ</span>
                                <input type="date" value={customFrom} onChange={(e: any) => onCustomFrom(e.target.value)}
                                    className="flex-1 rounded-lg px-3 py-2 text-xs outline-none bg-gray-900 border border-gray-600 text-white" style={{ colorScheme: "dark" }} />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs w-8 text-gray-400">Đến</span>
                                <input type="date" value={customTo} onChange={(e: any) => onCustomTo(e.target.value)}
                                    className="flex-1 rounded-lg px-3 py-2 text-xs outline-none bg-gray-900 border border-gray-600 text-white" style={{ colorScheme: "dark" }} />
                            </div>
                        </div>
                        <button onClick={() => { onApply(); setOpen(false); }}
                            className="w-full rounded-lg py-2 text-xs font-semibold text-white" style={{ background: "linear-gradient(135deg, #f97316, #f43f5e)" }}>
                            Áp dụng
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function FilterMultiSelect({ label, options, selected, onChange, searchable }: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void; searchable?: boolean }) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
    }, []);
    const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v]);
    const btnLabel = selected.length === 0 ? `Tất cả ${label}` : `${label} (${selected.length})`;
    const filtered = searchable && search ? options.filter(o => o.toLowerCase().includes(search.toLowerCase())) : options;
    return (
        <div ref={ref} className="relative">
            <button onClick={() => setOpen(!open)}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap border",
                    selected.length > 0 ? "border-emerald-500 text-emerald-500 bg-gray-800" : "border-gray-600 text-white bg-gray-800")}>
                {btnLabel} <span style={{ fontSize: 8 }}>▼</span>
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-1 z-50 rounded-lg shadow-xl overflow-hidden min-w-[240px] bg-gray-800 border border-gray-600">
                    {searchable && (
                        <div className="p-2 border-b border-gray-700">
                            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                                placeholder="Tìm sản phẩm..."
                                className="w-full rounded px-2 py-1.5 text-xs bg-gray-900 border border-gray-600 text-white outline-none placeholder-gray-500" />
                        </div>
                    )}
                    <div className="max-h-[280px] overflow-y-auto">
                        <button onClick={() => onChange(selected.length === filtered.length ? [] : [...filtered])}
                            className="w-full text-left px-3 py-2 text-xs font-semibold text-blue-400 border-b border-gray-700 hover:bg-gray-700">
                            {selected.length === filtered.length ? "Bỏ chọn tất cả" : `Tất cả ${label}`}
                        </button>
                        {filtered.map(o => (
                            <label key={o} className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer text-gray-200 hover:bg-gray-700">
                                <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} style={{ accentColor: "#22c55e" }} />
                                <span>{o}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
