import { CURRENCY_SYMBOL, EXCHANGE_RATE_TO_VND, EXCHANGE_RATE_USD_TO_VND } from "@/lib/constants";

// Helper: convert revenue (local currency) to VND
export const localToVnd = (local: number) => (local || 0) * EXCHANGE_RATE_TO_VND;
// Helper: convert spend (USD) to VND
export const usdToVnd = (usd: number) => (usd || 0) * EXCHANGE_RATE_USD_TO_VND;

// Format VND currency
export const formatVND = (val: number) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(val || 0);

// Format USD short
export const formatUSD = (val: number) => `$${(val || 0).toFixed(2)}`;

// ══════════════ Types ══════════════
export interface MetaMetrics {
    spend: number;       // USD
    impressions: number;
    reach: number;
    frequency: number;
    clicks: number;
    cpm: number;
    cpc: number;
    ctr: number;
    messages: number;
    leads: number;
    purchases: number;
    link_clicks: number;
    cost_per_msg: number;
    cost_per_lead: number;
    cost_per_purchase: number;
}

export interface RealMetrics {
    leads: number;
    orders: number;        // Success
    revenue: number;       // RON
    created_orders: number; // All Created (used for decisions)
    roas: number;          // Will recalculate with VND
    real_cpa: number;
}

export interface CampaignData {
    id: string;
    name: string;
    status: string;
    account_id: string;
    metrics_meta: MetaMetrics;
    metrics_real: RealMetrics;
    history?: {
        days_active: number;
        yesterday: { spend: number; clicks: number; messages: number; orders?: number; revenue?: number };
        avg_7d: { spend: number; clicks: number; messages: number; cpm: number; orders?: number; revenue?: number };
        trend: { recent3d: number; earlier4d: number };
    };
    ai_insight?: {
        signal: string;
        reason: string;
        action: string | null;  // "SCALE" | "KILL" | null
        todo: string;           // specific staff instruction
        confidence: number;
        roas: number;
    };
}

export interface DashboardSummary {
    total_spend: number;          // USD
    total_meta_messages: number;
    total_real_leads: number;
    total_real_orders: number;
    total_real_revenue: number;   // RON
    blended_roas: number;
}

export interface AdsCommandCenterResponse {
    meta: {
        sync_duration_ms: number;
        source: string;
    };
    summary: DashboardSummary;
    campaigns: CampaignData[];
    _warning?: string;
}
