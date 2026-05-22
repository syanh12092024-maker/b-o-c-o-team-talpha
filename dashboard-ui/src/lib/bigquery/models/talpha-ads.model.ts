import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";
import { runQuery, BQ_DATASET } from "../client";

// Support both: cwd=dashboard-ui (local dev) and cwd=project-root (server/PM2)
const YAML_PATH = (() => {
    const fromCwd = path.resolve(process.cwd(), "config/projects/talpha.yaml");
    if (fs.existsSync(fromCwd)) return fromCwd;
    return path.resolve(process.cwd(), "..", "config/projects/talpha.yaml");
})();

export interface TAlphaConfig {
    meta_ads: { access_token: string; ad_account_ids: string[] };
    poscake: { shops: Array<{ name: string; api_url: string; api_key: string; shop_id: string }>; shop_ids: string[] };
    exchange_rates: Array<{ from: string; to: string; rate: number }>;
    marketer_map?: Array<{ pos_name: string; campaign_key: string }>;
}

export interface TAlphaOrder {
    id: string;
    shop_name: string;
    ad_id: string | null;
    page_id: string | null;
    marketer: string;
    total_price_local: number;
    total_price_vnd: number;
    status: string;
    inserted_at: string;
    customer_name: string;
}

/**
 * ALL 21 TALPHA ad accounts use VND currency (confirmed via Meta API query).
 * Meta API returns spend already in VND → NO conversion needed (rate = 1).
 */

// Cache resolved inactive ad_ids for 24 hours to prevent redundant Meta API calls
const adLookupCache = new Map<string, { campaign_id: string; campaign_name: string; account_id: string }>();

export class TAlphaAdsModel {
    private static loadParentEnv(): void {
        const envPath = path.resolve(process.cwd(), "..", ".env");
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

    private static resolveEnvVars(obj: unknown): unknown {
        if (typeof obj === "string") {
            const match = obj.match(/^\$\{(.+)\}$/);
            if (match) return process.env[match[1]] || obj;
            return obj;
        }
        if (Array.isArray(obj)) return obj.map(item => this.resolveEnvVars(item));
        if (obj && typeof obj === "object") {
            const result: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.resolveEnvVars(value);
            }
            return result;
        }
        return obj;
    }

    static loadConfig(): TAlphaConfig {
        this.loadParentEnv();
        // ═══ Vercel: read YAML from env var ═══
        if (process.env.TALPHA_YAML) {
            try {
                const parsed = yaml.load(process.env.TALPHA_YAML);
                return this.resolveEnvVars(parsed) as TAlphaConfig;
            } catch (e) {
                console.error("[TAlpha] Failed to parse TALPHA_YAML env var:", e);
            }
        }
        // ═══ Local/VPS: fallback to file on disk ═══
        const raw = fs.readFileSync(YAML_PATH, "utf-8");
        const parsed = yaml.load(raw);
        return this.resolveEnvVars(parsed) as TAlphaConfig;
    }

    static getExchangeRate(currency: string): number {
        if (currency === "VND") return 1;
        const cfg = this.loadConfig();
        const rateObj = cfg.exchange_rates.find(r => r.from === currency);
        return rateObj ? rateObj.rate : 7000;
    }

    /**
     * Fetch ALL pages from Meta Ads API (handles pagination).
     * Meta API returns max ~25-500 results per page.
     */
    static async fetchAllPages(initialUrl: string): Promise<any[]> {
        const allData: any[] = [];
        let url: string | null = initialUrl;
        let pageCount = 0;

        while (url && pageCount < 20) { // Safety limit: max 20 pages
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout per page
                const res = await fetch(url, { signal: controller.signal });
                clearTimeout(timeout);
                const json: any = await res.json();

                if (json.error) {
                    console.error("Meta API Error:", json.error.message, json.error.code);
                    break;
                }

                if (json.data) {
                    allData.push(...json.data);
                } else {
                    console.error("Meta API no data field:", JSON.stringify(json).slice(0, 200));
                }

                url = json.paging?.next || null;
                pageCount++;
            } catch (e: any) {
                if (e.name === 'AbortError') {
                    console.error("Meta Ads fetch timeout, continuing...");
                } else {
                    console.error("Meta Ads fetch error:", e);
                }
                break;
            }
        }
        return allData;
    }

    /**
     * Fetch all ads (catalog) for an account — no date filter.
     * Returns: ad_id → { campaign_id, campaign_name, account_id }
     * Used to match POS orders even when the ad has no spend today.
     */
    static async fetchAdCatalog(accId: string, access_token: string): Promise<Record<string, { campaign_id: string; campaign_name: string; account_id: string }>> {
        const catalog: Record<string, { campaign_id: string; campaign_name: string; account_id: string }> = {};
        try {
            const url = `https://graph.facebook.com/v21.0/${accId}/ads?fields=id,campaign_id,campaign{id,name}&limit=500&access_token=${access_token}`;
            const rows = await this.fetchAllPages(url);
            rows.forEach((row: any) => {
                const adId = String(row.id || '');
                const campaignId = String(row.campaign_id || row.campaign?.id || '');
                const campaignName = row.campaign?.name || '';
                if (adId && campaignId) {
                    catalog[adId] = { campaign_id: campaignId, campaign_name: campaignName, account_id: accId };
                }
            });
        } catch (e) {
            console.error(`Ad catalog Error (${accId}):`, e);
        }
        return catalog;
    }

    /**
     * Fetch Meta Ads with ALL required metrics:
     * spend, purchases, conversion_value, messages, comments,
     * impressions, reach (for CPM, frequency, ROAS calculation)
     */
    static async fetchMetaAds(fromDate: string, toDate: string) {
        const cfg = this.loadConfig();
        const { access_token, ad_account_ids } = cfg.meta_ads;
        const allAds: any[] = [];
        const allCatalog: Record<string, { campaign_id: string; campaign_name: string; account_id: string }> = {};
        const metaErrors: string[] = [];
        const timeRange = `&time_range=${encodeURIComponent(JSON.stringify({ since: fromDate, until: toDate }))}`;

        // Fields to request from Meta API
        const fields = [
            "campaign_name", "campaign_id", "ad_id", "adset_name",
            "spend", "impressions", "reach",
            "actions", "action_values",
            "cost_per_action_type"
        ].join(",");
        await Promise.all(ad_account_ids.map(async (accId) => {
            try {
                const url = `https://graph.facebook.com/v21.0/${accId}/insights?fields=${fields}&level=ad&limit=500${timeRange}&access_token=${access_token}`;

                // Fetch insights + campaign statuses in parallel (removed catalog - unused)
                const campaignStatusUrl = `https://graph.facebook.com/v21.0/${accId}/campaigns?fields=id,effective_status&limit=500&access_token=${access_token}`;
                const [rows, campaignRows] = await Promise.all([
                    this.fetchAllPages(url),
                    this.fetchAllPages(campaignStatusUrl),
                ]);
                if (rows.length === 0) {
                    metaErrors.push(`${accId}: 0 ads`);
                }

                // Build campaign_id → effective_status map
                const statusMap: Record<string, string> = {};
                campaignRows.forEach((c: any) => { statusMap[c.id] = c.effective_status || 'UNKNOWN'; });

                rows.forEach((row: any) => {
                    const actions = row.actions || [];
                    const actionValues = row.action_values || [];
                    const costPerAction = row.cost_per_action_type || [];

                    // ── Extract action metrics ──
                    const getAction = (types: string[]): number => {
                        for (const t of types) {
                            const found = actions.find((a: any) => a.action_type === t);
                            if (found) return parseInt(found.value || "0");
                        }
                        return 0;
                    };

                    const getActionValue = (types: string[]): number => {
                        for (const t of types) {
                            const found = actionValues.find((a: any) => a.action_type === t);
                            if (found) return parseFloat(found.value || "0");
                        }
                        return 0;
                    };

                    // Messages (first reply or conversation started)
                    const messages = getAction([
                        "onsite_conversion.messaging_first_reply",
                        "onsite_conversion.messaging_conversation_started_7d"
                    ]);

                    // Purchases (offsite conversions)
                    const purchases = getAction([
                        "offsite_conversion.fb_pixel_purchase",
                        "purchase",
                        "omni_purchase"
                    ]);

                    // Conversion value (revenue from purchases)
                    const conversionValue = getActionValue([
                        "offsite_conversion.fb_pixel_purchase",
                        "purchase",
                        "omni_purchase"
                    ]);

                    // Comments on post
                    const comments = getAction([
                        "comment",
                        "post_comment"
                    ]);

                    // Spend is already in VND (all accounts are VND)
                    const spend = parseFloat(row.spend || "0");
                    const impressions = parseInt(row.impressions || "0");
                    const reach = parseInt(row.reach || "0");

                    // CPM = (spend / impressions) * 1000
                    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;

                    // Frequency = impressions / reach
                    const frequency = reach > 0 ? impressions / reach : 0;

                    // Cost per purchase
                    const costPerPurchase = purchases > 0 ? spend / purchases : 0;

                    // Cost per message
                    const costPerMessage = messages > 0 ? spend / messages : 0;

                    // ROAS = conversion_value / spend
                    const roas = spend > 0 ? conversionValue / spend : 0;

                    allAds.push({
                        account_id: accId,
                        campaign_id: row.campaign_id,
                        campaign_name: row.campaign_name,
                        ad_id: row.ad_id,
                        adset_name: row.adset_name || "",
                        effective_status: statusMap[row.campaign_id] || "UNKNOWN",
                        // Raw metrics from Meta
                        spend,           // Already VND
                        impressions,
                        reach,
                        messages,
                        purchases,
                        conversion_value: conversionValue,
                        comments,
                        // Calculated metrics
                        cpm,
                        frequency: parseFloat(frequency.toFixed(2)),
                        cost_per_purchase: costPerPurchase,
                        cost_per_message: costPerMessage,
                        roas: parseFloat(roas.toFixed(2)),
                        // Legacy fields (for POS matching — will be updated later)
                        orders: 0,
                        revenue_vnd: 0
                    });
                });
            } catch (e: any) {
                const msg = `${accId}: ${e?.message || e}`;
                console.error(`Meta Ads Error: ${msg}`);
                metaErrors.push(msg);
            }
        }));
        return { ads: allAds, errors: metaErrors };
    }

    // VN timezone offset — team manages from Vietnam, POS web shows VN time
    private static VN_TZ_OFFSET = 7; // UTC+7

    static async fetchPOSHybrid(fromDate: string, toDate: string): Promise<TAlphaOrder[]> {
        const cfg = this.loadConfig();

        // ═══ FETCH ALL 8 SHOPS IN PARALLEL (saves ~10s) ═══
        const shopResults = await Promise.all(cfg.poscake.shops.map(async (shop) => {
            const shopOrders: TAlphaOrder[] = [];
            const currency =
                shop.name === "UAE" ? "AED" :
                shop.name === "Saudi" ? "SAR" :
                shop.name === "Kuwait" ? "KWD" :
                shop.name === "Oman" ? "OMR" :
                shop.name === "Qatar" ? "QAR" :
                shop.name === "Bahrain" ? "BHD" :
                shop.name === "Japan" ? "JPY" :
                shop.name === "Taiwan" ? "TWD" : "AED";
            const rate = this.getExchangeRate(currency);
            const isZeroDecimal = currency === "JPY";
            const tzOffset = this.VN_TZ_OFFSET; // UTC+7 — matches POS display for VN team

            let currentPage = 1;
            let totalPages = 1;
            let consecutiveOldOrders = 0;
            let pageErrors = 0;

            while (currentPage <= totalPages && consecutiveOldOrders < 20 && pageErrors < 3) {
                try {
                    const url = `${shop.api_url}/shops/${shop.shop_id}/orders?api_key=${shop.api_key}&page_number=${currentPage}`;
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 30000);
                    const res = await fetch(url, { signal: controller.signal });
                    clearTimeout(timeout);
                    const data = await res.json();
                    totalPages = data.total_pages || 1;

                    const pageOrders = data.data || [];
                    if (pageOrders.length === 0) break;

                    for (const o of pageOrders) {
                        const rawInserted = String(o.inserted_at || '');
                        if (!rawInserted) continue;
                        const utcMs = new Date(rawInserted + 'Z').getTime();
                        const localMs = utcMs + tzOffset * 60 * 60 * 1000;
                        const local = new Date(localMs);
                        const orderDate = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;

                        if (orderDate < fromDate) {
                            consecutiveOldOrders++;
                        } else {
                            consecutiveOldOrders = 0; // Reset counter when we see a non-old order
                        }

                        if (orderDate >= fromDate && orderDate <= toDate) {
                            const rawCod = o.cod || o.total_price || 0;
                            const priceLocal = isZeroDecimal ? rawCod : rawCod / 100;
                            shopOrders.push({
                                id: String(o.id),
                                shop_name: shop.name,
                                ad_id: o.ad_id,
                                page_id: o.page_id ? String(o.page_id) : null,
                                marketer: o.marketer?.name || o.marketer || "N/A",
                                total_price_local: priceLocal,
                                total_price_vnd: priceLocal * rate,
                                status: o.status,
                                inserted_at: o.inserted_at,
                                customer_name: o.shipping_address?.full_name || o.customer_name?.name || o.customer_name || "N/A"
                            });
                        }
                    }
                } catch (e: any) {
                    pageErrors++;
                    console.error(`POS page error (${shop.name} p${currentPage}):`, e.message?.substring(0, 60) || e);
                }
                currentPage++;
                if (currentPage > 200) break;
            }
            console.log(`[POS] ${shop.name}: ${shopOrders.length} orders (scanned ${currentPage - 1} pages, tz=UTC+7)`);
            return shopOrders;
        }));

        return shopResults.flat();
    }

    // Map campaign name prefix to POS shop name
    private static MARKET_MAP: Record<string, string> = {
        "JAPAN": "Japan", "TAIWAN": "Taiwan",
        "SAUDI": "Saudi", "UAE": "UAE", "KUWAIT": "Kuwait",
        "OMAN": "Oman", "QATAR": "Qatar", "BAHRAIN": "Bahrain",
    };

    private static getCampaignMarket(campaignName: string): string | null {
        const prefix = (campaignName || "").split("/")[0]?.toUpperCase().trim();
        return this.MARKET_MAP[prefix] || null;
    }

    // Normalize tên để so sánh: bỏ dấu, lowercase, bỏ khoảng trắng thừa
    private static normalizeName(name: string): string {
        return (name || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/gi, 'd')
            .toLowerCase().trim();
    }

    static async resolveUnmatchedAds(adIds: string[], token: string): Promise<Map<string, { campaign_id: string; campaign_name: string; account_id: string }>> {
        const resolvedMap = new Map<string, { campaign_id: string; campaign_name: string; account_id: string }>();
        const toFetch: string[] = [];

        // Check cache first
        for (const adId of adIds) {
            if (!adId) continue;
            const cached = adLookupCache.get(adId);
            if (cached) {
                resolvedMap.set(adId, cached);
            } else {
                toFetch.push(adId);
            }
        }

        if (toFetch.length === 0) {
            return resolvedMap;
        }

        console.log(`[Meta Lookup] Querying Facebook Graph API for ${toFetch.length} unknown ad_ids...`);

        // Batch query in chunks of 50
        const CHUNK_SIZE = 50;
        for (let i = 0; i < toFetch.length; i += CHUNK_SIZE) {
            const chunk = toFetch.slice(i, i + CHUNK_SIZE);
            const batchPayload = chunk.map(id => ({
                method: "GET",
                relative_url: `${id}?fields=campaign{id,name},account_id`
            }));

            try {
                const res = await fetch(`https://graph.facebook.com/v21.0/`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        access_token: token,
                        batch: JSON.stringify(batchPayload)
                    })
                });
                const responseData: any = await res.json();

                if (Array.isArray(responseData)) {
                    responseData.forEach((item: any, idx: number) => {
                        const originalAdId = chunk[idx];
                        if (item.code === 200 && item.body) {
                            try {
                                const parsed = JSON.parse(item.body);
                                const campaignId = parsed.campaign?.id || parsed.campaign_id;
                                const campaignName = parsed.campaign?.name || "";
                                const accountId = parsed.account_id ? (String(parsed.account_id).startsWith("act_") ? String(parsed.account_id) : `act_${parsed.account_id}`) : "";

                                if (campaignId && originalAdId) {
                                    const resolvedVal = {
                                        campaign_id: String(campaignId),
                                        campaign_name: String(campaignName),
                                        account_id: String(accountId)
                                    };
                                    adLookupCache.set(originalAdId, resolvedVal);
                                    resolvedMap.set(originalAdId, resolvedVal);
                                    console.log(`[Meta Lookup] Resolved ad_id=${originalAdId} → camp_id=${campaignId} name=${campaignName}`);
                                }
                            } catch (e) {
                                console.error(`Error parsing batch response for ${originalAdId}:`, e);
                            }
                        } else {
                            console.warn(`[Meta Lookup] Failed to resolve ad_id=${originalAdId}:`, item.body || item);
                        }
                    });
                } else {
                    console.error("[Meta Lookup] Unexpected batch response format:", responseData);
                }
            } catch (err) {
                console.error("[Meta Lookup] Batch Graph API error:", err);
            }
        }

        return resolvedMap;
    }

    static aggregate(ads: any[], orders: TAlphaOrder[], adLookupMap?: Map<string, { campaign_id: string; campaign_name: string; account_id: string }>) {
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
        const getAccountName = (id: string) => ACCOUNT_NAMES[id] || id;

        // Maps to find active ads and campaign groupings
        const campaignMap = new Map<string, any>();
        const adIdToCampaignIdMap = new Map<string, string>();
        const matchedOrderIds = new Set<string>();

        // Pass 1: Build the Campaign and Ad structure from active ads
        ads.forEach(ad => {
            const campaignId = String(ad.campaign_id);
            if (ad.ad_id) {
                adIdToCampaignIdMap.set(String(ad.ad_id), campaignId);
            }

            if (!campaignMap.has(campaignId)) {
                campaignMap.set(campaignId, {
                    account_id: ad.account_id,
                    account_name: getAccountName(ad.account_id),
                    campaign_id: campaignId,
                    campaign_name: ad.campaign_name,
                    spend_vnd: 0,
                    impressions: 0,
                    cpm_vnd: 0,
                    ctr: 0,
                    messages: 0,
                    purchases: 0,
                    orders: 0,
                    revenue_vnd: 0,
                    bot_orders: 0,
                    bot_revenue_vnd: 0,
                    roas: 0,
                    ads_count: 0,
                    ads: []
                });
            }

            const campaign = campaignMap.get(campaignId)!;
            campaign.spend_vnd += ad.spend || 0;
            campaign.impressions += ad.impressions || 0;
            campaign.messages += ad.messages || 0;
            campaign.purchases += ad.purchases || 0;
            campaign.ads_count += 1;

            // Extract link clicks if any to compute CTR/CPC
            const clicks = ad.clicks || ad.actions?.find((a: any) => a.action_type === 'link_click')?.value || 0;
            const cpmVal = ad.impressions > 0 ? (ad.spend / ad.impressions) * 1000 : 0;
            const cpcVal = clicks > 0 ? ad.spend / clicks : 0;
            const ctrVal = ad.impressions > 0 ? (clicks / ad.impressions) * 100 : 0;

            campaign.ads.push({
                ad_id: String(ad.ad_id),
                ad_name: ad.adset_name || ad.ad_id || "Ad Details", // Fallback to adset_name as display name
                adset_name: ad.adset_name || "",
                spend_vnd: ad.spend || 0,
                impressions: ad.impressions || 0,
                cpm_vnd: cpmVal,
                cpc_vnd: cpcVal,
                ctr: ctrVal,
                messages: ad.messages || 0,
                purchases: ad.purchases || 0,
                orders: 0,
                revenue_vnd: 0,
                roas: ad.spend > 0 ? (ad.conversion_value / ad.spend) : 0
            });
        });

        // Pass 2: Direct Active ad_id Match
        orders.forEach(order => {
            const adId = order.ad_id ? String(order.ad_id).trim() : null;
            if (!adId) return;

            if (adIdToCampaignIdMap.has(adId)) {
                const campaignId = adIdToCampaignIdMap.get(adId)!;
                const campaign = campaignMap.get(campaignId)!;
                campaign.orders += 1;
                campaign.revenue_vnd += order.total_price_vnd;

                // Update inside campaign.ads
                const adDetail = campaign.ads.find((ad: any) => ad.ad_id === adId);
                if (adDetail) {
                    adDetail.orders += 1;
                    adDetail.revenue_vnd += order.total_price_vnd;
                }

                matchedOrderIds.add(order.id);
            }
        });

        // Pass 3: Inactive ad_id lookup match (incorporating resolved inactive ads)
        if (adLookupMap) {
            orders.forEach(order => {
                if (matchedOrderIds.has(order.id)) return;

                const adId = order.ad_id ? String(order.ad_id).trim() : null;
                if (!adId) return;

                if (adLookupMap.has(adId)) {
                    const lookup = adLookupMap.get(adId)!;
                    const campaignId = lookup.campaign_id;

                    if (!campaignMap.has(campaignId)) {
                        campaignMap.set(campaignId, {
                            account_id: lookup.account_id,
                            account_name: getAccountName(lookup.account_id),
                            campaign_id: campaignId,
                            campaign_name: lookup.campaign_name,
                            spend_vnd: 0,
                            impressions: 0,
                            cpm_vnd: 0,
                            ctr: 0,
                            messages: 0,
                            purchases: 0,
                            orders: 0,
                            revenue_vnd: 0,
                            bot_orders: 0,
                            bot_revenue_vnd: 0,
                            roas: 0,
                            ads_count: 0,
                            ads: []
                        });
                    }

                    const campaign = campaignMap.get(campaignId)!;
                    campaign.orders += 1;
                    campaign.revenue_vnd += order.total_price_vnd;

                    // Add a placeholder ad detail if it doesn't exist
                    let adDetail = campaign.ads.find((ad: any) => ad.ad_id === adId);
                    if (!adDetail) {
                        adDetail = {
                            ad_id: adId,
                            ad_name: `Inactive Ad (${adId})`,
                            adset_name: "Inactive Adset",
                            spend_vnd: 0,
                            impressions: 0,
                            cpm_vnd: 0,
                            cpc_vnd: 0,
                            ctr: 0,
                            messages: 0,
                            purchases: 0,
                            orders: 0,
                            revenue_vnd: 0,
                            roas: 0
                        };
                        campaign.ads.push(adDetail);
                        campaign.ads_count += 1;
                    }
                    adDetail.orders += 1;
                    adDetail.revenue_vnd += order.total_price_vnd;

                    matchedOrderIds.add(order.id);
                }
            });
        }

        // Pass 4: Bot-shot/No ad_id Match (Direct Page ID matching: order.page_id === campaignInfo.pageId)
        orders.forEach(order => {
            if (matchedOrderIds.has(order.id)) return;

            const pageId = order.page_id ? String(order.page_id).trim() : null;
            if (!pageId) return;

            // Find all candidate campaigns matching this pageId
            const candidates: any[] = [];
            campaignMap.forEach(campaign => {
                const info = this.parseCampaign(campaign.campaign_name);
                if (info.pageId === pageId) {
                    candidates.push(campaign);
                }
            });

            if (candidates.length > 0) {
                // Prioritize by spend descending, then by campaigns with active ads
                candidates.sort((a, b) => {
                    if (a.spend_vnd !== b.spend_vnd) {
                        return b.spend_vnd - a.spend_vnd;
                    }
                    return b.ads_count - a.ads_count;
                });

                const campaign = candidates[0];
                campaign.bot_orders += 1;
                campaign.bot_revenue_vnd += order.total_price_vnd;
                matchedOrderIds.add(order.id);
            }
        });

        // Compute campaign-level dynamic properties and format
        const finalCampaigns = Array.from(campaignMap.values()).map(campaign => {
            // Recalculate campaign level CTR and CPM
            let totalClicks = 0;
            campaign.ads.forEach((ad: any) => {
                // Estimate clicks based on CTR/impressions
                totalClicks += Math.round((ad.ctr * ad.impressions) / 100);
            });

            campaign.ctr = campaign.impressions > 0 ? (totalClicks / campaign.impressions) * 100 : 0;
            campaign.cpm_vnd = campaign.impressions > 0 ? (campaign.spend_vnd / campaign.impressions) * 1000 : 0;
            campaign.roas = campaign.spend_vnd > 0 ? (campaign.revenue_vnd + campaign.bot_revenue_vnd) / campaign.spend_vnd : 0;

            return campaign;
        });

        // ═══ MERGE: Gộp campaigns trùng pageId + product ═══
        // Ví dụ: "SAUDI/N.THE/kem chống lão hóa đen/1101143709738580/Luxe Glow Skin KSA/15-4/"
        //    và: "SAUDI/N.THE/kem chống lão hóa đen/1101143709738580/Luxe Glow Skin KSA/15-4"
        // có 2 campaign_id khác nhau nhưng cùng sản phẩm → gộp lại thành 1 dòng
        const mergeKey = (c: any) => {
            const info = this.parseCampaign(c.campaign_name);
            // Normalize: bỏ trailing slash, lowercase product
            const product = this.normalizeName(info.product);
            const pageId = (info.pageId || '').trim();
            if (!pageId) return c.campaign_id; // No pageId → unique key = campaign_id
            return `${info.country}/${info.marketer}/${product}/${pageId}`;
        };

        const mergedMap = new Map<string, any>();
        for (const c of finalCampaigns) {
            const key = mergeKey(c);
            if (mergedMap.has(key)) {
                const primary = mergedMap.get(key)!;
                // Keep the campaign with highest spend as primary
                if (c.spend_vnd > primary.spend_vnd) {
                    // Current campaign has more spend → it becomes primary, absorb the old primary
                    c.orders += primary.orders;
                    c.revenue_vnd += primary.revenue_vnd;
                    c.bot_orders += primary.bot_orders;
                    c.bot_revenue_vnd += primary.bot_revenue_vnd;
                    c.ads = [...c.ads, ...primary.ads];
                    c.ads_count += primary.ads_count;
                    // Recalculate ROAS with merged data
                    c.roas = c.spend_vnd > 0 ? (c.revenue_vnd + c.bot_revenue_vnd) / c.spend_vnd : 0;
                    mergedMap.set(key, c);
                    console.log(`[MERGE] ${c.campaign_name} (spend=${c.spend_vnd}) absorbed ${primary.campaign_name} (+${primary.orders} orders, +${primary.bot_orders} bot)`);
                } else {
                    // Primary has more spend → absorb current campaign into primary
                    primary.orders += c.orders;
                    primary.revenue_vnd += c.revenue_vnd;
                    primary.bot_orders += c.bot_orders;
                    primary.bot_revenue_vnd += c.bot_revenue_vnd;
                    primary.ads = [...primary.ads, ...c.ads];
                    primary.ads_count += c.ads_count;
                    // Recalculate ROAS with merged data
                    primary.roas = primary.spend_vnd > 0 ? (primary.revenue_vnd + primary.bot_revenue_vnd) / primary.spend_vnd : 0;
                    console.log(`[MERGE] ${primary.campaign_name} (spend=${primary.spend_vnd}) absorbed ${c.campaign_name} (+${c.orders} orders, +${c.bot_orders} bot)`);
                }
            } else {
                mergedMap.set(key, c);
            }
        }
        const mergedCampaigns = Array.from(mergedMap.values());

        // Summary Calculations (use mergedCampaigns — đã gộp trùng)
        const totalSpend = mergedCampaigns.reduce((s, c) => s + c.spend_vnd, 0);
        const totalImpressions = mergedCampaigns.reduce((s, c) => s + c.impressions, 0);
        const totalReach = ads.reduce((s, a) => s + (a.reach || 0), 0); // Keep reach sum from active raw ads
        const totalMessages = mergedCampaigns.reduce((s, c) => s + c.messages, 0);
        const totalPurchases = mergedCampaigns.reduce((s, c) => s + c.purchases, 0);
        const totalComments = ads.reduce((s, a) => s + (a.comments || 0), 0); // Keep comments sum from active raw ads

        const directMatchedOrdersCount = orders.filter(o => matchedOrderIds.has(o.id) && o.ad_id).length;
        const directMatchedRevenue = orders.filter(o => matchedOrderIds.has(o.id) && o.ad_id).reduce((s, o) => s + o.total_price_vnd, 0);

        const botOrdersCount = mergedCampaigns.reduce((s, c) => s + c.bot_orders, 0);
        const botRevenue = mergedCampaigns.reduce((s, c) => s + c.bot_revenue_vnd, 0);

        const unmatchedOrders = orders.filter(o => !matchedOrderIds.has(o.id));
        const unmatchedOrdersCount = unmatchedOrders.length;
        const unmatchedRevenue = unmatchedOrders.reduce((s, o) => s + o.total_price_vnd, 0);

        const totalPOSOrders = orders.length;
        const totalPOSRevenue = orders.reduce((s, o) => s + o.total_price_vnd, 0);

        const accountsFetched = new Set(ads.map(a => a.account_id)).size;
        const shopsFetched = new Set(orders.map(o => o.shop_name)).size;

        const unmatched_by_shop: Record<string, { count: number; revenue_vnd: number }> = {};
        unmatchedOrders.forEach(o => {
            if (!unmatched_by_shop[o.shop_name]) {
                unmatched_by_shop[o.shop_name] = { count: 0, revenue_vnd: 0 };
            }
            unmatched_by_shop[o.shop_name].count += 1;
            unmatched_by_shop[o.shop_name].revenue_vnd += o.total_price_vnd;
        });

        const summary = {
            total_spend_vnd: totalSpend,
            total_revenue_vnd: totalPOSRevenue,
            total_orders: totalPOSOrders,
            total_messages: totalMessages,
            matched_orders: directMatchedOrdersCount,
            matched_revenue_vnd: directMatchedRevenue,
            bot_orders: botOrdersCount,
            bot_revenue_vnd: botRevenue,
            unmatched_orders: unmatchedOrdersCount,
            unmatched_revenue_vnd: unmatchedRevenue,
            total_pos_orders: totalPOSOrders,
            total_meta_purchases: totalPurchases,
            blended_roas: totalSpend > 0 ? totalPOSRevenue / totalSpend : 0,
            accounts_fetched: accountsFetched,
            shops_fetched: shopsFetched
        };

        // Output matching summary to console
        console.log(`[POS] Strict Match (ad_id → insights): ${directMatchedOrdersCount}/${orders.length} orders matched`);
        if (unmatchedOrders.length > 0) {
            console.log(`[POS] ${unmatchedOrders.length} orders unmatched — revenue: ${unmatchedRevenue.toLocaleString()}đ`);
            unmatchedOrders.forEach(o => {
                console.log(`  [UNMATCHED] id=${o.id} shop=${o.shop_name} ad_id=${o.ad_id || 'null'} page_id=${o.page_id || 'null'} marketer=${o.marketer}`);
            });
        }
        console.log(`[POS] Attribution: Matched=${directMatchedOrdersCount + botOrdersCount} Unmatched=${unmatchedOrdersCount} Total=${orders.length}`);

        return {
            campaigns: mergedCampaigns,
            summary,
            unmatched_orders: unmatchedOrders,
            unmatched_by_shop,
            // Backwards compatibility keys
            ads,
            orders,
            total_spend: totalSpend,
            total_impressions: totalImpressions,
            total_reach: totalReach,
            total_messages: totalMessages,
            total_purchases: totalPurchases,
            total_conversion_value: totalPurchases * 350000,
            total_comments: totalComments,
            total_cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
            total_frequency: totalReach > 0 ? totalImpressions / totalReach : 0,
            total_roas: totalSpend > 0 ? totalPurchases * 350000 / totalSpend : 0,
            total_cost_per_purchase: totalPurchases > 0 ? totalSpend / totalPurchases : 0,
            total_cost_per_message: totalMessages > 0 ? totalSpend / totalMessages : 0,
            pos_orders: totalPOSOrders,
            pos_revenue: totalPOSRevenue,
            pos_roas: totalSpend > 0 ? totalPOSRevenue / totalSpend : 0
        };
    }

    static removeDiacritics(str: string) {
        return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd');
    }

    static parseCampaign(campaignName: string) {
        const parts = (campaignName || "").split("/").map(s => s.trim());
        const lastPart = parts[parts.length - 1]?.toUpperCase();
        return {
            country: (parts[0] || "").toUpperCase(),
            marketer: this.removeDiacritics((parts[1] || "").toUpperCase()),
            marketerDisplay: parts[1] || "",
            product: parts[2] || "",
            pageId: parts[3] || "",
            pageName: parts[4] || "",
            isTest: lastPart === "TEST",
        };
    }

    static aggregateByMktMarket(ads: any[], orders: any[]) {
        const map: Record<string, {
            marketer: string;
            market: string;
            spend: number;
            messages: number;
            purchases: number;
            conversion_value: number;
            pos_orders: number;
            pos_revenue: number;
        }> = {};

        // 1. Group by Ads
        ads.forEach(ad => {
            const info = this.parseCampaign(ad.campaign_name);
            const mkt = info.marketerDisplay || 'N/A';
            const market = info.country || 'N/A';
            const key = `${this.removeDiacritics(mkt.toUpperCase())}__${market}`;

            if (!map[key]) {
                map[key] = { marketer: mkt, market, spend: 0, messages: 0, purchases: 0, conversion_value: 0, pos_orders: 0, pos_revenue: 0 };
            }
            const r = map[key];
            r.spend += ad.spend || 0;
            r.messages += ad.messages || 0;
            r.purchases += ad.purchases || 0;
            r.conversion_value += ad.conversion_value || 0;
            
            // Note: ad.orders and ad.revenue_vnd are already mapped per-ad in TAlphaAdsModel.fetchMetaAds
            r.pos_orders += ad.orders || 0;
            r.pos_revenue += ad.revenue_vnd || 0;
        });

        return Object.values(map).sort((a, b) => b.spend - a.spend);
    }
}
