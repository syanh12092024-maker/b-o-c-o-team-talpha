"""
EU Shipment API Client — HTTP wrapper for inout.bg API.

Source of Truth: sync/stramark/eu_shipment_client.py
Created: 2026-03-09 (extracted from eu_shipment_sync.py)
"""

import time
import logging
import requests

logger = logging.getLogger(__name__)

# API rate limiting
API_DELAY_SECONDS = 0.5


class EUShipmentClient:
    """Client for EU Shipment (inout.bg) API."""

    def __init__(self, base_url, token, client_id):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.client_id = client_id
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        )

    def test_connection(self):
        """Test API connectivity via orders-history with a test ref."""
        try:
            payload = {"testMode": False, "orders": [{"refNum": "TEST_CONNECTION"}]}
            resp = self.session.post(
                f"{self.base_url}/fulfilment/orders-history",
                json=payload, timeout=10,
            )
            logger.info(f"  Connection test (orders-history): HTTP {resp.status_code}")
            return resp.status_code == 200
        except Exception as e:
            logger.error(f"  Connection test failed: {e}")
            return False

    def get_shipment_history(self, awb):
        """GET /get-status/history/{awb}?testMode=0 — Returns status history."""
        url = f"{self.base_url}/get-status/history/{awb}?testMode=0"
        try:
            resp = self.session.get(url, timeout=15)
            time.sleep(API_DELAY_SECONDS)
            if resp.status_code == 200:
                return resp.json()
            return None
        except Exception as e:
            logger.error(f"  AWB {awb} history error: {e}")
            return None

    def get_orders_history(self, ref_numbers):
        """POST /fulfilment/orders-history — Bulk search by ref numbers.

        API requires: {"testMode": false, "orders": [{"refNum": "ID"}, ...]}
        Returns: [{"refNum": "...", "awb": "...", "statusesHistory": [...], ...}]
        """
        url = f"{self.base_url}/fulfilment/orders-history"
        try:
            payload = {
                "testMode": False,
                "orders": [{"refNum": ref} for ref in ref_numbers],
            }
            resp = self.session.post(url, json=payload, timeout=30)
            time.sleep(API_DELAY_SECONDS)
            if resp.status_code == 200:
                return resp.json()
            else:
                logger.warning(
                    f"  Orders history: HTTP {resp.status_code} — {resp.text[:200]}"
                )
                return None
        except Exception as e:
            logger.error(f"  Orders history error: {e}")
            return None

    def get_awb(self, awb):
        """GET /get-awb/{awb}?testMode=0 — Returns full AWB details with PRICE.

        Response includes:
            PRICE: actual shipping cost (BGN — Bulgarian Lev, NOT EUR!)
                   Convert to EUR via fixed rate: 1 EUR = 1.95583 BGN
            COD: cash-on-delivery amount (RON)
            PAYEDNUMBER: payout batch number
            PAYEDDATE: payout date
            AWB_STATUS, REFERENCENUMBER, TOTAL_WEIGHT, etc.
        """
        url = f"{self.base_url}/get-awb/{awb}?testMode=0"
        try:
            resp = self.session.get(url, timeout=15)
            time.sleep(API_DELAY_SECONDS)
            if resp.status_code == 200:
                return resp.json()
            else:
                logger.warning(f"  AWB {awb} get-awb: HTTP {resp.status_code}")
                return None
        except Exception as e:
            logger.error(f"  AWB {awb} get-awb error: {e}")
            return None

    def check_cod(self, ref_number):
        """GET /check-cod-by-order/{refNum}?testMode=0 — Returns COD info.

        Response:
            {"awbNumber": "...", "referenceNumber": "...", "COD": "184.00",
             "payedNumber": 43472, "payedDate": "2026-03-17 11:11:25"}

        COD Status derived:
            payedDate != null → "Paid"
            payedDate == null → "Pending" (Unprocessed/Cash held/Ready to pay)
            empty {} → "No data"
        """
        url = f"{self.base_url}/check-cod-by-order/{ref_number}?testMode=0"
        try:
            resp = self.session.get(url, timeout=10)
            time.sleep(API_DELAY_SECONDS)
            if resp.status_code == 200:
                return resp.json()
            return None
        except Exception as e:
            logger.error(f"  COD check error for {ref_number}: {e}")
            return None
