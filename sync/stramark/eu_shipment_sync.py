"""
EU Shipment FFM Sync — Pull actual shipping costs from EU Shipment API into BigQuery.

Usage:
    python sync/stramark/eu_shipment_sync.py                     # Full sync
    python sync/stramark/eu_shipment_sync.py --test-connection    # Test API connectivity
    python sync/stramark/eu_shipment_sync.py --limit 10 --dry-run # Dry run with 10 orders
    python sync/stramark/eu_shipment_sync.py --resync-all         # Force resync all orders

Source of Truth: sync/stramark/eu_shipment_sync.py
Created: 2026-03-05
Refactored: 2026-03-09 (split into modules, V2/V3/V4 fixes)
"""
import os
import sys
import io
import json
import logging
import argparse
from datetime import datetime, date
from pathlib import Path

# Force UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ═══ Configuration ═══
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BQ_KEY_PATH = PROJECT_ROOT / "bigquery_key.json"
ENV_FFM_PATH = PROJECT_ROOT / ".env.ffm"
LOG_DIR = PROJECT_ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)

# BGN → EUR fixed exchange rate (legally fixed since 1999, does NOT fluctuate)
BGN_TO_EUR_RATE = 1.95583  # 1 EUR = 1.95583 BGN

BATCH_SIZE = 50  # Orders per batch for orders-history endpoint

# ═══ Logging ═══
log_filename = LOG_DIR / f"ffm_sync_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(log_filename, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)

# ═══ Local module imports ═══
# Add project root to sys.path so 'sync.stramark' package is importable
# whether run via `python sync/stramark/eu_shipment_sync.py` or as module
sys.path.insert(0, str(PROJECT_ROOT))

from sync.stramark.eu_shipment_client import EUShipmentClient
from sync.stramark.eu_shipment_parser import (
    parse_return_ref,
    extract_dates_from_history,
    determine_terminal_status,
)
from sync.stramark.bq_operations import (
    init_bigquery,
    ensure_table_exists,
    get_orders_needing_sync,
    upsert_ffm_records,
)


def load_env_ffm():
    """Load .env.ffm file into environment-like dict."""
    config = {}
    if not ENV_FFM_PATH.exists():
        raise FileNotFoundError(f".env.ffm not found at {ENV_FFM_PATH}")

    with open(ENV_FFM_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                config[key.strip()] = value.strip()
    return config


def get_api_config(config):
    """Parse API configuration from env dict."""
    return {
        "base_url": config["EU_SHIPMENT_BASE_URL"],
        "vat_rate": float(config.get("EU_SHIPMENT_VAT_RATE", "0.20")),
        "switch_date": config["EU_SHIPMENT_ACCOUNT_SWITCH_DATE"],
        "gcp_project": config.get("GCP_PROJECT", "levelup-465304"),
        "bq_dataset": config.get("BQ_DATASET", "STRAMARK_Dataset"),
        "accounts": {
            "old": {
                "client_id": config["EU_SHIPMENT_CLIENT_ID_OLD"],
                "token": config["EU_SHIPMENT_TOKEN_OLD"],
                "label": f"Account OLD (Client {config['EU_SHIPMENT_CLIENT_ID_OLD']})",
            },
            "new": {
                "client_id": config["EU_SHIPMENT_CLIENT_ID_NEW"],
                "token": config["EU_SHIPMENT_TOKEN_NEW"],
                "label": f"Account NEW (Client {config['EU_SHIPMENT_CLIENT_ID_NEW']})",
            },
        },
    }


def select_account(api_config, order_date_str):
    """Select the correct API account based on order date."""
    switch_date = datetime.strptime(api_config["switch_date"], "%Y-%m-%d").date()
    if isinstance(order_date_str, str):
        order_date = datetime.strptime(order_date_str[:10], "%Y-%m-%d").date()
    elif isinstance(order_date_str, (date, datetime)):
        order_date = (
            order_date_str
            if isinstance(order_date_str, date)
            else order_date_str.date()
        )
    else:
        return api_config["accounts"]["new"]

    if order_date < switch_date:
        return api_config["accounts"]["old"]
    return api_config["accounts"]["new"]


def process_awb_details(client, awb, vat_rate):
    """Fetch AWB details and extract price, COD, payout info.

    Returns a dict with price_excl_vat, price_incl_vat, cod_amount,
    payout_date, payout_number, and raw awb_details.
    """
    result = {
        "price_excl_vat": 0.0,
        "price_incl_vat": 0.0,
        "price_bgn": 0.0,
        "cod_amount": 0.0,
        "payout_date": None,
        "payout_number": None,
        "awb_details": None,
    }

    awb_details = client.get_awb(str(awb))
    if not awb_details:
        result["price_incl_vat"] = round(0.0 * (1 + vat_rate), 4)
        return result

    result["awb_details"] = awb_details

    # PRICE = actual shipping cost in BGN (NOT EUR!)
    try:
        price_bgn = float(awb_details.get("PRICE", 0) or 0)
        result["price_bgn"] = price_bgn
        result["price_excl_vat"] = round(price_bgn / BGN_TO_EUR_RATE, 4)
    except (ValueError, TypeError):
        pass

    result["price_incl_vat"] = round(
        result["price_excl_vat"] * (1 + vat_rate), 4
    )

    # COD = cash on delivery amount (RON)
    try:
        result["cod_amount"] = float(awb_details.get("COD", 0) or 0)
    except (ValueError, TypeError):
        pass

    # Payout info
    result["payout_date"] = awb_details.get("PAYEDDATE")
    result["payout_number"] = awb_details.get("PAYEDNUMBER")

    return result


def process_order_item(item, client, account, vat_rate):
    """Process a single order item from orders-history response.

    Returns a record dict or None if the item should be skipped.
    """
    awb = item.get("awb")
    ref_number = item.get("refNum", "")
    error_msg = item.get("error")
    statuses = item.get("statusesHistory", [])

    if error_msg or not awb:
        return None

    # Parse return order from refNum
    pos_order_id, is_return = parse_return_ref(ref_number)

    # V2 FIX: Determine terminal status from statusesHistory
    terminal_status = determine_terminal_status(statuses)

    # Extract dates from status history
    dates = extract_dates_from_history({"data": statuses})

    # Fetch actual PRICE from /get-awb/{awb}
    awb_info = process_awb_details(client, awb, vat_rate)

    # V5 FIX: Use WAYBILL_AVAILABLE_DATE from /get-awb as created_date fallback
    created_date = None
    if isinstance(dates.get("created"), datetime):
        created_date = dates["created"].isoformat()
    elif awb_info.get("awb_details"):
        wad = awb_info["awb_details"].get("WAYBILL_AVAILABLE_DATE")
        if wad:
            try:
                created_date = datetime.strptime(str(wad), "%Y-%m-%d %H:%M:%S").isoformat()
            except (ValueError, TypeError):
                pass

    record = {
        "awb": str(awb),
        "ref_number": ref_number,
        "pos_order_id": pos_order_id,
        "ffm_partner": "euShipments",
        "client_id": account["client_id"],
        "status": terminal_status,
        "price_excl_vat": awb_info["price_excl_vat"],
        "price_incl_vat": awb_info["price_incl_vat"],
        "vat_rate": vat_rate,
        "currency": "EUR",
        "is_return_shipment": is_return,
        "original_order_id": pos_order_id if is_return else None,
        "cod_amount": awb_info["cod_amount"],
        "payout_date": awb_info["payout_date"],
        "payout_number": awb_info.get("payout_number"),
        "created_date": created_date,
        "delivered_date": (
            dates["delivered"].isoformat()
            if isinstance(dates.get("delivered"), datetime)
            else None
        ),
        "returned_date": (
            dates["returned"].isoformat()
            if isinstance(dates.get("returned"), datetime)
            else None
        ),
        "raw_response": json.dumps(
            awb_info["awb_details"] or item,
            default=str,
            ensure_ascii=False,
        )[:5000],
    }

    logger.info(
        f"  ✓ AWB {awb} | POS={pos_order_id} | "
        f"Price={awb_info['price_incl_vat']:.2f} EUR (incl VAT) "
        f"[{awb_info['price_bgn']:.0f} BGN] | "
        f"COD={awb_info['cod_amount']:.0f} | Status={terminal_status} | "
        f"Return={is_return} | Payed={awb_info['payout_date'] or '-'}"
    )

    return record


def _sync_batch_with_account(api_config, account_key, order_ids, vat_rate):
    """Sync a batch of order IDs using a specific account. Returns (records, found_ids, skipped)."""
    account = api_config["accounts"][account_key]
    client = EUShipmentClient(
        api_config["base_url"], account["token"], account["client_id"]
    )
    records = []
    found_ids = set()
    skipped = 0
    errors = 0

    for i in range(0, len(order_ids), BATCH_SIZE):
        batch = order_ids[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        logger.info(f"\nBatch {batch_num}: {len(batch)} orders")

        result = client.get_orders_history(batch)

        if not result or not isinstance(result, list):
            logger.warning(f"  Batch {batch_num}: No data returned")
            errors += len(batch)
            continue

        for item in result:
            try:
                record = process_order_item(
                    item, client, account, vat_rate
                )
                if record:
                    records.append(record)
                    found_ids.add(record["pos_order_id"])
                else:
                    skipped += 1
            except Exception as e:
                logger.error(f"  ✗ Item processing error: {e}")
                errors += 1

    return records, found_ids, skipped, errors


def sync_orders(api_config, bq_client, bq_table, orders, dry_run=False):
    """Sync a batch of orders from EU Shipment API to BigQuery.

    V6 FIX: Try primary account first (based on order date), then retry
    not-found orders on the other account. This handles cases where POS
    order was created before the account switch date but the waybill was
    created on the new account.
    """
    records = []
    errors = 0
    skipped = 0
    vat_rate = api_config["vat_rate"]

    # Group orders by primary account (based on order date)
    orders_by_account = {"old": [], "new": []}
    for order in orders:
        account = select_account(api_config, order.order_date)
        account_key = (
            "old"
            if account["client_id"] == api_config["accounts"]["old"]["client_id"]
            else "new"
        )
        orders_by_account[account_key].append(order)

    all_found_ids = set()

    for account_key in ["new", "old"]:
        account_orders = orders_by_account[account_key]
        if not account_orders:
            continue

        account = api_config["accounts"][account_key]
        order_ids = [str(o.order_id) for o in account_orders]

        logger.info(f"\n{'=' * 50}")
        logger.info(f"Processing {len(order_ids)} orders via {account['label']}")
        logger.info(f"{'=' * 50}")

        batch_records, found_ids, batch_skipped, batch_errors = \
            _sync_batch_with_account(api_config, account_key, order_ids, vat_rate)

        records.extend(batch_records)
        all_found_ids.update(found_ids)
        skipped += batch_skipped
        errors += batch_errors

        # V6: Retry not-found orders on the OTHER account
        not_found = [oid for oid in order_ids if oid not in found_ids]
        if not_found:
            other_key = "new" if account_key == "old" else "old"
            other_account = api_config["accounts"][other_key]
            logger.info(f"\n--- Retrying {len(not_found)} not-found orders on {other_account['label']} ---")

            retry_records, retry_found, retry_skipped, retry_errors = \
                _sync_batch_with_account(api_config, other_key, not_found, vat_rate)

            records.extend(retry_records)
            all_found_ids.update(retry_found)
            # Adjust skipped: subtract retry_found from original skipped
            skipped = skipped - len(retry_found) + retry_skipped
            errors += retry_errors

    logger.info(f"\n{'=' * 50}")
    logger.info(
        f"Sync summary: {len(records)} found | {skipped} not in FFM | {errors} errors"
    )
    logger.info(f"{'=' * 50}")

    count = upsert_ffm_records(bq_client, bq_table, records, dry_run=dry_run)
    return count, errors


def main():
    parser = argparse.ArgumentParser(description="EU Shipment FFM Sync to BigQuery")
    parser.add_argument("--test-connection", action="store_true", help="Test API connectivity")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of orders")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to BigQuery")
    parser.add_argument("--resync-all", action="store_true", help="Resync all orders")
    args = parser.parse_args()

    logger.info("═" * 60)
    logger.info("  EU Shipment FFM Sync")
    logger.info(f"  Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info("═" * 60)

    # Load config
    try:
        config = load_env_ffm()
        api_config = get_api_config(config)
    except FileNotFoundError as e:
        logger.error(str(e))
        sys.exit(1)

    gcp_project = api_config["gcp_project"]
    bq_dataset = api_config["bq_dataset"]
    bq_table = f"{gcp_project}.{bq_dataset}.ffm_shipments"

    # Test connection mode
    if args.test_connection:
        logger.info("\n[TEST CONNECTION MODE]")
        for key, account in api_config["accounts"].items():
            client = EUShipmentClient(
                api_config["base_url"], account["token"], account["client_id"]
            )
            logger.info(f"\n{account['label']}:")
            ok = client.test_connection()
            logger.info(f"  Result: {'✓ Connected' if ok else '✗ Failed'}")
        return

    # Init BigQuery
    logger.info("\nInitializing BigQuery...")
    bq_client = init_bigquery(BQ_KEY_PATH, gcp_project)

    if not args.dry_run:
        if not ensure_table_exists(bq_client, PROJECT_ROOT):
            logger.error("Cannot create ffm_shipments table, aborting")
            sys.exit(1)

    # Fetch orders to sync
    logger.info("\nFetching orders that need FFM sync...")
    orders = get_orders_needing_sync(
        bq_client, gcp_project, bq_dataset, bq_table,
        limit=args.limit, resync_all=args.resync_all,
    )

    if not orders:
        logger.info("No orders to sync!")
        return

    # Run sync
    count, errors = sync_orders(
        api_config, bq_client, bq_table, orders, dry_run=args.dry_run
    )

    # Summary
    logger.info("\n" + "═" * 60)
    logger.info("  SYNC COMPLETE")
    logger.info(f"  Records synced: {count}")
    logger.info(f"  Errors: {errors}")
    logger.info(f"  Log file: {log_filename}")
    logger.info("═" * 60)


if __name__ == "__main__":
    main()
