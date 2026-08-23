# 棚卸し・在庫管理 Phase 1: DBスキーマと店舗権限

> 作成日: 2026-08-23
> 状態: **本番DB適用・初期権限登録・実DB検証完了**
> migration: `supabase/migrations/20260823163000_inventory_phase1_schema.sql`

## 1. Phase 1の到達点

- 本店 `store_id=7` とわんわん `store_id=6` の権限境界を、画面CookieやJWTのユーザー編集可能なmetadataではなくDB管理表へ置いた。
- 棚卸し下書き、商品別計数時刻、数量変更監査、理由付き調整、POS履歴snapshot、再計算run、現在庫投影の土台を追加した。
- 商品参照は `product_id + store_id + jan_snapshot` の複合外部キーで固定し、別店舗の商品ID/JANを混ぜた行をDBが拒否する。
- `counted_quantity IS NULL` を未棚卸し、`counted_quantity = 0` を棚卸し済み在庫0として区別した。
- POSが持つ在庫数を保存・参照する列は作っていない。
- 監査履歴、手動調整、POS snapshot、計算runは更新・削除・TRUNCATEをtriggerで拒否する。
- `authenticated` / `anon`の新規テーブルへの直接DMLを許可していない。書込み用RPCはPhase 2で追加する。

本migrationは既存データを更新せず、`user_store_access`も自動投入しない。現在のログインユーザーと店舗の対応は対象UUIDと差分を別提示し、承認後に独立したtransactionで5行を登録した。

## 2. 権限モデル

### 2-1. 正本

`public.user_store_access (user_id, store_id, role)`を唯一の店舗認可データとする。

- 許可店舗は6または7だけ。
- roleは`manager`、`staff`、`viewer`だけ。
- ユーザーは自分の対応行だけSELECTでき、直接INSERT/UPDATE/DELETEできない。
- `private.can_access_store(store_id, roles)`がRLSから対応表を参照する。
- helperは`SECURITY DEFINER SET search_path=''`、完全修飾テーブル名を使用し、`PUBLIC`と`anon`の実行権限をrevokeする。
- `raw_user_meta_data`、`user_metadata`、`current_store_view` Cookieは認可に使用しない。

### 2-2. 新規テーブルの権限

- 全10テーブルでRLSを`ENABLE`かつ`FORCE`する。
- `authenticated`は、明示された店舗のSELECTだけ可能。
- `anon`はSELECT/DMLとも不可。
- `authenticated`の直接DMLも不可。
- Phase 2の変更操作は、認証・店舗再認可・入力検証・楽観ロックを一つのDBトランザクションで行う限定RPCとして追加する。
- `service_role`はサーバー専用とし、ブラウザへ公開しない。追記テーブルは`SELECT, INSERT`だけに絞り、`GRANT ALL`しない。

既存の`products`、`transfers`、`realtime_history_cache`等のRLSやgrantはPhase 1では変更していない。既存GAS/APIを壊さず、在庫機能の境界から先に閉じるためである。

## 3. テーブル構成

| テーブル | 正本/投影 | 主な責務 |
|---|---|---|
| `user_store_access` | 正本 | ユーザーと許可店舗・roleの対応 |
| `inventory_sessions` | 正本 | 店舗別のdraft/finalizing/finalized/cancelled状態 |
| `inventory_session_items` | 正本 | 商品snapshot、物理数量、商品別`counted_at`、理由付き除外 |
| `inventory_count_changes` | 追記監査 | 初回、追加、置換、確認、確定後訂正、除外/復帰の変更前後 |
| `inventory_adjustments` | 追記正本 | 理由必須の手動増減。取消は反対符号の行を追加 |
| `inventory_product_settings` | 設定 | 棚番号、印刷順、差異閾値 |
| `pos_inventory_snapshots` | 追記正本 | POS取得範囲、取得結果hash、成功/失敗、行数 |
| `pos_inventory_snapshot_rows` | 追記正本 | POS行順、署名と出現順、販売/返品種別、照合結果 |
| `inventory_calculation_runs` | 追記監査 | 使用session/snapshot、入力fingerprint、未照合/曖昧/重複件数 |
| `inventory_balances` | 再構築可能な投影 | 商品別の計算内訳と現在庫。再計算時に上書き |

### 3-1. 店舗越境を拒否する制約

- `products`へ`UNIQUE (id, store_id, jan_code)`を追加する。
- itemは`FOREIGN KEY (session_id, store_id)`で同じ店舗のsessionだけを参照する。
- itemは`FOREIGN KEY (product_id, store_id, jan_snapshot)`で同じ店舗・同じJANの商品だけを参照する。
- `UNIQUE (session_id, store_id, jan_snapshot)`で同じ棚卸しへの二重商品登録を拒否する。
- count change、adjustment、snapshot row、calculation run、balanceにもstoreを含む複合外部キーを置く。
- 各在庫テーブルの`store_id`は6または7だけを許可する。

停止商品を拒否する制約は置いていない。店舗とJANが一致すれば、`products.is_active=false`でも実物を計数できる。

### 3-2. 営業中の数量入力

- 初回・置換では数量と`counted_at`を同時に保存する。
- 追加では元の`counted_at`を維持し、操作時刻と変更前後を`inventory_count_changes`へ追加する。
- `0`は数量入力済みとして時刻・操作者を必須にする。
- 未入力は数量・時刻・操作者がすべてNULL。
- 除外は数量をNULLにし、除外時刻・操作者・空でない理由を必須にする。
- session/item/settings/balanceは`row_version`をUPDATEごとに増やし、Phase 2で複数端末の競合検出に使用する。

### 3-3. 二重減算を防ぐ構造

現在庫の投影には次のCHECKを置いた。

```text
calculated_quantity
= physical_quantity
- sales_quantity
+ return_quantity
+ transfer_in_quantity
- transfer_out_quantity
- usage_quantity
+ adjustment_delta
```

- POS取得結果はsnapshot単位で固定し、同一内容行も`signature_hash + signature_ordinal`で行順どおり保持する。
- 安定POS取引IDがない間は、異なるsnapshot同士を合算しない。
- 計算は常に一つのsessionと一つのsnapshotを入力にし、`source_fingerprint`で同じ入力を識別する。
- 前回の現在庫へ差分を足し引きせず、商品別の物理計数時刻から全履歴を再集計して`inventory_balances`を上書きする。
- POS安定取引IDが将来取得できる場合のため、snapshot rowにnullableな`source_event_id`を用意する。

実際の販売/返品、移動入/出、物品使用の再集計ロジックと、同分時刻境界の確認処理はPhase 2でテスト先行実装する。

## 4. ロックと適用影響

migrationの大半は新規schema/table/index/policy/functionの追加で、既存業務データを更新しない。

既存テーブルへ行う変更は`products`の`UNIQUE (id, store_id, jan_code)`追加だけである。制約作成時に`products`へロックと全行検査が発生し得る。現在の商品数は約6,500件で長時間は想定しにくいが、本番適用は利用の少ない時間に行い、直前に重複・NULL・実行中同期を再確認する。

Phase 1適用直後はアプリから新規テーブルへ書き込まないため、既存画面の挙動は変えない。

## 5. 本番適用前チェック

1. main側の既存未コミット差分が今回のcommit候補へ入っていないことを確認する。
2. remote migration履歴とProduction deployment状態を再確認する。
3. `products (id, store_id, jan_code)`のNULL/重複、商品同期中でないことを確認する。
4. schema、対象テーブル、policy、function、grantのSQL全文をユーザーへ提示する。
5. 対象データbackup、schema snapshot、既存`products`制約一覧・件数を保存する。
6. ロック影響の少ない時間帯を選び、migration 1件だけを適用する。
7. テーブル/RLS/FORCE RLS/policy/grant/複合FK/append-only triggerを実DBで検証する。
8. store 6だけのテストユーザーでstore 7 SELECT/DMLが拒否されることを確認する。
9. 承認済みのUUIDだけを`user_store_access`へ別操作で登録する。

本番migration適用、権限行登録、Git pushはこのPhase 1ローカル作業には含めない。

### 5-1. 2026-08-23の本番前snapshot

- Supabase物理backup: 0件、PITR無効。物理復旧点がないため、確認なしに本番適用しない。
- 対象データ論理backup: `local_exports/product-store-split-2026-08-22T20-09-41-489Z.json`
  - products 6,544件、product_aliases 0件、customer_orders 1件
  - 3,179,319 bytes
  - SHA-256 `9fdbfe349555ac917f398b6065e76929059152ee689acb00bd68eae292a29a6e`
- remote public schema型snapshot: `local_exports/public-schema-types-2026-08-22T20-10-56-745Z.ts`
  - SHA-256 `34e3d75dd8712d93beae0092ca46041ef74380e965815d956c59d8aaeda08a1e`
- 商品前提: JAN欠損0、不正store 0、商品ID重複0、`store_id + JAN`重複0。
- remote DB lint: エラー0。
- Production deployment: HEAD `2cc0b3f`と一致し成功。

型snapshotは完全な`pg_dump`の代替ではない。既存migration、型snapshot、対象データbackup、空テーブル限定rollbackを組み合わせて今回の加算型変更を保護する。完全な論理backupが必要な場合は、Postgres client/Dockerを用意して`supabase db dump`を別途実行する。

読み取り監査と緊急rollbackは次のファイルへ固定した。

- `docs/inventory_management/phase1_preflight.sql`
- `docs/inventory_management/phase1_rollback.sql`

## 6. ロールバック方針

本番適用後、Phase 2のデータ投入前に問題が見つかった場合だけ、次の逆依存順で戻す。

1. `inventory_balances`
2. `inventory_calculation_runs`
3. `pos_inventory_snapshot_rows`
4. `pos_inventory_snapshots`
5. `inventory_adjustments`
6. `inventory_count_changes`
7. `inventory_product_settings`
8. `inventory_session_items`
9. `inventory_sessions`
10. `user_store_access`
11. Phase 1のprivate helper/trigger function
12. `products_id_store_id_jan_code_key`

`private` schemaは他用途がないことを確認できた場合だけ最後に削除する。Phase 2以降に棚卸しデータが入った後はDROPで戻さず、forward migrationで修復する。データ削除を伴うrollbackは必ず対象件数とbackupを確認して別承認を得る。

## 7. 2026-08-23の検証結果

| 検証 | 結果 |
|---|---|
| rejection-first | migration作成前は7/7失敗（ファイル不存在） |
| Phase 1 schema/preflight/rollback test | 9/9成功 |
| Phase 1を含む商品分離・履歴cache・GAS契約・移動画面等の関連回帰 | 35/35成功 |
| Supabase linked dry-run | 成功。適用候補は本migration 1件だけ、seed/role混入0件 |
| TypeScript `tsc --noEmit` | 成功 |
| Next.js production build | Webpack modeで成功、全19 static pages生成成功 |
| ESLint | 既存コードの4 error / 4 warningで失敗。Phase 1 SQL/testに起因する指摘なし |
| 本番preflight | PASS。migration 13件、商品6,544件、JAN欠損・不正store・重複・衝突・競合lockがすべて0件 |
| 本番migration | `20260823163000`を適用。適用後のlocal/remote migrationは14/14一致 |
| 本番postapply | PASS。10テーブル、RLS/FORCE RLS、権限helper、所有マーカー付きproducts制約を確認 |
| 初期店舗権限 | 5行。store 7専用1名、store 6・7共通2名、全てmanager |
| RLS実DB確認 | 3アカウント全てPASS。store 7専用アカウントからstore 6は拒否、直接UPDATEも拒否 |
| Supabase DB lint | `extensions` / `private` / `public`にschema errorなし |
| スマホ/印刷preview | Phase 1はUI変更なし。Phase 3/5で実施 |

標準Turbopack buildは、隔離worktreeからメイン側`node_modules`を参照する一時ジャンクションを「filesystem root外」として拒否した。依存本体を変更せずWebpack modeでproduction buildを完走し、検証後にジャンクションと`.next`を削除した。

既存Lint errorは次のファイルにあり、今回の差分へ混ぜず未変更のままとした。

- `next_app/app/api/sales/trends/route.ts`: `prefer-const`
- `next_app/components/sales/BarcodeScannerModal.tsx`: 宣言前参照2件
- `next_app/lib/actions/petsSync.ts`: `prefer-const`
- pets画像/useEffect関連の既存warning 4件

## 8. 本番適用結果と次のゲート

Phase 1は次をユーザーへ提示し、論理backupで進める明示承認を得て本番適用した。

- migration全文と差分
- 追加する10テーブル、private helper、`products`の複合一意制約
- 事前backupとロック時間帯
- ロールバックSQL
- 初期`user_store_access`へ登録するユーザーUUID・店舗・role

2026-08-23にユーザーがSupabase DashboardのAuthユーザー一覧を確認し、次の5行を初期権限として確定した。

- `kennel_honten@…`: store 7 / manager
- `kirikan22@…`: store 6・7 / manager
- `testtest1234@…`: store 6・7 / manager
- わんわん専用アカウント: 未作成。作成後にstore 6だけを別途追加する。

UUIDとメールを含む実行用seedはversion controlへ混入させず、ignoredの`local_exports/phase1-access-seed-confirmed-2026-08-23.sql`へ保存した。実行時に3件のUUID・メール一致、期待する5権限行、想定外権限0件を同一transactionで検証し、5行の登録に成功した。

Phase 1ではGAS/Vercel変更、commit/pushを行っていない。Phase 2以降の本番変更も対象と差分を確認して別承認を得る。
