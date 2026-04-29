-- ═══════════════════════════════════════════════════
-- mart_performance_master v5.1
-- Source of Truth: sql/stramark/03_mart_performance_master_v5_actual_ffm.sql
-- DO NOT modify via Python scripts
-- v5 CHANGES (2026-03-05):
--   1. Uses ACTUAL FFM costs from ffm_shipments/vw_ffm_cost_actual
--   2. Falls back to estimated constants when actual data unavailable
--   3. Converts EUR → VND (via cost_exchange_rates)
-- v5.1 CHANGES (2026-03-06):
--   4. Adds TCE fulfillment costs (parsed from PDF, cannot match per-order)
--   5. TCE costs distributed proportionally by marketer shipped_orders/day
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE VIEW `levelup-465304.STRAMARK_Dataset.mart_performance_master` AS WITH fx AS (
        SELECT rate
        FROM `levelup-465304.STRAMARK_Dataset.cost_exchange_rates`
        WHERE from_currency = 'USD'
            AND to_currency = 'RON'
        ORDER BY effective_date DESC
        LIMIT 1
    ), fx_eur AS (
        SELECT rate
        FROM `levelup-465304.STRAMARK_Dataset.cost_exchange_rates`
        WHERE from_currency = 'EUR'
            AND to_currency = 'RON'
        ORDER BY effective_date DESC
        LIMIT 1
    ), -- euShipments fulfillment cost constants (EUR, FALLBACK when actual FFM data unavailable)
    ffm_costs AS (
        SELECT 0.90 AS ffm_per_order,
            -- pick & pack (≤5kg, ≤2 items)
            0.08 AS bag_per_order,
            -- courier flyer bag A4
            0.35 AS cod_fee_per_order,
            -- COD min charge (Cargus)
            2.33 AS ship_per_order,
            -- avg shipping (Cargus ≤2kg)
            0.50 AS reverse_ffm,
            -- reverse fulfillment
            1.00 AS rma_fee,
            -- return management
            2.33 AS return_ship -- return shipping (by tariff)
    ),
    -- ═══ STEP 1: Build ad_id → marketer_id mapping from ACTUAL orders ═══
    ad_marketer_map AS (
        SELECT resolved_ad_id AS ad_id,
            APPROX_TOP_COUNT(marketer_id, 1) [OFFSET(0)].value AS marketer_id
        FROM `levelup-465304.STRAMARK_Dataset.vw_fact_orders`
        WHERE resolved_ad_id IS NOT NULL
            AND marketer_id IS NOT NULL
            AND marketer_id != 'UNKNOWN'
        GROUP BY 1
    ),
    adset_marketer_map AS (
        SELECT resolved_adset_id AS adset_id,
            APPROX_TOP_COUNT(marketer_id, 1) [OFFSET(0)].value AS marketer_id
        FROM `levelup-465304.STRAMARK_Dataset.vw_fact_orders`
        WHERE resolved_adset_id IS NOT NULL
            AND marketer_id IS NOT NULL
            AND marketer_id != 'UNKNOWN'
        GROUP BY 1
    ),
    -- ═══ STEP 2: Aggregate ads with 3-level marketer resolution ═══
    ads_enriched AS (
        SELECT SAFE_CAST(a.date AS DATE) AS report_date,
            a.ad_id,
            a.adset_id,
            a.campaign_name,
            a.spend,
            COALESCE(a.impressions, 0) AS impressions,
            COALESCE(a.reach, 0) AS reach,
            COALESCE(a.clicks, 0) AS clicks,
            0 AS messages,
            COALESCE(
                am.marketer_id,
                asm.marketer_id,
                CASE
                    WHEN ENDS_WITH(a.campaign_name, ' Lệ')
                    OR ENDS_WITH(a.campaign_name, '-Lệ')
                    OR ENDS_WITH(a.campaign_name, '_Lệ')
                    OR a.campaign_name = 'Lệ'
                    OR a.campaign_name LIKE '% Lệ %' THEN 'LETC'
                    WHEN ENDS_WITH(a.campaign_name, ' LC')
                    OR ENDS_WITH(a.campaign_name, '-LC')
                    OR ENDS_WITH(a.campaign_name, '_LC')
                    OR a.campaign_name LIKE '% LC %'
                    OR a.campaign_name LIKE '% LC-%'
                    OR a.campaign_name LIKE '% LC_%' THEN 'CHIPTL'
                    WHEN ENDS_WITH(a.campaign_name, ' TA')
                    OR ENDS_WITH(a.campaign_name, '-TA')
                    OR ENDS_WITH(a.campaign_name, '_TA')
                    OR a.campaign_name LIKE '% TA %'
                    OR a.campaign_name LIKE '% TA-%'
                    OR a.campaign_name LIKE '% TA_%' THEN 'ANHNT'
                    WHEN ENDS_WITH(a.campaign_name, ' TÚ')
                    OR ENDS_WITH(a.campaign_name, ' Tú')
                    OR ENDS_WITH(a.campaign_name, '-TÚ')
                    OR ENDS_WITH(a.campaign_name, '-Tú')
                    OR ENDS_WITH(a.campaign_name, ' Kim Tu')
                    OR ENDS_WITH(a.campaign_name, ' Kim Tú') THEN 'TUKT'
                    -- v5.2: Add missing marketers
                    WHEN ENDS_WITH(a.campaign_name, ' MT')
                    OR ENDS_WITH(a.campaign_name, '-MT')
                    OR ENDS_WITH(a.campaign_name, '_MT')
                    OR a.campaign_name LIKE '% MT %'
                    OR a.campaign_name LIKE '% MT-%'
                    OR ENDS_WITH(a.campaign_name, ' Minh Thư')
                    OR ENDS_WITH(a.campaign_name, ' Minh Thu') THEN 'MINHTHU'
                    WHEN ENDS_WITH(a.campaign_name, ' Vân')
                    OR ENDS_WITH(a.campaign_name, '-Vân')
                    OR ENDS_WITH(a.campaign_name, '_Vân')
                    OR a.campaign_name LIKE '% Vân %'
                    OR ENDS_WITH(a.campaign_name, ' Tường Vân')
                    OR ENDS_WITH(a.campaign_name, ' Tuong Van')
                    OR ENDS_WITH(a.campaign_name, ' TV')
                    OR ENDS_WITH(a.campaign_name, '-TV') THEN 'TUONGVAN'
                    WHEN ENDS_WITH(a.campaign_name, ' Hiệu')
                    OR ENDS_WITH(a.campaign_name, '-Hiệu')
                    OR ENDS_WITH(a.campaign_name, '_Hiệu')
                    OR a.campaign_name LIKE '% Hiệu %'
                    OR ENDS_WITH(a.campaign_name, ' Hieu')
                    OR ENDS_WITH(a.campaign_name, '-Hieu') THEN 'HIEUNV'
                    ELSE NULL
                END,
                'UNMATCHED'
            ) AS marketer_id,
            CASE
                WHEN am.marketer_id IS NOT NULL THEN 'AD_MATCH'
                WHEN asm.marketer_id IS NOT NULL THEN 'ADSET_MATCH'
                WHEN ENDS_WITH(a.campaign_name, ' Lệ')
                OR ENDS_WITH(a.campaign_name, '-Lệ')
                OR a.campaign_name LIKE '% Lệ %'
                OR a.campaign_name = 'Lệ'
                OR ENDS_WITH(a.campaign_name, ' LC')
                OR ENDS_WITH(a.campaign_name, '-LC')
                OR a.campaign_name LIKE '% LC %'
                OR a.campaign_name LIKE '% LC-%'
                OR ENDS_WITH(a.campaign_name, ' TA')
                OR ENDS_WITH(a.campaign_name, '-TA')
                OR a.campaign_name LIKE '% TA %'
                OR a.campaign_name LIKE '% TA-%'
                OR ENDS_WITH(a.campaign_name, ' TÚ')
                OR ENDS_WITH(a.campaign_name, ' Tú')
                OR ENDS_WITH(a.campaign_name, ' Kim Tu')
                OR ENDS_WITH(a.campaign_name, ' Kim Tú')
                -- v5.2: new marketers
                OR ENDS_WITH(a.campaign_name, ' MT')
                OR ENDS_WITH(a.campaign_name, '-MT')
                OR a.campaign_name LIKE '% MT %'
                OR ENDS_WITH(a.campaign_name, ' Minh Thư')
                OR ENDS_WITH(a.campaign_name, ' Minh Thu')
                OR ENDS_WITH(a.campaign_name, ' Vân')
                OR ENDS_WITH(a.campaign_name, '-Vân')
                OR a.campaign_name LIKE '% Vân %'
                OR ENDS_WITH(a.campaign_name, ' Tường Vân')
                OR ENDS_WITH(a.campaign_name, ' TV')
                OR ENDS_WITH(a.campaign_name, '-TV')
                OR ENDS_WITH(a.campaign_name, ' Hiệu')
                OR ENDS_WITH(a.campaign_name, '-Hiệu')
                OR a.campaign_name LIKE '% Hiệu %'
                OR ENDS_WITH(a.campaign_name, ' Hieu') THEN 'SUFFIX_MATCH'
                ELSE 'UNMATCHED'
            END AS ads_attribution_type
        FROM `levelup-465304.STRAMARK_Dataset.fb_ads_data` a
            LEFT JOIN ad_marketer_map am ON a.ad_id = am.ad_id
            LEFT JOIN adset_marketer_map asm ON a.adset_id = asm.adset_id
    ),
    ads_agg AS (
        SELECT report_date,
            marketer_id,
            SUM(spend) AS ads_spend_usd,
            SUM(impressions) AS impressions,
            SUM(reach) AS reach,
            SUM(clicks) AS clicks,
            SUM(messages) AS messages,
            COUNTIF(ads_attribution_type = 'AD_MATCH') AS ads_matched_by_ad,
            COUNTIF(ads_attribution_type = 'ADSET_MATCH') AS ads_matched_by_adset,
            COUNTIF(ads_attribution_type = 'CAMPAIGN_PARSE') AS ads_matched_by_parse,
            COUNTIF(ads_attribution_type = 'UNMATCHED') AS ads_unmatched
        FROM ads_enriched
        GROUP BY 1,
            2
    ),
    -- ═══ STEP 3: Order aggregation with ACTUAL FFM costs ═══
    order_agg AS (
        SELECT o.order_date AS report_date,
            o.marketer_id,
            ANY_VALUE(o.marketer_name) AS marketer_name,
            COUNT(DISTINCT o.order_id) AS total_orders,
            COUNTIF(o.status_group = 'success') AS success_orders,
            COUNTIF(o.status_group = 'returned') AS returned_orders,
            COUNTIF(o.status_group = 'cancelled') AS cancelled_orders,
            COUNTIF(o.status_group IN ('processing', 'shipping')) AS pending_orders,
            -- Orders that 3PL actually processed (after TCE export)
            COUNTIF(
                o.status_name IN (
                    'packing',
                    'pending',
                    'shipped',
                    'delivered',
                    'received_money',
                    'returning',
                    'returned'
                )
            ) AS shipped_orders,
            ROUND(SUM(o.revenue_L1_lead), 2) AS revenue_L1,
            ROUND(SUM(o.revenue_L3_success), 2) AS revenue_L3,
            ROUND(SUM(o.revenue_L4_cod_collected), 2) AS revenue_L4,
            ROUND(SUM(o.shipping_fee), 2) AS total_shipping,
            ROUND(SUM(o.partner_fee), 2) AS total_partner_fee,
            ROUND(SUM(o.return_fee), 2) AS total_return_fee,
            COUNTIF(
                o.attribution_type IN ('AD_MATCH', 'ADSET_MATCH')
            ) AS attributed_orders,
            -- ═══ NEW v5: ACTUAL FFM costs aggregated per marketer/date ═══
            ROUND(SUM(COALESCE(ffm.forward_cost_eur, 0)), 2) AS actual_forward_cost_eur,
            ROUND(SUM(COALESCE(ffm.return_cost_eur, 0)), 2) AS actual_return_cost_eur,
            -- Count how many orders have actual FFM data
            COUNTIF(ffm.has_actual_ffm_cost IS TRUE) AS orders_with_actual_ffm
        FROM `levelup-465304.STRAMARK_Dataset.vw_fact_orders` o
            LEFT JOIN `levelup-465304.STRAMARK_Dataset.vw_ffm_cost_actual` ffm ON CAST(o.order_id AS STRING) = ffm.pos_order_id
        GROUP BY 1,
            2
    ),
    order_cogs AS (
        SELECT o.order_date AS report_date,
            o.marketer_id,
            ROUND(
                SUM(
                    SAFE_CAST(oi.quantity AS INT64) * COALESCE(
                        NULLIF(pc.cost_raw, 0),
                        NULLIF(oi.avg_imported_price, 0),
                        NULLIF(SAFE_CAST(pv.imported_price AS FLOAT64), 0),
                        0
                    ) / 100
                ),
                2
            ) AS total_cogs
        FROM `levelup-465304.STRAMARK_Dataset.vw_fact_orders` o
            JOIN `levelup-465304.STRAMARK_Dataset.order_items` oi ON o.order_id = oi.order_id
            LEFT JOIN `levelup-465304.STRAMARK_Dataset.product_variations` pv ON oi.variation_id = pv.id
            LEFT JOIN `levelup-465304.STRAMARK_Dataset.product_cogs` pc ON oi.variation_id = pc.variation_id
        WHERE o.status_group = 'success'
            AND COALESCE(
                NULLIF(pc.cost_raw, 0),
                NULLIF(oi.avg_imported_price, 0),
                NULLIF(SAFE_CAST(pv.imported_price AS FLOAT64), 0)
            ) > 0
        GROUP BY 1,
            2
    ),
    -- ═══ STEP 4 (v5.1): TCE costs aggregated by date ═══
    -- TCE AWBs cannot be matched per-order to POS order_ids (different ID systems).
    -- Instead, aggregate daily and distribute proportionally across marketers.
    tce_daily_costs AS (
        SELECT SAFE_CAST(created_date AS DATE) AS cost_date,
            ROUND(
                SUM(
                    CASE
                        WHEN is_return_shipment = FALSE THEN price_incl_vat
                        ELSE 0
                    END
                ),
                2
            ) AS tce_forward_eur,
            ROUND(
                SUM(
                    CASE
                        WHEN is_return_shipment = TRUE THEN price_incl_vat
                        ELSE 0
                    END
                ),
                2
            ) AS tce_return_eur,
            COUNT(
                CASE
                    WHEN is_return_shipment = FALSE THEN 1
                END
            ) AS tce_forward_count,
            COUNT(
                CASE
                    WHEN is_return_shipment = TRUE THEN 1
                END
            ) AS tce_return_count
        FROM `levelup-465304.STRAMARK_Dataset.ffm_shipments`
        WHERE ffm_partner = 'TCE'
        GROUP BY 1
    ),
    -- Total shipped orders per date (for proportional distribution)
    daily_shipped_total AS (
        SELECT report_date,
            SUM(shipped_orders) AS total_shipped_day
        FROM order_agg
        GROUP BY 1
    ) -- ═══ FINAL SELECT ═══
SELECT oa.report_date,
    oa.marketer_id,
    oa.marketer_name,
    oa.total_orders,
    oa.success_orders,
    oa.returned_orders,
    oa.cancelled_orders,
    oa.pending_orders,
    oa.attributed_orders,
    oa.shipped_orders,
    ROUND(oa.revenue_L1, 0) AS revenue_lead,
    ROUND(oa.revenue_L3, 0) AS revenue_success,
    ROUND(oa.revenue_L3, 0) AS delivered_revenue,
    ROUND(oa.revenue_L4, 0) AS revenue_cod_collected,
    ROUND(oa.revenue_L3 - oa.revenue_L4, 0) AS partner_debt,
    ROUND(COALESCE(aa.ads_spend_usd, 0), 2) AS ads_spend_usd,
    ROUND(COALESCE(aa.ads_spend_usd, 0) * fx.rate, 0) AS ads_spend_ron,
    ROUND(oa.total_shipping, 0) AS shipping_cost,
    ROUND(oa.total_partner_fee, 0) AS partner_fee,
    ROUND(oa.total_return_fee, 0) AS return_cost,
    ROUND(COALESCE(oc.total_cogs, 0), 0) AS cogs,
    -- ═══ v5.1: Fulfillment costs — EU Shipment (per-order) + TCE (proportional) + estimated fallback ═══
    -- EU Shipment: actual per-order costs from vw_ffm_cost_actual
    -- TCE: daily totals distributed by marketer's shipped_orders ratio
    -- Fallback: estimated constants for orders without any FFM data
    ROUND(
        CASE
            WHEN oa.orders_with_actual_ffm > 0 THEN oa.actual_forward_cost_eur * fx_eur.rate + (oa.shipped_orders - oa.orders_with_actual_ffm) * (
                fc.ffm_per_order + fc.bag_per_order + fc.cod_fee_per_order + fc.ship_per_order
            ) * fx_eur.rate
            ELSE oa.shipped_orders * (
                fc.ffm_per_order + fc.bag_per_order + fc.cod_fee_per_order + fc.ship_per_order
            ) * fx_eur.rate
        END -- Add TCE forward costs (proportional by shipped_orders)
        + COALESCE(
            SAFE_DIVIDE(
                oa.shipped_orders,
                NULLIF(dst.total_shipped_day, 0)
            ) * tce.tce_forward_eur * fx_eur.rate,
            0
        ),
        0
    ) AS fulfillment_cost,
    -- Return costs: EU Shipment actual + TCE proportional + estimated fallback
    -- W5 FIX: Use per-marketer actual return count instead of global subquery
    ROUND(
        CASE
            WHEN oa.orders_with_actual_ffm > 0 THEN oa.actual_return_cost_eur * fx_eur.rate + GREATEST(
                0,
                oa.returned_orders - CAST(
                    SAFE_DIVIDE(
                        oa.actual_return_cost_eur,
                        NULLIF(
                            oa.actual_forward_cost_eur + oa.actual_return_cost_eur,
                            0
                        )
                    ) * oa.orders_with_actual_ffm AS INT64
                )
            ) * (fc.reverse_ffm + fc.rma_fee + fc.return_ship) * fx_eur.rate
            ELSE oa.returned_orders * (fc.reverse_ffm + fc.rma_fee + fc.return_ship) * fx_eur.rate
        END -- Add TCE return costs (proportional by shipped_orders)
        + COALESCE(
            SAFE_DIVIDE(
                oa.shipped_orders,
                NULLIF(dst.total_shipped_day, 0)
            ) * tce.tce_return_eur * fx_eur.rate,
            0
        ),
        0
    ) AS return_fulfillment_cost,
    -- ═══ v5.1: Net profit with actual FFM costs + TCE costs ═══
    ROUND(
        oa.revenue_L3 - COALESCE(aa.ads_spend_usd, 0) * fx.rate - COALESCE(oc.total_cogs, 0) -- Forward fulfillment (EU Shipment + estimated fallback)
        - CASE
            WHEN oa.orders_with_actual_ffm > 0 THEN oa.actual_forward_cost_eur * fx_eur.rate + (oa.shipped_orders - oa.orders_with_actual_ffm) * (
                fc.ffm_per_order + fc.bag_per_order + fc.cod_fee_per_order + fc.ship_per_order
            ) * fx_eur.rate
            ELSE oa.shipped_orders * (
                fc.ffm_per_order + fc.bag_per_order + fc.cod_fee_per_order + fc.ship_per_order
            ) * fx_eur.rate
        END -- TCE forward costs (proportional)
        - COALESCE(
            SAFE_DIVIDE(
                oa.shipped_orders,
                NULLIF(dst.total_shipped_day, 0)
            ) * tce.tce_forward_eur * fx_eur.rate,
            0
        ) -- Return fulfillment (EU Shipment + estimated fallback, W5 FIX: per-marketer)
        - CASE
            WHEN oa.orders_with_actual_ffm > 0 THEN oa.actual_return_cost_eur * fx_eur.rate + GREATEST(
                0,
                oa.returned_orders - CAST(
                    SAFE_DIVIDE(
                        oa.actual_return_cost_eur,
                        NULLIF(
                            oa.actual_forward_cost_eur + oa.actual_return_cost_eur,
                            0
                        )
                    ) * oa.orders_with_actual_ffm AS INT64
                )
            ) * (fc.reverse_ffm + fc.rma_fee + fc.return_ship) * fx_eur.rate
            ELSE oa.returned_orders * (fc.reverse_ffm + fc.rma_fee + fc.return_ship) * fx_eur.rate
        END -- TCE return costs (proportional)
        - COALESCE(
            SAFE_DIVIDE(
                oa.shipped_orders,
                NULLIF(dst.total_shipped_day, 0)
            ) * tce.tce_return_eur * fx_eur.rate,
            0
        ),
        0
    ) AS net_profit,
    COALESCE(aa.impressions, 0) AS impressions,
    COALESCE(aa.reach, 0) AS reach,
    COALESCE(aa.clicks, 0) AS clicks,
    COALESCE(aa.messages, 0) AS messages,
    COALESCE(aa.ads_matched_by_ad, 0) AS ads_matched_by_ad,
    COALESCE(aa.ads_matched_by_adset, 0) AS ads_matched_by_adset,
    COALESCE(aa.ads_matched_by_parse, 0) AS ads_matched_by_parse,
    COALESCE(aa.ads_unmatched, 0) AS ads_unmatched,
    -- ═══ v5: FFM data quality metrics ═══
    oa.orders_with_actual_ffm,
    oa.shipped_orders - oa.orders_with_actual_ffm AS orders_with_estimated_ffm,
    ROUND(oa.actual_forward_cost_eur, 2) AS actual_forward_cost_eur,
    ROUND(oa.actual_return_cost_eur, 2) AS actual_return_cost_eur,
    -- v5.1: TCE cost metrics
    ROUND(
        COALESCE(
            SAFE_DIVIDE(
                oa.shipped_orders,
                NULLIF(dst.total_shipped_day, 0)
            ) * tce.tce_forward_eur,
            0
        ),
        2
    ) AS tce_forward_cost_eur,
    ROUND(
        COALESCE(
            SAFE_DIVIDE(
                oa.shipped_orders,
                NULLIF(dst.total_shipped_day, 0)
            ) * tce.tce_return_eur,
            0
        ),
        2
    ) AS tce_return_cost_eur,
    ROUND(
        SAFE_DIVIDE(
            oa.revenue_L3,
            NULLIF(aa.ads_spend_usd * fx.rate, 0)
        ),
        2
    ) AS real_roas,
    ROUND(
        SAFE_DIVIDE(
            aa.ads_spend_usd * fx.rate,
            NULLIF(oa.total_orders, 0)
        ),
        2
    ) AS real_cpa,
    ROUND(
        SAFE_DIVIDE(oa.revenue_L1, NULLIF(oa.total_orders, 0)),
        2
    ) AS avg_order_value,
    ROUND(
        SAFE_DIVIDE(aa.ads_spend_usd, NULLIF(aa.impressions, 0)) * 1000,
        2
    ) AS cpm_usd,
    ROUND(
        SAFE_DIVIDE(aa.clicks, NULLIF(aa.impressions, 0)) * 100,
        2
    ) AS ctr_pct,
    ROUND(
        SAFE_DIVIDE(oa.total_orders, NULLIF(aa.clicks, 0)) * 100,
        2
    ) AS cr_click_pct,
    ROUND(
        SAFE_DIVIDE(
            oa.success_orders,
            NULLIF(
                oa.success_orders + oa.returned_orders + oa.cancelled_orders,
                0
            )
        ) * 100,
        1
    ) AS delivery_rate_pct,
    ROUND(
        SAFE_DIVIDE(oa.returned_orders, NULLIF(oa.total_orders, 0)) * 100,
        1
    ) AS return_rate_pct,
    CASE
        WHEN COALESCE(aa.ads_spend_usd, 0) = 0 THEN '⚪ NO_ADS'
        WHEN SAFE_DIVIDE(aa.ads_spend_usd, NULLIF(aa.impressions, 0)) * 1000 > 15 THEN '🔴 CPM_HIGH'
        WHEN SAFE_DIVIDE(aa.clicks, NULLIF(aa.impressions, 0)) * 100 < 0.8 THEN '🟡 CTR_LOW'
        WHEN SAFE_DIVIDE(oa.total_orders, NULLIF(aa.clicks, 0)) * 100 < 2 THEN '🟠 CR_LOW'
        WHEN SAFE_DIVIDE(
            oa.revenue_L3,
            NULLIF(aa.ads_spend_usd * fx.rate, 0)
        ) >= 3 THEN '🟢 SCALE'
        WHEN SAFE_DIVIDE(
            oa.revenue_L3,
            NULLIF(aa.ads_spend_usd * fx.rate, 0)
        ) >= 1.5 THEN '⚪ MONITOR'
        ELSE '🔴 KILL'
    END AS diagnosis
FROM order_agg oa
    LEFT JOIN ads_agg aa ON oa.marketer_id = aa.marketer_id
    AND oa.report_date = aa.report_date
    LEFT JOIN order_cogs oc ON oa.report_date = oc.report_date
    AND oa.marketer_id = oc.marketer_id
    LEFT JOIN tce_daily_costs tce ON oa.report_date = tce.cost_date
    LEFT JOIN daily_shipped_total dst ON oa.report_date = dst.report_date
    CROSS JOIN fx
    CROSS JOIN fx_eur
    CROSS JOIN ffm_costs fc;