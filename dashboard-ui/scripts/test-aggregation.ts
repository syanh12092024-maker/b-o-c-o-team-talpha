import { TAlphaAdsModel, TAlphaOrder } from "../src/lib/bigquery/models/talpha-ads.model";

// 1. Mock ads array (representing active ads with spend today)
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

// 2. Mock orders array (covering all V5.2 mapping routes)
const mockOrders: TAlphaOrder[] = [
  // Case 1: Direct active ad_id match (UAE)
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
  // Case 2: Direct active ad_id match (Saudi)
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
  // Case 3: Inactive ad_id lookup match (ad_789 is resolved via Graph API lookup)
  {
    id: "ord_3",
    shop_name: "UAE",
    ad_id: "ad_789", // not in mockAds (active today)
    page_id: "Page1",
    marketer: "Marketer1",
    total_price_local: 50,
    total_price_vnd: 350000,
    status: "success",
    inserted_at: "2026-05-21T10:00:00",
    customer_name: "Bob Johnson"
  },
  // Case 4: Chatbot/Bot-shot order (no ad_id, matches camp_A by Page ID "Page1")
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
console.log("Running TAlphaAdsModel.aggregate with V5.2 test cases...");
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

// Check structural campaigns array
assert(Array.isArray(result.campaigns), "result should return a campaigns array");
assert(result.campaigns.length === 3, `campaigns count should be exactly 3, got ${result.campaigns.length}`);

// 1. Check UAE active campaign (camp_A) direct orders and bot orders
const campA = result.campaigns.find(c => c.campaign_id === "camp_A");
assert(campA !== undefined, "UAE active campaign A should be present");
assert(campA?.orders === 1, `camp_A should have 1 direct order, got ${campA?.orders}`);
assert(campA?.bot_orders === 1, `camp_A should have 1 bot order, got ${campA?.bot_orders}`);
assert(campA?.bot_revenue_vnd === 420000, `camp_A bot revenue should be 420000, got ${campA?.bot_revenue_vnd}`);
assert(campA?.revenue_vnd === 350000, `camp_A direct revenue should be 350000, got ${campA?.revenue_vnd}`);

// 2. Check Saudi active campaign (camp_B) direct orders
const campB = result.campaigns.find(c => c.campaign_id === "camp_B");
assert(campB !== undefined, "Saudi active campaign B should be present");
assert(campB?.orders === 1, `camp_B should have 1 direct order, got ${campB?.orders}`);
assert(campB?.bot_orders === 0, `camp_B should have 0 bot orders, got ${campB?.bot_orders}`);

// 3. Check Inactive dynamic placeholder campaign (camp_C)
const campC = result.campaigns.find(c => c.campaign_id === "camp_C");
assert(campC !== undefined, "Inactive campaign C should be dynamically injected");
assert(campC?.orders === 1, `camp_C should have 1 direct order from resolved ad_789, got ${campC?.orders}`);
assert(campC?.spend_vnd === 0, `camp_C spend should be 0, got ${campC?.spend_vnd}`);
assert(campC?.revenue_vnd === 350000, `camp_C revenue should be 350000, got ${campC?.revenue_vnd}`);
assert(campC?.account_id === "act_111", `camp_C should belong to act_111, got ${campC?.account_id}`);

// 4. Summary check
assert(result.summary !== undefined, "result should return a summary object");
assert(result.summary.total_pos_orders === 4, `Summary total POS orders should be 4, got ${result.summary.total_pos_orders}`);
assert(result.summary.matched_orders === 3, `Summary matched direct orders should be 3, got ${result.summary.matched_orders}`);
assert(result.summary.bot_orders === 1, `Summary bot orders should be 1, got ${result.summary.bot_orders}`);
assert(result.summary.unmatched_orders === 0, `Summary unmatched orders should be 0, got ${result.summary.unmatched_orders}`);

if (failed) {
  console.error("\n❌ TAlpha V5.2 Test suite FAILED!");
  process.exit(1);
} else {
  console.log("\n✨ All TAlpha V5.2 tests PASSED successfully!");
  process.exit(0);
}
