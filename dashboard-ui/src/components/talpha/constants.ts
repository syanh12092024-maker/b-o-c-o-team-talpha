/**
 * TALPHA-specific constants — used only by TALPHA tabs.
 * Completely isolated from STRAMARK and AUUS1.
 * Exchange rates are in utils.ts (synced from talpha.yaml)
 */

export const DATASET = "TALPHA_Dataset";
export const BQ_PROJECT = "levelup-465304";
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const APP_NAME = "TALPHA";
export const APP_VERSION = "v2.0";
