import { NextResponse } from "next/server";
import { bigquery } from "@/lib/bigquery";

/**
 * euShipments → BigQuery Sync API
 *
 * POST /api/eushipments/sync
 *   - Fetches orders + inventory from euShipments
 *   - Upserts into BigQuery fulfillment_orders and fulfillment_inventory tables
 *   - Returns sync summary
 */

export const dynamic = "force-dynamic";

const EU_API_BASE = "https://api1.inout.bg/api/v1";
const EU_API_TOKEN = process.env.T1_FFM_API_TOKEN || "";
const SENDER_ID = 3284;
const GCP_PROJECT = "levelup-465304";
const DATASET = "T1_Dataset";
const DS = `${GCP_PROJECT}.${DATASET}`;

function euHeaders(): HeadersInit {
    return {
        Authorization: `Bearer ${EU_API_TOKEN}`,
        "Content-Type": "application/json",
    };
}

// ─── Ensure BigQuery tables exist ───
async function ensureTables() {
    const inventoryTableSQL = `
        CREATE TABLE IF NOT EXISTS \`${DS}.fulfillment_inventory\` (
            ref_number STRING,
            product_name STRING,
            barcode STRING,
            available_qty INT64,
            reserved_qty INT64,
            total_qty INT64,
            warehouse STRING DEFAULT 'HelpShip Oradea',
            synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
        )
    `;

    try {
        await bigquery.query({ query: inventoryTableSQL });
    } catch (e: any) {
        console.log("Inventory table may already exist:", e.message);
    }
}

// ─── Sync Inventory ───
async function syncInventory(): Promise<{ synced: number; error?: string }> {
    try {
        const resp = await fetch(`${EU_API_BASE}/fulfilment/get-prod-avails`, {
            headers: euHeaders(),
            signal: AbortSignal.timeout(30000),
        });

        if (!resp.ok) {
            return { synced: 0, error: `API ${resp.status}: ${resp.statusText}` };
        }

        const data = await resp.json();
        if (!Array.isArray(data) || data.length === 0) {
            return { synced: 0 };
        }

        // Clear old inventory data and insert fresh
        try {
            await bigquery.query({ query: `DELETE FROM \`${DS}.fulfillment_inventory\` WHERE TRUE` });
        } catch {
            // Table might not exist yet, that's OK
        }

        const rows = data.map((item: any) => ({
            ref_number: String(item.REFERENCE_NUMBER || item.reference_number || ""),
            product_name: String(item.PRODUCT_NAME || item.product_name || ""),
            barcode: String(item.BARCODE || item.barcode || ""),
            available_qty: Number(item.AVAIL_QTY || item.avail_qty || 0),
            reserved_qty: Number(item.RESERVED_QTY || item.reserved_qty || 0),
            total_qty: Number(item.TOTAL_QTY || item.total_qty || 0),
            warehouse: String(item.WAREHOUSE_NAME || item.warehouse_name || "HelpShip Oradea"),
        }));

        if (rows.length > 0) {
            const tableId = `${DS}.fulfillment_inventory`;
            const errors = await bigquery.dataset(DATASET).table("fulfillment_inventory").insert(rows);
            if (errors && Array.isArray(errors) && errors.length > 0) {
                console.error("BQ inventory insert errors:", errors);
            }
        }

        return { synced: rows.length };
    } catch (e: any) {
        return { synced: 0, error: e.message };
    }
}

// ─── Sync Orders ───
async function syncOrders(): Promise<{ synced: number; updated: number; error?: string }> {
    try {
        // Fetch orders from euShipments
        let ordersData: any[] = [];

        const url = `${EU_API_BASE}/fulfilment/get-orders?senderId=${SENDER_ID}`;
        const resp = await fetch(url, {
            headers: euHeaders(),
            signal: AbortSignal.timeout(30000),
        });

        if (resp.ok) {
            const raw = await resp.json();
            ordersData = Array.isArray(raw) ? raw : (raw.data || raw.orders || []);
        } else {
            // Try alternative endpoint
            const altUrl = `${EU_API_BASE}/fulfilment/get-sender-orders?senderId=${SENDER_ID}`;
            const altResp = await fetch(altUrl, {
                headers: euHeaders(),
                signal: AbortSignal.timeout(30000),
            });
            if (altResp.ok) {
                const raw = await altResp.json();
                ordersData = Array.isArray(raw) ? raw : (raw.data || raw.orders || []);
            } else {
                return { synced: 0, updated: 0, error: `API error: ${resp.status}` };
            }
        }

        if (ordersData.length === 0) {
            return { synced: 0, updated: 0 };
        }

        // Get existing order IDs from BQ
        let existingIds = new Set<string>();
        try {
            const [rows] = await bigquery.query({
                query: `SELECT tpl_order_id FROM \`${DS}.fulfillment_orders\` WHERE tpl_order_id IS NOT NULL`,
            });
            rows.forEach((r: any) => existingIds.add(String(r.tpl_order_id)));
        } catch {
            // Table might not exist
        }

        let synced = 0;
        let updated = 0;

        for (const o of ordersData) {
            const tplOrderId = String(o.orderId || o.ORDER_ID || o.id || "");
            const clientRef = String(o.clientReference || o.CLIENT_REFERENCE || "");
            const posOrderId = clientRef.replace(/^T1-/, "") || tplOrderId;

            // Determine status
            let status = "created";
            const apiStatus = String(o.status || o.STATUS || "").toLowerCase();
            if (apiStatus.includes("deliver") || apiStatus === "3") status = "delivered";
            else if (apiStatus.includes("ship") || apiStatus.includes("transit") || apiStatus === "2") status = "shipped";
            else if (apiStatus.includes("return") || apiStatus === "4") status = "returned";
            else if (apiStatus.includes("cancel") || apiStatus === "5") status = "cancelled";
            else if (apiStatus.includes("process") || apiStatus === "1") status = "processing";

            const awb = String(o.awb || o.AWB || "");
            const shippingCost = Number(o.shippingCost || o.SHIPPING_COST || 0);
            const fulfillmentCost = Number(o.fulfillmentCost || o.FULFILLMENT_COST || 0);

            if (existingIds.has(tplOrderId)) {
                // Update existing record
                try {
                    await bigquery.query({
                        query: `UPDATE \`${DS}.fulfillment_orders\`
                            SET status = @status,
                                awb = @awb,
                                shipping_cost_eur = @shippingCost,
                                ffm_cost_eur = @fulfillmentCost,
                                total_3pl_cost_eur = @totalCost,
                                last_status_update = CURRENT_TIMESTAMP()
                            WHERE CAST(tpl_order_id AS STRING) = @tplOrderId`,
                        params: {
                            status,
                            awb,
                            shippingCost,
                            fulfillmentCost,
                            totalCost: shippingCost + fulfillmentCost,
                            tplOrderId,
                        },
                    });
                    updated++;
                } catch (err: any) {
                    console.error(`Failed to update order ${tplOrderId}:`, err.message);
                }
            } else {
                // Insert new record
                const record = {
                    pos_order_id: posOrderId,
                    tpl_order_id: isNaN(Number(tplOrderId)) ? null : Number(tplOrderId),
                    awb,
                    courier_name: String(o.courierName || o.COURIER_NAME || "Slovakia GLS"),
                    courier_id: 741,
                    warehouse: "HelpShip Oradea",
                    recipient_name: String(o.recipient?.name || o.RECIPIENT_NAME || ""),
                    recipient_phone: String(o.recipient?.phoneNumber || o.RECIPIENT_PHONE || ""),
                    recipient_city: String(o.recipient?.cityName || o.RECIPIENT_CITY || ""),
                    recipient_country: String(o.recipient?.countryIsoCode || o.RECIPIENT_COUNTRY || "SK"),
                    cod_amount: Number(o.codAmount || o.COD_AMOUNT || o.awb?.bankRepayment || 0),
                    shipping_cost_eur: shippingCost,
                    ffm_cost_eur: fulfillmentCost,
                    total_3pl_cost_eur: shippingCost + fulfillmentCost,
                    items_count: Number(o.piecesInPack || o.PIECES_IN_PACK || 1),
                    status,
                    is_test: false,
                    shop_id: "714928388",
                    project_id: "t1",
                    created_at: String(o.createdAt || o.CREATED_AT || new Date().toISOString()),
                    error_message: "",
                };

                try {
                    await bigquery.dataset(DATASET).table("fulfillment_orders").insert([record]);
                    synced++;
                } catch (err: any) {
                    console.error(`Failed to insert order ${tplOrderId}:`, err.message);
                }
            }
        }

        return { synced, updated };
    } catch (e: any) {
        return { synced: 0, updated: 0, error: e.message };
    }
}

export async function POST() {
    try {
        // Ensure tables exist
        await ensureTables();

        // Sync inventory and orders in parallel
        const [invResult, ordResult] = await Promise.all([
            syncInventory(),
            syncOrders(),
        ]);

        return NextResponse.json({
            success: true,
            inventory: invResult,
            orders: ordResult,
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error("Sync error:", error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

// GET endpoint for checking sync status
export async function GET() {
    try {
        const [invRows] = await bigquery.query({
            query: `SELECT COUNT(*) as cnt, MAX(synced_at) as last_sync
                    FROM \`${DS}.fulfillment_inventory\``,
        });

        const [ordRows] = await bigquery.query({
            query: `SELECT 
                COUNT(*) as total,
                COUNTIF(status = 'created') as created,
                COUNTIF(status = 'processing') as processing,
                COUNTIF(status = 'shipped') as shipped,
                COUNTIF(status = 'delivered') as delivered,
                COUNTIF(status = 'returned') as returned,
                COUNTIF(status = 'cancelled') as cancelled,
                COUNTIF(status = 'validation_failed') as validation_failed,
                MAX(sync_time) as last_sync
            FROM \`${DS}.fulfillment_orders\``,
        });

        return NextResponse.json({
            inventory: invRows[0] || {},
            orders: ordRows[0] || {},
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
