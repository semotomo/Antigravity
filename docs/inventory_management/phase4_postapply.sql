-- Phase 4 migration適用直後のschema・権限・データ件数監査。

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
FROM pg_proc AS routine
JOIN pg_namespace AS namespace_row
  ON namespace_row.oid = routine.pronamespace
WHERE namespace_row.nspname = 'public'
  AND routine.proname IN (
      'set_inventory_product_status',
      'set_inventory_item_exclusion',
      'preview_inventory_finalization',
      'correct_finalized_inventory_count',
      'add_inventory_adjustment',
      'get_inventory_overview',
      'get_inventory_print_data'
  );

SELECT
    to_regclass('public.inventory_product_status_changes') IS NOT NULL AS has_status_audit,
    (
        SELECT relrowsecurity AND relforcerowsecurity
          FROM pg_class
         WHERE oid = 'public.inventory_product_status_changes'::REGCLASS
    ) AS status_audit_rls_forced,
    (
        SELECT COUNT(*)
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'inventory_product_settings'
           AND column_name IN (
               'manually_inactive',
               'status_reason',
               'status_changed_at',
               'status_changed_by'
           )
    ) AS product_setting_column_count,
    (
        SELECT COUNT(*)
          FROM pg_trigger
         WHERE NOT tgisinternal
           AND tgname IN (
               'enforce_inventory_manual_inactive',
               'touch_inventory_session_from_item_change',
               'prevent_inventory_product_status_changes_mutation',
               'prevent_inventory_product_status_changes_truncate'
           )
    ) AS phase4_trigger_count,
    (
        SELECT COUNT(*)
          FROM public.inventory_product_status_changes
    ) AS status_change_count,
    (
        SELECT COUNT(*)
          FROM public.inventory_product_settings
         WHERE manually_inactive
    ) AS manually_inactive_count;
