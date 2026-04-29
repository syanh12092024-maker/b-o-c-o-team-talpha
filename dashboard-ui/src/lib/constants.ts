/**
 * Frontend constants — shared across all client components.
 *
 * ⚠️ RULE: NEVER hardcode dataset/project names in SQL queries.
 *    Always use DATASET from this file.
 *
 * To change dataset for a new project, set the env var:
 *    NEXT_PUBLIC_DATASET=NewProject_Dataset
 */

export const DATASET = process.env.NEXT_PUBLIC_DATASET || "STRAMARK_Dataset";
export const BQ_PROJECT = process.env.NEXT_PUBLIC_BQ_PROJECT || "levelup-465304";
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "STRAMARK";
export const APP_VERSION = "v5.0";

// Currency + exchange rates (STRAMARK = RON, convert to VND for display)
export const CURRENCY_SYMBOL = "RON";
// ── Tỷ giá cố định (cập nhật 2026-03-18) ──
export const EXCHANGE_RATE_TO_VND = 5946;         // 1 LEI/RON = 5,946 VND
export const EXCHANGE_RATE_USD_TO_VND = 26325;    // 1 USD = 26,325 VND
export const EXCHANGE_RATE_EUR_TO_VND = 30667;    // 1 EUR = 30,667 VND
