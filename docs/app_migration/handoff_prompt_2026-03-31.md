# Handoff Prompt 2026-03-31

以下の前提で、この repo の作業を再開してください。

## 最初に読むファイル

1. `docs/app_migration/next_ai_handoff_2026-03-30.md`
2. `docs/app_migration/handover_log.md`
3. `docs/app_migration/budibase_sales_build_guide.md`
4. `docs/app_migration/budibase_sales_click_guide.md`
5. `docs/app_migration/budibase_sales_list_screen_sample.md`

## 現在地

- branch は `migration/budibase-phase1`
- linked Supabase には Phase 1 migration 適用済み
- `products` に services 系 111 件を追加済み
- `sales_enriched_v.unmatched_master = 0`
- いまの主作業は DB 整備ではなく Budibase 画面実装

## ここまでで整っているもの

- `sales_enriched_v / sales_daily_summary_v / sales_product_summary_v` は linked Supabase で利用可能
- Budibase 売上一覧の仕様、クリック順、設定値サンプルは docs 化済み
- `scripts/export_unmatched_sales_candidates.py`
- `scripts/import_products_from_csv.py`
- `scripts/import_product_aliases_from_csv.py`
- `flet_app/core/sales/unmatched_export.py`
- `flet_app/core/sales/product_seed_import.py`
- `flet_app/core/sales/product_alias_import.py`

## 次にやること

1. `budibase_sales_click_guide.md` と `budibase_sales_list_screen_sample.md` を見ながら Budibase の `売上一覧` を作る
2. `sales_enriched_v` の filter / sort / 表示列を Builder 上で確認する
3. 問題なければ `sales_daily_summary_v` の日次集計画面を作る
4. 次に `sales_product_summary_v` の商品別集計画面を作る
5. 新しい未紐付けが出た時だけ `product_aliases` 運用へ戻る

## 注意

- repo には今回の移行作業と無関係な未整理変更もあるため、コミット時は巻き込まないこと
- `local_exports/` は生成物なので commit 対象にしないこと
- 既存の未コミット変更は勝手に revert しないこと
