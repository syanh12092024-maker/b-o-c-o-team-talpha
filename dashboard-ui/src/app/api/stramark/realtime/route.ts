import { NextResponse } from "next/server";
import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";
import { bigquery } from "@/lib/bigquery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ═══ FETCH WRAPPER ═══
// Use native fetch (undici) — verified working on VPS.
// The previous https.Agent + family:4 wrapper was being silently broken
// by Next.js turbopack bundling. Native fetch handles IPv4/IPv6 correctly.
async function fetchIPv4(url: string, opts?: { signal?: AbortSignal }): Promise<Response> {
    return fetch(url, { signal: opts?.signal });
}

// ═══ CONFIG ═══
const YAML_PATH = path.join(process.cwd(), "..", "config", "projects", "stramark.yaml");

// ── Tỷ giá cố định (cập nhật 2026-03-18) ──
const RON_TO_VND = 5946;     // 1 LEI/RON = 5,946 VND
const USD_TO_VND = 26325;    // 1 USD = 26,325 VND
const EUR_TO_VND = 30667;    // 1 EUR = 30,667 VND
const POS_PRICE_DIVISOR = 100;

// Convert local currency price to "RON equivalent" so downstream ronToVnd() gives correct VND
// EUR orders: price_eur * EUR_TO_VND / RON_TO_VND → when frontend does × RON_TO_VND → correct VND
const EUR_TO_RON_EQUIV = EUR_TO_VND / RON_TO_VND; // ≈ 5.158

function toRonEquiv(rawPrice: number, currency: string): number {
    if (currency && currency.toUpperCase() === 'EUR') {
        return rawPrice * EUR_TO_RON_EQUIV;
    }
    return rawPrice; // RON or unknown → treat as RON
}

const ACCOUNT_NAMES: Record<string, string> = {
    "act_817501334775697": "STRAMARK TK1",
    "act_1369010934859968": "STRAMARK TK2",
    "act_1528285295107514": "STRAMARK TK3",
};
const getAccountName = (id: string) => ACCOUNT_NAMES[id] || id;

interface YamlConfig {
    meta_ads: { access_token: string; ad_account_ids: string[] };
    poscake: { shops: Array<{ name: string; api_url: string; api_key: string; shop_id: string }> };
}

/**
 * Load parent .env file and populate process.env (only missing keys).
 * Mirrors the Python pattern used in sync scripts.
 */
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

/**
 * Recursively resolve ${ENV_VAR} placeholders in YAML values.
 * Only resolves complete string values matching ${...} pattern.
 */
function resolveEnvVars(obj: unknown): unknown {
    if (typeof obj === "string") {
        const match = obj.match(/^\$\{(.+)\}$/);
        if (match) {
            return process.env[match[1]] || obj;
        }
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(resolveEnvVars);
    }
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

// ═══ META API RISK MITIGATION ═══
// Based on Meta API policies:
// - Error code 200 (OAuthException) = Business Manager blocked → needs Meta Support
// - Error code 4 = Rate limit hit → exponential backoff
// - Error code 190 = Token expired → need new token
// - Error code 17 = Account-level rate limit
// - HTTP 429 = Too Many Requests → use Retry-After header
// Headers to monitor: x-business-use-case-usage, x-ad-account-usage, x-fb-ads-insights-throttle

interface MetaApiStatus {
    token_valid: boolean;
    error_code?: number;
    error_message?: string;
    error_type?: string;
    accounts_ok: string[];
    accounts_blocked: string[];
    rate_limit_pct?: number;
}

// Global state to track rate limits across requests
let lastMetaStatus: MetaApiStatus | null = null;

// Sleep with exponential backoff + jitter
function sleepMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, baseMs = 1000, maxMs = 30000): number {
    const exp = Math.min(baseMs * Math.pow(2, attempt), maxMs);
    const jitter = exp * 0.5 * Math.random(); // ±50% jitter
    return Math.round(exp + jitter);
}

// Pre-check: Is the token valid at all?
// Timeout = assume valid (optimistic) — actual errors caught per-account in fetchOneAccount
async function checkTokenValidity(token: string): Promise<{ valid: boolean; error?: string; code?: number }> {
    try {
        const res = await fetchIPv4(`https://graph.facebook.com/v21.0/me?access_token=${token}`, {
            signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        if (data.error) {
            return { valid: false, error: data.error.message, code: data.error.code };
        }
        return { valid: true };
    } catch (e: any) {
        // Timeout or network error — assume token valid, let per-account fetch decide
        console.warn(`Token pre-check failed (non-blocking): ${e.message}`);
        return { valid: true, error: e.message };
    }
}

// Parse rate limit info from response headers
function parseRateLimitHeaders(headers: Headers): { pct: number; timeToRegain?: number } {
    let maxPct = 0;
    let timeToRegain: number | undefined;

    // x-business-use-case-usage: JSON with call_count, total_cputime, total_time percentages
    const bizUsage = headers.get('x-business-use-case-usage');
    if (bizUsage) {
        try {
            const parsed = JSON.parse(bizUsage);
            for (const key of Object.keys(parsed)) {
                for (const entry of parsed[key]) {
                    maxPct = Math.max(maxPct, entry.call_count || 0, entry.total_cputime || 0, entry.total_time || 0);
                    if (entry.estimated_time_to_regain_access) {
                        timeToRegain = Math.max(timeToRegain || 0, entry.estimated_time_to_regain_access);
                    }
                }
            }
        } catch { /* ignore parse errors */ }
    }

    // x-ad-account-usage: {"acc_id_util_pct": N}
    const adAccUsage = headers.get('x-ad-account-usage');
    if (adAccUsage) {
        try {
            const parsed = JSON.parse(adAccUsage);
            maxPct = Math.max(maxPct, parsed.acc_id_util_pct || 0);
        } catch { /* ignore */ }
    }

    return { pct: maxPct, timeToRegain };
}

// ═══ META API: Fetch insights for ONE account ═══
async function fetchOneAccount(
    token: string, accId: string, fields: string,
    timeRange: string, filtering: string,
): Promise<{ ads: any[]; ok: boolean; error?: { code?: number; message?: string } }> {
    const ads: any[] = [];
    let url: string | null = `https://graph.facebook.com/v21.0/${accId}/insights?fields=${fields}&level=ad${timeRange}&limit=500${filtering}&access_token=${token}`;
    let pageCount = 0;
    const MAX_PAGES = 10;
    const MAX_RETRIES = 2;

    while (url && pageCount < MAX_PAGES) {
        let attempt = 0;
        let success = false;

        while (attempt < MAX_RETRIES && !success) {
            const res: Response = await fetchIPv4(url!, { signal: AbortSignal.timeout(10000) });

            // ── Monitor rate limit headers ──
            const rl = parseRateLimitHeaders(res.headers);
            if (rl.pct > 90) {
                console.warn(`⚠️ Rate limit ${rl.pct}% for ${accId}, waiting 5s`);
                await sleepMs(5000);
            } else if (rl.pct > 75) {
                await sleepMs(2000);
            }

            // ── Handle HTTP 429 ──
            if (res.status === 429) {
                const waitMs = Math.min(backoffDelay(attempt), 10000);
                console.warn(`🔄 429 for ${accId}, retry in ${waitMs}ms`);
                await sleepMs(waitMs);
                attempt++;
                continue;
            }

            if (!res.ok) {
                return { ads, ok: false, error: { message: `HTTP ${res.status}` } };
            }

            const data: any = await res.json();

            if (data.error) {
                const errCode = data.error.code;
                const errMsg = data.error.message || '';
                console.error(`Meta ${accId} API error: code=${errCode} msg=${errMsg}`);

                if (errCode === 4 || errCode === 17 || errCode === 32) {
                    // Rate limit — backoff and retry
                    await sleepMs(backoffDelay(attempt));
                    attempt++;
                    continue;
                }
                // Token expired, BM block, or unknown — return error immediately
                return { ads, ok: false, error: { code: errCode, message: errMsg } };
            }

            // ── Success: process rows ──
            for (const row of (data.data || [])) {
                const actions = row.actions || [];
                const messages = actions.find((a: any) => a.action_type === "onsite_conversion.messaging_conversation_started_7d")?.value || 0;
                const purchases = actions.find((a: any) => a.action_type === "purchase" || a.action_type === "omni_purchase")?.value || 0;
                ads.push({
                    account_id: accId,
                    account_name: getAccountName(accId),
                    campaign_id: row.campaign_id,
                    campaign_name: row.campaign_name,
                    campaign_status: row.campaign_effective_status || "UNKNOWN",
                    adset_id: row.adset_id || "",
                    adset_name: row.adset_name || "",
                    adset_status: row.adset_effective_status || "UNKNOWN",
                    ad_name: row.ad_name || "",
                    ad_id: row.ad_id,
                    ad_status: row.ad_effective_status || "UNKNOWN",
                    spend: parseFloat(row.spend || "0"),
                    impressions: parseInt(row.impressions || "0"),
                    cpm: parseFloat(row.cpm || "0"),
                    cpc: parseFloat(row.cpc || "0"),
                    ctr: parseFloat(row.ctr || "0"),
                    messages: parseInt(messages),
                    purchases: parseInt(purchases),
                    orders: 0,
                    revenue_ron: 0,
                    order_details: [] as any[],
                });
            }

            url = data.paging?.next || null;
            pageCount++;
            success = true;
            if (url) await sleepMs(200);
        }

        if (!success) break;
    }

    return { ads, ok: ads.length > 0 || pageCount > 0 };
}

// ═══ META API: Fetch insights with parallel accounts + global timeout ═══
async function fetchMetaAds(token: string, accountIds: string[], activeOnly: boolean, fromDate: string, toDate: string) {
    const fields = "campaign_name,campaign_id,adset_id,adset_name,ad_name,ad_id,spend,impressions,cpm,cpc,ctr,actions";
    const allAds: any[] = [];
    const metaStatus: MetaApiStatus = {
        token_valid: true, accounts_ok: [], accounts_blocked: [],
    };

    // ── Step 1: Pre-check token validity (5s timeout) ──
    const tokenCheck = await checkTokenValidity(token);
    if (!tokenCheck.valid) {
        metaStatus.token_valid = false;
        metaStatus.error_code = tokenCheck.code;
        metaStatus.error_message = tokenCheck.error;
        metaStatus.accounts_blocked = [...accountIds];
        console.error(`⚠️ STRAMARK Meta token INVALID: code=${tokenCheck.code} msg=${tokenCheck.error}`);
        lastMetaStatus = metaStatus;
        return { ads: allAds, metaStatus };
    }

    // ── Step 2: Fetch ALL accounts in PARALLEL (global 25s timeout) ──
    const filtering = activeOnly
        ? `&filtering=${encodeURIComponent(JSON.stringify([{ "field": "campaign.effective_status", "operator": "IN", "value": ["ACTIVE"] }]))}`
        : '';
    const timeRange = `&time_range=${encodeURIComponent(JSON.stringify({ since: fromDate, until: toDate }))}`;

    const GLOBAL_TIMEOUT = 25000; // 25s max for all accounts combined
    const accountResults = await Promise.race([
        Promise.allSettled(
            accountIds.map(accId => fetchOneAccount(token, accId, fields, timeRange, filtering))
        ),
        sleepMs(GLOBAL_TIMEOUT).then(() => 'timeout' as const),
    ]);

    if (accountResults === 'timeout') {
        console.error(`⚠️ Meta global timeout (${GLOBAL_TIMEOUT}ms) — marking all accounts as blocked`);
        metaStatus.accounts_blocked = [...accountIds];
        metaStatus.error_message = 'Global timeout — Meta API too slow';
        lastMetaStatus = metaStatus;
        return { ads: allAds, metaStatus };
    }

    // Process results from each account
    for (let i = 0; i < accountIds.length; i++) {
        const accId = accountIds[i];
        const result = accountResults[i];

        if (result.status === 'rejected') {
            console.error(`Meta ${accId} rejected:`, result.reason?.message || result.reason);
            metaStatus.accounts_blocked.push(accId);
            continue;
        }

        const { ads, ok, error } = result.value;
        if (ok) {
            allAds.push(...ads);
            metaStatus.accounts_ok.push(accId);
        } else {
            metaStatus.accounts_blocked.push(accId);
            if (error?.code === 190) {
                metaStatus.token_valid = false;
                metaStatus.error_code = 190;
                metaStatus.error_message = 'Token expired';
            } else if (error) {
                metaStatus.error_code = error.code;
                metaStatus.error_message = error.message;
            }
        }
    }

    // ── Step 3: Fallback status fetch — only for items still UNKNOWN ──
    const unknownCampaignIds = [...new Set(allAds.filter(a => a.campaign_status === "UNKNOWN").map(a => a.campaign_id))];
    const unknownAdIds = [...new Set(allAds.filter(a => a.ad_status === "UNKNOWN").map(a => a.ad_id).filter(Boolean))];
    // Insights endpoint doesn't return adset_effective_status — always lookup explicitly.
    const unknownAdsetIds = [...new Set(allAds.filter(a => a.adset_status === "UNKNOWN").map(a => a.adset_id).filter(Boolean))];
    const statusMap = new Map<string, string>();

    if (metaStatus.token_valid && (unknownCampaignIds.length > 0 || unknownAdIds.length > 0 || unknownAdsetIds.length > 0)) {
        const fetchStatuses = async (ids: string[]) => {
            for (let i = 0; i < ids.length; i += 50) {
                const batch = ids.slice(i, i + 50);
                try {
                    const res = await fetchIPv4(
                        `https://graph.facebook.com/v21.0/?ids=${batch.join(",")}&fields=effective_status&access_token=${token}`,
                        { signal: AbortSignal.timeout(5000) }
                    );
                    if (res.ok) {
                        const data = await res.json();
                        for (const [id, info] of Object.entries(data) as [string, any][]) {
                            statusMap.set(id, info.effective_status || "UNKNOWN");
                        }
                    }
                } catch (e: any) {
                    console.warn(`Status fetch failed (non-critical):`, e.message);
                }
                if (i + 50 < ids.length) await sleepMs(200);
            }
        };

        // Fallback status fetch with 5s timeout — only for missing statuses
        await Promise.race([
            Promise.all([
                unknownCampaignIds.length > 0 ? fetchStatuses(unknownCampaignIds) : Promise.resolve(),
                unknownAdIds.length > 0 ? fetchStatuses(unknownAdIds) : Promise.resolve(),
                unknownAdsetIds.length > 0 ? fetchStatuses(unknownAdsetIds) : Promise.resolve(),
            ]),
            sleepMs(5000),
        ]);

        for (const ad of allAds) {
            if (ad.campaign_status === "UNKNOWN") {
                ad.campaign_status = statusMap.get(ad.campaign_id) || "UNKNOWN";
            }
            if (ad.ad_status === "UNKNOWN") {
                ad.ad_status = statusMap.get(ad.ad_id) || ad.ad_status;
            }
            if (ad.adset_status === "UNKNOWN" && ad.adset_id) {
                ad.adset_status = statusMap.get(ad.adset_id) || ad.adset_status;
            }
        }
    }

    lastMetaStatus = metaStatus;
    return { ads: allAds, metaStatus };
}

// ═══ Product code extraction ═══
// Convention: variation_info.name like "D04-NEGRU" → product code "D04".
// Fallback to display_id (numeric) only if name is unusable.
const PRODUCT_CODE_RE = /^([A-Z]\d+)/i;
function extractProductCodesFromItems(items: any): string[] {
    if (!Array.isArray(items)) return [];
    const codes = new Set<string>();
    for (const it of items) {
        const v = it?.variation_info || {};
        const candidates = [v.name, v.product_display_id, v.custom_id, it?.product_name];
        for (const cand of candidates) {
            if (!cand) continue;
            const m = String(cand).match(PRODUCT_CODE_RE);
            if (m) { codes.add(m[1].toUpperCase()); break; }
        }
    }
    return Array.from(codes);
}

// ═══ POS: BigQuery for history ═══
const BQ_PROJECT = "levelup-465304";
const BQ_DATASET = "STRAMARK_Dataset";

async function fetchPOSFromBigQuery(fromDate: string, toDate: string) {
    const allOrders: any[] = [];
    try {
        // JOIN order_items + product_template to get product_codes (D04, D02, …) per order.
        // custom_id is the canonical product code; fallback regex for legacy items missing custom_id.
        const query = `
            WITH item_codes AS (
                SELECT
                    oi.order_id,
                    ARRAY_AGG(DISTINCT COALESCE(
                        pt.custom_id,
                        REGEXP_EXTRACT(oi.product_name, r'^([A-Z]\\d+)'),
                        REGEXP_EXTRACT(oi.variation_name, r'^([A-Z]\\d+)')
                    ) IGNORE NULLS) AS product_codes
                FROM \`${BQ_PROJECT}.${BQ_DATASET}.order_items\` oi
                LEFT JOIN \`${BQ_PROJECT}.${BQ_DATASET}.product_template\` pt
                    ON oi.product_id = pt.id
                WHERE DATE(CAST(oi.order_inserted_at AS TIMESTAMP)) >= @fromDate
                  AND DATE(CAST(oi.order_inserted_at AS TIMESTAMP)) <= @toDate
                GROUP BY oi.order_id
            )
            SELECT
                so.id, so.status, so.status_name, so.total_price, so.cod,
                so.p_utm_term, so.p_utm_campaign, so.p_utm_medium,
                so.marketer, so.customer_name, so.bill_full_name,
                so.order_currency,
                CAST(so.inserted_at AS STRING) AS inserted_at,
                ic.product_codes AS product_codes
            FROM \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\` so
            LEFT JOIN item_codes ic ON so.id = ic.order_id
            WHERE DATE(CAST(so.inserted_at AS TIMESTAMP)) >= @fromDate
              AND DATE(CAST(so.inserted_at AS TIMESTAMP)) <= @toDate
              AND COALESCE(SAFE_CAST(so.status AS INT64), 0) != 7  -- exclude soft-deleted orders (POS UI hides them)
            ORDER BY so.inserted_at DESC
        `;
        const [rows] = await bigquery.query({ query, params: { fromDate, toDate } });
        for (const row of rows) {
            const rawPrice = (row.cod || row.total_price || 0) / POS_PRICE_DIVISOR;
            const currency = String(row.order_currency || 'RON').toUpperCase();
            const priceRon = toRonEquiv(rawPrice, currency);
            // STRAMARK maps ads via UTM: p_utm_term = ad_id from {{ad.id}}
            const utmAdId = row.p_utm_term ? String(row.p_utm_term).trim() : null;
            const productCodes: string[] = Array.isArray(row.product_codes)
                ? row.product_codes.map((s: any) => String(s).toUpperCase()).filter(Boolean)
                : [];
            allOrders.push({
                id: String(row.id || ''),
                shop_name: 'EU',
                utm_ad_id: utmAdId,
                utm_adset_id: row.p_utm_medium ? String(row.p_utm_medium).trim() : null,
                utm_campaign: row.p_utm_campaign ? String(row.p_utm_campaign) : null,
                marketer: String(row.marketer || ''),
                total_price_ron: priceRon,
                status: String(row.status || ''),
                inserted_at: row.inserted_at,
                customer_name: String(row.bill_full_name || row.customer_name || ''),
                product_codes: productCodes,
                source: 'bigquery',
            });
        }
        console.log(`BQ POS: ${allOrders.length} orders for ${fromDate}→${toDate}`);
    } catch (e: any) {
        console.error('BQ POS error:', e.message);
    }
    return allOrders;
}

// ═══ POS: Direct API — fetch all orders in a date range (single pass) ═══
// More efficient than per-date fetching: one pagination pass collects all dates
async function fetchPOSFromDirectAPIRange(shops: YamlConfig["poscake"]["shops"], fromDate: string, toDate: string) {
    const allOrders: any[] = [];

    await Promise.all(shops.map(async (shop) => {
        try {
            let page = 1;
            let reachedPast = false;
            while (!reachedPast && page <= 500) {
                const url = `${shop.api_url}/shops/${shop.shop_id}/orders?api_key=${shop.api_key}&page=${page}&sort=-inserted_at`;
                const res = await fetchIPv4(url, { signal: AbortSignal.timeout(20000) });
                if (!res.ok) { console.error(`POS ${shop.name}: ${res.status}`); break; }
                const data = await res.json();
                const orders = data.data || [];
                if (orders.length === 0) break;

                for (const o of orders) {
                    const insertedAt = String(o.inserted_at || '');
                    const orderDate = insertedAt.slice(0, 10);
                    if (orderDate > toDate) continue;       // newer than range, skip
                    if (orderDate < fromDate) { reachedPast = true; break; } // older than range, stop
                    if (Number(o.status) === 7) continue;    // exclude soft-deleted orders (matches POS UI)

                    const rawPrice = (o.cod || o.total_price || 0) / POS_PRICE_DIVISOR;
                    const currency = String(o.order_currency || 'RON').toUpperCase();
                    const priceRon = toRonEquiv(rawPrice, currency);
                    const mkRaw = o.marketer || o.pke_mkter || null;
                    const marketerName = mkRaw && typeof mkRaw === 'object' ? (mkRaw.name || '') : (mkRaw || '');
                    const custRaw = o.customer_name;
                    const customerName = custRaw && typeof custRaw === 'object' ? (custRaw.name || '') : (custRaw || '');
                    // STRAMARK maps ads via UTM: p_utm_term = ad_id from {{ad.id}}
                    const utmAdId = o.p_utm_term ? String(o.p_utm_term).trim() : null;
                    const productCodes = extractProductCodesFromItems(o.items);
                    allOrders.push({
                        id: String(o.id || ''),
                        shop_name: shop.name,
                        utm_ad_id: utmAdId,
                        utm_adset_id: o.p_utm_medium ? String(o.p_utm_medium).trim() : null,
                        utm_campaign: o.p_utm_campaign ? String(o.p_utm_campaign) : null,
                        marketer: marketerName,
                        total_price_ron: priceRon,
                        status: String(o.status || ''),
                        inserted_at: o.inserted_at,
                        customer_name: customerName,
                        product_codes: productCodes,
                        source: 'direct_api',
                    });
                }
                page++;
            }
        } catch (e: any) {
            console.error(`POS ${shop.name} error:`, e.message);
        }
    }));

    console.log(`Direct POS: ${allOrders.length} orders for ${fromDate}→${toDate}`);
    return allOrders;
}

// ═══ Hybrid POS: Direct API for recent N days + BQ for older history ═══
// Direct API is always fresh; BQ may lag if sync is delayed.
// Use Direct API for the last FRESH_DAYS to guarantee data completeness.
const POS_FRESH_DAYS = 4;

async function fetchPOSHybrid(shops: YamlConfig["poscake"]["shops"], fromDate: string, toDate: string, today: string) {
    const freshBoundary = (() => {
        const d = new Date(today);
        d.setDate(d.getDate() - POS_FRESH_DAYS);
        return d.toISOString().slice(0, 10);
    })();

    const tasks: Promise<any[]>[] = [];

    // BQ for dates older than fresh window (reliable for historical data)
    if (fromDate <= freshBoundary) {
        const bqEnd = toDate <= freshBoundary ? toDate : freshBoundary;
        tasks.push(fetchPOSFromBigQuery(fromDate, bqEnd));
    }

    // Direct API for dates within fresh window (always up-to-date)
    const directFrom = fromDate > freshBoundary
        ? fromDate
        : (() => { const d = new Date(freshBoundary); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
    const directTo = toDate;

    if (directFrom <= directTo) {
        tasks.push(fetchPOSFromDirectAPIRange(shops, directFrom, directTo));
    }

    const results = await Promise.all(tasks);
    const allOrders = results.flat();

    // Dedup by order ID (in case BQ and Direct overlap at boundary)
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const o of allOrders) {
        if (!seen.has(o.id)) {
            seen.add(o.id);
            deduped.push(o);
        }
    }

    if (deduped.length < allOrders.length) {
        console.log(`POS dedup: ${allOrders.length} → ${deduped.length} (${allOrders.length - deduped.length} duplicates removed)`);
    }

    return deduped;
}

// ═══ MAIN HANDLER ═══
export async function GET(request: Request) {
    const startTime = Date.now();
    const { searchParams } = new URL(request.url);
    // Default: fetch ALL ads for the date range (not just active)
    // active_only=false allows matching historical POS orders with past ads
    const activeOnly = searchParams.get('active_only') === 'true';
    // STRAMARK timezone = Asia/Ho_Chi_Minh (Vietnam +7)
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    const fromDate = searchParams.get('from_date') || today;
    const toDate = searchParams.get('to_date') || today;

    try {
        const cfg = loadConfig();
        const token = cfg.meta_ads.access_token;
        const accountIds = cfg.meta_ads.ad_account_ids;
        const shops = cfg.poscake.shops;

        // Fetch in parallel: Meta ads + POS hybrid
        const [metaResult, orders] = await Promise.all([
            fetchMetaAds(token, accountIds, activeOnly, fromDate, toDate),
            fetchPOSHybrid(shops, fromDate, toDate, today),
        ]);

        const ads = metaResult.ads;
        const metaStatus = metaResult.metaStatus;

        // Build ad_id → ad index map for O(1) lookup
        const adIdMap = new Map<string, number>();
        ads.forEach((ad, idx) => { if (ad.ad_id) adIdMap.set(ad.ad_id, idx); });

        // Per-campaign product aggregation: campaign_key → product_code → {orders, revenue_ron}.
        // "" code means the order had no extractable product code (still counted in totals).
        const campaignProductMap = new Map<string, Map<string, { orders: number; revenue_ron: number }>>();
        const bumpCampaignProduct = (key: string, codes: string[], revenue: number) => {
            let inner = campaignProductMap.get(key);
            if (!inner) { inner = new Map(); campaignProductMap.set(key, inner); }
            const targetCodes = codes.length > 0 ? codes : [""];
            for (const code of targetCodes) {
                const entry = inner.get(code);
                if (entry) { entry.orders += 1; entry.revenue_ron += revenue; }
                else inner.set(code, { orders: 1, revenue_ron: revenue });
            }
        };

        // ── PASS 1: Exact ad_id match ──
        const matchedOrders: any[] = [];
        const pass1Unmatched: any[] = [];

        for (const order of orders) {
            if (order.utm_ad_id && adIdMap.has(order.utm_ad_id)) {
                const adIdx = adIdMap.get(order.utm_ad_id)!;
                ads[adIdx].orders += 1;
                ads[adIdx].revenue_ron += order.total_price_ron;
                ads[adIdx].order_details.push({
                    id: order.id, shop: order.shop_name,
                    price_ron: order.total_price_ron,
                    customer: order.customer_name,
                });
                bumpCampaignProduct(
                    `${ads[adIdx].account_id}__${ads[adIdx].campaign_id}`,
                    order.product_codes || [], order.total_price_ron,
                );
                matchedOrders.push(order);
            } else {
                pass1Unmatched.push(order);
            }
        }

        // ── PASS 2: Graph API lookup for unmatched POS ad_ids ──
        // Collect unique ad_ids that didn't match any Meta insights ad
        const unknownAdIds = new Set<string>();
        let ordersWithUtmAdId = 0;
        let ordersWithoutUtmAdId = 0;
        for (const order of pass1Unmatched) {
            if (order.utm_ad_id && !adIdMap.has(order.utm_ad_id)) {
                unknownAdIds.add(order.utm_ad_id);
                ordersWithUtmAdId++;
            } else if (!order.utm_ad_id) {
                ordersWithoutUtmAdId++;
            }
        }
        console.log(`📊 Pass1 unmatched: ${pass1Unmatched.length} total, ${ordersWithUtmAdId} with utm_ad_id (${unknownAdIds.size} unique), ${ordersWithoutUtmAdId} without`);

        // Batch lookup via Graph API — resolve unknown ad_ids to get campaign info
        const adLookupMap = new Map<string, { name: string; campaign_id: string; adset_id: string; campaign_name: string; adset_name: string; account_id: string }>();
        if (unknownAdIds.size > 0) {
            const idsArray = Array.from(unknownAdIds);
            console.log(`📎 Graph lookup: ${idsArray.length} ad_ids to resolve`);

            // Process sequentially in batches to avoid rate limit + ensure logging
            for (const adId of idsArray) {
                try {
                    // Simple fields only — no edge expansion to avoid syntax issues
                    const lookupUrl = `https://graph.facebook.com/v21.0/${adId}?fields=name,campaign_id,adset_id,account_id&access_token=${token}`;
                    const lookupRes = await fetchIPv4(lookupUrl, { signal: AbortSignal.timeout(5000) });
                    const lookupData: any = await lookupRes.json();

                    if (lookupData.error) {
                        console.log(`  ❌ ${adId}: ${lookupData.error.message?.substring(0, 80)}`);
                        continue;
                    }
                    if (!lookupData.campaign_id) {
                        console.log(`  ❌ ${adId}: no campaign_id in response`);
                        continue;
                    }

                    // Got campaign_id — now lookup campaign name
                    let campaignName = '';
                    let adsetName = '';
                    try {
                        const campUrl = `https://graph.facebook.com/v21.0/${lookupData.campaign_id}?fields=name&access_token=${token}`;
                        const campRes = await fetchIPv4(campUrl, { signal: AbortSignal.timeout(5000) });
                        const campData: any = await campRes.json();
                        campaignName = campData.name || '';
                    } catch { /* skip */ }

                    adLookupMap.set(adId, {
                        name: lookupData.name || `Ad ${adId}`,
                        campaign_id: lookupData.campaign_id,
                        adset_id: lookupData.adset_id || '',
                        campaign_name: campaignName,
                        adset_name: adsetName,
                        account_id: lookupData.account_id || '',
                    });
                    console.log(`  ✅ ${adId} → campaign_id=${lookupData.campaign_id} name=${campaignName.substring(0, 40)}`);
                } catch (e: any) {
                    console.log(`  ⚠️ ${adId}: ${e.message?.substring(0, 80)}`);
                }
            }
            console.log(`📎 Lookup done: ${adLookupMap.size}/${unknownAdIds.size} resolved`);
        }

        // Aggregate lookup-matched and campaign-name-matched orders
        const lookupMatchedOrders: any[] = [];
        const campaignMatchedOrders: any[] = [];
        const unmatchedOrders: any[] = [];

        // Build adset_id → best active ad index map (highest-spend ad per adset)
        const adsetToAdIdx = new Map<string, number>();
        ads.forEach((ad, idx) => {
            if (ad.adset_id) {
                const existing = adsetToAdIdx.get(ad.adset_id);
                if (existing === undefined || ad.spend > ads[existing].spend) {
                    adsetToAdIdx.set(ad.adset_id, idx);
                }
            }
        });

        // Build campaign_name → campaign_id map for fallback
        const campaignNameToId = new Map<string, { account_id: string; campaign_id: string }>();
        ads.forEach(ad => {
            if (ad.campaign_name && !campaignNameToId.has(ad.campaign_name)) {
                campaignNameToId.set(ad.campaign_name, { account_id: ad.account_id, campaign_id: ad.campaign_id });
            }
        });
        for (const [, info] of adLookupMap) {
            if (info.campaign_name && !campaignNameToId.has(info.campaign_name)) {
                campaignNameToId.set(info.campaign_name, { account_id: `act_${info.account_id}`, campaign_id: info.campaign_id });
            }
        }

        // Campaign-level POS aggregation for orders that can't match at ad/adset level
        const campaignOrdersMap = new Map<string, { orders: number; revenue_ron: number }>();

        for (const order of pass1Unmatched) {
            let matched = false;

            // ── Pass 2: Adset-level match via Graph API lookup ──
            // Use looked-up adset_id to find an active ad in the same adset
            if (!matched && order.utm_ad_id && adLookupMap.has(order.utm_ad_id)) {
                const info = adLookupMap.get(order.utm_ad_id)!;
                const adsetId = info.adset_id;

                if (adsetId && adsetToAdIdx.has(adsetId)) {
                    // Found active ad in same adset → attribute at ad level!
                    const adIdx = adsetToAdIdx.get(adsetId)!;
                    ads[adIdx].orders += 1;
                    ads[adIdx].revenue_ron += order.total_price_ron;
                    ads[adIdx].order_details.push({
                        id: order.id, shop: order.shop_name,
                        price_ron: order.total_price_ron,
                        customer: order.customer_name,
                    });
                    bumpCampaignProduct(
                        `${ads[adIdx].account_id}__${ads[adIdx].campaign_id}`,
                        order.product_codes || [], order.total_price_ron,
                    );
                    lookupMatchedOrders.push(order);
                    matched = true;
                } else {
                    // No active ad in same adset → fall through to campaign level
                    const key = `act_${info.account_id}__${info.campaign_id}`;
                    const existing = campaignOrdersMap.get(key);
                    if (existing) {
                        existing.orders += 1;
                        existing.revenue_ron += order.total_price_ron;
                    } else {
                        campaignOrdersMap.set(key, { orders: 1, revenue_ron: order.total_price_ron });
                    }
                    bumpCampaignProduct(key, order.product_codes || [], order.total_price_ron);
                    lookupMatchedOrders.push(order);
                    matched = true;
                }
            }

            // ── Pass 2b: Direct adset match via p_utm_medium ──
            if (!matched && order.utm_adset_id && adsetToAdIdx.has(order.utm_adset_id)) {
                const adIdx = adsetToAdIdx.get(order.utm_adset_id)!;
                ads[adIdx].orders += 1;
                ads[adIdx].revenue_ron += order.total_price_ron;
                ads[adIdx].order_details.push({
                    id: order.id, shop: order.shop_name,
                    price_ron: order.total_price_ron,
                    customer: order.customer_name,
                });
                bumpCampaignProduct(
                    `${ads[adIdx].account_id}__${ads[adIdx].campaign_id}`,
                    order.product_codes || [], order.total_price_ron,
                );
                lookupMatchedOrders.push(order);
                matched = true;
            }

            // ── Pass 3: Campaign name fallback → campaign level ──
            if (!matched && order.utm_campaign && campaignNameToId.has(order.utm_campaign)) {
                const { account_id, campaign_id } = campaignNameToId.get(order.utm_campaign)!;
                const key = `${account_id}__${campaign_id}`;
                const existing = campaignOrdersMap.get(key);
                if (existing) {
                    existing.orders += 1;
                    existing.revenue_ron += order.total_price_ron;
                } else {
                    campaignOrdersMap.set(key, { orders: 1, revenue_ron: order.total_price_ron });
                }
                bumpCampaignProduct(key, order.product_codes || [], order.total_price_ron);
                campaignMatchedOrders.push(order);
                matched = true;
            }

            if (!matched) {
                unmatchedOrders.push(order);
            }
        }

        const totalMatched = matchedOrders.length + lookupMatchedOrders.length + campaignMatchedOrders.length;
        console.log(`Matching: ${matchedOrders.length} by ad_id, ${lookupMatchedOrders.length} by lookup, ${campaignMatchedOrders.length} by campaign_name, ${unmatchedOrders.length} unmatched`);

        // Group ads by campaign
        const campaignMap = new Map<string, any>();
        for (const ad of ads) {
            const key = `${ad.account_id}__${ad.campaign_id}`;
            const existing = campaignMap.get(key);
            if (existing) {
                existing.spend += ad.spend;
                existing.impressions += ad.impressions;
                existing.messages += ad.messages;
                existing.purchases += ad.purchases;
                existing.orders += ad.orders;
                existing.revenue_ron += ad.revenue_ron;
                existing.ads.push(ad);
            } else {
                campaignMap.set(key, {
                    account_id: ad.account_id,
                    account_name: ad.account_name,
                    campaign_id: ad.campaign_id,
                    campaign_name: ad.campaign_name,
                    campaign_status: ad.campaign_status || "UNKNOWN",
                    spend: ad.spend,
                    impressions: ad.impressions,
                    cpm: ad.cpm,
                    ctr: ad.ctr,
                    messages: ad.messages,
                    purchases: ad.purchases,
                    orders: ad.orders,
                    revenue_ron: ad.revenue_ron,
                    roas: 0,
                    ads: [ad],
                });
            }
        }

        // Inject campaign-name-only matched orders into campaign groups
        for (const [key, campOrders] of campaignOrdersMap) {
            const campaign = campaignMap.get(key);
            if (campaign) {
                campaign.orders += campOrders.orders;
                campaign.revenue_ron += campOrders.revenue_ron;
            }
        }

        // Calculate ROAS per campaign & build output (incl. orders_by_product breakdown)
        const productMapToObj = (m?: Map<string, { orders: number; revenue_ron: number }>) => {
            const out: Record<string, { orders: number; revenue_ron: number }> = {};
            if (m) for (const [code, v] of m) out[code] = v;
            return out;
        };
        const campaigns = Array.from(campaignMap.values()).map(c => {
            const key = `${c.account_id}__${c.campaign_id}`;
            return {
                ...c,
                roas: c.spend > 0 ? Math.round((c.revenue_ron / c.spend) * 100) / 100 : 0,
                cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
                ads_count: c.ads.length,
                orders_by_product: productMapToObj(campaignProductMap.get(key)),
                ads: c.ads.map((a: any) => ({
                    ad_id: a.ad_id, ad_name: a.ad_name, adset_id: a.adset_id, adset_name: a.adset_name,
                    ad_status: a.ad_status || "UNKNOWN",
                    adset_status: a.adset_status || "UNKNOWN",
                    spend: a.spend, impressions: a.impressions,
                    cpm: a.cpm, cpc: a.cpc, ctr: a.ctr,
                    messages: a.messages, purchases: a.purchases,
                    orders: a.orders, revenue_ron: a.revenue_ron,
                    roas: a.spend > 0 ? Math.round((a.revenue_ron / a.spend) * 100) / 100 : 0,
                })),
            };
        }).sort((a, b) => b.spend - a.spend);

        // POS-side product breakdown (independent of ad attribution).
        // pos_orders_by_product: total POS orders/revenue per product code (matches POS UI count).
        // unmatched_by_product: orders not attributed to any campaign — surfaces D04 sales that lost UTM.
        const posOrdersByProduct: Record<string, { orders: number; revenue_ron: number }> = {};
        const unmatchedByProduct: Record<string, { orders: number; revenue_ron: number }> = {};
        const bumpProductRecord = (rec: Record<string, { orders: number; revenue_ron: number }>, codes: string[], revenue: number) => {
            const target = codes.length > 0 ? codes : [""];
            for (const code of target) {
                if (rec[code]) { rec[code].orders += 1; rec[code].revenue_ron += revenue; }
                else rec[code] = { orders: 1, revenue_ron: revenue };
            }
        };
        for (const o of orders) bumpProductRecord(posOrdersByProduct, o.product_codes || [], o.total_price_ron);
        for (const o of unmatchedOrders) bumpProductRecord(unmatchedByProduct, o.product_codes || [], o.total_price_ron);

        // Summary
        const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
        const matchedRevenue = campaigns.reduce((s, c) => s + c.revenue_ron, 0);
        const matchedOrderCount = campaigns.reduce((s, c) => s + c.orders, 0);
        const totalMessages = campaigns.reduce((s, c) => s + c.messages, 0);
        const totalPurchases = campaigns.reduce((s, c) => s + c.purchases, 0);

        // Unmatched by shop
        const unmatchedByShop: Record<string, { count: number; revenue_ron: number }> = {};
        let unmatchedRevenue = 0;
        for (const o of unmatchedOrders) {
            const shop = o.shop_name || 'Unknown';
            if (!unmatchedByShop[shop]) unmatchedByShop[shop] = { count: 0, revenue_ron: 0 };
            unmatchedByShop[shop].count += 1;
            unmatchedByShop[shop].revenue_ron += o.total_price_ron;
            unmatchedRevenue += o.total_price_ron;
        }

        const totalRevenue = matchedRevenue + unmatchedRevenue;

        // POS source label
        const hasBQ = orders.some((o: any) => o.source === 'bigquery');
        const hasDirect = orders.some((o: any) => o.source === 'direct_api');
        const posSource = hasBQ && hasDirect ? 'BQ+API' : hasBQ ? 'BigQuery' : 'Direct API';

        // Meta source label
        const metaLabel = metaStatus.token_valid
            ? (metaStatus.accounts_blocked.length > 0 ? 'Partial' : 'Direct')
            : 'BLOCKED';

        return NextResponse.json({
            source: `META:${metaLabel}|POS:${posSource}`,
            fetched_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            // ── Meta API status for frontend error display ──
            meta_status: {
                token_valid: metaStatus.token_valid,
                error_code: metaStatus.error_code,
                error_message: metaStatus.error_message,
                accounts_ok: metaStatus.accounts_ok,
                accounts_blocked: metaStatus.accounts_blocked,
                rate_limit_pct: metaStatus.rate_limit_pct,
            },
            summary: {
                total_spend: totalSpend,       // USD
                total_revenue_ron: totalRevenue,
                matched_revenue_ron: matchedRevenue,
                unmatched_revenue_ron: unmatchedRevenue,
                total_orders: matchedOrderCount,
                total_messages: totalMessages,
                matched_orders: matchedOrders.length,
                lookup_matched_orders: lookupMatchedOrders.length,
                campaign_matched_orders: campaignMatchedOrders.length,
                total_matched_orders: totalMatched,
                unmatched_orders: unmatchedOrders.length,
                total_pos_orders: orders.length,
                total_meta_purchases: totalPurchases,
                blended_roas: totalSpend > 0 ? Math.round((totalRevenue / totalSpend) * 100) / 100 : 0,
                accounts_fetched: accountIds.length,
                shops_fetched: shops.length,
            },
            campaigns,
            unmatched_orders: unmatchedOrders.slice(0, 20).map(o => ({
                id: String(o.id || ''), shop: String(o.shop_name || ''),
                price_ron: o.total_price_ron,
                utm_ad_id: o.utm_ad_id || 'none',
                utm_campaign: o.utm_campaign || '',
                marketer: String(o.marketer || ''),
                product_codes: o.product_codes || [],
            })),
            unmatched_by_shop: unmatchedByShop,
            // Product-level POS breakdown — frontend uses this to filter by SKU (e.g. "D04")
            // and recover the true POS order count regardless of ad attribution status.
            pos_orders_by_product: posOrdersByProduct,
            unmatched_by_product: unmatchedByProduct,
        });
    } catch (error: any) {
        console.error("STRAMARK Realtime API error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * POST handler — Toggle campaign status (ACTIVE ↔ PAUSED)
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { action, campaign_id, status } = body;

        if (action !== "toggle_campaign" || !campaign_id || !status) {
            return NextResponse.json({ error: "Invalid request" }, { status: 400 });
        }

        if (!["ACTIVE", "PAUSED"].includes(status)) {
            return NextResponse.json({ error: "Status must be ACTIVE or PAUSED" }, { status: 400 });
        }

        const cfg = loadConfig();
        const token = cfg.meta_ads.access_token;

        const res = await fetch(
            `https://graph.facebook.com/v21.0/${campaign_id}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status,
                    access_token: token,
                }),
            }
        );

        const data = await res.json();

        if (data.error) {
            return NextResponse.json({
                success: false,
                error: data.error.message || "Meta API error",
            }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            campaign_id,
            new_status: status,
        });
    } catch (error: any) {
        console.error("Toggle campaign error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
