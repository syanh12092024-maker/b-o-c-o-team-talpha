"use client";

import { useEffect, useState, useCallback } from "react";
import {
    Beaker, TrendingUp, TrendingDown, Minus, RefreshCw, Globe,
    BarChart2, ArrowUpRight, ArrowDownRight, Clock, DollarSign,
    Sparkles, ChevronRight, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import TabSkeleton from "@/components/ui/tab-skeleton";

const BACKEND = "http://localhost:8000";
const DATASET = "AUUS1_Dataset";

// ═══ Types ═══
interface ProductSummary {
    product_code: string;
    market: string;
    journey_stage: "Scaling" | "WIN" | "Potential" | "Testing" | "Paused";
    trend_direction: "trending_up" | "trending_down" | "stable";
    first_test_date: string;
    last_active_date: string;
    days_running: number;
    total_spend_usd: number;
    total_revenue_usd: number;
    total_orders: number;
    avg_roas: number;
    best_roas: number;
    avg_cpa_usd: number;
    avg_cpm_usd: number;
    avg_ctr_pct: number;
    spend_last7d: number;
    revenue_last7d: number;
    roas_last7d: number;
}

// ═══ Stage Config ═══
const STAGE_CONFIG = {
    Scaling:   { emoji: "🚀", color: "border-l-4 border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
    WIN:       { emoji: "🏆", color: "border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-900/20", badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
    Potential: { emoji: "💡", color: "border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/20", badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
    Testing:   { emoji: "🧪", color: "border-l-4 border-purple-500 bg-gray-50 dark:bg-gray-900/40", badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400" },
    Paused:    { emoji: "⏸", color: "border-l-4 border-gray-400 bg-gray-50 dark:bg-gray-900/20 opacity-70", badge: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};
type StageKey = keyof typeof STAGE_CONFIG;

// ═══ Trend Icon ═══
function TrendIcon({ direction }: { direction: string }) {
    if (direction === "trending_up") return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />;
    if (direction === "trending_down") return <TrendingDown className="h-3.5 w-3.5 text-red-500" />;
    return <Minus className="h-3.5 w-3.5 text-gray-400" />;
}

// ═══ ROAS badge ═══
function RoasBadge({ roas }: { roas: number }) {
    const val = roas ?? null;
    const color = val !== null && val >= 3.5 ? "text-emerald-600 dark:text-emerald-400 font-bold" :
                  val !== null && val >= 2.5 ? "text-amber-600 dark:text-amber-400 font-bold" :
                  val !== null && val >= 1.5 ? "text-blue-600 dark:text-blue-400" :
                  "text-red-500 dark:text-red-400";
    return <span className={cn("text-sm", color)}>{val !== null ? val.toFixed(2) : "—"}x</span>;
}

// ═══ Market Flag ═══
function MarketFlag({ market }: { market: string }) {
    const flags: Record<string, string> = { AU: "🇦🇺", US: "🇺🇸", ALL: "🌍" };
    return <span className="text-xs font-medium">{flags[market] || market}</span>;
}

// ═══ Product Card ═══
function ProductCard({ product, onSelect }: {
    product: ProductSummary;
    onSelect: (code: string, market: string) => void;
}) {
    const stage = product.journey_stage as StageKey;
    const cfg = STAGE_CONFIG[stage] || STAGE_CONFIG.Testing;
    const roasDelta = product.roas_last7d && product.avg_roas
        ? ((product.roas_last7d - product.avg_roas) / product.avg_roas) * 100
        : 0;

    return (
        <div
            onClick={() => onSelect(product.product_code, product.market)}
            className={cn("rounded-lg p-3 cursor-pointer hover:shadow-md transition-all", cfg.color)}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <MarketFlag market={product.market} />
                    <span className="text-sm font-bold text-foreground">{product.product_code}</span>
                </div>
                <TrendIcon direction={product.trend_direction} />
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground mb-2">
                <div>
                    <span className="text-[10px] uppercase font-medium">Avg ROAS</span>
                    <p><RoasBadge roas={product.avg_roas} /></p>
                </div>
                <div>
                    <span className="text-[10px] uppercase font-medium">7d ROAS</span>
                    <p className="flex items-center gap-1">
                        <RoasBadge roas={product.roas_last7d} />
                        {roasDelta !== 0 && (
                            <span className={cn("text-[10px]", roasDelta > 0 ? "text-emerald-500" : "text-red-500")}>
                                {roasDelta > 0 ? "+" : ""}{roasDelta.toFixed(0)}%
                            </span>
                        )}
                    </p>
                </div>
                <div>
                    <span className="text-[10px] uppercase font-medium">Spend</span>
                    <p className="font-medium text-foreground">${(product.total_spend_usd || 0).toLocaleString()}</p>
                </div>
                <div>
                    <span className="text-[10px] uppercase font-medium">Orders</span>
                    <p className="font-medium text-foreground">{product.total_orders || 0}</p>
                </div>
            </div>

            <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                    <Clock className="h-2.5 w-2.5 inline mr-0.5" />
                    {product.days_running}d running
                </span>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
            </div>
        </div>
    );
}

// ═══ Kanban Column ═══
function KanbanColumn({ stage, products, onSelect }: {
    stage: StageKey;
    products: ProductSummary[];
    onSelect: (code: string, market: string) => void;
}) {
    const cfg = STAGE_CONFIG[stage];
    const totalSpend = products.reduce((s, p) => s + (p.total_spend_usd || 0), 0);

    return (
        <div className="flex-1 min-w-[200px]">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="text-base">{cfg.emoji}</span>
                    <span className="text-sm font-bold text-foreground">{stage}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", cfg.badge)}>
                        {products.length}
                    </span>
                </div>
                {totalSpend > 0 && (
                    <span className="text-[10px] text-muted-foreground">${totalSpend.toLocaleString()}</span>
                )}
            </div>
            <div className="space-y-2">
                {products.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/60 p-4 text-center">
                        <p className="text-[11px] text-muted-foreground">No products</p>
                    </div>
                ) : (
                    products.map(p => (
                        <ProductCard key={`${p.product_code}-${p.market}`} product={p} onSelect={onSelect} />
                    ))
                )}
            </div>
        </div>
    );
}

// ═══ Product Detail Panel ═══
function ProductDetailPanel({ code, market, onClose }: { code: string; market: string; onClose: () => void }) {
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        fetch(`${BACKEND}/api/product-tests/journey/${code}${market !== "ALL" ? `?market=${market}` : ""}`)
            .then(r => r.json())
            .then(data => setHistory(data.history || []))
            .catch(() => setHistory([]))
            .finally(() => setLoading(false));
    }, [code, market]);

    const totalSpend = history.reduce((s, r) => s + (r.spend_usd || 0), 0);
    const totalRevenue = history.reduce((s, r) => s + (r.revenue_usd || 0), 0);
    const avgRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;

    return (
        <div className="fixed inset-y-0 right-0 w-96 bg-white dark:bg-gray-900 border-l border-border shadow-2xl z-50 overflow-y-auto">
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-border p-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-bold text-foreground">{code}</h3>
                        <p className="text-xs text-muted-foreground"><MarketFlag market={market} /> {market} Journey</p>
                    </div>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded">✕</button>
                </div>

                {/* Summary */}
                <div className="grid grid-cols-3 gap-2 mt-3">
                    {[
                        { label: "Spend", value: `$${totalSpend.toLocaleString()}` },
                        { label: "Revenue", value: `$${totalRevenue.toLocaleString()}` },
                        { label: "Avg ROAS", value: <RoasBadge roas={avgRoas} /> },
                    ].map(({ label, value }) => (
                        <div key={label} className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-2 text-center">
                            <p className="text-[10px] text-muted-foreground uppercase font-medium">{label}</p>
                            <p className="text-sm font-semibold text-foreground">{value}</p>
                        </div>
                    ))}
                </div>
            </div>

            <div className="p-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-3">Daily History</h4>
                {loading ? (
                    <div className="flex justify-center py-8">
                        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : history.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No data found</p>
                ) : (
                    <div className="space-y-2">
                        {history.slice().reverse().map((row, i) => (
                            <div key={i} className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-800/40 px-3 py-2 text-xs">
                                <span className="text-muted-foreground font-mono">{row.date}</span>
                                <span className="text-muted-foreground">{row.market}</span>
                                <span className="text-foreground font-medium">${(row.spend_usd || 0).toFixed(0)}</span>
                                <RoasBadge roas={row.roas} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ═══ Main Product Test Tab ═══
export default function ProductTestTab() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [kanban, setKanban] = useState<Record<string, ProductSummary[]>>({});
    const [totals, setTotals] = useState<Record<string, number>>({});
    const [marketFilter, setMarketFilter] = useState("all");
    const [selected, setSelected] = useState<{ code: string; market: string } | null>(null);

    const stages: StageKey[] = ["Scaling", "WIN", "Potential", "Testing", "Paused"];

    const fetchKanban = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // Fetch from BQ via dashboard /api/query (same pattern as other tabs)
            const query = `
                SELECT *
                FROM ${DATASET}.vw_product_test_summary
                ${marketFilter !== "all" ? `WHERE market = '${marketFilter.toUpperCase()}'` : ""}
                ORDER BY
                    CASE journey_stage
                        WHEN 'Scaling' THEN 1 WHEN 'WIN' THEN 2
                        WHEN 'Potential' THEN 3 WHEN 'Testing' THEN 4
                        WHEN 'Paused' THEN 5 ELSE 6 END,
                    avg_roas DESC
            `;
            const res = await fetch("/api/query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query }),
            }).then(r => r.json()).catch(() => ({ data: [] }));

            const products: ProductSummary[] = res.data || [];

            // Group by stage
            const grouped: Record<string, ProductSummary[]> = Object.fromEntries(stages.map(s => [s, []]));
            for (const p of products) {
                const stage = p.journey_stage || "Testing";
                if (grouped[stage]) grouped[stage].push(p);
            }
            setKanban(grouped);
            setTotals(Object.fromEntries(stages.map(s => [s, grouped[s].length])));
        } catch (e: any) {
            setError(e.message || "Failed to load");
        } finally {
            setLoading(false);
        }
    }, [marketFilter]);

    useEffect(() => { fetchKanban(); }, [fetchKanban]);

    if (loading) return <TabSkeleton />;

    const totalProducts = Object.values(totals).reduce((a, b) => a + b, 0);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Beaker className="h-6 w-6 text-purple-500" />
                    <div>
                        <h2 className="text-lg font-bold text-foreground">Product Lab</h2>
                        <p className="text-xs text-muted-foreground">{totalProducts} products tracked</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {/* Market Filter */}
                    <div className="flex items-center rounded-lg border border-border/60 bg-white dark:bg-gray-900/40 overflow-hidden">
                        {[{ v: "all", l: "🌍 All" }, { v: "AU", l: "🇦🇺 AU" }, { v: "US", l: "🇺🇸 US" }].map(({ v, l }) => (
                            <button key={v} onClick={() => setMarketFilter(v)}
                                className={cn("px-3 py-2 text-sm font-medium transition-colors",
                                    marketFilter === v
                                        ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400"
                                        : "text-muted-foreground hover:text-foreground hover:bg-gray-50 dark:hover:bg-gray-800")}>
                                {l}
                            </button>
                        ))}
                    </div>
                    <button onClick={fetchKanban}
                        className="flex items-center gap-1.5 rounded-lg bg-purple-500 px-3 py-2 text-sm font-medium text-white hover:bg-purple-600 transition-colors">
                        <RefreshCw className="h-4 w-4" /> Refresh
                    </button>
                </div>
            </div>

            {/* Stage Summary Bar */}
            <div className="grid grid-cols-5 gap-3">
                {stages.map(stage => {
                    const cfg = STAGE_CONFIG[stage];
                    return (
                        <div key={stage} className={cn("rounded-xl p-3 text-center", cfg.color.replace("border-l-4 ", ""))}>
                            <p className="text-xl mb-1">{cfg.emoji}</p>
                            <p className="text-lg font-bold text-foreground">{totals[stage] || 0}</p>
                            <p className="text-[10px] text-muted-foreground font-medium">{stage}</p>
                        </div>
                    );
                })}
            </div>

            {/* Error */}
            {error && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                    <div>
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">⚠️ Chưa có dữ liệu Product Lab</p>
                        <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                            Cần deploy SQL view: <code>sql/auus1/13_vw_product_test_summary.sql</code> vào BigQuery AUUS1_Dataset.
                        </p>
                    </div>
                </div>
            )}

            {/* Kanban Board */}
            <div className="flex gap-4 overflow-x-auto pb-4">
                {stages.map(stage => (
                    <KanbanColumn
                        key={stage}
                        stage={stage}
                        products={kanban[stage] || []}
                        onSelect={(code, market) => setSelected({ code, market })}
                    />
                ))}
            </div>

            {/* Product Detail Side Panel */}
            {selected && (
                <>
                    <div
                        className="fixed inset-0 bg-black/20 z-40"
                        onClick={() => setSelected(null)}
                    />
                    <ProductDetailPanel
                        code={selected.code}
                        market={selected.market}
                        onClose={() => setSelected(null)}
                    />
                </>
            )}
        </div>
    );
}
