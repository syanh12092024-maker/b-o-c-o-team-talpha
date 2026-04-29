/**
 * TALPHA-specific formatting utils.
 * Revenue is in local currency (SAR/AED/KWD/OMR) → convert to VND.
 * Ads spend is already in VND → no conversion.
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// ═══ Exchange rates: local currency → VND ═══
// Synced from config/projects/talpha.yaml (valid_from: 2026-02-01)
export const EXCHANGE_RATES: Record<string, number> = {
    "Saudi": 6850,   // SAR → VND
    "UAE": 7010,     // AED → VND (was 7000, yaml says 7010)
    "Kuwait": 83000, // KWD → VND
    "Oman": 66700,   // OMR → VND (was 66500, yaml says 66700)
    "Qatar": 7050,   // QAR → VND
    "Bahrain": 68000, // BHD → VND
};

// Default rate for unknown shops
const DEFAULT_RATE = 6850; // SAR

/**
 * Convert revenue from local currency to VND based on shop/market name.
 * Ads spend is already VND — do NOT use this for ads.
 */
export function toVND(amount: number, shopName?: string): number {
    const rate = EXCHANGE_RATES[shopName || ""] || DEFAULT_RATE;
    return amount * rate;
}

// ═══ Formatting (same style as AUUS1) ═══
export function formatCurrency(amount: number) {
    return formatVNDCompact(amount);
}

export function formatVNDCompact(vnd: number) {
    const abs = Math.abs(vnd);
    const sign = vnd < 0 ? "-" : "";
    if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(".", ",")}tỷ`;
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(".", ",")}tr`;
    if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000).toLocaleString("vi-VN")}K`;
    return `${sign}${Math.round(abs).toLocaleString("vi-VN")}₫`;
}

export function formatMoney(amount: number) {
    return new Intl.NumberFormat("vi-VN").format(Math.round(amount));
}

export function formatNumber(amount: number) {
    return new Intl.NumberFormat("vi-VN").format(amount);
}

export function formatNumberCompact(amount: number) {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? "-" : "";
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
    return `${sign}${Math.round(abs)}`;
}

export const COLORS = {
    indigo: "#6366f1",
    emerald: "#34d399",
    rose: "#f43f5e",
    amber: "#fbbf24",
    slate: "#94a3b8",
};
