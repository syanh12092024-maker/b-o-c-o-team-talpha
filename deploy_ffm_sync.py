"""
Deploy FFM Sync infrastructure to BigQuery.

Usage:
    python deploy_ffm_sync.py              # Deploy table + views
    python deploy_ffm_sync.py --views-only # Only deploy views (skip table creation)

Steps:
    1. Create ffm_shipments table
    2. Deploy vw_ffm_cost_actual view
    3. Deploy updated mart_performance_master v5 (with actual FFM costs)
    4. Verify deployment
"""
import os
import sys
import io
import argparse

# Force UTF-8 output on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.join(
    os.path.dirname(__file__), "bigquery_key.json"
)

from google.cloud import bigquery

client = bigquery.Client(project="levelup-465304")


def deploy_sql(label, sql_path, strip_comments=True):
    """Deploy a SQL file to BigQuery."""
    print(f"\n{'=' * 60}")
    print(f"  {label}")
    print(f"{'=' * 60}")
    if not os.path.exists(sql_path):
        print(f"  [FAIL] File not found: {sql_path}")
        return False
    with open(sql_path, "r", encoding="utf-8") as f:
        sql = f.read()
    if strip_comments:
        sql_clean = "\n".join(l for l in sql.split("\n") if not l.strip().startswith("--"))
    else:
        sql_clean = sql
    try:
        client.query(sql_clean).result()
        print(f"  [OK] Deployed successfully!")
        return True
    except Exception as e:
        print(f"  [FAIL] Error: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Deploy FFM Sync to BigQuery")
    parser.add_argument("--views-only", action="store_true", help="Skip table creation")
    args = parser.parse_args()

    base_dir = os.path.dirname(__file__)
    results = []

    print("=" * 60)
    print("  FFM Sync Deployment")
    print("=" * 60)

    # Step 1: Create ffm_shipments table
    if not args.views_only:
        ok = deploy_sql(
            "STEP 1: Create ffm_shipments table",
            os.path.join(base_dir, "sql", "stramark", "create_ffm_shipments.sql")
        )
        results.append(("ffm_shipments table", ok))
    else:
        print("\n  [SKIP] Table creation (--views-only)")

    # Step 2: Deploy vw_ffm_cost_actual
    ok = deploy_sql(
        "STEP 2: Deploy vw_ffm_cost_actual (actual FFM costs per order)",
        os.path.join(base_dir, "sql", "stramark", "vw_ffm_cost_actual.sql")
    )
    results.append(("vw_ffm_cost_actual", ok))

    # Step 3: Deploy updated mart_performance_master v5
    ok = deploy_sql(
        "STEP 3: Deploy mart_performance_master v5 (actual FFM costs)",
        os.path.join(base_dir, "sql", "stramark", "03_mart_performance_master_v5_actual_ffm.sql")
    )
    results.append(("mart_performance_master v5", ok))

    # Step 4: Verify
    print(f"\n{'=' * 60}")
    print("  STEP 4: Verification")
    print(f"{'=' * 60}")

    try:
        rows = list(client.query("""
            SELECT COUNT(*) as total_rows
            FROM `levelup-465304.STRAMARK_Dataset.ffm_shipments`
        """).result())
        print(f"  [OK] ffm_shipments table exists ({rows[0].total_rows} rows)")
    except Exception as e:
        print(f"  [INFO] ffm_shipments: {e}")

    try:
        rows = list(client.query("""
            SELECT COUNT(*) as total_rows
            FROM `levelup-465304.STRAMARK_Dataset.vw_ffm_cost_actual`
        """).result())
        print(f"  [OK] vw_ffm_cost_actual view works ({rows[0].total_rows} rows)")
    except Exception as e:
        print(f"  [WARN] vw_ffm_cost_actual: {e}")

    try:
        rows = list(client.query("""
            SELECT marketer_id,
                   SUM(total_orders) as orders,
                   ROUND(SUM(fulfillment_cost), 0) as ffm_cost,
                   SUM(orders_with_actual_ffm) as actual_ffm_orders,
                   SUM(orders_with_estimated_ffm) as estimated_ffm_orders
            FROM `levelup-465304.STRAMARK_Dataset.mart_performance_master`
            WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            GROUP BY 1
            ORDER BY orders DESC
        """).result())
        print(f"\n  mart_performance_master v5 — Last 7 days:")
        for r in rows:
            print(f"    {r.marketer_id:12s}: Orders={r.orders:>4d} | "
                  f"FFM Cost={r.ffm_cost:>8,.0f} RON | "
                  f"Actual={r.actual_ffm_orders:>4d} | "
                  f"Estimated={r.estimated_ffm_orders:>4d}")
    except Exception as e:
        print(f"  [FAIL] mart_performance_master verification: {e}")

    # Summary
    print(f"\n{'=' * 60}")
    print("  DEPLOYMENT SUMMARY")
    print(f"{'=' * 60}")
    for name, ok in results:
        status = "✓ OK" if ok else "✗ FAIL"
        print(f"  {status} — {name}")
    print(f"\n  Next: Run EU Shipment sync:")
    print(f"    python sync/stramark/eu_shipment_sync.py --test-connection")
    print(f"    python sync/stramark/eu_shipment_sync.py --limit 10 --dry-run")
    print(f"    python sync/stramark/eu_shipment_sync.py")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
