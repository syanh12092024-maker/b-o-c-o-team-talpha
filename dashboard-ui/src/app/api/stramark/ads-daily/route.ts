import { NextResponse } from "next/server";
import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ═══ CONFIG (reuse same pattern as realtime/route.ts) ═══
const YAML_PATH = path.join(process.cwd(), "..", "config", "projects", "stramark.yaml");

interface YamlConfig {
    meta_ads: { access_token: string; ad_account_ids: string[] };
}

function loadParentEnv(): void {
    const envPath = path.join(process.cwd(), "..", ".env");
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (key && val && !(key in process.env)) {
            process.env[key] = val;
        }
    }
}

function resolveEnvVars(obj: unknown): unknown {
    if (typeof obj === "string") {
        const match = obj.match(/^\$\{(.+)\}$/);
        if (match) return process.env[match[1]] || obj;
        return obj;
    }
    if (Array.isArray(obj)) return obj.map(resolveEnvVars);
    if (obj && typeof obj === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = resolveEnvVars(value);
        }
        return result;
    }
    return obj;
}

function loadConfig(): YamlConfig {
    loadParentEnv();
    const raw = fs.readFileSync(YAML_PATH, "utf-8");
    const parsed = yaml.load(raw);
    return resolveEnvVars(parsed) as YamlConfig;
}

/**
 * GET /api/stramark/ads-daily?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 *
 * Lightweight endpoint: fetches daily ads spend from Meta Graph API
 * with time_increment=1 (daily breakdown). Used as fallback when
 * BigQuery fb_ads_data is missing for certain dates.
 *
 * Returns: { data: [{ date: "2026-04-09", spend_usd: 1234.56 }, ...] }
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
    const fromDate = searchParams.get("from_date") || today;
    const toDate = searchParams.get("to_date") || today;

    try {
        const cfg = loadConfig();
        const token = cfg.meta_ads.access_token;
        const accountIds = cfg.meta_ads.ad_account_ids;

        const timeRange = JSON.stringify({ since: fromDate, until: toDate });

        // Fetch all accounts in parallel — account-level aggregation with daily breakdown
        const results = await Promise.allSettled(
            accountIds.map(async (accId) => {
                const url = new URL(`https://graph.facebook.com/v21.0/${accId}/insights`);
                url.searchParams.set("fields", "spend");
                url.searchParams.set("time_range", timeRange);
                url.searchParams.set("time_increment", "1"); // daily breakdown
                url.searchParams.set("access_token", token);
                url.searchParams.set("limit", "500");

                const res = await fetch(url.toString(), {
                    signal: AbortSignal.timeout(15000),
                });
                const json = await res.json();

                if (json.error) {
                    console.error(`ads-daily: ${accId} error:`, json.error.message);
                    return [];
                }

                let rows = json.data || [];
                // Handle pagination
                let paging = json.paging;
                while (paging?.next) {
                    const nextRes = await fetch(paging.next, {
                        signal: AbortSignal.timeout(10000),
                    });
                    const nextJson = await nextRes.json();
                    rows = rows.concat(nextJson.data || []);
                    paging = nextJson.paging;
                }

                return rows;
            })
        );

        // Aggregate spend by date across all accounts
        const spendByDate = new Map<string, number>();
        for (const result of results) {
            if (result.status !== "fulfilled") continue;
            for (const row of result.value) {
                const date = row.date_start; // YYYY-MM-DD
                const spend = parseFloat(row.spend || "0");
                spendByDate.set(date, (spendByDate.get(date) || 0) + spend);
            }
        }

        const data = Array.from(spendByDate.entries())
            .map(([date, spend_usd]) => ({ date, spend_usd: Math.round(spend_usd * 100) / 100 }))
            .sort((a, b) => b.date.localeCompare(a.date));

        return NextResponse.json({ data });
    } catch (err: any) {
        console.error("ads-daily error:", err);
        return NextResponse.json({ error: err.message, data: [] }, { status: 500 });
    }
}
