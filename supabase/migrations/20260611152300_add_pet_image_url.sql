-- 移行ファイル: 20260611152300_add_pet_image_url.sql
-- cms_pets テーブルに写真URL用のカラムを追加

ALTER TABLE public.cms_pets
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- インデックスは現時点では不要だが、念のため追加しても良い
-- CREATE INDEX IF NOT EXISTS idx_cms_pets_image_url ON public.cms_pets(image_url);
