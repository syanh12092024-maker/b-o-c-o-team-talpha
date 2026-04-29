"""Deploy BigQuery SQL fixes for Stramark ads attribution."""
import os
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.join(
    os.path.dirname(__file__), "bigquery_key.json"
)

from google.cloud import bigquery

client = bigquery.Client(project="levelup-465304")

# Step 1: Update dim_marketer_mapping campaign_code
print("=" * 60)
print("STEP 1: Updating dim_marketer_mapping campaign_code...")
print("=" * 60)

# First, check current values
rows = client.query(
    "SELECT marketer_id, marketer_name, campaign_code FROM `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping` ORDER BY marketer_id"
).result()
print("\nCurrent dim_marketer_mapping:")
for r in rows:
    print(f"  {r.marketer_id}: {r.marketer_name} | campaign_code='{r.campaign_code}'")

updates = [
    ("LETC", "Lệ"),
    ("CHIPTL", "LC"),
    ("ANHNT", "TA"),
    ("TUKT", "TÚ"),
]

for mkter_id, code in updates:
    query = f"""
    UPDATE `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
    SET campaign_code = '{code}'
    WHERE marketer_id = '{mkter_id}'
    """
    result = client.query(query).result()
    print(f"  ✅ {mkter_id} → campaign_code = '{code}'")

# Verify
print("\nVerification:")
rows = client.query(
    "SELECT marketer_id, marketer_name, campaign_code FROM `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping` ORDER BY marketer_id"
).result()
for r in rows:
    print(f"  {r.marketer_id}: {r.marketer_name} | campaign_code='{r.campaign_code}'")

# Step 2: Deploy mart_performance_master v5
print("\n" + "=" * 60)
print("STEP 2: Deploying mart_performance_master v5...")
print("=" * 60)

sql_path = os.path.join(os.path.dirname(__file__), "sql", "fixes", "02_mart_performance_master_v5.sql")
with open(sql_path, "r", encoding="utf-8") as f:
    sql = f.read()

# Remove comment lines at the top (before CREATE)
lines = sql.split("\n")
sql_clean = "\n".join(l for l in lines if not l.strip().startswith("--"))

try:
    result = client.query(sql_clean).result()
    print("  ✅ mart_performance_master v5 deployed successfully!")
except Exception as e:
    print(f"  ❌ Error deploying mart_performance_master: {e}")

# Step 3: Quick verification — check Jan 2026 ads spend
print("\n" + "=" * 60)
print("STEP 3: Verifying Jan 2026 ads spend...")
print("=" * 60)

try:
    rows = client.query("""
        SELECT 
            FORMAT_DATE('%Y-%m', report_date) as month,
            ROUND(SUM(ads_spend_ron), 0) as ads_spend_ron,
            SUM(total_orders) as orders,
            ROUND(SUM(delivered_revenue), 0) as revenue
        FROM `levelup-465304.STRAMARK_Dataset.mart_performance_master`
        WHERE report_date BETWEEN '2026-01-01' AND '2026-03-31'
        GROUP BY 1
        ORDER BY 1
    """).result()
    print("\nMonthly ads_spend_ron after fix:")
    for r in rows:
        print(f"  {r.month}: Ads={r.ads_spend_ron:,.0f} RON | Orders={r.orders} | Revenue={r.revenue:,.0f}")
except Exception as e:
    print(f"  ❌ Verification error: {e}")

print("\n✅ Done! Refresh localhost:3003/stramark to see updated data.")
