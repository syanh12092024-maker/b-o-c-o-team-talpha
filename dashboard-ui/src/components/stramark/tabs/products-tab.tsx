"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Cell, ComposedChart, Line,
} from "recharts";
import { KPICard } from "@/components/ui/kpi-card";
import { formatCurrency, formatNumber, formatMoney, COLORS, cn } from "@/lib/utils";
import { DATASET } from "../constants";
import TabSkeleton from "@/components/ui/tab-skeleton";
import {
    Package, TrendingUp, TrendingDown, AlertTriangle, Star,
    Download, Warehouse, ArrowUpDown, BarChart3, ClipboardList,
    Sparkles, Loader2, ChevronRight, ChevronDown,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface ProductsTabProps {
    dateRange?: { from: Date; to: Date };
    subSlug?: string;
    onSubTabChange?: (subPath: string) => void;
}

const SUB_TAB_SLUG_MAP: Record<string, SubTab> = {
    "phan-tich-san-pham": "intelligence",
    "ton-kho": "inventory",
    "de-xuat-nhap-hang": "restock",
};
const SUB_TAB_ID_TO_SLUG: Record<SubTab, string> = {
    intelligence: "phan-tich-san-pham",
    inventory: "ton-kho",
    restock: "de-xuat-nhap-hang",
};

interface ProductData {
    product_code: string;
    product_name: string;
    orders: number;
    delivered: number;
    returned: number;
    revenue: number;
    cogs: number;
    gross_profit: number;
    margin: number;
    ads_spend: number;
    ffm_cost: number;
    return_rate: number;
    stock: number;
    sold_7d: number;
}

interface StockVariation {
    product_code: string;
    variation_id: string;
    product_name: string;
    variation_name: string;
    quantity_on_hand: number;
    pending_quantity: number;   // Hàng có phiếu nhập từ POS, chưa nhập kho
    returning_quantity: number; // Hàng đang trả về
    pos_selling_avg: number;   // Tốc độ bán TB/ngày từ POS
    retail_price: number;
    avg_cost: number;
    status: string;
    sold_7d: number;            // Total sold in filter date range (kept name for backward compat)
    active_days: number;        // Distinct days with ≥1 sale — denominator for effective velocity
    incoming_qty: number;       // Legacy: from pos_stock_in-out_history (fallback)
}

type SubTab = "intelligence" | "inventory" | "restock";
type SortKey = "revenue" | "margin" | "gross_profit" | "return_rate" | "stock" | "potential";
type FilterKey = "all" | "star" | "good" | "average" | "loss" | "cut";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

// Product grading (Net Margin% after COGS + Ads + 3PL)
// "Cắt mã" = bán hết hàng hiện tại, không nhập thêm
// Tiêu chí cắt: Return >40% HOẶC sold_7d <40 (margin không dùng vì revenue chỉ tính delivered)
function gradeProduct(margin: number, returnRate: number, sold7d: number = 999): { label: string; cls: string; key: FilterKey } {
    const shouldCut = returnRate > 40 || sold7d < 40;
    if (shouldCut) return { label: "⛔ Cắt mã", cls: "bg-red-500/20 text-red-400", key: "cut" };
    if (margin >= 30 && returnRate < 25) return { label: "⭐ Star", cls: "bg-emerald-500/20 text-emerald-400", key: "star" };
    if (margin >= 15) return { label: "Tốt", cls: "bg-emerald-500/15 text-emerald-400", key: "good" };
    return { label: "Trung bình", cls: "bg-amber-500/15 text-amber-400", key: "average" };
}

function calcPotentialScore(p: ProductData): number {
    let score = 0;
    // Scale margin contribution: 30% net margin = ~40 points
    score += Math.min(40, Math.max(0, (p.margin || 0) * 1.33));
    const dailySales = (p.sold_7d || 0) / 7;
    score += Math.min(20, dailySales * 2);
    score -= Math.min(20, (p.return_rate || 0) * 0.5);
    if (p.stock > 0 && dailySales > 0) {
        const daysOfStock = p.stock / dailySales;
        if (daysOfStock >= 15 && daysOfStock <= 60) score += 10;
        else if (daysOfStock > 0) score += 5;
    }
    score += Math.min(10, (p.revenue || 0) / 10000);
    return Math.max(0, Math.round(score));
}

function potentialLabel(score: number): { label: string; cls: string } {
    if (score >= 70) return { label: "🚀 Cao", cls: "text-emerald-400" };
    if (score >= 50) return { label: "📈 Khá", cls: "text-blue-400" };
    if (score >= 30) return { label: "⚖️ TB", cls: "text-amber-400" };
    return { label: "⚠️ Thấp", cls: "text-rose-400" };
}

function getRiskLevel(daysLeft: number, stock: number, dailySales: number): { label: string; cls: string; bgCls: string; priority: number } {
    if (stock === 0 && dailySales > 0) return { label: "Hết hàng", cls: "text-rose-400", bgCls: "bg-rose-500/20", priority: 0 };
    if (daysLeft <= 3) return { label: "Nguy cấp", cls: "text-rose-400", bgCls: "bg-rose-500/20", priority: 1 };
    if (daysLeft <= 7) return { label: "Cần nhập", cls: "text-orange-400", bgCls: "bg-orange-500/20", priority: 2 };
    if (daysLeft <= 14) return { label: "Theo dõi", cls: "text-amber-400", bgCls: "bg-amber-500/20", priority: 3 };
    return { label: "Ổn định", cls: "text-emerald-400", bgCls: "bg-emerald-500/20", priority: 4 };
}

const CHART_COLORS = ["#34d399", "#3b82f6", "#06b6d4", "#a855f7", "#f59e0b", "#ec4899", "#14b8a6", "#f97316"];

const SUB_TABS: { id: SubTab; label: string; icon: any; desc: string; color: string }[] = [
    { id: "intelligence", label: "Phân tích sản phẩm", icon: BarChart3, desc: "Star products · Margin · Return rate · Xếp hạng", color: "indigo" },
    { id: "inventory", label: "Tồn kho", icon: Warehouse, desc: "SKU · Khả dụng · Đang nhập · Bán/ngày", color: "amber" },
    { id: "restock", label: "Đề xuất nhập hàng", icon: ClipboardList, desc: "15d / 30d · Chi phí nhập · Rủi ro hết hàng", color: "rose" },
];

const PRODUCTS_COLOR_MAP: Record<string, { border: string; bg: string; icon: string; iconBg: string; text: string; hoverBg: string; hoverBorder: string; ring: string; dot: string; badgeBg: string; badgeText: string }> = {
    indigo: { border: "border-indigo-500", bg: "bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950/40 dark:to-violet-950/30", icon: "bg-indigo-500 text-white shadow-lg shadow-indigo-500/30", iconBg: "group-hover:bg-indigo-100 group-hover:text-indigo-600 dark:group-hover:bg-indigo-900/40", text: "text-indigo-700 dark:text-indigo-300", hoverBg: "hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20", hoverBorder: "hover:border-indigo-300", ring: "ring-2 ring-indigo-500/20", dot: "bg-indigo-500", badgeBg: "bg-indigo-500", badgeText: "text-white" },
    amber: { border: "border-amber-500", bg: "bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/30", icon: "bg-amber-500 text-white shadow-lg shadow-amber-500/30", iconBg: "group-hover:bg-amber-100 group-hover:text-amber-600 dark:group-hover:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300", hoverBg: "hover:bg-amber-50/40 dark:hover:bg-amber-950/20", hoverBorder: "hover:border-amber-300", ring: "ring-2 ring-amber-500/20", dot: "bg-amber-500", badgeBg: "bg-amber-500", badgeText: "text-white" },
    rose: { border: "border-rose-500", bg: "bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-950/40 dark:to-pink-950/30", icon: "bg-rose-500 text-white shadow-lg shadow-rose-500/30", iconBg: "group-hover:bg-rose-100 group-hover:text-rose-600 dark:group-hover:bg-rose-900/40", text: "text-rose-700 dark:text-rose-300", hoverBg: "hover:bg-rose-50/40 dark:hover:bg-rose-950/20", hoverBorder: "hover:border-rose-300", ring: "ring-2 ring-rose-500/20", dot: "bg-rose-500", badgeBg: "bg-rose-500", badgeText: "text-white" },
};

// ═══════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════

export default function ProductsTab({ dateRange, subSlug, onSubTabChange }: ProductsTabProps) {
    const resolvedSubTab: SubTab = (subSlug && SUB_TAB_SLUG_MAP[subSlug]) || "intelligence";
    const [internalSubTab, setInternalSubTab] = useState<SubTab>(resolvedSubTab);
    const subTab = onSubTabChange ? resolvedSubTab : internalSubTab;
    const setSubTab = (t: SubTab) => {
        if (onSubTabChange) onSubTabChange(SUB_TAB_ID_TO_SLUG[t]);
        else setInternalSubTab(t);
    };
    const [loading, setLoading] = useState(true);
    const [products, setProducts] = useState<ProductData[]>([]);
    const [stockVariations, setStockVariations] = useState<StockVariation[]>([]);
    // Last time product_stock got refreshed in BQ (cron daily 03:00 UTC).
    // Surfaced on the Tồn kho tab so users know how stale the numbers are.
    const [stockSyncedAt, setStockSyncedAt] = useState<string | null>(null);
    // Daily ads/revenue per SKU for the trend chart. Map: date → product_code → {spend_vnd, revenue_vnd}.
    const [dailyByProduct, setDailyByProduct] = useState<Map<string, Map<string, { spend_vnd: number; revenue_vnd: number }>>>(new Map());
    const [chartProductFilter, setChartProductFilter] = useState<string>("ALL");
    const [sortBy, setSortBy] = useState<SortKey>("revenue");
    const [sortAsc, setSortAsc] = useState(false);
    const [filterBy, setFilterBy] = useState<FilterKey>("all");

    // AI Restock state
    const [aiLoading, setAiLoading] = useState(false);
    const [aiResult, setAiResult] = useState<any>(null);
    const [aiError, setAiError] = useState<string | null>(null);
    // Conversational follow-up with AI on the restock subtab
    const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string; ts: string }>>([]);
    const [chatInput, setChatInput] = useState("");
    const [chatSending, setChatSending] = useState(false);

    // Grouped table expand state
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    // ── Consolidated Data Fetch ──
    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                const from = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : "2025-10-15";
                const to = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

                const queries = [
                    // Q0: Product P&L from mart + recalculated COGS + 3PL cost per product
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
                    -- 3PL cost per product: split ffm_shipments cost across products in each order
                    -- EUR → RON conversion rate ~5.0 (1 EUR ≈ 5 RON)
                    ffm_per_product AS (
                        SELECT
                            COALESCE(pt.custom_id, 'UNKNOWN') as product_code,
                            ROUND(SUM(
                                s.price_incl_vat * 5.0 / items_per_order.item_count
                            ), 0) as ffm_cost_ron
                        FROM ${DATASET}.ffm_shipments s
                        JOIN ${DATASET}.sale_order so ON s.ref_number = CAST(so.id AS STRING)
                        JOIN ${DATASET}.order_items oi ON so.id = oi.order_id
                        LEFT JOIN ${DATASET}.product_template pt ON oi.product_id = pt.id
                        JOIN (
                            SELECT order_id, COUNT(DISTINCT product_id) as item_count
                            FROM ${DATASET}.order_items GROUP BY 1
                        ) items_per_order ON so.id = items_per_order.order_id
                        WHERE s.price_incl_vat > 0
                            AND DATE(COALESCE(s.created_date, s.synced_at)) BETWEEN '${from}' AND '${to}'
                        GROUP BY 1
                    ),
                    mart_agg AS (
                        SELECT
                            pi.product_code, pi.product_name,
                            SUM(pi.order_count) as orders,
                            SUM(pi.units_delivered) as delivered,
                            SUM(pi.units_returned) as returned,
                            ROUND(SUM(pi.delivered_revenue),0) as revenue,
                            ROUND(SUM(pi.ads_spend_ron),0) as ads_spend,
                            ROUND(AVG(pi.product_return_rate),1) as return_rate
                        FROM ${DATASET}.mart_product_insights pi
                        WHERE pi.report_date BETWEEN '${from}' AND '${to}'
                        GROUP BY 1,2
                    )
                    SELECT
                        m.product_code, m.product_name,
                        m.orders, m.delivered, m.returned,
                        m.revenue,
                        COALESCE(cf.delivered_cogs_fixed, 0) as cogs,
                        ROUND(m.revenue - COALESCE(cf.delivered_cogs_fixed, 0), 0) as gross_profit,
                        m.ads_spend,
                        COALESCE(fp.ffm_cost_ron, 0) as ffm_cost,
                        -- Net Margin% = (Revenue - COGS - Ads - 3PL) / Revenue × 100
                        ROUND(SAFE_DIVIDE(
                            m.revenue - COALESCE(cf.delivered_cogs_fixed, 0) - m.ads_spend - COALESCE(fp.ffm_cost_ron, 0),
                            NULLIF(m.revenue, 0)
                        ) * 100, 1) as margin,
                        m.return_rate
                    FROM mart_agg m
                    LEFT JOIN cogs_fallback cf ON UPPER(TRIM(m.product_code)) = UPPER(TRIM(cf.product_code))
                    LEFT JOIN ffm_per_product fp ON UPPER(TRIM(m.product_code)) = UPPER(TRIM(fp.product_code))
                    ORDER BY revenue DESC
                    LIMIT 30`,

                    // Q1: Stock per variation (SKU-level detail) + pending imports from POS
                    `SELECT
                        COALESCE(pt.custom_id, ps.product_code, 'N/A') as product_code,
                        ps.variation_id,
                        ps.product_name,
                        ps.variation_name,
                        SAFE_CAST(ps.quantity_on_hand AS INT64) as quantity_on_hand,
                        COALESCE(SAFE_CAST(ps.pending_quantity AS INT64), 0) as pending_quantity,
                        COALESCE(SAFE_CAST(ps.returning_quantity AS INT64), 0) as returning_quantity,
                        COALESCE(SAFE_CAST(ps.selling_avg AS FLOAT64), 0) as pos_selling_avg,
                        SAFE_CAST(ps.retail_price AS FLOAT64) as retail_price,
                        SAFE_CAST(ps.avg_cost AS FLOAT64) as avg_cost,
                        ps.status,
                        CAST(ps.sync_time AS STRING) as sync_time
                    FROM ${DATASET}.product_stock ps
                    LEFT JOIN ${DATASET}.product_template pt ON ps.product_id = pt.id
                    ORDER BY product_code, variation_name`,

                    // Q2: Sales velocity per variation over the FILTERED date range.
                    // Returns total sold + active selling days (days with ≥1 sale) so the
                    // frontend can compute effective velocity = sold / active_days. Without
                    // active_days, products that were stocked-out (or had ads paused) for
                    // part of the range got their daily rate diluted by zero-sale days.
                    `SELECT
                        COALESCE(pt.custom_id, 'N/A') as product_code,
                        oi.variation_id,
                        SUM(SAFE_CAST(oi.quantity AS INT64)) as sold_total,
                        COUNT(DISTINCT o.order_date) as active_days
                    FROM ${DATASET}.fact_order_items_dedup oi
                    LEFT JOIN ${DATASET}.product_template pt ON oi.product_id = pt.id
                    LEFT JOIN ${DATASET}.vw_fact_orders o ON oi.order_id = o.order_id
                    WHERE o.order_date BETWEEN '${from}' AND '${to}'
                        AND o.status_group != 'canceled'
                    GROUP BY 1, 2`,

                    // Q3: Daily ads spend per SKU (proportional UTM attribution).
                    // Same methodology as CEO Q12 but with daily breakdown — per campaign,
                    // allocate that day's spend by SKU's share of the campaign's POS orders
                    // over the whole period (share is constant across days, simpler & stable).
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
                         AND (CAST(fa.ad_id AS STRING) = oc.p_utm_term OR fa.campaign_name = oc.p_utm_campaign)
                    ),
                    campaign_totals AS (
                        SELECT campaign_id, COUNT(DISTINCT order_id) AS total_orders
                        FROM order_to_campaign GROUP BY 1
                    ),
                    campaign_product_orders AS (
                        SELECT campaign_id, UPPER(code) AS product_code, COUNT(DISTINCT order_id) AS product_orders
                        FROM order_to_campaign, UNNEST(product_codes) AS code
                        WHERE code IS NOT NULL
                        GROUP BY 1, 2
                    )
                    SELECT
                        CAST(fa.date AS STRING) AS date,
                        cpo.product_code,
                        ROUND(SUM(fa.spend * cpo.product_orders / ct.total_orders), 2) AS ads_spend_usd
                    FROM ${DATASET}.fb_ads_data fa
                    JOIN campaign_product_orders cpo ON fa.campaign_id = cpo.campaign_id
                    JOIN campaign_totals ct ON cpo.campaign_id = ct.campaign_id
                    WHERE fa.date BETWEEN '${from}' AND '${to}' AND ct.total_orders > 0
                    GROUP BY 1, 2`,

                    // Q4: Daily POS booking revenue per SKU — same revenue source as Ads
                    // Command Center (uses order.cod regardless of delivery status, so ROAS
                    // isn't pinned to delivered orders that lag the spend by ~14 days).
                    // Multi-SKU orders allocate cod proportionally by line-item value share.
                    // EUR orders converted to RON-equivalent via 30667/5946 ≈ 5.158.
                    `WITH order_cod AS (
                        SELECT
                            so.id,
                            CAST(DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at)) AS STRING) AS order_date,
                            SAFE_CAST(COALESCE(so.cod, so.total_price, 0) AS FLOAT64) / 100.0
                              * CASE WHEN UPPER(so.order_currency) = 'EUR' THEN 5.158 ELSE 1 END
                              AS cod_ron
                        FROM ${DATASET}.sale_order so
                        WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', so.inserted_at)) BETWEEN '${from}' AND '${to}'
                          AND COALESCE(SAFE_CAST(so.status AS INT64), 0) != 7
                    ),
                    item_values AS (
                        -- Allocate by quantity since order_items.retail_price is mostly 0
                        SELECT
                            oi.order_id,
                            UPPER(COALESCE(
                                pt.custom_id,
                                REGEXP_EXTRACT(oi.product_name, r'^([A-Z]\\d+)'),
                                REGEXP_EXTRACT(oi.variation_name, r'^([A-Z]\\d+)')
                            )) AS product_code,
                            SAFE_CAST(oi.quantity AS INT64) AS item_qty
                        FROM ${DATASET}.order_items oi
                        LEFT JOIN ${DATASET}.product_template pt ON oi.product_id = pt.id
                    ),
                    order_total_qty AS (
                        SELECT order_id, SUM(item_qty) AS total_qty
                        FROM item_values
                        WHERE product_code IS NOT NULL
                        GROUP BY 1
                    )
                    SELECT
                        oc.order_date AS date,
                        iv.product_code,
                        ROUND(SUM(oc.cod_ron * iv.item_qty / NULLIF(otq.total_qty, 0)), 0) AS revenue_ron
                    FROM order_cod oc
                    JOIN item_values iv ON oc.id = iv.order_id
                    JOIN order_total_qty otq ON oc.id = otq.order_id
                    WHERE iv.product_code IS NOT NULL AND otq.total_qty > 0
                    GROUP BY 1, 2`,

                ];

                const results = await Promise.all(
                    queries.map((q) =>
                        fetch("/api/query", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q }),
                        }).then((r) => r.json()).catch(() => ({ data: [] }))
                    )
                );

                // ── Process Product P&L ──
                const productData: ProductData[] = (results[0].data || []);

                // ── Build variation-level maps ──
                const velocityByVariation = new Map<string, { sold: number; active_days: number }>();
                (results[2].data || []).forEach((v: any) => {
                    velocityByVariation.set(v.variation_id, {
                        sold: v.sold_total || 0,
                        active_days: v.active_days || 0,
                    });
                });
                // pending_quantity now comes directly from product_stock (POS phiếu nhập)
                // No need for separate pos_stock_in-out_history query

                // ── Build stock variations (SKU-level) ──
                const variations: StockVariation[] = (results[1].data || []).map((s: any) => {
                    const v = velocityByVariation.get(s.variation_id);
                    return {
                        product_code: s.product_code || "N/A",
                        variation_id: s.variation_id || "",
                        product_name: s.product_name || "",
                        variation_name: s.variation_name || "",
                        quantity_on_hand: s.quantity_on_hand || 0,
                        pending_quantity: s.pending_quantity || 0,
                        returning_quantity: s.returning_quantity || 0,
                        pos_selling_avg: s.pos_selling_avg || 0,
                        retail_price: s.retail_price || 0,
                        avg_cost: s.avg_cost || 0,
                        status: s.status || "unknown",
                        sold_7d: v?.sold || 0,         // total sold in range
                        active_days: v?.active_days || 0,
                        incoming_qty: s.pending_quantity || 0,
                    };
                });

                // ── Aggregate to product level for P&L enrichment ──
                const stockByProduct = new Map<string, number>();
                const velocityByProduct = new Map<string, number>();
                variations.forEach((v) => {
                    stockByProduct.set(v.product_code, (stockByProduct.get(v.product_code) || 0) + v.quantity_on_hand);
                    velocityByProduct.set(v.product_code, (velocityByProduct.get(v.product_code) || 0) + v.sold_7d);
                });
                (results[2].data || []).forEach((v: any) => {
                    const code = v.product_code;
                    if (code && !velocityByProduct.has(code)) {
                        velocityByProduct.set(code, (velocityByProduct.get(code) || 0) + (v.sold_total || 0));
                    }
                });

                productData.forEach((p) => {
                    p.stock = stockByProduct.get(p.product_code) || 0;
                    p.sold_7d = velocityByProduct.get(p.product_code) || 0;
                });

                setProducts(productData);
                setStockVariations(variations);
                // sync_time is identical across rows (cron writes whole table at once)
                const firstRow = (results[1].data || [])[0];
                if (firstRow?.sync_time) {
                    const raw = firstRow.sync_time;
                    setStockSyncedAt(typeof raw === "string" ? raw : (raw.value || null));
                }

                // ── Build daily ads × revenue per SKU (Q3 + Q4) ──
                // USD spend → VND directly via USD_TO_VND. RON revenue → VND via RON_TO_VND.
                const USD_TO_VND = 26325;
                const RON_TO_VND = 5946;
                const daily = new Map<string, Map<string, { spend_vnd: number; revenue_vnd: number }>>();
                const ensure = (date: string, code: string) => {
                    let day = daily.get(date);
                    if (!day) { day = new Map(); daily.set(date, day); }
                    let cell = day.get(code);
                    if (!cell) { cell = { spend_vnd: 0, revenue_vnd: 0 }; day.set(code, cell); }
                    return cell;
                };
                (results[3]?.data || []).forEach((r: any) => {
                    const date = r.date?.value || r.date;
                    if (!date || !r.product_code) return;
                    ensure(String(date), String(r.product_code).toUpperCase()).spend_vnd += Math.round((r.ads_spend_usd || 0) * USD_TO_VND);
                });
                (results[4]?.data || []).forEach((r: any) => {
                    const date = r.date?.value || r.date;
                    if (!date || !r.product_code) return;
                    ensure(String(date), String(r.product_code).toUpperCase()).revenue_vnd += Math.round((r.revenue_ron || 0) * RON_TO_VND);
                });
                setDailyByProduct(daily);
            } catch (error) {
                console.error("Product data fetch error:", error);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [dateRange]);

    if (loading) return <TabSkeleton cards={4} showChart={false} rows={8} />;

    // ═══════════════════════════════════════════════════════════════════
    // Computed Values — Intelligence
    // ═══════════════════════════════════════════════════════════════════

    const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
    const totalGross = products.reduce((s, p) => s + p.gross_profit, 0);
    const totalAds = products.reduce((s, p) => s + p.ads_spend, 0);
    const totalFfm = products.reduce((s, p) => s + (p.ffm_cost || 0), 0);
    const netProfit = totalGross - totalAds - totalFfm;
    const avgMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100) : 0;
    // Use gradeProduct() for consistent counting
    const cutCount = products.filter((p) => gradeProduct(p.margin || 0, p.return_rate || 0, p.sold_7d || 0).key === "cut").length;
    const nonCut = products.filter((p) => gradeProduct(p.margin || 0, p.return_rate || 0, p.sold_7d || 0).key !== "cut");
    const starCount = nonCut.filter((p) => gradeProduct(p.margin || 0, p.return_rate || 0, p.sold_7d || 0).key === "star").length;
    const goodCount = nonCut.filter((p) => gradeProduct(p.margin || 0, p.return_rate || 0, p.sold_7d || 0).key === "good").length;
    const lossCount = nonCut.filter((p) => {
        const k = gradeProduct(p.margin || 0, p.return_rate || 0, p.sold_7d || 0).key;
        return k === "average" || k === "loss";
    }).length;

    const sortedProducts = [...products]
        .filter((p) => {
            if (filterBy === "all") return true;
            return gradeProduct(p.margin || 0, p.return_rate || 0, p.sold_7d || 0).key === filterBy;
        })
        .sort((a, b) => {
            let va: number, vb: number;
            if (sortBy === "potential") { va = calcPotentialScore(a); vb = calcPotentialScore(b); }
            else { va = (a as any)[sortBy] || 0; vb = (b as any)[sortBy] || 0; }
            return sortAsc ? va - vb : vb - va;
        });

    // ── Daily ads × ROAS chart data, optionally filtered by SKU ──
    const dailyTrendChart = (() => {
        const dates = Array.from(dailyByProduct.keys()).sort();
        const filterCode = chartProductFilter !== "ALL" ? chartProductFilter : null;
        return dates.map((date) => {
            const day = dailyByProduct.get(date)!;
            let spend_vnd = 0, revenue_vnd = 0;
            if (filterCode) {
                const cell = day.get(filterCode);
                if (cell) { spend_vnd = cell.spend_vnd; revenue_vnd = cell.revenue_vnd; }
            } else {
                day.forEach((cell) => { spend_vnd += cell.spend_vnd; revenue_vnd += cell.revenue_vnd; });
            }
            return {
                date: date.slice(5), // MM-DD
                spend_vnd,
                revenue_vnd,
                roas: spend_vnd > 0 ? Math.round((revenue_vnd / spend_vnd) * 100) / 100 : 0,
            };
        });
    })();

    // List of SKUs to populate the dropdown — sorted by total spend across the period.
    const chartProductOptions = (() => {
        const totals = new Map<string, number>();
        dailyByProduct.forEach((day) => {
            day.forEach((cell, code) => {
                totals.set(code, (totals.get(code) || 0) + cell.spend_vnd);
            });
        });
        return Array.from(totals.entries())
            .filter(([, spend]) => spend > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([code]) => code);
    })();

    const top8 = products.filter((p) => p.revenue > 0).slice(0, 8);
    const revVsProfitChart = top8.map((p) => ({
        name: p.product_code || p.product_name?.substring(0, 10),
        revenue: p.revenue, gross_profit: p.gross_profit, ads_spend: p.ads_spend,
    }));
    const marginChart = top8.map((p) => ({
        name: p.product_code || p.product_name?.substring(0, 10),
        margin: p.margin || 0, return_rate: p.return_rate || 0, potential: calcPotentialScore(p),
    }));

    // ═══════════════════════════════════════════════════════════════════
    // Computed Values — Inventory
    // ═══════════════════════════════════════════════════════════════════

    const totalStockUnits = stockVariations.reduce((s, v) => s + v.quantity_on_hand, 0);
    const totalStockValue = stockVariations.reduce((s, v) => s + (v.quantity_on_hand * v.avg_cost), 0);
    const outOfStockCount = stockVariations.filter((v) => v.quantity_on_hand <= 0).length;
    const totalVariations = stockVariations.length;

    // ═══════════════════════════════════════════════════════════════════
    // Computed Values — Restock Suggestions
    // ═══════════════════════════════════════════════════════════════════

    const restockItems = stockVariations
        .map((v) => {
            // Effective velocity: sold / active_days. Falls back to /7 only when we somehow
            // have sales but no day count (legacy data). Otherwise zero — no sales = no velocity.
            const dailyAvg = v.active_days > 0
                ? (v.sold_7d || 0) / v.active_days
                : ((v.sold_7d || 0) > 0 ? (v.sold_7d || 0) / 7 : 0);
            const available = v.quantity_on_hand + v.incoming_qty;
            const daysLeft = dailyAvg > 0 ? available / dailyAvg : 9999;
            const need10d = Math.max(0, Math.round(dailyAvg * 10 - available));
            const need15d = Math.max(0, Math.round(dailyAvg * 15 - available));
            const need20d = Math.max(0, Math.round(dailyAvg * 20 - available));
            const need30d = Math.max(0, Math.round(dailyAvg * 30 - available));
            const risk = getRiskLevel(daysLeft, v.quantity_on_hand, dailyAvg);
            return {
                ...v, dailyAvg: Math.round(dailyAvg * 10) / 10,
                available, daysLeft: Math.round(daysLeft * 10) / 10,
                need10d, need15d, need20d, need30d,
                cost15d: need15d * v.avg_cost, cost30d: need30d * v.avg_cost,
                risk,
            };
        })
        .filter((v) => v.dailyAvg > 0 || v.quantity_on_hand > 0)
        .sort((a, b) => a.risk.priority - b.risk.priority || a.daysLeft - b.daysLeft);

    const criticalCount = restockItems.filter((r) => r.risk.priority <= 1).length;
    const needRestockCount = restockItems.filter((r) => r.risk.priority <= 2).length;
    const totalInvestment15d = restockItems.reduce((s, r) => s + r.cost15d, 0);
    const totalInvestment30d = restockItems.reduce((s, r) => s + r.cost30d, 0);

    // ═══════════════════════════════════════════════════════════════════
    // AI Restock Suggestion
    // ═══════════════════════════════════════════════════════════════════

    const fetchAiSuggestion = async () => {
        setAiLoading(true);
        setAiError(null);
        try {
            const res = await fetch("/api/ai-brain/restock-suggest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    stockData: stockVariations,
                    productContext: products,
                }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                setAiError(data.error || `Lỗi ${res.status}`);
            } else {
                setAiResult(data);
            }
        } catch (err: any) {
            setAiError(err.message || "Không thể kết nối AI");
        } finally {
            setAiLoading(false);
        }
    };

    const sendChatMessage = async (overrideText?: string) => {
        const text = (overrideText ?? chatInput).trim();
        if (!text || chatSending) return;
        const ts = new Date().toISOString();
        const newUserMsg = { role: "user" as const, content: text, ts };
        const updated = [...chatMessages, newUserMsg];
        setChatMessages(updated);
        setChatInput("");
        setChatSending(true);
        try {
            const res = await fetch("/api/ai-brain/restock-chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: updated.map(m => ({ role: m.role, content: m.content })),
                    stockData: stockVariations,
                    productContext: products,
                    lastSuggestion: aiResult,
                }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                setChatMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${data.error || `Lỗi ${res.status}`}`, ts: new Date().toISOString() }]);
            } else {
                setChatMessages(prev => [...prev, { role: "assistant", content: data.reply || "(trống)", ts: data.timestamp || new Date().toISOString() }]);
            }
        } catch (err: any) {
            setChatMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${err.message || "Lỗi kết nối"}`, ts: new Date().toISOString() }]);
        } finally {
            setChatSending(false);
        }
    };
    const resetChat = () => setChatMessages([]);

    // Build AI suggestion map for table overlay
    const aiSuggestMap = new Map<string, any>();
    if (aiResult?.suggestions) {
        for (const s of aiResult.suggestions) {
            const key = `${s.product_code}|${s.variation_name}`;
            aiSuggestMap.set(key, s);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // Stockout Alerts (from restockItems — includes pending + AI)
    // ═══════════════════════════════════════════════════════════════════

    const stockoutAlertMap = new Map<string, {
        product_code: string; product_name: string;
        stock: number; pending: number; available: number;
        dailySales: number; daysLeft: number;
        skuCount: number; criticalSkus: number;
        restock30d: number; aiPriority?: string;
    }>();
    for (const r of restockItems) {
        if (r.risk.priority > 2) continue; // only urgent/critical/need-restock (≤7d)
        const aiRow = aiSuggestMap.get(`${r.product_code}|${r.variation_name || "default"}`);
        const existing = stockoutAlertMap.get(r.product_code);
        const restock30 = aiRow?.restock_30d ?? r.need30d;
        if (!existing) {
            stockoutAlertMap.set(r.product_code, {
                product_code: r.product_code, product_name: r.product_name,
                stock: r.quantity_on_hand, pending: r.incoming_qty, available: r.available,
                dailySales: r.dailyAvg, daysLeft: r.daysLeft,
                skuCount: 1, criticalSkus: r.risk.priority <= 1 ? 1 : 0,
                restock30d: restock30, aiPriority: aiRow?.priority,
            });
        } else {
            existing.stock += r.quantity_on_hand;
            existing.pending += r.incoming_qty;
            existing.available += r.available;
            existing.dailySales += r.dailyAvg;
            existing.daysLeft = Math.min(existing.daysLeft, r.daysLeft);
            existing.skuCount++;
            if (r.risk.priority <= 1) existing.criticalSkus++;
            existing.restock30d += restock30;
            if (aiRow?.priority === "urgent") existing.aiPriority = "urgent";
        }
    }
    const stockoutAlerts = [...stockoutAlertMap.values()]
        .sort((a, b) => a.daysLeft - b.daysLeft);

    // ═══════════════════════════════════════════════════════════════════
    // CSV Downloads
    // ═══════════════════════════════════════════════════════════════════

    const downloadProductCSV = () => {
        const headers = ["Mã SP", "Tên SP", "Đơn hàng", "Giao", "Hoàn", "Revenue (RON)", "COGS", "Gross Profit", "Ads Spend", "3PL Cost", "Net Margin%", "Net P&L", "Return%", "Tồn kho", "Bán 7d", "Potential", "Xếp hạng"];
        const rows = products.map((p) => {
            const netPnl = p.gross_profit - p.ads_spend - (p.ffm_cost || 0);
            const grade = gradeProduct(p.margin || 0, p.return_rate || 0, p.sold_7d || 0);
            const pot = calcPotentialScore(p);
            return [p.product_code, `"${(p.product_name || "").replace(/"/g, '""')}"`, p.orders, p.delivered, p.returned, p.revenue, p.cogs, p.gross_profit, p.ads_spend, p.ffm_cost || 0, p.margin, netPnl, p.return_rate, p.stock, p.sold_7d, pot, grade.label].join(",");
        });
        const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csv));
        link.setAttribute("download", `product_intelligence_${format(new Date(), "yyyy-MM-dd")}.csv`);
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };

    const downloadRestockCSV = () => {
        const headers = ["Mã SP", "Tên SP", "Phiên bản", "Tồn kho", "Đang nhập", "Khả dụng", "Bán/ngày (theo ngày có bán)", "Còn đủ (ngày)", "Cần nhập (15 ngày)", "Cần nhập (30 ngày)", "Chi phí 15d (RON)", "Chi phí 30d (RON)", "Rủi ro"];
        const rows = restockItems.map((r) =>
            [r.product_code, `"${(r.product_name || "").replace(/"/g, '""')}"`, `"${(r.variation_name || "").replace(/"/g, '""')}"`, r.quantity_on_hand, r.incoming_qty, r.available, r.dailyAvg, r.daysLeft, r.need15d, r.need30d, r.cost15d.toFixed(2), r.cost30d.toFixed(2), r.risk.label].join(",")
        );
        const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csv));
        link.setAttribute("download", `restock_suggestions_${format(new Date(), "yyyy-MM-dd")}.csv`);
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };

    // ═══════════════════════════════════════════════════════════════════
    // Sort Handler
    // ═══════════════════════════════════════════════════════════════════

    const handleSort = (key: SortKey) => {
        if (sortBy === key) setSortAsc(!sortAsc);
        else { setSortBy(key); setSortAsc(false); }
    };

    const SortHeader = ({ label, sortKey, className = "" }: { label: string; sortKey: SortKey; className?: string }) => (
        <th className={cn("px-2 pb-2 font-medium cursor-pointer hover:text-foreground transition-colors select-none", className)} onClick={() => handleSort(sortKey)}>
            <span className="flex items-center gap-1 justify-end">
                {label}
                {sortBy === sortKey && <ArrowUpDown className="h-3 w-3 text-indigo-400" />}
            </span>
        </th>
    );

    // ═══════════════════════════════════════════════════════════════════
    // Render
    // ═══════════════════════════════════════════════════════════════════

    return (
        <div className="space-y-6">
            {/* ── Sub-tab Navigation (prominent card layout) ── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {SUB_TABS.map((tab) => {
                    const badge = tab.id === "restock" ? needRestockCount : tab.id === "inventory" ? outOfStockCount : 0;
                    const c = PRODUCTS_COLOR_MAP[tab.color];
                    const isActive = subTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setSubTab(tab.id)}
                            className={cn(
                                "group relative flex items-center gap-4 rounded-xl border p-4 text-left transition-all",
                                isActive
                                    ? `${c.border} ${c.bg} shadow-md ${c.ring}`
                                    : `border-border bg-card ${c.hoverBorder} ${c.hoverBg}`
                            )}
                        >
                            <div className={cn(
                                "flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                                isActive
                                    ? c.icon
                                    : `bg-muted text-muted-foreground ${c.iconBg}`
                            )}>
                                <tab.icon className="w-6 h-6" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <h3 className={cn(
                                        "text-sm font-bold",
                                        isActive ? c.text : "text-foreground"
                                    )}>
                                        {tab.label}
                                    </h3>
                                    {badge > 0 && (
                                        <span className={cn(
                                            "inline-flex items-center justify-center rounded-full text-[10px] font-bold px-1.5 py-0.5 min-w-[18px] h-[18px] shadow animate-pulse",
                                            c.badgeBg, c.badgeText
                                        )}>
                                            {badge}
                                        </span>
                                    )}
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                                    {tab.desc}
                                </p>
                            </div>
                            {isActive && (
                                <div className={cn("absolute top-2 right-2 w-2 h-2 rounded-full animate-pulse", c.dot)} />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* SUB-TAB 1: Phân tích sản phẩm (Intelligence)             */}
            {/* ═══════════════════════════════════════════════════════════ */}
            {subTab === "intelligence" && (
                <>
                    {/* KPI Row 1: Product Grading */}
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <KPICard title="Star Products" value={String(starCount)} icon={Star} status="success" subValue="Margin ≥30% · Return <25%" />
                        <KPICard title="Sản phẩm tốt" value={String(goodCount)} icon={TrendingUp} status="success" subValue="Margin ≥15%" />
                        <KPICard title="Còn lại" value={String(lossCount)} icon={TrendingDown} status={lossCount > 0 ? "warning" : "neutral"} subValue="Trung bình / Yếu" />
                        <KPICard title="Nên cắt mã" value={String(cutCount)} icon={TrendingDown} status={cutCount > 0 ? "danger" : "neutral"} subValue="Return >40% | 7d <40sp" />
                    </div>
                    {/* KPI Row 2: Financial Summary */}
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <KPICard title="Revenue" value={formatCurrency(totalRevenue)} icon={TrendingUp} subValue={`${products.length} sản phẩm`} />
                        <KPICard title="Gross Profit" value={formatCurrency(totalGross)} status={totalGross >= 0 ? "success" : "danger"} subValue={`COGS: ${formatCurrency(totalRevenue - totalGross)}`} />
                        <KPICard title="Net P&L" value={formatCurrency(netProfit)} status={netProfit >= 0 ? "success" : "danger"} subValue={`Ads: ${formatCurrency(totalAds)} · 3PL: ${formatCurrency(totalFfm)}`} />
                        <KPICard title="Avg Net Margin" value={`${avgMargin.toFixed(1)}%`} icon={TrendingUp} status={avgMargin >= 15 ? "success" : avgMargin >= 0 ? "warning" : "danger"} subValue="(Rev - COGS - Ads - 3PL) / Rev" />
                    </div>

                    {/* Stockout Alert Banner — from restockItems (includes pending + AI) */}
                    {stockoutAlerts.length > 0 && (
                        <div className="rounded-xl border-2 border-rose-500/50 bg-rose-500/5 p-4">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="h-5 w-5 text-rose-400 mt-0.5 flex-shrink-0 animate-pulse" />
                                <div className="flex-1">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-bold text-rose-400 mb-1">
                                            ⚠️ Cảnh báo hết hàng trong 7 ngày — {stockoutAlerts.length} sản phẩm cần nhập gấp
                                        </h4>
                                        <button onClick={() => setSubTab("restock")} className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
                                            {aiResult ? "Xem AI đề xuất →" : "Xem đề xuất nhập hàng →"}
                                        </button>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground mb-3">
                                        Dựa trên: tồn kho + phiếu nhập POS đang chờ + tốc độ bán 7 ngày.
                                        {aiResult && <span className="text-purple-400 ml-1">Đã có phân tích AI.</span>}
                                    </p>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="border-b border-rose-500/20 text-muted-foreground">
                                                    <th className="px-2 pb-1.5 text-left font-medium">Sản phẩm</th>
                                                    <th className="px-2 pb-1.5 text-right font-medium">Tồn kho</th>
                                                    <th className="px-2 pb-1.5 text-right font-medium">Đang nhập</th>
                                                    <th className="px-2 pb-1.5 text-right font-medium">Bán/ngày</th>
                                                    <th className="px-2 pb-1.5 text-right font-medium">Còn đủ</th>
                                                    <th className="px-2 pb-1.5 text-right font-medium">{aiResult ? "AI nhập 30d" : "Nên nhập (30d)"}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {stockoutAlerts.map((a) => (
                                                    <tr key={a.product_code} className="border-b border-rose-500/10">
                                                        <td className="px-2 py-1.5">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="font-semibold text-foreground">{a.product_code}</span>
                                                                {a.criticalSkus > 0 && <span className="text-[9px] text-rose-400">({a.criticalSkus} SKU nguy cấp)</span>}
                                                            </div>
                                                            <div className="text-[10px] text-muted-foreground max-w-[200px] truncate" title={a.product_name}>{a.product_name?.substring(0, 35)}</div>
                                                        </td>
                                                        <td className={cn("px-2 py-1.5 text-right font-medium", a.stock <= 0 ? "text-rose-400" : "text-foreground")}>{formatNumber(a.stock)}</td>
                                                        <td className="px-2 py-1.5 text-right text-cyan-400">{a.pending > 0 ? `+${formatNumber(a.pending)}` : "—"}</td>
                                                        <td className="px-2 py-1.5 text-right text-indigo-400">{a.dailySales > 0 ? (Math.round(a.dailySales * 10) / 10) : "—"}</td>
                                                        <td className={cn("px-2 py-1.5 text-right font-bold",
                                                            a.daysLeft <= 3 ? "text-rose-400" : a.daysLeft <= 5 ? "text-orange-400" : "text-amber-400")}>
                                                            {a.daysLeft}d {a.daysLeft <= 3 ? "🔥" : ""}
                                                        </td>
                                                        <td className={cn("px-2 py-1.5 text-right font-semibold", aiResult ? "text-purple-400" : "text-emerald-400")}>
                                                            +{formatNumber(a.restock30d)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground mt-2">
                                        💡 <strong>Còn đủ</strong> = (tồn kho + đang nhập) ÷ tốc độ bán. <strong>Nên nhập</strong> = {aiResult ? "đề xuất AI GPT-4o" : "đủ bán 30 ngày − khả dụng"}.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Daily Ads Spend × ROAS — proportional UTM attribution per SKU */}
                    <div className="rounded-xl border border-border bg-card p-5">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <span className="h-2 w-2 rounded-full bg-amber-400" />
                                📈 Daily Ads Spend × ROAS
                                <span className="text-[10px] font-normal text-muted-foreground">
                                    {chartProductFilter === "ALL" ? "(toàn bộ SKU)" : `(SKU: ${chartProductFilter})`}
                                </span>
                            </h3>
                            <select
                                value={chartProductFilter}
                                onChange={(e) => setChartProductFilter(e.target.value)}
                                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-amber-400 transition"
                            >
                                <option value="ALL">Tất cả sản phẩm</option>
                                {chartProductOptions.map((code) => (
                                    <option key={code} value={code}>{code}</option>
                                ))}
                            </select>
                        </div>
                        <ResponsiveContainer width="100%" height={240}>
                            <ComposedChart data={dailyTrendChart} margin={{ top: 5, right: 45, bottom: 0, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
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
                                        // Values are already in VND (spend_vnd / revenue_vnd) — formatMoney
                                        // would multiply again by RON_TO_VND (5946) and overshoot 5946×.
                                        const vnd = Number(v);
                                        const abs = Math.abs(vnd);
                                        const sign = vnd < 0 ? "-" : "";
                                        const text = abs >= 1_000_000_000 ? `${sign}${(abs / 1_000_000_000).toFixed(2)}tỷ`
                                            : abs >= 1_000_000 ? `${sign}${(abs / 1_000_000).toFixed(1)}tr`
                                            : abs >= 1_000 ? `${sign}${(abs / 1_000).toFixed(0)}K`
                                            : `${sign}${Math.round(abs)}`;
                                        return [`${text}đ`, name];
                                    }}
                                />
                                <Legend iconSize={8} wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
                                <Bar yAxisId="vnd" dataKey="spend_vnd" name="Ads Spend" fill="#f59e0b" radius={[3, 3, 0, 0]} opacity={0.8} />
                                <Line yAxisId="roas" type="monotone" dataKey="roas" name="ROAS" stroke="#10b981" strokeWidth={2}
                                    dot={{ fill: "#10b981", r: 3 }} activeDot={{ r: 5 }} />
                            </ComposedChart>
                        </ResponsiveContainer>
                        <p className="mt-1.5 text-[10px] text-muted-foreground">
                            Spend được phân bổ theo tỷ lệ đơn của SKU trong từng campaign (UTM attribution). ROAS = doanh thu TC / spend cùng ngày.
                        </p>
                    </div>

                    {/* Charts Row */}
                    <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-xl border border-border bg-card p-5">
                            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                                📦 Revenue vs Profit vs Ads (Top 8)
                            </h3>
                            <ResponsiveContainer width="100%" height={280}>
                                <ComposedChart data={revVsProfitChart} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                    <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                    <YAxis dataKey="name" type="category" tick={{ fill: "#94a3b8", fontSize: 10 }} width={70} />
                                    <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                                    <Legend />
                                    <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={12} />
                                    <Bar dataKey="gross_profit" name="Gross Profit" fill="#34d399" radius={[0, 4, 4, 0]} barSize={12} />
                                    <Bar dataKey="ads_spend" name="Ads Spend" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={12} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="rounded-xl border border-border bg-card p-5">
                            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                                <span className="h-2 w-2 rounded-full bg-pink-400" />
                                📈 Margin % vs Return Rate vs Potential Score
                            </h3>
                            <ResponsiveContainer width="100%" height={280}>
                                <ComposedChart data={marginChart}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                    <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                    <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                                    <Legend />
                                    <Bar dataKey="margin" name="Net Margin %" radius={[6, 6, 0, 0]}>
                                        {marginChart.map((entry, i) => (
                                            <Cell key={i} fill={entry.margin >= 15 ? "#34d399" : entry.margin >= 0 ? "#f59e0b" : "#ef4444"} />
                                        ))}
                                    </Bar>
                                    <Line type="monotone" dataKey="return_rate" name="Return %" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                                    <Line type="monotone" dataKey="potential" name="Potential" stroke="#818cf8" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Product Intelligence Table */}
                    <div className="rounded-xl border border-border bg-card p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <Package className="h-4 w-4 text-indigo-400" />
                                Product Intelligence — P&L + Stock + Potential
                            </h3>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                                    {([
                                        { key: "all" as FilterKey, label: "Tất cả" },
                                        { key: "star" as FilterKey, label: "⭐ Star" },
                                        { key: "good" as FilterKey, label: "Tốt" },
                                        { key: "average" as FilterKey, label: "TB" },
                                        { key: "loss" as FilterKey, label: "🔻 Lỗ" },
                                        { key: "cut" as FilterKey, label: "⛔ Cắt mã" },
                                    ] as const).map((f) => (
                                        <button key={f.key} onClick={() => setFilterBy(f.key)}
                                            className={cn("rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                                                filterBy === f.key ? "bg-indigo-500/20 text-indigo-400" : "text-muted-foreground hover:text-foreground"
                                            )}>{f.label}</button>
                                    ))}
                                </div>
                                <button onClick={downloadProductCSV}
                                    className="flex items-center gap-1.5 rounded-lg bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-400 hover:bg-indigo-500/20 transition-colors">
                                    <Download className="h-3 w-3" /> Export CSV
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-border text-muted-foreground">
                                        <th className="px-2 pb-2 text-left font-medium">Sản phẩm</th>
                                        <th className="px-2 pb-2 text-right font-medium">Đơn</th>
                                        <th className="px-2 pb-2 text-right font-medium">Giao</th>
                                        <th className="px-2 pb-2 text-right font-medium">Hoàn</th>
                                        <SortHeader label="Revenue" sortKey="revenue" className="text-right" />
                                        <th className="px-2 pb-2 text-right font-medium">COGS</th>
                                        <SortHeader label="Gross P." sortKey="gross_profit" className="text-right" />
                                        <th className="px-2 pb-2 text-right font-medium">Ads</th>
                                        <th className="px-2 pb-2 text-right font-medium">3PL</th>
                                        <SortHeader label="Net Margin%" sortKey="margin" className="text-right" />
                                        <th className="px-2 pb-2 text-right font-medium">Net P&L</th>
                                        <SortHeader label="Return%" sortKey="return_rate" className="text-right" />
                                        <SortHeader label="Tồn kho" sortKey="stock" className="text-right" />
                                        <th className="px-2 pb-2 text-right font-medium">7d Sales</th>
                                        <SortHeader label="Potential" sortKey="potential" className="text-right" />
                                        <th className="px-2 pb-2 text-right font-medium">Xếp hạng</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedProducts.map((p) => {
                                        const netPnl = p.gross_profit - p.ads_spend - (p.ffm_cost || 0);
                                        const grade = gradeProduct(p.margin || 0, p.return_rate || 0, p.sold_7d || 0);
                                        const potScore = calcPotentialScore(p);
                                        const pot = potentialLabel(potScore);
                                        const dailySales = (p.sold_7d || 0) / 7;
                                        const daysOfStock = dailySales > 0 ? Math.round(p.stock / dailySales) : 999;

                                        return (
                                            <tr key={p.product_code + p.product_name} className="border-b border-border/30 hover:bg-gray-50/50 transition-colors">
                                                <td className="px-2 py-2.5">
                                                    <div className="font-semibold text-foreground">{p.product_code}</div>
                                                    <div className="text-[10px] text-muted-foreground max-w-[150px] truncate" title={p.product_name}>{p.product_name?.substring(0, 30)}</div>
                                                </td>
                                                <td className="px-2 py-2.5 text-right">{formatNumber(p.orders)}</td>
                                                <td className="px-2 py-2.5 text-right text-emerald-400">{formatNumber(p.delivered)}</td>
                                                <td className="px-2 py-2.5 text-right text-rose-400">{formatNumber(p.returned)}</td>
                                                <td className="px-2 py-2.5 text-right font-semibold text-blue-400">{formatMoney(p.revenue)}</td>
                                                <td className="px-2 py-2.5 text-right text-orange-400">{formatMoney(p.cogs)}</td>
                                                <td className={cn("px-2 py-2.5 text-right font-semibold", p.gross_profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                                    {p.gross_profit >= 0 ? "+" : ""}{formatMoney(p.gross_profit)}
                                                </td>
                                                <td className="px-2 py-2.5 text-right text-amber-400">{formatMoney(p.ads_spend)}</td>
                                                <td className="px-2 py-2.5 text-right text-violet-400">{formatMoney(p.ffm_cost || 0)}</td>
                                                <td className={cn("px-2 py-2.5 text-right font-bold",
                                                    (p.margin || 0) >= 15 ? "text-emerald-400" : (p.margin || 0) >= 0 ? "text-amber-400" : "text-rose-400")}>
                                                    {p.margin != null ? `${p.margin}%` : "—"}
                                                </td>
                                                <td className={cn("px-2 py-2.5 text-right font-bold", netPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                                    {netPnl >= 0 ? "+" : ""}{formatMoney(netPnl)}
                                                </td>
                                                <td className={cn("px-2 py-2.5 text-right", (p.return_rate || 0) >= 30 ? "text-rose-400 font-bold" : "text-muted-foreground")}>
                                                    {p.return_rate != null ? `${p.return_rate}%` : "—"}
                                                </td>
                                                <td className="px-2 py-2.5 text-right">
                                                    <div className="font-medium text-foreground">{formatNumber(p.stock)}</div>
                                                    {dailySales > 0 && (
                                                        <div className={cn("text-[10px]",
                                                            daysOfStock <= 7 ? "text-rose-400" : daysOfStock <= 14 ? "text-amber-400" : "text-muted-foreground")}>
                                                            {daysOfStock}d left
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-2 py-2.5 text-right text-indigo-400 font-medium">{formatNumber(p.sold_7d || 0)}</td>
                                                <td className="px-2 py-2.5 text-right">
                                                    <div className={cn("font-bold text-sm", pot.cls)}>{potScore}</div>
                                                    <div className={cn("text-[10px]", pot.cls)}>{pot.label}</div>
                                                </td>
                                                <td className="px-2 py-2.5 text-right">
                                                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap", grade.cls)}>{grade.label}</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {/* Totals Row */}
                                    <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                        <td className="px-2 py-2.5 text-foreground">TỔNG {sortedProducts.length} SP</td>
                                        <td className="px-2 py-2.5 text-right text-foreground">{formatNumber(sortedProducts.reduce((s, p) => s + p.orders, 0))}</td>
                                        <td className="px-2 py-2.5 text-right text-emerald-400">{formatNumber(sortedProducts.reduce((s, p) => s + p.delivered, 0))}</td>
                                        <td className="px-2 py-2.5 text-right text-rose-400">{formatNumber(sortedProducts.reduce((s, p) => s + p.returned, 0))}</td>
                                        <td className="px-2 py-2.5 text-right text-blue-400">{formatMoney(sortedProducts.reduce((s, p) => s + p.revenue, 0))}</td>
                                        <td className="px-2 py-2.5 text-right text-orange-400">{formatMoney(sortedProducts.reduce((s, p) => s + p.cogs, 0))}</td>
                                        <td className={cn("px-2 py-2.5 text-right", totalGross >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {totalGross >= 0 ? "+" : ""}{formatMoney(totalGross)}
                                        </td>
                                        <td className="px-2 py-2.5 text-right text-amber-400">{formatMoney(totalAds)}</td>
                                        <td className="px-2 py-2.5 text-right text-violet-400">{formatMoney(totalFfm)}</td>
                                        <td className="px-2 py-2.5 text-right text-foreground">{avgMargin.toFixed(1)}%</td>
                                        <td className={cn("px-2 py-2.5 text-right", netProfit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                            {netProfit >= 0 ? "+" : ""}{formatMoney(netProfit)}
                                        </td>
                                        <td className="px-2 py-2.5" colSpan={5}></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* SUB-TAB 2: Tồn kho (Inventory Overview by SKU)           */}
            {/* ═══════════════════════════════════════════════════════════ */}
            {subTab === "inventory" && (
                <>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <KPICard title="Tổng SKU/Phiên bản" value={formatNumber(totalVariations)} icon={Package} />
                        <KPICard title="Tổng tồn kho" value={formatNumber(totalStockUnits)} icon={Warehouse} status="success" />
                        <KPICard title="Giá trị tồn kho (RON)" value={formatCurrency(totalStockValue)} icon={TrendingUp} subValue="Giá vốn × Số lượng" />
                        <KPICard title="Hết hàng" value={String(outOfStockCount)} icon={AlertTriangle}
                            status={outOfStockCount > 0 ? "danger" : "success"} subValue={`/ ${totalVariations} phiên bản`} />
                    </div>

                    {/* Stock Table by Variation */}
                    <div className="rounded-xl border border-border bg-card p-5">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <Warehouse className="h-4 w-4 text-indigo-400" />
                                Tồn kho chi tiết theo phiên bản (SKU)
                            </h3>
                            {stockSyncedAt && (() => {
                                const syncedDate = new Date(stockSyncedAt);
                                const ageHours = (Date.now() - syncedDate.getTime()) / 3_600_000;
                                const stale = ageHours > 26;  // cron daily 03:00 UTC, allow 2h slack
                                return (
                                    <span className={cn(
                                        "rounded-full px-2.5 py-1 text-[11px] font-medium",
                                        stale ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-500"
                                    )}
                                        title={`Đồng bộ từ POS lúc ${syncedDate.toLocaleString("vi-VN")} (cron daily 10:00 VN). Sync 1 lần/ngày.`}>
                                        🕒 Đồng bộ: {syncedDate.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                        {stale && " ⚠ chưa fresh"}
                                    </span>
                                );
                            })()}
                        </div>
                        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                            <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-card z-10">
                                    <tr className="border-b border-border text-muted-foreground">
                                        <th className="px-2 pb-2 text-left font-medium">Mã SP</th>
                                        <th className="px-2 pb-2 text-left font-medium">Sản phẩm</th>
                                        <th className="px-2 pb-2 text-left font-medium">Phiên bản</th>
                                        <th className="px-2 pb-2 text-right font-medium">Tồn kho</th>
                                        <th className="px-2 pb-2 text-right font-medium" title="Hàng có phiếu nhập từ POS, chưa nhập kho">Đang nhập</th>
                                        <th className="px-2 pb-2 text-right font-medium">Giá vốn (RON)</th>
                                        <th className="px-2 pb-2 text-right font-medium">Giá bán (RON)</th>
                                        <th className="px-2 pb-2 text-right font-medium">Giá trị tồn</th>
                                        <th className="px-2 pb-2 text-right font-medium" title="Tổng đã bán trong khoảng thời gian lọc">Đã bán</th>
                                        <th className="px-2 pb-2 text-right font-medium" title="Số ngày trong khoảng lọc thực sự có ít nhất 1 đơn">Ngày có bán</th>
                                        <th className="px-2 pb-2 text-right font-medium" title="Bán/ngày = Đã bán / Ngày có bán (loại bỏ ngày tắt ads / hết hàng)">Bán/ngày</th>
                                        <th className="px-2 pb-2 text-center font-medium">Trạng thái</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stockVariations.map((v, i) => {
                                        const dailyAvg = v.active_days > 0 ? (v.sold_7d || 0) / v.active_days : 0;
                                        const daysLeft = dailyAvg > 0 ? v.quantity_on_hand / dailyAvg : 9999;
                                        const stockValue = v.quantity_on_hand * v.avg_cost;
                                        return (
                                            <tr key={v.variation_id || i} className="border-b border-border/30 hover:bg-gray-50/50 transition-colors">
                                                <td className="px-2 py-2 font-semibold text-foreground">{v.product_code}</td>
                                                <td className="px-2 py-2 text-muted-foreground max-w-[120px] truncate" title={v.product_name}>{v.product_name?.substring(0, 25)}</td>
                                                <td className="px-2 py-2 text-indigo-400 font-medium max-w-[100px] truncate" title={v.variation_name}>{v.variation_name || "—"}</td>
                                                <td className={cn("px-2 py-2 text-right font-bold", v.quantity_on_hand <= 0 ? "text-rose-400" : "text-foreground")}>{formatNumber(v.quantity_on_hand)}</td>
                                                <td className={cn("px-2 py-2 text-right font-medium", v.pending_quantity > 0 ? "text-cyan-400" : "text-muted-foreground/60")}>
                                                    {v.pending_quantity > 0 ? `+${formatNumber(v.pending_quantity)}` : "—"}
                                                </td>
                                                <td className="px-2 py-2 text-right text-muted-foreground">{v.avg_cost > 0 ? v.avg_cost.toFixed(2) : "—"}</td>
                                                <td className="px-2 py-2 text-right text-muted-foreground">{v.retail_price > 0 ? v.retail_price.toFixed(2) : "—"}</td>
                                                <td className="px-2 py-2 text-right text-amber-400 font-medium">{stockValue > 0 ? formatMoney(stockValue) : "—"}</td>
                                                <td className="px-2 py-2 text-right text-indigo-400">{formatNumber(v.sold_7d)}</td>
                                                <td className="px-2 py-2 text-right text-muted-foreground">{v.active_days > 0 ? v.active_days : "—"}</td>
                                                <td className="px-2 py-2 text-right text-muted-foreground">{dailyAvg > 0 ? dailyAvg.toFixed(1) : "—"}</td>
                                                <td className="px-2 py-2 text-center">
                                                    {v.quantity_on_hand <= 0 ? (
                                                        <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-400">Hết hàng</span>
                                                    ) : daysLeft <= 7 ? (
                                                        <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold text-orange-400">{Math.round(daysLeft)}d left</span>
                                                    ) : (
                                                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">Còn hàng</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {/* Totals */}
                                    <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                        <td className="px-2 py-2.5 text-foreground" colSpan={3}>TỔNG {totalVariations} phiên bản</td>
                                        <td className="px-2 py-2.5 text-right text-foreground">{formatNumber(totalStockUnits)}</td>
                                        <td className="px-2 py-2.5 text-right text-cyan-400">+{formatNumber(stockVariations.reduce((s, v) => s + v.pending_quantity, 0))}</td>
                                        <td className="px-2 py-2.5" colSpan={2}></td>
                                        <td className="px-2 py-2.5 text-right text-amber-400">{formatMoney(totalStockValue)}</td>
                                        <td className="px-2 py-2.5 text-right text-indigo-400">{formatNumber(stockVariations.reduce((s, v) => s + v.sold_7d, 0))}</td>
                                        <td className="px-2 py-2.5" colSpan={3}></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* SUB-TAB 3: Đề xuất nhập hàng (AI-Powered Restock)        */}
            {/* ═══════════════════════════════════════════════════════════ */}
            {subTab === "restock" && (
                <>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <KPICard title="Cần nhập gấp" value={String(needRestockCount)} icon={AlertTriangle}
                            status={needRestockCount > 0 ? "danger" : "success"} subValue="≤ 7 ngày tồn kho" />
                        <KPICard title="Nguy cấp" value={String(criticalCount)} icon={AlertTriangle}
                            status={criticalCount > 0 ? "danger" : "success"} subValue="Hết hàng hoặc ≤ 3 ngày" />
                        <KPICard title="Chi phí nhập (15 ngày)" value={formatCurrency(aiResult?.total_cost_15d ?? totalInvestment15d)} icon={TrendingUp}
                            subValue={aiResult ? "AI estimate" : "Ước tính theo giá vốn"} />
                        <KPICard title="Chi phí nhập (30 ngày)" value={formatCurrency(aiResult?.total_cost_30d ?? totalInvestment30d)} icon={TrendingUp}
                            subValue={aiResult ? "AI estimate" : "Ước tính theo giá vốn"} />
                    </div>

                    {/* AI Action Bar */}
                    <div className="rounded-xl border border-purple-500/30 bg-gradient-to-r from-purple-500/5 to-indigo-500/5 p-4">
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-start gap-3">
                                <Sparkles className="h-5 w-5 text-purple-400 mt-0.5 flex-shrink-0" />
                                <div>
                                    <h4 className="text-sm font-bold text-purple-400 mb-0.5">AI Đề xuất nhập hàng (GPT-4o)</h4>
                                    <p className="text-[11px] text-muted-foreground">
                                        AI phân tích tồn kho, tốc độ bán, margin, xu hướng để đề xuất số lượng nhập tối ưu cho từng SKU.
                                        Không dùng công thức cố định — AI tự đánh giá dựa trên toàn bộ context.
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={fetchAiSuggestion}
                                disabled={aiLoading || stockVariations.length === 0}
                                className={cn(
                                    "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all whitespace-nowrap",
                                    aiLoading
                                        ? "bg-purple-500/20 text-purple-300 cursor-wait"
                                        : "bg-gradient-to-r from-purple-500 to-indigo-500 text-white hover:from-purple-600 hover:to-indigo-600 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40"
                                )}
                            >
                                {aiLoading ? (
                                    <><Loader2 className="h-4 w-4 animate-spin" /> Đang phân tích...</>
                                ) : (
                                    <><Sparkles className="h-4 w-4" /> {aiResult ? "Phân tích lại" : "AI Đề xuất"}</>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* AI Error */}
                    {aiError && (
                        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-400">
                            <strong>Lỗi AI:</strong> {aiError}
                        </div>
                    )}

                    {/* AI Results Panel */}
                    {aiResult && (
                        <div className="rounded-xl border border-purple-500/20 bg-card p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="flex items-center gap-2 text-sm font-semibold text-purple-400">
                                    <Sparkles className="h-4 w-4" /> Phân tích AI
                                </h3>
                                <span className="text-[10px] text-muted-foreground">
                                    {aiResult.model} &middot; {aiResult.tokens} tokens &middot; {new Date(aiResult.timestamp).toLocaleTimeString("vi-VN")}
                                </span>
                            </div>

                            {/* Summary */}
                            {aiResult.summary && (
                                <p className="text-sm text-foreground leading-relaxed bg-purple-500/5 rounded-lg p-3 border border-purple-500/10">
                                    {aiResult.summary}
                                </p>
                            )}

                            {/* Insights */}
                            {aiResult.insights?.length > 0 && (
                                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                                    {aiResult.insights.map((insight: string, i: number) => (
                                        <div key={i} className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
                                            {insight}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Cut Products — AI recommends discontinuing */}
                            {aiResult.cut_products?.length > 0 && (
                                <div className="rounded-lg border-2 border-rose-500/30 bg-rose-500/5 p-4">
                                    <h4 className="text-sm font-bold text-rose-400 mb-3 flex items-center gap-2">
                                        <TrendingDown className="h-4 w-4" />
                                        Đề xuất cắt mã — {aiResult.cut_products.length} sản phẩm bán chậm
                                    </h4>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="border-b border-rose-500/20 text-muted-foreground">
                                                    <th className="px-2 pb-1.5 text-left font-medium">Mã SP</th>
                                                    <th className="px-2 pb-1.5 text-right font-medium">Tồn kho</th>
                                                    <th className="px-2 pb-1.5 text-right font-medium">Bán/ngày</th>
                                                    <th className="px-2 pb-1.5 text-right font-medium">Bán hết sau</th>
                                                    <th className="px-2 pb-1.5 text-left font-medium">Lý do</th>
                                                    <th className="px-2 pb-1.5 text-left font-medium">Đề xuất xử lý</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {aiResult.cut_products.map((cp: any, i: number) => (
                                                    <tr key={i} className="border-b border-rose-500/10">
                                                        <td className="px-2 py-1.5 font-bold text-rose-400">{cp.product_code}</td>
                                                        <td className="px-2 py-1.5 text-right text-foreground">{formatNumber(cp.remaining_stock || 0)}</td>
                                                        <td className="px-2 py-1.5 text-right text-muted-foreground">{cp.daily_avg || 0}</td>
                                                        <td className="px-2 py-1.5 text-right text-amber-400 font-medium">
                                                            {cp.days_to_clear >= 9999 ? "∞" : `${Math.round(cp.days_to_clear || 0)}d`}
                                                        </td>
                                                        <td className="px-2 py-1.5 text-muted-foreground max-w-[200px]" title={cp.reason}>{cp.reason?.substring(0, 50)}</td>
                                                        <td className="px-2 py-1.5">
                                                            <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-400">
                                                                {cp.recommendation || "Ngừng nhập"}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Restock Table — Grouped by Product Code */}
                    <div className="rounded-xl border border-border bg-card p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <ClipboardList className="h-4 w-4 text-indigo-400" />
                                Đề xuất nhập hàng theo sản phẩm
                                {aiResult && <span className="text-[10px] text-purple-400 font-normal ml-1">(AI-enhanced)</span>}
                            </h3>
                            <div className="flex items-center gap-2">
                                <button onClick={() => {
                                    const allCodes = [...new Set(restockItems.map(r => r.product_code))];
                                    setExpandedGroups(expandedGroups.size === allCodes.length ? new Set() : new Set(allCodes));
                                }} className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                                    {expandedGroups.size > 0 ? "Thu gọn" : "Mở rộng tất cả"}
                                </button>
                                <button onClick={downloadRestockCSV}
                                    className="flex items-center gap-1.5 rounded-lg bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-400 hover:bg-indigo-500/20 transition-colors">
                                    <Download className="h-3 w-3" /> Export CSV
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                            <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-card z-10">
                                    <tr className="border-b border-border text-muted-foreground">
                                        <th className="px-2 pb-2 text-left font-medium w-[200px]">Sản phẩm / SKU</th>
                                        <th className="px-2 pb-2 text-right font-medium">Tồn kho</th>
                                        <th className="px-2 pb-2 text-right font-medium">Bán/ngày</th>
                                        <th className="px-2 pb-2 text-right font-medium">Còn đủ</th>
                                        <th className="px-2 pb-2 text-right font-medium">Nhập (10d)</th>
                                        <th className="px-2 pb-2 text-right font-medium">
                                            {aiResult ? <span className="text-purple-400">AI 15d</span> : "Nhập (15d)"}
                                        </th>
                                        <th className="px-2 pb-2 text-right font-medium">Nhập (20d)</th>
                                        <th className="px-2 pb-2 text-right font-medium">
                                            {aiResult ? <span className="text-purple-400">AI 30d</span> : "Nhập (30d)"}
                                        </th>
                                        <th className="px-2 pb-2 text-right font-medium">Chi phí (30d)</th>
                                        <th className="px-2 pb-2 text-center font-medium">
                                            {aiResult ? <span className="text-purple-400">Priority</span> : "Rủi ro"}
                                        </th>
                                        {aiResult && <th className="px-2 pb-2 text-left font-medium text-purple-400">AI Lý do</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {(() => {
                                        // Group restockItems by product_code
                                        const grouped = new Map<string, typeof restockItems>();
                                        for (const r of restockItems) {
                                            const arr = grouped.get(r.product_code) || [];
                                            arr.push(r);
                                            grouped.set(r.product_code, arr);
                                        }

                                        const priorityCls: Record<string, string> = {
                                            urgent: "bg-rose-500/20 text-rose-400",
                                            high: "bg-orange-500/20 text-orange-400",
                                            medium: "bg-amber-500/20 text-amber-400",
                                            low: "bg-blue-500/20 text-blue-400",
                                            none: "bg-emerald-500/20 text-emerald-400",
                                            cut: "bg-red-600/25 text-red-400 ring-1 ring-red-500/30",
                                        };
                                        const priorityLabel: Record<string, string> = {
                                            urgent: "Gấp", high: "Cao", medium: "TB", low: "Thấp", none: "Không cần", cut: "Cắt mã",
                                        };

                                        const rows: React.ReactNode[] = [];

                                        grouped.forEach((items, code) => {
                                            const isExpanded = expandedGroups.has(code);
                                            const toggleGroup = () => {
                                                const next = new Set(expandedGroups);
                                                if (next.has(code)) next.delete(code); else next.add(code);
                                                setExpandedGroups(next);
                                            };

                                            // Aggregate for product-level row
                                            const gStock = items.reduce((s, r) => s + r.quantity_on_hand, 0);
                                            const gDailyAvg = items.reduce((s, r) => s + r.dailyAvg, 0);
                                            const gDaysLeft = gDailyAvg > 0 ? Math.round((gStock / gDailyAvg) * 10) / 10 : 9999;
                                            const g10d = items.reduce((s, r) => s + r.need10d, 0);
                                            const g15d = items.reduce((s, r) => {
                                                const ai = aiSuggestMap.get(`${r.product_code}|${r.variation_name || "default"}`);
                                                return s + (ai?.restock_15d ?? r.need15d);
                                            }, 0);
                                            const g20d = items.reduce((s, r) => s + r.need20d, 0);
                                            const g30d = items.reduce((s, r) => {
                                                const ai = aiSuggestMap.get(`${r.product_code}|${r.variation_name || "default"}`);
                                                return s + (ai?.restock_30d ?? r.need30d);
                                            }, 0);
                                            const gCost30d = items.reduce((s, r) => {
                                                const ai = aiSuggestMap.get(`${r.product_code}|${r.variation_name || "default"}`);
                                                return s + ((ai?.restock_30d ?? r.need30d) * r.avg_cost);
                                            }, 0);
                                            // Worst risk in group
                                            const worstRisk = items.reduce((worst, r) => r.risk.priority < worst.priority ? r.risk : worst, items[0].risk);
                                            const productName = items[0].product_name;

                                            // ── Product-level row (Tầng 1) ──
                                            rows.push(
                                                <tr key={`group-${code}`}
                                                    className={cn(
                                                        "border-b border-border/50 cursor-pointer transition-colors",
                                                        isExpanded ? "bg-indigo-500/5" : "hover:bg-muted/30",
                                                        worstRisk.priority <= 1 ? "bg-rose-500/5" : ""
                                                    )}
                                                    onClick={toggleGroup}
                                                >
                                                    <td className="px-2 py-2.5">
                                                        <div className="flex items-center gap-2">
                                                            {isExpanded
                                                                ? <ChevronDown className="h-3.5 w-3.5 text-indigo-400 flex-shrink-0" />
                                                                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                            }
                                                            <div>
                                                                <span className="font-bold text-foreground text-sm">{code}</span>
                                                                <span className="ml-2 text-muted-foreground text-[10px]">{items.length} SKU</span>
                                                                <div className="text-[10px] text-muted-foreground truncate max-w-[160px]" title={productName}>{productName?.substring(0, 30)}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className={cn("px-2 py-2.5 text-right font-bold", gStock <= 0 ? "text-rose-400" : "text-foreground")}>{formatNumber(gStock)}</td>
                                                    <td className="px-2 py-2.5 text-right text-indigo-400 font-medium">{gDailyAvg > 0 ? (Math.round(gDailyAvg * 10) / 10) : "—"}</td>
                                                    <td className={cn("px-2 py-2.5 text-right font-bold",
                                                        gDaysLeft <= 3 ? "text-rose-400" : gDaysLeft <= 7 ? "text-orange-400" : gDaysLeft <= 14 ? "text-amber-400" : "text-emerald-400"
                                                    )}>
                                                        {gDaysLeft >= 9999 ? "∞" : `${gDaysLeft}d`}
                                                        {gDaysLeft <= 3 && gDaysLeft < 9999 ? " 🔥" : ""}
                                                    </td>
                                                    <td className={cn("px-2 py-2.5 text-right font-bold", g10d > 0 ? "text-yellow-500" : "text-muted-foreground")}>
                                                        {g10d > 0 ? `+${formatNumber(g10d)}` : "—"}
                                                    </td>
                                                    <td className={cn("px-2 py-2.5 text-right font-bold", g15d > 0 ? (aiResult ? "text-purple-400" : "text-amber-400") : "text-muted-foreground")}>
                                                        {g15d > 0 ? `+${formatNumber(g15d)}` : "—"}
                                                    </td>
                                                    <td className={cn("px-2 py-2.5 text-right font-bold", g20d > 0 ? "text-orange-300" : "text-muted-foreground")}>
                                                        {g20d > 0 ? `+${formatNumber(g20d)}` : "—"}
                                                    </td>
                                                    <td className={cn("px-2 py-2.5 text-right font-bold", g30d > 0 ? (aiResult ? "text-purple-400" : "text-orange-400") : "text-muted-foreground")}>
                                                        {g30d > 0 ? `+${formatNumber(g30d)}` : "—"}
                                                    </td>
                                                    <td className="px-2 py-2.5 text-right text-amber-400 font-bold">{gCost30d > 0 ? formatMoney(gCost30d) : "—"}</td>
                                                    <td className="px-2 py-2.5 text-center">
                                                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap", worstRisk.bgCls, worstRisk.cls)}>
                                                            {worstRisk.label}
                                                        </span>
                                                    </td>
                                                    {aiResult && <td className="px-2 py-2.5"></td>}
                                                </tr>
                                            );

                                            // ── SKU-level rows (Tầng 2) — only when expanded ──
                                            if (isExpanded) {
                                                items.forEach((r, idx) => {
                                                    const aiRow = aiSuggestMap.get(`${r.product_code}|${r.variation_name || "default"}`);
                                                    const show15d = aiRow?.restock_15d ?? r.need15d;
                                                    const show30d = aiRow?.restock_30d ?? r.need30d;
                                                    const showCost30d = show30d * r.avg_cost;
                                                    const aiPriority = aiRow?.priority;

                                                    rows.push(
                                                        <tr key={`sku-${r.variation_id || idx}`}
                                                            className={cn(
                                                                "border-b border-border/20 transition-colors hover:bg-muted/20",
                                                                aiPriority === "urgent" ? "bg-rose-500/5" : "bg-muted/5"
                                                            )}>
                                                            <td className="px-2 py-1.5 pl-9">
                                                                <span className="text-indigo-400 font-medium">{r.variation_name || "Default"}</span>
                                                            </td>
                                                            <td className={cn("px-2 py-1.5 text-right", r.quantity_on_hand <= 0 ? "text-rose-400" : "text-muted-foreground")}>{formatNumber(r.quantity_on_hand)}</td>
                                                            <td className="px-2 py-1.5 text-right text-muted-foreground">{r.dailyAvg > 0 ? r.dailyAvg : "—"}</td>
                                                            <td className={cn("px-2 py-1.5 text-right font-medium",
                                                                r.daysLeft <= 3 ? "text-rose-400" : r.daysLeft <= 7 ? "text-orange-400" : r.daysLeft <= 14 ? "text-amber-400" : "text-emerald-400"
                                                            )}>
                                                                {r.daysLeft >= 9999 ? "∞" : `${r.daysLeft}d`}
                                                            </td>
                                                            <td className={cn("px-2 py-1.5 text-right font-medium", r.need10d > 0 ? "text-yellow-500" : "text-muted-foreground")}>
                                                                {r.need10d > 0 ? `+${formatNumber(r.need10d)}` : "—"}
                                                            </td>
                                                            <td className={cn("px-2 py-1.5 text-right font-medium",
                                                                aiRow ? "text-purple-400" : show15d > 0 ? "text-amber-400" : "text-muted-foreground"
                                                            )}>
                                                                {show15d > 0 ? `+${formatNumber(show15d)}` : "—"}
                                                            </td>
                                                            <td className={cn("px-2 py-1.5 text-right font-medium", r.need20d > 0 ? "text-orange-300" : "text-muted-foreground")}>
                                                                {r.need20d > 0 ? `+${formatNumber(r.need20d)}` : "—"}
                                                            </td>
                                                            <td className={cn("px-2 py-1.5 text-right font-medium",
                                                                aiRow ? "text-purple-400" : show30d > 0 ? "text-orange-400" : "text-muted-foreground"
                                                            )}>
                                                                {show30d > 0 ? `+${formatNumber(show30d)}` : "—"}
                                                            </td>
                                                            <td className="px-2 py-1.5 text-right text-muted-foreground">{showCost30d > 0 ? formatMoney(showCost30d) : "—"}</td>
                                                            <td className="px-2 py-1.5 text-center">
                                                                {aiRow ? (
                                                                    <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                                                                        priorityCls[aiPriority] || "bg-gray-500/20 text-gray-400"
                                                                    )}>{priorityLabel[aiPriority] || aiPriority}</span>
                                                                ) : (
                                                                    <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold", r.risk.bgCls, r.risk.cls)}>
                                                                        {r.risk.label}
                                                                    </span>
                                                                )}
                                                            </td>
                                                            {aiResult && (
                                                                <td className="px-2 py-1.5 text-[10px] text-muted-foreground max-w-[180px]" title={aiRow?.reason}>
                                                                    {aiRow?.reason ? aiRow.reason.substring(0, 50) + (aiRow.reason.length > 50 ? "..." : "") : "—"}
                                                                </td>
                                                            )}
                                                        </tr>
                                                    );
                                                });
                                            }
                                        });

                                        return rows;
                                    })()}
                                    {restockItems.length === 0 && (
                                        <tr><td colSpan={aiResult ? 9 : 8} className="px-4 py-8 text-center text-muted-foreground">Không có dữ liệu tồn kho hoặc doanh số</td></tr>
                                    )}
                                    {/* Grand Totals */}
                                    {restockItems.length > 0 && (
                                        <tr className="border-t-2 border-indigo-500/30 bg-indigo-500/5 font-bold">
                                            <td className="px-2 py-2.5 text-foreground">
                                                TỔNG {new Set(restockItems.map(r => r.product_code)).size} SP &middot; {restockItems.length} SKU
                                            </td>
                                            <td className="px-2 py-2.5 text-right text-foreground">{formatNumber(restockItems.reduce((s, r) => s + r.quantity_on_hand, 0))}</td>
                                            <td className="px-2 py-2.5"></td>
                                            <td className="px-2 py-2.5"></td>
                                            <td className="px-2 py-2.5 text-right text-yellow-500">
                                                {formatNumber(restockItems.reduce((s, r) => s + r.need10d, 0))}
                                            </td>
                                            <td className="px-2 py-2.5 text-right text-amber-400">
                                                {formatNumber(restockItems.reduce((s, r) => {
                                                    const ai = aiSuggestMap.get(`${r.product_code}|${r.variation_name || "default"}`);
                                                    return s + (ai?.restock_15d ?? r.need15d);
                                                }, 0))}
                                            </td>
                                            <td className="px-2 py-2.5 text-right text-orange-300">
                                                {formatNumber(restockItems.reduce((s, r) => s + r.need20d, 0))}
                                            </td>
                                            <td className="px-2 py-2.5 text-right text-orange-400">
                                                {formatNumber(restockItems.reduce((s, r) => {
                                                    const ai = aiSuggestMap.get(`${r.product_code}|${r.variation_name || "default"}`);
                                                    return s + (ai?.restock_30d ?? r.need30d);
                                                }, 0))}
                                            </td>
                                            <td className="px-2 py-2.5 text-right text-amber-400">
                                                {formatMoney(restockItems.reduce((s, r) => {
                                                    const ai = aiSuggestMap.get(`${r.product_code}|${r.variation_name || "default"}`);
                                                    return s + ((ai?.restock_30d ?? r.need30d) * r.avg_cost);
                                                }, 0))}
                                            </td>
                                            <td className="px-2 py-2.5" colSpan={aiResult ? 2 : 1}></td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* AI Chat — trao đổi sâu hơn dựa trên context tồn kho */}
                    <div className="rounded-xl border border-purple-500/30 bg-card overflow-hidden">
                        <div className="flex items-center justify-between gap-3 border-b border-purple-500/20 bg-purple-500/5 px-4 py-3">
                            <h4 className="flex items-center gap-2 text-sm font-bold text-purple-400">
                                <Sparkles className="h-4 w-4" />
                                Trao đổi với AI về tồn kho
                            </h4>
                            {chatMessages.length > 0 && (
                                <button onClick={resetChat} className="text-[11px] text-muted-foreground hover:text-foreground transition">
                                    Xoá lịch sử
                                </button>
                            )}
                        </div>

                        {/* Messages */}
                        <div className="max-h-[420px] overflow-y-auto px-4 py-3 space-y-3 bg-muted/20">
                            {chatMessages.length === 0 && (
                                <div className="text-center py-6">
                                    <p className="text-sm text-muted-foreground mb-3">
                                        Hỏi AI bất cứ điều gì về tồn kho, đề xuất nhập, hoặc kịch bản giả định.
                                    </p>
                                    <div className="flex flex-wrap justify-center gap-2">
                                        {[
                                            "SKU nào nguy hiểm nhất 7 ngày tới?",
                                            "Nếu bán tăng 30% thì cần nhập thêm bao nhiêu?",
                                            "Hàng sắp về có đủ cover D04 không?",
                                            "Cắt mã nào để giải phóng vốn?",
                                        ].map((q) => (
                                            <button
                                                key={q}
                                                onClick={() => sendChatMessage(q)}
                                                disabled={chatSending}
                                                className="rounded-full border border-purple-500/30 bg-purple-500/5 px-3 py-1 text-[11px] text-purple-400 hover:bg-purple-500/15 transition disabled:opacity-50"
                                            >
                                                {q}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {chatMessages.map((m, idx) => (
                                <div key={idx} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                                    <div className={cn(
                                        "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed",
                                        m.role === "user"
                                            ? "bg-purple-500 text-white"
                                            : "bg-card border border-border text-foreground"
                                    )}>
                                        {m.content}
                                    </div>
                                </div>
                            ))}
                            {chatSending && (
                                <div className="flex justify-start">
                                    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> AI đang phân tích...
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Input */}
                        <div className="border-t border-border bg-card px-3 py-3">
                            <div className="flex items-end gap-2">
                                <textarea
                                    value={chatInput}
                                    onChange={(e) => setChatInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            sendChatMessage();
                                        }
                                    }}
                                    placeholder={stockVariations.length === 0 ? "Đợi dữ liệu tồn kho..." : "Hỏi gì về tồn kho? (Enter để gửi, Shift+Enter xuống dòng)"}
                                    disabled={chatSending || stockVariations.length === 0}
                                    rows={2}
                                    className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-purple-500/50 focus:outline-none disabled:opacity-50"
                                />
                                <button
                                    onClick={() => sendChatMessage()}
                                    disabled={chatSending || !chatInput.trim() || stockVariations.length === 0}
                                    className="rounded-md bg-gradient-to-r from-purple-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow hover:from-purple-600 hover:to-indigo-600 disabled:opacity-40 transition"
                                >
                                    {chatSending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Gửi"}
                                </button>
                            </div>
                            <p className="mt-1.5 text-[10px] text-muted-foreground">
                                AI tự nhận dữ liệu tồn kho real-time + đề xuất AI lần trước làm context.
                            </p>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
