# Phase 1 SQL Apply Runbook

更新日: 2026-03-28

対象 branch:

- `migration/budibase-phase1`

対象ファイル:

- [supabase_phase1_additive.sql](/Users/kirik/Desktop/Antigravity/inventory/supabase_phase1_additive.sql)
- [supabase_phase1_verify.sql](/Users/kirik/Desktop/Antigravity/inventory/supabase_phase1_verify.sql)

## 1. 目的

この runbook は、Phase 1 の additive SQL を Supabase へ安全に適用し、直後に確認するための手順書である。

## 2. 前提

今回の Phase 1 は、次を守る。

- 既存 Flet を壊さない
- 既存の `stores / products / transfers / customer_orders / product_sales_data` を温存する
- `追加列 / 追加テーブル / view` を優先する
- 破壊的変更は行わない

## 3. この環境でできること / できないこと

### できること

- 実 Supabase の列名・型・join 可否の確認
- additive SQL の作成
- verify SQL の作成

### できないこと

このローカル環境には次が無いため、ここから直接 SQL 適用はしていない。

- `psql`
- `supabase` CLI
- DB 接続文字列
- service role ベースの SQL 実行手段

したがって、適用は Supabase SQL Editor で行う前提にする。

補足:

- Supabase CLI は `npx.cmd supabase` で利用可能になった
- ただし remote 実行には `SUPABASE_ACCESS_TOKEN` か `supabase login`、および remote DB password が必要
- `project-ref` は `wpxewebmezghoulnasre`

## 3-1. CLI ベースの実行ルート

DB password が手元にある場合は、SQL Editor ではなく CLI でも進められる。

想定コマンド:

1. `npx.cmd supabase link --project-ref wpxewebmezghoulnasre --password "<REMOTE_DB_PASSWORD>"`
2. `npx.cmd supabase db push --include-all`

補足:

- migration は [supabase/migrations/20260328173000_phase1_additive.sql](/Users/kirik/Desktop/Antigravity/supabase/migrations/20260328173000_phase1_additive.sql) に配置済み
- 適用後確認は引き続き [supabase_phase1_verify.sql](/Users/kirik/Desktop/Antigravity/inventory/supabase_phase1_verify.sql) を使う

## 4. 適用前チェック

先に確認すること:

1. 作業 branch が `migration/budibase-phase1` である
2. 実 Supabase が想定環境か確認する
3. [supabase_schema_checklist.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/supabase_schema_checklist.md) の実測結果とズレがない
4. `customer_orders` に `store_id` / `product_id` を付けても困る既存運用がない

## 5. 適用手順

### Step 1. additive SQL を流す

Supabase SQL Editor で [supabase_phase1_additive.sql](/Users/kirik/Desktop/Antigravity/inventory/supabase_phase1_additive.sql) を実行する。

期待される変更:

- `products`
  - `product_group`
  - `brand`
  - `is_active`
- `product_aliases`
  - 新規作成
- `customer_orders`
  - 互換拡張列追加
- `sales_enriched_v`
- `sales_daily_summary_v`
- `sales_product_summary_v`

### Step 2. verify SQL を流す

直後に [supabase_phase1_verify.sql](/Users/kirik/Desktop/Antigravity/inventory/supabase_phase1_verify.sql) を実行する。

見るポイント:

- 追加列が存在するか
- `product_aliases` の policy があるか
- 3 つの view が存在するか
- `sales_enriched_v` が空でなく返るか
- `unmatched_master` の件数が妥当か
- `customer_orders` の FK 異常件数が 0 か
- `order_no` 重複が無いか

## 6. 適用後の確認観点

### 売上 view

確認すること:

- `transaction_date` と `sale_date` が取れている
- `total_amount` と `sales_amount` が取れている
- `matched_product_id` が期待通りに入る
- `unmatched_master` の件数が想定より多すぎない

### 客注

確認すること:

- 既存客注データが壊れていない
- `quantity` が null ではなく 1 へ補完されている
- 追加列がすべて nullable のまま使える

### 商品マスタ

確認すること:

- 既存画面が `products` をそのまま読める
- `product_group / brand / is_active` 追加で既存機能が壊れていない

## 7. 適用後に次へ進める条件

次の作業へ進んでよいのは、少なくとも次が満たされた時。

- additive SQL がエラーなく通る
- verify SQL の主要確認が通る
- `sales_enriched_v` が使える
- `customer_orders` の既存データが壊れていない

## 8. 次の作業

1. Budibase 売上画面の列設計
2. `product_aliases` 運用ルールの決定
3. `customer_orders` の Budibase 入力項目確定
4. 在庫を `transfers` 継続にするか、`header + items` に寄せるか判断

## 9. Git 上の扱い

今回の作業は `migration/budibase-phase1` branch で継続する。

もしコミットを切るなら、最小単位は次がおすすめ。

1. `docs/app_migration/*` の計画・完成定義・runbook
2. `inventory/supabase_phase1_additive.sql`
3. `inventory/supabase_phase1_verify.sql`

## 10. 参照

- [completion_definition.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/completion_definition.md)
- [repo_split_strategy.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/repo_split_strategy.md)
- [schema_alignment_snapshot_2026-03-28.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/schema_alignment_snapshot_2026-03-28.md)
- [handover_log.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/handover_log.md)
