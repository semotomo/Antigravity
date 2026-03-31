# 完成定義

更新日: 2026-03-28

## 1. この移行の一言定義

この移行の完成形は、

`Supabase を共通データ基盤にし、Budibase を日常業務 UI、GAS を外部連携と重い処理担当にして、Flet から段階的に運用を移すこと`

である。

## 2. 現時点での完成イメージ

直近の「完成」は、全部入りの社内基盤ではなく、まず次が成立している状態を指す。

- Supabase に実運用の正本データが集約されている
- Budibase で日常運用の主要画面が使える
- GAS が POS 連携やシフト生成結果投入を担当している
- Flet は即時廃止せず、参照元または並走手段として残る

## 3. 直近マイルストーンの Done 条件

### 3-1. データ基盤

- `stores`
- `products`
- `transfers`
- `customer_orders`
- `product_sales_data`

の既存契約を壊さずに Supabase を拡張できていること。

加えて、次が用意されていること。

- `product_aliases`
- `sales_enriched_v`
- `sales_daily_summary_v`
- `sales_product_summary_v`
- `products` の分析補助列
- `customer_orders` の互換拡張列

### 3-2. Budibase 側

少なくとも次の業務が Budibase で扱えること。

- 売上確認
  - 期間絞り込み
  - 商品別集計
  - 店舗別 / 日別確認
- 商品移動
  - 既存 `transfers` 互換、またはそれに準ずる運用
- 客注管理
  - 登録
  - 状態更新
  - 一覧確認
- シフト結果閲覧
  - GAS が投入した結果を表示できる

### 3-3. 運用

- POS 売上は GAS 経由で Supabase に入る
- Budibase は重い計算を持たず、表示 / 入力 / 更新に集中する
- Flet を止めなくても新旧運用が並走できる

## 4. 最終的な完成形

最終的には、単なる POS ダッシュボードではなく、社内オペレーション基盤になることを目指す。

対象領域:

- 売上
- 在庫
- シフト
- 客注
- 顧客
- 予約
- 見積
- 請求

完成条件:

- 顧客起点で予約 / 売上 / 客注 / 見積 / 請求を横断できる
- モジュールごとの状態、履歴、担当、期限が追える
- 業務確認がダッシュボード起点で完結する

## 5. 今回の移行で直近の完成に含めないもの

以下は有効だが、今のマイルストーンの Done 条件には含めない。

- `stores / products` の uuid への全面移行
- `transfers` の即時廃止
- `customer_orders.status` の全面再設計
- `product_sales_data` の物理列名変更
- 見積 / 請求 / 予約 / 顧客管理までの一気通貫実装
- Flet の即時停止

## 6. アーキテクチャの役割分担

### Budibase

- 社員が日常的に操作する業務画面
- 一覧 / 詳細 / 登録 / 更新 / 絞り込み

### Supabase

- 共通認証
- 共通マスタ
- 取引データ
- view と index による業務表示最適化

### GAS

- POS CSV 取得
- 売上データ投入
- シフト生成結果投入
- 必要に応じて集計再計算

### Flet

- 既存運用の参照元
- 移行中の比較対象
- 一部機能の暫定運用先

## 7. 次の実作業

1. Phase 1 用 additive SQL を適用できる形まで整える
2. 売上 view を基点に Budibase 側の売上画面を作る
3. 客注の互換拡張と在庫運用方針を確定する
4. Budibase の主要 4 領域を先に成立させる

## 8. 参照ドキュメント

- [implementation_plan.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/implementation_plan.md)
- [repo_split_strategy.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/repo_split_strategy.md)
- [phase1_sql_apply_runbook.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/phase1_sql_apply_runbook.md)
- [budibase_supabase_schema.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/budibase_supabase_schema.md)
- [schema_alignment_snapshot_2026-03-28.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/schema_alignment_snapshot_2026-03-28.md)
- [supabase_schema_checklist.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/supabase_schema_checklist.md)
- [supabase_phase1_additive.sql](/Users/kirik/Desktop/Antigravity/inventory/supabase_phase1_additive.sql)
