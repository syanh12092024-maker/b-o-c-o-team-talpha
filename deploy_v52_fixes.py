"""Deploy v5.2 fixes: missing marketer suffixes + market attribution for BG/SK."""
import os
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.join(
    os.path.dirname(__file__), "bigquery_key.json"
)

from google.cloud import bigquery

client = bigquery.Client(project="levelup-465304")

def run_sql(label, sql):
    print(f"\n{'=' * 60}")
    print(f"  {label}")
    print(f"{'=' * 60}")
    try:
        result = client.query(sql).result()
        rows = list(result)
        print(f"  [OK] Success! ({len(rows)} rows)")
        for r in rows:
            print(f"    {dict(r)}")
        return True
    except Exception as e:
        print(f"  [FAIL] {e}")
        return False

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
        print(f"  [OK] Deployed!")
        return True
    except Exception as e:
        print(f"  [FAIL] {e}")
        return False

base = os.path.dirname(__file__)

# Step 1: Update dim_marketer_mapping (add campaign_code for MT, Vân, Hiệu)
print("\n" + "=" * 60)
print("  STEP 1: Update dim_marketer_mapping — missing campaign codes")
print("=" * 60)

for mid, code in [("MINHTHU", "MT"), ("TUONGVAN", "Vân"), ("HIEUNV", "Hiệu")]:
    run_sql(
        f"  Set {mid} → '{code}'",
        f"""UPDATE `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
            SET campaign_code = '{code}'
            WHERE marketer_id = '{mid}'"""
    )

run_sql("  Verify dim_marketer_mapping", """
    SELECT marketer_id, marketer_name, campaign_code
    FROM `levelup-465304.STRAMARK_Dataset.dim_marketer_mapping`
    ORDER BY marketer_id
""")

# Step 2: Update dim_market_mapping (add BG, SK, HR entries)
print("\n" + "=" * 60)
print("  STEP 2: Update dim_market_mapping — add BG/SK/HR entries")
print("=" * 60)

run_sql("  MERGE market mappings", """
    MERGE `levelup-465304.STRAMARK_Dataset.dim_market_mapping` AS t
    USING (
        SELECT 'ro' AS raw_market, 'Romania' AS market_name UNION ALL
        SELECT 'RO', 'Romania' UNION ALL
        SELECT 'romania', 'Romania' UNION ALL
        SELECT 'bg', 'Bulgaria' UNION ALL
        SELECT 'BG', 'Bulgaria' UNION ALL
        SELECT 'bulgaria', 'Bulgaria' UNION ALL
        SELECT 'sk', 'Slovakia' UNION ALL
        SELECT 'SK', 'Slovakia' UNION ALL
        SELECT 'slovakia', 'Slovakia' UNION ALL
        SELECT 'hr', 'Croatia' UNION ALL
        SELECT 'HR', 'Croatia' UNION ALL
        SELECT 'croatia', 'Croatia'
    ) AS s
    ON LOWER(t.raw_market) = LOWER(s.raw_market)
    WHEN NOT MATCHED THEN
        INSERT (raw_market, market_name)
        VALUES (s.raw_market, s.market_name)
""")

run_sql("  Verify dim_market_mapping", """
    SELECT raw_market, market_name
    FROM `levelup-465304.STRAMARK_Dataset.dim_market_mapping`
    ORDER BY market_name, raw_market
""")

# Step 3: Deploy mart_performance_master v5.2
deploy_view(
    "STEP 3: mart_performance_master v5.2 (+ MT/Vân/Hiệu suffixes)",
    os.path.join(base, "sql", "stramark", "03_mart_performance_master_v5_actual_ffm.sql")
)

# Step 4: Deploy mart_product_insights v5.1
deploy_view(
    "STEP 4: mart_product_insights v5.1 (+ BG/SK/HR market fallback)",
    os.path.join(base, "sql", "_legacy", "stramark", "05_mart_product_insights.sql")
)

# Step 5: Verification
print(f"\n{'=' * 60}")
print("  STEP 5: Verification — Mar 2026")
print(f"{'=' * 60}")

run_sql("  mart_performance_master — ads by marketer", """
    SELECT marketer_id, marketer_name,
           SUM(total_orders) as orders,
           ROUND(SUM(ads_spend_ron), 0) as ads_spend_ron,
           SUM(ads_unmatched) as unmatched
    FROM `levelup-465304.STRAMARK_Dataset.mart_performance_master`
    WHERE report_date BETWEEN '2026-03-01' AND '2026-03-25'
    GROUP BY 1, 2
    ORDER BY ads_spend_ron DESC
""")

run_sql("  mart_product_insights — ads by market", """
    SELECT market,
           SUM(order_count) as orders,
           ROUND(SUM(ads_spend_ron), 0) as ads_spend_ron
    FROM `levelup-465304.STRAMARK_Dataset.mart_product_insights`
    WHERE report_date BETWEEN '2026-03-01' AND '2026-03-25'
      AND market IS NOT NULL AND market != 'Unknown'
    GROUP BY 1
    ORDER BY ads_spend_ron DESC
""")

print(f"\n{'=' * 60}")
print("  DONE! Refresh CEO Intelligence dashboard to verify.")
print(f"{'=' * 60}")
