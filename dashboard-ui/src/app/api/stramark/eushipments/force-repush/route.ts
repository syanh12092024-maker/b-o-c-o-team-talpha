import { NextResponse } from "next/server";

/**
 * Stramark — Force Re-Push Ghost Orders to euShipments
 *
 * POST /api/stramark/eushipments/force-repush
 *   - Re-pushes specific orders that were "ghost" (created but never processed by euShipments)
 *   - Uses a new clientReference with retry suffix: STR-{id}-R2, STR-{id}-R3, etc.
 *   - Fetches POS orders by ID (not by status) — works for orders already at status 9
 *   - Verifies the order on euShipments after push via orders-history
 *
 * Body: { orderIds: string[], courierId?: number, dryRun?: boolean }
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ─── Config ───────────────────────────────────────────────────────────────────
const EU_API_BASE = "https://api1.inout.bg/api/v1";
const EU_API_TOKEN = process.env.STRAMARK_FFM_API_TOKEN_2 || process.env.STRAMARK_FFM_API_TOKEN || "";
const POS_API_BASE = process.env.POSCAKE_API_URL || "https://pos.pages.fm/api/v1";
const POS_API_KEY = process.env.POSCAKE_API_KEY || "";
const POS_SHOP_ID = process.env.POSCAKE_SHOP_ID || "1635307570";
const SENDER_ID = Number(process.env.EU_SHIPMENT_CLIENT_ID_NEW || "3282");

function euHeaders(): HeadersInit {
    return { Authorization: `Bearer ${EU_API_TOKEN}`, "Content-Type": "application/json" };
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 2): Promise<Response> {
    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const resp = await fetch(url, options);
            if (resp.ok || (resp.status >= 400 && resp.status < 500)) return resp;
            if (attempt < maxRetries) { await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000)); continue; }
            return resp;
        } catch (err) {
            lastError = err;
            if (attempt < maxRetries) await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
    }
    throw lastError || new Error("Max retries exceeded");
}

// ─── Country profiles (same as push-orders) ──────────────────────────────────

interface CountryProfile {
    code: string; name: string; flag: string;
    defaultCourierId: number; courierName: string;
    phonePrefix: string; phoneLength: number;
    zipRegex: RegExp; zipDigits: number;
    currency: string; tagKeywords: string[];
}

const COUNTRY_PROFILES: Record<string, CountryProfile> = {
    RO: { code: "RO", name: "Romania", flag: "🇷🇴", defaultCourierId: 812, courierName: "Romania GLS", phonePrefix: "+40", phoneLength: 11, zipRegex: /^\d{6}$/, zipDigits: 6, currency: "RON", tagKeywords: ["romania", "românia", "ro"] },
    SK: { code: "SK", name: "Slovakia", flag: "🇸🇰", defaultCourierId: 741, courierName: "Slovakia GLS", phonePrefix: "+421", phoneLength: 12, zipRegex: /^\d{3}\s?\d{2}$/, zipDigits: 5, currency: "EUR", tagKeywords: ["slovakia", "slovensko", "sk"] },
    BG: { code: "BG", name: "Bulgaria", flag: "🇧🇬", defaultCourierId: 838, courierName: "Bulgaria Express One", phonePrefix: "+359", phoneLength: 11, zipRegex: /^\d{4}$/, zipDigits: 4, currency: "EUR", tagKeywords: ["bulgaria", "българия", "bg"] },
    HR: { code: "HR", name: "Croatia", flag: "🇭🇷", defaultCourierId: 651, courierName: "Croatia DPD", phonePrefix: "+385", phoneLength: 11, zipRegex: /^\d{5}$/, zipDigits: 5, currency: "EUR", tagKeywords: ["croatia", "hrvatska", "hr"] },
};

function detectCountry(order: any): CountryProfile {
    const rawTags = order.tags;
    let tagStr = "";
    if (Array.isArray(rawTags)) {
        tagStr = rawTags.map((t: any) => typeof t === "string" ? t : (t?.name || t?.label || t?.title || "")).join(" ");
    } else if (typeof rawTags === "string") { tagStr = rawTags; }
    const lower = tagStr.toLowerCase();
    for (const code of ["SK", "BG", "HR"] as const) {
        if (COUNTRY_PROFILES[code].tagKeywords.some(kw => lower.includes(kw))) return COUNTRY_PROFILES[code];
    }
    return COUNTRY_PROFILES.RO;
}

function normalizePhone(phone: string, country: CountryProfile): string {
    let p = phone.replace(/[\s\-().]/g, "");
    const prefix = country.phonePrefix;
    const digits = prefix.replace("+", "");
    if (p.startsWith("00" + digits)) p = prefix + p.slice(2 + digits.length);
    if (p.startsWith(digits) && !p.startsWith("+")) p = "+" + p;
    if (p.startsWith("0") && p.length >= 9 && p.length <= 11) p = prefix + p.slice(1);
    if (!p.startsWith("+") && p.length >= 7) p = prefix + p;
    return p;
}

function parseAddress(fullAddr: string, country: CountryProfile) {
    let street = "", city = "", zipCode = "", region = "";
    const zipPattern = country.zipDigits === 6 ? /\b(\d{6})\b/ : country.zipDigits === 5 ? /\b(\d{3}\s?\d{2})\b/ : /\b(\d{4,6})\b/;

    if (fullAddr.includes("\t")) {
        const parts = fullAddr.split("\t").map(p => p.trim());
        if (parts.length >= 1 && zipPattern.test(parts[0])) zipCode = parts[0].replace(/\s/g, "");
        if (parts.length >= 2) region = parts[1];
        if (parts.length >= 3) city = parts[2];
        if (parts.length >= 4) street = parts[3];
    } else if (fullAddr.includes("|")) {
        const parts = fullAddr.split("|").map(p => p.trim());
        if (parts.length >= 1 && zipPattern.test(parts[0])) zipCode = parts[0].replace(/\s/g, "");
        if (parts.length >= 2) region = parts[1];
        if (parts.length >= 3) city = parts[2];
        if (parts.length >= 4) street = parts[parts.length - 1].split(",")[0].trim();
    } else {
        const zipMatch = fullAddr.match(zipPattern);
        if (zipMatch) {
            zipCode = zipMatch[1].replace(/\s/g, "");
            street = fullAddr.slice(0, zipMatch.index).replace(/,\s*$/, "").trim();
            const afterZip = fullAddr.slice((zipMatch.index || 0) + zipMatch[0].length).trim();
            const cityMatch = afterZip.match(/^([A-Za-zÀ-žĂăÂâÎîȘșȚțĀ-ž\s\-]+)/);
            if (cityMatch) {
                city = cityMatch[1].trim().replace(/,.*$/, "").trim();
                for (const cn of ["Romania", "România", "Slovakia", "Slovensko", "Bulgaria", "България", "Croatia", "Hrvatska", "RO", "SK", "BG", "HR"]) {
                    if (city.toLowerCase().endsWith(cn.toLowerCase())) city = city.slice(0, -cn.length).trim().replace(/,\s*$/, "").trim();
                }
            }
        } else {
            const parts = fullAddr.split(",").map(p => p.trim());
            if (parts.length >= 3) { street = parts[0]; city = parts[1]; } else { street = fullAddr; }
        }
    }
    return { street: street || fullAddr, city, zipCode, region };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch a single POS order by ID (any status) */
async function fetchPosOrder(orderId: string): Promise<any | null> {
    try {
        const resp = await fetch(
            `${POS_API_BASE}/shops/${POS_SHOP_ID}/orders/${orderId}?api_key=${POS_API_KEY}`,
            { signal: AbortSignal.timeout(15000) }
        );
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.data || data;
    } catch { return null; }
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

/** Compute next retry ref: STR-{id} → STR-{id}-R2, STR-{id}-R3, etc. */
function computeRetryRef(orderId: string, existingRefs: Set<string>): { ref: string; retryN: number } {
    const base = `STR-${orderId}`;
    let maxN = 1; // base "STR-{id}" counts as retry 1
    for (const ref of existingRefs) {
        if (ref === base) continue;
        const match = ref.match(new RegExp(`^STR-${orderId}-R(\\d+)$`));
        if (match) maxN = Math.max(maxN, Number(match[1]));
    }
    const nextN = maxN + 1;
    return { ref: `${base}-R${nextN}`, retryN: nextN };
}

/** Verify order on euShipments via orders-history */
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

// ─── Main handler ─────────────────────────────────────────────────────────────

interface RepushResult {
    orderId: string;
    originalRef: string;
    retryRef: string;
    retryNumber: number;
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
    verified: boolean;
    awb: string | null;
    verificationNote: string;
    error?: string;
}

export async function POST(request: Request) {
    try {
        if (!EU_API_TOKEN) return NextResponse.json({ success: false, error: "STRAMARK_FFM_API_TOKEN chưa cấu hình" }, { status: 500 });
        if (!POS_API_KEY) return NextResponse.json({ success: false, error: "POSCAKE_API_KEY chưa cấu hình" }, { status: 500 });

        const body = await request.json().catch(() => ({}));
        const orderIds: string[] = body.orderIds || [];
        const dryRun = body.dryRun === true;
        const courierOverride = body.courierId ? Number(body.courierId) : null;

        if (orderIds.length === 0) {
            return NextResponse.json({ success: false, error: "orderIds là bắt buộc" }, { status: 400 });
        }
        if (orderIds.length > 20) {
            return NextResponse.json({ success: false, error: "Tối đa 20 đơn mỗi lần" }, { status: 400 });
        }

        // 1. Get existing euShipments refs for retry calculation
        const existingRefs = await getExistingEuRefs();

        const results: RepushResult[] = [];
        let created = 0, failed = 0, skipped = 0;

        for (const orderId of orderIds) {
            const originalRef = `STR-${orderId}`;
            const { ref: retryRef, retryN } = computeRetryRef(orderId, existingRefs);

            // 2. Fetch POS order by ID
            const order = await fetchPosOrder(orderId);
            if (!order) {
                results.push({
                    orderId, originalRef, retryRef, retryNumber: retryN,
                    recipient: "", city: "", country: "", countryFlag: "",
                    cod: 0, codCurrency: "", courierId: 0, courierName: "",
                    status: "failed", verified: false, awb: null,
                    verificationNote: "", error: `POS order #${orderId} không tìm thấy`,
                });
                failed++;
                continue;
            }

            // 3. Parse order data (same logic as push-orders)
            const country = detectCountry(order);
            const name = order.bill_full_name || order.customer_name || "";
            const phone = normalizePhone(order.bill_phone_number || order.customer_phone || "", country);
            let courierId = courierOverride || country.defaultCourierId;
            let courierName = country.courierName;

            const addr = order.shipping_address || {};
            const fullAddr = typeof addr === "object" ? (addr.address || addr.full_address || "") : String(addr);
            const { street, city, zipCode, region } = parseAddress(fullAddr, country);

            const items = order.order_items || order.items || [];
            const products: { refNumber: string; qty: number }[] = [];
            const productNames: string[] = [];
            for (const item of items) {
                const vi = item.variation_info || {};
                const sku = vi.display_id || vi.product_display_id || vi.barcode || item.barcode || "Product";
                const displayName = vi.name || item.product_name || sku;
                products.push({ refNumber: sku, qty: Number(item.quantity || 1) });
                productNames.push(displayName);
            }

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
                    orderId, originalRef, retryRef, retryNumber: retryN,
                    recipient: name, city, country: country.code, countryFlag: country.flag,
                    cod: codAmount, codCurrency: country.currency, courierId, courierName,
                    status: "skipped", verified: false, awb: null,
                    verificationNote: "", error: `Thiếu: ${missing.join(", ")}`,
                });
                skipped++;
                continue;
            }

            if (dryRun) {
                results.push({
                    orderId, originalRef, retryRef, retryNumber: retryN,
                    recipient: name, city, country: country.code, countryFlag: country.flag,
                    cod: codAmount, codCurrency: country.currency, courierId, courierName,
                    status: "skipped", verified: false, awb: null,
                    verificationNote: `Dry run — sẽ dùng ref ${retryRef}`,
                    error: `Dry run — ${country.flag} ${country.name}`,
                });
                skipped++;
                continue;
            }

            // 4. Create order on euShipments with retry ref
            const totalQty = products.reduce((s, p) => s + p.qty, 0) || 1;
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
                    fragile: 0, piecesInPack: totalQty, parcels: 1, envelopes: 0,
                    totalWeight: 1, width: 10, height: 10, length: 10,
                    insurance: 0, preview: 0, saturdayDelivery: 0,
                    contents: "Rochie", productsInfo: productNames.join(","),
                },
                products,
                customsData: { dutyPaymentInfo: "DDU", customsValue: codAmount.toFixed(2) },
                clientReference: retryRef,
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
                    // 5. Verify the order was actually created
                    // orders-history uses awb.referenceNumber (= raw orderId), not clientReference
                    await new Promise(r => setTimeout(r, 2000));
                    const verification = await verifyEuOrder(orderId);

                    // Add to existing refs to prevent collision in same batch
                    existingRefs.add(retryRef);

                    results.push({
                        orderId, originalRef, retryRef, retryNumber: retryN,
                        recipient: name, city, country: country.code, countryFlag: country.flag,
                        cod: codAmount, codCurrency: country.currency, courierId, courierName,
                        status: "created",
                        euOrderId: euData.orderId,
                        verified: verification.exists,
                        awb: verification.awb,
                        verificationNote: verification.exists
                            ? `OK${verification.awb ? ` — AWB: ${verification.awb}` : ""}`
                            : `Chưa xác minh: ${verification.error || "không tìm thấy trên euShipments"}`,
                    });
                    created++;
                } else {
                    const errMsg = typeof euData.error === "string" ? euData.error : JSON.stringify(euData);
                    results.push({
                        orderId, originalRef, retryRef, retryNumber: retryN,
                        recipient: name, city, country: country.code, countryFlag: country.flag,
                        cod: codAmount, codCurrency: country.currency, courierId, courierName,
                        status: "failed", verified: false, awb: null,
                        verificationNote: "",
                        error: `euShipments ${euResp.status}: ${errMsg}`,
                    });
                    failed++;
                }
            } catch (err: any) {
                results.push({
                    orderId, originalRef, retryRef, retryNumber: retryN,
                    recipient: name, city, country: country.code, countryFlag: country.flag,
                    cod: codAmount, codCurrency: country.currency, courierId, courierName,
                    status: "failed", verified: false, awb: null,
                    verificationNote: "", error: err.message || "Unknown error",
                });
                failed++;
            }
        }

        return NextResponse.json({
            success: true,
            message: `Force re-push: ${created} tạo, ${failed} lỗi, ${skipped} bỏ qua`,
            stats: { total: results.length, created, failed, skipped },
            results,
        });
    } catch (error: any) {
        console.error("Force re-push error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
