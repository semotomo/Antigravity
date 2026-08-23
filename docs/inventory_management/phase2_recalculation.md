# 棚卸し・在庫管理 Phase 2 再計算コア

> 実施日: 2026-08-23
> 状態: 完了（本番DB・Git main・Vercel Production反映済み）

## 結論

POS在庫数や前回の計算結果へ差分を継ぎ足さず、各商品の`counted_at`から指定時刻までの履歴を毎回全量再集計して`inventory_balances`を上書きする方式を実装した。

```text
現在庫 = 実在庫数
       - 販売 + 返品
       + 店舗移動入 - 店舗移動出
       - 物品使用
       + 手動調整
```

同じPOS snapshotを再実行した場合は同じ`source_fingerprint`と既存runを再利用する。別snapshotとして再同期した場合も、既存残高への加減ではなく物理計数から再生成するため二重減算しない。

## 時刻境界

- 数量入力時のサーバー時刻を商品別`counted_at`として扱う。
- POS日時は`yyyy/MM/dd HH:mm`をJSTの分精度として厳密に解釈する。存在しない日付は現在時刻へ補正せず拒否する。
- POSと計数が同じ分の販売・返品は自動反映せず`ambiguous_row_count`へ送る。
- POS以外の移動・使用・調整は、各行の秒精度時刻が`counted_at`より後かつ`calculated_as_of`以下の場合だけ反映する。
- POSの`注文`と意味未確定の`調整`は計算へ入れない。

## 店舗境界

- APIとServer Actionは`storeId`を6/7だけに限定し、`auth.getUser()`後に`user_store_access`の`manager`/`staff`を毎回確認する。
- 5つの書込みRPCも`auth.uid()`と`private.can_access_store`を再確認する。
- POS snapshot保存時、クライアントから`matched_product_id`を受け取らない。DBが`products.store_id = p_store_id AND products.jan_code = POS JAN`で解決する。
- POS履歴はGASから直接取得する。店舗移動を混ぜた表示用`realtime_history_cache`は在庫計算の正本にしない。
- 移動は同一JANでも対象店舗が移動元なら出、移動先なら入、物品使用は移動元だけを減算する。

## POS snapshotと監査

- 同内容行を重複排除しない。8項目由来の`signature_hash`ごとに`signature_ordinal`を1, 2, ...と採番して全行を保存する。
- JANなし、商品なし、曖昧JAN、対象外作業種別を`match_status`で区別する。
- snapshot、計算run、入力・調整履歴は正本として追記する。
- `inventory_balances`だけを再生成可能な投影としてUPSERTする。除外へ変わった同一sessionの商品は投影から外すが、棚卸し入力、POS snapshot、run、調整履歴は削除しない。
- `source_fingerprint`は商品入力、POS snapshot行、移動、調整、計算基準時刻からDB内でSHA-256生成する。

## DB関数

| RPC | 役割 |
|---|---|
| `get_inventory_recalculation_context` | 認可済みsessionの最古計数時刻と進捗を返す |
| `save_inventory_pos_snapshot` | POS行を保存し、`store_id + JAN`をDB解決する |
| `record_inventory_pos_snapshot_failure` | 失敗理由をsnapshot監査へ残す |
| `recalculate_inventory_session` | advisory lock内で全量再集計しbalanceを上書きする |
| `finalize_inventory_session` | row version、未入力、未照合、同分曖昧を検査し、再計算と確定を1 transactionで行う |

すべて`SECURITY DEFINER SET search_path = ''`とし、`PUBLIC`/`anon`の実行権を明示的に剥奪して`authenticated`だけへ付与する。テーブルへのauthenticated直接DMLはPhase 1どおり許可しない。

## アプリ経路

- `POST /api/inventory/recalculate`
  - 同一origin
  - JSON/UUID/store検証
  - Supabase session検証
  - DB店舗権限検証
  - POS直接取得 → 正規化 → 1 snapshot保存 → 1回の全量再計算
- `recalculateInventoryAction`
  - 同じ入力検証・session・店舗権限・同期serviceを再利用する

確定画面と確定Actionの公開はPhase 4、棚卸しsession/itemの作成・数量入力RPCとUIはPhase 3で接続する。

## 適用とrollback

- 機能migration: `supabase/migrations/20260823213000_inventory_phase2_functions.sql`
- DB lint修正migration: `supabase/migrations/20260823223000_inventory_phase2_recalc_lint_fix.sql`
- 読み取りpreflight: `docs/inventory_management/phase2_preflight.sql`
- 適用後監査: `docs/inventory_management/phase2_postapply.sql`
- rollback付き実DBテスト: `docs/inventory_management/phase2_runtime_test.sql`
- rollback: `docs/inventory_management/phase2_rollback.sql`

初回適用後のDB lintで、`recalculate_inventory_session`内の一時テーブルをPL/pgSQL linterが解決できないエラーを検出した。検査を弱めず、一時テーブルを使わない同等の直接UPSERTへ置換するforward migrationを追加適用し、再lintを0件にした。rollbackはPhase 2の5 RPCだけを除去し、Phase 1テーブル、snapshot、計算run、balanceを削除しない。rollback、Vercel反映、Git commit/pushは差分提示後の別承認まで実施しない。

## 検証結果

| 検証 | 結果 |
|---|---|
| Phase 2 TDD | 17/17成功 |
| 関連回帰 | 59/59成功 |
| TypeScript | 成功 |
| 対象Lint | 成功 |
| 全体Lint | 既存4 error / 4 warningで失敗。Phase 2変更ファイルのerrorは0 |
| Next.js production build | 成功。`/api/inventory/recalculate`を確認 |
| Supabase migration | Phase 2機能migrationとDB lint修正migrationを本番適用。全履歴16/16一致 |
| 本番読み取りpreflight | 依存関係すべて正常、既存Phase 2 RPC 0、待機lock 0 |
| 本番postapply | 5 RPCすべて`SECURITY DEFINER`・空search path・authenticated限定。snapshot/run/balanceは0件 |
| 本番実DBテスト | `authenticated`でstore 7商品を`store_id + JAN`照合し、実在庫10−販売2=8、同一再計算run再利用、store 6越境拒否、確定を確認後に全件rollback |
| 本番DB lint | error 0件 |
| Git / Vercel | commit `b8bc1f9`をmainへpush。Vercel Preview・Productionとも成功 |

本番DB側とNext.js側のPhase 2受入条件は完了した。Productionの個別deployment URLはVercel Authenticationで保護されているため、外部curlによるアプリ内E2Eは未実施。GitHub DeploymentとVercel commit statusでProduction成功を確認した。
