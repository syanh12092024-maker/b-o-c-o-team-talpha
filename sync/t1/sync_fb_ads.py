#!/usr/bin/env python3
"""
Sync Facebook Ads -> BigQuery T1_Dataset.
Pulls campaign/ad-level insights from Meta Marketing API and inserts into fb_ads_data.
"""

import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import yaml
from google.cloud import bigquery

# Setup
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("sync.fb_ads")

PROJECT_ROOT = Path(__file__).parent.parent.parent
CONFIG_PATH = PROJECT_ROOT / "config" / "projects" / "t1.yaml"

# Load config
with open(CONFIG_PATH, encoding="utf-8") as f:
    CFG = yaml.safe_load(f)

# Load .env file
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


def _resolve_env(val):
    """Resolve ${ENV_VAR} placeholders in YAML values."""
    if isinstance(val, str) and val.startswith("${") and val.endswith("}"):
        env_key = val[2:-1]
        return os.environ.get(env_key, val)
    return val


ACCESS_TOKEN = _resolve_env(CFG["meta_ads"]["access_token"])

# Dynamic config — reads from config/ad_accounts.json (dashboard managed)
from sync.config_loader import get_active_account_ids
_dynamic_ids = get_active_account_ids('t1')
AD_ACCOUNT_IDS = _dynamic_ids if _dynamic_ids else CFG["meta_ads"]["ad_account_ids"]
AD_ACCOUNT_ID = AD_ACCOUNT_IDS[0] if AD_ACCOUNT_IDS else CFG["meta_ads"]["ad_account_ids"][0]

GCP_PROJECT = CFG["bigquery"]["project_gcp"]
DATASET = CFG["bigquery"]["dataset"]
DS = f"{GCP_PROJECT}.{DATASET}"
FB_API_BASE = "https://graph.facebook.com/v19.0"


def get_action_value(actions, *keys):
    """Extract value from Facebook actions array."""
    if not actions:
        return 0
    for key in keys:
        for a in actions:
            if a.get("action_type") == key:
                return float(a.get("value", 0))
    return 0


def fetch_ad_insights(days_back=30):
    """Fetch ad-level insights from Facebook Marketing API."""
    since = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")
    until = datetime.now().strftime("%Y-%m-%d")

    all_rows = []
    url = f"{FB_API_BASE}/{AD_ACCOUNT_ID}/insights"
    params = {
        "fields": "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,account_id,"
                  "spend,impressions,reach,clicks,cpm,cpc,ctr,frequency,actions,action_values,cost_per_action_type",
        "level": "ad",
        "time_increment": "1",
        "limit": "500",
        "access_token": ACCESS_TOKEN,
        "time_range": json.dumps({"since": since, "until": until}),
    }

    page = 1
    while url:
        log.info(f"Fetching FB ads page {page}...")
        try:
            resp = requests.get(url, params=params if page == 1 else None, timeout=60)
        except requests.exceptions.RequestException as e:
            log.error(f"Network error fetching FB ads: {e}")
            break

        if resp.status_code != 200:
            error_body = resp.text[:500]
            log.error(f"Facebook API error (HTTP {resp.status_code}): {error_body}")
            # Check for common errors
            if resp.status_code == 400 and "OAuthException" in error_body:
                log.error("⚠️ Access token may be expired. Please refresh the token in .env")
            elif resp.status_code == 429:
                log.warning("Rate limited by Facebook API. Will retry next cycle.")
            break

        data = resp.json()

        # Check for API-level errors in response body
        if "error" in data:
            err = data["error"]
            log.error(f"Facebook API error: {err.get('message', 'Unknown')} (code: {err.get('code', '?')})")
            break

        rows = data.get("data", [])
        all_rows.extend(rows)
        log.info(f"  Got {len(rows)} rows (total: {len(all_rows)})")

        # Pagination
        paging = data.get("paging", {})
        url = paging.get("next")
        params = None  # next URL already has params
        page += 1

    return all_rows


def transform_ad_row(row):
    """Transform a Facebook ad insight row to BQ fb_ads_data schema."""
    now = datetime.now(timezone.utc).isoformat()
    actions = row.get("actions", [])
    action_values = row.get("action_values", [])

    purchases = get_action_value(actions, "omni_purchase", "purchase",
                                  "offsite_conversion.fb_pixel_purchase")
    purchase_value = get_action_value(action_values, "omni_purchase", "purchase",
                                       "offsite_conversion.fb_pixel_purchase")
    leads = get_action_value(actions, "lead")
    messages = get_action_value(actions, "onsite_conversion.messaging_conversation_started_7d")
    add_to_cart = get_action_value(actions, "add_to_cart")

    return {
        "ad_id": row.get("ad_id", ""),
        "ad_name": row.get("ad_name", ""),
        "adset_id": row.get("adset_id", ""),
        "adset_name": row.get("adset_name", ""),
        "campaign_id": row.get("campaign_id", ""),
        "campaign_name": row.get("campaign_name", ""),
        "account_id": row.get("account_id", ""),
        "date": row.get("date_start", ""),
        "spend": float(row.get("spend", 0) or 0),
        "impressions": int(row.get("impressions", 0) or 0),
        "reach": int(row.get("reach", 0) or 0),
        "clicks": int(row.get("clicks", 0) or 0),
        "cpm": float(row.get("cpm", 0) or 0),
        "cpc": float(row.get("cpc", 0) or 0),
        "ctr": float(row.get("ctr", 0) or 0),
        "frequency": float(row.get("frequency", 0) or 0),
        "purchases": int(purchases),
        "purchase_value": float(purchase_value),
        "leads": int(leads),
        "messages": int(messages),
        "add_to_cart": int(add_to_cart),
        "sync_time": now,
    }


def dedup_rows(rows):
    """Remove duplicate rows with same ad_id + date, keeping the last one."""
    seen = {}
    for r in rows:
        key = (r.get("ad_id", ""), r.get("date", ""))
        seen[key] = r  # Last wins
    deduped = list(seen.values())
    removed = len(rows) - len(deduped)
    if removed > 0:
        log.info(f"  Dedup: removed {removed} duplicate rows ({len(rows)} → {len(deduped)})")
    return deduped


def insert_to_bq(client, table_name, rows):
    """Insert rows using batch load (not streaming) to avoid buffer delay issues."""
    import io
    import json as json_mod

    table_id = f"{DS}.{table_name}"
    total = len(rows)

    # Use load_table_from_json for atomic batch load (no streaming buffer delay)
    job_config = bigquery.LoadJobConfig(
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,  # Replace all data
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
    )

    # Convert to newline-delimited JSON and load
    ndjson = "\n".join(json_mod.dumps(r) for r in rows)
    job = client.load_table_from_file(
        io.BytesIO(ndjson.encode("utf-8")),
        table_id,
        job_config=job_config,
    )
    job.result()  # Wait for completion

    log.info(f"  Batch loaded {total} rows to {table_name} (WRITE_TRUNCATE)")
    return 0


def main():
    log.info("=" * 50)
    log.info("  Facebook Ads -> BigQuery Sync (T1)")
    log.info("=" * 50)

    # 1. Fetch insights (default 90 days, or pass as CLI arg)
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--days', type=int, default=90)
    args, _ = parser.parse_known_args()
    days = args.days
    raw_rows = fetch_ad_insights(days_back=days)
    log.info(f"Total ad insights fetched: {len(raw_rows)} (days_back={days})")

    if not raw_rows:
        log.warning("No ad data found. Exiting.")
        return

    # 2. Transform
    bq_rows = [transform_ad_row(r) for r in raw_rows]
    log.info(f"Transformed: {len(bq_rows)} rows")

    # 3. Dedup — remove rows with same ad_id + date
    bq_rows = dedup_rows(bq_rows)
    log.info(f"After dedup: {len(bq_rows)} unique rows")

    # 4. Batch load (WRITE_TRUNCATE = atomic replace, no streaming buffer issues)
    client = bigquery.Client(project=GCP_PROJECT)
    log.info("Batch loading to BigQuery (WRITE_TRUNCATE)...")
    insert_to_bq(client, "fb_ads_data", bq_rows)

    log.info("=" * 50)
    log.info(f"  DONE: {len(bq_rows)} ad rows synced (deduped)")
    log.info("=" * 50)

    # 5. Check for anomalies & send Discord alerts
    try:
        from sync.t1.ads_alert_discord import check_and_alert
        log.info("Running ads anomaly check...")
        alert_result = check_and_alert()
        if alert_result.get("anomalies", 0) > 0:
            log.warning(f"⚠️ {alert_result['anomalies']} anomaly alerts sent to Discord")
    except Exception as e:
        log.warning(f"Ads alert check failed (non-blocking): {e}")


if __name__ == "__main__":
    main()
