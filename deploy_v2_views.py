"""Deploy updated BigQuery views for Stramark data sync fix."""
import os
import sys
import io

# Force UTF-8 output on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.join(
    os.path.dirname(__file__), "bigquery_key.json"
)

from google.cloud import bigquery

client = bigquery.Client(project="levelup-465304")

def deploy_view(label, sql_path):
    print(f"\n{'=' * 60}")
    print(f"  {label}")
    print(f"{'=' * 60}")
    if not os.path.exists(sql_path):
        print(f"  [FAIL] File not found: {sql_path}")
        return False
    with open(sql_path, "r", encoding="utf-8") as f:
        sql = f.read()
    lines = sql.split("\n")
    sql_clean = "\n".join(l for l in lines if not l.strip().startswith("--"))
    try:
        client.query(sql_clean).result()
        print(f"  [OK] Deployed successfully!")
        return True
    except Exception as e:
        print(f"  [FAIL] Error: {e}")
        return False

# Step 0: Check prerequisites
print("=" * 60)
print("  STEP 0: Checking prerequisites...")
print("=" * 60)

try:
    rows = list(client.query("""
        SELECT from_currency, to_currency, rate, effective_date
        FROM `levelup-465304.STRAMARK_Dataset.cost_exchange_rates`
        WHERE from_currency = 'USD' AND to_currency = 'RON'
        ORDER BY effective_date DESC
        LIMIT 3
    """).result())
    print(f"  [OK] cost_exchange_rates table exists ({len(rows)} USD->RON rates)")
    for r in rows:
        print(f"     {r.effective_date}: 1 USD = {r.rate} RON")
except Exception as e:
    print(f"  [WARN] cost_exchange_rates issue: {e}")
    print("  -> vw_fact_ads_performance needs this table!")

# Step 1-3: Deploy views
base_dir = os.path.dirname(__file__)

deploy_view(
    "STEP 1: mart_performance_master (suffix matching)",
    os.path.join(base_dir, "sql", "_legacy", "stramark", "03_mart_performance_master.sql")
)

deploy_view(
    "STEP 2: vw_fact_daily_pnl_v2 (+revenue_confirmed)",
    os.path.join(base_dir, "sql", "_legacy", "stramark", "06_vw_fact_daily_pnl_v2.sql")
)

deploy_view(
    "STEP 3: vw_fact_ads_performance (spend_ron + mkter_code)",
    os.path.join(base_dir, "sql", "_legacy", "views", "vw_fact_ads_performance.sql")
)

# Step 4: Verify
print(f"\n{'=' * 60}")
print("  STEP 4: Verification")
print(f"{'=' * 60}")

try:
    rows = list(client.query("""
        SELECT campaign_mkter_code,
               ROUND(SUM(spend_ron), 0) as total_spend_ron,
               COUNT(*) as ad_days
        FROM `levelup-465304.STRAMARK_Dataset.vw_fact_ads_performance`
        WHERE report_date BETWEEN '2026-01-01' AND '2026-01-31'
        GROUP BY 1
        ORDER BY total_spend_ron DESC
    """).result())
    print("\n  vw_fact_ads_performance - Jan 2026 by marketer:")
    for r in rows:
        print(f"    {r.campaign_mkter_code:12s}: {r.total_spend_ron:>10,.0f} RON ({r.ad_days} ad-days)")
except Exception as e:
    print(f"  [FAIL] Verification error: {e}")

try:
    rows = list(client.query("""
        SELECT marketer_id,
               SUM(total_orders) as orders,
               ROUND(SUM(delivered_revenue), 0) as revenue,
               ROUND(SUM(ads_spend_ron), 0) as ads_spend_ron
        FROM `levelup-465304.STRAMARK_Dataset.mart_performance_master`
        WHERE report_date BETWEEN '2026-01-01' AND '2026-01-31'
        GROUP BY 1
        ORDER BY revenue DESC
    """).result())
    print("\n  mart_performance_master - Jan 2026 by marketer:")
    for r in rows:
        print(f"    {r.marketer_id:12s}: Orders={r.orders:>4d} | Rev={r.revenue:>10,.0f} | Ads={r.ads_spend_ron:>10,.0f} RON")
except Exception as e:
    print(f"  [FAIL] Verification error: {e}")

try:
    rows = list(client.query("""
        SELECT FORMAT_DATE('%Y-%m', report_date) as month,
               ROUND(SUM(revenue_confirmed), 0) as rev_confirmed,
               ROUND(SUM(ads_spend_ron), 0) as ads_spend_ron
        FROM `levelup-465304.STRAMARK_Dataset.vw_fact_daily_pnl_v2`
        WHERE report_date BETWEEN '2026-01-01' AND '2026-03-31'
        GROUP BY 1 ORDER BY 1
    """).result())
    print("\n  vw_fact_daily_pnl_v2 - revenue_confirmed:")
    for r in rows:
        print(f"    {r.month}: Rev={r.rev_confirmed:>10,.0f} | Ads={r.ads_spend_ron:>10,.0f} RON")
except Exception as e:
    print(f"  [FAIL] Verification error: {e}")

print(f"\n{'=' * 60}")
print("  DONE! Refresh dashboard to see updated data.")
print(f"{'=' * 60}")
