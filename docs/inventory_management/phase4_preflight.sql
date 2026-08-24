-- 棚卸し・在庫管理 Phase 4 本番適用前監査
-- 既存データやschemaを変更しない。結果を保存してからmigration対象を再確認する。

BEGIN;
SET TRANSACTION READ ONLY;

SELECT
    to_regclass('public.inventory_product_settings') IS NOT NULL AS has_product_settings,
    to_regclass('public.inventory_sessions') IS NOT NULL AS has_sessions,
    to_regclass('public.inventory_session_items') IS NOT NULL AS has_session_items,
    to_regclass('public.inventory_balances') IS NOT NULL AS has_balances,
    to_regclass('public.inventory_adjustments') IS NOT NULL AS has_adjustments,
    to_regclass('public.inventory_product_status_changes') IS NOT NULL AS phase4_already_applied,
    (
        SELECT COUNT(*)
          FROM public.inventory_sessions
         WHERE status IN ('draft', 'finalizing')
    ) AS active_session_count,
    (
        SELECT COUNT(*)
          FROM public.inventory_sessions
         WHERE status = 'finalized'
    ) AS finalized_session_count,
    (
        SELECT COUNT(*)
          FROM public.inventory_balances
    ) AS balance_count,
    (
        SELECT COUNT(*)
          FROM public.inventory_adjustments
    ) AS adjustment_count,
    (
        SELECT COUNT(*)
          FROM public.products
         WHERE store_id IN (6, 7)
           AND (jan_code IS NULL OR BTRIM(jan_code) = '')
    ) AS missing_jan,
    (
        SELECT COUNT(*)
          FROM public.products AS first_product
          JOIN public.products AS duplicate_product
            ON duplicate_product.store_id = first_product.store_id
           AND duplicate_product.jan_code = first_product.jan_code
           AND duplicate_product.id > first_product.id
         WHERE first_product.store_id IN (6, 7)
    ) AS duplicate_store_jan,
    (
        SELECT COUNT(*)
          FROM pg_locks
         WHERE NOT granted
    ) AS waiting_locks;

SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'inventory_product_settings'
ORDER BY ordinal_position;

SELECT
    namespace_row.nspname AS schema_name,
    routine.proname AS routine_name,
    pg_get_function_identity_arguments(routine.oid) AS arguments
FROM pg_proc AS routine
JOIN pg_namespace AS namespace_row
  ON namespace_row.oid = routine.pronamespace
WHERE namespace_row.nspname IN ('public', 'private')
  AND routine.proname IN (
      'prevent_inventory_history_mutation',
      'can_access_store',
      'finalize_inventory_session',
      'recalculate_inventory_session',
      'set_inventory_product_status',
      'set_inventory_item_exclusion',
      'preview_inventory_finalization',
      'correct_finalized_inventory_count',
      'add_inventory_adjustment',
      'get_inventory_overview',
      'get_inventory_print_data'
  )
ORDER BY namespace_row.nspname, routine.proname;

-- CLIは最後のresult setだけをJSON表示するため、承認判断に必要な要約を最後にも返す。
SELECT jsonb_build_object(
    'phase4AlreadyApplied', to_regclass('public.inventory_product_status_changes') IS NOT NULL,
    'activeSessionCount', (
        SELECT COUNT(*) FROM public.inventory_sessions WHERE status IN ('draft', 'finalizing')
    ),
    'finalizedSessionCount', (
        SELECT COUNT(*) FROM public.inventory_sessions WHERE status = 'finalized'
    ),
    'balanceCount', (SELECT COUNT(*) FROM public.inventory_balances),
    'adjustmentCount', (SELECT COUNT(*) FROM public.inventory_adjustments),
    'productSettingCount', (SELECT COUNT(*) FROM public.inventory_product_settings),
    'missingJan', (
        SELECT COUNT(*) FROM public.products
         WHERE store_id IN (6, 7) AND (jan_code IS NULL OR BTRIM(jan_code) = '')
    ),
    'duplicateStoreJan', (
        SELECT COUNT(*)
          FROM public.products AS first_product
          JOIN public.products AS duplicate_product
            ON duplicate_product.store_id = first_product.store_id
           AND duplicate_product.jan_code = first_product.jan_code
           AND duplicate_product.id > first_product.id
         WHERE first_product.store_id IN (6, 7)
    ),
    'waitingLocks', (SELECT COUNT(*) FROM pg_locks WHERE NOT granted)
) AS phase4_preflight_summary;

ROLLBACK;
