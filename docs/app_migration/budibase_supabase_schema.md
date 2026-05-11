# Budibase + Supabase + GAS 構成メモ

## 0. 2026-03-30 時点の実DB確定事項

このメモのうち、実DBで確定した内容は次を優先する。

- `migration/budibase-phase1` で `supabase db push --include-all` 実行済み
- 適用済み migration は `20260328173000_phase1_additive.sql`
- `stores.id` は `integer`
- `products.id` は `integer`
- `transfers.id` は `integer`
- `customer_orders.id` は `uuid`
- `product_sales_data` の実列は `transaction_date / total_amount`
- `products` には `product_group / brand / is_active` を追加済み
- `product_aliases` は作成済み
- `customer_orders` には Phase 1 互換列を追加済み
- `sales_enriched_v / sales_daily_summary_v / sales_product_summary_v` は作成済み

適用後の確認結果:

- `product_aliases` の policy は `Allow all access to product_aliases`
- `invalid_store_refs = 0`
- `invalid_product_refs = 0`
- `duplicate_order_nos = 0`
- `sales_enriched_v.unmatched_master = 271`

直近で Budibase 側に出す主データソースは `sales_enriched_v` とし、初版の推奨列は次を優先する。

- 一覧の既定表示: `sale_date / store_name / product_name / quantity / sales_amount / category / match_source / unmatched_master`
- 詳細または列追加候補: `matched_product_id / jan_code / product_group / brand / estimated_cost / estimated_profit / transaction_date`
- `unmatched_master = true` の行は、`product_aliases` 整備の優先対象として扱う

## 1. 推奨構成

役割を次のように分ける。

- `GAS`
  - POS から売上 CSV を取得
  - シフト生成を実行
  - 必要に応じて日次集計や ABC 分析用データを更新
- `Supabase`
  - 正式な保存先
  - Budibase が読むテーブルと view を提供
- `Budibase`
  - 社員が使う業務画面
  - 商品移動管理
  - 客注管理
  - 売上検索、期間絞り込み、グラフ表示
  - バーコード読取

この構成では、重い処理や外部連携を Budibase に持たせず、`表示 / 入力 / 更新` に集中させる。

## 2. 現在の資産でそのまま活かすもの

現在の Flet 実装と整合する既存テーブル名は次の通り。

- `stores`
- `products`
- `product_sales_data`
- `customer_orders`

既存コードの前提:

- [inventory db](/Users/kirik/Desktop/Antigravity/flet_app/core/inventory/db.py)
- [customer order db](/Users/kirik/Desktop/Antigravity/flet_app/core/customer_orders/db.py)
- [sales data service](/Users/kirik/Desktop/Antigravity/flet_app/core/data_service.py)

まずはこの 4 つを母体にして、足りないものだけ追加する。

## 3. テーブル設計

### 3-1. 店舗マスタ `stores`

用途:

- 商品移動元 / 移動先
- 売上集計の店舗軸
- シフト対象店舗

主な列:

- `id uuid primary key`
- `name text not null unique`
- `code text`
- `is_active boolean default true`
- `sort_order integer default 0`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

### 3-2. 商品マスタ `products`

用途:

- JAN 検索
- バーコード読取後の商品特定
- 売上へのカテゴリ付与
- 商品移動、客注の候補元

主な列:

- `id uuid primary key`
- `jan_code text not null unique`
- `product_name text not null`
- `category text`
- `product_group text`
- `brand text`
- `cost_price numeric(12,2) default 0`
- `selling_price numeric(12,2) default 0`
- `markup_rate numeric(8,4)`
- `is_active boolean default true`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

補足:

- 現在の CSV 由来項目は [inventory db](/Users/kirik/Desktop/Antigravity/flet_app/core/inventory/db.py) と整合している。
- `category` と `product_group` は分けて持っておく方が後で分析しやすい。

### 3-3. 商品名ゆれ対策 `product_aliases`

用途:

- POS 売上の `product_name` と商品マスタの表記ゆれ吸収
- 現在の「商品名で紐づける」暫定運用を安全にする

主な列:

- `id uuid primary key`
- `alias_name text not null`
- `product_id uuid not null references products(id)`
- `source_system text default 'pos'`
- `is_active boolean default true`
- `created_at timestamptz default now()`

一意制約:

- `unique(alias_name, source_system)`

補足:

- POS 側に JAN が取れない期間は、このテーブルがかなり重要。
- 将来 POS 側で JAN 取得できるようになったら役割を縮小できる。

### 3-4. 売上生データ `product_sales_data`

用途:

- GAS が POS から取り込んだ生データの保存先
- 売上管理の元テーブル

主な列:

- `id uuid primary key`
- `source_system text default 'pos'`
- `source_file_name text`
- `store_name text not null`
- `sale_date date not null`
- `transaction_date timestamptz`
- `product_code text`
- `product_name text not null`
- `quantity integer not null default 0`
- `sales_amount numeric(12,2) not null default 0`
- `tax_excluded_amount numeric(12,2)`
- `matched_product_id uuid references products(id)`
- `matched_jan_code text`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

推奨ユニークキー:

- `unique(source_system, store_name, sale_date, product_name, sales_amount, quantity)`

補足:

- 既存実装は `store_name / product_name / quantity / total_amount / transaction_date` を前提にしている。
- 新設時は `total_amount` ではなく `sales_amount` に統一し、Budibase 画面側でもこの名前に寄せる。
- `matched_product_id` と `matched_jan_code` は GAS か SQL で補完しておくと、Budibase での検索と集計が軽くなる。

### 3-5. 売上集計 view `sales_enriched_v`

用途:

- Budibase の検索と表示を軽くする
- 商品マスタ結合済みの売上を一枚で扱う

主な列:

- `sale_date`
- `transaction_date`
- `store_name`
- `product_name`
- `quantity`
- `sales_amount`
- `jan_code`
- `category`
- `product_group`
- `cost_price`
- `estimated_cost`
- `estimated_profit`
- `unmatched_master boolean`

補足:

- `product_sales_data` に `matched_product_id` が埋まるならそれで join
- 埋まらない期間は `product_aliases.alias_name = product_sales_data.product_name` で join
- これを Budibase の売上一覧・グラフの主データソースにする

### 3-6. 売上日次集計 view `sales_daily_summary_v`

用途:

- 期間別棒グラフ
- 店舗別集計
- ダッシュボード KPI

主な列:

- `sale_date`
- `store_name`
- `total_quantity`
- `total_sales_amount`
- `product_count`

### 3-7. 売上商品別集計 view `sales_product_summary_v`

用途:

- 商品検索
- 期間内販売数ランキング
- カテゴリ別売上

主な列:

- `sale_date`
- `store_name`
- `product_id`
- `jan_code`
- `product_name`
- `category`
- `product_group`
- `total_quantity`
- `total_sales_amount`

### 3-8. ABC 分析用 view またはテーブル `sales_abc_summary`

用途:

- 期間別 ABC 分析

おすすめ:

- まずは `view` ではなく `table` にして GAS で更新する
- 理由は、Budibase 側で期間指定した時に毎回重い集計をさせないため

主な列:

- `id uuid primary key`
- `aggregation_start date not null`
- `aggregation_end date not null`
- `store_name text`
- `product_id uuid`
- `jan_code text`
- `product_name text`
- `category text`
- `total_quantity integer`
- `total_sales_amount numeric(12,2)`
- `sales_share numeric(8,4)`
- `cumulative_share numeric(8,4)`
- `abc_rank text`
- `calculated_at timestamptz default now()`

### 3-9. 商品移動ヘッダ `inventory_transfer_headers`

用途:

- 1 回の移動登録を 1 件として管理
- 承認や取消、メモ、登録者の保持

主な列:

- `id uuid primary key`
- `transfer_no text unique`
- `transfer_date timestamptz not null default now()`
- `from_store_id uuid not null references stores(id)`
- `to_store_id uuid not null references stores(id)`
- `status text not null default 'draft'`
- `memo text`
- `created_by text`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

ステータス例:

- `draft`
- `submitted`
- `completed`
- `cancelled`

### 3-10. 商品移動明細 `inventory_transfer_items`

用途:

- 1 回の移動に複数商品を持たせる
- バーコード読取後の追加先

主な列:

- `id uuid primary key`
- `transfer_id uuid not null references inventory_transfer_headers(id) on delete cascade`
- `product_id uuid references products(id)`
- `jan_code text not null`
- `product_name text not null`
- `quantity integer not null`
- `cost_price numeric(12,2) default 0`
- `selling_price numeric(12,2) default 0`
- `line_memo text`
- `created_at timestamptz default now()`

補足:

- 現在の Flet 実装は `transfers` へフラット保存している。
- Budibase へ移る時点で `header + items` に分けると、一覧性と将来拡張がかなり良い。

### 3-11. 客注管理 `customer_orders`

用途:

- 既存 Flet 実装をそのまま引き継ぐ中心テーブル

主な列:

- `id uuid primary key`
- `order_no text unique`
- `customer_name text not null`
- `customer_phone text`
- `customer_line_id text`
- `store_id uuid references stores(id)`
- `product_id uuid references products(id)`
- `jan_code text`
- `product_name text not null`
- `quantity integer not null default 1`
- `unit_price numeric(12,2)`
- `order_date date`
- `expected_arrival_date date`
- `pickup_due_date date`
- `status text not null default 'pending'`
- `note text`
- `created_by text`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

ステータス例:

- `pending`
- `waiting_arrival`
- `waiting_contact`
- `waiting_pickup`
- `completed`
- `cancelled`

補足:

- 既存の `customer_orders` は活かす。
- Budibase 移行時に `store_id` や `product_id` を追加して正規化する。

### 3-12. シフト生成履歴 `shift_generation_runs`

用途:

- GAS が生成したシフトの実行単位を保存
- Budibase はここをヘッダ一覧として表示

主な列:

- `id uuid primary key`
- `store_id uuid references stores(id)`
- `period_start date not null`
- `period_end date not null`
- `generator text default 'gas'`
- `status text not null default 'completed'`
- `source_sheet_id text`
- `generated_at timestamptz default now()`
- `note text`

### 3-13. シフト結果 `shift_assignments`

用途:

- 実際の勤務結果を Budibase で表示

主な列:

- `id uuid primary key`
- `run_id uuid not null references shift_generation_runs(id) on delete cascade`
- `store_id uuid references stores(id)`
- `staff_name text not null`
- `work_date date not null`
- `shift_code text not null`
- `role_name text`
- `start_time time`
- `end_time time`
- `hours numeric(5,2)`
- `is_day_shift boolean`
- `is_night_shift boolean`
- `created_at timestamptz default now()`

補足:

- まずは GAS で生成結果を書き込むだけで十分。
- Budibase 側で編集までやりたくなったら、別途 `shift_staff` や `shift_requests_off` を追加する。

## 4. Budibase で使う画面ごとのデータソース

### 商品移動管理

- 一覧: `inventory_transfer_headers`
- 明細: `inventory_transfer_items`
- 商品検索: `products`
- バーコード読取: `products.jan_code`

### 客注管理

- 一覧 / 編集: `customer_orders`
- 商品候補: `products`
- 店舗候補: `stores`

### 売上管理

- 検索一覧: `sales_enriched_v`
- 日別グラフ: `sales_daily_summary_v`
- 商品別ランキング: `sales_product_summary_v`
- ABC 分析: `sales_abc_summary`

### シフト管理

- 実行履歴: `shift_generation_runs`
- シフト表: `shift_assignments`

## 5. インデックス推奨

最低限、次を付ける。

- `products(jan_code)`
- `products(product_name)`
- `products(category)`
- `product_aliases(alias_name, source_system)`
- `product_sales_data(sale_date)`
- `product_sales_data(store_name, sale_date)`
- `product_sales_data(product_name, sale_date)`
- `product_sales_data(matched_product_id, sale_date)`
- `customer_orders(status, order_date)`
- `customer_orders(store_id, status)`
- `inventory_transfer_headers(transfer_date)`
- `inventory_transfer_headers(from_store_id, to_store_id, transfer_date)`
- `inventory_transfer_items(transfer_id)`
- `shift_generation_runs(store_id, period_start, period_end)`
- `shift_assignments(run_id, work_date)`

## 6. GAS からの書き込み方針

### 売上

- GAS が POS から CSV を取得
- `product_sales_data` へ upsert
- 可能なら同じタイミングで `matched_product_id` と `matched_jan_code` を補完
- 日次または手動で `sales_abc_summary` を再計算

### シフト

- GAS が Google スプレッドシートや既存ロジックでシフトを生成
- `shift_generation_runs` を 1 件追加
- `shift_assignments` を一括 insert

### 商品マスタ

- CSV 更新時は `products` を upsert
- POS 名称差異が見つかったら `product_aliases` を追加

## 7. バーコード読取の扱い

Budibase の `Barcode/QR Scanner` を使い、取得した JAN をそのまま `products.jan_code` に照合する。

基本フロー:

1. カメラで JAN を読む
2. `products` を検索する
3. 商品名、カテゴリ、価格を自動表示
4. 商品移動か客注明細へ追加する

これで現在の Flet の `jan_scanner.html` を置き換えられる。

## 8. 移行の優先順位

おすすめの順序:

1. `stores / products / customer_orders / product_sales_data` を整理
2. `product_aliases` を追加して商品名ゆれを吸収
3. `sales_enriched_v / sales_daily_summary_v / sales_product_summary_v` を作る
4. Budibase で `商品移動管理` を作る
5. Budibase で `客注管理` を作る
6. Budibase で `売上管理` を作る
7. GAS 出力を `shift_generation_runs / shift_assignments` に寄せる

## 9. 最初の実装スコープ

最初の 1 回は、次だけで十分。

- `stores`
- `products`
- `product_aliases`
- `product_sales_data`
- `sales_enriched_v`
- `sales_daily_summary_v`
- `sales_product_summary_v`
- `customer_orders`
- `inventory_transfer_headers`
- `inventory_transfer_items`
- `shift_generation_runs`
- `shift_assignments`

これで、

- 商品移動
- 客注
- 日付検索付き売上
- 商品別販売数
- カテゴリ別円グラフ
- 店舗別 / 日別棒グラフ
- シフト結果の閲覧

までを無理なく載せ替えられる。

## 10. 現行 Flet 互換を保つための移行判断

前提:

- まだ現行 Flet アプリを参照しながら移行を進める
- したがって最初の移行は、既存テーブルの破壊的変更よりも `追加` と `view` を優先する

### 10-1. まず壊さない契約

#### `stores`

- 現行在庫画面は `stores.id` と `stores.name` が取れれば動く
- もし既存 Supabase が `integer` 主キーなら、Phase 1 では無理に `uuid` へ変えない
- `code / is_active / sort_order` のような列追加は問題ない

#### `products`

- 現行コードは次の列に依存している
  - `jan_code`
  - `product_name`
  - `cost_price`
  - `selling_price`
  - `category`
  - `markup_rate`
  - `updated_at`
- したがって `product_name` や `jan_code` の意味を変えず、分析用の列を追加する方が安全
- `product_group / brand / is_active` のような列は追加で持つ

#### `transfers`

- 現行 Flet 在庫画面は `transfers` を 1 商品 1 行のフラット構造として扱っている
- さらに一覧取得では、外部キー名
  - `transfers_from_store_id_fkey`
  - `transfers_to_store_id_fkey`
  を前提に `stores` と join している
- そのため Flet を止めるまでは `transfers` を残す
- `inventory_transfer_headers / inventory_transfer_items` は Budibase 側の新規運用として追加し、切替タイミングで移行する

#### `customer_orders`

- 現行コードが前提にしている列名は次の通り
  - `customer_name`
  - `phone_number`
  - `item_name`
  - `item_details`
  - `staff_name`
  - `notes`
  - `status`
- 現行コードが前提にしているステータス値は次の 6 つ
  - `pending`
  - `ordered`
  - `arrived`
  - `contacted`
  - `completed`
  - `cancelled`
- したがって最初の Budibase 移行では、列名変更や `waiting_arrival` 系への置換はしない
- 必要な項目は nullable 追加で吸収する

#### `product_sales_data`

- 現行 Flet 売上画面は次の列を直接参照している
  - `store_name`
  - `product_name`
  - `quantity`
  - `total_amount`
  - `transaction_date`
- 一方、GAS 仕様書は `sale_date / sales_amount` を使っている
- このズレは `table の列名を今すぐ変える` のではなく、まず `view で正規化する` 方が安全
- Flet 側を止めるまでは、`product_sales_data` の既存契約を壊さない前提で進める

### 10-2. Phase 1 で追加するもの

最初の Budibase 移行では、次を「追加だけ」で入れるのが安全。

- `product_aliases`
- `sales_enriched_v`
- `sales_daily_summary_v`
- `sales_product_summary_v`
- `products` への分析補助列追加
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

補足:

- `store_id` や `product_id` の型は、既存主キー型に合わせる
- 既存が `integer` なら Phase 1 では `integer` にそろえる

### 10-3. Phase 2 以降に回すもの

次は有効だが、Phase 1 の先頭ではやらない方が安全。

- `stores / products` の主キーを `uuid` へ全面移行
- `transfers` から `inventory_transfer_headers / inventory_transfer_items` への完全切替
- `customer_orders.status` を `waiting_arrival / waiting_contact / waiting_pickup` 系へ変更
- `product_sales_data` の列名を `sale_date / sales_amount` へ統一
- `sales_abc_summary` の本番運用
- シフト系テーブルの Supabase 常設化

### 10-4. 直近で先に確定する判断

SQL を書く前に、次の 4 点だけ先に確定すると迷いが減る。

1. `stores.id` と `products.id` の実際の型
2. `product_sales_data` の実列が `transaction_date / total_amount` なのか、`sale_date / sales_amount` なのか
3. Budibase 初版の在庫管理を `transfers` 互換で行くか、`header + items` へ先に寄せるか
4. `customer_orders.status` を現行 6 値で固定するか、Budibase 移行時に見直すか

この 4 点は、[supabase_schema_checklist.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/supabase_schema_checklist.md) を使えば先に確認できる。

## 11. 直近のおすすめ実行順

迷わず進めるなら、次の順が良い。

1. 実 Supabase で `supabase_schema_checklist.md` の確認を行う
2. `stores / products / customer_orders / product_sales_data` の実列と型を確定する
3. その結果を踏まえて、Phase 1 用の additive SQL を作る
4. 先に `product_aliases` と売上 `view` 群を作り、Budibase の売上画面から着手する
5. 在庫と客注は、現行 Flet と同じテーブル契約を残したまま順次移す
