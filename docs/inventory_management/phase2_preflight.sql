-- 棚卸し在庫 Phase 2 事前確認（参照のみ）
BEGIN;
SET TRANSACTION READ ONLY, ISOLATION LEVEL REPEATABLE READ;

SELECT
    to_regprocedure('extensions.digest(bytea,text)') IS NOT NULL AS has_sha256_digest,
    to_regclass('public.inventory_sessions') IS NOT NULL
        AND to_regclass('public.inventory_session_items') IS NOT NULL
        AND to_regclass('public.pos_inventory_snapshots') IS NOT NULL
        AND to_regclass('public.pos_inventory_snapshot_rows') IS NOT NULL
        AND to_regclass('public.inventory_calculation_runs') IS NOT NULL
        AND to_regclass('public.inventory_balances') IS NOT NULL AS has_phase1_tables,
    (
        SELECT COUNT(*)
        FROM pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.products'::regclass
          AND constraint_row.conname = 'products_id_store_id_jan_code_key'
    ) AS products_id_store_id_jan_code_key_count,
    (
        SELECT COUNT(*)
        FROM pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.inventory_calculation_runs'::regclass
          AND constraint_row.contype = 'u'
          AND pg_get_constraintdef(constraint_row.oid)
              = 'UNIQUE (session_id, snapshot_id, source_fingerprint)'
    ) AS calculation_idempotency_key_count,
    (
        SELECT COUNT(*)
        FROM pg_proc AS routine
        JOIN pg_namespace AS namespace_row ON namespace_row.oid = routine.pronamespace
        WHERE namespace_row.nspname = 'public'
          AND routine.proname IN (
              'get_inventory_recalculation_context',
              'save_inventory_pos_snapshot',
              'record_inventory_pos_snapshot_failure',
              'recalculate_inventory_session',
              'finalize_inventory_session'
          )
    ) AS existing_phase2_routine_count,
    (
        SELECT COUNT(*)
        FROM pg_locks AS lock_row
        WHERE lock_row.relation IN (
            'public.products'::regclass,
            'public.transfers'::regclass,
            'public.inventory_sessions'::regclass,
            'public.inventory_session_items'::regclass,
            'public.pos_inventory_snapshots'::regclass,
            'public.pos_inventory_snapshot_rows'::regclass,
            'public.inventory_calculation_runs'::regclass,
            'public.inventory_balances'::regclass
        )
          AND lock_row.granted = FALSE
    ) AS waiting_lock_count;

COMMIT;
