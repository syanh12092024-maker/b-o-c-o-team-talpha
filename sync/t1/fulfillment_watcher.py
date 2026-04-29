#!/usr/bin/env python3
"""
T1 Fulfillment Watcher — Continuous monitoring mode.

Runs in a loop, checking POS every N minutes for new packing orders.
Alternative to Windows Task Scheduler — just keep this running.

Usage:
    python fulfillment_watcher.py                  # Default: every 5 min
    python fulfillment_watcher.py --interval 10    # Every 10 min
    python fulfillment_watcher.py --once            # Run once then exit
"""

import time
import sys
import logging
import subprocess
from datetime import datetime
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("fulfillment.watcher")

SCRIPT_DIR = Path(__file__).parent
AUTOMATION_SCRIPT = SCRIPT_DIR / "fulfillment_automation.py"
DEFAULT_INTERVAL = 5  # minutes


def run_sync():
    """Run the fulfillment automation script."""
    log.info("=" * 50)
    log.info("🚀 Starting fulfillment sync...")
    log.info("=" * 50)

    try:
        result = subprocess.run(
            [sys.executable, str(AUTOMATION_SCRIPT)],
            cwd=str(SCRIPT_DIR.parent.parent),  # Project root
            capture_output=False,
            timeout=300,  # 5 min max
        )

        if result.returncode == 0:
            log.info("✅ Sync completed successfully")
        else:
            log.warning(f"⚠️ Sync completed with exit code {result.returncode}")

    except subprocess.TimeoutExpired:
        log.error("❌ Sync timed out (>5 min)")
    except Exception as e:
        log.error(f"❌ Sync failed: {e}")


def main():
    # Parse args
    interval = DEFAULT_INTERVAL
    run_once = False

    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == "--interval" and i + 1 < len(args):
            interval = int(args[i + 1])
        elif arg == "--once":
            run_once = True

    log.info("╔══════════════════════════════════════════════╗")
    log.info("║  T1 Fulfillment Watcher                     ║")
    log.info(f"║  Mode: {'ONE-SHOT' if run_once else f'LOOP (every {interval} min)':38s}║")
    log.info(f"║  Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S'):38s}║")
    log.info("╚══════════════════════════════════════════════╝")

    if run_once:
        run_sync()
        return

    log.info(f"👁️  Watching POS every {interval} minutes...")
    log.info("   Press Ctrl+C to stop\n")

    cycle = 0
    while True:
        cycle += 1
        log.info(f"\n🔄 Cycle #{cycle} — {datetime.now().strftime('%H:%M:%S')}")

        run_sync()

        log.info(f"\n💤 Sleeping {interval} minutes until next check...")
        try:
            time.sleep(interval * 60)
        except KeyboardInterrupt:
            log.info("\n🛑 Watcher stopped by user.")
            break


if __name__ == "__main__":
    main()
