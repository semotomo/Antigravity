-- 棚卸し・在庫管理 Phase 2 適用後の読み取り監査
BEGIN;
SET TRANSACTION READ ONLY, ISOLATION LEVEL REPEATABLE READ;

WITH expected_routines(routine_oid) AS (
    VALUES
        (to_regprocedure('public.get_inventory_recalculation_context(uuid,integer)')),
        (to_regprocedure('public.save_inventory_pos_snapshot(integer,timestamptz,timestamptz,timestamptz,text,jsonb)')),
        (to_regprocedure('public.record_inventory_pos_snapshot_failure(integer,timestamptz,timestamptz,timestamptz,text,text)')),
        (to_regprocedure('public.recalculate_inventory_session(uuid,integer,uuid,timestamptz)')),
        (to_regprocedure('public.finalize_inventory_session(uuid,integer,bigint,uuid,timestamptz)'))
),
routine_audit AS (
    SELECT
        COUNT(*) AS routine_count,
        COUNT(*) FILTER (WHERE routine.prosecdef) AS security_definer_count,
        COUNT(*) FILTER (
            WHERE routine.proconfig = ARRAY['search_path=""']::TEXT[]
        ) AS empty_search_path_count,
        COUNT(*) FILTER (
            WHERE has_function_privilege('authenticated', routine.oid, 'EXECUTE')
        ) AS authenticated_execute_count,
        COUNT(*) FILTER (
            WHERE NOT has_function_privilege('anon', routine.oid, 'EXECUTE')
        ) AS anon_denied_count
    FROM expected_routines AS expected
    JOIN pg_proc AS routine ON routine.oid = expected.routine_oid
)
SELECT
    routine_audit.routine_count,
    routine_audit.security_definer_count,
    routine_audit.empty_search_path_count,
    routine_audit.authenticated_execute_count,
    routine_audit.anon_denied_count,
    (SELECT COUNT(*) FROM public.pos_inventory_snapshots) AS snapshot_count,
    (SELECT COUNT(*) FROM public.pos_inventory_snapshot_rows) AS snapshot_row_count,
    (SELECT COUNT(*) FROM public.inventory_calculation_runs) AS calculation_run_count,
    (SELECT COUNT(*) FROM public.inventory_balances) AS balance_count
FROM routine_audit;

COMMIT;
