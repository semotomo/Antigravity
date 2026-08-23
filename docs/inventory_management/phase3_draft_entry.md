# 棚卸し・在庫管理 Phase 3 下書き・数量入力

> 実施日: 2026-08-23
> 状態: 本番DB適用・実DB検査完了（Git push・Vercel未反映）

## 現在の表示状況

現在のProductionアプリはPhase 2までのため、サイドメニューとスマホ「その他」には「棚卸し・在庫管理」がまだ表示されない。Phase 3の本番DBは適用済みだが、画面を使用するにはGit pushとNext.jsのデプロイが必要である。

## 実装内容

- PCサイドメニューとスマホ「その他」の「設定オプション」直上へ「棚卸し・在庫管理」を追加した。スマホ下部の主要タブは増やしていない。
- 店舗権限はJWT metadataや画面Cookieを正本にせず、`user_store_access`を画面・Server Action・API・DB RPCで毎回確認する。
- 店舗別に棚卸しを開始し、active下書きがあれば再開する。新規開始時は停止商品を含む対象店舗の商品だけをsnapshotする。
- 商品照合はDBで`session_id + store_id + jan_snapshot`を使い、商品masterとの結合も`product_id + store_id + JAN`をすべて一致させる。
- 一覧から数量0を含む実在庫数を入力でき、`NULL`の未入力と数量0を別表示する。
- カメラ、写真、JANコードリーダー、手入力を既存scannerで利用できる。同一商品再読取時は「追加」「数量を置き換える」「キャンセル」を表示する。
- `add`は最初の計数時刻を維持し、`replace`は商品全体を数え直した扱いで現在時刻へ更新する。各操作を`inventory_count_changes`へ追記する。
- 楽観ロックの`row_version`で複数端末の同時更新を検出し、競合時は一覧を再取得する。
- 棚卸し済み数、未棚卸し数、対象商品数、進捗率、計数時刻、停止商品、保存結果を表示する。

## DB RPC

| RPC | 役割 |
|---|---|
| `start_inventory_session` | 店舗別active下書きの再開、または商品snapshot付き新規session作成 |
| `get_inventory_workspace` | 店舗別session、進捗、検索・状態filter済み商品一覧を取得 |
| `save_inventory_count` | `store_id + JAN`とrow versionを検証し、数量と商品別計数時刻を保存 |

3 RPCはすべて`SECURITY DEFINER SET search_path = ''`とし、`PUBLIC`/`anon`を明示的に拒否して`authenticated`だけに実行を許可する。テーブルへの直接DMLは許可しない。

## 適用資料

- migration: `supabase/migrations/20260823233000_inventory_phase3_drafts.sql`
- 読み取り専用preflight: `docs/inventory_management/phase3_preflight.sql`
- 適用後監査: `docs/inventory_management/phase3_postapply.sql`
- rollback付き実DB検査: `docs/inventory_management/phase3_runtime_test.sql`
- 非破壊rollback: `docs/inventory_management/phase3_rollback.sql`

`supabase db push --linked --dry-run`で上記migration 1件だけが対象、seedとrole変更0件であることを確認して本番適用した。migration履歴はローカル・本番17/17で一致している。

## ローカル検証結果

| 検証 | 結果 |
|---|---|
| Phase 3 TDD | 13/13成功 |
| 関連回帰 | `tests/*_test.mjs` 72/72成功 |
| TypeScript | 成功 |
| 対象Lint | 成功 |
| 全体Lint | 既存4 error / 4 warningで失敗。Phase 3変更ファイルのerrorは0 |
| Next.js production build | 成功。`/inventory`と`/api/inventory/workspace`を確認 |
| Supabase linked dry-run | migration 1件のみ、書込みなし |
| 本番Supabase migration | Phase 3 migration 1件を適用。履歴17/17一致 |
| 本番postapply | 3 RPCすべて`SECURITY DEFINER`・空search path・authenticated限定・anon拒否。棚卸しデータ0件 |
| 本番実DB | 数量0、追加、置換、計数時刻、監査3行、`store_id + JAN`、store 6越境拒否を確認し全件ROLLBACK |
| 本番DB lint | error 0件 |
| スマホ実画面 | 本番アプリ未反映のため未実施。デプロイ後にメニュー配置、数量入力、dialogを実機確認する |

全体Lintの既存エラーは`app/api/sales/trends/route.ts`、`components/sales/BarcodeScannerModal.tsx`、`lib/actions/petsSync.ts`にあり、Phase 3差分へ混入させていない。

## 本番反映の安全順序

1. [x] 最終差分と対象migration 1件を確認する。
2. [x] 読み取り専用preflightを再実行する。
3. [x] 承認後にPhase 3 migrationだけを本番適用する。
4. [x] postapplyとrollback付きruntime testを実行する。
5. [ ] 結果を確認後、Git commit/pushとVercel Previewを行う。
6. [ ] Preview確認後にProductionへ反映し、PC・スマホの実画面を確認する。

現段階では手順4まで完了し、Git push・Vercel反映前で停止している。
