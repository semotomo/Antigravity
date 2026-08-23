SELECT
    COUNT(*) AS routine_count,
    COUNT(*) FILTER (WHERE routine.prosecdef) AS security_definer_count,
    COUNT(*) FILTER (
        WHERE routine.proconfig = ARRAY['search_path=""']::TEXT[]
    ) AS empty_search_path_count,
    COUNT(*) FILTER (
        WHERE has_function_privilege(
            'authenticated',
            routine.oid,
            'EXECUTE'
        )
    ) AS authenticated_execute_count,
    COUNT(*) FILTER (
        WHERE NOT has_function_privilege(
            'anon',
            routine.oid,
            'EXECUTE'
        )
    ) AS anon_denied_count,
    (SELECT COUNT(*) FROM public.inventory_sessions) AS session_count,
    (SELECT COUNT(*) FROM public.inventory_session_items) AS item_count,
    (SELECT COUNT(*) FROM public.inventory_count_changes) AS count_change_count
FROM pg_proc AS routine
JOIN pg_namespace AS namespace_row
  ON namespace_row.oid = routine.pronamespace
WHERE namespace_row.nspname = 'public'
  AND routine.proname IN (
      'start_inventory_session',
      'get_inventory_workspace',
      'save_inventory_count'
  );
