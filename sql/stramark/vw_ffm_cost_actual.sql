-- ═══════════════════════════════════════════════════
-- vw_ffm_cost_actual
-- Aggregates actual FFM costs from ffm_shipments table
-- Provides per-order actual fulfillment & return costs in EUR
-- Source of Truth: sql/stramark/vw_ffm_cost_actual.sql
-- Created: 2026-03-05
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE VIEW `levelup-465304.STRAMARK_Dataset.vw_ffm_cost_actual` AS -- Forward shipment costs: grouped by POS order ID
    WITH forward_costs AS (
        SELECT pos_order_id,
            SUM(price_incl_vat) AS forward_cost_eur,
            COUNT(*) AS forward_shipment_count,
            MAX(status) AS latest_status,
            MAX(delivered_date) AS delivered_date,
            MAX(created_date) AS created_date
        FROM `levelup-465304.STRAMARK_Dataset.ffm_shipments`
        WHERE is_return_shipment = FALSE
            AND pos_order_id IS NOT NULL
        GROUP BY pos_order_id
    ),
    -- Return shipment costs: grouped by original order ID
    return_costs AS (
        SELECT original_order_id AS pos_order_id,
            SUM(price_incl_vat) AS return_cost_eur,
            COUNT(*) AS return_shipment_count,
            MAX(returned_date) AS returned_date
        FROM `levelup-465304.STRAMARK_Dataset.ffm_shipments`
        WHERE is_return_shipment = TRUE
            AND original_order_id IS NOT NULL
        GROUP BY original_order_id
    )
SELECT COALESCE(f.pos_order_id, r.pos_order_id) AS pos_order_id,
    -- Forward costs
    COALESCE(f.forward_cost_eur, 0) AS forward_cost_eur,
    COALESCE(f.forward_shipment_count, 0) AS forward_shipment_count,
    f.latest_status AS ffm_status,
    f.delivered_date AS ffm_delivered_date,
    f.created_date AS ffm_created_date,
    -- Return costs
    COALESCE(r.return_cost_eur, 0) AS return_cost_eur,
    COALESCE(r.return_shipment_count, 0) AS return_shipment_count,
    r.returned_date AS ffm_returned_date,
    -- Total cost (forward + return)
    COALESCE(f.forward_cost_eur, 0) + COALESCE(r.return_cost_eur, 0) AS total_cost_eur,
    -- Has actual data flag
    TRUE AS has_actual_ffm_cost
FROM forward_costs f
    FULL OUTER JOIN return_costs r ON f.pos_order_id = r.pos_order_id;