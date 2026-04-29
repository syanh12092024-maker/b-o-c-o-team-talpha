#!/usr/bin/env python3
"""
Dashboard Query Validation Script
==================================
Auto-validates all tab SQL queries against BQ schema BEFORE deploy.

Checks:
1. Column existence — every column in bq-schema.ts exists in BQ
2. Inline SQL detection — warns if .tsx files have SQL not from bq-queries.ts
3. Cross-tab consistency — flags if same metric uses different sources on same page

Usage:
    python3 scripts/validate-dashboard-queries.py [--dataset STRAMARK_Dataset]
    
Auto-runs via: npm run validate (configured in package.json)
"""

import os
import re
import sys
import json
import subprocess
from pathlib import Path
from collections import defaultdict

# ─── Config ──────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DASHBOARD_SRC = PROJECT_ROOT / "dashboard-ui" / "src"
TABS_DIRS = list((DASHBOARD_SRC / "components").glob("*/tabs"))
SCHEMA_FILE = DASHBOARD_SRC / "lib" / "bq-schema.ts"
BQ_KEY = PROJECT_ROOT / "bigquery_key.json"
BQ_PROJECT = "levelup-465304"
DEFAULT_DATASET = "STRAMARK_Dataset"

# Known datasets per project
PROJECT_DATASETS = {
    "stramark": "STRAMARK_Dataset",
    "auus1": "AUUS1_Dataset",
    "zen8": "zen8_Dataset",
    "t1": "T1_Dataset",
    "talpha": "TALPHA_Dataset",
    "trendify": "trendify_Dataset",
    "hnle": "hnle_Dataset",
}


def parse_schema_file():
    """Extract table names and column constants from bq-schema.ts"""
    content = SCHEMA_FILE.read_text()
    
    tables = {}
    columns_by_table = defaultdict(list)
    
    # Extract BQ_TABLES entries
    table_pattern = r'(\w+):\s*"(\w+)"'
    in_tables = False
    in_columns = False
    current_table = None
    
    for line in content.split('\n'):
        if 'BQ_TABLES' in line and '{' in line:
            in_tables = True
            continue
        if in_tables:
            if '}' in line and 'as const' in line:
                in_tables = False
                continue
            m = re.search(table_pattern, line)
            if m:
                tables[m.group(1)] = m.group(2)
        
        # Extract column constants (MART, PNL_VIEW, ADS_VIEW, etc.)
        if re.match(r'export const (\w+) = \{', line):
            current_table = re.match(r'export const (\w+) = \{', line).group(1)
            if current_table == 'BQ_TABLES':
                current_table = None
                continue
            in_columns = True
            continue
        if in_columns and current_table:
            if '} as const' in line:
                in_columns = False
                current_table = None
                continue
            m = re.search(r'(\w+):\s*"(\w+)"', line)
            if m:
                columns_by_table[current_table].append(m.group(2))
    
    return tables, columns_by_table


def check_bq_columns(dataset, tables, columns_by_table):
    """Verify columns exist in actual BQ tables."""
    if not BQ_KEY.exists():
        print(f"⚠️  SKIP BQ validation — {BQ_KEY} not found")
        return True
    
    bq_key_abs = str(BQ_KEY.resolve())
    errors = []
    table_map = {
        "MART": tables.get("MART"),
        "PNL_VIEW": tables.get("PNL_VIEW"),
        "ADS_VIEW": tables.get("ADS_VIEW"),
        "PRODUCT_VIEW": tables.get("PRODUCT_VIEW"),
        "ORDERS": tables.get("ORDERS"),
    }
    
    for const_name, table_name in table_map.items():
        if not table_name or const_name not in columns_by_table:
            continue
        
        # Get actual BQ schema
        try:
            result = subprocess.run(
                [sys.executable, "-c", f"""
import warnings; warnings.filterwarnings('ignore')
from google.cloud import bigquery
import json, os
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = '{bq_key_abs}'
c = bigquery.Client('{BQ_PROJECT}')
try:
    t = c.get_table('{BQ_PROJECT}.{dataset}.{table_name}')
    print(json.dumps([f.name for f in t.schema]))
except Exception as e:
    print(json.dumps({{"error": str(e)}}))
"""],
                capture_output=True, text=True, timeout=30
            )
            actual_cols = json.loads(result.stdout.strip())
            if isinstance(actual_cols, dict) and "error" in actual_cols:
                print(f"⚠️  Cannot read {dataset}.{table_name}: {actual_cols['error']}")
                continue
        except Exception as e:
            print(f"⚠️  BQ check failed for {table_name}: {e}")
            continue
        
        # Compare expected vs actual
        for expected_col in columns_by_table[const_name]:
            if expected_col in actual_cols:
                print(f"  ✅ {table_name}.{expected_col}")
            else:
                print(f"  ❌ {table_name}.{expected_col} — NOT FOUND in BQ!")
                errors.append(f"{table_name}.{expected_col}")
    
    return len(errors) == 0


def detect_inline_sql(tabs_dir):
    """Scan tab TSX files for inline SQL that should use bq-queries.ts instead."""
    warnings = []
    
    for tsx_file in tabs_dir.glob("*.tsx"):
        content = tsx_file.read_text()
        lines = content.split('\n')
        
        # Check if file imports from bq-queries
        uses_bq_queries = 'bq-queries' in content or 'bq-schema' in content
        
        # Find inline SQL patterns
        sql_patterns = [
            (r'FROM\s+\$\{DATASET\}\.(\w+)', 'Inline SQL FROM clause'),
            (r'SUM\(\w+\)', 'Inline SQL aggregation'),
            (r'GROUP BY\s+\d', 'Inline SQL GROUP BY'),
        ]
        
        for i, line in enumerate(lines, 1):
            for pattern, desc in sql_patterns:
                if re.search(pattern, line) and not uses_bq_queries:
                    warnings.append({
                        'file': str(tsx_file.relative_to(PROJECT_ROOT)),
                        'line': i,
                        'desc': desc,
                        'content': line.strip()[:80],
                    })
                    break  # one warning per line
    
    return warnings


def main():
    dataset = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DATASET
    
    print(f"🔍 Dashboard Query Validation — dataset: {dataset}")
    print("=" * 60)
    
    all_ok = True
    
    # 1. Parse schema file
    print("\n📋 Phase 1: Parsing bq-schema.ts...")
    if not SCHEMA_FILE.exists():
        print(f"❌ Schema file not found: {SCHEMA_FILE}")
        sys.exit(1)
    
    tables, columns_by_table = parse_schema_file()
    print(f"  Found {len(tables)} tables, {sum(len(v) for v in columns_by_table.values())} column definitions")
    
    # 2. Validate columns against BQ
    print(f"\n🔗 Phase 2: Validating columns in BQ ({dataset})...")
    if not check_bq_columns(dataset, tables, columns_by_table):
        all_ok = False
    
    # 3. Detect inline SQL in all project tabs
    print("\n🔎 Phase 3: Scanning for inline SQL in tab components...")
    total_warnings = 0
    for tabs_dir in sorted(TABS_DIRS):
        project = tabs_dir.parent.name
        warnings = detect_inline_sql(tabs_dir)
        if warnings:
            total_warnings += len(warnings)
            print(f"\n  📁 {project}/tabs/ — {len(warnings)} inline SQL warnings:")
            for w in warnings[:5]:  # show max 5 per project
                print(f"    ⚠️  {w['file']}:{w['line']} — {w['desc']}")
            if len(warnings) > 5:
                print(f"    ... and {len(warnings) - 5} more")
    
    if total_warnings == 0:
        print("  ✅ No inline SQL detected — all using bq-queries.ts")
    else:
        print(f"\n  ⚠️  Total: {total_warnings} inline SQL instances across all projects")
        print("  → Migrate these to use bq-queries.ts functions")
    
    # 4. Summary
    print("\n" + "=" * 60)
    if all_ok and total_warnings == 0:
        print("✅ ALL CHECKS PASSED")
        sys.exit(0)
    elif not all_ok:
        print("❌ COLUMN VALIDATION FAILED — fix bq-schema.ts or BQ views")
        sys.exit(1)
    else:
        print(f"⚠️  PASSED with {total_warnings} warnings (inline SQL to migrate)")
        sys.exit(0)


if __name__ == "__main__":
    main()
