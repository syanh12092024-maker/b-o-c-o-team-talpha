"""Test with MK01TITANIUM as refNumber (from SOP template).

⚠️ SECURITY: Token read from env var T1_FFM_API_TOKEN.
   Set it in .env or export before running.
"""
import os
import sys
import requests
import json
import time
from pathlib import Path

# Load .env
PROJECT_ROOT = Path(__file__).parent.parent.parent
ENV_PATH = PROJECT_ROOT / ".env"
if ENV_PATH.exists():
    with open(ENV_PATH, encoding="utf-8") as ef:
        for line in ef:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                key, val = key.strip(), val.strip()
                if key and val and key not in os.environ:
                    os.environ[key] = val

API_URL = "https://api1.inout.bg/api/v1/fulfilment/create-order"
TOKEN = os.getenv("T1_FFM_API_TOKEN", "")

if not TOKEN:
    print("❌ T1_FFM_API_TOKEN not set! Add it to .env or export it.")
    sys.exit(1)

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

payload = {
    "testMode": 0,
    "senderId": 3284,
    "courierId": 741,
    "waybillAvailableDate": "2026-03-06",
    "serviceName": "crossborder",
    "recipient": {
        "name": "Jozef Bors",
        "countryIsoCode": "SK",
        "cityName": "Lehnice",
        "zipCode": "93037",
        "streetName": "Lehnice 446",
        "phoneNumber": "+421908424616",
        "email": ""
    },
    "awb": {
        "referenceNumber": "T1-297",
        "bankRepayment": "32.00",
        "products": "MK01TITANIUM",
        "fragile": 0,
        "piecesInPack": 1,
        "parcels": 1,
        "envelopes": 0,
        "totalWeight": 1,
        "width": 10,
        "height": 10,
        "length": 10,
        "productsInfo": "MK01TITANIUM",
        "insurance": 0,
        "preview": 0,
        "saturdayDelivery": 0,
        "contents": "Bransoletka"
    },
    "products": [
        {"refNumber": "MK01TITANIUM", "qty": 1}
    ],
    "customsData": {
        "dutyPaymentInfo": "DDU",
        "customsValue": "32.00"
    },
    "clientReference": "T1-297-SKUFIX"
}

print(f"Sending at {time.strftime('%H:%M:%S')} with refNumber=MK01TITANIUM...")
t = time.time()
try:
    r = requests.post(API_URL, headers=headers, json=payload, timeout=30)
    elapsed = time.time() - t
    print(f"Status: {r.status_code} ({elapsed:.1f}s)")
    print(f"Response: {r.text}")
except requests.exceptions.Timeout:
    print(f"TIMEOUT ({time.time()-t:.1f}s)")
except Exception as e:
    print(f"ERROR ({time.time()-t:.1f}s): {type(e).__name__}: {e}")
