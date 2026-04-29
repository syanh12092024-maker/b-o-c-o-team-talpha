import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

// ── Audit log: persist sync history ──
const HISTORY_PATH = join(process.cwd(), "..", "data", "stramark", "status_sync_history.json");
const MAX_HISTORY_ENTRIES = 50;

interface SyncHistoryEntry {
    timestamp: string;
    stats: { checked: number; updated: number; unchanged: number; skipped: number; errors: number; totalRefs: number };
    updates: Array<{
        posOrderId: string;
        euStatus: string;
        posStatus: string;
        currentPosStatus: string;
        label: string;
        result: string;
    }>;
}

function loadSyncHistory(): SyncHistoryEntry[] {
    try {
        if (!existsSync(HISTORY_PATH)) return [];
        const raw = readFileSync(HISTORY_PATH, "utf-8");
        const data = JSON.parse(raw);
        return Array.isArray(data?.entries) ? data.entries : [];
    } catch { return []; }
}

function appendSyncHistory(entry: SyncHistoryEntry): void {
    const dir = dirname(HISTORY_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const entries = loadSyncHistory();
    entries.unshift(entry); // newest first
    const trimmed = entries.slice(0, MAX_HISTORY_ENTRIES);
    writeFileSync(HISTORY_PATH, JSON.stringify({ entries: trimmed }, null, 2), "utf-8");
}

/**
 * Stramark — Status Sync: euShipments → POS Cake
 *
 * POST /api/stramark/eushipments/status-sync
 *   body: { refNums?: string[], dryRun?: boolean }
 *
 * Flow:
 *   1. Get active (non-final) orders from POS Cake
 *   2. Batch-query euShipments orders-history for status
 *   3. Map last status → POS Cake status
 *   4. Update POS Cake via PUT
 *
 * Status mapping (verified from real API data 2026-03-19):
 * ┌─────────────────────────────────┬─────────────┬──────────────────────────┐
 * │ euShipments Last Status         │ → POS Cake  │ Nghĩa                    │
 * ├─────────────────────────────────┼─────────────┼──────────────────────────┤
 * │ Delivered                       │ delivered   │ KH đã nhận               │
 * │ Product returned to stock       │ returned    │ Đã hoàn (nhập kho)       │
 * │ Returned to Warehouse           │ returning   │ Đang hoàn (về kho)       │
 * │ Returned / Returning            │ returning   │ Đang hoàn (courier trả)  │
 * │ On delivery / In transit /      │ shipped     │ Đang vận chuyển          │
 * │   In the office / Warehouse ... │             │                          │
 * │   Scanned Waybill / Picked up / │             │                          │
 * │   Unsuccessful delivery attempt │             │                          │
 * └─────────────────────────────────┴─────────────┴──────────────────────────┘
 *
 * Statuses ignored (chưa gửi): Information received, Awaiting pickup, Packed, New
 */

export const dynamic = "force-dynamic";

const EU_API_BASE = "https://api1.inout.bg/api/v1";
const EU_API_TOKEN = process.env.STRAMARK_FFM_API_TOKEN_2 || process.env.STRAMARK_FFM_API_TOKEN || "";

const POS_API_BASE = process.env.POSCAKE_API_URL || "https://pos.pages.fm/api/v1";
const POS_API_KEY = process.env.POSCAKE_API_KEY || "";
const POS_SHOP_ID = process.env.POSCAKE_SHOP_ID || "1635307570";

// ── Status Mapping ──────────────────────────────────────────────

const STATUS_DELIVERED = ["delivered"];
const STATUS_RETURNED_FINAL = ["product returned to stock", "returned to stock", "returned to sender"];
const STATUS_RETURNING = ["returned to warehouse", "returned", "returning", "return in progress"];
const STATUS_SHIPPED = [
    "on delivery", "in transit", "in the office",
    "warehouse oradea", "scanned waybill", "picked up",
    "unsuccessful delivery attempt",
];

function mapLastStatusToPos(lastStatus: string): { posStatus: string; label: string } | null {
    const s = lastStatus.toLowerCase().trim();

    if (STATUS_DELIVERED.some(x => s === x))
        return { posStatus: "delivered", label: "Delivered → Đã nhận" };

    if (STATUS_RETURNED_FINAL.some(x => s === x))
        return { posStatus: "returned", label: "Product returned to stock → Đã hoàn" };

    if (STATUS_RETURNING.some(x => s === x))
        return { posStatus: "returning", label: `${lastStatus} → Đang hoàn` };

    if (STATUS_SHIPPED.some(x => s === x))
        return { posStatus: "shipped", label: `${lastStatus} → Đã gửi hàng` };

    return null;
}

// ── euShipments API ─────────────────────────────────────────────

function euHeaders(): HeadersInit {
    return {
        Authorization: `Bearer ${EU_API_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
    };
}

interface StatusEvent {
    ID: number;
    STATUS: string;
    DATE: string;
    COMMENT: string | null;
}

interface OrderHistory {
    refNum: string;
    awb: string | null;
    error: string | null;
    statusesHistory: StatusEvent[];
}

/** POST /fulfilment/orders-history — batch up to 50 refs per call */
async function getOrdersHistory(refNums: string[]): Promise<OrderHistory[]> {
    const results: OrderHistory[] = [];
    const BATCH = 50;

    for (let i = 0; i < refNums.length; i += BATCH) {
        const batch = refNums.slice(i, i + BATCH);
        const payload = {
            testMode: false,
            orders: batch.map(r => ({ refNum: r })),
        };

        const resp = await fetch(`${EU_API_BASE}/fulfilment/orders-history`, {
            method: "POST",
            headers: euHeaders(),
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(30000),
        });

        if (resp.ok) {
            const data: OrderHistory[] = await resp.json();
            results.push(...data);
        }
    }

    return results;
}

// ── POS Cake API ────────────────────────────────────────────────

// Stramark POS: numeric→status_name mapping
// 0=new, 1=submitted, 2=shipped, 3=delivered, 4=returning, 5=returned, 6=canceled, 9=pending
const POS_STATUS_NUMERIC: Record<string, number> = {
    shipped: 2, delivered: 3, returning: 4, returned: 5, canceled: 6,
};

async function updatePosStatus(orderId: string, newStatus: string): Promise<boolean> {
    const numericStatus = POS_STATUS_NUMERIC[newStatus.toLowerCase()];
    if (numericStatus === undefined) {
        console.error(`No numeric POS code for status "${newStatus}"`);
        return false;
    }
    try {
        const resp = await fetch(
            `${POS_API_BASE}/shops/${POS_SHOP_ID}/orders/${orderId}?api_key=${POS_API_KEY}`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: numericStatus }),
                signal: AbortSignal.timeout(10000),
            }
        );
        return resp.ok;
    } catch {
        return false;
    }
}

/** Fetch POS orders that are not in a final state.
 *  Queries per-status to avoid missing orders buried under thousands of delivered/returned.
 *  Active statuses: 0=new, 1=submitted, 2=shipped, 4=returning, 8=packing, 9=pending
 */
async function getPosActiveOrders(): Promise<Array<{ id: string; status: string }>> {
    const ACTIVE_STATUS_CODES = [0, 1, 2, 4, 8, 9];
    const seen = new Set<string>();
    const activeOrders: Array<{ id: string; status: string }> = [];

    // NOTE: Pancake POS API ignores `limit` and always returns max 10 per page.
    // Must use `total_pages` from response to paginate, not page size comparison.
    for (const statusCode of ACTIVE_STATUS_CODES) {
        let page = 1;
        let totalPages = 1;

        while (page <= totalPages && page <= 50) {
            try {
                const resp = await fetch(
                    `${POS_API_BASE}/shops/${POS_SHOP_ID}/orders?api_key=${POS_API_KEY}&status=${statusCode}&page=${page}&limit=50`,
                    { signal: AbortSignal.timeout(15000) }
                );
                if (!resp.ok) break;

                const data = await resp.json();
                const orders = data.data || [];
                if (!Array.isArray(orders) || orders.length === 0) break;

                for (const o of orders) {
                    const id = String(o.id || "");
                    const status = String(o.status_name || o.status || "").toLowerCase();
                    if (id && !seen.has(id)) {
                        seen.add(id);
                        activeOrders.push({ id, status });
                    }
                }

                totalPages = data.total_pages || 1;
                page++;
            } catch {
                break;
            }
        }
    }

    return activeOrders;
}

// ── Main Handler ────────────────────────────────────────────────

export async function POST(request: Request) {
    try {
        if (!EU_API_TOKEN || !POS_API_KEY) {
            return NextResponse.json(
                { success: false, error: "Missing STRAMARK_FFM_API_TOKEN or POSCAKE_API_KEY in .env" },
                { status: 500 }
            );
        }

        const body = await request.json().catch(() => ({}));
        const dryRun = body.dryRun === true;
        const manualRefs: string[] | undefined = body.refNums; // optional: sync specific orders

        // 1. Determine which orders to sync + their current POS status
        let refNums: string[];
        const posCurrentStatus = new Map<string, string>(); // refNum → current POS status

        if (manualRefs && Array.isArray(manualRefs) && manualRefs.length > 0) {
            refNums = manualRefs.map(String);
        } else {
            // Fetch active (non-final) POS orders
            const activeOrders = await getPosActiveOrders();
            for (const o of activeOrders) {
                posCurrentStatus.set(o.id, o.status);
            }
            refNums = activeOrders.map(o => o.id);

            if (refNums.length === 0) {
                return NextResponse.json({
                    success: true,
                    dryRun,
                    message: "Không có đơn active cần sync",
                    stats: { checked: 0, updated: 0, skipped: 0, errors: 0, unchanged: 0 },
                    updates: [],
                    timestamp: new Date().toISOString(),
                });
            }
        }

        // 2. Batch-query euShipments for status history
        const historyResults = await getOrdersHistory(refNums);

        // Build lookup: refNum → last status
        const statusMap = new Map<string, string>();
        for (const item of historyResults) {
            if (item.error || !item.statusesHistory?.length) continue;
            const lastEvent = item.statusesHistory[item.statusesHistory.length - 1];
            if (lastEvent?.STATUS) {
                statusMap.set(item.refNum, lastEvent.STATUS);
            }
        }

        // 3. Map and update (skip if POS already has correct status)
        let checked = 0, updated = 0, skipped = 0, unchanged = 0, errors = 0;
        const updates: Array<{
            posOrderId: string;
            euStatus: string;
            posStatus: string;
            currentPosStatus: string;
            label: string;
            result: string;
        }> = [];

        for (const refNum of refNums) {
            const euLastStatus = statusMap.get(refNum);
            if (!euLastStatus) continue;
            checked++;

            const mapping = mapLastStatusToPos(euLastStatus);
            if (!mapping) {
                skipped++;
                continue;
            }

            const currentStatus = posCurrentStatus.get(refNum) || "";

            // Skip if POS already has the correct status
            if (currentStatus === mapping.posStatus) {
                unchanged++;
                continue;
            }

            const entry = {
                posOrderId: refNum,
                euStatus: euLastStatus,
                posStatus: mapping.posStatus,
                currentPosStatus: currentStatus,
                label: mapping.label,
                result: "pending",
            };

            if (dryRun) {
                entry.result = "dry-run";
                updates.push(entry);
                updated++;
                continue;
            }

            const ok = await updatePosStatus(refNum, mapping.posStatus);
            if (ok) {
                entry.result = "updated";
                updated++;
            } else {
                entry.result = "error";
                errors++;
            }
            updates.push(entry);
        }

        const timestamp = new Date().toISOString();
        const stats = { checked, updated, unchanged, skipped, errors, totalRefs: refNums.length };

        // Persist non-dry-run executions to audit log
        if (!dryRun && updates.length > 0) {
            try { appendSyncHistory({ timestamp, stats, updates }); } catch { /* silent */ }
        }

        return NextResponse.json({
            success: true,
            dryRun,
            message: `Checked ${checked} đơn: ${updated} cập nhật, ${unchanged} đã đúng, ${skipped} bỏ qua, ${errors} lỗi`,
            stats,
            updates: updates.slice(0, 100),
            timestamp,
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("Stramark status sync error:", error);
        return NextResponse.json(
            { success: false, error: msg },
            { status: 500 }
        );
    }
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    // Return audit log history
    if (action === "history") {
        const limit = Math.min(Number(url.searchParams.get("limit") || 10), MAX_HISTORY_ENTRIES);
        const entries = loadSyncHistory().slice(0, limit);
        return NextResponse.json({
            success: true,
            count: entries.length,
            entries,
        });
    }

    return NextResponse.json({
        info: "POST to trigger status sync (euShipments → POS Cake)",
        params: "{ refNums?: string[], dryRun?: boolean }",
        history: "GET ?action=history&limit=N to view audit log",
        statusMapping: {
            "Delivered": "delivered (Đã nhận)",
            "Product returned to stock": "returned (Đã hoàn)",
            "Returned to Warehouse / Returned / Returning": "returning (Đang hoàn)",
            "On delivery / In transit / In the office / ...": "shipped (Đã gửi hàng)",
        },
    });
}
