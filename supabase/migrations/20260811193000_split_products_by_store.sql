-- 商品マスタを店舗ごとの独立レコードへ移行する。
-- 既存の共有行は直前に本店を同期した状態なので本店(ID: 7)として保持し、
-- わんわん(ID: 6)用の行を複製した後に店舗別同期で正しい値へ更新する。

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS store_id INTEGER;

UPDATE public.products
SET store_id = CASE
    WHEN tags ILIKE '%わんわん%'
         AND COALESCE(tags, '') NOT ILIKE '%本店%' THEN 6
    ELSE 7
END
WHERE store_id IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_store_id_fkey'
          AND conrelid = 'public.products'::regclass
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT products_store_id_fkey
            FOREIGN KEY (store_id)
            REFERENCES public.stores(id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_id_store_id_key'
          AND conrelid = 'public.products'::regclass
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT products_id_store_id_key
            UNIQUE (id, store_id);
    END IF;
END $$;

ALTER TABLE public.products
    ALTER COLUMN store_id SET NOT NULL;

-- JAN単独のUNIQUE制約を外し、店舗+JANの複合UNIQUE制約へ変更する。
DO $$
DECLARE
    jan_constraint_name TEXT;
BEGIN
    SELECT constraint_row.conname
    INTO jan_constraint_name
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.products'::regclass
      AND constraint_row.contype = 'u'
      AND constraint_row.conkey = ARRAY[(
          SELECT attribute_row.attnum
          FROM pg_attribute AS attribute_row
          WHERE attribute_row.attrelid = 'public.products'::regclass
            AND attribute_row.attname = 'jan_code'
      )]::SMALLINT[]
    LIMIT 1;

    IF jan_constraint_name IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE public.products DROP CONSTRAINT %I',
            jan_constraint_name
        );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_store_id_jan_code_key'
          AND conrelid = 'public.products'::regclass
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT products_store_id_jan_code_key
            UNIQUE (store_id, jan_code);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_store_id_name
    ON public.products (store_id, product_name);

CREATE INDEX IF NOT EXISTS idx_products_store_id_active
    ON public.products (store_id, is_active);

-- 両店舗タグを持っていた商品は、わんわん用の独立行を作る。
INSERT INTO public.products (
    jan_code,
    product_name,
    cost_price,
    selling_price,
    category,
    markup_rate,
    updated_at,
    product_group,
    brand,
    is_active,
    supplier_name,
    tags,
    store_id
)
SELECT
    product_row.jan_code,
    product_row.product_name,
    product_row.cost_price,
    product_row.selling_price,
    product_row.category,
    product_row.markup_rate,
    product_row.updated_at,
    product_row.product_group,
    product_row.brand,
    product_row.is_active,
    product_row.supplier_name,
    'わんわん',
    6
FROM public.products AS product_row
WHERE product_row.store_id = 7
  AND product_row.tags ILIKE '%本店%'
  AND product_row.tags ILIKE '%わんわん%'
ON CONFLICT (store_id, jan_code) DO NOTHING;

UPDATE public.products
SET tags = CASE store_id
    WHEN 6 THEN 'わんわん'
    WHEN 7 THEN '本店'
    ELSE tags
END;

-- POS別名も同じ店舗の商品だけを指すように店舗キーを持たせる。
ALTER TABLE public.product_aliases
    ADD COLUMN IF NOT EXISTS store_id INTEGER;

UPDATE public.product_aliases AS alias_row
SET store_id = product_row.store_id
FROM public.products AS product_row
WHERE alias_row.product_id = product_row.id
  AND alias_row.store_id IS NULL;

ALTER TABLE public.product_aliases
    ALTER COLUMN store_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'product_aliases_store_id_fkey'
          AND conrelid = 'public.product_aliases'::regclass
    ) THEN
        ALTER TABLE public.product_aliases
            ADD CONSTRAINT product_aliases_store_id_fkey
            FOREIGN KEY (store_id)
            REFERENCES public.stores(id);
    END IF;
END $$;

DROP INDEX IF EXISTS public.idx_product_aliases_alias_source_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_aliases_alias_source_store_unique
    ON public.product_aliases (alias_name, source_system, store_id);

CREATE INDEX IF NOT EXISTS idx_product_aliases_store_id
    ON public.product_aliases (store_id);

-- 旧別名が両店舗共通商品を指していた場合は、わんわん側にも同じ別名を複製する。
INSERT INTO public.product_aliases (
    alias_name,
    product_id,
    store_id,
    source_system,
    is_active,
    created_at,
    updated_at
)
SELECT
    alias_row.alias_name,
    wanwan_product.id,
    6,
    alias_row.source_system,
    alias_row.is_active,
    alias_row.created_at,
    alias_row.updated_at
FROM public.product_aliases AS alias_row
INNER JOIN public.products AS main_product
    ON main_product.id = alias_row.product_id
   AND main_product.store_id = 7
INNER JOIN public.products AS wanwan_product
    ON wanwan_product.store_id = 6
   AND wanwan_product.jan_code = main_product.jan_code
WHERE alias_row.store_id = 7
ON CONFLICT (alias_name, source_system, store_id) DO NOTHING;

ALTER TABLE public.product_aliases
    DROP CONSTRAINT IF EXISTS product_aliases_product_id_fkey;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'product_aliases_product_store_fkey'
          AND conrelid = 'public.product_aliases'::regclass
    ) THEN
        ALTER TABLE public.product_aliases
            ADD CONSTRAINT product_aliases_product_store_fkey
            FOREIGN KEY (product_id, store_id)
            REFERENCES public.products(id, store_id);
    END IF;
END $$;

-- 既存客注が共有商品を指していた場合は、受付店舗側へ付け替える。
UPDATE public.customer_orders AS order_row
SET product_id = target_product.id
FROM public.products AS current_product
INNER JOIN public.products AS target_product
    ON target_product.jan_code = current_product.jan_code
WHERE order_row.product_id = current_product.id
  AND order_row.store_id IS NOT NULL
  AND current_product.store_id <> order_row.store_id
  AND target_product.store_id = order_row.store_id;

ALTER TABLE public.customer_orders
    DROP CONSTRAINT IF EXISTS customer_orders_product_id_fkey;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'customer_orders_product_store_fkey'
          AND conrelid = 'public.customer_orders'::regclass
    ) THEN
        ALTER TABLE public.customer_orders
            ADD CONSTRAINT customer_orders_product_store_fkey
            FOREIGN KEY (product_id, store_id)
            REFERENCES public.products(id, store_id);
    END IF;
END $$;

-- 売上の店舗と同じ店舗の商品・別名だけを紐付ける。
CREATE OR REPLACE VIEW public.sales_enriched_v AS
WITH source_rows AS (
    SELECT
        sales_row.id AS sales_row_id,
        sales_row.transaction_date,
        sales_row.transaction_date AS sale_date,
        sales_row.store_name,
        sales_row.product_name,
        COALESCE(sales_row.quantity, 0) AS quantity,
        COALESCE(sales_row.total_amount, 0)::NUMERIC(12, 2) AS total_amount,
        COALESCE(sales_row.total_amount, 0)::NUMERIC(12, 2) AS sales_amount,
        sales_row.created_at,
        CASE
            WHEN sales_row.store_name ILIKE '%わんわん%' THEN 6
            ELSE 7
        END AS store_id
    FROM public.product_sales_data AS sales_row
),
matched AS (
    SELECT
        source_row.*,
        alias_match.product_id AS alias_product_id,
        direct_match.id AS direct_product_id
    FROM source_rows AS source_row
    LEFT JOIN LATERAL (
        SELECT alias_row.product_id
        FROM public.product_aliases AS alias_row
        WHERE alias_row.alias_name = source_row.product_name
          AND alias_row.source_system = 'pos'
          AND alias_row.is_active = TRUE
          AND alias_row.store_id = source_row.store_id
        ORDER BY alias_row.updated_at DESC NULLS LAST, alias_row.id DESC
        LIMIT 1
    ) AS alias_match ON TRUE
    LEFT JOIN LATERAL (
        SELECT product_row.id
        FROM public.products AS product_row
        WHERE product_row.product_name = source_row.product_name
          AND product_row.store_id = source_row.store_id
        ORDER BY product_row.updated_at DESC NULLS LAST, product_row.id DESC
        LIMIT 1
    ) AS direct_match ON TRUE
)
SELECT
    matched_row.sales_row_id,
    matched_row.transaction_date,
    matched_row.sale_date,
    matched_row.store_name,
    matched_row.product_name,
    matched_row.quantity,
    matched_row.total_amount,
    matched_row.sales_amount,
    product_row.id AS matched_product_id,
    product_row.jan_code,
    COALESCE(product_row.category, '未分類') AS category,
    product_row.product_group,
    product_row.brand,
    product_row.cost_price::NUMERIC(12, 2) AS cost_price,
    product_row.selling_price::NUMERIC(12, 2) AS selling_price,
    (COALESCE(product_row.cost_price, 0) * matched_row.quantity)::NUMERIC(12, 2) AS estimated_cost,
    (
        matched_row.sales_amount
        - (COALESCE(product_row.cost_price, 0) * matched_row.quantity)
    )::NUMERIC(12, 2) AS estimated_profit,
    CASE
        WHEN matched_row.alias_product_id IS NOT NULL THEN 'alias'
        WHEN matched_row.direct_product_id IS NOT NULL THEN 'direct_name'
        ELSE 'unmatched'
    END AS match_source,
    (COALESCE(matched_row.alias_product_id, matched_row.direct_product_id) IS NULL) AS unmatched_master,
    matched_row.created_at
FROM matched AS matched_row
LEFT JOIN public.products AS product_row
    ON product_row.id = COALESCE(matched_row.alias_product_id, matched_row.direct_product_id);
