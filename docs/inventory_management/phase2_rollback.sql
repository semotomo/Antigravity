-- 棚卸し・在庫管理 Phase 2 緊急rollback
-- Phase 1のテーブルと監査データは保持し、Phase 2で追加した書込みRPCだけを停止する。
BEGIN;

DROP FUNCTION IF EXISTS public.finalize_inventory_session(UUID, INTEGER, BIGINT, UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.recalculate_inventory_session(UUID, INTEGER, UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.record_inventory_pos_snapshot_failure(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.save_inventory_pos_snapshot(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.get_inventory_recalculation_context(UUID, INTEGER);

COMMIT;
