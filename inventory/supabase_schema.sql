-- ============================================
-- 商品移動履歴管理システム — Supabase テーブル定義
-- Supabase SQLエディタで実行してください
-- ============================================

-- 1. 店舗マスタ
CREATE TABLE IF NOT EXISTS stores (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 初期データ（6店舗）
INSERT INTO stores (name) VALUES
    ('本店'),
    ('佐世保'),
    ('マックス'),
    ('伊万里'),
    ('武雄'),
    ('周船寺'),
    ('わんわん')
ON CONFLICT (name) DO NOTHING;

-- 2. 商品マスタ
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    jan_code TEXT NOT NULL UNIQUE,
    product_name TEXT NOT NULL DEFAULT '',
    cost_price INTEGER DEFAULT 0,
    selling_price INTEGER DEFAULT 0,
    category TEXT DEFAULT '',
    markup_rate REAL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- JANコードで高速検索するためのインデックス
CREATE INDEX IF NOT EXISTS idx_products_jan_code ON products (jan_code);

-- 3. 移動履歴
CREATE TABLE IF NOT EXISTS transfers (
    id SERIAL PRIMARY KEY,
    transfer_date TIMESTAMPTZ DEFAULT NOW(),
    from_store_id INTEGER REFERENCES stores(id),
    to_store_id INTEGER REFERENCES stores(id),
    jan_code TEXT NOT NULL,
    product_name TEXT DEFAULT '',
    quantity INTEGER DEFAULT 1,
    cost_price INTEGER DEFAULT 0,
    total_cost INTEGER DEFAULT 0,
    selling_price INTEGER DEFAULT 0,
    memo TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 移動履歴の検索を高速化するインデックス
CREATE INDEX IF NOT EXISTS idx_transfers_date ON transfers (transfer_date);
CREATE INDEX IF NOT EXISTS idx_transfers_from_store ON transfers (from_store_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to_store ON transfers (to_store_id);

-- 4. RLS（Row Level Security）ポリシー — 全アクセス許可（社内ツール用）
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;

-- 匿名キーでの全操作を許可（社内利用のためシンプルに）
CREATE POLICY "Allow all access to stores" ON stores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to products" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to transfers" ON transfers FOR ALL USING (true) WITH CHECK (true);
