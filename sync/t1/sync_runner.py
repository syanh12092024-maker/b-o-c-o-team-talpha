#!/usr/bin/env python3
"""
T1 Auto-Sync Runner — chạy nền mỗi phút, sync POS + Ads + Fulfillment.

Thay thế nút "Sync POS + Ads" thủ công trên dashboard.
Chạy qua PM2:
    pm2 start sync/t1/sync_runner.py --name t1-sync --interpreter python3

Sync intervals:
    - POS (Pancake):       mỗi 1 phút
    - Ads (Facebook):      mỗi 10 phút
    - Fulfillment status:  mỗi 5 phút
"""

import json
import logging
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

# Setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("sync.runner")

PROJECT_ROOT = Path(__file__).parent.parent.parent

# Status file — read by dashboard API
STATUS_FILE = Path("/tmp/t1_sync_status.json")

# Intervals (seconds)
LOOP_INTERVAL = 60        # Main loop: every 1 minute
ADS_INTERVAL = 600        # Ads: every 10 minutes (Facebook rate limit)
FFM_INTERVAL = 300        # Fulfillment: every 5 minutes

# Track last run times
_last_ads_run = 0
_last_ffm_run = 0


def write_status(status: dict):
    """Write sync status to JSON file for dashboard to read."""
    try:
        status["updated_at"] = datetime.now(timezone.utc).isoformat()
        STATUS_FILE.write_text(json.dumps(status, indent=2, default=str), encoding="utf-8")
    except Exception as e:
        log.error(f"Could not write status file: {e}")


def run_pancake_sync() -> dict:
    """Run POS Pancake sync."""
    start = time.time()
    try:
        # Import here to avoid module-level import issues
        from sync.t1.sync_pancake_orders import main as pancake_main
        pancake_main()
        return {
            "status": "success",
            "message": "POS synced OK",
            "duration_ms": int((time.time() - start) * 1000),
            "time": datetime.now(timezone.utc).strftime("%H:%M:%S"),
        }
    except Exception as e:
        log.error(f"POS sync error: {e}")
        return {
            "status": "error",
            "message": str(e)[:200],
            "duration_ms": int((time.time() - start) * 1000),
            "time": datetime.now(timezone.utc).strftime("%H:%M:%S"),
        }


def run_ads_sync() -> dict:
    """Run Facebook Ads sync."""
    start = time.time()
    try:
        from sync.t1.sync_fb_ads import main as ads_main
        ads_main()
        return {
            "status": "success",
            "message": "Ads synced OK",
            "duration_ms": int((time.time() - start) * 1000),
            "time": datetime.now(timezone.utc).strftime("%H:%M:%S"),
        }
    except Exception as e:
        log.error(f"Ads sync error: {e}")
        return {
            "status": "error",
            "message": str(e)[:200],
            "duration_ms": int((time.time() - start) * 1000),
            "time": datetime.now(timezone.utc).strftime("%H:%M:%S"),
        }


def run_fulfillment_sync() -> dict:
    """Run Fulfillment status sync."""
    start = time.time()
    try:
        from sync.t1.auto_status_sync import main as ffm_main
        ffm_main()
        return {
            "status": "success",
            "message": "Fulfillment synced OK",
            "duration_ms": int((time.time() - start) * 1000),
            "time": datetime.now(timezone.utc).strftime("%H:%M:%S"),
        }
    except Exception as e:
        log.error(f"Fulfillment sync error: {e}")
        return {
            "status": "error",
            "message": str(e)[:200],
            "duration_ms": int((time.time() - start) * 1000),
            "time": datetime.now(timezone.utc).strftime("%H:%M:%S"),
        }


def main():
    global _last_ads_run, _last_ffm_run

    log.info("=" * 60)
    log.info("  T1 Auto-Sync Runner — Starting")
    log.info(f"  POS: every {LOOP_INTERVAL}s | Ads: every {ADS_INTERVAL}s | FFM: every {FFM_INTERVAL}s")
    log.info("=" * 60)

    # Set env for BigQuery
    bq_key = PROJECT_ROOT / "bigquery_key_t1.json"
    if bq_key.exists():
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(bq_key)
    
    # Add project root to path
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))

    status = {
        "running": True,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "sources": {},
    }

    while True:
        now = time.time()
        cycle_start = datetime.now(timezone.utc)
        log.info(f"\n{'─'*40} Sync cycle @ {cycle_start.strftime('%H:%M:%S')} {'─'*40}")

        # 1. POS sync (every cycle)
        log.info("📦 Running POS sync...")
        status["sources"]["pancake"] = run_pancake_sync()

        # 2. Ads sync (every ADS_INTERVAL)
        if now - _last_ads_run >= ADS_INTERVAL:
            log.info("📢 Running Ads sync...")
            status["sources"]["ads"] = run_ads_sync()
            _last_ads_run = now
        else:
            remaining = int(ADS_INTERVAL - (now - _last_ads_run))
            log.info(f"📢 Ads: skipping (next in {remaining}s)")

        # 3. Fulfillment sync (every FFM_INTERVAL)
        if now - _last_ffm_run >= FFM_INTERVAL:
            log.info("🚚 Running Fulfillment sync...")
            status["sources"]["fulfillment"] = run_fulfillment_sync()
            _last_ffm_run = now
        else:
            remaining = int(FFM_INTERVAL - (now - _last_ffm_run))
            log.info(f"🚚 Fulfillment: skipping (next in {remaining}s)")

        # Update status
        status["last_sync"] = cycle_start.isoformat()
        write_status(status)

        log.info(f"✅ Cycle complete. Sleeping {LOOP_INTERVAL}s...")
        time.sleep(LOOP_INTERVAL)


if __name__ == "__main__":
    main()
