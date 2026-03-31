# Next AI Handoff

更新日: 2026-03-30

## 1. いま何をしているか

Flet から Budibase + Supabase + GAS へ段階移行するための Phase 1 を進行中。

直近の完成イメージ:

- Budibase を日常業務 UI にする
- Supabase を正本データ基盤にする
- GAS を POS 連携 / シフト連携に使う
- Flet は即時廃止せず並走させる

現在地:

- Phase 1 additive SQL は remote Supabase へ適用済み
- verify クエリの主要確認は完了済み
- 次の主作業は `sales_enriched_v` 前提で Budibase 売上画面の列を固めること
- あわせて `unmatched_master = true` の売上を減らすため、`product_aliases` 登録運用を詰める段階
- `scripts/export_unmatched_sales_candidates.py` で未紐付け候補 CSV を再生成できる状態

## 2. 現在の branch

- `migration/budibase-phase1`

## 3. ここまでにできていること

### 実DB確認

実 Supabase REST API で確認済み:

- `stores.id` は `integer`
- `products.id` は `integer`
- `transfers.id` は `integer`
- `customer_orders.id` は `uuid`
- `product_sales_data` の実列は `transaction_date / total_amount`
- `transfers` の `stores!transfers_from_store_id_fkey(name)` / `stores!transfers_to_store_id_fkey(name)` join は成功済み

### ドキュメント

主要ドキュメント:

- [completion_definition.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/completion_definition.md)
- [repo_split_strategy.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/repo_split_strategy.md)
- [schema_alignment_snapshot_2026-03-28.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/schema_alignment_snapshot_2026-03-28.md)
- [phase1_sql_apply_runbook.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/phase1_sql_apply_runbook.md)

### SQL

作成済み:

- [inventory/supabase_phase1_additive.sql](/Users/kirik/Desktop/Antigravity/inventory/supabase_phase1_additive.sql)
- [inventory/supabase_phase1_verify.sql](/Users/kirik/Desktop/Antigravity/inventory/supabase_phase1_verify.sql)
- [supabase/migrations/20260328173000_phase1_additive.sql](/Users/kirik/Desktop/Antigravity/supabase/migrations/20260328173000_phase1_additive.sql)

内容:

- `products` の分析補助列追加
- `product_aliases` 作成
- `customer_orders` の互換拡張列追加
- `sales_enriched_v`
- `sales_daily_summary_v`
- `sales_product_summary_v`
- `product_aliases` の RLS / policy

### Supabase CLI

できていること:

- `npx.cmd supabase` は利用可能
- `supabase init` 済み
- `supabase login` 済み
- `supabase link --project-ref wpxewebmezghoulnasre` 実行済み
- `supabase db push --include-all` 実行済み

project ref:

- `wpxewebmezghoulnasre`

### 適用 / 検証結果

確認済み:

- migration `20260328173000_phase1_additive.sql` の remote 適用完了
- `products` の追加列は反映済み
- `product_aliases` 作成済み
- `customer_orders` の追加列は反映済み
- `sales_enriched_v / sales_daily_summary_v / sales_product_summary_v` は存在確認済み
- `product_aliases` policy は `Allow all access to product_aliases`
- `invalid_store_refs = 0`
- `invalid_product_refs = 0`
- `duplicate_order_nos = 0`
- `products_seed_template.csv` から 111 件のサービス商品を `products` へ追加済み
- `sales_enriched_v` の未紐付け件数 `unmatched_count = 0`

売上 sample で確認できたこと:

- `sales_enriched_v` は Budibase 向けに `sale_date / sales_amount` を提供できている
- 現時点では `unmatched_master = true` の売上は残っていない
- ローカル出力 `local_exports/budibase/products_seed_template.csv` は、追加済みサービス商品の seed 元として残してある

## 4. 現在のブロッカー

DB migration の適用自体は完了。

現在の実務ブロッカーは次の 1 点:

- Budibase 側の実画面はまだ未作成で、Builder 上の実装確認が残っている

## 5. 次の AI がまずやること

1. `sales_enriched_v` を前提に、確定済みの初版列とフィルタを sample / guide に沿って実装する
2. `budibase_sales_list_screen_sample.md` を使って `売上一覧` を Builder 上で実装する
3. `products_seed_template.csv` から追加した 111 件のサービス商品を前提に、Budibase 売上一覧を Builder 上で作る
4. 必要なら `sales_product_summary_v` をランキング / 商品別集計画面の主データソースにする
5. 客注 / 在庫画面へ移る前に、売上 view を使った画面仕様 [budibase_sales_screen_spec.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_screen_spec.md) を起点に Budibase 実装へ入る
6. 実装の順番は [budibase_sales_build_guide.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_build_guide.md) をそのまま使う
7. Builder 上の具体操作は [budibase_sales_click_guide.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_click_guide.md) を見ながら進める
8. `売上一覧` の具体設定値は [budibase_sales_list_screen_sample.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_list_screen_sample.md) をそのままたたき台にする

## 6. Budibase 売上画面の初版メモ

推奨する既定表示列:

- `sale_date`
- `store_name`
- `product_name`
- `quantity`
- `sales_amount`
- `category`
- `match_source`
- `unmatched_master`

あると便利な詳細列:

- `matched_product_id`
- `jan_code`
- `product_group`
- `brand`
- `estimated_cost`
- `estimated_profit`
- `transaction_date`

優先して `product_aliases` を検討したい未紐付け商品名:

- 現時点では `sales_enriched_v.unmatched_master = 0` のため、優先未紐付け名はなし

## 7. この時点での重要判断

- Phase 1 は destructive change を避ける
- `transfers` は残す
- `customer_orders.status` は現行値を維持する
- repo は monorepo 継続、運用前に `gas/` を別 repo 化
- Supabase 運用 repo は Phase 1 安定後に分離検討

## 8. 最短参照先

- 全体像: [completion_definition.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/completion_definition.md)
- 実DB確定事項: [schema_alignment_snapshot_2026-03-28.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/schema_alignment_snapshot_2026-03-28.md)
- 適用手順: [phase1_sql_apply_runbook.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/phase1_sql_apply_runbook.md)
- Budibase / Supabase 構成: [budibase_supabase_schema.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_supabase_schema.md)
- Budibase 売上画面仕様: [budibase_sales_screen_spec.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_screen_spec.md)
- Budibase 実装ガイド: [budibase_sales_build_guide.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_build_guide.md)
- Budibase クリック順メモ: [budibase_sales_click_guide.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_click_guide.md)
- Budibase 売上一覧設定値サンプル: [budibase_sales_list_screen_sample.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_list_screen_sample.md)
- 未紐付け候補エクスポート: [export_unmatched_sales_candidates.py](/Users/kirik/Desktop/Antigravity/scripts/export_unmatched_sales_candidates.py)
- products seed テンプレート: [products_seed_template.csv](/Users/kirik/Desktop/Antigravity/local_exports/budibase/products_seed_template.csv)
- products CSV import: [import_products_from_csv.py](/Users/kirik/Desktop/Antigravity/scripts/import_products_from_csv.py)
- alias CSV import: [import_product_aliases_from_csv.py](/Users/kirik/Desktop/Antigravity/scripts/import_product_aliases_from_csv.py)
- 長い履歴: [handover_log.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/handover_log.md)
