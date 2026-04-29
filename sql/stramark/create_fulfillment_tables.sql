-- ══════════════════════════════════════════════════════════
-- Stramark Fulfillment Tables (Multi-Country)
-- Target: levelup-465304.STRAMARK_Dataset
-- Markets: RO, SK, BG, HR | 3PL: euShipments (InOut BG)
-- ══════════════════════════════════════════════════════════

-- 1. fulfillment_orders — Each order pushed/attempted to 3PL
CREATE TABLE IF NOT EXISTS `levelup-465304.STRAMARK_Dataset.fulfillment_orders` (
    -- Identity
    pos_order_id STRING NOT NULL,         -- POS Cake order ID
    tpl_order_id INT64,                   -- euShipments internal order ID
    awb STRING,                           -- Air Waybill / Tracking number

    -- Courier & Warehouse
    courier_name STRING,                  -- e.g. "Romania Cargus", "Slovakia GLS"
    courier_id INT64,                     -- euShipments courier ID
    warehouse STRING DEFAULT 'HelpShip Oradea',

    -- Recipient
    recipient_name STRING,
    recipient_phone STRING,
    recipient_city STRING,
    recipient_country STRING DEFAULT 'RO', -- ISO: RO, SK, BG, HR

    -- Financial
    cod_amount FLOAT64,                   -- COD (original currency from POS, in cents)
    shipping_cost_eur FLOAT64,            -- Shipping cost (EUR)
    ffm_cost_eur FLOAT64,                -- Fulfillment cost (EUR)
    total_3pl_cost_eur FLOAT64,          -- Total 3PL cost (EUR)

    -- Items
    items_count INT64,
    weight_kg FLOAT64,

    -- Status tracking
    status STRING DEFAULT 'created',      -- created/shipped/delivered/returning/returned/cancelled/validation_failed
    last_status_update TIMESTAMP,
    error_message STRING,
    warnings STRING,

    -- Metadata
    is_test BOOL DEFAULT FALSE,
    shop_id STRING,
    project_id STRING DEFAULT 'stramark',
    created_at STRING,
    sync_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

-- 2. fulfillment_tracking — Tracking event history
CREATE TABLE IF NOT EXISTS `levelup-465304.STRAMARK_Dataset.fulfillment_tracking` (
    pos_order_id STRING NOT NULL,
    tpl_order_id INT64,
    awb STRING,

    -- Event
    status STRING,
    status_detail STRING,
    event_timestamp TIMESTAMP,
    location STRING,

    -- Metadata
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
