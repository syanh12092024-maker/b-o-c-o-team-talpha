#!/usr/bin/env python3
"""
T1 Daily Report → Discord.

Gửi báo cáo hằng ngày về doanh thu, chi phí ads, số đơn, tỷ lệ giao hàng.
Lấy dữ liệu từ BigQuery (sale_order + fb_ads_data).

Usage:
    python sync/t1/daily_report.py              # Report cho ngày hôm qua
    python sync/t1/daily_report.py --today      # Report cho hôm nay
    python sync/t1/daily_report.py --date 2026-02-20  # Report cho ngày cụ thể
    python sync/t1/daily_report.py --summary    # Tóm tắt toàn bộ
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone, timedelta, date
from pathlib import Path

import requests
import yaml
from google.cloud import bigquery

# ──────────────────────────────────────────
# Setup
# ──────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("daily_report")

PROJECT_ROOT = Path(__file__).parent.parent.parent
CONFIG_PATH = PROJECT_ROOT / "config" / "projects" / "t1.yaml"

with open(CONFIG_PATH, encoding="utf-8") as f:
    CFG = yaml.safe_load(f)

GCP_PROJECT = CFG["bigquery"]["project_gcp"]
DATASET = CFG["bigquery"]["dataset"]
DS = f"{GCP_PROJECT}.{DATASET}"

BQ_KEY_PATH = PROJECT_ROOT / "bigquery_key_t1.json"
if BQ_KEY_PATH.exists():
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(BQ_KEY_PATH)

# Load .env file manually (no dotenv dependency needed)
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

DISCORD_WEBHOOK = os.getenv(
    "DISCORD_WEBHOOK_REPORT",
    CFG.get("discord", {}).get("webhook_report", "")
)

# Status groups
SUCCESS_STATUSES = (3, 16)    # delivered, paid
SHIPPED_STATUSES = (2, 9)     # shipped, pending
RETURN_STATUSES = (4, 5)      # returning, returned
CANCEL_STATUSES = (6,)        # canceled


# ──────────────────────────────────────────
# BigQuery Queries
# ──────────────────────────────────────────

def query_daily_orders(client: bigquery.Client, target_date: str) -> dict:
    """Get order metrics for a specific date."""
    sql = f"""
    SELECT
        COUNT(*) as total_orders,
        COUNTIF(status IN (3, 16)) as success_orders,
        COUNTIF(status IN (4, 5)) as return_orders,
        COUNTIF(status IN (6)) as cancel_orders,
        COUNTIF(status = 8) as packing_orders,
        SUM(CASE WHEN status IN (3, 16) THEN cod ELSE 0 END) as revenue,
        SUM(CASE WHEN status IN (3, 16) THEN total_quantity ELSE 0 END) as items_sold,
        AVG(CASE WHEN status IN (3, 16) THEN cod ELSE NULL END) as avg_order_value
    FROM `{DS}.sale_order`
    WHERE DATE(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at)) = '{target_date}'
    """
    try:
        result = list(client.query(sql).result())
        if result:
            return dict(result[0])
    except Exception as e:
        log.warning(f"Error querying daily orders: {e}")
    return {}


def query_daily_ads(client: bigquery.Client, target_date: str) -> dict:
    """Get ads spend for a specific date."""
    sql = f"""
    SELECT
        COUNT(DISTINCT ad_id) as active_ads,
        SUM(SAFE_CAST(spend AS FLOAT64)) as total_spend,
        SUM(SAFE_CAST(impressions AS INT64)) as total_impressions,
        SUM(SAFE_CAST(reach AS INT64)) as total_reach
    FROM `{DS}.fb_ads_data`
    WHERE date = '{target_date}'
    """
    try:
        result = list(client.query(sql).result())
        if result:
            return dict(result[0])
    except Exception as e:
        log.warning(f"Error querying daily ads: {e}")
    return {}


def query_total_summary(client: bigquery.Client) -> dict:
    """Get overall summary metrics."""
    sql = f"""
    SELECT
        COUNT(*) as total_orders,
        COUNTIF(status IN (3, 16)) as success_orders,
        COUNTIF(status IN (4, 5)) as return_orders,
        COUNTIF(status IN (6)) as cancel_orders,
        COUNTIF(status = 8) as packing_orders,
        SUM(CASE WHEN status IN (3, 16) THEN cod ELSE 0 END) as total_revenue,
        ROUND(SAFE_DIVIDE(
            COUNTIF(status IN (3, 16)),
            NULLIF(COUNTIF(status IN (2, 3, 4, 5, 9, 16)), 0)
        ) * 100, 1) as delivery_rate_pct,
        ROUND(SAFE_DIVIDE(
            COUNTIF(status IN (4, 5)),
            NULLIF(COUNTIF(status IN (2, 3, 4, 5, 9, 16)), 0)
        ) * 100, 1) as return_rate_pct,
        MIN(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at)) as first_order,
        MAX(PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S', inserted_at)) as last_order
    FROM `{DS}.sale_order`
    """
    try:
        result = list(client.query(sql).result())
        if result:
            return dict(result[0])
    except Exception as e:
        log.warning(f"Error querying summary: {e}")
    return {}


def query_total_ads(client: bigquery.Client) -> dict:
    """Get total ads spend."""
    sql = f"""
    SELECT
        SUM(SAFE_CAST(spend AS FLOAT64)) as total_spend,
        COUNT(DISTINCT date) as days_with_ads,
        COUNT(DISTINCT ad_id) as unique_ads
    FROM `{DS}.fb_ads_data`
    """
    try:
        result = list(client.query(sql).result())
        if result:
            return dict(result[0])
    except Exception as e:
        log.warning(f"Error querying total ads: {e}")
    return {}


# ──────────────────────────────────────────
# Report Formatting
# ──────────────────────────────────────────

def fmt_num(val, decimals=0):
    """Format number with thousand separators."""
    if val is None:
        return "N/A"
    if decimals == 0:
        return f"{int(val):,}"
    return f"{val:,.{decimals}f}"


def build_daily_report(target_date: str, orders: dict, ads: dict) -> str:
    """Build Discord embed message for daily report."""
    revenue = orders.get("revenue", 0) or 0
    total_orders = orders.get("total_orders", 0) or 0
    success = orders.get("success_orders", 0) or 0
    returns = orders.get("return_orders", 0) or 0
    cancels = orders.get("cancel_orders", 0) or 0
    packing = orders.get("packing_orders", 0) or 0
    aov = orders.get("avg_order_value", 0) or 0

    spend = ads.get("total_spend", 0) or 0
    active_ads = ads.get("active_ads", 0) or 0

    # Calculate ROAS (revenue VND / spend USD * rate)
    # Assuming VND, no conversion needed for display
    roas = revenue / spend if spend > 0 else 0

    # Delivery rate for shipped orders
    shipped_total = success + returns
    delivery_rate = (success / shipped_total * 100) if shipped_total > 0 else 0

    lines = [
        f"📊 **BÁO CÁO NGÀY {target_date}** — T1 Slovakia",
        "",
        "**━━━ 💰 DOANH THU ━━━**",
        f"🟢 Doanh thu (COD):  **{fmt_num(revenue)} VND**",
        f"📦 Đơn thành công:   **{success}** / {total_orders} đơn",
        f"🧾 Giá trị TB/đơn:   {fmt_num(aov)} VND",
        "",
        "**━━━ 📢 QUẢNG CÁO ━━━**",
        f"💸 Chi ads:          **${fmt_num(spend, 2)} USD**",
        f"📣 Ads active:       {active_ads}",
        f"📈 ROAS:             **{fmt_num(roas, 1)}x**",
        "",
        "**━━━ 📋 ĐƠN HÀNG ━━━**",
        f"📥 Tổng đơn mới:     {total_orders}",
        f"✅ Thành công:       {success}",
        f"🔴 Hoàn trả:         {returns}",
        f"⚫ Hủy:              {cancels}",
        f"📦 Đang đóng hàng:   {packing}",
        f"🚚 Tỷ lệ giao:      **{delivery_rate:.1f}%**",
    ]

    if total_orders == 0 and spend == 0:
        lines = [
            f"📊 **BÁO CÁO NGÀY {target_date}** — T1 Slovakia",
            "",
            "ℹ️ Không có dữ liệu cho ngày này.",
        ]

    return "\n".join(lines)


def build_summary_report(orders: dict, ads: dict) -> str:
    """Build overall summary report."""
    revenue = orders.get("total_revenue", 0) or 0
    total = orders.get("total_orders", 0) or 0
    success = orders.get("success_orders", 0) or 0
    returns = orders.get("return_orders", 0) or 0
    cancels = orders.get("cancel_orders", 0) or 0
    packing = orders.get("packing_orders", 0) or 0
    delivery_rate = orders.get("delivery_rate_pct", 0) or 0
    return_rate = orders.get("return_rate_pct", 0) or 0
    first_order = orders.get("first_order", "N/A")
    last_order = orders.get("last_order", "N/A")

    spend = ads.get("total_spend", 0) or 0
    days = ads.get("days_with_ads", 0) or 0
    unique_ads = ads.get("unique_ads", 0) or 0

    roas = revenue / spend if spend > 0 else 0
    conv_rate = (success / total * 100) if total > 0 else 0

    lines = [
        "📊 **TỔNG KẾT TOÀN BỘ** — T1 Slovakia",
        f"📅 Từ: {first_order} → {last_order}",
        "",
        "**━━━ 💰 DOANH THU ━━━**",
        f"🟢 Tổng doanh thu:   **{fmt_num(revenue)} VND**",
        f"📦 Đơn thành công:   **{success}** / {total}",
        f"💵 TB/đơn:           {fmt_num(revenue / success if success else 0)} VND",
        "",
        "**━━━ 📢 QUẢNG CÁO ━━━**",
        f"💸 Tổng chi ads:     **${fmt_num(spend, 2)} USD**",
        f"📅 Ngày chạy ads:    {days}",
        f"📣 Tổng ads:         {unique_ads}",
        f"📈 ROAS:             **{roas:.1f}x**",
        "",
        "**━━━ 📋 HIỆU SUẤT ━━━**",
        f"📥 Tổng đơn:         {total}",
        f"✅ Thành công:       {success} ({conv_rate:.1f}%)",
        f"🔴 Hoàn trả:         {returns} ({return_rate}%)",
        f"⚫ Hủy:              {cancels}",
        f"📦 Đang đóng hàng:   {packing}",
        f"🚚 Tỷ lệ giao:      **{delivery_rate}%**",
        f"↩️ Tỷ lệ hoàn:       {return_rate}%",
    ]

    return "\n".join(lines)


# ──────────────────────────────────────────
# Discord Send
# ──────────────────────────────────────────

def send_to_discord(message: str):
    """Send report to Discord webhook."""
    if not DISCORD_WEBHOOK:
        log.warning("Discord webhook not configured. Message:\n" + message)
        print("\n" + message)
        return False

    payload = {"content": message}
    try:
        resp = requests.post(DISCORD_WEBHOOK, json=payload, timeout=15)
        if resp.status_code in (200, 204):
            log.info("✅ Report sent to Discord!")
            return True
        else:
            log.error(f"Discord error: {resp.status_code} {resp.text}")
            return False
    except Exception as e:
        log.error(f"Discord send failed: {e}")
        print("\n📋 Report (Discord unavailable):\n" + message)
        return False


# ──────────────────────────────────────────
# Main
# ──────────────────────────────────────────

def main():
    is_summary = "--summary" in sys.argv

    # Determine target date
    target_date = None
    if "--date" in sys.argv:
        idx = sys.argv.index("--date")
        if idx + 1 < len(sys.argv):
            target_date = sys.argv[idx + 1]
    elif "--today" in sys.argv:
        target_date = date.today().isoformat()
    elif not is_summary:
        target_date = (date.today() - timedelta(days=1)).isoformat()

    log.info("=" * 50)
    log.info("  T1 Daily Report")
    log.info(f"  Mode: {'Summary' if is_summary else f'Daily ({target_date})'}")
    log.info("=" * 50)

    client = bigquery.Client(project=GCP_PROJECT)

    if is_summary:
        # Overall summary
        log.info("Querying overall summary...")
        orders = query_total_summary(client)
        ads = query_total_ads(client)
        message = build_summary_report(orders, ads)
    else:
        # Daily report
        log.info(f"Querying data for {target_date}...")
        orders = query_daily_orders(client, target_date)
        ads = query_daily_ads(client, target_date)
        message = build_daily_report(target_date, orders, ads)

    log.info("\n" + message)
    send_to_discord(message)


if __name__ == "__main__":
    main()
