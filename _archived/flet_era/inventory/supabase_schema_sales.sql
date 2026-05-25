-- ============================================
-- 売上データ管理用 — Supabase テーブル定義
-- Supabase SQLエディタで実行してください
-- ============================================

-- 1. POS売上データ (sales_data)
CREATE TABLE IF NOT EXISTS sales_data (
    id SERIAL PRIMARY KEY,
    transaction_date TIMESTAMPTZ NOT NULL, -- 売上・処理日時
    store_name TEXT NOT NULL,              -- 店舗名（将来の複数店舗対応のため必須）
    jan_code TEXT,                         -- JANコード (無い場合はNULL)
    product_name TEXT NOT NULL,            -- 商品名・サービス名
    category TEXT,                         -- ジャンル・大分類
    quantity INTEGER DEFAULT 1,            -- 数量（売上数）
    unit_price INTEGER DEFAULT 0,          -- 単価
    total_amount INTEGER DEFAULT 0,        -- 売上金額（数量×単価等）
    transaction_id TEXT,                   -- レシート番号や取引番号（重複チェックなどに利用）
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- 必要に応じて追加の項目
    customer_age_group TEXT,               -- （もしあれば）客層
    customer_gender TEXT                   -- （もしあれば）性別
);

-- 日付検索や店舗検索を高速化するインデックス
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales_data (transaction_date);
CREATE INDEX IF NOT EXISTS idx_sales_store ON sales_data (store_name);
CREATE INDEX IF NOT EXISTS idx_sales_jan ON sales_data (jan_code);
CREATE INDEX IF NOT EXISTS idx_sales_category ON sales_data (category);

-- 2. RLS（Row Level Security）ポリシー — 全アクセス許可（社内ツール用）
ALTER TABLE sales_data ENABLE ROW LEVEL SECURITY;

-- 匿名キーでの全操作を許可（社内での自動化バッチと分析ツール利用のためシンプルに）
CREATE POLICY "Allow all access to sales_data" ON sales_data FOR ALL USING (true) WITH CHECK (true);
