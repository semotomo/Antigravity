# 棚卸し・在庫管理 Phase 4 確定・現在庫・訂正・印刷

> 実施日: 2026-08-24
> 状態: 本番DB適用・検証完了。Git push、Vercel deployは未実施。

## 実装範囲

- managerだけが理由を入力して商品を停止・解除できる。DB RPCは対象を`store_id + JAN`で再照合し、操作履歴をappend-onlyで保存する。
- `inventory_product_settings.manually_inactive`をPOS同期より優先する。停止後も開始済み棚卸しsnapshotの明細は削除せず、実物数量を入力できる。
- 除外は未棚卸しと区別し、理由、操作者、時刻、変更履歴を保存する。
- 確定前はPOS snapshotを固定して読み取りpreviewを行う。未入力、JAN未照合、同分の曖昧な売上がある場合は確定を拒否する。
- 確定だけがtransaction内で`inventory_balances`を再生成する。同じsnapshotを使う再計算は既存fingerprintと冪等処理を利用する。
- 確定後の実在庫数訂正と符号付き手動調整はmanager限定、理由必須、監査追記、楽観ロックまたは冪等キー付きとする。
- 現在庫画面は、確定数、販売、返品、移動入、移動出、物品使用、調整、計算時点を表示する。マイナス在庫と設定閾値を超えた調整を警告する。
- 印刷は認証済み専用画面で全件を取得し、A4横、ヘッダー反復、記入用と計算結果用、カテゴリ・仕入れ先・棚番号・商品名ソートを提供する。

## 二重減算を防ぐ境界

在庫は差分加算ではなく、商品ごとの`counted_at`から固定POS snapshot、店舗移動、物品使用、手動調整を再集計して上書きする。POS在庫数は参照しない。販売と返品は別集計後に相殺し、店舗移動は`from_store_id`を減算、`to_store_id`を加算する。

同じ分に計数とPOS売上が存在する場合は前後関係を決められないため自動計算せず、確定前問題として表示する。再計数で`counted_at`を更新するか、履歴側の時刻精度を改善してから再previewする。

## 本番適用資料

- migration: `supabase/migrations/20260824090000_inventory_phase4_management.sql`
- 読み取り専用preflight: `docs/inventory_management/phase4_preflight.sql`
- 適用後監査: `docs/inventory_management/phase4_postapply.sql`
- rollback付き実DB検査: `docs/inventory_management/phase4_runtime_test.sql`
- 非破壊の緊急機能rollback: `docs/inventory_management/phase4_rollback.sql`
- JSON論理backup: `tests/backup_inventory_phase4.mjs`（出力先`local_exports/`はGit対象外）

本番適用前に対象テーブルをJSON論理backupし、migration dry-runがPhase 4の1件だけであることを確認する。適用後はpostapply、runtime test、DB lintを実行してからGit pushとVercel Previewへ進む。

### 2026-08-24 本番前確認

- linked dry-run: 未適用は`20260824090000_inventory_phase4_management.sql`の1件、seed・role差分0件。
- 読み取りpreflight: Phase 4未適用、JAN欠損0、店舗内JAN重複0、待機lock 0。
- 既存在庫データ: store 6のdraft 1件、明細2,764件（入力0、除外0）。確定session、balance、adjustmentはいずれも0件。
- JSON論理backup: `local_exports/inventory-phase4-2026-08-23T16-07-32-333Z.json`、4,128,564 bytes、SHA-256 `f441dd1be417797ea5c0535d158248878e920a339ddf4fdb4cabd367775b273f`。checksumファイルを同じ場所へ保存済み。
- Phase 4 migrationは既存draft/session itemを削除・更新しない。追加column、監査table、RPC、triggerだけを追加する。

### 本番DB適用結果

- `20260824090000_inventory_phase4_management.sql` 1件だけを本番適用。
- migration履歴はlocal/remote 18/18一致。
- 7 RPCすべて`SECURITY DEFINER`、空search path、authenticated実行可、anon実行不可。
- `inventory_product_status_changes`はRLS/FORCE RLS有効、追加4列と4 triggerを確認。
- rollback付きruntime testは`phase4_runtime_test_passed`。商品停止/解除、store 6越境拒否、preview非更新、確定、訂正、調整冪等性、overview、印刷データを確認。
- public/private DB lintはschema error 0件。
- runtime test後のstore 7 session・停止履歴・調整・balanceは0件で、全変更がROLLBACK済み。
- 既存store 6 draft 1件・2,764明細は適用前後で一致。

## 承認ゲート

次はまだ実行しない。

1. [x] 本番対象データの論理backup。
2. [x] Phase 4 migration 1件の本番適用。
3. [x] rollback付きruntime testとDB lint。
4. [ ] Git commit/push、Vercel Preview、Production deploy。

対象migration、差分統計、検証結果を提示し、ユーザー承認後に上記を順番に実施する。
