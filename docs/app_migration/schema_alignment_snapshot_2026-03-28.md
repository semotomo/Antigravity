# Budibase/Supabase 移行スナップショット

更新日時: 2026-03-28 16:00頃

## 1. 今回の位置づけ

この時点の作業は、Flet 画面の直接改修ではなく、Budibase + Supabase へ移行するための共通スキーマ整理である。

参照元:

- [budibase_supabase_schema.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_supabase_schema.md)
- [supabase_schema_checklist.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/supabase_schema_checklist.md)
- [handover_log.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/handover_log.md)

## 2. 現行 Flet が依存している契約

### 2-0. 実 Supabase で確認できた事実

2026-03-28 に実 Supabase REST API で確認した結果、次が確定した。

- `stores.id` は `integer`
- `products.id` は `integer`
- `transfers.id` は `integer`
- `customer_orders.id` は `uuid`
- `product_sales_data.id` は `integer`
- `product_sales_data` の実列名は `transaction_date / total_amount`
- `transfers` の join
  - `stores!transfers_from_store_id_fkey(name)`
  - `stores!transfers_to_store_id_fkey(name)`
  は実際に通る
- `customer_orders.status` は、現時点の実データでは `pending` を確認

### 在庫管理

依存テーブル:

- `stores`
- `products`
- `transfers`

最低限必要な列:

- `stores`
  - `id`
  - `name`
- `products`
  - `jan_code`
  - `product_name`
  - `cost_price`
  - `selling_price`
  - `category`
  - `markup_rate`
  - `updated_at`
- `transfers`
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

追加注意:

- 一覧取得時に `stores!transfers_from_store_id_fkey(name)` と `stores!transfers_to_store_id_fkey(name)` を前提にしている

### 客注管理

依存テーブル:

- `customer_orders`

最低限必要な列:

- `customer_name`
- `phone_number`
- `item_name`
- `item_details`
- `staff_name`
- `notes`
- `status`
- `created_at`
- `updated_at`

コード前提のステータス:

- `pending`
- `ordered`
- `arrived`
- `contacted`
- `completed`
- `cancelled`

### 売上管理

依存テーブル:

- `product_sales_data`
- `products`

Flet 売上画面が直接参照している列:

- `store_name`
- `product_name`
- `quantity`
- `total_amount`
- `transaction_date`

注意:

- GAS 側仕様書では `sale_date / sales_amount` が使われている
- そのため今はテーブル名や列名の統一より、view による吸収の方が安全

## 3. この時点の移行判断

### Phase 1

破壊的変更を避け、`追加` と `view` を優先する。

まず追加する候補:

- `product_aliases`
- `sales_enriched_v`
- `sales_daily_summary_v`
- `sales_product_summary_v`
- `products` への分析補助列
  - `product_group`
  - `brand`
  - `is_active`
- `customer_orders` への nullable 追加列
  - `order_no`
  - `store_id`
  - `product_id`
  - `jan_code`
  - `quantity`
  - `unit_price`
  - `order_date`
  - `expected_arrival_date`
  - `pickup_due_date`

### Phase 2 以降

次は有効だが後段に回す。

- `stores / products` の主キーを `uuid` へ全面移行
- `transfers` から `inventory_transfer_headers / inventory_transfer_items` への完全移行
- `customer_orders.status` の再設計
- `product_sales_data` の列名統一
- `sales_abc_summary` の本格運用
- シフト系テーブルの常設化

## 4. 直近で確定が必要なこと

1. Budibase 初版の在庫管理を `transfers` 互換で行くか、`header + items` に寄せるか
2. `customer_orders.status` を現行 6 値で維持するか、移行時に見直すか
3. `product_aliases` と売上 view 群をどの順で作るか
4. Phase 1 用 additive SQL をどの単位で分けるか

## 5. 次の一手

1. 今回の実確認結果を前提に Phase 1 用の additive SQL を作る
2. 売上 view 群を先に作り、Budibase の売上画面着手をしやすくする
3. `customer_orders` 追加列の互換拡張案を固める
4. 在庫を `transfers` 継続にするか `header + items` へ先行移行するか判断する

## 6. 補足

- このスナップショットは、2026-03-28 16時頃までの調査結果を固定化したもの
- 実装コードの変更は含まない
- 最新の詳細経緯は [handover_log.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/handover_log.md) を参照
