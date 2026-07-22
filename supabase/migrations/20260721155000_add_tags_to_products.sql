-- ============================================
-- Add tags column to products table to distinguish between stores
-- ============================================

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS tags TEXT;

-- Index for searching tags efficiently
CREATE INDEX IF NOT EXISTS idx_products_tags ON public.products (tags);
