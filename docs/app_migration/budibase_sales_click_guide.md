# Budibase 売上画面 クリック順メモ

更新日: 2026-03-30

## 1. 目的

このメモは、Budibase Builder を開いた状態から、`売上一覧` を最短で作るための操作順をそのまま書いたもの。

対象:

- `売上一覧`
- `日次集計`
- `商品別集計`
- `未紐付け確認`

前提:

- Supabase 側には `sales_enriched_v / sales_daily_summary_v / sales_product_summary_v / product_aliases` がある
- Budibase にログイン済み
- app 作成権限がある

## 2. 先に開く資料

作業しながら次を横に置く。

- [budibase_sales_screen_spec.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_screen_spec.md)
- [budibase_sales_build_guide.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_build_guide.md)
- [budibase_sales_list_screen_sample.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_list_screen_sample.md)

## 3. Datasource 追加のクリック順

1. Budibase を開く
2. 対象 workspace を開く
3. 左メニューで `Data` を開く
4. `+` または `Add source` を押す
5. datasource 一覧から `PostgreSQL` を選ぶ
6. Supabase の接続情報を入力する
7. `Test connection` があれば実行する
8. 保存する

入力するもの:

- host
- port
- database
- username
- password
- SSL 設定

補足:

- 接続情報は Supabase の `Connect` 画面から取る
- repo には残さない

## 4. View 取り込みのクリック順

1. `Data` タブで作成した PostgreSQL datasource を開く
2. `Fetch tables` またはテーブル取得系の操作を開く
3. 一覧から次を選ぶ
4. `Import` または `Fetch` を実行する

取り込む対象:

- `sales_enriched_v`
- `sales_daily_summary_v`
- `sales_product_summary_v`
- `product_aliases`

確認ポイント:

- `sales_enriched_v` に `sale_date` と `sales_amount` が見える
- `sales_daily_summary_v` に `total_sales_amount` が見える
- `sales_product_summary_v` に `total_quantity` と `estimated_profit` が見える

## 5. App 作成のクリック順

1. 左メニューで `Apps` を開く
2. `Create app` を押す
3. app 名を入れる
4. ひとまず blank app かシンプルな app を選ぶ
5. app を作成する

おすすめ app 名:

- `店舗業務`
- `売上・在庫管理`

## 6. `売上一覧` を作るクリック順

### 6-1. 画面を作る

1. app を開く
2. 左メニューで `Screens` を開く
3. `Add screen`
4. `Blank screen` を選ぶ
5. 名前を `売上一覧` にする
6. path を確認して作成する

補足:

- path は自動で小文字やハイフンに変換されることがある
- blank screen の方が役割を崩しにくい

### 6-2. Table を置く

1. `Design` を開く
2. `Add component`
3. `Data Provider` を追加する
4. datasource を `sales_enriched_v` にする
5. `Data Provider` の中に `Table` を追加する

補足:

- current docs では `Dynamic Filter` は `Data Provider` のデータセットに対して使う前提が分かりやすい

### 6-3. まず見えるようにする列

最初に残す列:

- `sale_date`
- `store_name`
- `product_name`
- `quantity`
- `sales_amount`
- `category`
- `match_source`
- `unmatched_master`

初版では隠してよい列:

- `sales_row_id`
- `total_amount`
- `created_at`
- `matched_product_id`

あると便利なら追加:

- `jan_code`
- `product_group`
- `brand`
- `estimated_cost`
- `estimated_profit`
- `transaction_date`

### 6-4. ソートを入れる

Table または Data 設定で次の順にする。

- `sale_date DESC`
- `sales_amount DESC`
- `product_name ASC`

### 6-5. Filter を置く

1. `Add component`
2. `Dynamic Filter` を追加する
3. `Data Provider` を参照するよう設定する

最初に有効化する列:

- `sale_date`
- `store_name`
- `category`
- `unmatched_master`

補足:

- Budibase 公式 docs では、`Dynamic Filter` は `Data Provider` のデータセットを絞り込む
- 日付は from / to が扱えるかを確認する

### 6-6. 検索欄を足す

簡単に始めるなら、まずは Table 既定の検索や Filter だけでもよい。

キーワード検索を別入力で作る場合:

1. `Add component`
2. `Text input` を追加
3. Filter または binding で `product_name / jan_code / category` にかかるよう設定する

補足:

- ここは Budibase 側の実装方法に自由度がある
- 初版では無理に 1 つの全文検索を作り込まず、Filter だけ先に完成させてもよい

### 6-7. 表示ラベルを整える

ユーザー向けには次の表示に寄せる。

- `sales_amount` → `売上金額`
- `quantity` → `販売数`
- `unmatched_master` → `未紐付け`
- `match_source` → `紐付け方法`

### 6-8. まずの完成条件

- 行が見える
- 直近 30 日の売上が確認できる
- 店舗で絞れる
- `unmatched_master = true` を見つけられる

## 7. `日次集計` を作るクリック順

1. `Screens`
2. `Add screen`
3. `Blank screen`
4. 名前を `日次集計`
5. `Design`
6. `Table` を追加
7. その前に `Data Provider` を追加して datasource を `sales_daily_summary_v` にする
8. `Dynamic Filter` を追加する
9. 必要なら `Chart` を追加する

表示列:

- `sale_date`
- `store_name`
- `total_quantity`
- `total_sales_amount`
- `product_count`
- `estimated_profit`

Filter:

- `sale_date`
- `store_name`

Chart を置くなら:

- label column: `sale_date`
- data column: `total_sales_amount`

## 8. `商品別集計` を作るクリック順

1. `Screens`
2. `Add screen`
3. `Blank screen`
4. 名前を `商品別集計`
5. `Design`
6. `Table` を追加
7. その前に `Data Provider` を追加して datasource を `sales_product_summary_v` にする
8. `Dynamic Filter` を追加する

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

初期ソート:

- `total_sales_amount DESC`
- `total_quantity DESC`

## 9. `未紐付け確認` を作るクリック順

1. `Screens`
2. `Add screen`
3. `Blank screen`
4. 名前を `未紐付け確認`
5. `Design`
6. `Table` を追加
7. その前に `Data Provider` を追加して datasource を `sales_enriched_v` にする
8. data 設定で `unmatched_master = true` の条件を入れる
9. 必要なら `Dynamic Filter` を追加する

表示列:

- `sale_date`
- `store_name`
- `product_name`
- `quantity`
- `sales_amount`
- `match_source`

この画面の役割:

- alias 登録候補の確認
- 金額や件数が大きい名前から潰すこと

## 10. 最初に確認する未紐付け名

この順で確認すると効果が出やすい。

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

## 11. 公開前チェックのクリック順

1. `売上一覧` を開く
2. 直近 30 日で空でないことを確認する
3. `store_name` を変えて件数が変わるか確認する
4. `unmatched_master` を true にして未紐付けが出るか確認する
5. `日次集計` を開いて `total_sales_amount` が見えるか確認する
6. `商品別集計` を開いて売上上位商品が見えるか確認する
7. `未紐付け確認` で未紐付けだけが出るか確認する

## 12. つまずいたときの戻り先

列定義で迷ったら:

- [budibase_sales_screen_spec.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_screen_spec.md)

実装順で迷ったら:

- [budibase_sales_build_guide.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_build_guide.md)

全体方針で迷ったら:

- [next_ai_handoff_2026-03-30.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/next_ai_handoff_2026-03-30.md)

## 13. 参考にした公式 docs

- Budibase Screens: https://docs.budibase.com/docs/screens
- Budibase Introduction to data: https://docs.budibase.com/docs/data
- Budibase Data sources: https://docs.budibase.com/docs/data-sources
- Budibase PostgreSQL datasource: https://docs.budibase.com/docs/postgresql
- Budibase Table: https://docs.budibase.com/docs/table
- Budibase Filter: https://docs.budibase.com/docs/filter
- Budibase Dynamic Filter: https://docs.budibase.com/docs/dynamic-filter
- Budibase Data Provider: https://docs.budibase.com/docs/data-provider
- Budibase Charts: https://docs.budibase.com/docs/chart
