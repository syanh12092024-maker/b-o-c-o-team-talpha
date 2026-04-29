import { NextResponse } from "next/server";
import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";
import { bigquery } from "@/lib/bigquery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ═══ CONFIG ═══
const YAML_PATH = path.join(process.cwd(), "..", "config", "projects", "talpha.yaml");

const EXCHANGE_RATES: Record<string, number> = {
    Saudi: 6850, UAE: 7010, Kuwait: 83000, Oman: 66700, Qatar: 7050, Bahrain: 68000,
};

// Timezone alignment: Meta ad accounts = +4 (Dubai)
// POS inserted_at timestamps are ALSO in Gulf time (+4) — no conversion needed
const AD_ACCOUNT_TZ = 'Asia/Dubai';    // UTC+4 — Meta Ads daily cutoff

// TALPHA ad accounts use VND currency — Meta API 'spend' is already in VND
// No USD→VND conversion needed for ads data

const ACCOUNT_NAMES: Record<string, string> = {
    "act_1503790877534258": "Tiểu Alpha 3",
    "act_855567553811483": "Sỹ Lộc 01",
    "act_833593695771745": "Chu Thuý 01",
    "act_848995974322757": "Chu Thuý 02",
    "act_3534017756739334": "Kuwait +3",
    "act_703242242813144": "Trang Sức +1",
    "act_1119368126847210": "Trang sức 2 Dubai",
    "act_719840753771124": "Tiểu Alpha 4",
};

interface YamlConfig {
    meta_ads: { access_token: string; ad_account_ids: string[] };
    poscake: { shops: Array<{ name: string; api_url: string; api_key: string; shop_id: string }> };
}

function loadConfig(): YamlConfig {
    const raw = fs.readFileSync(YAML_PATH, "utf-8");
    return yaml.load(raw) as YamlConfig;
}

// ═══ META API: Fetch insights per ad for date range (with pagination) ═══
async function fetchMetaAds(token: string, accountIds: string[], activeOnly: boolean, fromDate: string, toDate: string) {
    const fields = "campaign_name,campaign_id,adset_name,ad_name,ad_id,spend,impressions,cpm,cpc,ctr,actions";
    const allAds: any[] = [];
    // Filter to ACTIVE campaigns only if requested
    const filtering = activeOnly
        ? `&filtering=${encodeURIComponent(JSON.stringify([{ "field": "campaign.effective_status", "operator": "IN", "value": ["ACTIVE"] }]))}`
        : '';
    // Use time_range for custom dates — NO time_increment=1 so Meta aggregates per ad_id
    const timeRange = `&time_range=${encodeURIComponent(JSON.stringify({ since: fromDate, until: toDate }))}`;

    await Promise.all(accountIds.map(async (accId) => {
        try {
            let url: string | null = `https://graph.facebook.com/v21.0/${accId}/insights?fields=${fields}&level=ad${timeRange}&limit=500${filtering}&access_token=${token}`;
            let pageCount = 0;
            const MAX_PAGES = 10; // safety limit: 10 pages × 500 = 5000 ads max per account

            while (url && pageCount < MAX_PAGES) {
                const res: Response = await fetch(url, { signal: AbortSignal.timeout(15000) });
                if (!res.ok) { console.error(`Meta ${accId}: ${res.status}`); break; }
                const data: any = await res.json();
                const rows = data.data || [];

                for (const row of rows) {
                    const actions = row.actions || [];
                    const messages = actions.find((a: any) => a.action_type === "onsite_conversion.messaging_conversation_started_7d")?.value || 0;
                    const purchases = actions.find((a: any) => a.action_type === "purchase" || a.action_type === "omni_purchase")?.value || 0;
                    allAds.push({
                        account_id: accId,
                        account_name: ACCOUNT_NAMES[accId] || accId,
                        campaign_id: row.campaign_id,
                        campaign_name: row.campaign_name,
                        adset_name: row.adset_name || "",
                        ad_name: row.ad_name || "",
                        ad_id: row.ad_id,
                        spend_vnd: parseFloat(row.spend || "0"), // Already VND (accounts are VND-billed)
                        impressions: parseInt(row.impressions || "0"),
                        cpm_vnd: parseFloat(row.cpm || "0"),
                        cpc_vnd: parseFloat(row.cpc || "0"),
                        ctr: parseFloat(row.ctr || "0"),
                        messages: parseInt(messages),
                        purchases: parseInt(purchases),
                        // Will be filled by mapping
                        orders: 0,
                        revenue_vnd: 0,
                        order_details: [] as any[],
                    });
                }

                // Follow pagination
                url = data.paging?.next || null;
                pageCount++;
            }
            if (pageCount > 1) console.log(`Meta ${accId}: fetched ${pageCount} pages`);
        } catch (e: any) {
            console.error(`Meta ${accId} error:`, e.message);
        }
    }));

    return allAds;
}

// ═══ POS: HYBRID — BigQuery for history + Direct API for today ═══

const BQ_PROJECT = "levelup-465304";
const BQ_DATASET = "TALPHA_Dataset";

// Fetch historical orders from BigQuery (synced data — accurate)
async function fetchPOSFromBigQuery(fromDate: string, toDate: string) {
    const allOrders: any[] = [];
    try {
        const query = `
            SELECT
                id, shop_name, ad_id, total_price, cod,
                CAST(inserted_at AS STRING) AS inserted_at,
                marketer, status, status_name,
                bill_full_name AS customer_name
            FROM \`${BQ_PROJECT}.${BQ_DATASET}.sale_order\`
            WHERE DATE(inserted_at) >= @fromDate
              AND DATE(inserted_at) <= @toDate
            ORDER BY inserted_at DESC
        `;
        const [rows] = await bigquery.query({
            query,
            params: { fromDate, toDate },
        });
        for (const row of rows) {
            const shopName = row.shop_name || '';
            const rate = EXCHANGE_RATES[shopName] || 6850;
            const priceLocal = row.cod || row.total_price || 0;
            allOrders.push({
                id: String(row.id || ''),
                shop_name: shopName,
                ad_id: row.ad_id ? String(row.ad_id) : null,
                marketer: String(row.marketer || ''),
                total_price_local: priceLocal,
                total_price_vnd: priceLocal * rate,
                status: String(row.status || ''),
                inserted_at: row.inserted_at,
                customer_name: String(row.customer_name || ''),
                source: 'bigquery',
            });
        }
        console.log(`BQ POS: ${allOrders.length} orders for ${fromDate}→${toDate}`);
    } catch (e: any) {
        console.error('BQ POS error:', e.message);
    }
    return allOrders;
}

// Fetch today's orders from direct POS API (realtime)
// Note: POS API ignores from_date/to_date params! We filter client-side.
// Results are sorted by -inserted_at (newest first), so we stop when orders go before target date.
async function fetchPOSFromDirectAPI(shops: YamlConfig["poscake"]["shops"], date: string) {
    const allOrders: any[] = [];
    const targetDate = date; // YYYY-MM-DD

    await Promise.all(shops.map(async (shop) => {
        try {
            let page = 1;
            let reachedPast = false;
            while (!reachedPast && page <= 200) { // safety limit
                const url = `${shop.api_url}/shops/${shop.shop_id}/orders?api_key=${shop.api_key}&page=${page}&sort=-inserted_at`;
                const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
                if (!res.ok) { console.error(`POS ${shop.name}: ${res.status}`); break; }
                const data = await res.json();
                const orders = data.data || [];
                if (orders.length === 0) break;

                for (const o of orders) {
                    // POS timestamps are in Gulf time (+4) = same as ad account timezone
                    // Just extract the date directly — no timezone conversion needed
                    const insertedAt = String(o.inserted_at || '');
                    const orderDate = insertedAt.slice(0, 10); // YYYY-MM-DD (already in +4)

                    // Since sorted newest-first, skip future entries, stop at past entries
                    if (orderDate > targetDate) continue; // future? skip
                    if (orderDate < targetDate) {
                        reachedPast = true;
                        break; // all remaining are older, stop
                    }

                    // orderDate === targetDate → include this order
                    const priceLocal = (o.cod || o.total_price || 0) / 100;
                    const rate = EXCHANGE_RATES[shop.name] || 6850;
                    const mkRaw = o.marketer || o.pke_mkter || null;
                    const marketerName = mkRaw && typeof mkRaw === 'object' ? (mkRaw.name || '') : (mkRaw || '');
                    const custRaw = o.customer_name;
                    const customerName = custRaw && typeof custRaw === 'object' ? (custRaw.name || '') : (custRaw || '');
                    allOrders.push({
                        id: String(o.id || ''),
                        shop_name: shop.name,
                        ad_id: o.ad_id ? String(o.ad_id) : null,
                        marketer: marketerName,
                        total_price_local: priceLocal,
                        total_price_vnd: priceLocal * rate,
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

    console.log(`Direct POS: ${allOrders.length} orders for ${date}`);
    return allOrders;
}

// Hybrid: BQ for history (2+ days ago) + direct API for recent (today & yesterday)
// Why yesterday via API? BQ sync often hasn't run yet for yesterday's data
async function fetchPOSHybrid(shops: YamlConfig["poscake"]["shops"], fromDate: string, toDate: string, today: string) {
    const yesterday = (() => { const d = new Date(today); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
    // "recent" = dates we fetch via direct API (today + yesterday)
    const twoDaysAgo = (() => { const d = new Date(today); d.setDate(d.getDate() - 2); return d.toISOString().slice(0, 10); })();

    const tasks: Promise<any[]>[] = [];

    // BQ for dates older than yesterday (fromDate → twoDaysAgo)
    if (fromDate <= twoDaysAgo) {
        const bqEnd = toDate <= twoDaysAgo ? toDate : twoDaysAgo;
        tasks.push(fetchPOSFromBigQuery(fromDate, bqEnd));
    }

    // Direct API for yesterday (if in range)
    if (yesterday >= fromDate && yesterday <= toDate) {
        tasks.push(fetchPOSFromDirectAPI(shops, yesterday));
    }

    // Direct API for today (if in range)
    if (today >= fromDate && today <= toDate) {
        tasks.push(fetchPOSFromDirectAPI(shops, today));
    }

    const results = await Promise.all(tasks);
    return results.flat();
}

// ═══ MAIN: Map ads ↔ orders by ad_id ═══
export async function GET(request: Request) {
    const startTime = Date.now();
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active_only') !== 'false'; // default: true
    // Use ad account timezone (+4) for "today" determination — matches Meta Ads daily cutoff
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: AD_ACCOUNT_TZ }); // YYYY-MM-DD in +4
    const fromDate = searchParams.get('from_date') || today;
    const toDate = searchParams.get('to_date') || today;

    try {
        const cfg = loadConfig();
        const token = cfg.meta_ads.access_token;
        const accountIds = cfg.meta_ads.ad_account_ids;
        const shops = cfg.poscake.shops;

        // Fetch in parallel
        const [ads, orders] = await Promise.all([
            fetchMetaAds(token, accountIds, activeOnly, fromDate, toDate),
            fetchPOSHybrid(shops, fromDate, toDate, today),
        ]);

        // Build ad_id → ad index map for O(1) lookup
        const adIdMap = new Map<string, number>();
        ads.forEach((ad, idx) => {
            if (ad.ad_id) adIdMap.set(ad.ad_id, idx);
        });

        // Map orders to ads
        const matchedOrders: any[] = [];
        const unmatchedOrders: any[] = [];

        for (const order of orders) {
            if (order.ad_id && adIdMap.has(order.ad_id)) {
                const adIdx = adIdMap.get(order.ad_id)!;
                ads[adIdx].orders += 1;
                ads[adIdx].revenue_vnd += order.total_price_vnd;
                ads[adIdx].order_details.push({
                    id: order.id,
                    shop: order.shop_name,
                    price_vnd: order.total_price_vnd,
                    customer: order.customer_name,
                });
                matchedOrders.push(order);
            } else {
                unmatchedOrders.push(order);
            }
        }

        // Group ads by campaign for summary
        const campaignMap = new Map<string, any>();
        for (const ad of ads) {
            const key = `${ad.account_id}__${ad.campaign_id}`;
            const existing = campaignMap.get(key);
            if (existing) {
                existing.spend_vnd += ad.spend_vnd;
                existing.impressions += ad.impressions;
                existing.messages += ad.messages;
                existing.purchases += ad.purchases;
                existing.orders += ad.orders;
                existing.revenue_vnd += ad.revenue_vnd;
                existing.ads.push(ad);
            } else {
                campaignMap.set(key, {
                    account_id: ad.account_id,
                    account_name: ad.account_name,
                    campaign_id: ad.campaign_id,
                    campaign_name: ad.campaign_name,
                    spend_vnd: ad.spend_vnd,
                    impressions: ad.impressions,
                    cpm_vnd: ad.cpm_vnd,
                    ctr: ad.ctr,
                    messages: ad.messages,
                    purchases: ad.purchases,
                    orders: ad.orders,
                    revenue_vnd: ad.revenue_vnd,
                    roas: 0,
                    ads: [ad],
                });
            }
        }

        // Calculate ROAS per campaign
        const campaigns = Array.from(campaignMap.values()).map(c => ({
            ...c,
            roas: c.spend_vnd > 0 ? Math.round((c.revenue_vnd / c.spend_vnd) * 100) / 100 : 0,
            cpm_vnd: c.impressions > 0 ? (c.spend_vnd / c.impressions) * 1000 : 0,
            ads_count: c.ads.length,
            ads: c.ads.map((a: any) => ({
                ad_id: a.ad_id,
                ad_name: a.ad_name,
                adset_name: a.adset_name,
                spend_vnd: a.spend_vnd,
                impressions: a.impressions,
                cpm_vnd: a.cpm_vnd,
                cpc_vnd: a.cpc_vnd,
                ctr: a.ctr,
                messages: a.messages,
                purchases: a.purchases,
                orders: a.orders,
                revenue_vnd: a.revenue_vnd,
                roas: a.spend_vnd > 0 ? Math.round((a.revenue_vnd / a.spend_vnd) * 100) / 100 : 0,
            })),
        })).sort((a, b) => b.spend_vnd - a.spend_vnd);

        // Summary totals
        const totalSpendVnd = campaigns.reduce((s, c) => s + c.spend_vnd, 0);
        const matchedRevenueVnd = campaigns.reduce((s, c) => s + c.revenue_vnd, 0);
        const matchedOrderCount = campaigns.reduce((s, c) => s + c.orders, 0);
        const totalMessages = campaigns.reduce((s, c) => s + c.messages, 0);
        const totalPurchases = campaigns.reduce((s, c) => s + c.purchases, 0);

        // Unmatched revenue by shop
        const unmatchedByShop: Record<string, { count: number; revenue_vnd: number }> = {};
        let unmatchedRevenueVnd = 0;
        for (const o of unmatchedOrders) {
            const shop = o.shop_name || 'Unknown';
            if (!unmatchedByShop[shop]) unmatchedByShop[shop] = { count: 0, revenue_vnd: 0 };
            unmatchedByShop[shop].count += 1;
            unmatchedByShop[shop].revenue_vnd += o.total_price_vnd;
            unmatchedRevenueVnd += o.total_price_vnd;
        }

        // Total revenue = matched + unmatched
        const totalRevenueVnd = matchedRevenueVnd + unmatchedRevenueVnd;

        // Determine POS source label
        const hasBQ = orders.some((o: any) => o.source === 'bigquery');
        const hasDirect = orders.some((o: any) => o.source === 'direct_api');
        const posSource = hasBQ && hasDirect ? 'BQ+API' : hasBQ ? 'BigQuery' : 'Direct API';

        return NextResponse.json({
            source: `META:Direct|POS:${posSource}`,
            fetched_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            summary: {
                total_spend_vnd: totalSpendVnd,
                total_revenue_vnd: totalRevenueVnd,
                matched_revenue_vnd: matchedRevenueVnd,
                unmatched_revenue_vnd: unmatchedRevenueVnd,
                total_orders: matchedOrderCount,
                total_messages: totalMessages,
                matched_orders: matchedOrders.length,
                unmatched_orders: unmatchedOrders.length,
                total_pos_orders: orders.length,
                total_meta_purchases: totalPurchases,
                blended_roas: totalSpendVnd > 0 ? Math.round((totalRevenueVnd / totalSpendVnd) * 100) / 100 : 0,
                accounts_fetched: accountIds.length,
                shops_fetched: shops.length,
            },
            campaigns,
            unmatched_orders: unmatchedOrders.slice(0, 20).map(o => ({
                id: String(o.id || ''), shop: String(o.shop_name || ''), price_vnd: o.total_price_vnd,
                ad_id: o.ad_id ? String(o.ad_id) : 'none', marketer: String(o.marketer || ''),
            })),
            unmatched_by_shop: unmatchedByShop,
        });
    } catch (error: any) {
        console.error("Realtime API error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
