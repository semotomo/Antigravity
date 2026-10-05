-- 本番適用前の読取り専用確認。資格情報・メール・商品名・操作本文は出力しない。
-- 対象: 既存5本と20261005120000 / 20261005121000 / 20261005122000 / 20261005123000。
-- 適用前に差分・退避・本番対象を確認する。このSQL自体は書き込まない。
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

SELECT current_database() AS database_name, current_user AS execution_role,
    current_setting('server_version') AS postgres_version;

SELECT name AS required_relation, to_regclass(name) IS NOT NULL AS exists
FROM unnest(ARRAY['auth.users','public.stores','public.products','public.user_store_access','public.product_aliases']) AS name;

SELECT to_regprocedure('auth.uid()') IS NOT NULL AS auth_uid_exists,
    to_regprocedure('private.can_access_store(integer,text[])') IS NOT NULL AS store_access_helper_exists;

SELECT id AS store_id FROM public.stores WHERE id IN (6,7) ORDER BY id;
SELECT store_id, role, count(*) AS access_count FROM public.user_store_access
    WHERE store_id IN (6,7) GROUP BY store_id,role ORDER BY store_id,role;

SELECT table_name,column_name,data_type FROM information_schema.columns
WHERE table_schema='public' AND (
    (table_name='products' AND column_name IN ('id','store_id','jan_code','product_name','category','product_group',
        'cost_price','selling_price','markup_rate','is_active','tags','brand','supplier_name','updated_at'))
    OR (table_name='user_store_access' AND column_name IN ('user_id','store_id','role'))
    OR (table_name='inventory_product_settings' AND column_name IN ('store_id','product_id','manually_inactive'))
    OR (table_name='product_aliases' AND column_name IN ('alias_name','source_system','store_id','product_id','is_active'))
) ORDER BY table_name,column_name;

-- 既に存在する場合はCREATEを再実行しない。定義と適用履歴を先に比較する。
SELECT name AS new_relation, to_regclass(name) IS NOT NULL AS already_exists
FROM unnest(ARRAY['public.pos_product_operations','public.pos_product_operation_locks',
    'public.pos_product_operation_events','public.product_master_store_versions','public.product_master_sync_runs',
    'public.pos_product_edit_intents','public.pos_product_edit_receipts','public.pos_product_links',
    'public.pos_product_edit_dispatches','public.pos_product_edit_dispatch_receipts',
    'public.pos_product_operation_cancellations','public.product_master_sync_notifications',
    'public.product_master_sync_requests']) AS name;

SELECT n.nspname AS schema_name,p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    p.prosecdef AS security_definer, p.proconfig AS function_settings
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','private') AND p.proname IN (
    'guard_pos_product_operation','audit_pos_product_operation','prevent_pos_product_audit_mutation',
    'assert_pos_product_manager','validate_pos_product_command','lock_pos_product_operation',
    'prepare_pos_product_operation','claim_pos_product_operation','record_pos_product_operation_result',
    'bump_product_master_revision','begin_product_master_sync','apply_product_master_sync',
    'enforce_inventory_manual_inactive','pos_product_edit_values','prepare_pos_product_edit','apply_pos_product_edit',
    'register_pos_product_edit_dispatch','consume_pos_product_edit_dispatch','get_pos_product_edit_dispatch',
    'pos_product_dispatch_json','assert_pos_product_dispatch_unique_json','assert_pos_product_dispatch_object',
    'assert_pos_product_dispatch_string','validate_pos_product_dispatch_business','assert_pos_product_dispatch_target',
    'cancel_pos_product_edit','get_pos_product_edit_recovery_state',
    'record_product_master_sync_notification','get_product_master_sync_notification_gate',
    'begin_product_master_sync_request','get_product_master_sync_request'
) ORDER BY n.nspname,p.proname;

-- 存在する追加オブジェクトのRLS・権限・定義指紋を確認する。操作本文や資格情報は出力しない。
SELECT c.relname AS relation_name,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS force_rls,
    has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
    has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select,
    has_table_privilege('service_role',c.oid,'SELECT') AS service_select,
    has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE') AS service_any_write
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('pos_product_operations','pos_product_operation_locks',
    'pos_product_operation_events','product_master_store_versions','product_master_sync_runs',
    'pos_product_edit_intents','pos_product_edit_receipts','pos_product_links',
    'pos_product_edit_dispatches','pos_product_edit_dispatch_receipts',
    'pos_product_operation_cancellations','product_master_sync_notifications','product_master_sync_requests') ORDER BY c.relname;

SELECT p.proname AS function_name,pg_get_function_identity_arguments(p.oid) AS arguments,
    md5(pg_get_functiondef(p.oid)) AS definition_md5,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('prepare_pos_product_operation','claim_pos_product_operation',
    'record_pos_product_operation_result','begin_product_master_sync','apply_product_master_sync',
    'prepare_pos_product_edit','apply_pos_product_edit','register_pos_product_edit_dispatch',
    'consume_pos_product_edit_dispatch','get_pos_product_edit_dispatch',
    'cancel_pos_product_edit','get_pos_product_edit_recovery_state','record_product_master_sync_notification',
    'get_product_master_sync_notification_gate','begin_product_master_sync_request','get_product_master_sync_request') ORDER BY p.proname;

SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS migration_history_available;

-- UNIQUE(store_id,jan_code) と既存の手動停止保持trigger、旧writerの権限を確認する。
SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
WHERE conrelid=to_regclass('public.products') AND contype IN ('p','u','f') ORDER BY conname;
SELECT tgname,tgenabled,pg_get_triggerdef(oid) AS definition FROM pg_trigger
WHERE tgrelid=to_regclass('public.products') AND NOT tgisinternal ORDER BY tgname;
SELECT grantee,privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='products' ORDER BY grantee,privilege_type;
SELECT grantee,column_name,privilege_type FROM information_schema.role_column_grants
WHERE table_schema='public' AND table_name='products' ORDER BY grantee,column_name,privilege_type;
SELECT policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename='products' ORDER BY policyname;
SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='product_aliases' ORDER BY indexname;

SELECT rolname,rolbypassrls FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') ORDER BY rolname;
ROLLBACK;
