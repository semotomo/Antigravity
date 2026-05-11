# Budibase 売上画面 実装ガイド

更新日: 2026-03-30

## 1. このガイドの目的

このガイドは、[budibase_sales_screen_spec.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_screen_spec.md) をそのまま Budibase Builder 上の作業順へ落としたもの。

対象:

- 売上一覧
- 日次集計
- 商品別集計
- 未紐付け確認

今回のゴール:

- Budibase 側で売上系 4 画面を一通り見られる状態にする
- `sales_enriched_v` を主軸に、現場がまず検索と確認を始められる状態にする
- `product_aliases` の登録候補を未紐付け画面から洗い出せるようにする

## 2. 前提

remote Supabase には次が適用済み。

- `sales_enriched_v`
- `sales_daily_summary_v`
- `sales_product_summary_v`
- `product_aliases`

この guide は、Budibase から Supabase を PostgreSQL datasource として接続する前提で書く。

秘密情報の扱い:

- repo に接続文字列や password は書かない
- Budibase 側の datasource 設定だけに入力する
- 取得元は Supabase の `Connect` 画面に限定する

## 3. 事前に手元で確認するもの

Budibase 側で必要な情報:

- Budibase workspace へ入れること
- app を新規作成できる権限

Supabase 側で必要な情報:

- PostgreSQL 接続情報
- host
- database
- user
- password
- SSL が必要な場合の設定値

補足:

- 接続情報は Supabase Dashboard の `Connect` から確認する
- repo 内には残さず、Budibase の datasource 設定にだけ入力する

## 4. 推奨の作業順

この順で作ると迷いにくい。

1. 必要なら `scripts/export_unmatched_sales_candidates.py` で未紐付け候補 CSV を出す
2. Budibase に Supabase datasource を追加する
3. `sales_enriched_v` など必要な view を取り込む
4. 売上一覧を先に作る
5. 日次集計を作る
6. 商品別集計を作る
7. 未紐付け確認を作る
8. 公開前チェックを行う

補足:

- ローカルでは `venv\\Scripts\\python.exe scripts\\export_unmatched_sales_candidates.py --limit 100` で再生成できる
- 出力先は `local_exports/budibase/`

## 5. Step 1. Supabase datasource を追加する

Budibase の `Data` から PostgreSQL datasource を追加する。

設定対象:

- host
- port
- database
- username
- password
- SSL 設定

接続できたら、次の view / table を取り込む。

- `sales_enriched_v`
- `sales_daily_summary_v`
- `sales_product_summary_v`
- `product_aliases`

命名ルールのおすすめ:

- `supabase_sales_enriched_v`
- `supabase_sales_daily_summary_v`
- `supabase_sales_product_summary_v`
- `supabase_product_aliases`

理由:

- Budibase 内で internal table と external datasource を見分けやすい
- 後で在庫 / 客注 / シフトを追加した時に混ざりにくい

完了条件:

- Budibase の Data タブで 4 つのソースが見える
- 各 source の列が読み込まれている

## 6. Step 2. 売上アプリの土台を作る

新規 app を作る。

おすすめ app 名:

- `店舗業務`
- `業務ダッシュボード`
- `売上・在庫管理`

初版では、ナビゲーションに次の 4 ページを作る。

- `売上一覧`
- `日次集計`
- `商品別集計`
- `未紐付け確認`

補足:

- まずは blank screen ベースでよい
- 自動生成より、最初は手で画面を作った方が view ごとの役割を保ちやすい

## 7. Step 3. 売上一覧を作る

### 7-1. データソース

使用 source:

- `sales_enriched_v`

### 7-2. 画面の役割

- 期間 / 店舗 / 商品で売上を探す
- `sales_amount` を正本として確認する
- 未紐付け売上をその場で見つける

### 7-3. 最低限置くもの

- `Data Provider`
- 一覧テーブル
- `Dynamic Filter`
- キーワード検索
- 必要なら KPI カード

### 7-4. 一覧テーブルの既定列

最初に表示する列:

- `sale_date`
- `store_name`
- `product_name`
- `quantity`
- `sales_amount`
- `category`
- `match_source`
- `unmatched_master`

追加で表示できる列:

- `jan_code`
- `product_group`
- `brand`
- `estimated_cost`
- `estimated_profit`
- `transaction_date`

初版では非表示でよい列:

- `sales_row_id`
- `total_amount`
- `created_at`
- `matched_product_id`

### 7-5. フィルタ設定

必須:

- `sale_date >=`
- `sale_date <=`

推奨:

- `store_name`
- `category`
- `unmatched_master`

あると便利:

- `product_group`
- `brand`
- `match_source`

実装メモ:

- Budibase の current docs に合わせるなら、`Data Provider` を置いて `sales_enriched_v` を渡し、その配下で `Dynamic Filter` と `Table` を組み合わせる
- 初版では複雑な条件分岐を作らず、上記 4 軸を先に通す

### 7-6. キーワード検索

1 つの検索入力にまとめる。

対象列:

- `product_name`
- `jan_code`
- `category`

補足:

- 初版では `store_name` まで含めなくてよい
- 店舗は dropdown filter で分けた方が使いやすい

### 7-7. 初期ソート

- `sale_date DESC`
- `sales_amount DESC`
- `product_name ASC`

### 7-8. 初期表示条件

- 期間は直近 30 日
- `unmatched_master` は未指定
- 店舗は未指定

### 7-9. KPI カード

Builder の負荷が軽ければ、画面上部に次を置く。

- 売上合計
- 販売数量合計
- 商品数
- 店舗数
- 粗利試算合計
- 未紐付け件数

もし Budibase 側で集計表示が重い場合:

- 初版では KPI を外す
- 一覧とフィルタを先に完成させる

完了条件:

- `sales_enriched_v` の行が表示される
- 期間絞り込みができる
- `unmatched_master = true` の行を見つけられる

## 8. Step 4. 日次集計を作る

### 8-1. データソース

使用 source:

- `sales_daily_summary_v`

### 8-2. 画面の役割

- 日別の売上推移を見る
- 店舗別の日次比較を見る

### 8-3. 置くもの

- `Data Provider`
- 集計テーブル
- `Dynamic Filter`
- 棒グラフまたは折れ線グラフ

### 8-4. 表示列

- `sale_date`
- `store_name`
- `total_quantity`
- `total_sales_amount`
- `product_count`
- `estimated_profit`

### 8-5. フィルタ

- `sale_date >=`
- `sale_date <=`
- `store_name`

### 8-6. グラフ

グラフを置くなら:

- label: `sale_date`
- value: `total_sales_amount`

店舗比較を重視する場合:

- ページを複製して `store_name` 別表示にしてもよい

完了条件:

- 指定期間の日別売上が見える
- 店舗で絞ったときに数字が変わる

## 9. Step 5. 商品別集計を作る

### 9-1. データソース

使用 source:

- `sales_product_summary_v`

### 9-2. 画面の役割

- 商品別ランキングを見る
- カテゴリ別の売れ筋を見る
- 未紐付け商品を商品単位でも見つける

### 9-3. 表示列

- `product_name`
- `jan_code`
- `category`
- `product_group`
- `brand`
- `total_quantity`
- `total_sales_amount`
- `estimated_profit`
- `unmatched_master`

### 9-4. フィルタ

- `sale_date >=`
- `sale_date <=`
- `store_name`
- `category`
- `unmatched_master`

実装メモ:

- 商品別集計も `Data Provider + Dynamic Filter + Table` の並びにすると揃えやすい

### 9-5. 初期ソート

- `total_sales_amount DESC`
- `total_quantity DESC`

補足:

- 初版では ABC 分析をここに無理に入れない
- まずはランキング画面として使えることを優先する

完了条件:

- 売上上位商品が降順で確認できる
- カテゴリや店舗で絞れる

## 10. Step 6. 未紐付け確認を作る

### 10-1. データソース

使用 source:

- `sales_enriched_v`

固定条件:

- `unmatched_master = true`

### 10-2. 画面の役割

- `product_aliases` 登録候補を見つける
- POS 商品名ゆれの実態を把握する

### 10-3. 表示列

- `sale_date`
- `store_name`
- `product_name`
- `quantity`
- `sales_amount`
- `match_source`

### 10-4. 推奨ソート

- `sale_date DESC`
- `sales_amount DESC`

### 10-5. 初期の優先確認名

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

### 10-6. 運用

この画面だけでは alias を更新しない前提でもよい。

最初の運用:

1. この画面で未紐付け商品名を確認する
2. 既存 `products` に紐づける候補を決める
3. `product_aliases` に登録する
4. 反映後に売上一覧へ戻って未紐付けが減るか確認する

完了条件:

- `unmatched_master = true` の売上だけが見える
- 売上金額や件数の大きい名前から順に確認できる

## 11. Step 7. 公開前チェック

最低限、次を確認する。

- 直近 30 日で売上一覧が空にならない
- 日次集計に数字が出る
- 商品別集計で上位商品が見える
- 未紐付け確認に `unmatched_master = true` の行だけ出る
- `sales_amount` を表示し、`total_amount` を前面に出していない
- `unmatched_master` の表示がユーザーに分かる文言になっている

## 12. 初版でやらないこと

- Budibase 内で複雑な ABC 計算を持つこと
- Budibase 側で生テーブル join を組むこと
- `product_sales_data` の物理列名変更
- alias 登録をいきなり完全自動化すること

## 13. つまずきやすい点

### 13-1. `sales_amount` と `total_amount`

- Budibase では `sales_amount` を表示用の正本にする
- `total_amount` は Flet 互換のため残っているだけと考える

### 13-2. フィルタの責務

- 複雑な条件分岐を Budibase 側で作り込みすぎない
- 絞り込みはまず `sale_date / store_name / category / unmatched_master` に寄せる

### 13-3. 未紐付け商品

- 未紐付けは不具合ではなく、Phase 1 では「運用で減らしていく対象」
- まず件数と売上金額が大きい名前から潰す

## 14. 次の実作業

1. Budibase で datasource を追加する
2. `sales_enriched_v` を使った売上一覧を作る
3. `sales_daily_summary_v` の日次集計画面を作る
4. `sales_product_summary_v` の商品別集計画面を作る
5. 未紐付け確認画面を作る
6. `product_aliases` 運用の導線を決める

## 15. 関連ドキュメント

- [budibase_sales_screen_spec.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_screen_spec.md)
- [budibase_supabase_schema.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_supabase_schema.md)
- [next_ai_handoff_2026-03-30.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/next_ai_handoff_2026-03-30.md)

参考:

- Budibase Data sources: https://docs.budibase.com/docs/data
- Budibase PostgreSQL datasource: https://docs.budibase.com/docs/postgresql
- Budibase Table: https://docs.budibase.com/docs/table
- Budibase Filter: https://docs.budibase.com/docs/filter
- Budibase Dynamic Filter: https://docs.budibase.com/docs/dynamic-filter
- Budibase Data Provider: https://docs.budibase.com/docs/data-provider
- Budibase Charts: https://docs.budibase.com/docs/chart
- Budibase Bar Chart: https://docs.budibase.com/docs/bar-chart
