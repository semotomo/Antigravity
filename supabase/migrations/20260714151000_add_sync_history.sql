-- ============================================
-- 同期履歴管理テーブルの新規作成
-- ============================================

CREATE TABLE IF NOT EXISTS public.sync_history (
    sync_type TEXT PRIMARY KEY,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 初期レコードの設定
INSERT INTO public.sync_history (sync_type, last_synced_at)
VALUES 
    ('sales_import', NOW()),
    ('products_sync', NOW())
ON CONFLICT (sync_type) DO NOTHING;

-- 行レベルセキュリティ (RLS) を有効化
ALTER TABLE public.sync_history ENABLE ROW LEVEL SECURITY;

-- 開発および外部連携APIからのすべての操作を許可するポリシー
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'sync_history'
          AND policyname = 'Allow all access to sync_history'
    ) THEN
        CREATE POLICY "Allow all access to sync_history"
            ON public.sync_history
            FOR ALL
            USING (TRUE)
            WITH CHECK (TRUE);
    END IF;
END $$;
