-- 棚卸し・在庫管理 Phase 2 recalculate lint修正
-- 適用済み履歴は書き換えず、一時tableを使わない同等の直接UPSERTへ置き換える。

CREATE OR REPLACE FUNCTION public.recalculate_inventory_session(
    p_session_id UUID,
    p_store_id INTEGER,
    p_snapshot_id UUID,
    p_calculated_as_of TIMESTAMPTZ
)
RETURNS TABLE (
    calculation_run_id UUID,
    source_fingerprint TEXT,
    reused_run BOOLEAN,
    matched_row_count INTEGER,
    unmatched_row_count INTEGER,
    ambiguous_row_count INTEGER,
    duplicate_row_count INTEGER,
    balance_row_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_session_status TEXT;
    v_snapshot_hash TEXT;
    v_snapshot_from TIMESTAMPTZ;
    v_snapshot_to TIMESTAMPTZ;
    v_calculation_from TIMESTAMPTZ;
    v_source_fingerprint TEXT;
    v_run_id UUID;
    v_reused BOOLEAN := FALSE;
    v_matched_count INTEGER;
    v_unmatched_count INTEGER;
    v_ambiguous_count INTEGER;
    v_duplicate_count INTEGER;
    v_balance_count INTEGER;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager', 'staff']::TEXT[]) THEN
        RAISE EXCEPTION 'store access denied' USING ERRCODE = '42501';
    END IF;
    IF p_calculated_as_of IS NULL THEN
        RAISE EXCEPTION 'calculated_as_of is required' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_session_id::TEXT || ':' || p_store_id::TEXT, 0)
    );

    SELECT session.status
      INTO v_session_status
      FROM public.inventory_sessions AS session
     WHERE session.id = p_session_id
       AND session.store_id = p_store_id;
    IF NOT FOUND OR v_session_status = 'cancelled' THEN
        RAISE EXCEPTION 'inventory session is unavailable' USING ERRCODE = '22023';
    END IF;

    SELECT snapshot.payload_sha256, snapshot.source_from, snapshot.source_to
      INTO v_snapshot_hash, v_snapshot_from, v_snapshot_to
      FROM public.pos_inventory_snapshots AS snapshot
     WHERE snapshot.id = p_snapshot_id
       AND snapshot.store_id = p_store_id
       AND snapshot.status = 'succeeded';
    IF NOT FOUND OR v_snapshot_to <> p_calculated_as_of THEN
        RAISE EXCEPTION 'POS snapshot does not match calculation time' USING ERRCODE = '22023';
    END IF;

    SELECT MIN(item.counted_at)
      INTO v_calculation_from
      FROM public.inventory_session_items AS item
     WHERE item.session_id = p_session_id
       AND item.store_id = p_store_id
       AND item.counted_at IS NOT NULL
       AND item.excluded_at IS NULL;
    IF v_calculation_from IS NULL OR v_calculation_from > p_calculated_as_of
       OR v_snapshot_from > v_calculation_from THEN
        RAISE EXCEPTION 'invalid inventory calculation period' USING ERRCODE = '22023';
    END IF;

    SELECT pg_catalog.encode(
        extensions.digest(
            pg_catalog.convert_to(
                jsonb_build_object(
                    'version', 2,
                    'sessionId', p_session_id,
                    'storeId', p_store_id,
                    'snapshotId', p_snapshot_id,
                    'snapshotPayloadSha256', v_snapshot_hash,
                    'calculatedAsOf', p_calculated_as_of,
                    'items', COALESCE((
                        SELECT jsonb_agg(
                            jsonb_build_array(
                                item.id,
                                item.product_id,
                                item.jan_snapshot,
                                item.counted_quantity,
                                item.counted_at,
                                item.row_version
                            ) ORDER BY item.product_id
                        )
                        FROM public.inventory_session_items AS item
                        WHERE item.session_id = p_session_id
                          AND item.store_id = p_store_id
                          AND item.counted_at IS NOT NULL
                          AND item.excluded_at IS NULL
                    ), '[]'::JSONB),
                    'posRows', COALESCE((
                        SELECT jsonb_agg(
                            jsonb_build_array(
                                pos.row_no,
                                pos.signature_hash,
                                pos.signature_ordinal,
                                pos.match_status,
                                pos.matched_product_id,
                                pos.event_kind,
                                pos.event_at,
                                pos.quantity
                            ) ORDER BY pos.row_no
                        )
                        FROM public.pos_inventory_snapshot_rows AS pos
                        WHERE pos.snapshot_id = p_snapshot_id
                          AND pos.store_id = p_store_id
                    ), '[]'::JSONB),
                    'transfers', COALESCE((
                        SELECT jsonb_agg(
                            jsonb_build_array(
                                transfer.id,
                                transfer.entry_type,
                                transfer.from_store_id,
                                transfer.to_store_id,
                                transfer.jan_code,
                                transfer.quantity,
                                transfer.transfer_date
                            ) ORDER BY transfer.id
                        )
                        FROM public.transfers AS transfer
                        WHERE transfer.transfer_date > v_calculation_from
                          AND transfer.transfer_date <= p_calculated_as_of
                          AND (transfer.from_store_id = p_store_id OR transfer.to_store_id = p_store_id)
                          AND EXISTS (
                              SELECT 1
                              FROM public.inventory_session_items AS item
                              WHERE item.session_id = p_session_id
                                AND item.store_id = p_store_id
                                AND item.excluded_at IS NULL
                                AND item.counted_at IS NOT NULL
                                AND item.jan_snapshot = transfer.jan_code
                          )
                    ), '[]'::JSONB),
                    'adjustments', COALESCE((
                        SELECT jsonb_agg(
                            jsonb_build_array(
                                adjustment.id,
                                adjustment.product_id,
                                adjustment.quantity_delta,
                                adjustment.effective_at
                            ) ORDER BY adjustment.id
                        )
                        FROM public.inventory_adjustments AS adjustment
                        WHERE adjustment.store_id = p_store_id
                          AND adjustment.effective_at > v_calculation_from
                          AND adjustment.effective_at <= p_calculated_as_of
                          AND EXISTS (
                              SELECT 1
                              FROM public.inventory_session_items AS item
                              WHERE item.session_id = p_session_id
                                AND item.store_id = p_store_id
                                AND item.excluded_at IS NULL
                                AND item.counted_at IS NOT NULL
                                AND item.product_id = adjustment.product_id
                          )
                    ), '[]'::JSONB)
                )::TEXT,
                'UTF8'
            ),
            'sha256'
        ),
        'hex'
    ) INTO v_source_fingerprint;

    SELECT run.id
      INTO v_run_id
      FROM public.inventory_calculation_runs AS run
     WHERE run.session_id = p_session_id
       AND run.snapshot_id = p_snapshot_id
       AND run.source_fingerprint = v_source_fingerprint
       AND run.status = 'succeeded';
    v_reused := v_run_id IS NOT NULL;

    -- calculated_quantity = physical_quantity - sales_quantity + return_quantity
    --     + transfer_in_quantity - transfer_out_quantity - usage_quantity + adjustment_delta
    SELECT COUNT(*) FILTER (WHERE pos.match_status = 'matched'),
           COUNT(*) FILTER (WHERE pos.match_status NOT IN ('matched', 'ignored_kind')),
           COUNT(*) FILTER (WHERE pos.signature_ordinal > 1)
      INTO v_matched_count, v_unmatched_count, v_duplicate_count
      FROM public.pos_inventory_snapshot_rows AS pos
     WHERE pos.snapshot_id = p_snapshot_id
       AND pos.store_id = p_store_id
       AND pos.event_at > v_calculation_from
       AND pos.event_at <= p_calculated_as_of;

    SELECT COUNT(*)
      INTO v_ambiguous_count
      FROM public.pos_inventory_snapshot_rows AS pos
      JOIN public.inventory_session_items AS item
        ON item.session_id = p_session_id
       AND item.store_id = p_store_id
       AND item.product_id = pos.matched_product_id
       AND item.counted_at IS NOT NULL
       AND item.excluded_at IS NULL
     WHERE pos.snapshot_id = p_snapshot_id
       AND pos.store_id = p_store_id
       AND pos.match_status = 'matched'
       AND pos.event_at <= p_calculated_as_of
       AND date_trunc('minute', pos.event_at) = date_trunc('minute', item.counted_at);

    SELECT COUNT(*)
      INTO v_balance_count
      FROM public.inventory_session_items AS item
     WHERE item.session_id = p_session_id
       AND item.store_id = p_store_id
       AND item.counted_at IS NOT NULL
       AND item.excluded_at IS NULL;

    IF v_run_id IS NULL THEN
        INSERT INTO public.inventory_calculation_runs (
            session_id,
            snapshot_id,
            store_id,
            status,
            calculation_from,
            calculated_as_of,
            source_fingerprint,
            matched_row_count,
            unmatched_row_count,
            ambiguous_row_count,
            duplicate_row_count,
            result_summary,
            created_by,
            completed_at
        ) VALUES (
            p_session_id,
            p_snapshot_id,
            p_store_id,
            'succeeded',
            v_calculation_from,
            p_calculated_as_of,
            v_source_fingerprint,
            v_matched_count,
            v_unmatched_count,
            v_ambiguous_count,
            v_duplicate_count,
            jsonb_build_object('balanceRowCount', v_balance_count),
            auth.uid(),
            clock_timestamp()
        )
        RETURNING id INTO v_run_id;
    END IF;

    INSERT INTO public.inventory_balances (
        store_id,
        product_id,
        session_id,
        session_item_id,
        calculation_run_id,
        physical_quantity,
        counted_at,
        sales_quantity,
        return_quantity,
        transfer_in_quantity,
        transfer_out_quantity,
        usage_quantity,
        adjustment_delta,
        calculated_quantity,
        calculated_as_of
    )
    SELECT
        result.store_id,
        result.product_id,
        result.session_id,
        result.session_item_id,
        v_run_id,
        result.physical_quantity,
        result.counted_at,
        result.sales_quantity,
        result.return_quantity,
        result.transfer_in_quantity,
        result.transfer_out_quantity,
        result.usage_quantity,
        result.adjustment_delta,
        result.calculated_quantity,
        p_calculated_as_of
    FROM (
        SELECT
            item.store_id,
            item.product_id,
            item.session_id,
            item.id AS session_item_id,
            item.counted_quantity AS physical_quantity,
            item.counted_at,
            COALESCE(pos.sales_quantity, 0::NUMERIC) AS sales_quantity,
            COALESCE(pos.return_quantity, 0::NUMERIC) AS return_quantity,
            COALESCE(movement.transfer_in_quantity, 0::NUMERIC) AS transfer_in_quantity,
            COALESCE(movement.transfer_out_quantity, 0::NUMERIC) AS transfer_out_quantity,
            COALESCE(movement.usage_quantity, 0::NUMERIC) AS usage_quantity,
            COALESCE(adjustment.adjustment_delta, 0::NUMERIC) AS adjustment_delta,
            item.counted_quantity
                - COALESCE(pos.sales_quantity, 0::NUMERIC)
                + COALESCE(pos.return_quantity, 0::NUMERIC)
                + COALESCE(movement.transfer_in_quantity, 0::NUMERIC)
                - COALESCE(movement.transfer_out_quantity, 0::NUMERIC)
                - COALESCE(movement.usage_quantity, 0::NUMERIC)
                + COALESCE(adjustment.adjustment_delta, 0::NUMERIC) AS calculated_quantity
        FROM public.inventory_session_items AS item
        LEFT JOIN LATERAL (
            SELECT
                COALESCE(SUM(pos.quantity) FILTER (WHERE pos.event_kind = 'sale'), 0::NUMERIC) AS sales_quantity,
                COALESCE(SUM(pos.quantity) FILTER (WHERE pos.event_kind = 'return'), 0::NUMERIC) AS return_quantity
            FROM public.pos_inventory_snapshot_rows AS pos
            WHERE pos.snapshot_id = p_snapshot_id
              AND pos.store_id = p_store_id
              AND pos.matched_product_id = item.product_id
              AND pos.match_status = 'matched'
              AND pos.event_at > item.counted_at
              AND pos.event_at <= p_calculated_as_of
              AND date_trunc('minute', pos.event_at) <> date_trunc('minute', item.counted_at)
        ) AS pos ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                COALESCE(SUM(ABS(transfer.quantity)) FILTER (
                    WHERE transfer.entry_type = 'transfer' AND transfer.to_store_id = p_store_id
                ), 0::NUMERIC) AS transfer_in_quantity,
                COALESCE(SUM(ABS(transfer.quantity)) FILTER (
                    WHERE transfer.entry_type = 'transfer' AND transfer.from_store_id = p_store_id
                ), 0::NUMERIC) AS transfer_out_quantity,
                COALESCE(SUM(ABS(transfer.quantity)) FILTER (
                    WHERE transfer.entry_type = 'usage' AND transfer.from_store_id = p_store_id
                ), 0::NUMERIC) AS usage_quantity
            FROM public.transfers AS transfer
            WHERE transfer.jan_code = item.jan_snapshot
              AND (transfer.from_store_id = p_store_id OR transfer.to_store_id = p_store_id)
              AND transfer.transfer_date > item.counted_at
              AND transfer.transfer_date <= p_calculated_as_of
        ) AS movement ON TRUE
        LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(adjustment.quantity_delta), 0::NUMERIC) AS adjustment_delta
            FROM public.inventory_adjustments AS adjustment
            WHERE adjustment.store_id = p_store_id
              AND adjustment.product_id = item.product_id
              AND adjustment.effective_at > item.counted_at
              AND adjustment.effective_at <= p_calculated_as_of
        ) AS adjustment ON TRUE
        WHERE item.session_id = p_session_id
          AND item.store_id = p_store_id
          AND item.counted_at IS NOT NULL
          AND item.excluded_at IS NULL
    ) AS result
    ON CONFLICT (store_id, product_id) DO UPDATE SET
        session_id = EXCLUDED.session_id,
        session_item_id = EXCLUDED.session_item_id,
        calculation_run_id = EXCLUDED.calculation_run_id,
        physical_quantity = EXCLUDED.physical_quantity,
        counted_at = EXCLUDED.counted_at,
        sales_quantity = EXCLUDED.sales_quantity,
        return_quantity = EXCLUDED.return_quantity,
        transfer_in_quantity = EXCLUDED.transfer_in_quantity,
        transfer_out_quantity = EXCLUDED.transfer_out_quantity,
        usage_quantity = EXCLUDED.usage_quantity,
        adjustment_delta = EXCLUDED.adjustment_delta,
        calculated_quantity = EXCLUDED.calculated_quantity,
        calculated_as_of = EXCLUDED.calculated_as_of;

    -- balanceは再生成可能な投影。除外へ変更された同一sessionの商品だけを正本から外す。
    DELETE FROM public.inventory_balances AS balance
     WHERE balance.store_id = p_store_id
       AND balance.session_id = p_session_id
       AND NOT EXISTS (
           SELECT 1
           FROM public.inventory_session_items AS item
           WHERE item.session_id = p_session_id
             AND item.store_id = balance.store_id
             AND item.product_id = balance.product_id
             AND item.counted_at IS NOT NULL
             AND item.excluded_at IS NULL
       );

    RETURN QUERY SELECT
        v_run_id,
        v_source_fingerprint,
        v_reused,
        v_matched_count,
        v_unmatched_count,
        v_ambiguous_count,
        v_duplicate_count,
        v_balance_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_inventory_session(UUID, INTEGER, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_inventory_session(UUID, INTEGER, UUID, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.recalculate_inventory_session(UUID, INTEGER, UUID, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.recalculate_inventory_session(UUID, INTEGER, UUID, TIMESTAMPTZ) IS
    '計数時刻以降のPOS・移動・使用・調整を一時tableなしで毎回全量再集計し、現在庫投影を上書きする。';
