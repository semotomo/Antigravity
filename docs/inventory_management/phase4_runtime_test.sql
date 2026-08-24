-- Phase 4 本番runtime test
-- manager権限、store_id + JAN、手動停止override、read-only preview、訂正・調整の監査を確認する。
-- テストデータと既存商品の一時変更は最後に必ずROLLBACKする。

BEGIN;

CREATE TEMP TABLE phase4_runtime_context (
    user_id UUID NOT NULL,
    session_id UUID NOT NULL,
    item_id UUID NOT NULL,
    snapshot_id UUID NOT NULL,
    product_id INTEGER NOT NULL,
    jan_code TEXT NOT NULL,
    counted_at TIMESTAMPTZ NOT NULL,
    calculated_as_of TIMESTAMPTZ NOT NULL
);

DO $setup$
DECLARE
    v_user_id UUID;
    v_product public.products%ROWTYPE;
    v_session_id UUID := gen_random_uuid();
    v_item_id UUID := gen_random_uuid();
    v_snapshot_id UUID := gen_random_uuid();
    v_counted_at TIMESTAMPTZ := clock_timestamp() - INTERVAL '2 hours';
    v_calculated_as_of TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF EXISTS (
        SELECT 1
          FROM public.inventory_sessions AS session
         WHERE session.store_id = 7
           AND session.status IN ('draft', 'finalizing')
    ) THEN
        RAISE EXCEPTION 'store 7 already has an active inventory session; runtime test refused';
    END IF;

    SELECT access_row.user_id
      INTO v_user_id
      FROM public.user_store_access AS access_row
     WHERE access_row.store_id = 7
       AND access_row.role = 'manager'
       AND NOT EXISTS (
           SELECT 1
             FROM public.user_store_access AS other_access
            WHERE other_access.user_id = access_row.user_id
              AND other_access.store_id = 6
       )
     ORDER BY access_row.user_id
     LIMIT 1;
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'store 7 only manager runtime test user was not found';
    END IF;

    SELECT product.*
      INTO v_product
      FROM public.products AS product
     WHERE product.store_id = 7
       AND product.is_active
       AND product.jan_code IS NOT NULL
       AND BTRIM(product.jan_code) <> ''
     ORDER BY product.id
     LIMIT 1;
    IF v_product.id IS NULL THEN
        RAISE EXCEPTION 'active store 7 runtime test product was not found';
    END IF;

    INSERT INTO public.inventory_sessions (
        id, store_id, status, started_at, started_by, updated_by
    ) VALUES (
        v_session_id, 7, 'draft', v_counted_at, v_user_id, v_user_id
    );

    INSERT INTO public.inventory_session_items (
        id, session_id, store_id, product_id, jan_snapshot,
        product_name_snapshot, category_snapshot, supplier_snapshot,
        counted_quantity, counted_at, counted_by, created_by, updated_by
    ) VALUES (
        v_item_id, v_session_id, 7, v_product.id, v_product.jan_code,
        COALESCE(NULLIF(BTRIM(v_product.product_name), ''), 'Phase 4 runtime product'),
        v_product.category, v_product.supplier_name,
        10, v_counted_at, v_user_id, v_user_id, v_user_id
    );

    INSERT INTO public.pos_inventory_snapshots (
        id, store_id, source_from, source_to, fetched_by,
        status, row_count, payload_sha256
    ) VALUES (
        v_snapshot_id, 7, v_counted_at, v_calculated_as_of, v_user_id,
        'succeeded', 0, repeat('a', 64)
    );

    INSERT INTO phase4_runtime_context (
        user_id, session_id, item_id, snapshot_id, product_id,
        jan_code, counted_at, calculated_as_of
    ) VALUES (
        v_user_id, v_session_id, v_item_id, v_snapshot_id, v_product.id,
        v_product.jan_code, v_counted_at, v_calculated_as_of
    );
END;
$setup$;

GRANT SELECT ON TABLE phase4_runtime_context TO authenticated;
SET LOCAL ROLE authenticated;

DO $runtime$
DECLARE
    v_context phase4_runtime_context%ROWTYPE;
    v_preview JSONB;
    v_status JSONB;
    v_correction JSONB;
    v_adjustment_first JSONB;
    v_adjustment_second JSONB;
    v_overview JSONB;
    v_print JSONB;
    v_session_row_version BIGINT;
    v_item_row_version BIGINT;
    v_before_balance_hash TEXT;
    v_after_balance_hash TEXT;
    v_store6_denied BOOLEAN := FALSE;
    v_idempotency_key UUID := gen_random_uuid();
BEGIN
    SELECT * INTO v_context FROM phase4_runtime_context;
    PERFORM set_config(
        'request.jwt.claims',
        jsonb_build_object('sub', v_context.user_id, 'role', 'authenticated')::TEXT,
        TRUE
    );

    SELECT md5(COALESCE(jsonb_agg(to_jsonb(balance) ORDER BY balance.store_id, balance.product_id)::TEXT, '[]'))
      INTO v_before_balance_hash
      FROM public.inventory_balances AS balance;

    SELECT public.preview_inventory_finalization(
        v_context.session_id,
        7,
        v_context.snapshot_id,
        v_context.calculated_as_of
    ) INTO v_preview;
    IF COALESCE((v_preview ->> 'canFinalize')::BOOLEAN, FALSE) IS NOT TRUE
       OR (v_preview ->> 'balanceCount')::INTEGER <> 1 THEN
        RAISE EXCEPTION 'finalization preview failed: %', v_preview;
    END IF;

    SELECT md5(COALESCE(jsonb_agg(to_jsonb(balance) ORDER BY balance.store_id, balance.product_id)::TEXT, '[]'))
      INTO v_after_balance_hash
      FROM public.inventory_balances AS balance;
    IF v_before_balance_hash IS DISTINCT FROM v_after_balance_hash THEN
        RAISE EXCEPTION 'preview changed inventory balances';
    END IF;

    SELECT public.set_inventory_product_status(
        7, v_context.jan_code, FALSE, 'Phase 4 runtime stop'
    ) INTO v_status;
    IF (v_status ->> 'isActive')::BOOLEAN IS NOT FALSE
       OR (v_status ->> 'manuallyInactive')::BOOLEAN IS NOT TRUE THEN
        RAISE EXCEPTION 'manual product stop failed: %', v_status;
    END IF;

    SELECT public.set_inventory_product_status(
        7, v_context.jan_code, TRUE, 'Phase 4 runtime restore'
    ) INTO v_status;
    IF (v_status ->> 'isActive')::BOOLEAN IS NOT TRUE
       OR (v_status ->> 'manuallyInactive')::BOOLEAN IS NOT FALSE THEN
        RAISE EXCEPTION 'manual product restore failed: %', v_status;
    END IF;
    IF (
        SELECT COUNT(*)
          FROM public.inventory_product_status_changes AS change
         WHERE change.store_id = 7
           AND change.product_id = v_context.product_id
    ) <> 2 THEN
        RAISE EXCEPTION 'product status audit rows were not appended';
    END IF;

    BEGIN
        PERFORM public.set_inventory_product_status(
            6, v_context.jan_code, FALSE, 'Phase 4 cross-store denial'
        );
    EXCEPTION
        WHEN SQLSTATE '42501' THEN
            v_store6_denied := TRUE;
    END;
    IF NOT v_store6_denied THEN
        RAISE EXCEPTION 'store 6 access denial failed';
    END IF;

    SELECT session.row_version
      INTO v_session_row_version
      FROM public.inventory_sessions AS session
     WHERE session.id = v_context.session_id
       AND session.store_id = 7;
    PERFORM public.finalize_inventory_session(
        v_context.session_id,
        7,
        v_session_row_version,
        v_context.snapshot_id,
        v_context.calculated_as_of
    );

    SELECT item.row_version
      INTO v_item_row_version
      FROM public.inventory_session_items AS item
     WHERE item.id = v_context.item_id
       AND item.store_id = 7;
    SELECT public.correct_finalized_inventory_count(
        v_context.session_id,
        7,
        v_context.jan_code,
        11,
        'Phase 4 runtime correction',
        v_item_row_version
    ) INTO v_correction;
    IF (v_correction ->> 'quantity')::NUMERIC <> 11
       OR (v_correction ->> 'countedAt')::TIMESTAMPTZ <> v_context.counted_at THEN
        RAISE EXCEPTION 'finalized count correction failed: %', v_correction;
    END IF;

    SELECT public.add_inventory_adjustment(
        v_context.session_id,
        7,
        v_context.jan_code,
        -1,
        'Phase 4 runtime adjustment',
        v_idempotency_key
    ) INTO v_adjustment_first;
    SELECT public.add_inventory_adjustment(
        v_context.session_id,
        7,
        v_context.jan_code,
        -1,
        'Phase 4 runtime duplicate',
        v_idempotency_key
    ) INTO v_adjustment_second;
    IF v_adjustment_first ->> 'adjustmentId' <> v_adjustment_second ->> 'adjustmentId'
       OR (
           SELECT COUNT(*)
             FROM public.inventory_adjustments AS adjustment
            WHERE adjustment.store_id = 7
              AND adjustment.idempotency_key = v_idempotency_key
       ) <> 1 THEN
        RAISE EXCEPTION 'adjustment idempotency failed';
    END IF;

    SELECT public.get_inventory_overview(7, v_context.jan_code, 'all', 20, 0)
      INTO v_overview;
    SELECT public.get_inventory_print_data(7, v_context.session_id, 'result', 'category')
      INTO v_print;
    IF jsonb_array_length(v_overview -> 'items') <> 1
       OR jsonb_array_length(v_print -> 'items') <> 1 THEN
        RAISE EXCEPTION 'overview or print data store/JAN isolation failed';
    END IF;
END;
$runtime$;

RESET ROLE;
SELECT 'phase4_runtime_test_passed' AS result;

ROLLBACK;
