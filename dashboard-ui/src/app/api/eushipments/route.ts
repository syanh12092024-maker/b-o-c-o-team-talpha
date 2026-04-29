import { NextResponse } from "next/server";

/**
 * euShipments API Proxy
 * 
 * Proxies requests to euShipments (InOut BG) API from the dashboard frontend.
 * Supports:
 *   - GET /api/eushipments?action=inventory       → Get product availability
 *   - GET /api/eushipments?action=orders           → Get all orders
 *   - GET /api/eushipments?action=order&id=123     → Get single order detail
 *   - GET /api/eushipments?action=tracking&awb=XXX → Get tracking info
 */

export const dynamic = "force-dynamic";

// euShipments API config — secrets loaded from environment
const EU_API_BASE = "https://api1.inout.bg/api/v1";
const EU_API_TOKEN = process.env.STRAMARK_FFM_API_TOKEN || process.env.T1_FFM_API_TOKEN || "";
const SENDER_ID = 3284;

function euHeaders(): HeadersInit {
    return {
        "Authorization": `Bearer ${EU_API_TOKEN}`,
        "Content-Type": "application/json",
    };
}

// ─── Fetch product inventory from euShipments ───
async function getInventory() {
    const url = `${EU_API_BASE}/fulfilment/get-prod-avails`;
    const resp = await fetch(url, {
        headers: euHeaders(),
        signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
        throw new Error(`euShipments inventory API error: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json();

    // Transform to a cleaner format
    const inventory = Array.isArray(data) ? data.map((item: any) => ({
        refNumber: item.REFERENCE_NUMBER || item.reference_number || "",
        productName: item.PRODUCT_NAME || item.product_name || "",
        barcode: item.BARCODE || item.barcode || "",
        availableQty: Number(item.AVAIL_QTY || item.avail_qty || 0),
        reservedQty: Number(item.RESERVED_QTY || item.reserved_qty || 0),
        totalQty: Number(item.TOTAL_QTY || item.total_qty || 0),
        warehouse: item.WAREHOUSE_NAME || item.warehouse_name || "HelpShip Oradea",
    })) : [];

    return inventory;
}

// ─── Fetch orders from euShipments ───
async function getOrders() {
    // euShipments API: get orders for sender
    const url = `${EU_API_BASE}/fulfilment/get-orders?senderId=${SENDER_ID}`;
    const resp = await fetch(url, {
        headers: euHeaders(),
        signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
        // Try alternative endpoint
        const altUrl = `${EU_API_BASE}/fulfilment/get-sender-orders?senderId=${SENDER_ID}`;
        const altResp = await fetch(altUrl, {
            headers: euHeaders(),
            signal: AbortSignal.timeout(30000),
        });

        if (!altResp.ok) {
            throw new Error(`euShipments orders API error: ${resp.status}`);
        }

        return altResp.json();
    }

    return resp.json();
}

// ─── Fetch single order detail ───
async function getOrderDetail(orderId: string) {
    const url = `${EU_API_BASE}/fulfilment/get-order?orderId=${orderId}`;
    const resp = await fetch(url, {
        headers: euHeaders(),
        signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
        throw new Error(`euShipments order detail error: ${resp.status}`);
    }

    return resp.json();
}

// ─── Fetch AWB/tracking info ───
async function getTracking(awb: string) {
    const url = `${EU_API_BASE}/fulfilment/get-awb-status?awb=${awb}`;
    const resp = await fetch(url, {
        headers: euHeaders(),
        signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
        throw new Error(`euShipments tracking error: ${resp.status}`);
    }

    return resp.json();
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const action = searchParams.get("action") || "inventory";

        let data: any;

        switch (action) {
            case "inventory":
                data = await getInventory();
                break;

            case "orders":
                const rawOrders = await getOrders();
                // Normalize orders data
                data = Array.isArray(rawOrders) ? rawOrders.map((o: any) => ({
                    orderId: o.orderId || o.ORDER_ID || o.id,
                    clientReference: o.clientReference || o.CLIENT_REFERENCE || "",
                    status: o.status || o.STATUS || "",
                    statusName: o.statusName || o.STATUS_NAME || "",
                    awb: o.awb || o.AWB || "",
                    recipientName: o.recipient?.name || o.RECIPIENT_NAME || "",
                    recipientCity: o.recipient?.cityName || o.RECIPIENT_CITY || "",
                    recipientCountry: o.recipient?.countryIsoCode || o.RECIPIENT_COUNTRY || "",
                    courierName: o.courierName || o.COURIER_NAME || "",
                    codAmount: Number(o.codAmount || o.COD_AMOUNT || o.awb?.bankRepayment || 0),
                    createdAt: o.createdAt || o.CREATED_AT || o.created_at || "",
                    shippedAt: o.shippedAt || o.SHIPPED_AT || "",
                    deliveredAt: o.deliveredAt || o.DELIVERED_AT || "",
                    weight: Number(o.totalWeight || o.TOTAL_WEIGHT || 0),
                    parcels: Number(o.parcels || o.PARCELS || 1),
                    shippingCost: Number(o.shippingCost || o.SHIPPING_COST || 0),
                    fulfillmentCost: Number(o.fulfillmentCost || o.FULFILLMENT_COST || 0),
                })) : rawOrders;
                break;

            case "order":
                const orderId = searchParams.get("id");
                if (!orderId) {
                    return NextResponse.json({ error: "Missing order id" }, { status: 400 });
                }
                data = await getOrderDetail(orderId);
                break;

            case "tracking":
                const awb = searchParams.get("awb");
                if (!awb) {
                    return NextResponse.json({ error: "Missing AWB" }, { status: 400 });
                }
                data = await getTracking(awb);
                break;

            default:
                return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }

        return NextResponse.json({
            data,
            meta: {
                source: "euShipments (InOut BG)",
                senderId: SENDER_ID,
                timestamp: new Date().toISOString(),
            }
        });

    } catch (error: any) {
        console.error("euShipments API Error:", error.message);
        return NextResponse.json(
            {
                error: error.message || "Failed to fetch from euShipments",
                data: null,
            },
            { status: 502 }
        );
    }
}
