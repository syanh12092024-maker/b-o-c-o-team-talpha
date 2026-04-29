#!/usr/bin/env python3
"""
Stramark Fulfillment Watcher — Daemon mode.

Runs fulfillment_automation.py + fulfillment_status_sync.py on a loop.

Usage:
    python fulfillment_watcher.py                    # Default: every 5 min
    python fulfillment_watcher.py --interval 10      # Every 10 min
    python fulfillment_watcher.py --once             # Run once then exit
    python fulfillment_watcher.py --push-only        # Only push orders
    python fulfillment_watcher.py --sync-only        # Only status sync
    python fulfillment_watcher.py --filter-country SK # Only Slovakia

Typical setup:
    Windows Task Scheduler: every 5 min
    PM2: pm2 start fulfillment_watcher.py --interpreter python3 --name stramark-ffm
"""

import argparse
import logging
import subprocess
import sys
import time
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("fulfillment.watcher")

SCRIPT_DIR = Path(__file__).resolve().parent
PUSH_SCRIPT = SCRIPT_DIR / "fulfillment_automation.py"
SYNC_SCRIPT = SCRIPT_DIR / "fulfillment_status_sync.py"


def run_script(script_path: Path, extra_args: list = None) -> bool:
    """Run a Python script as subprocess."""
    cmd = [sys.executable, str(script_path)] + (extra_args or [])
    log.info(f"Running: {' '.join(cmd)}")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 min max per run
            encoding="utf-8",
            errors="replace",
        )
        if result.stdout:
            for line in result.stdout.strip().split("\n")[-20:]:
                log.info(f"  | {line}")
        if result.returncode != 0:
            log.error(f"  Script exited with code {result.returncode}")
            if result.stderr:
                for line in result.stderr.strip().split("\n")[-10:]:
                    log.error(f"  ! {line}")
            return False
        return True
    except subprocess.TimeoutExpired:
        log.error(f"  Script timed out (5 min)")
        return False
    except Exception as e:
        log.error(f"  Script error: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Stramark Fulfillment Watcher")
    parser.add_argument("--interval", type=int, default=5,
                        help="Interval in minutes (default: 5)")
    parser.add_argument("--once", action="store_true",
                        help="Run once then exit")
    parser.add_argument("--push-only", action="store_true",
                        help="Only run push automation")
    parser.add_argument("--sync-only", action="store_true",
                        help="Only run status sync")
    parser.add_argument("--filter-country", type=str, default="ALL",
                        help="Country filter: RO, SK, BG, HR, ALL")
    parser.add_argument("--dry-run", action="store_true",
                        help="Pass --dry-run to scripts")
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("  Stramark Fulfillment Watcher")
    log.info(f"  Interval: {'once' if args.once else f'{args.interval} min'}")
    log.info(f"  Push: {'yes' if not args.sync_only else 'no'}")
    log.info(f"  Sync: {'yes' if not args.push_only else 'no'}")
    log.info(f"  Country: {args.filter_country}")
    log.info("=" * 60)

    iteration = 0
    while True:
        iteration += 1
        log.info(f"\n--- Iteration {iteration} ---")

        # 1. Push packing orders → euShipments
        if not args.sync_only:
            push_args = []
            if args.dry_run:
                push_args.append("--dry-run")
            if args.filter_country != "ALL":
                push_args.extend(["--filter-country", args.filter_country])
            run_script(PUSH_SCRIPT, push_args)

        # 2. Status sync: euShipments → POS Cake
        if not args.push_only:
            sync_args = []
            if args.dry_run:
                sync_args.append("--dry-run")
            run_script(SYNC_SCRIPT, sync_args)

        if args.once:
            log.info("Single run complete. Exiting.")
            break

        log.info(f"Sleeping {args.interval} minutes...")
        time.sleep(args.interval * 60)


if __name__ == "__main__":
    main()
