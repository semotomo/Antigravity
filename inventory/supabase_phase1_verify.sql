-- ============================================
-- Budibase / Supabase 移行 Phase 1 Verification SQL
-- 用途:
-- - additive SQL 適用前後の確認
-- - 列 / view / FK / サンプル結果の確認
-- ============================================

-- 1. 対象テーブル / view の列確認
SELECT
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'products',
    'product_aliases',
    'customer_orders',
    'product_sales_data'
  )
ORDER BY table_name, ordinal_position;

-- 2. customer_orders の追加列確認
SELECT
    order_no,
    store_id,
    product_id,
    jan_code,
    quantity,
    unit_price,
    order_date,
    expected_arrival_date,
    pickup_due_date
FROM public.customer_orders
LIMIT 5;

-- 3. product_aliases の RLS / policy 確認
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'product_aliases';

-- 4. 売上 view 存在確認
SELECT
    schemaname,
    viewname
FROM pg_views
WHERE schemaname = 'public'
  AND viewname IN (
    'sales_enriched_v',
    'sales_daily_summary_v',
    'sales_product_summary_v'
  )
ORDER BY viewname;

-- 5. 売上 view サンプル確認
SELECT *
FROM public.sales_enriched_v
LIMIT 5;

SELECT *
FROM public.sales_daily_summary_v
LIMIT 5;

SELECT *
FROM public.sales_product_summary_v
LIMIT 5;

-- 6. 未紐付け商品の件数確認
SELECT
    COUNT(*) AS unmatched_count
FROM public.sales_enriched_v
WHERE unmatched_master = TRUE;

-- 7. alias 登録前提の確認
SELECT
    product_name,
    COUNT(*) AS sale_rows
FROM public.sales_enriched_v
WHERE unmatched_master = TRUE
GROUP BY product_name
ORDER BY sale_rows DESC, product_name
LIMIT 30;

-- 8. customer_orders の FK 候補異常確認
SELECT
    COUNT(*) AS invalid_store_refs
FROM public.customer_orders co
LEFT JOIN public.stores s
    ON s.id = co.store_id
WHERE co.store_id IS NOT NULL
  AND s.id IS NULL;

SELECT
    COUNT(*) AS invalid_product_refs
FROM public.customer_orders co
LEFT JOIN public.products p
    ON p.id = co.product_id
WHERE co.product_id IS NOT NULL
  AND p.id IS NULL;

-- 9. 今後の order_no 付与時に重複が起きないかの確認
SELECT
    order_no,
    COUNT(*) AS duplicate_count
FROM public.customer_orders
WHERE order_no IS NOT NULL
GROUP BY order_no
HAVING COUNT(*) > 1;
