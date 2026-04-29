#!/usr/bin/env python3
"""
🚨 Ads Anomaly Alert → Discord
Kiểm tra dữ liệu ads từ BigQuery, gửi cảnh báo qua Discord webhook khi:
  - Cost per Lead > $8
  - CPM > $20

Usage:
    python -m sync.t1.ads_alert_discord          # Check today (or yesterday)
    python -m sync.t1.ads_alert_discord --date 2026-03-12
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import yaml

# ─── Setup ───
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("ads.alert")

PROJECT_ROOT = Path(__file__).parent.parent.parent
CONFIG_PATH = PROJECT_ROOT / "config" / "projects" / "t1.yaml"

# Load config
with open(CONFIG_PATH, encoding="utf-8") as f:
    CFG = yaml.safe_load(f)

# Load .env
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

# ─── Thresholds (configurable) ───
ALERT_CPL_THRESHOLD = 8.0    # USD — Cost per Lead
ALERT_CPM_THRESHOLD = 20.0   # USD — Cost per 1000 Impressions

# ─── Config ───
GCP_PROJECT = CFG["bigquery"]["project_gcp"]
DATASET = CFG["bigquery"]["dataset"]
DS = f"{GCP_PROJECT}.{DATASET}"

DISCORD_WEBHOOK_ALERT = os.environ.get("DISCORD_WEBHOOK_ALERT", "")


def query_campaign_metrics(check_date: str) -> list[dict]:
    """
    Query BigQuery fb_ads_data, aggregate theo campaign cho 1 ngày.
    Returns list of dicts: campaign_id, campaign_name, spend, impressions, leads, cpm, cost_per_lead
    """
    from google.cloud import bigquery

    client = bigquery.Client(project=GCP_PROJECT)

    sql = f"""
    SELECT
        campaign_id,
        campaign_name,
        spend,
        impressions,
        leads,
        ROUND(SAFE_DIVIDE(spend, impressions) * 1000, 2)  AS cpm,
        ROUND(SAFE_DIVIDE(spend, NULLIF(leads, 0)), 2)    AS cost_per_lead
    FROM (
        SELECT
            campaign_id,
            campaign_name,
            SUM(spend)        AS spend,
            SUM(impressions)  AS impressions,
            SUM(leads)        AS leads
        FROM `{DS}.fb_ads_data`
        WHERE date = '{check_date}'
        GROUP BY campaign_id, campaign_name
    )
    WHERE spend > 0
    ORDER BY spend DESC
    """

    log.info(f"Querying campaign metrics for {check_date}...")
    result = client.query(sql).result()
    rows = [dict(row) for row in result]
    log.info(f"  Found {len(rows)} campaigns with spend > 0")
    return rows


def detect_anomalies(rows: list[dict]) -> list[dict]:
    """
    Check từng campaign, trả về list anomalies.
    Mỗi anomaly = dict với campaign info + list alert reasons.
    """
    anomalies = []

    for r in rows:
        alerts = []
        cpl = r.get("cost_per_lead") or 0
        cpm = r.get("cpm") or 0
        leads = r.get("leads") or 0

        if cpl > ALERT_CPL_THRESHOLD and leads > 0:
            alerts.append({
                "metric": "Cost/Lead",
                "value": cpl,
                "threshold": ALERT_CPL_THRESHOLD,
                "emoji": "💸",
            })

        if cpm > ALERT_CPM_THRESHOLD:
            alerts.append({
                "metric": "CPM",
                "value": cpm,
                "threshold": ALERT_CPM_THRESHOLD,
                "emoji": "📈",
            })

        if alerts:
            anomalies.append({
                "campaign_id": r.get("campaign_id", ""),
                "campaign_name": r.get("campaign_name", "N/A"),
                "spend": r.get("spend", 0),
                "impressions": r.get("impressions", 0),
                "leads": int(leads),
                "cpm": cpm,
                "cost_per_lead": cpl,
                "alerts": alerts,
            })

    return anomalies


def build_discord_embeds(anomalies: list[dict], check_date: str) -> list[dict]:
    """
    Build Discord embed objects cho mỗi anomaly.
    Trả về list of embed dicts (Discord supports up to 10 embeds per message).
    """
    embeds = []

    for a in anomalies:
        # Color: red nếu có CPL alert, orange nếu chỉ CPM
        has_cpl = any(al["metric"] == "Cost/Lead" for al in a["alerts"])
        color = 0xEF4444 if has_cpl else 0xF59E0B  # Red / Orange

        alert_lines = []
        for al in a["alerts"]:
            alert_lines.append(
                f"{al['emoji']} **{al['metric']}**: ${al['value']:.2f}  ⚠️ ngưỡng > ${al['threshold']:.0f}"
            )

        fields = [
            {"name": "💰 Chi phí (Spend)", "value": f"${a['spend']:.2f}", "inline": True},
            {"name": "👁️ Impressions", "value": f"{a['impressions']:,}", "inline": True},
            {"name": "👥 Leads", "value": str(a["leads"]), "inline": True},
            {"name": "💸 Cost/Lead", "value": f"${a['cost_per_lead']:.2f}" if a["leads"] > 0 else "N/A", "inline": True},
            {"name": "📈 CPM", "value": f"${a['cpm']:.2f}", "inline": True},
            {"name": "📅 Ngày", "value": check_date, "inline": True},
        ]

        embed = {
            "title": f"🚨 ADS BẤT THƯỜNG — {a['campaign_name'][:50]}",
            "description": "\n".join(alert_lines),
            "color": color,
            "fields": fields,
            "footer": {"text": f"T1 Ads Alert | Campaign ID: {a['campaign_id']}"},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        embeds.append(embed)

    return embeds


def send_discord_alert(embeds: list[dict]) -> bool:
    """
    Gửi Discord webhook với rich embeds.
    Discord cho phép tối đa 10 embeds/message.
    """
    if not DISCORD_WEBHOOK_ALERT:
        log.warning("⚠️ DISCORD_WEBHOOK_ALERT chưa cấu hình — chỉ in ra console")
        return False

    # Split into batches of 10 (Discord limit)
    for i in range(0, len(embeds), 10):
        batch = embeds[i:i + 10]
        payload = {
            "content": "🚨 **CẢNH BÁO ADS BẤT THƯỜNG — T1**",
            "embeds": batch,
        }

        try:
            resp = requests.post(
                DISCORD_WEBHOOK_ALERT,
                json=payload,
                timeout=15,
            )
            if resp.status_code == 429:
                retry_after = resp.json().get("retry_after", 5)
                log.warning(f"Rate limited — retrying in {retry_after}s")
                import time
                time.sleep(retry_after)
                resp = requests.post(DISCORD_WEBHOOK_ALERT, json=payload, timeout=15)

            if resp.status_code not in (200, 204):
                log.error(f"Discord send failed: {resp.status_code} — {resp.text[:200]}")
                return False

            log.info(f"✅ Discord alert sent ({len(batch)} embeds)")
        except Exception as e:
            log.error(f"Discord send error: {e}")
            return False

    return True


def check_and_alert(check_date: str = None) -> dict:
    """
    Main function — có thể gọi từ sync_fb_ads.py hoặc chạy standalone.

    Returns:
        dict: {"anomalies": int, "alerts_sent": bool, "date": str}
    """
    # Determine date
    if not check_date:
        today = datetime.now().strftime("%Y-%m-%d")
        yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        check_date = today

    log.info("=" * 50)
    log.info(f"  🔍 Ads Anomaly Check — {check_date}")
    log.info(f"  Thresholds: CPL > ${ALERT_CPL_THRESHOLD}, CPM > ${ALERT_CPM_THRESHOLD}")
    log.info("=" * 50)

    # 1. Query BigQuery
    rows = query_campaign_metrics(check_date)

    if not rows:
        # Fallback to yesterday if today has no data
        if check_date == datetime.now().strftime("%Y-%m-%d"):
            yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
            log.info(f"No data for today, trying yesterday ({yesterday})...")
            rows = query_campaign_metrics(yesterday)
            check_date = yesterday

    if not rows:
        log.info("📭 Không có dữ liệu ads. Kết thúc.")
        return {"anomalies": 0, "alerts_sent": False, "date": check_date}

    # 2. Detect anomalies
    anomalies = detect_anomalies(rows)

    if not anomalies:
        log.info("✅ Không có bất thường. Tất cả metrics trong ngưỡng cho phép.")
        # Print summary
        for r in rows:
            cpl = r.get("cost_per_lead") or 0
            cpm = r.get("cpm") or 0
            leads = int(r.get("leads") or 0)
            log.info(
                f"  ✅ {r['campaign_name'][:40]:40s} | "
                f"Spend: ${r['spend']:.2f} | Leads: {leads} | "
                f"CPL: ${cpl:.2f} | CPM: ${cpm:.2f}"
            )
        return {"anomalies": 0, "alerts_sent": False, "date": check_date}

    # 3. Print anomalies to console
    log.warning(f"🚨 Phát hiện {len(anomalies)} campaign bất thường:")
    for a in anomalies:
        reasons = ", ".join(f"{al['metric']}=${al['value']:.2f}" for al in a["alerts"])
        log.warning(
            f"  🔴 {a['campaign_name'][:40]:40s} | "
            f"Spend: ${a['spend']:.2f} | Leads: {a['leads']} | {reasons}"
        )

    # 4. Build & send Discord alerts
    embeds = build_discord_embeds(anomalies, check_date)
    sent = send_discord_alert(embeds)

    result = {
        "anomalies": len(anomalies),
        "alerts_sent": sent,
        "date": check_date,
        "details": [
            {
                "campaign": a["campaign_name"],
                "alerts": [al["metric"] for al in a["alerts"]],
            }
            for a in anomalies
        ],
    }

    log.info(f"{'✅' if sent else '⚠️'} Kết quả: {len(anomalies)} anomalies, Discord={'sent' if sent else 'not sent'}")
    return result


def main():
    parser = argparse.ArgumentParser(description="Ads Anomaly Alert → Discord")
    parser.add_argument("--date", type=str, default=None, help="Date to check (YYYY-MM-DD)")
    parser.add_argument("--cpl-threshold", type=float, default=None, help="Cost/Lead threshold ($)")
    parser.add_argument("--cpm-threshold", type=float, default=None, help="CPM threshold ($)")
    args = parser.parse_args()

    # Override thresholds if provided
    global ALERT_CPL_THRESHOLD, ALERT_CPM_THRESHOLD
    if args.cpl_threshold is not None:
        ALERT_CPL_THRESHOLD = args.cpl_threshold
    if args.cpm_threshold is not None:
        ALERT_CPM_THRESHOLD = args.cpm_threshold

    result = check_and_alert(check_date=args.date)
    print(f"\n📊 Result: {json.dumps(result, indent=2, default=str)}")


if __name__ == "__main__":
    main()
