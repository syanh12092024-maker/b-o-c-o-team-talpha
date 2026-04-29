/**
 * AUUS1-specific formatting utils.
 * AUUS1 data is already in VND — NO exchange rate multiplication.
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// AUUS1 data = VND → no conversion needed
export const RON_TO_VND = 1;

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
