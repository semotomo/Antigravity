-- ===================================================
-- Set default '本店' tag for all existing products
-- ===================================================

UPDATE public.products
SET tags = '本店'
WHERE tags IS NULL OR tags = '';
