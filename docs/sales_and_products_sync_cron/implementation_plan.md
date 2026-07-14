# 商品マスタ・売上データの自動同期（定期実行）の実装計画

商品マスタ同期（週1回自動）と売上データ取込（1日1回自動）を、深夜の指定時間に自動で定期実行できるようにするため、セキュアなAPIエンドポイントを新規作成し、Vercel Cron のスケジュールを設定します。

また、取込データが0件の場合でも画面上の「最終同期」「最終取込」時間が正しく実行時の日時に更新されるよう、データベースに同期履歴管理用テーブルを新設し、実行日時の記録を行います。

## ユーザーレビューが必要な事項

- **環境変数の再利用**:
  すでに設定済みのセキュリティトークン用の環境変数 **`CRON_SECRET`** をそのまま使用して認証を行います。ユーザー様での新たな環境変数の追加作業は不要です。

- **定期実行スケジュールの構成 (JST 日本時間)**:
  - **売上データ取込**: 毎日 午前3:30 (負荷分散のため、生体同期の午前4:00から30分前倒し)
  - **商品マスタ同期**: 毎週日曜日 午前3:00 (負荷が高いため、週に1回、休日の深夜帯に設定)

- **データベースマイグレーションの追加**:
  - `sync_history` テーブルを新規作成して同期処理の実行日時を保存します。

---

## Proposed Changes (提案する変更内容)

### 1. データベースマイグレーション
#### [NEW] [20260714151000_add_sync_history.sql](file:///C:/Users/kirik/Desktop/Antigravity/supabase/migrations/20260714151000_add_sync_history.sql)
- `sync_history` テーブルを作成します。
- レコードとして `sales_import`（売上取込）と `products_sync`（商品同期）の履歴領域を用意します。

### 2. 同期APIエンドポイントの修正 (履歴の書き込み)
#### [MODIFY] [route.ts (マスタ同期 API)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/api/cron/products/sync/route.ts)
#### [MODIFY] [route.ts (売上取込 API)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/api/cron/sales/import/route.ts)
#### [MODIFY] [route.ts (手動マスタ同期 API)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/api/gas/sync-products/route.ts)
#### [MODIFY] [route.ts (手動売上取込 API)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/api/gas/trigger/route.ts)
- 各同期処理が `success: true` で正常終了した際、`sync_history` テーブルの該当行の `last_synced_at` を `NOW()` に更新する処理を追加します。

### 3. スケジュール定義の追加
#### [MODIFY] [vercel.json](file:///C:/Users/kirik/Desktop/Antigravity/next_app/vercel.json)
- `vercel.json` に新設する2つの Cron パスと時間スケジュール（UTC表記）を追記します。
  - `/api/cron/sales/import` -> `30 18 * * *` (毎日午前3:30 JST)
  - `/api/cron/products/sync` -> `0 18 * * 0` (毎週日曜日午前3:00 JST)

### 4. 画面への最終同期日時の表示追加と読み込み
#### [MODIFY] [page.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/(dashboard)/sales/page.tsx)
- `products` や `sales_enriched_v` からではなく、新設された `sync_history` テーブルから `sales_import` と `products_sync` の最終実行時間を取得して画面に表示するように修正します。

---

## Verification Plan (検証計画)

### 1. 型チェック
- `npx tsc --noEmit` を実行し、すべての新規ファイルや修正箇所に TypeScript の型エラーがないことを検証します。

### 2. 動作確認（手動実行テスト）
- デプロブ完了後、Vercel管理画面の「Cron」タブから新設された2つの Cron ジョブ（`Run`ボタン）を実行し、エラーなく `200 (Success)` が返ること、および画面の最終同期日時が秒単位で正しく更新されることを確認します。
