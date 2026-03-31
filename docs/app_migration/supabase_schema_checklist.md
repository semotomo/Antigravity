# Supabase 現状確認チェックリスト

シフト関連は後回しにし、まずは次の 4 領域だけを確認する。

- 店舗
- 商品マスタ
- 商品移動
- 客注
- 売上

このチェックリストは、`今のアプリが実際に期待している列` を基準にしている。

## 1. 最初に見るテーブル

最優先で確認したいのは次の 5 テーブル。

- `stores`
- `products`
- `transfers`
- `customer_orders`
- `product_sales_data`

## 2. アプリが期待している列

### `stores`

最低限ほしい列:

- `id`
- `name`

用途:

- 商品移動の移動元 / 移動先
- 売上の店舗軸

コード参照:

- [inventory db](/Users/kirik/Desktop/Antigravity/flet_app/core/inventory/db.py)
- [inventory view model](/Users/kirik/Desktop/Antigravity/flet_app/core/inventory/view_model.py)

確認したいこと:

- `id` の型は `uuid` か `integer` か
- `name` は重複していないか
- 非表示店舗を管理する `is_active` 的な列があるか

### `products`

今のアプリが期待している列:

- `jan_code`
- `product_name`
- `cost_price`
- `selling_price`
- `category`
- `markup_rate`
- `updated_at`

用途:

- JAN 検索
- バーコード読取
- 客注候補
- 売上データへのカテゴリ付与

コード参照:

- [inventory db](/Users/kirik/Desktop/Antigravity/flet_app/core/inventory/db.py)
- [inventory config](/Users/kirik/Desktop/Antigravity/flet_app/core/inventory/config.py)
- [sales page](/Users/kirik/Desktop/Antigravity/flet_app/pages/sales.py)

確認したいこと:

- `jan_code` に unique 制約があるか
- `product_name` での検索が重くならない程度に index があるか
- `category` 以外に `product_group` や部門列がすでにあるか
- `cost_price` と `selling_price` の型が numeric か integer か

### `transfers`

今のアプリが期待している列:

- `id`
- `transfer_date`
- `from_store_id`
- `to_store_id`
- `jan_code`
- `product_name`
- `quantity`
- `cost_price`
- `total_cost`
- `selling_price`
- `memo`

加えて、一覧取得時に外部キー参照をしている:

- `stores!transfers_from_store_id_fkey(name)`
- `stores!transfers_to_store_id_fkey(name)`

コード参照:

- [inventory db](/Users/kirik/Desktop/Antigravity/flet_app/core/inventory/db.py)
- [inventory page](/Users/kirik/Desktop/Antigravity/flet_app/pages/inventory.py)

確認したいこと:

- `from_store_id` / `to_store_id` の外部キーが実際に `stores.id` に張られているか
- 外部キー名がコードの join 指定と一致しているか
- `transfers` は 1 商品 1 行のフラット構造か
- すでに `header + items` に分かれているか

### `customer_orders`

今のアプリが期待している列:

- `id`
- `customer_name`
- `phone_number`
- `item_name`
- `item_details`
- `staff_name`
- `notes`
- `status`
- `created_at`
- `updated_at`

ステータスとしてコードが前提にしている値:

- `pending`
- `ordered`
- `arrived`
- `contacted`
- `completed`
- `cancelled`

コード参照:

- [customer order db](/Users/kirik/Desktop/Antigravity/flet_app/core/customer_orders/db.py)
- [customer order view model](/Users/kirik/Desktop/Antigravity/flet_app/core/customer_orders/view_model.py)
- [customer order page](/Users/kirik/Desktop/Antigravity/flet_app/pages/customer_orders.py)

確認したいこと:

- 実際の列名が `phone_number / item_name / item_details / notes` で合っているか
- `status` の値がコード前提とズレていないか
- `store_id` や `product_id` がすでに存在するか
- `order_no` 的な管理番号があるか

### `product_sales_data`

今のアプリが期待している列:

- `store_name`
- `product_name`
- `quantity`
- `total_amount`
- `transaction_date`

コード参照:

- [sales data service](/Users/kirik/Desktop/Antigravity/flet_app/core/data_service.py)
- [sales page](/Users/kirik/Desktop/Antigravity/flet_app/pages/sales.py)
- [sales view model](/Users/kirik/Desktop/Antigravity/flet_app/core/sales/view_model.py)

一方、仕様書に書かれている列:

- `store_name`
- `sale_date`
- `product_code`
- `product_name`
- `quantity`
- `sales_amount`
- `tax_excluded_amount`
- `created_at`

仕様書参照:

- [csv download spec](/Users/kirik/Desktop/Antigravity/docs/pos_system_integration/csv_download_specification.md)

確認したいこと:

- 実表は `total_amount` なのか `sales_amount` なのか
- 実表は `transaction_date` なのか `sale_date` なのか
- `product_code` があるか
- `tax_excluded_amount` があるか
- 店舗別 / 日付別検索に必要な index があるか

## 3. いま特にズレを疑っているポイント

優先度高:

- `product_sales_data`
  - docs とコードで列名がズレている
- `customer_orders`
  - 初期設計より実装優先で列名が決まっている可能性がある
- `transfers`
  - 外部キー名が Supabase 側と一致していないと一覧 join が崩れる

優先度中:

- `products`
  - `category` 以外の分析軸がすでにあるか
- `stores`
  - `id` の型

## 4. 確認してほしい項目

Supabase のテーブルエディタで、まずこれだけ見ればよい。

1. `stores`
   - 列一覧
   - 型
   - PK
2. `products`
   - 列一覧
   - `jan_code` の unique
3. `transfers`
   - 列一覧
   - `from_store_id` / `to_store_id` の FK
4. `customer_orders`
   - 列一覧
   - `status` に実際に入っている値
5. `product_sales_data`
   - 列一覧
   - 売上金額列名
   - 日付列名

## 5. SQL エディタでまとめて見る場合

Supabase SQL Editor で次を流すと、主要テーブルの列一覧を一気に確認できる。

```sql
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'stores',
    'products',
    'transfers',
    'customer_orders',
    'product_sales_data'
  )
order by table_name, ordinal_position;
```

外部キー確認:

```sql
select
  tc.table_name,
  kcu.column_name,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name,
  tc.constraint_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
  and ccu.table_schema = tc.table_schema
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
  and tc.table_name in ('transfers', 'customer_orders');
```

`customer_orders.status` の実データ確認:

```sql
select status, count(*)
from customer_orders
group by status
order by count(*) desc;
```

`product_sales_data` の列ズレ確認用:

```sql
select *
from product_sales_data
limit 5;
```

## 6. これがわかれば次にできること

この確認が終わると、次をかなり正確に作れる。

- Budibase 移行で「そのまま使うテーブル」と「追加だけで済むテーブル」の整理
- `product_sales_data` を基にした売上 view 設計
- `customer_orders` の再利用可否判断
- `transfers` をそのまま使うか `header + items` に分けるかの判断

## 7. 今の理解

現時点でかなり確度高く把握できているもの:

- `stores`
- `products`
- `transfers`
- `customer_orders`

現時点で実DB確認が必要なもの:

- `product_sales_data`

シフト関連:

- 今回は保留
- 現行実装はローカル JSON ベースなので、Supabase 確認の優先度は低い

## 8. 実 Supabase 確認結果（2026-03-28）

`.streamlit/secrets.toml` の接続情報を使って、実際の Supabase REST API へ問い合わせた結果を残す。

### 確認できたこと

#### `stores`

確認結果:

- サンプル列
  - `id`
  - `name`
  - `created_at`
- `id` は実データ上 `integer`

サンプル:

- `id = 1`
- `name = 佐世保`

#### `products`

確認結果:

- サンプル列
  - `id`
  - `jan_code`
  - `product_name`
  - `cost_price`
  - `selling_price`
  - `category`
  - `markup_rate`
  - `updated_at`
- `id` は実データ上 `integer`

補足:

- 現行 Flet 在庫画面の前提列と一致

#### `transfers`

確認結果:

- サンプル列
  - `id`
  - `transfer_date`
  - `from_store_id`
  - `to_store_id`
  - `jan_code`
  - `product_name`
  - `quantity`
  - `cost_price`
  - `total_cost`
  - `selling_price`
  - `memo`
  - `created_at`
- `id` は実データ上 `integer`
- `from_store_id` / `to_store_id` は実データ上 `integer`

join 確認:

- `stores!transfers_from_store_id_fkey(name)`
- `stores!transfers_to_store_id_fkey(name)`

上記 join は実際に成功したため、現行 Flet コードの前提は生きている

#### `customer_orders`

確認結果:

- サンプル列
  - `id`
  - `created_at`
  - `updated_at`
  - `customer_name`
  - `phone_number`
  - `item_name`
  - `item_details`
  - `staff_name`
  - `notes`
  - `status`
- `id` は実データ上 `uuid`

ステータス実測:

- 現時点で確認できた値は `pending`

補足:

- 少なくとも列名は現行 Flet 客注画面の前提と一致

#### `product_sales_data`

確認結果:

- サンプル列
  - `id`
  - `transaction_date`
  - `store_name`
  - `product_name`
  - `quantity`
  - `total_amount`
  - `created_at`
- `id` は実データ上 `integer`
- 実列名は `sale_date / sales_amount` ではなく、`transaction_date / total_amount`

補足:

- 仕様書との差分が実DBでも確認された
- Budibase 向け初期移行では、まず view で吸収する方針が妥当

### この確認で確定したこと

1. `stores.id` は `integer` 前提でよい
2. `products.id` は `integer` 前提でよい
3. `transfers` は現行 Flet が前提にしている構造のまま存在する
4. `customer_orders.id` は `uuid`
5. `product_sales_data` は `transaction_date / total_amount` 契約で実運用されている

### 次にやること

- Phase 1 用 SQL は `stores/products/transfers` の `integer` 主キー前提で書く
- `customer_orders` 拡張列を追加する場合は `store_id/product_id` の型を `integer` に合わせる
- 売上 view は `product_sales_data.transaction_date` と `product_sales_data.total_amount` を起点に作る
