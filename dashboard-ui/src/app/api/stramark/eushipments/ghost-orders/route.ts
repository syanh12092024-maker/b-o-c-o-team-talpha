import { NextResponse } from "next/server";

/**
 * Stramark — Ghost Order Detection
 *
 * GET /api/stramark/eushipments/ghost-orders
 *   Detects "ghost orders": POS orders at status 9 (Waiting for Pickup)
 *   that have no AWB or status on euShipments after 48+ hours.
 *   Also checks for existing retry refs (STR-{id}-R2, etc.).
 *
 * These are orders that appeared successful during push but were never
 * actually processed by the 3PL.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EU_API_BASE = "https://api1.inout.bg/api/v1";
const EU_API_TOKEN = process.env.STRAMARK_FFM_API_TOKEN_2 || process.env.STRAMARK_FFM_API_TOKEN || "";
const POS_API_BASE = process.env.POSCAKE_API_URL || "https://pos.pages.fm/api/v1";
const POS_API_KEY = process.env.POSCAKE_API_KEY || "";
const POS_SHOP_ID = process.env.POSCAKE_SHOP_ID || "1635307570";
const SENDER_ID = Number(process.env.EU_SHIPMENT_CLIENT_ID_NEW || "3282");

const GHOST_THRESHOLD_HOURS = 48;

function euHeaders(): HeadersInit {
    return { Authorization: `Bearer ${EU_API_TOKEN}`, "Content-Type": "application/json" };
}

interface OrderHistory {
    refNum: string;
    awb: string | null;
    error: string | null;
    statusesHistory: Array<{ STATUS: string; DATE: string }>;
}

/** Batch query euShipments orders-history */
async function getOrdersHistory(refNums: string[]): Promise<OrderHistory[]> {
    const results: OrderHistory[] = [];
    const BATCH = 50;
    for (let i = 0; i < refNums.length; i += BATCH) {
        const batch = refNums.slice(i, i + BATCH);
        try {
            const resp = await fetch(`${EU_API_BASE}/fulfilment/orders-history`, {
                method: "POST",
                headers: euHeaders(),
                body: JSON.stringify({ testMode: false, orders: batch.map(r => ({ refNum: r })) }),
                signal: AbortSignal.timeout(20000),
            });
            if (resp.ok) {
                const data: OrderHistory[] = await resp.json();
                results.push(...data);
            }
        } catch { /* continue with next batch */ }
    }
    return results;
}

/** Get all existing clientReferences from euShipments */
async function getExistingEuRefs(): Promise<Set<string>> {
    try {
        const resp = await fetch(
            `${EU_API_BASE}/fulfilment/get-orders?senderId=${SENDER_ID}`,
            { headers: euHeaders(), signal: AbortSignal.timeout(15000) }
        );
        if (!resp.ok) return new Set();
        const data = await resp.json();
        return new Set((Array.isArray(data) ? data : []).map((o: any) => String(o.clientReference || "")));
    } catch { return new Set(); }
}

/** Fetch POS orders for ghost detection.
 *  Check status 9 (pending/waiting for pickup), 2 (shipped), 8 (packing)
 *  Ghost orders could have been moved to shipped by audit but still have no AWB.
 */
async function fetchOrdersForGhostCheck(): Promise<any[]> {
    const all: any[] = [];
    const seen = new Set<string>();
    // Status 9=pending (primary ghost candidates), 2=shipped (may have been moved by audit), 8=packing
    const POS_STATUSES = [9, 2, 8];

    for (const status of POS_STATUSES) {
        let page = 1;
        let totalPages = 1;
        while (page <= totalPages && page <= 10) {
            try {
                const resp = await fetch(
                    `${POS_API_BASE}/shops/${POS_SHOP_ID}/orders?api_key=${POS_API_KEY}&status=${status}&limit=50&page=${page}`,
                    { signal: AbortSignal.timeout(15000) }
                );
                if (!resp.ok) break;
                const data = await resp.json();
                const orders = data.data || [];
                for (const o of orders) {
                    const id = String(o.id || "");
                    if (id && !seen.has(id)) {
                        seen.add(id);
                        all.push(o);
                    }
                }
                totalPages = data.total_pages || 1;
                if (orders.length === 0) break;
                page++;
            } catch { break; }
        }
    }
    return all;
}

export interface GhostOrder {
    orderId: string;
    recipient: string;
    cod: number;
    posStatus: string;
    reason: "not_found" | "no_awb" | "no_status_events";
    reasonLabel: string;
    ageHours: number;
    originalRef: string;
    retryRefs: string[];      // existing retry refs found
    alreadyRetried: boolean;  // true if at least one retry ref exists
    createdAt: string;
}

export async function GET() {
    try {
        if (!EU_API_TOKEN || !POS_API_KEY) {
            return NextResponse.json({ ghostOrders: [], error: "Missing API tokens" });
        }

        // 1. Fetch POS orders (status 9, 2, 8)
        const pendingOrders = await fetchOrdersForGhostCheck();
        if (pendingOrders.length === 0) {
            return NextResponse.json({
                ghostOrders: [],
                stats: { checked: 0, ghosts: 0, alreadyRetried: 0 },
                timestamp: new Date().toISOString(),
            });
        }

        // 2. Get existing euShipments refs (for retry detection)
        const existingRefs = await getExistingEuRefs();

        // 3. Build ref list and query euShipments history
        // euShipments orders-history uses raw POS order ID as refNum (NOT STR- prefix)
        const refNums = pendingOrders.map(o => String(o.id));
        const historyResults = await getOrdersHistory(refNums);

        // Build lookup: refNum → history item
        const historyMap = new Map<string, OrderHistory>();
        for (const item of historyResults) {
            historyMap.set(item.refNum, item);
        }

        // 4. Detect ghost orders
        const now = Date.now();
        const ghostOrders: GhostOrder[] = [];

        for (const order of pendingOrders) {
            const orderId = String(order.id);
            const originalRef = `STR-${orderId}`;  // clientReference format on euShipments
            const history = historyMap.get(orderId); // orders-history uses raw POS ID

            // Get POS status name
            const posStatus = String(order.status_name || order.status || "").toLowerCase();

            // Calculate age from order creation/update
            const orderDate = order.updated_at || order.inserted_at || order.created_at;
            const ageMs = orderDate ? now - new Date(orderDate).getTime() : 0;
            const ageHours = Math.round(ageMs / (1000 * 60 * 60));

            // Only flag orders older than threshold
            if (ageHours < GHOST_THRESHOLD_HOURS) continue;

            // Find existing retry refs (clientReference format: STR-{id}-R{n})
            const retryRefs: string[] = [];
            for (let n = 2; n <= 10; n++) {
                const rRef = `${originalRef}-R${n}`;
                if (existingRefs.has(rRef)) retryRefs.push(rRef);
            }

            let reason: GhostOrder["reason"] | null = null;
            let reasonLabel = "";

            if (!history || history.error) {
                // Order not found on euShipments at all
                reason = "not_found";
                reasonLabel = "Không tìm thấy trên euShipments";
            } else if (!history.awb) {
                // Found but no AWB assigned
                reason = "no_awb";
                reasonLabel = "Không có mã vận đơn (AWB)";
            } else if (!history.statusesHistory || history.statusesHistory.length === 0) {
                // Found but no status events
                reason = "no_status_events";
                reasonLabel = "Không có sự kiện trạng thái";
            }

            if (reason) {
                // If already retried and retry ref has valid status, skip
                if (retryRefs.length > 0) {
                    // Check if any retry ref has been processed
                    const retryHistories = await getOrdersHistory(retryRefs);
                    const hasProcessedRetry = retryHistories.some(
                        rh => !rh.error && rh.awb && rh.statusesHistory?.length > 0
                    );
                    if (hasProcessedRetry) continue; // Already fixed via retry
                }

                const codRaw = Number(order.cod || 0);
                ghostOrders.push({
                    orderId,
                    recipient: order.bill_full_name || order.customer_name || "",
                    cod: codRaw / 100,
                    posStatus,
                    reason,
                    reasonLabel,
                    ageHours,
                    originalRef,
                    retryRefs,
                    alreadyRetried: retryRefs.length > 0,
                    createdAt: orderDate || "",
                });
            }
        }

        // Sort by age descending (oldest first)
        ghostOrders.sort((a, b) => b.ageHours - a.ageHours);

        return NextResponse.json({
            ghostOrders,
            stats: {
                checked: pendingOrders.length,
                ghosts: ghostOrders.length,
                alreadyRetried: ghostOrders.filter(g => g.alreadyRetried).length,
            },
            thresholdHours: GHOST_THRESHOLD_HOURS,
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error("Ghost orders detection error:", error);
        return NextResponse.json({ ghostOrders: [], error: error.message }, { status: 500 });
    }
}
