# Strict POS Order Matching Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the POS order mapping logic in the real-time aggregation engine to a strictly defined "1-Pass Direct ad_id Match" to prevent data discrepancies and misattributions.

**Architecture:** 
- Keep matching deterministic: an order is Matched if and only if its `ad_id` directly corresponds to an active ad in today's Facebook insights (`ads` array).
- Remove the Graph API lookup (`adLookupMap`) fallback logic, page ID matching fallback (Pass 3), and marketer matching fallback (Pass 4).
- Utilize a single-pass iteration with a pre-built `ad_id` index mapping for speed and simplicity.

**Tech Stack:** TypeScript, Next.js API Route, Node.js (tsx) for verification.

---

## Proposed Changes

### Task 1: Create Unit Test Script

**Files:**
- Create: `dashboard-ui/scripts/test-aggregation.ts`

- [ ] **Step 1: Write the failing unit test**
  Write a test that mocks `ads` and `orders` data and verifies:
  1. Direct match is successful.
  2. Orders with `ad_id` not in `ads` (even if present in `adLookupMap`) are left unmatched.
  3. Orders with page_id match or marketer match are left unmatched.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx tsx scripts/test-aggregation.ts`
  Expected: FAIL (because existing legacy `aggregate` method still matches page_id, marketer, and uses `adLookupMap` to create virtual campaigns).

### Task 2: Refactor `TAlphaAdsModel.aggregate`

**Files:**
- Modify: `dashboard-ui/src/lib/bigquery/models/talpha-ads.model.ts`

- [ ] **Step 1: Refactor `aggregate` implementation**
  Rewrite the `aggregate` function to:
  1. Map existing `ads` by `ad_id` into a map `adIdMap` (ad_id -> index).
  2. Iterate through `orders` exactly once:
     - If `order.ad_id` exists in `adIdMap`, increment orders and revenue_vnd for the corresponding ad.
     - Otherwise, leave the order as unmatched.
  3. Log the matched and unmatched orders clearly.
  4. Keep the return schema fully compatible.
  5. Remove all legacy matching code (Pass 2, 3, and REVERSE_MARKET references).

- [ ] **Step 2: Run the test to verify it passes**
  Run: `npx tsx scripts/test-aggregation.ts`
  Expected: PASS

- [ ] **Step 3: Run TypeScript compiler check**
  Run: `npx tsc --noEmit`
  Expected: PASS

### Task 3: Clean up API Route

**Files:**
- Modify: `dashboard-ui/src/app/api/talpha/realtime/route.ts`

- [ ] **Step 1: Remove Graph API lookup**
  Remove the logic in both GET and POST handlers that calls the Graph API (`/{ad_id}`) to resolve unmatched `ad_id`s, as it is no longer used or needed.
  Ensure it simply calls `TAlphaAdsModel.aggregate(ads, orders)`.

- [ ] **Step 2: Run build to make sure Next.js compiles**
  Run: `npm run build` inside `dashboard-ui`
  Expected: Success

---

## Verification Plan

### Automated Tests
- Standalone test runner: `npx tsx scripts/test-aggregation.ts`
- TS compilation check: `npx tsc --noEmit`
- Production Next.js build: `npm run build`

### Manual Verification
- View console output of Next.js dev server during realtime page fetch to ensure matching statistics are correct and cleanly output.
