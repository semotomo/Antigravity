-- 本店に残っていた、わんわん由来の停止商品を正しい店舗へ移管する。
-- 対象は停止中かつ商品名に (w) / （ｗ）を含み、わんわん側に同一JANがない行だけに限定する。
UPDATE public.products AS product_row
SET
    store_id = 6,
    tags = 'わんわん'
WHERE product_row.store_id = 7
  AND product_row.is_active = FALSE
  AND product_row.product_name ~* '[\(（][[:space:]]*[wｗ][[:space:]]*[\)）]'
  AND NOT EXISTS (
      SELECT 1
      FROM public.products AS wanwan_product
      WHERE wanwan_product.store_id = 6
        AND wanwan_product.jan_code = product_row.jan_code
  );

-- 店舗ごとに、最後に取得したリアルタイム入出庫履歴を1世代保存する。
CREATE TABLE IF NOT EXISTS public.realtime_history_cache (
    store_id INTEGER PRIMARY KEY REFERENCES public.stores(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    history_rows JSONB NOT NULL DEFAULT '[]'::JSONB,
    item_count INTEGER NOT NULL DEFAULT 0,
    gas_count INTEGER NOT NULL DEFAULT 0,
    transfer_count INTEGER NOT NULL DEFAULT 0,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.realtime_history_cache ENABLE ROW LEVEL SECURITY;

-- サーバーAPIとVercel Cronは既存構成と同じanonクライアントを利用する。
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'realtime_history_cache'
          AND policyname = 'Allow all access to realtime_history_cache'
    ) THEN
        CREATE POLICY "Allow all access to realtime_history_cache"
            ON public.realtime_history_cache
            FOR ALL
            USING (TRUE)
            WITH CHECK (TRUE);
    END IF;
END $$;
