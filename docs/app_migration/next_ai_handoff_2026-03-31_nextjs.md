# Next AI Handoff for Next.js Replatform

更新日: 2026-03-31

## 1. 目的

Budibase Builder ベースの画面実装は途中まで進めたが、今後の修正・追加・AI 支援開発との相性を考えて、
次の構成へ切り替える前提で他の AI に引き継ぐ。

予定構成:

- フロントエンド: Next.js (App Router)
- ホスティング: Vercel Free を想定
- データベース: Supabase 既存プロジェクトを継続利用
- 認証: Supabase Auth

この handoff では、他の AI が必要とする次の情報をまとめる。

- 現在の DB 状態
- DB にどう反映してきたか
- どのファイルが source of truth か
- Budibase でどこまで進んだか
- Next.js 側で最低限再実装すべき画面

## 2. 現在地の要約

- branch: `migration/budibase-phase1`
- linked Supabase には Phase 1 additive migration 適用済み
- `products` に services 系 111 件を追加済み
- `sales_enriched_v.unmatched_master = 0` まで確認済み
- 主作業は当初 Budibase 画面実装だったが、ここで Next.js へ方針転換する

重要:

- DB 側の Phase 1 整備は完了済みとみなしてよい
- これ以降の主作業は DB 再設計ではなく、既存 view を読む UI 実装
- Budibase は source of truth ではない

## 3. Supabase プロジェクト情報

Supabase project ref:

- `wpxewebmezghoulnasre`

repo 内で確認できるもの:

- `.streamlit/secrets.toml` には Supabase URL と publishable key はある
- ただし PostgreSQL 接続用の `host / port / database / username / password / SSL` 一式は repo に保存していない

注意:

- DB パスワードは repo に書かないこと
- 2026-03-31 に DB パスワード再設定を実施済み
- 直接 PostgreSQL 接続する場合は、最新のパスワードをユーザーから受け取るか、Supabase Dashboard の Database/Connect から確認すること

Budibase 接続時に使えた非 secret 情報:

- session pooler host: `aws-1-ap-southeast-2.pooler.supabase.com`
- port: `5432`
- database: `postgres`
- user: `postgres.wpxewebmezghoulnasre`
- schema: `public`

## 4. 現在の DB 構成で重要なオブジェクト

Phase 1 で重要なのは次の 1 table + 3 view。

table:

- `public.product_aliases`

views:

- `public.sales_enriched_v`
- `public.sales_daily_summary_v`
- `public.sales_product_summary_v`

関連マスタ:

- `public.products`

### 4-1. `products`

Phase 1 で追加された主な列:

- `product_group`
- `brand`
- `is_active`

services 系 111 件は `products` に追加済み。

### 4-2. `product_aliases`

役割:

- POS 側の `product_name` 別名を `products.id` にひも付ける
- `sales_enriched_v` の一致判定で最優先に参照する

主な列:

- `alias_name`
- `product_id`
- `source_system`
- `is_active`

ユニーク:

- `(alias_name, source_system)`

### 4-3. `sales_enriched_v`

source:

- `public.product_sales_data`
- `public.product_aliases`
- `public.products`

判定ロジック:

1. `product_aliases` の active alias を優先
2. 見つからなければ `products.product_name` の direct match
3. どちらも無ければ `unmatched`

主な列:

- `sales_row_id`
- `transaction_date`
- `sale_date`
- `store_name`
- `product_name`
- `quantity`
- `total_amount`
- `sales_amount`
- `matched_product_id`
- `jan_code`
- `category`
- `product_group`
- `brand`
- `cost_price`
- `selling_price`
- `estimated_cost`
- `estimated_profit`
- `match_source`
- `unmatched_master`
- `created_at`

画面実装で主に使う列:

- `sale_date`
- `store_name`
- `product_name`
- `quantity`
- `sales_amount`
- `category`
- `match_source`
- `unmatched_master`

### 4-4. `sales_daily_summary_v`

source:

- `sales_enriched_v`

主な列:

- `sale_date`
- `transaction_date`
- `store_name`
- `total_quantity`
- `total_sales_amount`
- `line_count`
- `product_count`
- `estimated_cost`
- `estimated_profit`

### 4-5. `sales_product_summary_v`

source:

- `sales_enriched_v`

主な列:

- `sale_date`
- `transaction_date`
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

## 5. DB 反映の source of truth

### 5-1. Migration SQL

主 source of truth:

- `inventory/supabase_phase1_additive.sql`
- `supabase/migrations/20260328173000_phase1_additive.sql`

verify:

- `inventory/supabase_phase1_verify.sql`

### 5-2. DB 変更の適用方法

基本フロー:

1. `npx.cmd supabase login`
2. `npx.cmd supabase link --project-ref wpxewebmezghoulnasre`
3. `npx.cmd supabase db push --include-all`
4. `inventory/supabase_phase1_verify.sql` で確認

補足:

- 実作業では `supabase db query --linked` を多用して確認している
- destructive migration はしていない
- Phase 1 は additive で進めている

## 6. マスタ反映の実運用フロー

未一致データを解消して DB に反映するまでの流れは次のとおり。

### 6-1. 未一致候補を export

使用スクリプト:

- `scripts/export_unmatched_sales_candidates.py`

役割:

- 未一致候補 CSV
- alias import template CSV
- products seed CSV
- JSON summary

を `local_exports/budibase/` に出力する。

主な出力:

- `local_exports/budibase/unmatched_sales_candidates.csv`
- `local_exports/budibase/product_aliases_import_template.csv`
- `local_exports/budibase/products_seed_template.csv`
- `local_exports/budibase/unmatched_sales_candidates.json`

実行例:

```powershell
venv\Scripts\python.exe scripts\export_unmatched_sales_candidates.py --limit 100
```

### 6-2. `products` を seed CSV から upsert

使用スクリプト:

- `scripts/import_products_from_csv.py`

内部では `supabase db query --linked --file` を使って SQL を投げる。

実行例:

```powershell
venv\Scripts\python.exe scripts\import_products_from_csv.py
venv\Scripts\python.exe scripts\import_products_from_csv.py --apply
```

運用:

- まず dry-run
- 問題なければ `--apply`

### 6-3. `product_aliases` を template CSV から upsert

使用スクリプト:

- `scripts/import_product_aliases_from_csv.py`

これも内部では `supabase db query --linked --file` を使う。

実行例:

```powershell
venv\Scripts\python.exe scripts\import_product_aliases_from_csv.py
venv\Scripts\python.exe scripts\import_product_aliases_from_csv.py --apply
```

運用:

- まず dry-run
- 問題なければ `--apply`

### 6-4. 最終確認

最終的には次を確認する。

- `sales_enriched_v` で一覧表示できるか
- `unmatched_master = true` が 0 件か

確認例:

```sql
SELECT COUNT(*)::INTEGER AS unmatched_count
FROM public.sales_enriched_v
WHERE unmatched_master = TRUE;
```

今回の最終確認値:

- `unmatched_count = 0`

## 7. Budibase でどこまで進んだか

Budibase は完全には捨てていないが、今後の source of truth にはしない。

実施済み:

- Budibase Cloud workspace 作成
- Supabase PostgreSQL datasource 接続成功
- `product_aliases`
- `sales_enriched_v`
- `sales_daily_summary_v`
- `sales_product_summary_v`

を Budibase Data に取り込み済み

補足:

- view は Budibase 上では query として取り込まれた
- query schema が空だと table/dynamic filter が列を認識しない問題があった
- 2026-03-31 に query preview -> save で 3 view の schema 保存まで実施済み

画面側の進捗:

- app `売上管理` を作成済み
- `/sales` screen を作成済み
- `Data Provider` / `Dynamic Filter` / `Table` を配置済み
- `Table` の表示列は概ね `sale_date / store_name / product_name / quantity / sales_amount / category / match_source / unmatched_master` に寄せてある
- `Dynamic Filter` は編集中で止めた
- `sales_daily_summary_v` と `sales_product_summary_v` の画面は未作成

判断:

- Budibase は参考実装としては使える
- ただし今後の実装本体は Next.js 側でやる前提がよい

## 8. Next.js 側で最低限必要な画面

### 8-1. 売上一覧

source:

- `sales_enriched_v`

最低限の表示列:

- `sale_date`
- `store_name`
- `product_name`
- `quantity`
- `sales_amount`
- `category`
- `match_source`
- `unmatched_master`

最低限の filter:

- `sale_date`
- `store_name`
- `category`
- `unmatched_master`

初期 sort 方針:

- `sale_date DESC`
- `sales_amount DESC`
- `product_name ASC`

### 8-2. 日次集計

source:

- `sales_daily_summary_v`

最低限の表示列:

- `sale_date`
- `store_name`
- `total_quantity`
- `total_sales_amount`
- `product_count`
- `estimated_profit`

### 8-3. 商品別集計

source:

- `sales_product_summary_v`

最低限の表示列:

- `product_name`
- `jan_code`
- `category`
- `product_group`
- `brand`
- `total_quantity`
- `total_sales_amount`
- `estimated_profit`
- `unmatched_master`

## 9. 認証の前提

予定:

- Supabase Auth を使う

この repo ではまだ Next.js 側の認証実装は始めていない。

他の AI に依頼する際は、次を前提にしてよい。

- DB は既存 Supabase を継続利用
- Auth も Supabase Auth へ寄せる
- まずは read-heavy な内部ツール画面として作る

## 10. 注意点

- `local_exports/` は生成物なので commit しない
- repo には今回の移行と無関係な未整理変更があるので巻き込まない
- 既存未コミット変更は勝手に revert しない
- secret は repo に書かない
- `.streamlit/secrets.toml` だけでは PostgreSQL 直結情報は足りない

## 11. 他の AI に渡すときの短い要約

この repo は `migration/budibase-phase1` 上で、Supabase の Phase 1 additive migration は適用済み。
`products` に services 系 111 件を投入済みで、`sales_enriched_v.unmatched_master = 0` まで確認済み。
主要な DB オブジェクトは `product_aliases`, `sales_enriched_v`, `sales_daily_summary_v`, `sales_product_summary_v`。
DB 反映は `inventory/supabase_phase1_additive.sql` と `supabase/migrations/20260328173000_phase1_additive.sql` が source of truth。
実運用では `scripts/export_unmatched_sales_candidates.py` -> `scripts/import_products_from_csv.py` -> `scripts/import_product_aliases_from_csv.py` の順で未一致解消を回している。
Budibase は datasource と `/sales` 画面の途中まで作ったが、今後は Next.js (App Router) + Supabase + Supabase Auth に切り替える前提。

## 12. 関連ファイル

- `docs/app_migration/next_ai_handoff_2026-03-30.md`
- `docs/app_migration/handover_log.md`
- `inventory/supabase_phase1_additive.sql`
- `inventory/supabase_phase1_verify.sql`
- `supabase/migrations/20260328173000_phase1_additive.sql`
- `scripts/export_unmatched_sales_candidates.py`
- `scripts/import_products_from_csv.py`
- `scripts/import_product_aliases_from_csv.py`
