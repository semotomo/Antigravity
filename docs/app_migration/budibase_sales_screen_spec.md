# Budibase 売上画面 初版仕様

更新日: 2026-03-30

## 1. 目的

Phase 1 の Budibase 売上画面は、次を安全に置き換えることを目的とする。

- Flet 売上画面で見ていた日次の売上確認
- 店舗別 / 商品別の集計確認
- 商品マスタ未紐付け売上の発見

方針:

- 重い join や商品名ゆれ吸収は Supabase view 側で行う
- Budibase は表示 / 絞り込み / 簡易更新導線に集中する
- 初版は `sales_enriched_v` を中心に組み、必要に応じて集計 view を併用する

## 2. 前提

2026-03-30 時点で、remote Supabase には次が適用済み。

- `sales_enriched_v`
- `sales_daily_summary_v`
- `sales_product_summary_v`
- `product_aliases`

確認済み事項:

- `sales_enriched_v.unmatched_master = true` は 271 件
- `invalid_store_refs = 0`
- `invalid_product_refs = 0`
- `duplicate_order_nos = 0`

## 3. 使用データソース

### 3-1. 明細一覧

データソース:

- `public.sales_enriched_v`

用途:

- 売上一覧
- 商品検索
- 未紐付け確認
- 利益見込み確認

主な列:

- `sale_date`
- `transaction_date`
- `store_name`
- `product_name`
- `quantity`
- `sales_amount`
- `matched_product_id`
- `jan_code`
- `category`
- `product_group`
- `brand`
- `estimated_cost`
- `estimated_profit`
- `match_source`
- `unmatched_master`

### 3-2. 日次集計

データソース:

- `public.sales_daily_summary_v`

用途:

- 日別推移
- 店舗別日次確認
- 日次 KPI 一覧

主な列:

- `sale_date`
- `store_name`
- `total_quantity`
- `total_sales_amount`
- `line_count`
- `product_count`
- `estimated_cost`
- `estimated_profit`

### 3-3. 商品別集計

データソース:

- `public.sales_product_summary_v`

用途:

- 商品別ランキング
- カテゴリ別確認
- 商品別の販売数 / 売上 / 粗利確認

主な列:

- `sale_date`
- `store_name`
- `product_id`
- `jan_code`
- `product_name`
- `category`
- `product_group`
- `brand`
- `total_quantity`
- `total_sales_amount`
- `estimated_cost`
- `estimated_profit`
- `unmatched_master`

## 4. 画面構成

初版は 1 つの Budibase app 内で、売上系を次の 4 画面に分ける。

### 4-1. 売上一覧

主データソース:

- `sales_enriched_v`

目的:

- まず現場が「期間 / 店舗 / 商品」で売上を探せること
- 未紐付け売上をその場で見つけられること

### 4-2. 日次集計

主データソース:

- `sales_daily_summary_v`

目的:

- 店舗別・日別の売上推移を見ること
- ダッシュボード寄りの確認を軽くすること

### 4-3. 商品別集計

主データソース:

- `sales_product_summary_v`

目的:

- 期間内の商品ランキングを見ること
- カテゴリ別の売れ筋を確認すること

### 4-4. 未紐付け確認

主データソース:

- `sales_enriched_v`

固定条件:

- `unmatched_master = true`

目的:

- `product_aliases` 追加候補を洗い出すこと
- POS 商品名の表記ゆれを運用で潰していくこと

## 5. 売上一覧 仕様

### 5-1. 初版フィルタ

必須フィルタ:

- `sale_date` from
- `sale_date` to

推奨フィルタ:

- `store_name`
- `category`
- `unmatched_master`

追加すると便利なフィルタ:

- `product_group`
- `brand`
- `match_source`

検索欄:

- 1 つのキーワード検索を置く
- 対象は `product_name / jan_code / category`

初期値:

- 期間は「直近 30 日」
- 店舗は「すべて」
- `unmatched_master` は「すべて」

### 5-2. 一覧の既定表示列

優先表示列:

- `sale_date`
- `store_name`
- `product_name`
- `quantity`
- `sales_amount`
- `category`
- `match_source`
- `unmatched_master`

詳細表示列:

- `jan_code`
- `product_group`
- `brand`
- `estimated_cost`
- `estimated_profit`
- `transaction_date`

非表示でよい列:

- `sales_row_id`
- `total_amount`
- `created_at`
- `matched_product_id`

補足:

- `total_amount` は互換列なので、Budibase では `sales_amount` を表示の正本にする
- `unmatched_master` は単なる真偽値より、`未紐付け / 紐付け済み` の表示に寄せた方が見やすい

### 5-3. 初期ソート

- `sale_date DESC`
- `sales_amount DESC`
- `product_name ASC`

### 5-4. KPI カード

初版で置きたい KPI:

- 売上合計
- 販売数量合計
- 商品数
- 店舗数
- 粗利試算合計
- 未紐付け件数

実装メモ:

- 初版は Budibase の集計機能で対応してよい
- もし `sales_enriched_v` の件数増加で重くなる場合は、Phase 1.1 で専用 summary view を追加する

## 6. 日次集計 仕様

表示列:

- `sale_date`
- `store_name`
- `total_quantity`
- `total_sales_amount`
- `product_count`
- `estimated_profit`

主な見せ方:

- テーブル
- 日別折れ線または棒グラフ
- 店舗別比較

フィルタ:

- `sale_date` from / to
- `store_name`

補足:

- この画面では商品名検索は持たせない
- 商品軸の分析は `sales_product_summary_v` に寄せる

## 7. 商品別集計 仕様

表示列:

- `product_name`
- `jan_code`
- `category`
- `product_group`
- `brand`
- `total_quantity`
- `total_sales_amount`
- `estimated_profit`
- `unmatched_master`

フィルタ:

- `sale_date` from / to
- `store_name`
- `category`
- `unmatched_master`

初期ソート:

- `total_sales_amount DESC`
- `total_quantity DESC`

補足:

- Phase 1 初版では、この画面を「商品別ランキング」用途に寄せる
- Flet にあった ABC 分析は、後続で `sales_abc_summary` を追加したタイミングで分離する

## 8. 未紐付け確認 仕様

固定条件:

- `unmatched_master = true`

表示列:

- `sale_date`
- `store_name`
- `product_name`
- `quantity`
- `sales_amount`
- `match_source`

優先アクション:

- `product_aliases` 登録候補として商品名を確認する
- 既存商品マスタに紐づくかを別画面で確認する

初期の優先候補:

- `爪切りのみ`
- `プードル（Ｃ）`
- `爪切りセット`
- `足裏バリカン`
- `犬（超小型）１〜５ｋｇ(土日祝)`
- `ダックス`
- `プードル`
- `チワワ`
- `部分カット`
- `肛門腺絞り`

運用メモ:

- まず sale_rows が多い名前から `product_aliases` を登録する
- `（Ｃ）` や `土日祝` のような表記差分は alias で吸収しやすい
- サービス名と物販名が混じる可能性があるため、無理に既存 `products` へ寄せず、カテゴリ運用も合わせて確認する

## 9. Budibase 実装メモ

初版でやること:

- 売上一覧テーブルを `sales_enriched_v` で作る
- フィルタバーを `sale_date / store_name / category / unmatched_master` で作る
- 日次集計テーブルを `sales_daily_summary_v` で作る
- 商品別集計テーブルを `sales_product_summary_v` で作る
- 未紐付け専用ビューを `sales_enriched_v` の絞り込みで作る

初版ではやらないこと:

- Budibase 側で複雑な ABC 計算を持つこと
- 生テーブルに対する商品名ゆれ join を Budibase で実装すること
- `product_sales_data` の物理列名変更

## 10. 次の実作業

1. Budibase で `sales_enriched_v` を元に売上一覧画面を作る
2. フィルタと既定列をこの仕様どおりに設定する
3. 未紐付け専用ビューを作り、`product_aliases` の運用導線を決める
4. 商品別集計画面を `sales_product_summary_v` で追加する
5. 必要なら Phase 1.1 で ABC 分析用の summary を追加する

## 11. 関連ドキュメント

- [budibase_supabase_schema.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_supabase_schema.md)
- [next_ai_handoff_2026-03-30.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/next_ai_handoff_2026-03-30.md)
- [completion_definition.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/completion_definition.md)
- [supabase_phase1_additive.sql](/Users/kirik/Desktop/Antigravity/inventory/supabase_phase1_additive.sql)
