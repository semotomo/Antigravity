# Budibase `売上一覧` 設定値サンプル

更新日: 2026-03-30

## 1. このメモの目的

このメモは、Budibase で最初の 1 画面として `売上一覧` を作る時に、そのまま入れられる設定値のたたき台をまとめたもの。

対象:

- Screen 名
- Data Provider
- Dynamic Filter
- Table
- 表示ラベル
- 初期ソート

前提:

- `sales_enriched_v` は remote Supabase に存在する
- Budibase には PostgreSQL datasource を追加済み
- `sales_enriched_v` を Budibase の Data に取り込み済み

## 2. 最初に目指す完成形

この画面でまずできるようにしたいこと:

- 直近 30 日の売上が見える
- 店舗で絞れる
- カテゴリで絞れる
- 未紐付け売上を見つけられる
- `sales_amount` を正本として確認できる

最初の版ではやらないこと:

- 複雑な全文検索
- ABC 分析
- 編集フォーム
- `product_aliases` の直接編集

## 3. Screen 基本設定

Screen 名:

- `売上一覧`

Menu 表示名:

- `売上一覧`

推奨 path:

- `/sales`

説明テキストの例:

- `期間・店舗・カテゴリで売上を絞り込み、未紐付け売上も確認できます。`

アイコン候補:

- `chart`
- `bar chart`
- `receipt`

補足:

- path は Budibase 側で自動変換されることがある
- 初版は 1 画面 1 役割でよい

## 4. コンポーネント構成

推奨の親子構成:

1. `Container` または `Card Block`
2. タイトル用 `Text`
3. 説明用 `Text`
4. `Data Provider`
5. `Dynamic Filter`
6. `Table`

イメージ:

```text
売上一覧 screen
└─ Container
   ├─ Text: 売上一覧
   ├─ Text: 期間・店舗・カテゴリで絞り込み...
   └─ Data Provider (sales_enriched_v)
      ├─ Dynamic Filter
      └─ Table
```

## 5. `Data Provider` 設定サンプル

Target data source:

- `sales_enriched_v`

初期ソート:

- 1st sort column: `sale_date`
- 1st sort order: `Descending`
- 2nd sort column: `sales_amount`
- 2nd sort order: `Descending`

推奨の初期制限:

- limit は最初は未指定

理由:

- まずはデータが確実に見えることを優先する
- 重ければ後で limit や Budibase view を追加する

補足:

- Budibase 公式 docs では、`Dynamic Filter` や `Chart` は `Data Provider` のデータセットを対象にできる

## 6. `Dynamic Filter` 設定サンプル

Target component:

- 上で作った `Data Provider`

最初に出すフィルタ:

- `sale_date`
- `store_name`
- `category`
- `unmatched_master`

初版では出さなくてよいフィルタ:

- `product_group`
- `brand`
- `match_source`
- `jan_code`

推奨設定:

- `Persist filters`: `ON`
- `Clear filters`: `ON`

フィルタ表示ラベルの例:

- `sale_date` → `売上日`
- `store_name` → `店舗`
- `category` → `カテゴリ`
- `unmatched_master` → `未紐付け`

補足:

- 日付は from / to の両方で使えるかを確認する
- 初版では `product_name` の自由検索を Dynamic Filter に無理に混ぜなくてよい

## 7. `Table` 設定サンプル

### 7-1. データ接続

Provider:

- 上で作った `Data Provider`

### 7-2. 最初に表示する列

表示 ON:

- `sale_date`
- `store_name`
- `product_name`
- `quantity`
- `sales_amount`
- `category`
- `match_source`
- `unmatched_master`

表示 OFF:

- `sales_row_id`
- `transaction_date`
- `total_amount`
- `matched_product_id`
- `jan_code`
- `product_group`
- `brand`
- `cost_price`
- `selling_price`
- `estimated_cost`
- `estimated_profit`
- `created_at`

理由:

- 最初の 1 画面では「探せること」と「未紐付けが分かること」を優先する
- 原価や利益見込みは後から足してよい

### 7-3. 列ラベル

表示ラベルの例:

- `sale_date` → `売上日`
- `store_name` → `店舗`
- `product_name` → `商品名`
- `quantity` → `販売数`
- `sales_amount` → `売上金額`
- `category` → `カテゴリ`
- `match_source` → `紐付け方法`
- `unmatched_master` → `未紐付け`

### 7-4. 推奨の列順

1. `sale_date`
2. `store_name`
3. `product_name`
4. `quantity`
5. `sales_amount`
6. `category`
7. `match_source`
8. `unmatched_master`

### 7-5. Row settings

推奨:

- `Add rows`: `OFF`
- `Edit rows`: `OFF`
- `Delete rows`: `OFF`
- `Row height`: `Small` または `Medium`
- `High contrast`: `ON`

理由:

- `sales_enriched_v` は view なので、初版は読み取り専用に寄せる
- striped rows の方が明細を追いやすい

### 7-6. 列の型に対する注意

- `sales_amount` は numeric なので、必要なら通貨表示へ寄せる
- `unmatched_master` は boolean なので、true/false のままより日本語表示が望ましい

## 8. `unmatched_master` の見せ方サンプル

最初の簡易版:

- `true` / `false` のまま表示でも可

推奨版:

- `true` → `未紐付け`
- `false` → `紐付け済み`

もし条件付き色分けが簡単にできるなら:

- `未紐付け` を強調色
- `紐付け済み` を通常色

## 9. タイトル文言サンプル

画面タイトル:

- `売上一覧`

サブタイトル:

- `期間・店舗・カテゴリで売上を確認し、未紐付け商品名も見つけられます。`

空データ時メッセージ:

- `該当する売上データがありません。期間やフィルタ条件を見直してください。`

## 10. 初版の確認手順

1. Screen を保存する
2. `sales_enriched_v` の行が見えるか確認する
3. `store_name` で絞って件数が変わるか確認する
4. `category` で絞って件数が変わるか確認する
5. `unmatched_master = true` で未紐付けだけ見えるか確認する
6. `sales_amount` が見えていて、`total_amount` が前面に出ていないか確認する

## 11. 初版の次に足す候補

画面が安定したら足すもの:

- `estimated_profit`
- `product_group`
- `brand`
- `jan_code`
- KPI カード

Phase 1 では後回しでよいもの:

- ABC 分析
- 複雑な全文検索
- alias 編集 UI

## 12. よくある迷いどころ

### 12-1. `sales_amount` と `total_amount`

- 表示用は `sales_amount`
- `total_amount` は互換用なので隠す

### 12-2. `transaction_date` と `sale_date`

- 一覧の主表示は `sale_date`
- `transaction_date` は詳細列で十分

### 12-3. `unmatched_master`

- 初版では boolean でもよい
- 運用が回り始めたら日本語ラベルへ寄せる

## 13. この後に続ける順

1. この設定で `売上一覧` を完成させる
2. 次に [budibase_sales_click_guide.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_click_guide.md) を見て `日次集計` を追加する
3. その後 `商品別集計`
4. 最後に `未紐付け確認`

## 14. 関連ドキュメント

- [budibase_sales_click_guide.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_click_guide.md)
- [budibase_sales_build_guide.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_build_guide.md)
- [budibase_sales_screen_spec.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_sales_screen_spec.md)

参考にした公式 docs:

- Table: https://docs.budibase.com/docs/table
- Dynamic Filter: https://docs.budibase.com/docs/dynamic-filter
- Filter: https://docs.budibase.com/docs/filter
- Charts: https://docs.budibase.com/docs/chart
