/**
 * CAPI Push API — Real-time Meta Conversions API push for Stramark POS orders.
 *
 * GET  → Status: pending/pushed order counts, last push info
 * POST → Push unpushed confirmed POS orders to Meta CAPI
 *
 * Flow: POS orders (confirmed/delivered) → SHA256 hash PII → POST to Meta CAPI v21.0 → Log to BQ
 * Deduplication: event_id = order_id (checked against capi_push_log in BQ)
 */

import { NextResponse } from "next/server";
import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";
import { randomUUID } from "crypto";
import { bigquery } from "@/lib/bigquery";
import { buildEvent, type OrderData } from "@/lib/capi-transform";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ═══ CONFIG ═══
const BQ_PROJECT = "levelup-465304";
const BQ_DATASET = "STRAMARK_Dataset";
const META_CAPI_URL = "https://graph.facebook.com/v21.0";
const BATCH_SIZE = 100;
const POS_PRICE_DIVISOR = 100;

interface YamlConfig {
    meta_ads: { access_token: string; ad_account_ids: string[] };
    poscake: { shops: Array<{ name: string; api_url: string; api_key: string; shop_id: string }> };
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

function loadConfig(): YamlConfig & { meta_ads: { pixel_id: string } } {
    loadParentEnv();
    const yamlPath = path.join(process.cwd(), "..", "config", "projects", "stramark.yaml");
    const raw = fs.readFileSync(yamlPath, "utf-8");
    const parsed = yaml.load(raw);
    return resolveEnvVars(parsed) as any;
}

// ═══ Fetch POS orders — Hybrid: BQ for history + Direct API for recent ═══
// Same approach as realtime route to ensure consistent data
const POS_FRESH_DAYS = 4;

function parseOrderFromPOS(o: any): OrderData | null {
    const status = String(o.status || "");
    // Exclude canceled/returning/returned
    const excludedStatuses = new Set(["-1", "6", "9", "10"]);
    if (excludedStatuses.has(status)) return null;

    const insertedAt = String(o.inserted_at || "");
    const orderDate = insertedAt.slice(0, 10);
    const rawPrice = (o.cod || o.total_price || 0) / POS_PRICE_DIVISOR;
    const currency = String(o.order_currency || "RON").toUpperCase();

    const custName = o.bill_full_name || o.customer_name || "";
    const customerName = typeof custName === "object" ? (custName.name || "") : custName;
    const custPhone = o.customer_phone || o.bill_phone_number || "";
    const custEmail = o.customer_email || "";
    const custCity = o.customer_city || o.bill_city || "";

    return {
        order_id: String(o.id || ""),
        order_date: orderDate,
        event_time: Math.floor(new Date(insertedAt).getTime() / 1000) || Math.floor(Date.now() / 1000),
        customer_phone: String(typeof custPhone === "object" ? "" : custPhone),
        customer_email: String(typeof custEmail === "object" ? "" : custEmail),
        customer_name: String(customerName),
        customer_city: String(typeof custCity === "object" ? "" : custCity),
        customer_country_code: "ro",
        value: rawPrice,
        currency,
        content_ids: [],
        num_items: 1,
    };
}

async function fetchPOSFromBigQuery(fromDate: string, toDate: string): Promise<OrderData[]> {
    const orders: OrderData[] = [];
    try {
        const query = `
            SELECT
                id, status, total_price, cod,
                customer_phone, customer_email, customer_name,
                bill_full_name, bill_phone_number, bill_city,
                customer_city, order_currency,
                CAST(inserted_at AS STRING) AS inserted_at
            FROM \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\`
            WHERE DATE(CAST(inserted_at AS TIMESTAMP)) >= @fromDate
              AND DATE(CAST(inserted_at AS TIMESTAMP)) <= @toDate
              AND status NOT IN (-1, 6, 9, 10)
            ORDER BY inserted_at DESC
        `;
        const [rows] = await bigquery.query({ query, params: { fromDate, toDate } });
        for (const row of rows) {
            const parsed = parseOrderFromPOS(row);
            if (parsed) orders.push(parsed);
        }
        console.log(`[CAPI] BQ POS: ${orders.length} orders for ${fromDate}→${toDate}`);
    } catch (e: any) {
        console.error("[CAPI] BQ POS error:", e.message);
    }
    return orders;
}

async function fetchPOSFromDirectAPI(
    shops: YamlConfig["poscake"]["shops"],
    fromDate: string,
    toDate: string,
): Promise<OrderData[]> {
    const orders: OrderData[] = [];
    for (const shop of shops) {
        let page = 1;
        let reachedPast = false;
        while (!reachedPast && page <= 500) {
            const url = `${shop.api_url}/shops/${shop.shop_id}/orders?api_key=${shop.api_key}&page=${page}&sort=-inserted_at`;
            const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
            if (!res.ok) break;
            const data = await res.json();
            const items = data.data || [];
            if (items.length === 0) break;
            for (const o of items) {
                const insertedAt = String(o.inserted_at || "");
                const orderDate = insertedAt.slice(0, 10);
                if (orderDate > toDate) continue;
                if (orderDate < fromDate) { reachedPast = true; break; }
                const parsed = parseOrderFromPOS(o);
                if (parsed) orders.push(parsed);
            }
            page++;
        }
    }
    console.log(`[CAPI] Direct POS: ${orders.length} orders for ${fromDate}→${toDate}`);
    return orders;
}

async function fetchPOSHybrid(
    shops: YamlConfig["poscake"]["shops"],
    fromDate: string,
    toDate: string,
): Promise<OrderData[]> {
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
    const freshBoundary = (() => {
        const d = new Date(today);
        d.setDate(d.getDate() - POS_FRESH_DAYS);
        return d.toISOString().slice(0, 10);
    })();

    const tasks: Promise<OrderData[]>[] = [];

    // BQ for dates older than fresh window
    if (fromDate <= freshBoundary) {
        const bqEnd = toDate <= freshBoundary ? toDate : freshBoundary;
        tasks.push(fetchPOSFromBigQuery(fromDate, bqEnd));
    }

    // Direct API for recent dates
    const directFrom = fromDate > freshBoundary
        ? fromDate
        : (() => { const d = new Date(freshBoundary); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
    if (directFrom <= toDate) {
        tasks.push(fetchPOSFromDirectAPI(shops, directFrom, toDate));
    }

    const results = await Promise.all(tasks);
    const allOrders = results.flat();

    // Dedup by order_id
    const seen = new Set<string>();
    const deduped: OrderData[] = [];
    for (const o of allOrders) {
        if (!seen.has(o.order_id)) {
            seen.add(o.order_id);
            deduped.push(o);
        }
    }

    console.log(`[CAPI] Hybrid POS: ${deduped.length} orders (deduped from ${allOrders.length})`);
    return deduped;
}

// ═══ Get already-pushed order IDs from BigQuery ═══
async function getAlreadyPushedOrderIds(fromDate: string, toDate: string): Promise<Set<string>> {
    const pushed = new Set<string>();
    try {
        const query = `
            SELECT DISTINCT order_id
            FROM \`${BQ_PROJECT}.${BQ_DATASET}.capi_push_log\`
            WHERE push_success = TRUE
              AND DATE(pushed_at) >= @fromDate
        `;
        const [rows] = await bigquery.query({
            query,
            params: { fromDate },
        });
        for (const row of rows) {
            pushed.add(String(row.order_id));
        }
    } catch (e: any) {
        // Table might not exist yet — treat as empty
        console.warn("capi_push_log query failed (may not exist):", e.message);
    }
    return pushed;
}

// ═══ Push events to Meta CAPI ═══
async function pushToMetaCAPI(
    events: Record<string, any>[],
    pixelId: string,
    accessToken: string,
    testEventCode?: string,
): Promise<{
    events_received: number;
    fbtrace_ids: string[];
    errors: string[];
    batch_results: Array<{ batch: number; status: number; received: number; error?: string }>;
}> {
    const url = `${META_CAPI_URL}/${pixelId}/events`;
    let totalReceived = 0;
    const fbtraceIds: string[] = [];
    const errors: string[] = [];
    const batchResults: Array<{ batch: number; status: number; received: number; error?: string }> = [];

    for (let i = 0; i < events.length; i += BATCH_SIZE) {
        const batch = events.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;

        const payload: Record<string, any> = {
            data: batch,
            access_token: accessToken,
        };
        if (testEventCode) {
            payload.test_event_code = testEventCode;
        }

        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(30000),
            });

            const body = await res.json();

            if (res.status === 200 && !body.error) {
                const received = body.events_received || 0;
                const fbtrace = body.fbtrace_id || "";
                totalReceived += received;
                if (fbtrace) fbtraceIds.push(fbtrace);
                batchResults.push({ batch: batchNum, status: 200, received });
                console.log(`[CAPI] Batch ${batchNum}: ${received}/${batch.length} events received`);
            } else {
                const errorMsg = body.error?.message || `HTTP ${res.status}`;
                errors.push(`Batch ${batchNum}: ${errorMsg}`);
                batchResults.push({ batch: batchNum, status: res.status, received: 0, error: errorMsg });
                console.error(`[CAPI] Batch ${batchNum} FAILED:`, errorMsg);
            }
        } catch (e: any) {
            errors.push(`Batch ${batchNum}: ${e.message}`);
            batchResults.push({ batch: batchNum, status: 0, received: 0, error: e.message });
            console.error(`[CAPI] Batch ${batchNum} exception:`, e.message);
        }
    }

    return { events_received: totalReceived, fbtrace_ids: fbtraceIds, errors, batch_results: batchResults };
}

// ═══ Log push results to BigQuery ═══
async function logPushResults(
    orders: OrderData[],
    pushResult: Awaited<ReturnType<typeof pushToMetaCAPI>>,
    pixelId: string,
    runId: string,
): Promise<void> {
    try {
        const tableId = `${BQ_PROJECT}.${BQ_DATASET}.capi_push_log`;
        const success = pushResult.errors.length === 0;
        const fbtrace = pushResult.fbtrace_ids[0] || "";

        const rows = orders.map((order) => ({
            push_id: randomUUID(),
            project_id: "stramark",
            run_id: runId,
            order_id: order.order_id,
            order_date: order.order_date || null,
            order_value: order.value,
            currency: order.currency,
            event_id: order.order_id,
            pixel_id: pixelId,
            meta_response_code: success ? 200 : 500,
            meta_events_received: pushResult.events_received,
            meta_error: pushResult.errors.join("; ").slice(0, 500) || null,
            push_success: success,
            pushed_at: new Date().toISOString(),
        }));

        await bigquery.dataset(BQ_DATASET).table("capi_push_log").insert(rows);
        console.log(`[CAPI] Logged ${rows.length} events to capi_push_log`);
    } catch (e: any) {
        console.error("[CAPI] BQ log failed:", e.message);
    }
}

// ═══ GET: Check CAPI push status ═══
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
    const fromDate = searchParams.get("from_date") || today;
    const toDate = searchParams.get("to_date") || today;

    try {
        const cfg = loadConfig();
        const shops = cfg.poscake.shops;
        const pixelId = cfg.meta_ads.pixel_id;

        // Fetch in parallel: POS orders (hybrid BQ+API) + already pushed
        const [posOrders, pushedIds] = await Promise.all([
            fetchPOSHybrid(shops, fromDate, toDate),
            getAlreadyPushedOrderIds(fromDate, toDate),
        ]);

        const unpushed = posOrders.filter((o) => !pushedIds.has(o.order_id));
        const pushed = posOrders.filter((o) => pushedIds.has(o.order_id));

        // Get last push timestamp
        let lastPushAt: string | null = null;
        try {
            const [rows] = await bigquery.query({
                query: `SELECT MAX(pushed_at) as last_push FROM \`${BQ_PROJECT}.${BQ_DATASET}.capi_push_log\` WHERE push_success = TRUE AND project_id = 'stramark'`,
            });
            lastPushAt = rows[0]?.last_push?.value || null;
        } catch { /* ignore */ }

        return NextResponse.json({
            status: "ok",
            pixel_id: pixelId,
            date_range: { from: fromDate, to: toDate },
            total_confirmed_orders: posOrders.length,
            already_pushed: pushed.length,
            pending_push: unpushed.length,
            unpushed_order_ids: unpushed.slice(0, 50).map((o) => o.order_id),
            last_push_at: lastPushAt,
            total_value_pending: Math.round(unpushed.reduce((s, o) => s + o.value, 0) * 100) / 100,
        });
    } catch (error: any) {
        console.error("CAPI status error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// ═══ POST: Push confirmed orders to Meta CAPI ═══
export async function POST(request: Request) {
    const startTime = Date.now();

    try {
        const body = await request.json();
        const {
            from_date,
            to_date,
            order_ids,         // optional: push specific orders only
            dry_run = false,
            test_event_code,   // optional: for Meta test events
        } = body;

        const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
        const fromDate = from_date || today;
        const toDate = to_date || today;

        const cfg = loadConfig();
        const shops = cfg.poscake.shops;
        const pixelId = cfg.meta_ads.pixel_id;
        const accessToken = cfg.meta_ads.access_token;

        if (!pixelId || !accessToken) {
            return NextResponse.json({ error: "Missing pixel_id or access_token in config" }, { status: 500 });
        }

        // Fetch POS orders (hybrid BQ+API) + already pushed
        const [posOrders, pushedIds] = await Promise.all([
            fetchPOSHybrid(shops, fromDate, toDate),
            getAlreadyPushedOrderIds(fromDate, toDate),
        ]);

        // Filter to unpushed only
        let unpushed = posOrders.filter((o) => !pushedIds.has(o.order_id));

        // If specific order_ids requested, filter further
        if (order_ids && Array.isArray(order_ids) && order_ids.length > 0) {
            const idsSet = new Set(order_ids.map(String));
            unpushed = unpushed.filter((o) => idsSet.has(o.order_id));
        }

        if (unpushed.length === 0) {
            return NextResponse.json({
                status: "SKIPPED",
                reason: "No unpushed confirmed orders found",
                total_confirmed: posOrders.length,
                already_pushed: pushedIds.size,
                duration_ms: Date.now() - startTime,
            });
        }

        // Build CAPI events
        const events = unpushed.map(buildEvent);
        const runId = randomUUID();

        console.log(`[CAPI] Built ${events.length} Purchase events for push (dry_run=${dry_run})`);

        if (dry_run) {
            return NextResponse.json({
                status: "DRY_RUN",
                run_id: runId,
                order_count: unpushed.length,
                events_preview: events.slice(0, 3).map((e) => ({
                    event_id: e.event_id,
                    event_name: e.event_name,
                    value: e.custom_data.value,
                    currency: e.custom_data.currency,
                    has_email: !!e.user_data.em,
                    has_phone: !!e.user_data.ph,
                    has_name: !!e.user_data.fn,
                })),
                total_value: Math.round(unpushed.reduce((s, o) => s + o.value, 0) * 100) / 100,
                duration_ms: Date.now() - startTime,
            });
        }

        // Push to Meta CAPI
        const pushResult = await pushToMetaCAPI(events, pixelId, accessToken, test_event_code);

        // Log to BigQuery
        if (pushResult.events_received > 0) {
            await logPushResults(unpushed, pushResult, pixelId, runId);
        }

        return NextResponse.json({
            status: pushResult.errors.length === 0 ? "SUCCESS" : "PARTIAL",
            run_id: runId,
            order_count: unpushed.length,
            events_pushed: pushResult.events_received,
            fbtrace_ids: pushResult.fbtrace_ids,
            errors: pushResult.errors,
            batch_results: pushResult.batch_results,
            total_value: Math.round(unpushed.reduce((s, o) => s + o.value, 0) * 100) / 100,
            duration_ms: Date.now() - startTime,
        });
    } catch (error: any) {
        console.error("CAPI push error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
