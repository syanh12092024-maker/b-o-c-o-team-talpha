import { TAlphaAdsModel, TAlphaOrder } from "../src/lib/bigquery/models/talpha-ads.model";

// 1. Mock ads array
const mockAds = [
  {
    ad_id: "ad_123",
    campaign_id: "camp_A",
    campaign_name: "UAE/Marketer1/Prod1/Page1/Test",
    spend: 100,
    impressions: 1000,
    reach: 500,
    messages: 10,
    purchases: 2,
    conversion_value: 500,
    comments: 1,
    cpm: 100,
    frequency: 2,
    cost_per_purchase: 50,
    cost_per_message: 10,
    roas: 5,
    orders: 0,
    revenue_vnd: 0
  },
  {
    ad_id: "ad_456",
    campaign_id: "camp_B",
    campaign_name: "Saudi/Marketer2/Prod2/Page2/Live",
    spend: 200,
    impressions: 2000,
    reach: 1000,
    messages: 20,
    purchases: 4,
    conversion_value: 1200,
    comments: 2,
    cpm: 100,
    frequency: 2,
    cost_per_purchase: 50,
    cost_per_message: 10,
    roas: 6,
    orders: 0,
    revenue_vnd: 0
  }
];

// 2. Mock orders array
const mockOrders: TAlphaOrder[] = [
  // Case 1: Direct ad_id match
  {
    id: "ord_1",
    shop_name: "UAE",
    ad_id: "ad_123",
    page_id: "Page1",
    marketer: "Marketer1",
    total_price_local: 50,
    total_price_vnd: 350000,
    status: "success",
    inserted_at: "2026-05-21T10:00:00",
    customer_name: "John Doe"
  },
  // Case 2: Direct ad_id match
  {
    id: "ord_2",
    shop_name: "Saudi",
    ad_id: "ad_456",
    page_id: "Page2",
    marketer: "Marketer2",
    total_price_local: 100,
    total_price_vnd: 700000,
    status: "success",
    inserted_at: "2026-05-21T10:00:00",
    customer_name: "Jane Smith"
  },
  // Case 3: ad_id not in ads today, but in adLookupMap (paused/blocked ad). 
  // Under the new Strict Direct Match logic, this MUST remain UNMATCHED.
  {
    id: "ord_3",
    shop_name: "UAE",
    ad_id: "ad_789", // not in mockAds
    page_id: "Page1",
    marketer: "Marketer1",
    total_price_local: 50,
    total_price_vnd: 350000,
    status: "success",
    inserted_at: "2026-05-21T10:00:00",
    customer_name: "Bob Johnson"
  },
  // Case 4: No ad_id, but page_id matches mockAds campaign pageId (legacy Pass 3 fallback).
  // Under the new Strict Direct Match logic, this MUST remain UNMATCHED.
  {
    id: "ord_4",
    shop_name: "UAE",
    ad_id: null,
    page_id: "Page1", // matches UAE/Marketer1/Prod1/Page1/Test
    marketer: "Marketer1",
    total_price_local: 60,
    total_price_vnd: 420000,
    status: "success",
    inserted_at: "2026-05-21T10:00:00",
    customer_name: "Alice Brown"
  }
];

// 3. Mock adLookupMap
const mockAdLookupMap = new Map<string, { campaign_id: string; campaign_name: string; account_id: string }>();
mockAdLookupMap.set("ad_789", {
  campaign_id: "camp_C",
  campaign_name: "UAE/Marketer1/Prod1/Page1/Blocked",
  account_id: "act_111"
});

// Run aggregation
console.log("Running TAlphaAdsModel.aggregate with test cases...");
const result = TAlphaAdsModel.aggregate(JSON.parse(JSON.stringify(mockAds)), mockOrders, mockAdLookupMap);

// Assertions
let failed = false;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    failed = true;
  } else {
    console.log(`✅ ${message}`);
  }
}

// 1. Direct matches should succeed
const ad1 = result.ads.find(a => a.ad_id === "ad_123");
assert(ad1 !== undefined, "ad_123 should exist in output ads");
assert(ad1?.orders === 1, `ad_123 should have exactly 1 order, got ${ad1?.orders}`);
assert(ad1?.revenue_vnd === 350000, `ad_123 revenue should be 350000, got ${ad1?.revenue_vnd}`);

const ad2 = result.ads.find(a => a.ad_id === "ad_456");
assert(ad2 !== undefined, "ad_456 should exist in output ads");
assert(ad2?.orders === 1, `ad_456 should have exactly 1 order, got ${ad2?.orders}`);
assert(ad2?.revenue_vnd === 700000, `ad_456 revenue should be 700000, got ${ad2?.revenue_vnd}`);

// 2. Blocked ad (ad_789) should NOT be matched and no virtual campaign should be created in result.ads
const ad3 = result.ads.find(a => a.ad_id === "ad_789" || a.campaign_id === "camp_C");
assert(ad3 === undefined, "Blocked ad_789 / campaign camp_C should NOT be added to ads");

// 3. Page ID fallback (ord_4) should NOT be matched
// If matched, ad1 would have orders = 2 and revenue = 350000 + 420000 = 770000.
// Under strict matching, ord_4 is unmatched, so ad1 stays at orders = 1 and revenue = 350000.
assert(ad1?.orders === 1, `ad1 should NOT match page_id fallback order (ord_4), orders got: ${ad1?.orders}`);

// 4. Check total matched count vs total orders
// Total POS orders = 4. Only ord_1 and ord_2 should match. So matched = 2, unmatched = 2.
const totalAdsOrders = result.ads.reduce((sum, a) => sum + a.orders, 0);
assert(totalAdsOrders === 2, `Total matched orders in ads should be exactly 2, got ${totalAdsOrders}`);

if (failed) {
  console.error("\n❌ Test suite FAILED!");
  process.exit(1);
} else {
  console.log("\n✨ All tests PASSED successfully!");
  process.exit(0);
}
