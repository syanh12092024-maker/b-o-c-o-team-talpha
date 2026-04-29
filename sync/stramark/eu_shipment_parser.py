"""
EU Shipment parsers — Return order detection, date extraction, status parsing.

Source of Truth: sync/stramark/eu_shipment_parser.py
Created: 2026-03-09 (extracted from eu_shipment_sync.py)
"""

import re
from datetime import datetime


def parse_return_ref(ref_number):
    """Parse return order reference to extract original POS order ID.

    Examples:
        "3662 Returned WB The New is: 382314730" → ("3662", True)
        "4180 Returned to Warehouse" → ("4180", True)
        "4056 Return..." → ("4056", True)
        "4521" → ("4521", False)
        "" → (None, False)
    """
    if not ref_number:
        return None, False

    ref_str = str(ref_number).strip()

    # V5 FIX: Any ref containing "return" (case-insensitive) is a return shipment
    is_return = bool(re.search(r"return", ref_str, re.IGNORECASE))

    # Extract the leading numeric POS order ID
    match = re.match(r"^(\d+)", ref_str)
    if match:
        return match.group(1), is_return

    return ref_str, is_return


def extract_dates_from_history(history_data):
    """Extract key dates from shipment status history.

    Returns dict with 'created', 'delivered', 'returned' datetime values.
    """
    dates = {"created": None, "delivered": None, "returned": None}

    if not history_data:
        return dates

    # history_data may be a list of status events
    events = (
        history_data
        if isinstance(history_data, list)
        else history_data.get("data", [])
    )

    for event in events:
        status = str(
            event.get("status", "") or event.get("STATUS", "")
        ).lower()
        event_date = (
            event.get("date") or event.get("DATE") or event.get("created_at")
        )

        if not event_date:
            continue

        try:
            if isinstance(event_date, str):
                for fmt in [
                    "%Y-%m-%d %H:%M:%S",
                    "%Y-%m-%dT%H:%M:%S",
                    "%d.%m.%Y %H:%M:%S",
                    "%d.%m.%Y",
                ]:
                    try:
                        event_date = datetime.strptime(event_date, fmt)
                        break
                    except ValueError:
                        continue

            if "created" in status or "registered" in status or "accepted" in status:
                if dates["created"] is None:
                    dates["created"] = event_date
            elif "delivered" in status or "received" in status:
                dates["delivered"] = event_date
            elif "returned" in status or "back" in status:
                dates["returned"] = event_date
        except Exception:
            continue

    return dates


def determine_terminal_status(statuses_history):
    """Determine the current status from statusesHistory array.

    V5 FIX: Use the LAST (most recent) status event, not priority-based.
    euShipments displays the latest status, so we should match that behavior.

    Normalization:
        - contains "returned" or "back" → 'Returned'
        - contains "delivered" (but NOT "warehouse") → 'Delivered'
        - contains "warehouse" → 'Warehouse'
        - contains "shipped/transit/out for delivery" → 'Shipped'
        - contains "accepted/registered/created" → 'Processing'
        - fallback → raw status string or 'Unknown'

    Args:
        statuses_history: list of dicts with 'STATUS' and 'DATE' keys

    Returns:
        str: normalized current status
    """
    if not statuses_history:
        return "Unknown"

    # Find the last (most recent) non-empty status event
    last_raw_status = ""
    for event in statuses_history:
        status_raw = str(event.get("STATUS", "")).strip()
        if status_raw:
            last_raw_status = status_raw

    if not last_raw_status:
        return "Unknown"

    status_lower = last_raw_status.lower()

    # Normalize the last status
    if "returned" in status_lower or "back" in status_lower:
        return "Returned"
    if "delivered" in status_lower:
        return "Delivered"
    if "warehouse" in status_lower:
        return "Warehouse"
    if (
        "shipped" in status_lower
        or "transit" in status_lower
        or "out for delivery" in status_lower
        or "on the way" in status_lower
    ):
        return "Shipped"
    if (
        "accepted" in status_lower
        or "registered" in status_lower
        or "created" in status_lower
    ):
        return "Processing"
    return last_raw_status
