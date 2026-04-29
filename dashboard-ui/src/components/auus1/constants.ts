/**
 * AUUS1-specific constants — used only by AUUS1 tabs.
 * Completely isolated from STRAMARK's shared constants.
 */

export const DATASET = "AUUS1_Dataset";
export const BQ_PROJECT = "levelup-465304";
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const CURRENCY_SYMBOL = "VND";
export const EXCHANGE_RATE_TO_VND = 1;            // VND to VND = 1
export const EXCHANGE_RATE_USD_TO_VND = 25700;    // USD to VND (must match cost_exchange_rates in BQ)
export const APP_NAME = "AUUS1";
export const APP_VERSION = "v5.0";
