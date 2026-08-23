-- 棚卸し・在庫管理 Phase 1 緊急rollback
-- Phase 2の書込み開始前、かつ全Phase 1テーブルが空の場合だけ実行できる。
-- 本番実行には、backup・対象件数・SQL全文の再確認と別承認が必要。

BEGIN;

-- 棚卸し・権限データが1行でも存在すれば、破壊的rollbackを拒否する。
DO $$
DECLARE
    target_table TEXT;
    has_rows BOOLEAN;
BEGIN
    FOREACH target_table IN ARRAY ARRAY[
        'user_store_access',
        'inventory_sessions',
        'inventory_session_items',
        'inventory_count_changes',
        'inventory_adjustments',
        'inventory_product_settings',
        'pos_inventory_snapshots',
        'pos_inventory_snapshot_rows',
        'inventory_calculation_runs',
        'inventory_balances'
    ]
    LOOP
        IF to_regclass(format('public.%I', target_table)) IS NOT NULL THEN
            EXECUTE format(
                'SELECT EXISTS (SELECT 1 FROM public.%I LIMIT 1)',
                target_table
            )
            INTO has_rows;

            IF has_rows THEN
                RAISE EXCEPTION
                    'Phase 1 rollback blocked: public.% contains data',
                    target_table
                    USING ERRCODE = '55000';
            END IF;
        END IF;
    END LOOP;
END $$;

DROP TABLE IF EXISTS public.inventory_balances;
DROP TABLE IF EXISTS public.inventory_calculation_runs;
DROP TABLE IF EXISTS public.pos_inventory_snapshot_rows;
DROP TABLE IF EXISTS public.pos_inventory_snapshots;
DROP TABLE IF EXISTS public.inventory_adjustments;
DROP TABLE IF EXISTS public.inventory_count_changes;
DROP TABLE IF EXISTS public.inventory_product_settings;
DROP TABLE IF EXISTS public.inventory_session_items;
DROP TABLE IF EXISTS public.inventory_sessions;
DROP TABLE IF EXISTS public.user_store_access;

DROP FUNCTION IF EXISTS private.prevent_inventory_history_mutation();
DROP FUNCTION IF EXISTS private.bump_inventory_row_version();
DROP FUNCTION IF EXISTS private.can_access_store(INTEGER, TEXT[]);

-- Phase 1が所有マーカーを付けた制約だけを削除する。
DO $$
DECLARE
    constraint_id OID;
BEGIN
    SELECT constraint_row.oid
    INTO constraint_id
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.products'::regclass
      AND constraint_row.conname = 'products_id_store_id_jan_code_key'
      AND obj_description(constraint_row.oid, 'pg_constraint')
          = 'inventory_management_phase1';

    IF constraint_id IS NOT NULL THEN
        ALTER TABLE public.products
            DROP CONSTRAINT products_id_store_id_jan_code_key;
    END IF;
END $$;

-- private schema自体は既存用途を壊さないため削除しない。
COMMIT;
