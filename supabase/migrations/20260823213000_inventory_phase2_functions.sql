-- 棚卸し・在庫管理 Phase 2
-- POS履歴をimmutable snapshotへ保存し、各商品の計数時刻以降を全量再集計する。

CREATE OR REPLACE FUNCTION public.get_inventory_recalculation_context(
    p_session_id UUID,
    p_store_id INTEGER
)
RETURNS TABLE (
    store_id INTEGER,
    calculation_from TIMESTAMPTZ,
    source_from TIMESTAMPTZ,
    counted_item_count BIGINT,
    uncounted_item_count BIGINT,
    excluded_item_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status TEXT;
    v_calculation_from TIMESTAMPTZ;
    v_counted BIGINT;
    v_uncounted BIGINT;
    v_excluded BIGINT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager', 'staff']::TEXT[]) THEN
        RAISE EXCEPTION 'store access denied' USING ERRCODE = '42501';
    END IF;

    SELECT session.status
      INTO v_status
      FROM public.inventory_sessions AS session
     WHERE session.id = p_session_id
       AND session.store_id = p_store_id;

    IF NOT FOUND OR v_status = 'cancelled' THEN
        RAISE EXCEPTION 'inventory session is unavailable' USING ERRCODE = '22023';
    END IF;

    SELECT
        MIN(item.counted_at) FILTER (
            WHERE item.counted_at IS NOT NULL AND item.excluded_at IS NULL
        ),
        COUNT(*) FILTER (
            WHERE item.counted_at IS NOT NULL AND item.excluded_at IS NULL
        ),
        COUNT(*) FILTER (
            WHERE item.counted_at IS NULL AND item.excluded_at IS NULL
        ),
        COUNT(*) FILTER (WHERE item.excluded_at IS NOT NULL)
      INTO v_calculation_from, v_counted, v_uncounted, v_excluded
      FROM public.inventory_session_items AS item
     WHERE item.session_id = p_session_id
       AND item.store_id = p_store_id;

    IF v_calculation_from IS NULL THEN
        RAISE EXCEPTION 'no counted inventory items' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY SELECT
        p_store_id,
        v_calculation_from,
        v_calculation_from,
        v_counted,
        v_uncounted,
        v_excluded;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_inventory_pos_snapshot(
    p_store_id INTEGER,
    p_source_from TIMESTAMPTZ,
    p_source_to TIMESTAMPTZ,
    p_fetched_at TIMESTAMPTZ,
    p_payload_sha256 TEXT,
    p_rows JSONB
)
RETURNS TABLE (
    snapshot_id UUID,
    payload_sha256 TEXT,
    row_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_snapshot_id UUID;
    v_row_count INTEGER;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager', 'staff']::TEXT[]) THEN
        RAISE EXCEPTION 'store access denied' USING ERRCODE = '42501';
    END IF;
    IF p_source_from IS NULL OR p_source_to IS NULL OR p_fetched_at IS NULL
       OR p_source_to < p_source_from OR p_fetched_at <> p_source_to THEN
        RAISE EXCEPTION 'invalid POS snapshot period' USING ERRCODE = '22023';
    END IF;
    IF p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'invalid POS snapshot hash' USING ERRCODE = '22023';
    END IF;
    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
       OR jsonb_array_length(p_rows) > 100000 THEN
        RAISE EXCEPTION 'invalid POS snapshot rows' USING ERRCODE = '22023';
    END IF;

    v_row_count := jsonb_array_length(p_rows);
    INSERT INTO public.pos_inventory_snapshots (
        store_id,
        source_from,
        source_to,
        fetched_at,
        fetched_by,
        status,
        row_count,
        payload_sha256
    ) VALUES (
        p_store_id,
        p_source_from,
        p_source_to,
        p_fetched_at,
        auth.uid(),
        'succeeded',
        v_row_count,
        p_payload_sha256
    )
    RETURNING id INTO v_snapshot_id;

    WITH source_rows AS (
        SELECT
            source.ordinality::INTEGER AS source_ordinal,
            source.element,
            NULLIF(BTRIM(source.element ->> 'janCode'), '') AS jan_code,
            COALESCE(NULLIF(BTRIM(source.element ->> 'productName'), ''), '商品名なし') AS product_name,
            source.element ->> 'eventKind' AS event_kind,
            (source.element ->> 'eventAt')::TIMESTAMPTZ AS event_at,
            COALESCE(NULLIF(source.element ->> 'eventTimePrecision', ''), 'minute') AS event_time_precision,
            ABS((source.element ->> 'quantity')::NUMERIC) AS quantity,
            NULLIF(source.element ->> 'unitPrice', '')::NUMERIC AS unit_price,
            NULLIF(source.element ->> 'totalAmount', '')::NUMERIC AS total_amount,
            source.element ->> 'signatureHash' AS signature_hash,
            COALESCE(source.element -> 'rawPayload', '{}'::JSONB) AS raw_payload
        FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS source(element, ordinality)
    ),
    numbered_rows AS (
        SELECT
            source_rows.*,
            ROW_NUMBER() OVER (
                PARTITION BY source_rows.signature_hash
                ORDER BY source_rows.source_ordinal
            )::INTEGER AS signature_ordinal
        FROM source_rows
    ),
    resolved_rows AS (
        SELECT
            numbered_rows.*,
            product_match.product_count,
            product_match.product_id
        FROM numbered_rows
        LEFT JOIN LATERAL (
            SELECT COUNT(*) AS product_count, MIN(product.id)::INTEGER AS product_id
            FROM public.products AS product
            WHERE product.store_id = p_store_id
              AND product.jan_code = numbered_rows.jan_code
        ) AS product_match ON TRUE
    )
    INSERT INTO public.pos_inventory_snapshot_rows (
        snapshot_id,
        row_no,
        store_id,
        source_event_id,
        signature_hash,
        signature_ordinal,
        event_kind,
        event_at,
        event_time_precision,
        jan_code,
        product_code,
        product_name,
        quantity,
        unit_price,
        total_amount,
        match_status,
        matched_product_id,
        raw_payload
    )
    SELECT
        v_snapshot_id,
        resolved.source_ordinal,
        p_store_id,
        NULL,
        resolved.signature_hash,
        resolved.signature_ordinal,
        resolved.event_kind,
        resolved.event_at,
        resolved.event_time_precision,
        resolved.jan_code,
        resolved.jan_code,
        resolved.product_name,
        resolved.quantity,
        resolved.unit_price,
        resolved.total_amount,
        CASE
            WHEN resolved.event_kind NOT IN ('sale', 'return') THEN 'ignored_kind'
            WHEN resolved.jan_code IS NULL THEN 'missing_jan'
            WHEN resolved.product_count = 0 THEN 'unknown_product'
            WHEN resolved.product_count > 1 THEN 'ambiguous_jan'
            ELSE 'matched'
        END,
        CASE WHEN resolved.event_kind IN ('sale', 'return')
                   AND resolved.jan_code IS NOT NULL
                   AND resolved.product_count = 1
             THEN resolved.product_id
             ELSE NULL
        END,
        resolved.raw_payload
    FROM resolved_rows AS resolved
    ORDER BY resolved.source_ordinal;

    RETURN QUERY SELECT v_snapshot_id, p_payload_sha256, v_row_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_inventory_pos_snapshot_failure(
    p_store_id INTEGER,
    p_source_from TIMESTAMPTZ,
    p_source_to TIMESTAMPTZ,
    p_fetched_at TIMESTAMPTZ,
    p_payload_sha256 TEXT,
    p_failure_message TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_snapshot_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager', 'staff']::TEXT[]) THEN
        RAISE EXCEPTION 'store access denied' USING ERRCODE = '42501';
    END IF;
    IF p_source_from IS NULL OR p_source_to IS NULL OR p_fetched_at IS NULL
       OR p_source_to < p_source_from OR p_fetched_at <> p_source_to
       OR p_payload_sha256 !~ '^[0-9a-f]{64}$'
       OR NULLIF(BTRIM(p_failure_message), '') IS NULL THEN
        RAISE EXCEPTION 'invalid failed snapshot' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.pos_inventory_snapshots (
        store_id,
        source_from,
        source_to,
        fetched_at,
        fetched_by,
        status,
        row_count,
        payload_sha256,
        failure_message
    ) VALUES (
        p_store_id,
        p_source_from,
        p_source_to,
        p_fetched_at,
        auth.uid(),
        'failed',
        0,
        p_payload_sha256,
        LEFT(p_failure_message, 1000)
    )
    RETURNING id INTO v_snapshot_id;

    RETURN v_snapshot_id;
END;
$$;

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
    CREATE TEMP TABLE inventory_recalc_results ON COMMIT DROP AS
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
      AND item.excluded_at IS NULL;

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

    SELECT COUNT(*) INTO v_balance_count FROM inventory_recalc_results;

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
    FROM inventory_recalc_results AS result
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
           FROM inventory_recalc_results AS result
           WHERE result.store_id = balance.store_id
             AND result.product_id = balance.product_id
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

CREATE OR REPLACE FUNCTION public.finalize_inventory_session(
    p_session_id UUID,
    p_store_id INTEGER,
    p_expected_row_version BIGINT,
    p_snapshot_id UUID,
    p_calculated_as_of TIMESTAMPTZ
)
RETURNS TABLE (
    calculation_run_id UUID,
    source_fingerprint TEXT,
    balance_row_count INTEGER,
    finalized_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status TEXT;
    v_row_version BIGINT;
    v_item_count BIGINT;
    v_pending_count BIGINT;
    v_run_id UUID;
    v_source_fingerprint TEXT;
    v_unmatched_count INTEGER;
    v_ambiguous_count INTEGER;
    v_balance_count INTEGER;
    v_finalized_at TIMESTAMPTZ;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager', 'staff']::TEXT[]) THEN
        RAISE EXCEPTION 'store access denied' USING ERRCODE = '42501';
    END IF;
    IF p_expected_row_version IS NULL OR p_expected_row_version < 1 THEN
        RAISE EXCEPTION 'expected row version is required' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_session_id::TEXT || ':' || p_store_id::TEXT, 0)
    );

    SELECT session.status, session.row_version
      INTO v_status, v_row_version
      FROM public.inventory_sessions AS session
     WHERE session.id = p_session_id
       AND session.store_id = p_store_id
     FOR UPDATE;

    IF NOT FOUND OR v_status <> 'draft' THEN
        RAISE EXCEPTION 'inventory session cannot be finalized' USING ERRCODE = '22023';
    END IF;
    IF v_row_version <> p_expected_row_version THEN
        RAISE EXCEPTION 'inventory session was changed by another device' USING ERRCODE = '40001';
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (
            WHERE item.counted_at IS NULL AND item.excluded_at IS NULL
        )
      INTO v_item_count, v_pending_count
      FROM public.inventory_session_items AS item
     WHERE item.session_id = p_session_id
       AND item.store_id = p_store_id;

    IF v_item_count = 0 OR v_pending_count > 0 THEN
        RAISE EXCEPTION 'all inventory items must be counted or excluded' USING ERRCODE = '22023';
    END IF;

    UPDATE public.inventory_sessions AS session
       SET status = 'finalizing',
           updated_by = auth.uid()
     WHERE session.id = p_session_id
       AND session.store_id = p_store_id;

    SELECT
        calculation.calculation_run_id,
        calculation.source_fingerprint,
        calculation.unmatched_row_count,
        calculation.ambiguous_row_count,
        calculation.balance_row_count
      INTO
        v_run_id,
        v_source_fingerprint,
        v_unmatched_count,
        v_ambiguous_count,
        v_balance_count
      FROM public.recalculate_inventory_session(
          p_session_id,
          p_store_id,
          p_snapshot_id,
          p_calculated_as_of
      ) AS calculation;

    IF v_unmatched_count > 0 OR v_ambiguous_count > 0 THEN
        RAISE EXCEPTION 'POS rows require confirmation before finalization' USING ERRCODE = '22023';
    END IF;

    v_finalized_at := clock_timestamp();
    UPDATE public.inventory_sessions AS session
       SET status = 'finalized',
           finalized_at = v_finalized_at,
           finalized_by = auth.uid(),
           updated_by = auth.uid()
     WHERE session.id = p_session_id
       AND session.store_id = p_store_id;

    RETURN QUERY SELECT
        v_run_id,
        v_source_fingerprint,
        v_balance_count,
        v_finalized_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_recalculation_context(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_inventory_recalculation_context(UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_recalculation_context(UUID, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.save_inventory_pos_snapshot(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_inventory_pos_snapshot(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_inventory_pos_snapshot(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.record_inventory_pos_snapshot_failure(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_inventory_pos_snapshot_failure(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_inventory_pos_snapshot_failure(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.recalculate_inventory_session(UUID, INTEGER, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_inventory_session(UUID, INTEGER, UUID, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.recalculate_inventory_session(UUID, INTEGER, UUID, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.finalize_inventory_session(UUID, INTEGER, BIGINT, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_inventory_session(UUID, INTEGER, BIGINT, UUID, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.finalize_inventory_session(UUID, INTEGER, BIGINT, UUID, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.recalculate_inventory_session(UUID, INTEGER, UUID, TIMESTAMPTZ) IS
    '計数時刻以降のPOS・移動・使用・調整を毎回全量再集計し、現在庫投影を上書きする。';
