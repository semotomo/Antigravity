-- Phase 2 本番runtime test
-- 共通JANでstore 7の商品だけが選ばれること、冪等再計算、確定、store 6拒否を確認する。
-- すべて同一transactionで実行し、最後に必ずROLLBACKする。

BEGIN;

CREATE TEMP TABLE phase2_runtime_context (
    user_id UUID NOT NULL,
    store7_product_id INTEGER NOT NULL,
    store6_product_id INTEGER NOT NULL,
    common_jan TEXT NOT NULL,
    store7_session_id UUID NOT NULL,
    store6_session_id UUID NOT NULL,
    counted_at TIMESTAMPTZ NOT NULL,
    calculated_as_of TIMESTAMPTZ NOT NULL
);

DO $setup$
DECLARE
    v_user_id UUID;
    v_store7_product_id INTEGER;
    v_store6_product_id INTEGER;
    v_common_jan TEXT;
    v_product_name TEXT;
    v_store7_session_id UUID;
    v_store6_session_id UUID;
    v_counted_at TIMESTAMPTZ := date_trunc('minute', clock_timestamp()) - INTERVAL '20 minutes';
    v_calculated_as_of TIMESTAMPTZ := date_trunc('minute', clock_timestamp()) - INTERVAL '5 minutes';
BEGIN
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

    SELECT store7_product.id, store6_product.id, store7_product.jan_code,
           COALESCE(NULLIF(BTRIM(store7_product.product_name), ''), 'runtime test product')
      INTO v_store7_product_id, v_store6_product_id, v_common_jan, v_product_name
      FROM public.products AS store7_product
      JOIN public.products AS store6_product
        ON store6_product.store_id = 6
       AND store6_product.jan_code = store7_product.jan_code
     WHERE store7_product.store_id = 7
       AND store7_product.jan_code IS NOT NULL
     ORDER BY store7_product.id
     LIMIT 1;

    IF v_store7_product_id IS NULL OR v_store6_product_id IS NULL THEN
        RAISE EXCEPTION 'common JAN runtime test products were not found';
    END IF;

    INSERT INTO public.inventory_sessions (
        store_id, started_by, updated_by
    ) VALUES (
        7, v_user_id, v_user_id
    ) RETURNING id INTO v_store7_session_id;

    INSERT INTO public.inventory_sessions (
        store_id, started_by, updated_by
    ) VALUES (
        6, v_user_id, v_user_id
    ) RETURNING id INTO v_store6_session_id;

    INSERT INTO public.inventory_session_items (
        session_id,
        store_id,
        product_id,
        jan_snapshot,
        product_name_snapshot,
        counted_quantity,
        counted_at,
        counted_by,
        created_by,
        updated_by
    ) VALUES
    (
        v_store7_session_id,
        7,
        v_store7_product_id,
        v_common_jan,
        v_product_name,
        10,
        v_counted_at,
        v_user_id,
        v_user_id,
        v_user_id
    ),
    (
        v_store6_session_id,
        6,
        v_store6_product_id,
        v_common_jan,
        v_product_name,
        5,
        v_counted_at,
        v_user_id,
        v_user_id,
        v_user_id
    );

    INSERT INTO phase2_runtime_context (
        user_id,
        store7_product_id,
        store6_product_id,
        common_jan,
        store7_session_id,
        store6_session_id,
        counted_at,
        calculated_as_of
    ) VALUES (
        v_user_id,
        v_store7_product_id,
        v_store6_product_id,
        v_common_jan,
        v_store7_session_id,
        v_store6_session_id,
        v_counted_at,
        v_calculated_as_of
    );
END;
$setup$;

GRANT SELECT ON TABLE phase2_runtime_context TO authenticated;
SET LOCAL ROLE authenticated;

DO $runtime$
DECLARE
    v_context phase2_runtime_context%ROWTYPE;
    v_snapshot_id UUID;
    v_first_run_id UUID;
    v_second_run_id UUID;
    v_reused BOOLEAN;
    v_sales_quantity NUMERIC;
    v_calculated_quantity NUMERIC;
    v_matched_product_id INTEGER;
    v_run_count BIGINT;
    v_session_version BIGINT;
    v_session_status TEXT;
    v_store6_denied BOOLEAN := FALSE;
BEGIN
    SELECT * INTO v_context FROM phase2_runtime_context;
    PERFORM set_config(
        'request.jwt.claims',
        jsonb_build_object('sub', v_context.user_id, 'role', 'authenticated')::TEXT,
        TRUE
    );

    SELECT saved.snapshot_id
      INTO v_snapshot_id
      FROM public.save_inventory_pos_snapshot(
          7,
          v_context.counted_at,
          v_context.calculated_as_of,
          v_context.calculated_as_of,
          repeat('a', 64),
          jsonb_build_array(
              jsonb_build_object(
                  'signatureHash', repeat('b', 64),
                  'eventKind', 'sale',
                  'eventAt', v_context.counted_at + INTERVAL '1 minute',
                  'eventTimePrecision', 'minute',
                  'janCode', v_context.common_jan,
                  'productName', 'runtime test product',
                  'quantity', 2,
                  'unitPrice', 100,
                  'totalAmount', 200,
                  'rawPayload', '{}'::JSONB
              )
          )
      ) AS saved;

    SELECT snapshot_row.matched_product_id
      INTO v_matched_product_id
      FROM public.pos_inventory_snapshot_rows AS snapshot_row
     WHERE snapshot_row.snapshot_id = v_snapshot_id
       AND snapshot_row.row_no = 1;

    IF v_matched_product_id <> v_context.store7_product_id
       OR v_matched_product_id = v_context.store6_product_id THEN
        RAISE EXCEPTION 'store_id + JAN product match failed';
    END IF;

    SELECT calculation.calculation_run_id, calculation.reused_run
      INTO v_first_run_id, v_reused
      FROM public.recalculate_inventory_session(
          v_context.store7_session_id,
          7,
          v_snapshot_id,
          v_context.calculated_as_of
      ) AS calculation;

    IF v_reused THEN
        RAISE EXCEPTION 'first calculation unexpectedly reused a run';
    END IF;

    SELECT balance.sales_quantity, balance.calculated_quantity
      INTO v_sales_quantity, v_calculated_quantity
      FROM public.inventory_balances AS balance
     WHERE balance.store_id = 7
       AND balance.product_id = v_context.store7_product_id;

    IF v_sales_quantity <> 2 OR v_calculated_quantity <> 8 THEN
        RAISE EXCEPTION 'inventory calculation mismatch';
    END IF;

    SELECT calculation.calculation_run_id, calculation.reused_run
      INTO v_second_run_id, v_reused
      FROM public.recalculate_inventory_session(
          v_context.store7_session_id,
          7,
          v_snapshot_id,
          v_context.calculated_as_of
      ) AS calculation;

    SELECT COUNT(*)
      INTO v_run_count
      FROM public.inventory_calculation_runs AS calculation_run
     WHERE calculation_run.session_id = v_context.store7_session_id;

    IF v_second_run_id <> v_first_run_id OR NOT v_reused OR v_run_count <> 1 THEN
        RAISE EXCEPTION 'calculation run idempotency failed';
    END IF;

    BEGIN
        PERFORM *
          FROM public.get_inventory_recalculation_context(
              v_context.store6_session_id,
              6
          );
    EXCEPTION
        WHEN SQLSTATE '42501' THEN
            v_store6_denied := TRUE;
    END;

    IF NOT v_store6_denied THEN
        RAISE EXCEPTION 'store access denied check failed';
    END IF;

    SELECT session.row_version
      INTO v_session_version
      FROM public.inventory_sessions AS session
     WHERE session.id = v_context.store7_session_id
       AND session.store_id = 7;

    PERFORM *
      FROM public.finalize_inventory_session(
          v_context.store7_session_id,
          7,
          v_session_version,
          v_snapshot_id,
          v_context.calculated_as_of
      );

    SELECT session.status
      INTO v_session_status
      FROM public.inventory_sessions AS session
     WHERE session.id = v_context.store7_session_id
       AND session.store_id = 7;

    IF v_session_status <> 'finalized' THEN
        RAISE EXCEPTION 'inventory finalization failed';
    END IF;
END;
$runtime$;

RESET ROLE;
SELECT 'phase2_runtime_test_passed' AS result;

ROLLBACK;
