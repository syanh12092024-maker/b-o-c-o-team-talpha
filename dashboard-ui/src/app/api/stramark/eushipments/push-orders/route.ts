import { NextResponse } from "next/server";

/**
 * Stramark — Push Orders to euShipments (Multi-Country)
 *
 * POST /api/stramark/eushipments/push-orders
 *   - Fetches packing orders (status=8) from POS Cake
 *   - Detects country via POS order tags:
 *       • No country tag  → Romania (default)
 *       • Tag "Slovakia"  → Slovakia
 *       • Tag "Bulgaria"  → Bulgaria
 *       • Tag "Croatia"   → Croatia
 *   - Auto-selects courier, phone format, ZIP format per country
 *   - Creates orders on euShipments via InOut BG API
 *
 * Supported body params:
 *   { dryRun?: boolean, filterCountry?: "RO"|"SK"|"BG"|"HR"|"ALL" }
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ─── Config from env vars ───────────────────────────────────────────────────
const EU_API_BASE = "https://api1.inout.bg/api/v1";
const EU_API_TOKEN = process.env.STRAMARK_FFM_API_TOKEN_2 || process.env.STRAMARK_FFM_API_TOKEN || "";
const POS_API_BASE = process.env.POSCAKE_API_URL || "https://pos.pages.fm/api/v1";
const POS_API_KEY = process.env.POSCAKE_API_KEY || "";
const POS_SHOP_ID = process.env.POSCAKE_SHOP_ID || "1635307570";
const SENDER_ID = Number(process.env.EU_SHIPMENT_CLIENT_ID_NEW || "3282");

function euHeaders(): HeadersInit {
    return {
        Authorization: `Bearer ${EU_API_TOKEN}`,
        "Content-Type": "application/json",
    };
}

// ─── Retry with exponential backoff for transient failures ──────────────────
async function fetchWithRetry(
    url: string, options: RequestInit, maxRetries = 2
): Promise<Response> {
    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const resp = await fetch(url, options);
            // Don't retry on 4xx (client errors) — only on 5xx / network errors
            if (resp.ok || (resp.status >= 400 && resp.status < 500)) return resp;
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000; // 1s, 2s
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            return resp;
        } catch (err) {
            lastError = err;
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError || new Error("Max retries exceeded");
}

// ═══════════════════════════════════════════════════════════════════════════════
// COUNTRY PROFILES — mỗi quốc gia có courier, phone format, ZIP regex riêng
// ═══════════════════════════════════════════════════════════════════════════════

interface CourierOption {
    id: number;
    name: string;
    costPerKg: number;   // EUR per kg
    codFee: number;      // EUR min COD fee
    toOffice: boolean;
    toAddress: boolean;
}

interface CountryProfile {
    code: string;
    name: string;
    flag: string;
    defaultCourierId: number;
    courierName: string;
    couriers: CourierOption[];  // available couriers (for multi-courier countries)
    phonePrefix: string;
    phoneLength: number;
    zipRegex: RegExp;
    zipDigits: number;
    currency: string;
    tagKeywords: string[];
}

// ─── Romania couriers (sorted by cost, cheapest first) ──────────────────────
const RO_COURIERS: CourierOption[] = [
    { id: 832, name: "Romania Cargus",      costPerKg: 2.33, codFee: 0.35, toOffice: true,  toAddress: true },
    { id: 750, name: "Romania SameDay",     costPerKg: 2.46, codFee: 0.33, toOffice: true,  toAddress: true },
    { id: 812, name: "Romania GLS",         costPerKg: 2.72, codFee: 0.40, toOffice: true,  toAddress: true },
    { id: 17,  name: "Romania FAN Courier", costPerKg: 2.74, codFee: 0.40, toOffice: false, toAddress: true },
];

const COUNTRY_PROFILES: Record<string, CountryProfile> = {
    RO: {
        code: "RO", name: "Romania", flag: "🇷🇴",
        defaultCourierId: 812, courierName: "Romania GLS",
        couriers: RO_COURIERS,
        phonePrefix: "+40", phoneLength: 11,
        zipRegex: /^\d{6}$/, zipDigits: 6,
        currency: "RON",
        tagKeywords: ["romania", "românia", "ro"],
    },
    SK: {
        code: "SK", name: "Slovakia", flag: "🇸🇰",
        defaultCourierId: 741, courierName: "Slovakia GLS",
        couriers: [{ id: 741, name: "Slovakia GLS", costPerKg: 0, codFee: 0, toOffice: false, toAddress: true }],
        phonePrefix: "+421", phoneLength: 12,
        zipRegex: /^\d{3}\s?\d{2}$/, zipDigits: 5,
        currency: "EUR",
        tagKeywords: ["slovakia", "slovensko", "sk"],
    },
    BG: {
        code: "BG", name: "Bulgaria", flag: "🇧🇬",
        defaultCourierId: 838, courierName: "Bulgaria Express One",
        couriers: [{ id: 838, name: "Bulgaria Express One", costPerKg: 0, codFee: 0, toOffice: false, toAddress: true }],
        phonePrefix: "+359", phoneLength: 11,
        zipRegex: /^\d{4}$/, zipDigits: 4,
        currency: "EUR",
        tagKeywords: ["bulgaria", "българия", "bg"],
    },
    HR: {
        code: "HR", name: "Croatia", flag: "🇭🇷",
        defaultCourierId: 651, courierName: "Croatia DPD",
        couriers: [{ id: 651, name: "Croatia DPD", costPerKg: 0, codFee: 0, toOffice: false, toAddress: true }],
        phonePrefix: "+385", phoneLength: 11,
        zipRegex: /^\d{5}$/, zipDigits: 5,
        currency: "EUR",
        tagKeywords: ["croatia", "hrvatska", "hr"],
    },
};

// ─── Detect country from POS order tags ─────────────────────────────────────
function detectCountry(order: any): CountryProfile {
    // Tags can be: string, array of strings, array of objects with "name"
    const rawTags = order.tags;
    let tagStr = "";

    if (Array.isArray(rawTags)) {
        tagStr = rawTags.map((t: any) =>
            typeof t === "string" ? t : (t?.name || t?.label || t?.title || "")
        ).join(" ");
    } else if (typeof rawTags === "string") {
        tagStr = rawTags;
    }

    const lower = tagStr.toLowerCase();

    // Check each country's keywords (skip RO — it's the default)
    for (const code of ["SK", "BG", "HR"] as const) {
        const profile = COUNTRY_PROFILES[code];
        if (profile.tagKeywords.some(kw => lower.includes(kw))) {
            return profile;
        }
    }

    // Default: Romania (no tag = Romania)
    return COUNTRY_PROFILES.RO;
}

// ─── Phone normalization per country ────────────────────────────────────────
function normalizePhone(phone: string, country: CountryProfile): string {
    let p = phone.replace(/[\s\-().]/g, "");

    const prefix = country.phonePrefix;       // e.g. "+40"
    const digits = prefix.replace("+", "");   // e.g. "40"

    // Handle double-zero international format: 0040... → +40...
    if (p.startsWith("00" + digits)) p = prefix + p.slice(2 + digits.length);
    // Handle bare digits format: 40... → +40...
    if (p.startsWith(digits) && !p.startsWith("+")) p = "+" + p;
    // Handle local format: 07xxx → +407xxx (Romania), 09xxx → +4219xxx (Slovakia)
    if (p.startsWith("0") && p.length >= 9 && p.length <= 11) p = prefix + p.slice(1);
    // Last resort: prepend country prefix
    if (!p.startsWith("+") && p.length >= 7) p = prefix + p;

    return p;
}

// ─── Address parsing (multi-country aware) ──────────────────────────────────
// POS Cake Stramark format: "ZIP\tRegion\tCity\tStreet" (TAB-separated)
// Also handles: "ZIP | Region | City | Street" (pipe) and "Street, ZIP City, Country"
function parseAddress(fullAddr: string, country: CountryProfile): {
    street: string; city: string; zipCode: string; region: string;
} {
    let street = "", city = "", zipCode = "", region = "";

    const zipPattern = country.zipDigits === 6
        ? /\b(\d{6})\b/
        : country.zipDigits === 5
            ? /\b(\d{3}\s?\d{2})\b/
            : /\b(\d{4,6})\b/;

    if (fullAddr.includes("\t")) {
        // TAB-separated: "527010\tCovasna\tAita Mare\tStr. Principală nr. 139"
        const parts = fullAddr.split("\t").map(p => p.trim());
        if (parts.length >= 1 && zipPattern.test(parts[0])) {
            zipCode = parts[0].replace(/\s/g, "");
        }
        if (parts.length >= 2) region = parts[1];
        if (parts.length >= 3) city = parts[2];
        if (parts.length >= 4) street = parts[3];
    } else if (fullAddr.includes("|")) {
        // Pipe-separated: "ZIP | Region | City | Street..."
        const parts = fullAddr.split("|").map(p => p.trim());
        if (parts.length >= 1 && zipPattern.test(parts[0])) {
            zipCode = parts[0].replace(/\s/g, "");
        }
        if (parts.length >= 2) region = parts[1];
        if (parts.length >= 3) city = parts[2];
        if (parts.length >= 4) {
            street = parts[parts.length - 1].split(",")[0].trim();
        }
    } else {
        // Standard: "Street, ZIP City, Country"
        const zipMatch = fullAddr.match(zipPattern);
        if (zipMatch) {
            zipCode = zipMatch[1].replace(/\s/g, "");
            street = fullAddr.slice(0, zipMatch.index).replace(/,\s*$/, "").trim();
            // City: text after ZIP code
            const afterZip = fullAddr.slice((zipMatch.index || 0) + zipMatch[0].length).trim();
            const cityMatch = afterZip.match(/^([A-Za-zÀ-žĂăÂâÎîȘșȚțĀ-ž\s\-]+)/);
            if (cityMatch) {
                city = cityMatch[1].trim().replace(/,.*$/, "").trim();
                // Strip country names
                const countryNames = ["Romania", "România", "Slovakia", "Slovensko",
                    "Bulgaria", "България", "Croatia", "Hrvatska", "RO", "SK", "BG", "HR"];
                for (const cn of countryNames) {
                    if (city.toLowerCase().endsWith(cn.toLowerCase())) {
                        city = city.slice(0, -cn.length).trim().replace(/,\s*$/, "").trim();
                    }
                }
            }
        } else {
            const parts = fullAddr.split(",").map(p => p.trim());
            if (parts.length >= 3) {
                street = parts[0];
                city = parts[1];
            } else {
                street = fullAddr;
            }
        }
    }

    return { street: street || fullAddr, city, zipCode, region };
}

// ─── Dedup check ────────────────────────────────────────────────────────────
async function getExistingEuOrders(): Promise<Set<string>> {
    try {
        const resp = await fetch(
            `${EU_API_BASE}/fulfilment/get-orders?senderId=${SENDER_ID}`,
            { headers: euHeaders(), signal: AbortSignal.timeout(15000) }
        );
        if (!resp.ok) return new Set();
        const data = await resp.json();
        const orders = Array.isArray(data) ? data : [];
        return new Set(orders.map((o: any) => String(o.clientReference || "")));
    } catch {
        return new Set();
    }
}

// ─── Update POS Cake order status ───────────────────────────────────────────
// After successful push to euShipments, update POS status:
//   8 (Đang đóng hàng / Packaging) → 9 (Chờ chuyển hàng / Waiting for Pickup)
const POS_STATUS_WAITING_PICKUP = 9;

async function updatePosOrderStatus(orderId: string, newStatus: number): Promise<boolean> {
    try {
        const resp = await fetch(
            `${POS_API_BASE}/shops/${POS_SHOP_ID}/orders/${orderId}?api_key=${POS_API_KEY}`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus }),
                signal: AbortSignal.timeout(10000),
            }
        );
        return resp.ok;
    } catch {
        return false;
    }
}

// ─── Post-push verification via orders-history ─────────────────────────────
async function verifyEuOrder(refNum: string): Promise<{
    exists: boolean; awb: string | null; status: string | null; error: string | null;
}> {
    try {
        const resp = await fetch(`${EU_API_BASE}/fulfilment/orders-history`, {
            method: "POST",
            headers: euHeaders(),
            body: JSON.stringify({ testMode: false, orders: [{ refNum }] }),
            signal: AbortSignal.timeout(15000),
        });
        if (!resp.ok) return { exists: false, awb: null, status: null, error: `HTTP ${resp.status}` };
        const data = await resp.json();
        const item = Array.isArray(data) ? data[0] : null;
        if (!item || item.error) return { exists: false, awb: null, status: null, error: item?.error || "Not found" };
        const lastStatus = item.statusesHistory?.length > 0
            ? item.statusesHistory[item.statusesHistory.length - 1]?.STATUS || null
            : null;
        return { exists: true, awb: item.awb || null, status: lastStatus, error: null };
    } catch (err: any) {
        return { exists: false, awb: null, status: null, error: err.message };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════

interface PushResult {
    orderId: string;
    posOrderId: string;
    recipient: string;
    city: string;
    country: string;
    countryFlag: string;
    cod: number;
    codCurrency: string;
    courierId: number;
    courierName: string;
    status: "created" | "failed" | "skipped";
    euOrderId?: number;
    posStatusUpdated?: boolean;
    verified?: boolean;
    verificationWarning?: string;
    awb?: string;
    error?: string;
}

export async function POST(request: Request) {
    try {
        if (!EU_API_TOKEN) {
            return NextResponse.json(
                { success: false, error: "STRAMARK_FFM_API_TOKEN chưa cấu hình trong .env" },
                { status: 500 }
            );
        }
        if (!POS_API_KEY) {
            return NextResponse.json(
                { success: false, error: "POSCAKE_API_KEY chưa cấu hình trong .env" },
                { status: 500 }
            );
        }

        const body = await request.json().catch(() => ({}));
        const dryRun = body.dryRun === true;
        // Optional: filter by country ("RO", "SK", "BG", "HR", or "ALL")
        const filterCountry = (body.filterCountry || "ALL").toUpperCase();
        // Optional: override courier for Romania ("cheapest"|"fastest"|courier_id)
        // "cheapest" = Cargus (default), "sameday" = SameDay, or numeric courier ID
        const courierOverride = body.courierId || body.courier || null;

        // 1. Fetch ALL packing orders (status=8) from POS Cake with pagination
        // NOTE: Pancake POS API ignores `limit` param and always returns max 10 per page.
        // Must rely on `total_pages` from response, NOT on page size to detect last page.
        const orders: any[] = [];
        let page = 1;
        let totalPages = 1;

        while (page <= totalPages && page <= 50) {
            const posResp = await fetch(
                `${POS_API_BASE}/shops/${POS_SHOP_ID}/orders?api_key=${POS_API_KEY}&status=8&limit=50&page=${page}`,
                { signal: AbortSignal.timeout(15000) }
            );

            if (!posResp.ok) {
                if (page === 1) {
                    return NextResponse.json(
                        { success: false, error: `POS API error: ${posResp.status}` },
                        { status: 502 }
                    );
                }
                break;
            }

            const posData = await posResp.json();
            const pageOrders = posData.data || [];
            orders.push(...pageOrders);
            totalPages = posData.total_pages || 1;

            // Stop if empty page (safety)
            if (pageOrders.length === 0) break;
            page++;
        }

        if (orders.length === 0) {
            return NextResponse.json({
                success: true,
                message: "Không có đơn đang đóng hàng (status=8)",
                stats: { total: 0, created: 0, failed: 0, skipped: 0 },
                byCountry: {},
                results: [],
            });
        }

        // 2. Get existing euShipments orders to avoid duplicates
        const existingRefs = await getExistingEuOrders();

        // 3. Process each order
        const results: PushResult[] = [];
        let created = 0, failed = 0, skipped = 0;
        const byCountry: Record<string, { total: number; created: number; failed: number; skipped: number }> = {};

        for (const order of orders) {
            const orderId = String(order.id || "");

            // ── Detect country from tags ──
            const country = detectCountry(order);

            // Optional country filter
            if (filterCountry !== "ALL" && country.code !== filterCountry) {
                continue;
            }

            // Init per-country stats
            if (!byCountry[country.code]) {
                byCountry[country.code] = { total: 0, created: 0, failed: 0, skipped: 0 };
            }
            byCountry[country.code].total++;

            const clientRef = `STR-${orderId}`;
            const name = order.bill_full_name || order.customer_name || "";
            const phone = normalizePhone(
                order.bill_phone_number || order.customer_phone || "",
                country
            );
            // ── Select courier (multi-courier routing for RO) ──
            let courierId = country.defaultCourierId;
            let courierName = country.courierName;

            if (courierOverride && country.couriers.length > 1) {
                if (typeof courierOverride === "number" || /^\d+$/.test(String(courierOverride))) {
                    // Numeric courier ID override
                    const cid = Number(courierOverride);
                    const found = country.couriers.find(c => c.id === cid);
                    if (found) { courierId = found.id; courierName = found.name; }
                } else {
                    // Named strategy: "cheapest" (default), "sameday", "gls", "fan"
                    const strat = String(courierOverride).toLowerCase();
                    if (strat === "cheapest") {
                        const sorted = [...country.couriers].sort((a, b) => a.costPerKg - b.costPerKg);
                        courierId = sorted[0].id; courierName = sorted[0].name;
                    } else if (strat === "sameday" || strat === "same_day") {
                        const c = country.couriers.find(c => c.name.toLowerCase().includes("sameday"));
                        if (c) { courierId = c.id; courierName = c.name; }
                    } else if (strat === "gls") {
                        const c = country.couriers.find(c => c.name.toLowerCase().includes("gls"));
                        if (c) { courierId = c.id; courierName = c.name; }
                    } else if (strat === "fan") {
                        const c = country.couriers.find(c => c.name.toLowerCase().includes("fan"));
                        if (c) { courierId = c.id; courierName = c.name; }
                    }
                }
            }

            // Check duplicate
            if (existingRefs.has(clientRef) || existingRefs.has(orderId)) {
                results.push({
                    orderId, posOrderId: orderId, recipient: name, city: "",
                    country: country.code, countryFlag: country.flag,
                    cod: 0, codCurrency: country.currency,
                    courierId, courierName,
                    status: "skipped", error: "Đã tồn tại trên euShipments",
                });
                skipped++;
                byCountry[country.code].skipped++;
                continue;
            }

            // Parse address (country-aware)
            const addr = order.shipping_address || {};
            const fullAddr = typeof addr === "object"
                ? (addr.address || addr.full_address || "") : String(addr);
            const { street, city, zipCode, region } = parseAddress(fullAddr, country);

            // Products — use display_id as SKU/refNumber (matches euShipments REF_NUMBER)
            // POS Cake: vi.display_id = "D04-VERDE" → euShipments: REF_NUMBER = "D04-VERDE"
            const items = order.order_items || order.items || [];
            const products: { refNumber: string; qty: number }[] = [];
            const productNames: string[] = [];
            for (const item of items) {
                const vi = item.variation_info || {};
                const sku = vi.display_id || vi.product_display_id || vi.barcode || item.barcode || "Product";
                const displayName = vi.name || item.product_name || sku;
                const qty = Number(item.quantity || 1);
                products.push({ refNumber: sku, qty });
                productNames.push(displayName);
            }

            // COD — POS Cake stores in cents (18400 = 184.00 RON)
            const codRaw = Number(order.cod || 0);
            const codAmount = codRaw / 100;

            // Validate
            const missing: string[] = [];
            if (!name) missing.push("tên");
            if (!city) missing.push("thành phố");
            if (!zipCode) missing.push("mã bưu điện");
            if (!phone || phone.length < 10) missing.push("SĐT");

            if (missing.length > 0) {
                results.push({
                    orderId, posOrderId: orderId, recipient: name, city,
                    country: country.code, countryFlag: country.flag,
                    cod: codAmount, codCurrency: country.currency,
                    courierId, courierName,
                    status: "skipped",
                    error: `Thiếu: ${missing.join(", ")}`,
                });
                skipped++;
                byCountry[country.code].skipped++;
                continue;
            }

            if (dryRun) {
                results.push({
                    orderId, posOrderId: orderId, recipient: name, city,
                    country: country.code, countryFlag: country.flag,
                    cod: codAmount, codCurrency: country.currency,
                    courierId, courierName,
                    status: "skipped",
                    error: `Dry run — ${country.flag} ${country.name}`,
                });
                skipped++;
                byCountry[country.code].skipped++;
                continue;
            }

            // 4. Create order on euShipments
            const totalQty = products.reduce((s, p) => s + p.qty, 0) || 1;
            // Phone: euShipments Excel import uses local format (0742...)
            // Keep local format for RO, normalize for other countries
            const phoneForApi = country.code === "RO"
                ? (order.bill_phone_number || order.customer_phone || "").replace(/[\s\-().]/g, "")
                : phone;

            const payload = {
                testMode: 0,
                senderId: SENDER_ID,
                courierId,
                waybillAvailableDate: new Date().toISOString().slice(0, 10),
                serviceName: "crossborder",
                recipient: {
                    name,
                    countryIsoCode: country.code,
                    cityName: city,
                    zipCode: zipCode.replace(/\s/g, ""),
                    streetName: street,
                    regionName: region || "",
                    phoneNumber: phoneForApi,
                    email: order.bill_email || order.customer_email || "aureliawear.eu@gmail.com",
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
                    contents: "Rochie",
                    productsInfo: productNames.join(","),
                },
                products,
                customsData: {
                    dutyPaymentInfo: "DDU",
                    customsValue: codAmount.toFixed(2),
                },
                clientReference: clientRef,
            };

            try {
                const euResp = await fetchWithRetry(`${EU_API_BASE}/fulfilment/create-order`, {
                    method: "POST",
                    headers: euHeaders(),
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(30000),
                }, 2);

                const euData = await euResp.json().catch(() => ({ error: euResp.statusText }));

                if (euResp.ok && !euData.error) {
                    // Update POS status: 8 (Packaging) → 9 (Waiting for Pickup)
                    const posUpdated = await updatePosOrderStatus(orderId, POS_STATUS_WAITING_PICKUP);

                    // Post-push verification: check if euShipments actually processed the order
                    // orders-history uses raw POS orderId as refNum (NOT clientReference STR- prefix)
                    await new Promise(r => setTimeout(r, 2000));
                    const verification = await verifyEuOrder(orderId);

                    results.push({
                        orderId, posOrderId: orderId, recipient: name, city,
                        country: country.code, countryFlag: country.flag,
                        cod: codAmount, codCurrency: country.currency,
                        courierId, courierName,
                        status: "created",
                        euOrderId: euData.orderId,
                        posStatusUpdated: posUpdated,
                        verified: verification.exists,
                        awb: verification.awb || undefined,
                        verificationWarning: verification.exists
                            ? undefined
                            : `⚠️ Chưa xác minh trên euShipments: ${verification.error || "không tìm thấy"}`,
                    });
                    created++;
                    byCountry[country.code].created++;
                } else {
                    const errMsg = typeof euData.error === "string" ? euData.error : JSON.stringify(euData);
                    results.push({
                        orderId, posOrderId: orderId, recipient: name, city,
                        country: country.code, countryFlag: country.flag,
                        cod: codAmount, codCurrency: country.currency,
                        courierId, courierName,
                        status: "failed",
                        error: `${euResp.status}: ${errMsg}`,
                    });
                    failed++;
                    byCountry[country.code].failed++;
                }
            } catch (err: any) {
                results.push({
                    orderId, posOrderId: orderId, recipient: name, city,
                    country: country.code, countryFlag: country.flag,
                    cod: codAmount, codCurrency: country.currency,
                    courierId, courierName,
                    status: "failed",
                    error: err.message || "Unknown error",
                });
                failed++;
                byCountry[country.code].failed++;
            }
        }

        const posUpdatedCount = results.filter(r => r.posStatusUpdated).length;
        const posFailedCount = results.filter(r => r.status === "created" && !r.posStatusUpdated).length;
        const verifiedCount = results.filter(r => r.status === "created" && r.verified).length;
        const unverifiedCount = results.filter(r => r.status === "created" && r.verified === false).length;

        return NextResponse.json({
            success: true,
            message: `Fetched ${orders.length} đơn (${page > 1 ? page - 1 : 1} trang) → Xử lý ${results.length}: ${created} tạo, ${failed} lỗi, ${skipped} bỏ qua` +
                (posUpdatedCount > 0 ? ` | POS: ${posUpdatedCount} → Chờ chuyển hàng` : "") +
                (posFailedCount > 0 ? ` | POS lỗi: ${posFailedCount}` : "") +
                (unverifiedCount > 0 ? ` | ⚠️ ${unverifiedCount} chưa xác minh` : ""),
            stats: { total: results.length, created, failed, skipped, posUpdated: posUpdatedCount, posUpdateFailed: posFailedCount, verified: verifiedCount, unverified: unverifiedCount, fetched: orders.length, pages: page > 1 ? page - 1 : 1 },
            byCountry,
            filterCountry,
            results,
        });
    } catch (error: any) {
        console.error("Stramark push orders error:", error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
