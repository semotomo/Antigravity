-- 売上推移APIがJANだけで両店舗を横断集計しないよう、店舗IDを公開する。
-- 既存利用箇所への影響を避けるため、既存の列順は変えず末尾にstore_idを追加する。
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
    matched_row.created_at,
    matched_row.store_id
FROM matched AS matched_row
LEFT JOIN public.products AS product_row
    ON product_row.id = COALESCE(matched_row.alias_product_id, matched_row.direct_product_id)
   AND product_row.store_id = matched_row.store_id;

-- ABC分析から開く売上推移でも選択行の店舗IDを失わないようにする。
CREATE OR REPLACE VIEW public.sales_product_summary_v AS
SELECT
    sale_date,
    transaction_date,
    store_name,
    matched_product_id AS product_id,
    COALESCE(jan_code, '-') AS jan_code,
    product_name,
    COALESCE(category, '未分類') AS category,
    product_group,
    brand,
    SUM(quantity) AS total_quantity,
    SUM(sales_amount)::NUMERIC(12, 2) AS total_sales_amount,
    SUM(estimated_cost)::NUMERIC(12, 2) AS estimated_cost,
    SUM(estimated_profit)::NUMERIC(12, 2) AS estimated_profit,
    BOOL_OR(unmatched_master) AS unmatched_master,
    store_id
FROM public.sales_enriched_v
GROUP BY
    sale_date,
    transaction_date,
    store_name,
    matched_product_id,
    COALESCE(jan_code, '-'),
    product_name,
    COALESCE(category, '未分類'),
    product_group,
    brand,
    store_id;
