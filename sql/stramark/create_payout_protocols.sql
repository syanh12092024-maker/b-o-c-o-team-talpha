-- ═══════════════════════════════════════════════════
-- Payout Protocol tables for 3-layer payment verification
-- Stores parsed Protokol XLSX data + cross-check results
-- Source of Truth: sql/stramark/create_payout_protocols.sql
-- Created: 2026-03-21
-- ═══════════════════════════════════════════════════

-- Protocol summary: 1 row per Protokol document
CREATE TABLE IF NOT EXISTS `levelup-465304.STRAMARK_Dataset.payout_protocols` (
    protocol_number STRING NOT NULL,
    -- PK, batch ID from Protokol filename (= API payout_number)
    client_id STRING,
    -- euShipments client ID (3282/3248 = Stramark)
    protocol_date DATE,
    -- Date on Protokol document
    total_liability_ron FLOAT64,
    -- Sum of all COD amounts (RON)
    paid_eur FLOAT64,
    -- EUR amount actually paid by euShipments
    exchange_rate FLOAT64,
    -- RON-to-EUR rate used by euShipments
    awb_count INT64,
    -- Total AWBs in Protokol
    matched_count INT64,
    -- AWBs that matched BQ data
    anomaly_count INT64,
    -- AWBs with any anomaly
    verification_status STRING DEFAULT 'pending',
    -- pending / verified / anomaly / confirmed / disputed
    confirmed_by_1 STRING,
    -- First approver name
    confirmed_at_1 TIMESTAMP,
    confirmed_by_2 STRING,
    -- Second approver name
    confirmed_at_2 TIMESTAMP,
    source_filename STRING,
    -- Original uploaded filename
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

-- Protocol items: 1 row per AWB in a Protokol
CREATE TABLE IF NOT EXISTS `levelup-465304.STRAMARK_Dataset.payout_protocol_items` (
    protocol_number STRING,
    -- FK to payout_protocols
    awb STRING,
    -- Waybill number from Protokol
    receiver_name STRING,
    -- Customer name from Protokol
    amount_ron FLOAT64,
    -- COD value from Protokol (RON)
    counted_ron FLOAT64,
    -- Checked COD value from Protokol (RON)
    currency STRING DEFAULT 'RON',
    match_status STRING,
    -- matched / amount_mismatch / count_mismatch / unknown_awb
    bq_cod_amount FLOAT64,
    -- From ffm_shipments for cross-check
    bq_status STRING,
    -- From ffm_shipments
    pos_order_id STRING,
    -- Extracted from Protokol notes or BQ
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
