import { NextResponse } from "next/server";
import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";
import { bigquery } from "@/lib/bigquery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ═══ CONFIG ═══
const YAML_PATH = path.join(process.cwd(), "..", "config", "projects", "hnle.yaml");

// HNLE uses USD. POS prices are in USD ÷100
const USD_TO_VND = 25500; // approximate
const POS_PRICE_DIVISOR = 100;

const ACCOUNT_NAMES: Record<string, string> = {
    "act_4436251663362042": "TDF_UC (Đức) 01",
    "act_862258773090270":  "HNLE UC 01 (Đức)",
    "act_1801091267209683": "Nhật TK 07",
    "act_2013093525898990": "Nhật TK 06",
    "act_1188914743330947": "Đức TK 03",
    "act_850593750862900":  "Tùng TK 05",
};
const getAccountName = (id: string) => ACCOUNT_NAMES[id] || id;

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
interface MetaApiStatus {
    token_valid: boolean;
    error_code?: number;
    error_message?: string;
    error_type?: string;
    accounts_ok: string[];
    accounts_blocked: string[];
    rate_limit_pct?: number;
}

let lastMetaStatus: MetaApiStatus | null = null;

function sleepMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, baseMs = 1000, maxMs = 30000): number {
    const exp = Math.min(baseMs * Math.pow(2, attempt), maxMs);
    const jitter = exp * 0.5 * Math.random();
    return Math.round(exp + jitter);
}

async function checkTokenValidity(token: string): Promise<{ valid: boolean; error?: string; code?: number }> {
    try {
        const res = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${token}`, {
            signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        if (data.error) {
            return { valid: false, error: data.error.message, code: data.error.code };
        }
        return { valid: true };
    } catch (e: any) {
        return { valid: false, error: e.message };
    }
}

function parseRateLimitHeaders(headers: Headers): { pct: number; timeToRegain?: number } {
    let maxPct = 0;
    let timeToRegain: number | undefined;

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
        } catch { /* ignore */ }
    }

    const adAccUsage = headers.get('x-ad-account-usage');
    if (adAccUsage) {
        try {
            const parsed = JSON.parse(adAccUsage);
            maxPct = Math.max(maxPct, parsed.acc_id_util_pct || 0);
        } catch { /* ignore */ }
    }

    return { pct: maxPct, timeToRegain };
}

// ═══ META API ═══
async function fetchMetaAds(token: string, accountIds: string[], activeOnly: boolean, fromDate: string, toDate: string) {
    const fields = "campaign_name,campaign_id,adset_id,adset_name,ad_name,ad_id,spend,impressions,cpm,cpc,ctr,actions";
    const allAds: any[] = [];
    const metaStatus: MetaApiStatus = {
        token_valid: true, accounts_ok: [], accounts_blocked: [],
    };

    const tokenCheck = await checkTokenValidity(token);
    if (!tokenCheck.valid) {
        metaStatus.token_valid = false;
        metaStatus.error_code = tokenCheck.code;
        metaStatus.error_message = tokenCheck.error;
        metaStatus.accounts_blocked = [...accountIds];
        console.error(`⚠️ HNLE Meta token INVALID: code=${tokenCheck.code} msg=${tokenCheck.error}`);
        lastMetaStatus = metaStatus;
        return { ads: allAds, metaStatus };
    }

    const filtering = activeOnly
        ? `&filtering=${encodeURIComponent(JSON.stringify([{ "field": "campaign.effective_status", "operator": "IN", "value": ["ACTIVE"] }]))}`
        : '';
    const timeRange = `&time_range=${encodeURIComponent(JSON.stringify({ since: fromDate, until: toDate }))}`;

    for (const accId of accountIds) {
        try {
            let url: string | null = `https://graph.facebook.com/v21.0/${accId}/insights?fields=${fields}&level=ad${timeRange}&limit=500${filtering}&access_token=${token}`;
            let pageCount = 0;
            const MAX_PAGES = 10;
            let accountOk = false;

            while (url && pageCount < MAX_PAGES) {
                let attempt = 0;
                const MAX_RETRIES = 3;
                let success = false;

                while (attempt < MAX_RETRIES && !success) {
                    const res: Response = await fetch(url!, { signal: AbortSignal.timeout(15000) });

                    const rl = parseRateLimitHeaders(res.headers);
                    metaStatus.rate_limit_pct = Math.max(metaStatus.rate_limit_pct || 0, rl.pct);

                    if (rl.pct > 75) {
                        const waitMs = rl.pct > 90 ? 10000 : 3000;
                        console.warn(`⚠️ Rate limit ${rl.pct}% for ${accId}, waiting ${waitMs}ms`);
                        await sleepMs(waitMs);
                    }

                    if (res.status === 429) {
                        const retryAfter = parseInt(res.headers.get('Retry-After') || '0');
                        const waitMs = retryAfter > 0
                            ? retryAfter * 1000
                            : rl.timeToRegain
                                ? rl.timeToRegain * 60 * 1000
                                : backoffDelay(attempt);
                        console.warn(`🔄 Rate limited (429) for ${accId}, retry in ${waitMs}ms (attempt ${attempt + 1})`);
                        await sleepMs(Math.min(waitMs, 30000));
                        attempt++;
                        continue;
                    }

                    if (!res.ok) {
                        console.error(`Meta ${accId}: HTTP ${res.status}`);
                        break;
                    }

                    const data: any = await res.json();

                    if (data.error) {
                        const errCode = data.error.code;
                        const errMsg = data.error.message || '';
                        console.error(`Meta ${accId} API error: code=${errCode} msg=${errMsg}`);

                        if (errCode === 200) {
                            metaStatus.accounts_blocked.push(accId);
                            metaStatus.error_code = errCode;
                            metaStatus.error_message = errMsg;
                            break;
                        } else if (errCode === 190) {
                            metaStatus.token_valid = false;
                            metaStatus.error_code = errCode;
                            metaStatus.error_message = 'Token expired';
                            break;
                        } else if (errCode === 4 || errCode === 17 || errCode === 32) {
                            const waitMs = backoffDelay(attempt);
                            console.warn(`🔄 Rate limit (code ${errCode}) for ${accId}, backoff ${waitMs}ms`);
                            await sleepMs(waitMs);
                            attempt++;
                            continue;
                        } else {
                            metaStatus.accounts_blocked.push(accId);
                            break;
                        }
                    }

                    const rows = data.data || [];
                    for (const row of rows) {
                        const actions = row.actions || [];
                        const messages = actions.find((a: any) => a.action_type === "onsite_conversion.messaging_conversation_started_7d")?.value || 0;
                        const purchases = actions.find((a: any) => a.action_type === "purchase" || a.action_type === "omni_purchase")?.value || 0;
                        allAds.push({
                            account_id: accId,
                            account_name: getAccountName(accId),
                            campaign_id: row.campaign_id,
                            campaign_name: row.campaign_name,
                            campaign_status: row.campaign_effective_status || "UNKNOWN",
                            adset_id: row.adset_id || "",
                            adset_name: row.adset_name || "",
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
                            revenue_ron: 0, // field name kept for API compatibility; unit = USD for HNLE
                            order_details: [] as any[],
                        });
                    }

                    url = data.paging?.next || null;
                    pageCount++;
                    accountOk = true;
                    success = true;

                    if (url) await sleepMs(200);
                }

                if (!success) break;
            }

            if (accountOk) {
                metaStatus.accounts_ok.push(accId);
                if (pageCount > 1) console.log(`Meta ${accId}: fetched ${pageCount} pages`);
            }

            if (accountIds.indexOf(accId) < accountIds.length - 1) {
                await sleepMs(500);
            }

        } catch (e: any) {
            console.error(`Meta ${accId} error:`, e.message);
            metaStatus.accounts_blocked.push(accId);
        }
    }

    // Fetch campaign statuses in bulk
    const campaignIds = [...new Set(allAds.map(a => a.campaign_id))];
    const statusMap = new Map<string, string>();
    if (campaignIds.length > 0 && metaStatus.token_valid) {
        try {
            for (let i = 0; i < campaignIds.length; i += 50) {
                const batch = campaignIds.slice(i, i + 50);
                const ids = batch.join(",");
                const res = await fetch(
                    `https://graph.facebook.com/v21.0/?ids=${ids}&fields=effective_status&access_token=${token}`,
                    { signal: AbortSignal.timeout(10000) }
                );
                if (res.ok) {
                    const data = await res.json();
                    for (const [id, info] of Object.entries(data) as [string, any][]) {
                        statusMap.set(id, info.effective_status || "UNKNOWN");
                    }
                }
            }
        } catch (e: any) {
            console.warn("Campaign status fetch failed (non-critical):", e.message);
        }
        for (const ad of allAds) {
            ad.campaign_status = statusMap.get(ad.campaign_id) || "UNKNOWN";
        }
    }

    lastMetaStatus = metaStatus;
    return { ads: allAds, metaStatus };
}

// ═══ POS: BigQuery for history ═══
const BQ_PROJECT = "levelup-465304";
const BQ_DATASET = "HNLE_Dataset";

async function fetchPOSFromBigQuery(fromDate: string, toDate: string) {
    const allOrders: any[] = [];
    try {
        const query = `
            SELECT
                id, status, status_name, total_price, cod,
                p_utm_term, p_utm_campaign, p_utm_medium,
                marketer, customer_name, bill_full_name,
                CAST(inserted_at AS STRING) AS inserted_at
            FROM \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\`
            WHERE DATE(CAST(inserted_at AS TIMESTAMP)) >= @fromDate
              AND DATE(CAST(inserted_at AS TIMESTAMP)) <= @toDate
            ORDER BY inserted_at DESC
        `;
        const [rows] = await bigquery.query({ query, params: { fromDate, toDate } });
        for (const row of rows) {
            const priceUsd = (row.cod || row.total_price || 0) / POS_PRICE_DIVISOR;
            const utmAdId = row.p_utm_term ? String(row.p_utm_term).trim() : null;
            allOrders.push({
                id: String(row.id || ''),
                shop_name: 'HNLE',
                utm_ad_id: utmAdId,
                utm_adset_id: row.p_utm_medium ? String(row.p_utm_medium).trim() : null,
                utm_campaign: row.p_utm_campaign ? String(row.p_utm_campaign) : null,
                marketer: String(row.marketer || ''),
                total_price_ron: priceUsd, // field name kept for API compatibility; unit = USD
                status: String(row.status || ''),
                inserted_at: row.inserted_at,
                customer_name: String(row.bill_full_name || row.customer_name || ''),
                source: 'bigquery',
            });
        }
        console.log(`BQ POS HNLE: ${allOrders.length} orders for ${fromDate}→${toDate}`);
    } catch (e: any) {
        console.error('BQ POS HNLE error:', e.message);
    }
    return allOrders;
}

// ═══ POS: Direct API for today/yesterday ═══
async function fetchPOSFromDirectAPI(shops: YamlConfig["poscake"]["shops"], date: string) {
    const allOrders: any[] = [];
    const targetDate = date;

    await Promise.all(shops.map(async (shop) => {
        try {
            let page = 1;
            let reachedPast = false;
            while (!reachedPast && page <= 200) {
                const url = `${shop.api_url}/shops/${shop.shop_id}/orders?api_key=${shop.api_key}&page=${page}&sort=-inserted_at`;
                const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
                if (!res.ok) { console.error(`POS ${shop.name}: ${res.status}`); break; }
                const data = await res.json();
                const orders = data.data || [];
                if (orders.length === 0) break;

                for (const o of orders) {
                    const insertedAt = String(o.inserted_at || '');
                    const orderDate = insertedAt.slice(0, 10);
                    if (orderDate > targetDate) continue;
                    if (orderDate < targetDate) { reachedPast = true; break; }

                    const priceUsd = (o.cod || o.total_price || 0) / POS_PRICE_DIVISOR;
                    const mkRaw = o.marketer || o.pke_mkter || null;
                    const marketerName = mkRaw && typeof mkRaw === 'object' ? (mkRaw.name || '') : (mkRaw || '');
                    const custRaw = o.customer_name;
                    const customerName = custRaw && typeof custRaw === 'object' ? (custRaw.name || '') : (custRaw || '');
                    const utmAdId = o.p_utm_term ? String(o.p_utm_term).trim() : null;
                    allOrders.push({
                        id: String(o.id || ''),
                        shop_name: shop.name,
                        utm_ad_id: utmAdId,
                        utm_adset_id: o.p_utm_medium ? String(o.p_utm_medium).trim() : null,
                        utm_campaign: o.p_utm_campaign ? String(o.p_utm_campaign) : null,
                        marketer: marketerName,
                        total_price_ron: priceUsd, // field name kept for API compatibility; unit = USD
                        status: String(o.status || ''),
                        inserted_at: o.inserted_at,
                        customer_name: customerName,
                        source: 'direct_api',
                    });
                }
                page++;
            }
        } catch (e: any) {
            console.error(`POS ${shop.name} error:`, e.message);
        }
    }));

    console.log(`Direct POS HNLE: ${allOrders.length} orders for ${date}`);
    return allOrders;
}

// ═══ Hybrid POS: BQ history + Direct today/yesterday ═══
async function fetchPOSHybrid(shops: YamlConfig["poscake"]["shops"], fromDate: string, toDate: string, today: string) {
    const yesterday = (() => { const d = new Date(today); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
    const twoDaysAgo = (() => { const d = new Date(today); d.setDate(d.getDate() - 2); return d.toISOString().slice(0, 10); })();

    const tasks: Promise<any[]>[] = [];

    if (fromDate <= twoDaysAgo) {
        const bqEnd = toDate <= twoDaysAgo ? toDate : twoDaysAgo;
        tasks.push(fetchPOSFromBigQuery(fromDate, bqEnd));
    }

    if (yesterday >= fromDate && yesterday <= toDate) {
        tasks.push(fetchPOSFromDirectAPI(shops, yesterday));
    }

    if (today >= fromDate && today <= toDate) {
        tasks.push(fetchPOSFromDirectAPI(shops, today));
    }

    const results = await Promise.all(tasks);
    return results.flat();
}

// ═══ MAIN HANDLER ═══
export async function GET(request: Request) {
    const startTime = Date.now();
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active_only') === 'true';
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    const fromDate = searchParams.get('from_date') || today;
    const toDate = searchParams.get('to_date') || today;

    try {
        const cfg = loadConfig();
        const token = cfg.meta_ads.access_token;
        const accountIds = cfg.meta_ads.ad_account_ids;
        const shops = cfg.poscake.shops;

        const [metaResult, orders] = await Promise.all([
            fetchMetaAds(token, accountIds, activeOnly, fromDate, toDate),
            fetchPOSHybrid(shops, fromDate, toDate, today),
        ]);

        const ads = metaResult.ads;
        const metaStatus = metaResult.metaStatus;

        const adIdMap = new Map<string, number>();
        ads.forEach((ad, idx) => { if (ad.ad_id) adIdMap.set(ad.ad_id, idx); });

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
                matchedOrders.push(order);
            } else {
                pass1Unmatched.push(order);
            }
        }

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
        console.log(`📊 HNLE Pass1 unmatched: ${pass1Unmatched.length} total, ${ordersWithUtmAdId} with utm_ad_id (${unknownAdIds.size} unique), ${ordersWithoutUtmAdId} without`);

        const adLookupMap = new Map<string, { name: string; campaign_id: string; adset_id: string; campaign_name: string; adset_name: string; account_id: string }>();
        if (unknownAdIds.size > 0) {
            const idsArray = Array.from(unknownAdIds);
            console.log(`📎 HNLE Graph lookup: ${idsArray.length} ad_ids to resolve`);

            for (const adId of idsArray) {
                try {
                    const lookupUrl = `https://graph.facebook.com/v21.0/${adId}?fields=name,campaign_id,adset_id,account_id&access_token=${token}`;
                    const lookupRes = await fetch(lookupUrl, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
                    const lookupData: any = await lookupRes.json();

                    if (lookupData.error) {
                        console.log(`  ❌ ${adId}: ${lookupData.error.message?.substring(0, 80)}`);
                        continue;
                    }
                    if (!lookupData.campaign_id) {
                        console.log(`  ❌ ${adId}: no campaign_id in response`);
                        continue;
                    }

                    let campaignName = '';
                    try {
                        const campUrl = `https://graph.facebook.com/v21.0/${lookupData.campaign_id}?fields=name&access_token=${token}`;
                        const campRes = await fetch(campUrl, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
                        const campData: any = await campRes.json();
                        campaignName = campData.name || '';
                    } catch { /* skip */ }

                    adLookupMap.set(adId, {
                        name: lookupData.name || `Ad ${adId}`,
                        campaign_id: lookupData.campaign_id,
                        adset_id: lookupData.adset_id || '',
                        campaign_name: campaignName,
                        adset_name: '',
                        account_id: lookupData.account_id || '',
                    });
                    console.log(`  ✅ ${adId} → campaign_id=${lookupData.campaign_id} name=${campaignName.substring(0, 40)}`);
                } catch (e: any) {
                    console.log(`  ⚠️ ${adId}: ${e.message?.substring(0, 80)}`);
                }
            }
            console.log(`📎 HNLE Lookup done: ${adLookupMap.size}/${unknownAdIds.size} resolved`);
        }

        const lookupMatchedOrders: any[] = [];
        const campaignMatchedOrders: any[] = [];
        const unmatchedOrders: any[] = [];

        const adsetToAdIdx = new Map<string, number>();
        ads.forEach((ad, idx) => {
            if (ad.adset_id) {
                const existing = adsetToAdIdx.get(ad.adset_id);
                if (existing === undefined || ad.spend > ads[existing].spend) {
                    adsetToAdIdx.set(ad.adset_id, idx);
                }
            }
        });

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

        const campaignOrdersMap = new Map<string, { orders: number; revenue_ron: number }>();

        for (const order of pass1Unmatched) {
            let matched = false;

            if (!matched && order.utm_ad_id && adLookupMap.has(order.utm_ad_id)) {
                const info = adLookupMap.get(order.utm_ad_id)!;
                const adsetId = info.adset_id;

                if (adsetId && adsetToAdIdx.has(adsetId)) {
                    const adIdx = adsetToAdIdx.get(adsetId)!;
                    ads[adIdx].orders += 1;
                    ads[adIdx].revenue_ron += order.total_price_ron;
                    ads[adIdx].order_details.push({
                        id: order.id, shop: order.shop_name,
                        price_ron: order.total_price_ron,
                        customer: order.customer_name,
                    });
                    lookupMatchedOrders.push(order);
                    matched = true;
                } else {
                    const key = `act_${info.account_id}__${info.campaign_id}`;
                    const existing = campaignOrdersMap.get(key);
                    if (existing) {
                        existing.orders += 1;
                        existing.revenue_ron += order.total_price_ron;
                    } else {
                        campaignOrdersMap.set(key, { orders: 1, revenue_ron: order.total_price_ron });
                    }
                    lookupMatchedOrders.push(order);
                    matched = true;
                }
            }

            if (!matched && order.utm_adset_id && adsetToAdIdx.has(order.utm_adset_id)) {
                const adIdx = adsetToAdIdx.get(order.utm_adset_id)!;
                ads[adIdx].orders += 1;
                ads[adIdx].revenue_ron += order.total_price_ron;
                ads[adIdx].order_details.push({
                    id: order.id, shop: order.shop_name,
                    price_ron: order.total_price_ron,
                    customer: order.customer_name,
                });
                lookupMatchedOrders.push(order);
                matched = true;
            }

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
                campaignMatchedOrders.push(order);
                matched = true;
            }

            if (!matched) {
                unmatchedOrders.push(order);
            }
        }

        const totalMatched = matchedOrders.length + lookupMatchedOrders.length + campaignMatchedOrders.length;
        console.log(`HNLE Matching: ${matchedOrders.length} by ad_id, ${lookupMatchedOrders.length} by lookup, ${campaignMatchedOrders.length} by campaign_name, ${unmatchedOrders.length} unmatched`);

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

        for (const [key, campOrders] of campaignOrdersMap) {
            const campaign = campaignMap.get(key);
            if (campaign) {
                campaign.orders += campOrders.orders;
                campaign.revenue_ron += campOrders.revenue_ron;
            }
        }

        const campaigns = Array.from(campaignMap.values()).map(c => ({
            ...c,
            roas: c.spend > 0 ? Math.round((c.revenue_ron / c.spend) * 100) / 100 : 0,
            cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
            ads_count: c.ads.length,
            ads: c.ads.map((a: any) => ({
                ad_id: a.ad_id, ad_name: a.ad_name, adset_name: a.adset_name,
                ad_status: a.ad_status || "UNKNOWN",
                spend: a.spend, impressions: a.impressions,
                cpm: a.cpm, cpc: a.cpc, ctr: a.ctr,
                messages: a.messages, purchases: a.purchases,
                orders: a.orders, revenue_ron: a.revenue_ron,
                roas: a.spend > 0 ? Math.round((a.revenue_ron / a.spend) * 100) / 100 : 0,
            })),
        })).sort((a, b) => b.spend - a.spend);

        const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
        const matchedRevenue = campaigns.reduce((s, c) => s + c.revenue_ron, 0);
        const matchedOrderCount = campaigns.reduce((s, c) => s + c.orders, 0);
        const totalMessages = campaigns.reduce((s, c) => s + c.messages, 0);
        const totalPurchases = campaigns.reduce((s, c) => s + c.purchases, 0);

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

        const hasBQ = orders.some((o: any) => o.source === 'bigquery');
        const hasDirect = orders.some((o: any) => o.source === 'direct_api');
        const posSource = hasBQ && hasDirect ? 'BQ+API' : hasBQ ? 'BigQuery' : 'Direct API';

        const metaLabel = metaStatus.token_valid
            ? (metaStatus.accounts_blocked.length > 0 ? 'Partial' : 'Direct')
            : 'BLOCKED';

        return NextResponse.json({
            source: `META:${metaLabel}|POS:${posSource}`,
            fetched_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            meta_status: {
                token_valid: metaStatus.token_valid,
                error_code: metaStatus.error_code,
                error_message: metaStatus.error_message,
                accounts_ok: metaStatus.accounts_ok,
                accounts_blocked: metaStatus.accounts_blocked,
                rate_limit_pct: metaStatus.rate_limit_pct,
            },
            summary: {
                total_spend: totalSpend,
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
            })),
            unmatched_by_shop: unmatchedByShop,
        });
    } catch (error: any) {
        console.error("HNLE Realtime API error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
