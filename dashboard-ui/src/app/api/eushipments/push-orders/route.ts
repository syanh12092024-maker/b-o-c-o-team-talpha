import { NextResponse } from "next/server";

/**
 * Push Orders to euShipments
 *
 * POST /api/eushipments/push-orders
 *   - Executes fulfillment_automation.py to create orders on euShipments
 *   - Returns the result summary
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60s for processing

const EU_API_BASE = "https://api1.inout.bg/api/v1";
const EU_API_TOKEN = process.env.T1_FFM_API_TOKEN || "";
const POS_API_BASE = "https://pos.pages.fm/api/v1";
const POS_API_KEY = process.env.T1_PANCAKE_API_TOKEN || "";
const POS_SHOP_ID = process.env.T1_PANCAKE_SHOP_ID || "714928388";
const SENDER_ID = 3284;
const COURIER_ID = 741;

function euHeaders(): HeadersInit {
    return {
        Authorization: `Bearer ${EU_API_TOKEN}`,
        "Content-Type": "application/json",
    };
}

// Normalize Slovak phone number
function normalizePhone(phone: string): string {
    let p = phone.replace(/\s+/g, "").replace(/-/g, "");
    if (p.startsWith("00421")) p = "+421" + p.slice(5);
    if (p.startsWith("0") && p.length === 10) p = "+421" + p.slice(1);
    if (!p.startsWith("+")) p = "+421" + p;
    return p;
}

// Parse pipe-separated address (POS format: "ZIP | Region | City | Street, ZIP City, Country")
function parseAddress(fullAddr: string): { street: string; city: string; zipCode: string } {
    let street = "", city = "", zipCode = "";

    if (fullAddr.includes("|")) {
        const parts = fullAddr.split("|").map(p => p.trim());
        // ZIP is first, city is 3rd, street from last part
        if (parts.length >= 1 && /^\d{3}\s?\d{2}$/.test(parts[0])) {
            zipCode = parts[0].replace(/\s/g, "");
        }
        if (parts.length >= 3) city = parts[2];
        if (parts.length >= 4) {
            street = parts[parts.length - 1].split(",")[0].trim();
        }
    } else {
        // Standard format: "Street, ZIP City, Country"
        const zipMatch = fullAddr.match(/\b(\d{3}\s?\d{2})\b/);
        if (zipMatch) {
            zipCode = zipMatch[1].replace(/\s/g, "");
            street = fullAddr.slice(0, zipMatch.index).replace(/,\s*$/, "").trim();
            const cityMatch = fullAddr.match(/\d{3}\s?\d{2}\s+([A-Za-zÀ-žĀ-ž\s-]+)/);
            if (cityMatch) {
                city = cityMatch[1].trim().replace(/,.*$/, "").trim();
                // Remove country names
                for (const cn of ["Slovakia", "Slovensko"]) {
                    if (city.toLowerCase().endsWith(cn.toLowerCase())) {
                        city = city.slice(0, -cn.length).trim().replace(/,\s*$/, "").trim();
                    }
                }
            }
        } else {
            street = fullAddr;
        }
    }

    return { street: street || fullAddr, city, zipCode };
}

interface PushResult {
    orderId: string;
    posOrderId: string;
    recipient: string;
    status: "created" | "failed" | "skipped";
    euOrderId?: number;
    error?: string;
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const dryRun = body.dryRun === true;

        // 1. Fetch packing orders (status=8) from POS
        const posResp = await fetch(
            `${POS_API_BASE}/shops/${POS_SHOP_ID}/orders?api_key=${POS_API_KEY}&status=8&limit=50`,
            { signal: AbortSignal.timeout(15000) }
        );

        if (!posResp.ok) {
            return NextResponse.json(
                { success: false, error: `POS API error: ${posResp.status}` },
                { status: 502 }
            );
        }

        const posData = await posResp.json();
        const orders = posData.data || [];

        if (orders.length === 0) {
            return NextResponse.json({
                success: true,
                message: "Không có đơn đang đóng hàng",
                stats: { total: 0, created: 0, failed: 0, skipped: 0 },
                results: [],
            });
        }

        // 2. Process each order
        const results: PushResult[] = [];
        let created = 0, failed = 0, skipped = 0;

        for (const order of orders) {
            const orderId = String(order.id || "");
            const name = order.bill_full_name || order.customer_name || "";
            const phone = normalizePhone(order.bill_phone_number || order.customer_phone || "");

            // Parse address
            const addr = order.shipping_address || {};
            const fullAddr = typeof addr === "object" ? (addr.address || addr.full_address || "") : String(addr);
            const { street, city, zipCode } = parseAddress(fullAddr);

            // Get product info
            const items = order.order_items || order.items || [];
            const products: { refNumber: string; qty: number }[] = [];
            const productNames: string[] = [];

            for (const item of items) {
                const vi = item.variation_info || {};
                const prodName = vi.name || item.product_name || "Product";
                const qty = Number(item.quantity || 1);
                products.push({ refNumber: prodName, qty });
                productNames.push(prodName);
            }

            // COD
            const codRaw = Number(order.cod || 0);
            const codAmount = codRaw / 100;

            // Validate
            if (!name || !city || !zipCode || !phone) {
                results.push({
                    orderId, posOrderId: orderId, recipient: name,
                    status: "skipped",
                    error: `Thiếu: ${!name ? "tên" : ""}${!city ? " city" : ""}${!zipCode ? " zip" : ""}${!phone ? " phone" : ""}`,
                });
                skipped++;
                continue;
            }

            if (dryRun) {
                results.push({
                    orderId, posOrderId: orderId, recipient: name,
                    status: "skipped", error: "Dry run",
                });
                skipped++;
                continue;
            }

            // 3. Create order on euShipments
            const totalQty = products.reduce((s, p) => s + p.qty, 0) || 1;
            const payload = {
                testMode: 0,
                senderId: SENDER_ID,
                courierId: COURIER_ID,
                waybillAvailableDate: new Date().toISOString().slice(0, 10),
                serviceName: "crossborder",
                recipient: {
                    name,
                    countryIsoCode: "SK",
                    cityName: city,
                    zipCode: zipCode.replace(/\s/g, ""),
                    streetName: street,
                    phoneNumber: phone,
                    email: order.bill_email || order.customer_email || "",
                },
                awb: {
                    referenceNumber: orderId,
                    bankRepayment: codAmount.toFixed(2),
                    products: productNames.join(" ") || "Product",
                    fragile: 0,
                    piecesInPack: totalQty,
                    parcels: 1,
                    envelopes: 0,
                    totalWeight: 1,
                    width: 10,
                    height: 10,
                    length: 10,
                    insurance: 0,
                    preview: 0,
                    saturdayDelivery: 0,
                    contents: "Bransoletka",
                    productsInfo: productNames.join(","),
                },
                products,
                customsData: {
                    dutyPaymentInfo: "DDU",
                    customsValue: codAmount.toFixed(2),
                },
                clientReference: orderId,
            };

            try {
                const euResp = await fetch(`${EU_API_BASE}/fulfilment/create-order`, {
                    method: "POST",
                    headers: euHeaders(),
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(30000),
                });

                const euData = await euResp.json().catch(() => ({ error: euResp.statusText }));

                if (euResp.ok && !euData.error) {
                    results.push({
                        orderId, posOrderId: orderId, recipient: name,
                        status: "created",
                        euOrderId: euData.orderId,
                    });
                    created++;
                } else {
                    const errMsg = typeof euData.error === "string" ? euData.error : JSON.stringify(euData);
                    results.push({
                        orderId, posOrderId: orderId, recipient: name,
                        status: "failed",
                        error: `${euResp.status}: ${errMsg}`,
                    });
                    failed++;
                }
            } catch (err: any) {
                results.push({
                    orderId, posOrderId: orderId, recipient: name,
                    status: "failed",
                    error: err.message || "Unknown error",
                });
                failed++;
            }
        }

        return NextResponse.json({
            success: true,
            message: `Đã xử lý ${orders.length} đơn: ${created} tạo thành công, ${failed} lỗi, ${skipped} bỏ qua`,
            stats: { total: orders.length, created, failed, skipped },
            results,
        });
    } catch (error: any) {
        console.error("Push orders error:", error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
