-- 棚卸し・在庫管理 Phase 1 本番適用後監査
-- 読み取り専用。migration直後と初期権限seed後の両方で実行できる。

BEGIN;
SET TRANSACTION READ ONLY;

WITH
expected_tables(table_name) AS (
    VALUES
        ('user_store_access'),
        ('inventory_sessions'),
        ('inventory_session_items'),
        ('inventory_count_changes'),
        ('inventory_adjustments'),
        ('inventory_product_settings'),
        ('pos_inventory_snapshots'),
        ('pos_inventory_snapshot_rows'),
        ('inventory_calculation_runs'),
        ('inventory_balances')
),
table_check AS (
    SELECT
        COUNT(*) FILTER (WHERE class_row.oid IS NOT NULL) AS table_count,
        COUNT(*) FILTER (WHERE class_row.relrowsecurity) AS rls_table_count,
        COUNT(*) FILTER (WHERE class_row.relforcerowsecurity) AS force_rls_table_count
    FROM expected_tables
    LEFT JOIN pg_namespace AS namespace_row
        ON namespace_row.nspname = 'public'
    LEFT JOIN pg_class AS class_row
        ON class_row.relnamespace = namespace_row.oid
       AND class_row.relname = expected_tables.table_name
       AND class_row.relkind = 'r'
),
constraint_check AS (
    SELECT
        COUNT(*) AS constraint_count,
        COUNT(*) FILTER (
            WHERE obj_description(constraint_row.oid, 'pg_constraint') = 'inventory_management_phase1'
        ) AS owned_constraint_count
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conname = 'products_id_store_id_jan_code_key'
      AND constraint_row.conrelid = 'public.products'::regclass
),
function_check AS (
    SELECT COUNT(*) AS helper_function_count
    FROM pg_proc AS procedure_row
    INNER JOIN pg_namespace AS namespace_row
        ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'private'
      AND procedure_row.proname = 'can_access_store'
      AND pg_get_function_identity_arguments(procedure_row.oid) = 'p_store_id integer, p_roles text[]'
),
migration_check AS (
    SELECT COUNT(*) AS migration_count
    FROM supabase_migrations.schema_migrations
    WHERE schema_migrations.version = '20260823163000'
),
data_check AS (
    SELECT
        (SELECT COUNT(*) FROM public.user_store_access) AS access_row_count,
        (
            (SELECT COUNT(*) FROM public.inventory_sessions)
            + (SELECT COUNT(*) FROM public.inventory_session_items)
            + (SELECT COUNT(*) FROM public.inventory_count_changes)
            + (SELECT COUNT(*) FROM public.inventory_adjustments)
            + (SELECT COUNT(*) FROM public.inventory_product_settings)
            + (SELECT COUNT(*) FROM public.pos_inventory_snapshots)
            + (SELECT COUNT(*) FROM public.pos_inventory_snapshot_rows)
            + (SELECT COUNT(*) FROM public.inventory_calculation_runs)
            + (SELECT COUNT(*) FROM public.inventory_balances)
        ) AS inventory_data_row_count
)
SELECT
    CASE
        WHEN table_check.table_count = 10
         AND table_check.rls_table_count = 10
         AND table_check.force_rls_table_count = 10
         AND constraint_check.constraint_count = 1
         AND constraint_check.owned_constraint_count = 1
         AND function_check.helper_function_count = 1
         AND migration_check.migration_count = 1
        THEN 'PASS'
        ELSE 'BLOCK'
    END AS postapply_status,
    migration_check.migration_count,
    table_check.table_count,
    table_check.rls_table_count,
    table_check.force_rls_table_count,
    constraint_check.constraint_count,
    constraint_check.owned_constraint_count,
    function_check.helper_function_count,
    data_check.access_row_count,
    data_check.inventory_data_row_count
FROM table_check
CROSS JOIN constraint_check
CROSS JOIN function_check
CROSS JOIN migration_check
CROSS JOIN data_check;

COMMIT;
