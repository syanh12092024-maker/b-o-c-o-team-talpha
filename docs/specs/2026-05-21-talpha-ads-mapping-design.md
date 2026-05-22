# Technical Design: TAlpha Inactive Campaign Matching & Bot-Shot Attribution V5.2 (Revised)

This document details the system design for refactoring the real-time Meta Ads and POS order mapping system for the TAlpha dashboard.

## 1. Goals
1. **Historical/Inactive ad_id Matching**: Resolve POS orders with an ad_id that is currently inactive (spend = 0) by querying Meta Graph API via highly efficient batch calls (reducing API calls by 100x) and injecting campaign placeholders.
2. **Product-Specific Bot-Shot Attribution**: Attribute POS orders without ad_id to campaign-specific rows using a direct Page ID match (`order.page_id === campaignInfo.pageId`), eliminating the legacy virtual `[BOT-SHOT]` bucket.
3. **UI Column Integration**: Add a dedicated `Đơn bắn bot` count and revenue column to the campaigns table and header metrics.

## 2. Technical Specifications & Algorithms

### A. API Layer (Optimized Graph API Lookup)
File: `dashboard-ui/src/app/api/talpha/realtime/route.ts`

1. **Identify Unmatched ad_ids**:
   - Filter POS orders where `order.ad_id` is present, but does not exist in today's active insights `ads` array.
2. **Batch Graph API Queries with Cache**:
   - Group the unmatched `ad_id`s into batches of up to **50 items**.
   - Make a POST request to `https://graph.facebook.com/v21.0/` using the `batch` parameter.
   - Use field expansion: `fields=name,campaign{id,name},account_id` to query both ad and campaign details in a single request.
   - Cache results in `adLookupCache` for **24 hours** to prevent redundant lookups.
   - Wrap in standard `try-catch` blocks and fall back gracefully to Pass 2 mapping if the API fails.

### B. Aggregation Layer (3-Pass Attribution Model)
File: `dashboard-ui/src/lib/bigquery/models/talpha-ads.model.ts`

We will implement a robust 3-pass matching strategy in `TAlphaAdsModel.aggregate`:

* **Pass 1: Direct Active ad_id Match**
  - Match POS orders with `ad_id`s in today's active ads list. Record in `orders` and `revenue_vnd`.
* **Pass 1.5: Inactive ad_id Match (via Batch Graph API lookup fallback)**
  - If a POS order's `ad_id` is not in active ads but is resolved in `adLookupMap`:
    - Find or inject a placeholder campaign with `spend = 0`, `impressions = 0`, etc.
    - Attribute `orders` and `revenue_vnd` to this campaign.
* **Pass 2: Bot-shot/No ad_id Match (Direct Page ID Match)**
  - For orders without `ad_id` (or unresolved `ad_id`s), find candidate campaigns where:
    `order.page_id && campaignInfo.pageId && order.page_id === campaignInfo.pageId`
  - If multiple campaigns today use the same Page ID, attribute to the one with active spend or simply the first match.
  - Increment `bot_orders` and `bot_revenue_vnd` in that campaign row.
* **Pass 3: Unmatched Orders**:
  - Keep truly unmatched orders in `unmatched_orders` and group them by shop in `unmatched_by_shop`.

### C. UI Presentation Layer
File: `dashboard-ui/src/app/talpha/ads-command-center/page.tsx`

1. **Header Cards**: Update the `Đơn POS` and `Doanh thu` card metrics to display Direct, Bot, and Unmatched splits.
2. **Table Headers**: Add `🤖 BOT` next to `📦 POS` in the campaigns table.
3. **Table Rows**: Render `c.bot_orders` and `formatVNDCompact(c.bot_revenue_vnd)`.
4. **Totals calculation**: Calculate blended campaign and top-level ROAS as `(revenue_vnd + bot_revenue_vnd) / spend_vnd`.
