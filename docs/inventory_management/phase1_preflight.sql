-- 棚卸し・在庫管理 Phase 1 本番適用前監査
-- 読み取り専用。Supabase SQL Editorで実行してもDBを書き換えない。

BEGIN;
SET TRANSACTION READ ONLY;

-- 1. 実行先とPostgres情報
SELECT
    current_database() AS database_name,
    current_user AS database_user,
    clock_timestamp() AS checked_at,
    current_setting('server_version') AS postgres_version;

-- 2. remote migration履歴。Phase 1より前の13件が存在し、20260823163000は未適用であること。
SELECT
    version,
    name
FROM supabase_migrations.schema_migrations
ORDER BY version;

-- 3. Phase 1オブジェクトの衝突確認。すべてNULLであること。
SELECT
    to_regclass('public.user_store_access') AS user_store_access,
    to_regclass('public.inventory_sessions') AS inventory_sessions,
    to_regclass('public.inventory_session_items') AS inventory_session_items,
    to_regclass('public.inventory_count_changes') AS inventory_count_changes,
    to_regclass('public.inventory_adjustments') AS inventory_adjustments,
    to_regclass('public.inventory_product_settings') AS inventory_product_settings,
    to_regclass('public.pos_inventory_snapshots') AS pos_inventory_snapshots,
    to_regclass('public.pos_inventory_snapshot_rows') AS pos_inventory_snapshot_rows,
    to_regclass('public.inventory_calculation_runs') AS inventory_calculation_runs,
    to_regclass('public.inventory_balances') AS inventory_balances;

-- 4. products前提条件。JAN欠損、不正store、重複はすべて0であること。
SELECT
    COUNT(*) AS product_count,
    COUNT(*) FILTER (
        WHERE jan_code IS NULL OR BTRIM(jan_code) = ''
    ) AS missing_jan_count,
    COUNT(*) FILTER (
        WHERE store_id IS NULL OR store_id NOT IN (6, 7)
    ) AS invalid_store_count
FROM public.products;

SELECT
    store_id,
    jan_code,
    COUNT(*) AS duplicate_count
FROM public.products
GROUP BY store_id, jan_code
HAVING COUNT(*) > 1
ORDER BY store_id, jan_code;

-- 5. productsの現行制約。Phase 1所有マーカー付き制約はまだ存在しないこと。
SELECT
    constraint_row.conname,
    constraint_row.contype,
    pg_get_constraintdef(constraint_row.oid) AS definition,
    obj_description(constraint_row.oid, 'pg_constraint') AS description
FROM pg_constraint AS constraint_row
WHERE constraint_row.conrelid = 'public.products'::regclass
ORDER BY constraint_row.conname;

-- 6. private schemaの既存オブジェクト。Phase 1以外の用途をrollbackで削除しないため記録する。
SELECT
    namespace_row.nspname AS schema_name,
    class_row.relname AS object_name,
    class_row.relkind AS object_kind
FROM pg_namespace AS namespace_row
LEFT JOIN pg_class AS class_row
    ON class_row.relnamespace = namespace_row.oid
WHERE namespace_row.nspname = 'private'
ORDER BY class_row.relkind, class_row.relname;

SELECT
    namespace_row.nspname AS schema_name,
    procedure_row.proname AS function_name,
    pg_get_function_identity_arguments(procedure_row.oid) AS identity_arguments
FROM pg_proc AS procedure_row
INNER JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = procedure_row.pronamespace
WHERE namespace_row.nspname = 'private'
ORDER BY procedure_row.proname, identity_arguments;

-- 7. productsへ現在かかっているlock。未許可の長時間処理がないこと。
SELECT
    lock_row.pid,
    lock_row.mode,
    lock_row.granted
FROM pg_locks AS lock_row
WHERE lock_row.relation = 'public.products'::regclass
ORDER BY lock_row.granted DESC, lock_row.mode, lock_row.pid;

-- 8. 初期店舗権限候補。
-- emailは画面確認用にマスクし、store_typeは認可ではなく移行候補のヒントとしてだけ使う。
SELECT
    user_row.id,
    REGEXP_REPLACE(
        COALESCE(user_row.email, ''),
        '(^.).*(@.*$)',
        '\1***\2'
    ) AS masked_email,
    user_row.raw_user_meta_data ->> 'store_type' AS legacy_store_hint,
    user_row.created_at,
    user_row.last_sign_in_at
FROM auth.users AS user_row
ORDER BY user_row.created_at, user_row.id;

-- 9. CLI/Management API向けの単一サマリー。
-- 複数SELECTの最後だけが返る実行経路でも、適用可否を1行で判定できるようにする。
WITH
expected_objects(object_name) AS (
    VALUES
        ('public.user_store_access'),
        ('public.inventory_sessions'),
        ('public.inventory_session_items'),
        ('public.inventory_count_changes'),
        ('public.inventory_adjustments'),
        ('public.inventory_product_settings'),
        ('public.pos_inventory_snapshots'),
        ('public.pos_inventory_snapshot_rows'),
        ('public.inventory_calculation_runs'),
        ('public.inventory_balances')
),
object_check AS (
    SELECT COUNT(*) FILTER (
        WHERE to_regclass(expected_objects.object_name) IS NOT NULL
    ) AS collision_count
    FROM expected_objects
),
product_check AS (
    SELECT
        COUNT(*) AS product_count,
        COUNT(*) FILTER (
            WHERE products.jan_code IS NULL OR BTRIM(products.jan_code) = ''
        ) AS missing_jan_count,
        COUNT(*) FILTER (
            WHERE products.store_id IS NULL OR products.store_id NOT IN (6, 7)
        ) AS invalid_store_count
    FROM public.products
),
duplicate_check AS (
    SELECT COUNT(*) AS duplicate_group_count
    FROM (
        SELECT products.store_id, products.jan_code
        FROM public.products
        GROUP BY products.store_id, products.jan_code
        HAVING COUNT(*) > 1
    ) AS duplicate_group
),
constraint_check AS (
    SELECT COUNT(*) AS owned_constraint_count
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conname = 'products_id_store_id_jan_code_key'
      AND constraint_row.conrelid = 'public.products'::regclass
),
lock_check AS (
    SELECT COUNT(*) AS other_product_lock_count
    FROM pg_locks AS lock_row
    WHERE lock_row.relation = 'public.products'::regclass
      AND lock_row.pid <> pg_backend_pid()
),
migration_check AS (
    SELECT
        COUNT(*) AS migration_count,
        COUNT(*) FILTER (
            WHERE schema_migrations.version = '20260823163000'
        ) AS phase1_migration_count
    FROM supabase_migrations.schema_migrations
),
auth_check AS (
    -- 個別UUID・メールの厳密照合はGit管理外seed内で行う。
    SELECT COUNT(*) AS auth_user_count
    FROM auth.users
)
SELECT
    CASE
        WHEN object_check.collision_count = 0
         AND product_check.missing_jan_count = 0
         AND product_check.invalid_store_count = 0
         AND duplicate_check.duplicate_group_count = 0
         AND constraint_check.owned_constraint_count = 0
         AND lock_check.other_product_lock_count = 0
         AND migration_check.phase1_migration_count = 0
         AND auth_check.auth_user_count >= 3
        THEN 'PASS'
        ELSE 'BLOCK'
    END AS preflight_status,
    migration_check.migration_count,
    migration_check.phase1_migration_count,
    object_check.collision_count,
    product_check.product_count,
    product_check.missing_jan_count,
    product_check.invalid_store_count,
    duplicate_check.duplicate_group_count,
    constraint_check.owned_constraint_count,
    lock_check.other_product_lock_count,
    auth_check.auth_user_count
FROM object_check
CROSS JOIN product_check
CROSS JOIN duplicate_check
CROSS JOIN constraint_check
CROSS JOIN lock_check
CROSS JOIN migration_check
CROSS JOIN auth_check;

COMMIT;
