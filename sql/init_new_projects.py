#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════╗
║  PHASE 1: Initialize New Project Datasets                    ║
║  Creates ZEN8_Dataset, TRENDIFY_Dataset, HNLE_Dataset        ║
║  Architecture Standard: STRAMARK_Dataset                     ║
║  WARNING: Zen8_Dataset = READ-ONLY reference, NOT modified   ║
╚══════════════════════════════════════════════════════════════╝
"""
import os, sys, json
from datetime import date

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "/Users/tatthanh031298/Desktop/AUUS/bigquery_key.json"
from google.cloud import bigquery

client = bigquery.Client(project="levelup-465304")
GCP_PROJECT = "levelup-465304"

# ════════════════════════════════════════════════════════════════
# PROJECT CONFIGS
# ════════════════════════════════════════════════════════════════
PROJECTS = {
    "ZEN8": {
        "dataset": "ZEN8_Dataset",
        "project_name": "Zen8",
        "shops": [
            {"shop_id": "714234971", "shop_name": "ZEN8-ME", "market_code": "ME",
             "market_name": "Middle East", "currency": "USD", "currency_divisor": 1,
             "pos_type": "poscake", "ads_match_type": "ad_id", "notes": "Primary Zen8 shop"},
        ],
        "ad_accounts": [
            ("965011415652127", "ZEN8 02", "USD", "ZN8"),
            ("1241761350559164", "ZN8_UAE(Hexing)_05", "USD", "ZN8"),
            ("1078363024398786", "ZN8_UAE(Hexing)_03", "USD", "ZN8"),
            ("1432497617797009", "ZN8_UAE(Hexing)_06", "USD", "ZN8"),
            ("1300351188365797", "ZN8_UAE(Hexing)_04", "USD", "ZN8"),
            ("1148472697119951", "ZN8_UAE(Hexing)_07", "USD", "ZN8"),
            ("3041766905994211", "ZN8_KWT(Hexing)_08", "USD", "ZN8"),
            ("1591357458727608", "ZN8_UAE(Dufei)_11", "USD", "ZN8"),
            ("901293159515991", "ZN8_UAE(Dufei)_10", "USD", "ZN8"),
            ("870646655894511", "ZN8_UAE(Dufei)_12", "USD", "ZN8"),
            ("1691575898673054", "ZN8_(Ruixi)KWT_13", "USD", "ZN8"),
            ("1223734626141889", "ZN8_KWT(Ruixi)_14", "USD", "ZN8"),
            ("2153130052166200", "ZN8_KWT(Hexing)_15", "USD", "ZN8"),
            ("929081426187729", "ZN8_UAE(Ruixin)_15", "USD", "ZN8"),
        ],
    },
    "TRENDIFY": {
        "dataset": "TRENDIFY_Dataset",
        "project_name": "Trendify",
        "shops": [
            {"shop_id": "407220179", "shop_name": "TRENDIFY-US", "market_code": "US",
             "market_name": "United States", "currency": "USD", "currency_divisor": 1,
             "pos_type": "poscake", "ads_match_type": "ad_id", "notes": "Trendify US shop"},
            {"shop_id": "407925623", "shop_name": "SRN-Romania", "market_code": "RO",
             "market_name": "Romania", "currency": "RON", "currency_divisor": 100,
             "pos_type": "poscake", "ads_match_type": "ad_id", "notes": "SRN Romania shop (was mapped to STRAMARK in legacy)"},
        ],
        "ad_accounts": [
            ("2025588411315168", "TDF_RO_01", "USD", "SRN"),
            ("4420197331549301", "TDF_RO(Dufei)_03", "USD", "SRN"),
        ],
    },
    "HNLE": {
        "dataset": "HNLE_Dataset",
        "project_name": "HNLE",
        "shops": [
            {"shop_id": "1942963908", "shop_name": "HNLE-ME", "market_code": "ME",
             "market_name": "Middle East", "currency": "USD", "currency_divisor": 1,
             "pos_type": "poscake", "ads_match_type": "ad_id", "notes": "HNLE Trung Đông"},
            {"shop_id": "1942963943", "shop_name": "HNLE-AU", "market_code": "AU",
             "market_name": "Australia", "currency": "AUD", "currency_divisor": 1,
             "pos_type": "poscake", "ads_match_type": "ad_id", "notes": "HNLE Úc"},
        ],
        "ad_accounts": [
            ("4436251663362042", "TDF_UC(Dufei)_01", "USD", "HNLE"),
            ("862258773090270", "HNLE_UC_01", "USD", "HNLE"),
            ("1801091267209683", "NHAT TK 07", "USD", "HNLE"),
            ("2013093525898990", "NHAT TK 06", "USD", "HNLE"),
            ("1188914743330947", "DUC TK 03", "USD", "HNLE"),
            ("850593750862900", "TUNG TK 05", "USD", "HNLE"),
        ],
    },
    "AUUS1": {
        "dataset": "AUUS1_Dataset",
        "project_name": "PiAlpha US-AU",
        "shops": [
            {"shop_id": "100197417", "shop_name": "AUUS1-US", "market_code": "US",
             "market_name": "United States", "currency": "USD", "currency_divisor": 100,
             "pos_type": "poscake", "ads_match_type": "ad_id", "notes": "US shop"},
            {"shop_id": "1328333296", "shop_name": "AUUS1-AU", "market_code": "AU",
             "market_name": "Australia", "currency": "AUD", "currency_divisor": 100,
             "pos_type": "poscake", "ads_match_type": "ad_id", "notes": "AU shop"},
        ],
        "ad_accounts": [
            ("2002604803685498", "AUUS1 AU", "USD", "AUUS1"),
            ("900537852593889", "AUUS1 US", "USD", "AUUS1"),
            ("2026217937936451", "AUUS1 US 2", "USD", "AUUS1"),
        ],
    },
}

# ════════════════════════════════════════════════════════════════
# DDL: RAW TABLES
# ════════════════════════════════════════════════════════════════
RAW_TABLES_DDL = {
    "fb_ads_data": """
CREATE TABLE IF NOT EXISTS `{DATASET}.fb_ads_data` (
    ad_id STRING,
    ad_name STRING,
    adset_id STRING,
    adset_name STRING,
    campaign_id STRING,
    campaign_name STRING,
    spend FLOAT64,
    impressions INT64,
    reach INT64,
    clicks INT64,
    purchases INT64,
    date STRING,
    account_id STRING,
    sync_time STRING,
    leads FLOAT64,
    messaging_conversations_started INT64,
    add_to_cart INT64,
    cpm FLOAT64,
    ctr FLOAT64,
    cpc FLOAT64,
    frequency FLOAT64
)""",
    "fb_adset_data": """
CREATE TABLE IF NOT EXISTS `{DATASET}.fb_adset_data` (
    adset_id STRING,
    adset_name STRING,
    campaign_id STRING,
    campaign_name STRING,
    spend FLOAT64,
    impressions INT64,
    reach INT64,
    clicks INT64,
    date STRING,
    account_id STRING,
    sync_time STRING
)""",
    "fb_campaign_data": """
CREATE TABLE IF NOT EXISTS `{DATASET}.fb_campaign_data` (
    campaign_id STRING,
    campaign_name STRING,
    account_id STRING,
    project_id STRING,
    daily_budget STRING,
    status STRING,
    objective STRING,
    bid_strategy STRING,
    date STRING,
    sync_time STRING
)""",
    "sale_order": """
CREATE TABLE IF NOT EXISTS `{DATASET}.sale_order` (
    id STRING,
    pos_id STRING,
    customer_id STRING,
    customer_name STRING,
    customer_phone STRING,
    status INT64,
    note STRING,
    total_price FLOAT64,
    cod FLOAT64,
    partner_debt FLOAT64,
    total_discounts FLOAT64,
    shipping_fee FLOAT64,
    total_final FLOAT64,
    currency STRING,
    payment_method STRING,
    from_page_id STRING,
    from_page_name STRING,
    from_shop_id STRING,
    from_shop_name STRING,
    created_at STRING,
    updated_at STRING,
    inserted_at STRING,
    tracking_number STRING,
    carrier STRING,
    shipping_partner STRING,
    city STRING,
    district STRING,
    ward STRING,
    address STRING,
    province STRING,
    country STRING,
    country_code STRING,
    utm_source STRING,
    utm_medium STRING,
    utm_campaign STRING,
    utm_content STRING,
    utm_term STRING,
    sync_time STRING
)""",
    "sale_order_line": """
CREATE TABLE IF NOT EXISTS `{DATASET}.sale_order_line` (
    item_id STRING,
    order_id STRING,
    shop_id STRING,
    shop_name STRING,
    project_id STRING,
    product_id STRING,
    variation_id STRING,
    product_name STRING,
    variation_name STRING,
    barcode STRING,
    quantity INT64,
    return_quantity INT64,
    retail_price FLOAT64,
    discount_each_product FLOAT64,
    avg_imported_price FLOAT64,
    is_bonus_product STRING,
    order_date DATE,
    order_inserted_at STRING,
    sync_time STRING,
    product_code STRING,
    order_status INT64,
    margin_per_unit FLOAT64,
    margin_pct FLOAT64,
    line_cogs FLOAT64,
    line_revenue FLOAT64
)""",
    "customers": """
CREATE TABLE IF NOT EXISTS `{DATASET}.customers` (
    customer_id STRING,
    name STRING,
    phone STRING,
    email STRING,
    from_shop_id STRING,
    from_shop_name STRING,
    from_page_id STRING,
    from_page_name STRING,
    address STRING,
    city STRING,
    district STRING,
    ward STRING,
    country STRING,
    created_at STRING,
    updated_at STRING,
    sync_time STRING
)""",
    "product_template": """
CREATE TABLE IF NOT EXISTS `{DATASET}.product_template` (
    product_id STRING,
    product_custom_id STRING,
    product_name STRING,
    create_at STRING,
    product_note STRING,
    product_attributes STRING,
    shop_id STRING,
    updated_at STRING
)""",
    "product_variations": """
CREATE TABLE IF NOT EXISTS `{DATASET}.product_variations` (
    product_variation_id STRING,
    product_variation_display_id STRING,
    product_variation_barcode STRING,
    image_link STRING,
    product_id STRING,
    created_at STRING,
    is_composite STRING,
    is_hidden STRING,
    is_locked STRING,
    is_removed STRING,
    is_sell_negative_variation STRING,
    weight FLOAT64,
    updated_at STRING
)""",
    "ffm_shipments": """
CREATE TABLE IF NOT EXISTS `{DATASET}.ffm_shipments` (
    awb STRING NOT NULL,
    ref_number STRING,
    pos_order_id STRING,
    ffm_partner STRING,
    client_id STRING,
    status STRING,
    price_excl_vat FLOAT64,
    price_incl_vat FLOAT64,
    vat_rate FLOAT64,
    currency STRING,
    is_return_shipment BOOL,
    original_order_id STRING,
    cod_amount FLOAT64,
    created_date TIMESTAMP,
    delivered_date TIMESTAMP,
    returned_date TIMESTAMP,
    raw_response STRING,
    synced_at TIMESTAMP,
    sync_source STRING,
    payout_date TIMESTAMP
)""",
}

# ════════════════════════════════════════════════════════════════
# DDL: DIM TABLES
# ════════════════════════════════════════════════════════════════
DIM_TABLES_DDL = {
    "dim_shop_project": """
CREATE TABLE IF NOT EXISTS `{DATASET}.dim_shop_project` (
    shop_id STRING NOT NULL,
    shop_name STRING,
    project_id STRING NOT NULL,
    project_name STRING,
    market_code STRING,
    market_name STRING,
    currency STRING,
    currency_divisor INT64 DEFAULT 1,
    dataset_name STRING,
    pos_type STRING DEFAULT 'poscake',
    ads_match_type STRING DEFAULT 'ad_id',
    is_active BOOL DEFAULT TRUE,
    notes STRING
)""",
    "dim_marketer": """
CREATE TABLE IF NOT EXISTS `{DATASET}.dim_marketer` (
    marketer_id STRING NOT NULL,
    marketer_name STRING,
    project_id STRING,
    role STRING,
    team STRING,
    is_active BOOL DEFAULT TRUE
)""",
    "dim_marketer_mapping": """
CREATE TABLE IF NOT EXISTS `{DATASET}.dim_marketer_mapping` (
    raw_name STRING,
    campaign_code STRING,
    marketer_id STRING,
    marketer_name STRING,
    project_id STRING
)""",
    "dim_product_prices": """
CREATE TABLE IF NOT EXISTS `{DATASET}.dim_product_prices` (
    product_id STRING,
    variation_id STRING,
    product_code STRING,
    product_name STRING,
    retail_price INT64,
    imported_price INT64,
    effective_from DATE,
    effective_to DATE,
    source STRING,
    updated_at TIMESTAMP
)""",
    "dim_status_mapping": """
CREATE TABLE IF NOT EXISTS `{DATASET}.dim_status_mapping` (
    status_code INT64 NOT NULL,
    status_name STRING,
    status_group STRING NOT NULL,
    display_name STRING,
    is_final BOOL DEFAULT FALSE,
    revenue_impact STRING,
    sort_order INT64
)""",
    "dim_country_payment": """
CREATE TABLE IF NOT EXISTS `{DATASET}.dim_country_payment` (
    country_code STRING NOT NULL,
    country_name STRING NOT NULL,
    payment_model STRING NOT NULL,
    region STRING NOT NULL,
    currency STRING NOT NULL,
    requires_dual_roas BOOL NOT NULL
)""",
    "cost_exchange_rates": """
CREATE TABLE IF NOT EXISTS `{DATASET}.cost_exchange_rates` (
    from_currency STRING NOT NULL,
    to_currency STRING NOT NULL,
    rate FLOAT64 NOT NULL,
    effective_date DATE NOT NULL,
    source STRING
)""",
    "ads_account": """
CREATE TABLE IF NOT EXISTS `{DATASET}.ads_account` (
    account_id STRING NOT NULL,
    account_name STRING,
    platform STRING DEFAULT 'Facebook',
    currency_id STRING,
    spend_cap FLOAT64,
    amount_spent FLOAT64,
    balance FLOAT64,
    status STRING DEFAULT 'ACTIVE',
    project_id STRING,
    created_at DATE,
    updated_at TIMESTAMP
)""",
}

# ════════════════════════════════════════════════════════════════
# DDL: AI AGENT TABLES  
# ════════════════════════════════════════════════════════════════
AI_TABLES_DDL = {
    "ai_prediction_log": """
CREATE TABLE IF NOT EXISTS `{DATASET}.ai_prediction_log` (
    prediction_id STRING,
    prediction_date DATE,
    agent STRING,
    project_id STRING,
    run_id STRING,
    metric STRING,
    entity_type STRING,
    entity_id STRING,
    entity_name STRING,
    predicted_value FLOAT64,
    actual_value FLOAT64,
    accuracy_pct FLOAT64,
    direction_correct BOOL,
    confidence_pct FLOAT64,
    reasoning STRING,
    evaluated_at TIMESTAMP,
    report_date DATE,
    created_at TIMESTAMP
)""",
    "approval_logs": """
CREATE TABLE IF NOT EXISTS `{DATASET}.approval_logs` (
    log_id STRING,
    decision_id STRING,
    agent STRING,
    project_id STRING,
    action STRING,
    entity_type STRING,
    entity_id STRING,
    entity_name STRING,
    change_detail STRING,
    change_value_before FLOAT64,
    change_value_after FLOAT64,
    reasoning STRING,
    risk_level INT64,
    approval_status STRING,
    approved_by STRING,
    approval_channel STRING,
    meta_api_response STRING,
    meta_api_success BOOL,
    outcome_verdict STRING,
    created_at TIMESTAMP
)""",
    "agent_run_log": """
CREATE TABLE IF NOT EXISTS `{DATASET}.agent_run_log` (
    run_id STRING,
    agent STRING,
    project_id STRING,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    status STRING,
    steps_completed INT64,
    error_message STRING,
    created_at TIMESTAMP
)""",
    "fact_ads_optimization": """
CREATE TABLE IF NOT EXISTS `{DATASET}.fact_ads_optimization` (
    ad_id STRING NOT NULL,
    ad_name STRING,
    adset_id STRING,
    adset_name STRING,
    campaign_id STRING NOT NULL,
    campaign_name STRING,
    account_id STRING,
    report_date DATE NOT NULL,
    spend FLOAT64,
    impressions INT64,
    reach INT64,
    clicks INT64,
    cpm FLOAT64,
    cpc FLOAT64,
    ctr FLOAT64,
    frequency FLOAT64,
    leads INT64,
    messages INT64,
    add_to_cart INT64,
    purchases INT64,
    purchase_value FLOAT64,
    video_views INT64,
    video_views_p25 INT64,
    video_views_p50 INT64,
    video_views_p75 INT64,
    video_views_p100 INT64,
    video_avg_play_time FLOAT64,
    creative_type STRING,
    creative_body STRING,
    creative_title STRING,
    creative_thumbnail_url STRING,
    call_to_action STRING,
    targeting_country STRING,
    targeting_age_min INT64,
    targeting_age_max INT64,
    targeting_gender STRING,
    real_orders INT64,
    confirmed_orders INT64,
    return_orders INT64,
    real_revenue FLOAT64,
    confirmed_revenue FLOAT64,
    return_rate FLOAT64
)""",
}

# ════════════════════════════════════════════════════════════════
# DIM DATA: STATUS MAPPING (Poscake standard)
# ════════════════════════════════════════════════════════════════
STATUS_MAPPING_ROWS = [
    (1,  "new",          "DON_THO",          "Mới",             False, "none",     1),
    (2,  "submitted",    "DA_XAC_NHAN",      "Đã xác nhận",    False, "lead",     2),
    (3,  "waitting",     "CHO_HANG",         "Chờ hàng",       False, "none",     3),
    (4,  "ordered",      "DA_DAT_HANG",      "Đã đặt hàng",   False, "none",     4),
    (5,  "pending",      "DANG_GIAO",        "Chờ chuyển hàng",False, "lead",     5),
    (8,  "packing",      "DANG_GIAO",        "Đang đóng hàng", False, "lead",    6),
    (6,  "shipped",      "DANG_GIAO",        "Đã gửi hàng",   False, "lead",     7),
    (7,  "delivered",    "GIAO_THANH_CONG",  "Đã nhận",        True,  "success",  8),
    (15, "received_money","GIAO_THANH_CONG", "Đã thu tiền",    True,  "success",  9),
    (9,  "returning",    "DON_HOAN",         "Đang hoàn",      False, "return",   10),
    (10, "returned",     "DON_HOAN",         "Đã hoàn",        True,  "return",   11),
    (11, "canceled",     "HUY",              "Đã hủy",         True,  "cancel",   12),
]

# ════════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ════════════════════════════════════════════════════════════════
def run():
    dry_run = "--dry-run" in sys.argv
    only_project = None
    for arg in sys.argv[1:]:
        if arg.startswith("--project="):
            only_project = arg.split("=")[1].upper()

    for proj_key, config in PROJECTS.items():
        if only_project and proj_key != only_project:
            continue

        ds_name = config["dataset"]
        full_ds = f"{GCP_PROJECT}.{ds_name}"

        print(f"\n{'═' * 70}")
        print(f"  📦 PROJECT: {proj_key} → {ds_name}")
        print(f"{'═' * 70}")

        # ── Step 1: Create Dataset ──
        print(f"\n  1️⃣  Creating dataset {ds_name}...")
        ds = bigquery.Dataset(full_ds)
        ds.location = "US"
        ds.description = f"FAOS v6 — {config['project_name']} project dataset"
        if not dry_run:
            try:
                client.create_dataset(ds, exists_ok=True)
                print(f"     ✅ Dataset created/exists")
            except Exception as e:
                print(f"     ❌ Error: {e}")
                continue
        else:
            print(f"     [DRY-RUN] Would create dataset")

        # ── Step 2: Create Raw Tables ──
        print(f"\n  2️⃣  Creating raw tables...")
        for tbl_name, ddl in RAW_TABLES_DDL.items():
            sql = ddl.replace("{DATASET}", full_ds)
            if not dry_run:
                try:
                    client.query(sql).result()
                    print(f"     ✅ {tbl_name}")
                except Exception as e:
                    print(f"     ❌ {tbl_name}: {e}")
            else:
                print(f"     [DRY-RUN] {tbl_name}")

        # ── Step 3: Create Dim Tables ──
        print(f"\n  3️⃣  Creating dim tables...")
        for tbl_name, ddl in DIM_TABLES_DDL.items():
            sql = ddl.replace("{DATASET}", full_ds)
            if not dry_run:
                try:
                    client.query(sql).result()
                    print(f"     ✅ {tbl_name}")
                except Exception as e:
                    print(f"     ❌ {tbl_name}: {e}")
            else:
                print(f"     [DRY-RUN] {tbl_name}")

        # ── Step 4: Create AI Tables ──
        print(f"\n  4️⃣  Creating AI agent tables...")
        for tbl_name, ddl in AI_TABLES_DDL.items():
            sql = ddl.replace("{DATASET}", full_ds)
            if not dry_run:
                try:
                    client.query(sql).result()
                    print(f"     ✅ {tbl_name}")
                except Exception as e:
                    print(f"     ❌ {tbl_name}: {e}")
            else:
                print(f"     [DRY-RUN] {tbl_name}")

        # ── Step 5: Insert dim_shop_project ──
        print(f"\n  5️⃣  Inserting dim_shop_project...")
        for shop in config["shops"]:
            row = {
                "shop_id": shop["shop_id"],
                "shop_name": shop["shop_name"],
                "project_id": proj_key,
                "project_name": config["project_name"],
                "market_code": shop["market_code"],
                "market_name": shop["market_name"],
                "currency": shop["currency"],
                "currency_divisor": shop["currency_divisor"],
                "dataset_name": ds_name,
                "pos_type": shop["pos_type"],
                "ads_match_type": shop["ads_match_type"],
                "is_active": True,
                "notes": shop["notes"],
            }
            if not dry_run:
                try:
                    errors = client.insert_rows_json(f"{full_ds}.dim_shop_project", [row])
                    if errors:
                        print(f"     ❌ {shop['shop_name']}: {errors}")
                    else:
                        print(f"     ✅ {shop['shop_name']} ({shop['shop_id']})")
                except Exception as e:
                    print(f"     ❌ {shop['shop_name']}: {e}")
            else:
                print(f"     [DRY-RUN] {shop['shop_name']}")

        # ── Step 6: Insert ads_account ──
        print(f"\n  6️⃣  Inserting ads_account...")
        for acc_id, acc_name, currency, pid in config["ad_accounts"]:
            row = {
                "account_id": acc_id,
                "account_name": acc_name,
                "platform": "Facebook",
                "currency_id": currency,
                "status": "ACTIVE",
                "project_id": pid,
                "created_at": str(date.today()),
            }
            if not dry_run:
                try:
                    errors = client.insert_rows_json(f"{full_ds}.ads_account", [row])
                    if errors:
                        print(f"     ❌ {acc_name}: {errors}")
                    else:
                        print(f"     ✅ {acc_name} ({acc_id})")
                except Exception as e:
                    print(f"     ❌ {acc_name}: {e}")
            else:
                print(f"     [DRY-RUN] {acc_name}")

        # ── Step 7: Insert dim_status_mapping ──
        print(f"\n  7️⃣  Inserting dim_status_mapping...")
        rows = []
        for code, name, group, display, is_final, impact, sort in STATUS_MAPPING_ROWS:
            rows.append({
                "status_code": code, "status_name": name,
                "status_group": group, "display_name": display,
                "is_final": is_final, "revenue_impact": impact,
                "sort_order": sort,
            })
        if not dry_run:
            try:
                errors = client.insert_rows_json(f"{full_ds}.dim_status_mapping", rows)
                if errors:
                    print(f"     ❌ {errors}")
                else:
                    print(f"     ✅ {len(rows)} status mappings inserted")
            except Exception as e:
                print(f"     ❌ {e}")
        else:
            print(f"     [DRY-RUN] {len(rows)} rows")

        # ── Step 8: Insert cost_exchange_rates (USD baseline) ──
        print(f"\n  8️⃣  Inserting cost_exchange_rates...")
        fx_rows = [
            {"from_currency": "USD", "to_currency": "USD", "rate": 1.0,
             "effective_date": str(date.today()), "source": "baseline"},
        ]
        # Add project-specific FX rates
        if proj_key == "TRENDIFY":
            fx_rows.append({"from_currency": "USD", "to_currency": "RON",
                           "rate": 4.95, "effective_date": str(date.today()), "source": "manual"})
        elif proj_key == "HNLE":
            fx_rows.append({"from_currency": "USD", "to_currency": "AUD",
                           "rate": 1.55, "effective_date": str(date.today()), "source": "manual"})
        if not dry_run:
            try:
                errors = client.insert_rows_json(f"{full_ds}.cost_exchange_rates", fx_rows)
                if errors:
                    print(f"     ❌ {errors}")
                else:
                    print(f"     ✅ {len(fx_rows)} exchange rates inserted")
            except Exception as e:
                print(f"     ❌ {e}")
        else:
            print(f"     [DRY-RUN] {len(fx_rows)} rows")

    print(f"\n{'═' * 70}")
    print(f"  ✅ Phase 1 complete! Datasets + tables + dim data created.")
    print(f"  ⏭️  Next: Create views (Phase 1.7)")
    print(f"{'═' * 70}")

if __name__ == "__main__":
    run()
