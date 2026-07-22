-- ============================================
-- Add POS group mapping columns to stores table
-- ============================================

ALTER TABLE public.stores
    ADD COLUMN IF NOT EXISTS pos_group_id TEXT,
    ADD COLUMN IF NOT EXISTS pos_group_name TEXT;
