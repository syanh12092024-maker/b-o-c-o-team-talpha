"""
Daily FFM Sync Runner — Scheduled to run at 6:00 AM VN time.

Usage:
    python scripts/run_ffm_sync.py          # Run all FFM syncs
    python scripts/run_ffm_sync.py --eu     # EU Shipment only
    python scripts/run_ffm_sync.py --tce    # TCE only (Phase 2)

Schedule (Windows Task Scheduler):
    Trigger: Daily at 06:00
    Action: python D:\\Stramark_ver2\\scripts\\run_ffm_sync.py

Schedule (Linux cron):
    0 23 * * * cd /path/to/Stramark_ver2 && python scripts/run_ffm_sync.py
    (23:00 UTC = 06:00 VN next day)
"""
import os
import sys
import subprocess
import argparse
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = PROJECT_ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)


def run_sync(script_name, label):
    """Run a sync script and capture output."""
    script_path = PROJECT_ROOT / "sync" / "stramark" / script_name
    if not script_path.exists():
        print(f"  [SKIP] {label}: script not found ({script_path})")
        return False

    print(f"\n{'─' * 40}")
    print(f"  Running: {label}")
    print(f"{'─' * 40}")

    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=3600,  # 1 hour max
        )
        print(result.stdout)
        if result.stderr:
            print(f"  [STDERR] {result.stderr[:500]}")
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        print(f"  [TIMEOUT] {label} exceeded 1 hour limit")
        return False
    except Exception as e:
        print(f"  [ERROR] {label}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Daily FFM Sync Runner")
    parser.add_argument("--eu", action="store_true", help="EU Shipment only")
    parser.add_argument("--tce", action="store_true", help="TCE only (Phase 2)")
    args = parser.parse_args()

    # Default: run all
    run_eu = args.eu or (not args.eu and not args.tce)
    run_tce = args.tce or (not args.eu and not args.tce)

    print("═" * 60)
    print(f"  FFM Daily Sync Runner")
    print(f"  Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("═" * 60)

    results = []

    if run_eu:
        ok = run_sync("eu_shipment_sync.py", "EU Shipment API Sync")
        results.append(("EU Shipment", ok))

    if run_tce:
        ok = run_sync("tce_sync.py", "TCE PDF Sync")
        results.append(("TCE PDF Sync", ok))

    # Summary
    print(f"\n{'═' * 60}")
    print("  SYNC SUMMARY")
    for name, ok in results:
        status = "✓" if ok else "✗"
        print(f"    {status} {name}")
    print(f"{'═' * 60}")


if __name__ == "__main__":
    main()
