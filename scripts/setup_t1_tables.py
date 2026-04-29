#!/usr/bin/env python3
"""
Setup T1 BigQuery Tables & Views
Creates all core data tables and views in T1_Dataset.
"""

from google.cloud import bigquery

client = bigquery.Client()
PROJECT = "levelup-465304"
DATASET = "T1_Dataset"
DS = f"{PROJECT}.{DATASET}"

# ========================================
# 1. Core Tables
# ========================================
tables_sql = {
    "sale_order": f"""CREATE TABLE IF NOT EXISTS `{DS}.sale_order` (
      id STRING, system_id INT64, shop_id STRING, shop_name STRING, project_id STRING,
      status INT64, status_name STRING, sub_status STRING,
      cod FLOAT64, prepaid FLOAT64, total_price FLOAT64, total_price_after_sub_discount FLOAT64, total_discount FLOAT64,
      shipping_fee FLOAT64, partner_fee FLOAT64, return_fee FLOAT64, fee_marketplace FLOAT64, surcharge FLOAT64, tax FLOAT64, customer_pay_fee FLOAT64,
      cash FLOAT64, transfer_money FLOAT64, charged_by_card FLOAT64, charged_by_momo FLOAT64, charged_by_qrpay FLOAT64, money_to_collect FLOAT64, prepaid_by_point FLOAT64, buyer_total_amount FLOAT64,
      total_quantity INT64, items_length INT64,
      bill_full_name STRING, bill_phone_number STRING, bill_email STRING, customer_id STRING, customer_name STRING,
      shipping_address STRING, shipping_province STRING, shipping_district STRING,
      marketer STRING, pke_mkter STRING, assigning_seller_id STRING, assigning_care_id STRING, creator STRING, account_name STRING,
      ad_id STRING, adset_id STRING, ads_source STRING, p_utm_source STRING, p_utm_campaign STRING, p_utm_medium STRING, p_utm_content STRING, p_utm_term STRING, p_utm_id STRING,
      order_sources_name STRING, page_id STRING, conversation_id STRING, post_id STRING, is_livestream BOOL, is_live_shopping BOOL,
      partner STRING, tracking_link STRING, warehouse_id STRING, order_currency STRING, is_exchange_order BOOL, is_free_shipping BOOL,
      inserted_at STRING, updated_at STRING, time_send_partner STRING, estimate_delivery_date STRING,
      note STRING, tags STRING, order_link STRING, sync_time TIMESTAMP
    )""",

    "order_items": f"""CREATE TABLE IF NOT EXISTS `{DS}.order_items` (
      item_id STRING, order_id STRING, order_system_id INT64, shop_id STRING, shop_name STRING, project_id STRING,
      product_id STRING, variation_id STRING, product_name STRING, variation_name STRING, barcode STRING,
      quantity INT64, return_quantity INT64, returned_count INT64, returning_quantity INT64,
      retail_price FLOAT64, discount_each_product FLOAT64, total_discount FLOAT64, same_price_discount FLOAT64, avg_imported_price FLOAT64,
      is_bonus_product BOOL, is_composite BOOL, is_wholesale BOOL,
      order_inserted_at STRING, sync_time TIMESTAMP
    )""",

    "product_template": f"""CREATE TABLE IF NOT EXISTS `{DS}.product_template` (
      id STRING, shop_id STRING, shop_name STRING, project_id STRING, custom_id STRING, display_id INT64,
      name STRING, type STRING, image STRING, note_product STRING, categories STRING, tags STRING,
      is_published BOOL, is_sell_negative BOOL, inserted_at STRING, sync_time TIMESTAMP
    )""",

    "product_variations": f"""CREATE TABLE IF NOT EXISTS `{DS}.product_variations` (
      id STRING, product_id STRING, shop_id STRING, shop_name STRING, project_id STRING,
      display_id STRING, barcode STRING, retail_price FLOAT64, retail_price_after_discount FLOAT64,
      average_imported_price FLOAT64, last_imported_price FLOAT64, price_at_counter FLOAT64,
      remain_quantity INT64, weight FLOAT64, is_hidden BOOL, is_locked BOOL, is_composite BOOL,
      inserted_at STRING, sync_time TIMESTAMP
    )""",

    "customers": f"""CREATE TABLE IF NOT EXISTS `{DS}.customers` (
      id STRING, customer_id STRING, shop_id STRING, shop_name STRING, project_id STRING,
      name STRING, phone_numbers STRING, emails STRING, gender STRING, date_of_birth STRING,
      order_count INT64, succeed_order_count INT64, returned_order_count INT64,
      purchased_amount FLOAT64, current_debts FLOAT64, reward_point INT64, used_reward_point INT64,
      referral_code STRING, level STRING, tags STRING, is_block BOOL,
      inserted_at STRING, updated_at STRING, sync_time TIMESTAMP
    )""",

    "fb_ads_data": f"""CREATE TABLE IF NOT EXISTS `{DS}.fb_ads_data` (
      ad_id STRING, ad_name STRING, adset_id STRING, adset_name STRING,
      campaign_id STRING, campaign_name STRING, account_id STRING,
      date STRING, spend FLOAT64, impressions INT64, reach INT64, clicks INT64,
      cpm FLOAT64, cpc FLOAT64, ctr FLOAT64, purchases INT64, purchase_value FLOAT64,
      messaging_conversations INT64, sync_time TIMESTAMP
    )""",

    "fb_adset_data": f"""CREATE TABLE IF NOT EXISTS `{DS}.fb_adset_data` (
      adset_id STRING, adset_name STRING, date STRING,
      spend FLOAT64, impressions INT64, reach INT64, clicks INT64,
      cpm FLOAT64, cpc FLOAT64, ctr FLOAT64, purchases INT64, purchase_value FLOAT64,
      messaging_conversations INT64, campaign_id STRING, campaign_name STRING, account_id STRING,
      sync_time TIMESTAMP
    )""",

    "fb_campaign_data": f"""CREATE TABLE IF NOT EXISTS `{DS}.fb_campaign_data` (
      campaign_id STRING, campaign_name STRING, account_id STRING,
      date STRING, spend FLOAT64, impressions INT64, reach INT64, clicks INT64,
      cpm FLOAT64, cpc FLOAT64, ctr FLOAT64, purchases INT64, purchase_value FLOAT64,
      sync_time TIMESTAMP
    )""",

    "staging_sale_order": f"""CREATE TABLE IF NOT EXISTS `{DS}.staging_sale_order` (
      id STRING, system_id INT64, shop_id STRING, shop_name STRING, project_id STRING,
      status INT64, status_name STRING, sub_status STRING,
      cod FLOAT64, prepaid FLOAT64, total_price FLOAT64, total_price_after_sub_discount FLOAT64, total_discount FLOAT64,
      shipping_fee FLOAT64, partner_fee FLOAT64, return_fee FLOAT64, fee_marketplace FLOAT64, surcharge FLOAT64, tax FLOAT64, customer_pay_fee FLOAT64,
      cash FLOAT64, transfer_money FLOAT64, charged_by_card FLOAT64, charged_by_momo FLOAT64, charged_by_qrpay FLOAT64, money_to_collect FLOAT64, prepaid_by_point FLOAT64, buyer_total_amount FLOAT64,
      total_quantity INT64, items_length INT64,
      bill_full_name STRING, bill_phone_number STRING, bill_email STRING, customer_id STRING, customer_name STRING,
      shipping_address STRING, shipping_province STRING, shipping_district STRING,
      marketer STRING, pke_mkter STRING, assigning_seller_id STRING, assigning_care_id STRING, creator STRING, account_name STRING,
      ad_id STRING, adset_id STRING, ads_source STRING, p_utm_source STRING, p_utm_campaign STRING, p_utm_medium STRING, p_utm_content STRING, p_utm_term STRING, p_utm_id STRING,
      order_sources_name STRING, page_id STRING, conversation_id STRING, post_id STRING, is_livestream BOOL, is_live_shopping BOOL,
      partner STRING, tracking_link STRING, warehouse_id STRING, order_currency STRING, is_exchange_order BOOL, is_free_shipping BOOL,
      inserted_at STRING, updated_at STRING, time_send_partner STRING, estimate_delivery_date STRING,
      note STRING, tags STRING, order_link STRING, sync_time TIMESTAMP
    )""",

    "staging_order_items": f"""CREATE TABLE IF NOT EXISTS `{DS}.staging_order_items` (
      item_id STRING, order_id STRING, order_system_id INT64, shop_id STRING, shop_name STRING, project_id STRING,
      product_id STRING, variation_id STRING, product_name STRING, variation_name STRING, barcode STRING,
      quantity INT64, return_quantity INT64, returned_count INT64, returning_quantity INT64,
      retail_price FLOAT64, discount_each_product FLOAT64, total_discount FLOAT64, same_price_discount FLOAT64, avg_imported_price FLOAT64,
      is_bonus_product BOOL, is_composite BOOL, is_wholesale BOOL,
      order_inserted_at STRING, sync_time TIMESTAMP
    )""",

    "staging_fb_ads_data": f"""CREATE TABLE IF NOT EXISTS `{DS}.staging_fb_ads_data` (
      ad_id STRING, ad_name STRING, adset_id STRING, adset_name STRING,
      campaign_id STRING, campaign_name STRING, account_id STRING,
      date STRING, spend FLOAT64, impressions INT64, reach INT64, clicks INT64,
      cpm FLOAT64, cpc FLOAT64, ctr FLOAT64, purchases INT64, purchase_value FLOAT64,
      messaging_conversations INT64, sync_time TIMESTAMP
    )""",

    "dim_shop_project": f"""CREATE TABLE IF NOT EXISTS `{DS}.dim_shop_project` (
      shop_id STRING, shop_name STRING, project_id STRING, project_name STRING,
      market_code STRING, market_name STRING, currency STRING, currency_divisor INT64,
      dataset_name STRING, pos_type STRING, ads_match_type STRING, is_active BOOL, notes STRING
    )""",

    "dim_status_mapping": f"""CREATE TABLE IF NOT EXISTS `{DS}.dim_status_mapping` (
      status_code INT64, status_name STRING, status_group STRING,
      display_name STRING, is_final BOOL, revenue_impact STRING, sort_order INT64
    )""",

    "dim_marketer": f"""CREATE TABLE IF NOT EXISTS `{DS}.dim_marketer` (
      marketer_id STRING, marketer_name STRING, project_id STRING,
      role STRING, team STRING, is_active BOOL
    )""",

    "page_marketer": f"""CREATE TABLE IF NOT EXISTS `{DS}.page_marketer` (
      page_id STRING, page_name STRING, marketer_id STRING, marketer_name STRING,
      project_id STRING, assigned_date DATE, is_active BOOL, notes STRING
    )""",

    "cost_exchange_rates": f"""CREATE TABLE IF NOT EXISTS `{DS}.cost_exchange_rates` (
      from_currency STRING, to_currency STRING, rate FLOAT64, effective_date DATE
    )""",

    "product_cogs": f"""CREATE TABLE IF NOT EXISTS `{DS}.product_cogs` (
      product_id STRING, product_name STRING, cogs_per_unit FLOAT64, currency STRING, effective_date DATE
    )""",

    "sale_combo": f"""CREATE TABLE IF NOT EXISTS `{DS}.sale_combo` (
      order_id STRING, combo_id STRING, combo_custom_id STRING, combo_name STRING,
      quantity INT64, combo_value FLOAT64, shop_id STRING, currency_code STRING, sync_time TIMESTAMP
    )""",

    "combo_items": f"""CREATE TABLE IF NOT EXISTS `{DS}.combo_items` (
      combo_id STRING, product_template_id STRING, product_custom_id STRING, product_name STRING,
      quantity_in_combo INT64, is_revenue_product BOOL, shop_id STRING, notes STRING
    )""",
}

# ========================================
# 2. Views (order matters — deps first)
# ========================================
views_sql = {
    "vw_sale_order_dedup": f"""CREATE OR REPLACE VIEW `{DS}.vw_sale_order_dedup` AS
    SELECT * EXCEPT(rn) FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY sync_time DESC) as rn
      FROM `{DS}.sale_order`
    ) WHERE rn = 1""",

    "vw_fb_ads_data_dedup": f"""CREATE OR REPLACE VIEW `{DS}.vw_fb_ads_data_dedup` AS
    SELECT * EXCEPT(rn) FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY ad_id, date ORDER BY spend DESC) as rn
      FROM `{DS}.fb_ads_data`
    ) WHERE rn = 1""",

    "vw_dashboard_overview": f"""CREATE OR REPLACE VIEW `{DS}.vw_dashboard_overview` AS
    SELECT
      SAFE_CAST(SUBSTR(o.inserted_at, 1, 10) AS DATE) AS order_date,
      'Default' AS shop_group,
      'T1' AS project,
      COUNT(DISTINCT o.id) AS total_orders,
      COUNT(DISTINCT CASE WHEN CAST(o.status AS INT64) IN (3,4) THEN o.id END) AS success_orders,
      COUNT(DISTINCT CASE WHEN CAST(o.status AS INT64) = -1 THEN o.id END) AS returned_orders,
      COUNT(DISTINCT CASE WHEN CAST(o.status AS INT64) = -2 THEN o.id END) AS cancelled_orders,
      ROUND(SUM(CASE WHEN CAST(o.status AS INT64) IN (3,4) THEN CAST(o.total_price AS FLOAT64) ELSE 0 END), 2) AS gross_revenue,
      COUNT(DISTINCT o.bill_phone_number) AS unique_customers
    FROM `{DS}.vw_sale_order_dedup` o
    GROUP BY 1, 2, 3""",

    "vw_fact_ads_performance": f"""CREATE OR REPLACE VIEW `{DS}.vw_fact_ads_performance` AS
    WITH exchange AS (
      SELECT COALESCE(
        (SELECT rate FROM `{DS}.cost_exchange_rates`
         WHERE from_currency = 'USD' AND to_currency = 'VND'
         ORDER BY effective_date DESC LIMIT 1),
        25000
      ) AS usd_to_vnd
    ),
    ads_raw AS (
      SELECT
        a.ad_id, a.ad_name, a.adset_id, a.campaign_id, a.campaign_name, a.account_id,
        SAFE_CAST(a.date AS DATE) AS report_date,
        CAST(a.spend AS FLOAT64) AS spend,
        COALESCE(SAFE_CAST(a.impressions AS INT64), 0) AS impressions,
        COALESCE(SAFE_CAST(a.clicks AS INT64), 0) AS clicks,
        COALESCE(SAFE_CAST(a.purchases AS INT64), 0) AS purchases,
        COALESCE(SAFE_CAST(a.purchase_value AS FLOAT64), 0) AS purchase_value
      FROM `{DS}.vw_fb_ads_data_dedup` a
    )
    SELECT
      r.*, e.usd_to_vnd,
      ROUND(r.spend * e.usd_to_vnd, 0) AS spend_vnd
    FROM ads_raw r
    CROSS JOIN exchange e""",

    "daily_performance": f"""CREATE OR REPLACE VIEW `{DS}.daily_performance` AS
    SELECT
      COALESCE(o.order_date, a.report_date) AS report_date,
      o.shop_group,
      o.project,
      IFNULL(o.total_orders, 0) AS total_orders,
      IFNULL(o.success_orders, 0) AS success_orders,
      IFNULL(o.gross_revenue, 0) AS gross_revenue,
      IFNULL(o.unique_customers, 0) AS unique_customers,
      a.campaign_id,
      a.campaign_name,
      IFNULL(a.ads_spend, 0) AS ads_spend,
      IFNULL(a.impressions, 0) AS impressions,
      IFNULL(a.clicks, 0) AS clicks,
      IFNULL(a.purchases, 0) AS purchases
    FROM (
      SELECT order_date, shop_group, project, total_orders, success_orders, gross_revenue, unique_customers
      FROM `{DS}.vw_dashboard_overview`
    ) o
    FULL OUTER JOIN (
      SELECT
        report_date, campaign_id, campaign_name,
        SUM(spend_vnd) AS ads_spend,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(purchases) AS purchases
      FROM `{DS}.vw_fact_ads_performance`
      GROUP BY report_date, campaign_id, campaign_name
    ) a
    ON o.order_date = a.report_date""",
}


def main():
    print("=" * 50)
    print("  T1 Dataset -- Table & View Setup")
    print("=" * 50)

    # Tables
    print("\n[1/2] Creating tables...")
    ok_count = 0
    for name, sql in tables_sql.items():
        try:
            client.query(sql).result()
            print(f"  [OK] {name}")
            ok_count += 1
        except Exception as e:
            print(f"  [ERR] {name}: {e}")
    print(f"  -> {ok_count}/{len(tables_sql)} tables created")

    # Views
    print("\n[2/2] Creating views...")
    ok_count = 0
    for name, sql in views_sql.items():
        try:
            client.query(sql).result()
            print(f"  [OK] {name}")
            ok_count += 1
        except Exception as e:
            print(f"  [ERR] {name}: {e}")
    print(f"  -> {ok_count}/{len(views_sql)} views created")

    # Summary
    tables = list(client.list_tables(f"{PROJECT}.{DATASET}"))
    print(f"\n{'=' * 50}")
    print(f"  Total objects in T1_Dataset: {len(tables)}")
    print(f"{'=' * 50}")
    for t in sorted(tables, key=lambda x: (x.table_type, x.table_id)):
        print(f"  {t.table_type:5s}  {t.table_id}")


if __name__ == "__main__":
    main()
