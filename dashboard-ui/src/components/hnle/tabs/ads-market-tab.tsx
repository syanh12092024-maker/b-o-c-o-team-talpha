"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { DATASET } from "../constants";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { resolveMarketerName, isRealMarketer } from "@/lib/marketer-map";

const USD_TO_VND = 25400;

const fmtV = (usd: number) => {
    const v = usd * USD_TO_VND;
    return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}tr` : `${(v / 1_000).toFixed(0)}k`;
};

const MARKET_LABEL: Record<string, string> = {
    SA:  "Saudi Arabia",
    AE:  "UAE",
    KW:  "Kuwait",
    ME:  "Middle East",
    AU:  "Australia",
};

const MARKET_ORDER = ["SA", "AE", "KW", "ME", "AU", "Unknown"];

const MARKET_COLOR: Record<string, string> = {
    SA:      "#f59e0b",
    AE:      "#3b82f6",
    KW:      "#10b981",
    ME:      "#a855f7",
    AU:      "#06b6d4",
    Unknown: "#6b7280",
};

interface Row { mkter: string; market: string; spend_usd: number }
interface Props { dateRange?: { from: Date; to: Date } }

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

export default function AdsMarketTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<Row[]>([]);

    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to   = dateRange?.to   ? format(dateRange.to,   "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const res = await fetch("/api/query", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: `
                        SELECT
                            campaign_mkter_code AS mkter,
                            COALESCE(NULLIF(TRIM(market_code), ''), 'Unknown') AS market,
                            ROUND(SUM(spend_usd), 2) AS spend_usd
                        FROM \`levelup-465304.${DATASET}.vw_fact_ads_performance\`
                        WHERE report_date BETWEEN '${from}' AND '${to}'
                            AND spend_usd > 0
                        GROUP BY 1, 2
                    ` }),
                }).then(r => r.json());

                // Resolve marketer names and group unknowns
                const rawRows: Row[] = res.data || [];
                const merged = new Map<string, Row>();
                rawRows.forEach(r => {
                    const resolved = resolveMarketerName(r.mkter || "");
                    const mkterLabel = isRealMarketer(resolved) ? resolved : "Unknown";
                    const key = `${mkterLabel}|${r.market}`;
                    const prev = merged.get(key);
                    if (prev) {
                        merged.set(key, { ...prev, spend_usd: prev.spend_usd + r.spend_usd });
                    } else {
                        merged.set(key, { mkter: mkterLabel, market: r.market, spend_usd: r.spend_usd });
                    }
                });
                setRows(Array.from(merged.values()));
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [dateRange]);

    if (loading) return <TabSkeleton />;

    const markets = [...new Set(rows.map(r => r.market))]
        .sort((a, b) => MARKET_ORDER.indexOf(a) - MARKET_ORDER.indexOf(b));

    const totalUSD = rows.reduce((s, r) => s + r.spend_usd, 0);

    const byMarket = markets.map(m => ({
        market: m,
        label: MARKET_LABEL[m] ?? m,
        spend_usd: rows.filter(r => r.market === m).reduce((s, r) => s + r.spend_usd, 0),
    })).sort((a, b) => b.spend_usd - a.spend_usd);

    const mkterTotal = (mk: string) => rows.filter(r => r.mkter === mk).reduce((s, r) => s + r.spend_usd, 0);
    const mktersSorted = [...new Set(rows.map(r => r.mkter))].sort((a, b) => mkterTotal(b) - mkterTotal(a));

    const cell = (mk: string, m: string) => rows.find(r => r.mkter === mk && r.market === m)?.spend_usd ?? 0;

    return (
        <div className="space-y-6">

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
                            <th className="px-5 py-2.5 text-right">Chi tiêu (VND)</th>
                            <th className="px-5 py-2.5 text-right">% tổng</th>
                        </tr>
                    </thead>
                    <tbody>
                        {byMarket.map(({ market, label, spend_usd }) => {
                            const pct = totalUSD > 0 ? (spend_usd / totalUSD) * 100 : 0;
                            const color = MARKET_COLOR[market] ?? "#6b7280";
                            return (
                                <tr key={market} className="border-b border-border/40 last:border-0 hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors">
                                    <td className="px-5 py-3">
                                        <div className="flex items-center gap-2">
                                            <span className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                                            <span className="font-medium text-foreground">{label}</span>
                                            <span className="text-xs text-muted-foreground">({market})</span>
                                        </div>
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
                                <th className="px-5 py-2.5 text-left sticky left-0 bg-gray-50 dark:bg-[#161b22] z-10 min-w-[180px]">MKT</th>
                                {markets.map(m => (
                                    <th key={m} className="px-4 py-2.5 text-center min-w-[120px]">
                                        <div className="flex items-center justify-center gap-1.5">
                                            <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ background: MARKET_COLOR[m] ?? "#6b7280" }} />
                                            {MARKET_LABEL[m] ?? m}
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
                                                <td key={m} className="px-4 py-3 text-center">
                                                    <Tooltip lines={[
                                                        `${rowPct.toFixed(1)}% tổng của ${mk}`,
                                                        `${colPct.toFixed(1)}% tổng ${MARKET_LABEL[m] ?? m}`,
                                                    ]}>
                                                        <div className={cn(
                                                            "inline-flex flex-col items-center px-2.5 py-1 rounded-lg cursor-default",
                                                            intensity > 0.5
                                                                ? "bg-amber-100 dark:bg-amber-500/20"
                                                                : intensity > 0.2
                                                                ? "bg-blue-50 dark:bg-blue-500/10"
                                                                : "bg-gray-50 dark:bg-white/5"
                                                        )}>
                                                            <span className={cn(
                                                                "font-semibold text-xs leading-tight",
                                                                intensity > 0.5
                                                                    ? "text-amber-700 dark:text-amber-400"
                                                                    : intensity > 0.2
                                                                    ? "text-blue-700 dark:text-blue-400"
                                                                    : "text-foreground"
                                                            )}>
                                                                {fmtV(v)}đ
                                                            </span>
                                                            <span className="text-[10px] text-blue-500 dark:text-blue-400 leading-tight mt-0.5">
                                                                {rowPct.toFixed(0)}%
                                                            </span>
                                                        </div>
                                                    </Tooltip>
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
