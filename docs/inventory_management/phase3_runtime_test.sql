-- Phase 3 本番runtime test
-- 数量0、追加・置換、計数時刻、store_id + JAN、店舗越境拒否を実DBで確認する。
-- すべて同一transactionで実行し、最後に必ずROLLBACKする。

BEGIN;

CREATE TEMP TABLE phase3_runtime_context (
    user_id UUID NOT NULL,
    session_id UUID,
    store7_product_id INTEGER NOT NULL,
    store6_product_id INTEGER NOT NULL,
    common_jan TEXT NOT NULL
);

DO $setup$
DECLARE
    v_user_id UUID;
    v_store7_product_id INTEGER;
    v_store6_product_id INTEGER;
    v_common_jan TEXT;
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
       AND access_row.role IN ('manager', 'staff')
       AND NOT EXISTS (
           SELECT 1
             FROM public.user_store_access AS other_access
            WHERE other_access.user_id = access_row.user_id
              AND other_access.store_id = 6
       )
     ORDER BY access_row.user_id
     LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'store 7 only runtime test user was not found';
    END IF;

    SELECT store7_product.id, store6_product.id, store7_product.jan_code
      INTO v_store7_product_id, v_store6_product_id, v_common_jan
      FROM public.products AS store7_product
      JOIN public.products AS store6_product
        ON store6_product.store_id = 6
       AND store6_product.jan_code = store7_product.jan_code
     WHERE store7_product.store_id = 7
       AND store7_product.jan_code IS NOT NULL
       AND BTRIM(store7_product.jan_code) <> ''
     ORDER BY store7_product.id
     LIMIT 1;

    IF v_store7_product_id IS NULL OR v_store6_product_id IS NULL THEN
        RAISE EXCEPTION 'common JAN runtime test products were not found';
    END IF;

    INSERT INTO phase3_runtime_context (
        user_id,
        store7_product_id,
        store6_product_id,
        common_jan
    ) VALUES (
        v_user_id,
        v_store7_product_id,
        v_store6_product_id,
        v_common_jan
    );
END;
$setup$;

GRANT SELECT, UPDATE ON TABLE phase3_runtime_context TO authenticated;
SET LOCAL ROLE authenticated;

DO $runtime$
DECLARE
    v_context phase3_runtime_context%ROWTYPE;
    v_start JSONB;
    v_workspace JSONB;
    v_saved JSONB;
    v_session_id UUID;
    v_row_version BIGINT;
    v_initial_counted_at TIMESTAMPTZ;
    v_added_counted_at TIMESTAMPTZ;
    v_replaced_counted_at TIMESTAMPTZ;
    v_expected_product_count BIGINT;
    v_snapshot_product_count BIGINT;
    v_store6_denied BOOLEAN := FALSE;
BEGIN
    SELECT * INTO v_context FROM phase3_runtime_context;
    PERFORM set_config(
        'request.jwt.claims',
        jsonb_build_object('sub', v_context.user_id, 'role', 'authenticated')::TEXT,
        TRUE
    );

    SELECT public.start_inventory_session(7) INTO v_start;
    v_session_id := (v_start ->> 'sessionId')::UUID;
    IF v_session_id IS NULL OR v_start ->> 'status' <> 'draft' THEN
        RAISE EXCEPTION 'inventory session start failed';
    END IF;

    UPDATE phase3_runtime_context SET session_id = v_session_id;

    SELECT COUNT(*)
      INTO v_expected_product_count
      FROM public.products AS product
     WHERE product.store_id = 7
       AND product.jan_code IS NOT NULL
       AND BTRIM(product.jan_code) <> '';

    SELECT COUNT(*)
      INTO v_snapshot_product_count
      FROM public.inventory_session_items AS item
     WHERE item.session_id = v_session_id
       AND item.store_id = 7;

    IF v_snapshot_product_count <> v_expected_product_count
       OR (v_start ->> 'totalCount')::BIGINT <> v_expected_product_count THEN
        RAISE EXCEPTION 'store 7 product snapshot count mismatch';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.inventory_session_items AS item
         WHERE item.session_id = v_session_id
           AND item.store_id <> 7
    ) THEN
        RAISE EXCEPTION 'cross-store product was included in snapshot';
    END IF;

    SELECT public.get_inventory_workspace(
        7,
        v_session_id,
        v_context.common_jan,
        'all',
        20,
        0
    ) INTO v_workspace;

    IF jsonb_array_length(v_workspace -> 'items') <> 1
       OR (v_workspace #>> '{items,0,productId}')::INTEGER <> v_context.store7_product_id
       OR (v_workspace #>> '{items,0,storeId}')::INTEGER <> 7
       OR (v_workspace #>> '{items,0,productId}')::INTEGER = v_context.store6_product_id THEN
        RAISE EXCEPTION 'store_id + JAN workspace match failed';
    END IF;

    SELECT item.row_version
      INTO v_row_version
      FROM public.inventory_session_items AS item
     WHERE item.session_id = v_session_id
       AND item.store_id = 7
       AND item.jan_snapshot = v_context.common_jan;

    SELECT public.save_inventory_count(
        v_session_id,
        7,
        v_context.common_jan,
        0,
        'initial',
        v_row_version
    ) INTO v_saved;

    v_initial_counted_at := (v_saved #>> '{item,countedAt}')::TIMESTAMPTZ;
    v_row_version := (v_saved #>> '{item,rowVersion}')::BIGINT;
    IF (v_saved #>> '{item,countedQuantity}')::NUMERIC <> 0
       OR v_initial_counted_at IS NULL
       OR (v_saved #>> '{progress,countedCount}')::BIGINT <> 1 THEN
        RAISE EXCEPTION 'zero quantity initial count failed';
    END IF;

    SELECT public.save_inventory_count(
        v_session_id,
        7,
        v_context.common_jan,
        3,
        'add',
        v_row_version
    ) INTO v_saved;

    v_added_counted_at := (v_saved #>> '{item,countedAt}')::TIMESTAMPTZ;
    v_row_version := (v_saved #>> '{item,rowVersion}')::BIGINT;
    IF (v_saved #>> '{item,countedQuantity}')::NUMERIC <> 3
       OR v_added_counted_at <> v_initial_counted_at THEN
        RAISE EXCEPTION 'add quantity or original counted_at preservation failed';
    END IF;

    SELECT public.save_inventory_count(
        v_session_id,
        7,
        v_context.common_jan,
        4,
        'replace',
        v_row_version
    ) INTO v_saved;

    v_replaced_counted_at := (v_saved #>> '{item,countedAt}')::TIMESTAMPTZ;
    IF (v_saved #>> '{item,countedQuantity}')::NUMERIC <> 4
       OR v_replaced_counted_at <= v_added_counted_at THEN
        RAISE EXCEPTION 'replace quantity or counted_at refresh failed';
    END IF;

    IF (
        SELECT COUNT(*)
          FROM public.inventory_count_changes AS change
         WHERE change.session_id = v_session_id
           AND change.product_id = v_context.store7_product_id
    ) <> 3 THEN
        RAISE EXCEPTION 'count change audit rows were not appended';
    END IF;

    BEGIN
        PERFORM public.get_inventory_workspace(
            6,
            NULL,
            v_context.common_jan,
            'all',
            20,
            0
        );
    EXCEPTION
        WHEN SQLSTATE '42501' THEN
            v_store6_denied := TRUE;
    END;

    IF NOT v_store6_denied THEN
        RAISE EXCEPTION 'store 6 access denial failed';
    END IF;
END;
$runtime$;

RESET ROLE;
SELECT 'phase3_runtime_test_passed' AS result;

ROLLBACK;
