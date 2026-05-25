-- ============================================
-- 商品別・マスタ管理用 — Supabase テーブル定義
-- Supabase SQLエディタで実行してください
-- ============================================

-- ============================================
-- 1. 商品別 詳細売上データ (product_sales_data)
-- 日次で商品ごとの売上高と販売数を保持します
-- ============================================
CREATE TABLE IF NOT EXISTS product_sales_data (
    id SERIAL PRIMARY KEY,
    transaction_date DATE NOT NULL,        -- 売上年月日（日単位の集計）
    store_name TEXT NOT NULL,              -- 店舗名（本店、わんわん 等）
    product_name TEXT NOT NULL,            -- 商品名（ユニークキーとして利用）
    quantity INTEGER DEFAULT 0,            -- 日次の販売数量
    total_amount INTEGER DEFAULT 0,        -- 日次の売上金額（税抜想定）
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 日付検索や商品検索を高速化するインデックス
CREATE INDEX IF NOT EXISTS idx_psales_date ON product_sales_data (transaction_date);
CREATE INDEX IF NOT EXISTS idx_psales_store ON product_sales_data (store_name);
CREATE INDEX IF NOT EXISTS idx_psales_product ON product_sales_data (product_name);

-- 同じ店舗・同じ日付・同じ商品のレコードが重複しないようユニーク制約を設定
-- （※GAS側から複数回データが送信された場合のUPSERT処理に利用）
ALTER TABLE product_sales_data ADD CONSTRAINT unique_daily_product_sales UNIQUE (transaction_date, store_name, product_name);


-- ============================================
-- 2. 商品マスタ (products_master)
-- CSVから取得したJANコードや原価などの情報を保持します
-- ============================================
CREATE TABLE IF NOT EXISTS products_master (
    id SERIAL PRIMARY KEY,
    product_name TEXT NOT NULL UNIQUE,     -- 商品名（product_sales_dataと紐付けるキー）
    jan_code TEXT,                         -- JANコード
    category TEXT,                         -- カテゴリ・部門
    unit_price INTEGER DEFAULT 0,          -- 単価（定価）
    cost_price INTEGER DEFAULT 0,          -- 原価
    supplier_name TEXT,                    -- 仕入先・メーカー
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 検索用インデックス
CREATE INDEX IF NOT EXISTS idx_pmaster_jan ON products_master (jan_code);
CREATE INDEX IF NOT EXISTS idx_pmaster_category ON products_master (category);

-- ============================================
-- 3. RLS（Row Level Security）ポリシー — 全アクセス許可
-- ============================================
ALTER TABLE product_sales_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE products_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to product_sales_data" ON product_sales_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to products_master" ON products_master FOR ALL USING (true) WITH CHECK (true);
