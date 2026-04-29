#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════╗
║  Phase 1.4: Clone STRAMARK Views → 3 New Datasets           ║
║  1. Create 4 missing prerequisite tables                     ║
║  2. Extract all STRAMARK view SQL                            ║
║  3. Topological sort (dependency order)                      ║
║  4. Create views in ZEN8, TRENDIFY, HNLE datasets            ║
╚══════════════════════════════════════════════════════════════╝
"""
import os, sys, re
from collections import defaultdict

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "/Users/tatthanh031298/Desktop/AUUS/bigquery_key.json"
from google.cloud import bigquery

client = bigquery.Client(project="levelup-465304")
GCP = "levelup-465304"
SRC = "STRAMARK_Dataset"
TARGETS = ["ZEN8_Dataset", "TRENDIFY_Dataset", "HNLE_Dataset"]

# ═══════════════════════════════════════════
# Step 1: Create 4 missing prerequisite tables
# ═══════════════════════════════════════════
MISSING_TABLES = {
    "dim_market_mapping": """
CREATE TABLE IF NOT EXISTS `{DS}.dim_market_mapping` (
    market_code STRING NOT NULL,
    market_name STRING,
    country_code STRING,
    region STRING,
    currency STRING
)""",
    "order_items": """
CREATE TABLE IF NOT EXISTS `{DS}.order_items` (
    item_id STRING,
    order_id STRING,
    shop_id STRING,
    shop_name STRING,
    project_id STRING,
    product_id STRING,
    variation_id STRING,
    product_name STRING,
    variation_name STRING,
    barcode STRING,
    quantity INT64,
    returned_count INT64,
    returning_quantity INT64,
    retail_price FLOAT64,
    discount_each_product FLOAT64,
    total_discount FLOAT64,
    same_price_discount FLOAT64,
    avg_imported_price FLOAT64,
    is_bonus_product STRING,
    is_composite STRING,
    is_wholesale STRING,
    order_inserted_at STRING,
    sync_time STRING
)""",
    "page_marketer": """
CREATE TABLE IF NOT EXISTS `{DS}.page_marketer` (
    page_id STRING NOT NULL,
    page_name STRING,
    marketer_id STRING NOT NULL,
    marketer_name STRING,
    project_id STRING,
    is_active BOOL
)""",
    "product_cogs": """
CREATE TABLE IF NOT EXISTS `{DS}.product_cogs` (
    variation_id STRING,
    cost_raw FLOAT64,
    cost_ron FLOAT64,
    source STRING,
    sync_time STRING
)""",
}


def create_missing_tables(target_ds):
    """Create prerequisite tables that views depend on."""
    full_ds = f"{GCP}.{target_ds}"
    for name, ddl in MISSING_TABLES.items():
        sql = ddl.replace("{DS}", full_ds) + "\nOPTIONS(expiration_timestamp=TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 59 DAY))"
        try:
            client.query(sql).result()
            print(f"    + {name}")
        except Exception as e:
            print(f"    x {name}: {e}")


# ═══════════════════════════════════════════
# Step 2: Extract all STRAMARK view SQL
# ═══════════════════════════════════════════
def extract_views():
    """Get all view definitions from STRAMARK_Dataset."""
    views = {}
    tables = list(client.list_tables(f"{GCP}.{SRC}"))
    for t in tables:
        if t.table_type == "VIEW":
            tbl = client.get_table(t.reference)
            views[t.table_id] = tbl.view_query
    return views


# ═══════════════════════════════════════════
# Step 3: Topological sort
# ═══════════════════════════════════════════
def topo_sort(views):
    """Sort views by dependency — base views first."""
    deps = defaultdict(set)
    view_names = set(views.keys())

    for name, sql in views.items():
        # Find all references to other views within the same dataset
        refs = set(re.findall(rf"{re.escape(GCP)}\.{re.escape(SRC)}\.(\w[\w-]*)", sql))
        for ref in refs:
            if ref in view_names and ref != name:
                deps[name].add(ref)

    # Kahn's algorithm
    in_degree = {v: 0 for v in view_names}
    for name, d in deps.items():
        for dep in d:
            if dep in in_degree:
                in_degree[name] = in_degree.get(name, 0)  # ensure exists

    # Recompute properly
    in_degree = {v: 0 for v in view_names}
    for name, d in deps.items():
        for dep in d:
            pass  # dep must be created before name

    # Build reverse: for each view, which views depend on it?
    reverse = defaultdict(set)
    for name, d in deps.items():
        for dep in d:
            reverse[dep].add(name)
            in_degree[name] = in_degree.get(name, 0) + 1

    # Reset in_degree
    in_degree = {v: 0 for v in view_names}
    for name, d in deps.items():
        in_degree[name] += len(d)

    queue = [v for v in view_names if in_degree[v] == 0]
    result = []
    while queue:
        v = queue.pop(0)
        result.append(v)
        for dependent in reverse.get(v, []):
            in_degree[dependent] -= 1
            if in_degree[dependent] == 0:
                queue.append(dependent)

    # Add any remaining (cycles or isolated)
    remaining = view_names - set(result)
    result.extend(sorted(remaining))

    return result


# ═══════════════════════════════════════════
# Step 4: Clone views
# ═══════════════════════════════════════════
def clone_views(views, order, target_ds):
    """Clone all views from STRAMARK to target dataset."""
    full_target = f"{GCP}.{target_ds}"
    success = 0
    failed = []

    for name in order:
        sql = views[name]
        # Replace dataset reference
        new_sql = sql.replace(f"{GCP}.{SRC}", full_target)

        create_sql = f"CREATE OR REPLACE VIEW `{full_target}.{name}` AS\n{new_sql}"

        try:
            client.query(create_sql).result()
            print(f"    v {name}")
            success += 1
        except Exception as e:
            err_msg = str(e)
            # Truncate long error messages
            if len(err_msg) > 120:
                err_msg = err_msg[:120] + "..."
            print(f"    x {name}: {err_msg}")
            failed.append((name, err_msg))

    return success, failed


# ═══════════════════════════════════════════
# Main
# ═══════════════════════════════════════════
def main():
    dry_run = "--dry-run" in sys.argv
    only_ds = None
    for arg in sys.argv[1:]:
        if arg.startswith("--dataset="):
            only_ds = arg.split("=")[1]

    print("=" * 60)
    print("  PHASE 1.4: Clone STRAMARK Views")
    print("=" * 60)

    # Extract source views
    print("\n  Extracting STRAMARK views...")
    views = extract_views()
    print(f"  Found {len(views)} views")

    # Sort by dependency
    order = topo_sort(views)
    print(f"  Dependency order: {', '.join(order[:5])}... ({len(order)} total)")

    targets = [only_ds] if only_ds else TARGETS

    for target_ds in targets:
        print(f"\n{'=' * 60}")
        print(f"  -> {target_ds}")
        print(f"{'=' * 60}")

        if dry_run:
            print(f"  [DRY-RUN] Would create {len(MISSING_TABLES)} tables + {len(views)} views")
            continue

        # Create missing tables
        print(f"\n  Creating prerequisite tables...")
        create_missing_tables(target_ds)

        # Clone views
        print(f"\n  Cloning {len(views)} views...")
        success, failed = clone_views(views, order, target_ds)
        print(f"\n  Result: {success} OK, {len(failed)} failed")

        if failed:
            print("  Failed views:")
            for name, err in failed:
                print(f"    - {name}: {err}")

    print(f"\n{'=' * 60}")
    print("  DONE")
    print("=" * 60)


if __name__ == "__main__":
    main()
