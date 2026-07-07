-- 移行ファイル: 20260707141000_add_pet_price_text.sql
-- cms_pets テーブルに生体価格のテキスト表現用のカラムを追加

ALTER TABLE public.cms_pets
ADD COLUMN IF NOT EXISTS price_text TEXT;
