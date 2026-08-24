-- 棚卸し・在庫管理 Phase 4 緊急機能rollback
-- 監査・手動停止・棚卸しデータは削除しない。利用開始後はDROPで戻さずforward migrationで修復する。

BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.inventory_product_status_changes LIMIT 1)
       OR EXISTS (
           SELECT 1
             FROM public.inventory_product_settings
            WHERE manually_inactive
       ) THEN
        RAISE EXCEPTION
            'Phase 4 rollback blocked: manual product status data exists; use a forward migration'
            USING ERRCODE = '55000';
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.get_inventory_print_data(INTEGER, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_inventory_overview(INTEGER, TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.add_inventory_adjustment(UUID, INTEGER, TEXT, NUMERIC, TEXT, UUID);
DROP FUNCTION IF EXISTS public.correct_finalized_inventory_count(UUID, INTEGER, TEXT, NUMERIC, TEXT, BIGINT);
DROP FUNCTION IF EXISTS public.preview_inventory_finalization(UUID, INTEGER, UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.set_inventory_item_exclusion(UUID, INTEGER, TEXT, BOOLEAN, TEXT, BIGINT);
DROP FUNCTION IF EXISTS public.set_inventory_product_status(INTEGER, TEXT, BOOLEAN, TEXT);

DROP TRIGGER IF EXISTS touch_inventory_session_from_item_change
    ON public.inventory_session_items;
DROP FUNCTION IF EXISTS private.touch_inventory_session_from_item_change();

DROP TRIGGER IF EXISTS enforce_inventory_manual_inactive ON public.products;
DROP FUNCTION IF EXISTS private.enforce_inventory_manual_inactive();

-- audit tableと追加columnはデータ保護のため残す。
COMMIT;
