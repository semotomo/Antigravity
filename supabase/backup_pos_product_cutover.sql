-- 商品writer切替前の退避。対象データと定義を同じ読取り専用snapshotから取得する。
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL statement_timeout = '90s';
WITH table_data AS MATERIALIZED (
  SELECT 'products' AS name, COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) AS rows FROM public.products t
  UNION ALL SELECT 'product_aliases', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.product_aliases t
  UNION ALL SELECT 'products_master', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.products_master t
  UNION ALL SELECT 'stores', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.stores t
  UNION ALL SELECT 'user_store_access', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.user_store_access t
  UNION ALL SELECT 'sync_history', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.sync_history t
  UNION ALL SELECT 'transfers', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.transfers t
  UNION ALL SELECT 'inventory_adjustments', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.inventory_adjustments t
  UNION ALL SELECT 'inventory_balances', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.inventory_balances t
  UNION ALL SELECT 'inventory_calculation_runs', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.inventory_calculation_runs t
  UNION ALL SELECT 'inventory_count_changes', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.inventory_count_changes t
  UNION ALL SELECT 'inventory_product_settings', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.inventory_product_settings t
  UNION ALL SELECT 'inventory_product_status_changes', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.inventory_product_status_changes t
  UNION ALL SELECT 'inventory_session_items', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.inventory_session_items t
  UNION ALL SELECT 'inventory_sessions', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.inventory_sessions t
  UNION ALL SELECT 'pos_inventory_snapshot_rows', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.pos_inventory_snapshot_rows t
  UNION ALL SELECT 'pos_inventory_snapshots', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)), '[]'::jsonb) FROM public.pos_inventory_snapshots t
), relations AS MATERIALIZED (
  SELECT c.oid, n.nspname AS schema_name, c.relname AS name, c.relkind,
    pg_get_userbyid(c.relowner) AS owner, c.relacl::text AS acl,
    c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'private') AND c.relkind IN ('r', 'p', 'S', 'v')
)
SELECT jsonb_build_object(
  'format', 'kennel-pos-cutover-v1', 'exportedAt', transaction_timestamp(),
  'postgresVersion', current_setting('server_version'), 'database', current_database(),
  'tables', (SELECT jsonb_object_agg(name, rows ORDER BY name) FROM table_data),
  'counts', (SELECT jsonb_object_agg(name, jsonb_array_length(rows) ORDER BY name) FROM table_data),
  'relations', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY schema_name, name), '[]'::jsonb) FROM relations r),
  'columns', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', r.schema_name, 'table', r.name, 'name', a.attname, 'position', a.attnum,
    'type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull,
    'identity', a.attidentity, 'generated', a.attgenerated, 'acl', a.attacl::text,
    'default', pg_get_expr(d.adbin, d.adrelid)) ORDER BY r.schema_name, r.name, a.attnum), '[]'::jsonb)
    FROM relations r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum),
  'constraints', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', r.schema_name, 'table', r.name, 'name', c.conname,
    'kind', c.contype, 'keys', c.conkey, 'definition', pg_get_constraintdef(c.oid))
    ORDER BY r.schema_name, r.name, c.conname), '[]'::jsonb)
    FROM relations r JOIN pg_constraint c ON c.conrelid = r.oid),
  'indexes', (SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY schemaname, tablename, indexname), '[]'::jsonb)
    FROM pg_indexes i WHERE schemaname IN ('public', 'private')),
  'policies', (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY schemaname, tablename, policyname), '[]'::jsonb)
    FROM pg_policies p WHERE schemaname IN ('public', 'private')),
  'triggers', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', r.schema_name, 'table', r.name, 'name', t.tgname,
    'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid))
    ORDER BY r.schema_name, r.name, t.tgname), '[]'::jsonb)
    FROM relations r JOIN pg_trigger t ON t.tgrelid = r.oid AND NOT t.tgisinternal),
  'functions', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'name', p.proname, 'arguments', pg_get_function_identity_arguments(p.oid),
    'owner', pg_get_userbyid(p.proowner), 'acl', p.proacl::text, 'definition', pg_get_functiondef(p.oid))
    ORDER BY n.nspname, p.proname, p.oid), '[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f'),
  'schemas', (SELECT jsonb_agg(jsonb_build_object('name', nspname,
    'owner', pg_get_userbyid(nspowner), 'acl', nspacl::text) ORDER BY nspname)
    FROM pg_namespace WHERE nspname IN ('public', 'private')),
  'sequences', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY schemaname, sequencename), '[]'::jsonb)
    FROM pg_sequences s WHERE schemaname IN ('public', 'private')),
  'enums', (SELECT COALESCE(jsonb_agg(jsonb_build_object('schema', n.nspname,
    'type', t.typname, 'label', e.enumlabel, 'order', e.enumsortorder)
    ORDER BY n.nspname, t.typname, e.enumsortorder), '[]'::jsonb)
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname IN ('public', 'private')),
  'migrations', (SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM supabase_migrations.schema_migrations m)
) AS backup;
ROLLBACK;
