# 商品マスタ・売上データの自動同期（定期実行）の実装計画

商品マスタ同期（週1回）と売上データ取込（1日1回）を、深夜の指定時間に自動で定期実行できるようにするため、セキュアなAPIエンドポイントを新規作成し、Vercel Cron のスケジュールを設定します。

## ユーザーレビューが必要な事項

- **環境変数の再利用**:
  すでに設定済みのセキュリティトークン用の環境変数 **`CRON_SECRET`** をそのまま使用して認証を行います。ユーザー様での新たな環境変数の追加作業は不要です。

- **定期実行スケジュールの構成 (JST 日本時間)**:
  - **売上データ取込**: 毎日 午前3:30 (負荷分散のため、生体同期の午前4:00から30分前倒し)
  - **商品マスタ同期**: 毎週日曜日 午前3:00 (負荷が高いため、週に1回、休日の深夜帯に設定)

---

## Proposed Changes (提案する変更内容)

### 1. 商品マスタ自動同期APIの新設
#### [NEW] [route.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/api/cron/products/sync/route.ts)
- `GET` リクエストを受け取り、`Authorization: Bearer <CRON_SECRET>` トークンを検証します。
- 認証成功時、GAS Web App に対して `mode=master` でリクエストを送信して商品マスタ同期を実行します。
- 関連する販売ページのキャッシュ再検証 (`revalidatePath`) を実行します。

### 2. 売上データ自動取込APIの新設
#### [NEW] [route.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/api/cron/sales/import/route.ts)
- `GET` リクエストを受け取り、`Authorization: Bearer <CRON_SECRET>` トークンを検証します。
- 認証成功時、実行時の日付から自動で **現在の年・月**（例: 2026年7月）を割り出します。
- GAS Web App に対して `mode=sales`、`year`、`month` をパラメータに指定して売上データ取込を実行します。
- 関連する販売ページのキャッシュ再検証 (`revalidatePath`) を実行します。

### 3. スケジュール定義の追加
#### [MODIFY] [vercel.json](file:///C:/Users/kirik/Desktop/Antigravity/next_app/vercel.json)
- `vercel.json` に新設する2つの Cron パスと時間スケジュール（UTC表記）を追記します。
  - `/api/cron/sales/import` -> `30 18 * * *` (毎日午前3:30 JST)
  - `/api/cron/products/sync` -> `0 18 * * 0` (毎週日曜日午前3:00 JST)

---

## Verification Plan (検証計画)

### 1. 型チェック
- `npx tsc --noEmit` を実行し、新規追加した API エンドポイントや定義に TypeScript の型エラーがないことを検証します。

### 2. 動作確認（手動実行テスト）
- デプロイ完了後、Vercel管理画面の「Cron」タブから新設された2つの Cron ジョブ（`Run`ボタン）を実行し、エラーなく `200 (Success)` が返ること、およびデータベースが最新情報に更新されることを確認します。
