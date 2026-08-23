BEGIN;
SET TRANSACTION READ ONLY;

SELECT
    to_regclass('public.inventory_sessions') IS NOT NULL AS has_sessions,
    to_regclass('public.inventory_session_items') IS NOT NULL AS has_items,
    to_regclass('public.inventory_count_changes') IS NOT NULL AS has_count_changes,
    to_regclass('public.products') IS NOT NULL AS has_products,
    (
        SELECT COUNT(*)
        FROM public.products
        WHERE store_id = 7
    ) AS main_products,
    (
        SELECT COUNT(*)
        FROM public.products
        WHERE store_id = 6
    ) AS wanwan_products,
    (
        SELECT COUNT(*)
        FROM public.products
        WHERE store_id IN (6, 7)
          AND (jan_code IS NULL OR BTRIM(jan_code) = '')
    ) AS missing_jan,
    (
        SELECT COUNT(*)
        FROM public.products
        WHERE store_id IN (6, 7)
          AND (product_name IS NULL OR BTRIM(product_name) = '')
    ) AS missing_name,
    (
        SELECT COUNT(*)
        FROM public.inventory_sessions
        WHERE status IN ('draft', 'finalizing')
    ) AS active_session_count,
    (
        SELECT COUNT(*)
        FROM pg_proc AS routine
        JOIN pg_namespace AS namespace_row
          ON namespace_row.oid = routine.pronamespace
        WHERE namespace_row.nspname = 'public'
          AND routine.proname IN (
              'start_inventory_session',
              'get_inventory_workspace',
              'save_inventory_count'
          )
    ) AS existing_phase3_routines,
    (
        SELECT COUNT(*)
        FROM pg_locks
        WHERE NOT granted
    ) AS waiting_locks;

ROLLBACK;
