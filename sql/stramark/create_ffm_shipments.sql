-- ═══════════════════════════════════════════════════
-- ffm_shipments table
-- Stores actual fulfillment costs from FFM partners (EU Shipment, TCE)
-- Source of Truth: sql/stramark/create_ffm_shipments.sql
-- Created: 2026-03-05
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `levelup-465304.STRAMARK_Dataset.ffm_shipments` (
    awb STRING NOT NULL,
    -- Waybill number (unique key from FFM)
    ref_number STRING,
    -- Raw reference number from FFM
    pos_order_id STRING,
    -- Extracted POS order ID
    ffm_partner STRING DEFAULT 'euShipments',
    -- FFM partner name
    client_id STRING,
    -- API account client ID
    status STRING,
    -- Current shipment status
    price_excl_vat FLOAT64,
    -- Actual cost from API (EUR)
    price_incl_vat FLOAT64,
    -- price_excl_vat × (1 + vat_rate)
    vat_rate FLOAT64 DEFAULT 0.20,
    -- VAT rate (20%)
    currency STRING DEFAULT 'EUR',
    -- Cost currency
    is_return_shipment BOOL DEFAULT FALSE,
    -- True if return leg
    original_order_id STRING,
    -- For returns: the original POS order ID
    cod_amount FLOAT64,
    -- COD amount if applicable
    created_date TIMESTAMP,
    -- Shipment creation date
    delivered_date TIMESTAMP,
    -- Delivery date
    returned_date TIMESTAMP,
    -- Return date
    payout_date TIMESTAMP,
    -- Date FFM partner settled payment with Stramark
    payout_number STRING,
    -- Payout batch number from 3PL (maps to Protokol protocol_number)
    raw_response STRING,
    -- Full API JSON response (for debugging)
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
    -- Last sync timestamp
    sync_source STRING DEFAULT 'api' -- 'api' or 'scraper'
);