-- 移行ファイル: 20260330161800_phase2_cms_pets.sql
-- 既存ダッシュボードのペット生体販売データを保持するテーブルを作成

CREATE TABLE IF NOT EXISTS public.cms_pets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    management_no VARCHAR(50) UNIQUE NOT NULL, -- お問い合わせ番号 (例: 126073)
    species VARCHAR(50) NOT NULL,              -- 犬 or 猫
    breed VARCHAR(255),                        -- 毛種 (例: MIX（マルチーズ×ビションフリーゼ）)
    birth_date DATE,                           -- 生年月日
    birth_place VARCHAR(255),                  -- 出身地
    gender VARCHAR(50),                        -- 性別 (例: 女の子)
    price_tax_excluded INTEGER,                -- 税抜価格
    price_tax_included INTEGER,                -- 税込価格
    coat_color VARCHAR(255),                   -- 毛色
    vaccines VARCHAR(255),                     -- ワクチン接種状態
    publish_status VARCHAR(50),                -- 公開ステータス (例: 公開)
    store_id INTEGER REFERENCES public.stores(id), -- 店舗ID (マッピング後)
    cms_category_ids VARCHAR(255),             -- CMS側カテゴリID (パース前の一時保管)
    cms_entry_id INTEGER NOT NULL UNIQUE,      -- CMSの内部記事ID
    cms_updated_at TIMESTAMP WITH TIME ZONE,   -- CMSでの更新・作成日時
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- タイムゾーン対応やデフォルト設定など
ALTER TABLE public.cms_pets ENABLE ROW LEVEL SECURITY;

-- ひとまずフルアクサスポリシーを設定 (Supabase運用ポリシーに合わせて適宜絞り込み推奨)
CREATE POLICY "Allow all access to cms_pets" ON public.cms_pets
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- インデックス作成 (検索によく使われそうなもの)
CREATE INDEX IF NOT EXISTS idx_cms_pets_management_no ON public.cms_pets(management_no);
CREATE INDEX IF NOT EXISTS idx_cms_pets_species ON public.cms_pets(species);
CREATE INDEX IF NOT EXISTS idx_cms_pets_publish_status ON public.cms_pets(publish_status);
