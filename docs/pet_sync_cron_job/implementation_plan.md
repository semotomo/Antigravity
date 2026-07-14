# 1日1回自動同期（定期実行）の実装計画

生体情報の同期（最新情報の取得）を毎日1日1回、深夜などの指定時間に自動で定期実行できるようにするため、セキュアなAPIエンドポイントを新設し、定期実行スケジュールを設定します。

## ユーザーレビューが必要な事項
- **環境変数の追加**:
  本番のデプロイ環境（Vercel等）の管理画面に、セキュリティトークン用の環境変数 **`CRON_SECRET`**（任意の推測困難な長い文字列）を追加していただく必要があります。
  > [!IMPORTANT]
  > APIキーの保護のため、環境変数 `CRON_SECRET` を未設定のままにすると、APIは不正アクセス防止のためエラーを返します。

---

## Proposed Changes (提案する変更内容)

### 1. APIエンドポイントの新設
#### [NEW] [route.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/api/cron/sync/route.ts)
- `GET` リクエストを受け取り、ヘッダーの `Authorization: Bearer <CRON_SECRET>` トークンを検証します。
- トークンが一致した場合、サーバーアクション `syncPetsData('quick')`（最新情報の差分同期）を実行し、結果をJSONで返します。

### 2. 定期実行スケジュールの設定
#### [NEW] [vercel.json](file:///C:/Users/kirik/Desktop/Antigravity/next_app/vercel.json)
- Vercel Cron 用の設定ファイルを配置します。
- 毎日午前4時（JST）に `/api/cron/sync` を自動で叩くように cron スケジュール（`0 19 * * *` ※UTC表記）を定義します。

#### [NEW] [gas_trigger_sample.js](file:///C:/Users/kirik/Desktop/Antigravity/docs/pet_sync_cron_job/gas_trigger_sample.js)
- Vercel環境以外でホストしている場合に備え、Google Apps Script (GAS) の時間主導型トリガーから API をセキュアに叩くためのスクリプトサンプルをドキュメントとして作成します。

### 3. 認証ミドルウェアの定期実行API除外設定
#### [MODIFY] [proxy.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/proxy.ts)
- `matcher` に `api/cron` を追加し、自動同期APIを呼び出した際にミドルウェア処理が起動しないように除外します。

#### [MODIFY] [middleware.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/supabase/middleware.ts)
- `updateSession` 内でリクエストパスが `/api/cron` から始まる場合は、認証判定（ログインチェック）をスルーして直接処理を通す安全ロジックを追加します。

---

## Verification Plan (検証計画)

### 1. 型チェック
- `npx tsc --noEmit` を実行し、ミドルウェアや新規APIに TypeScript のビルド型エラーがないことを確認します。

### 2. ローカル動作検証
- APIに正しい Bearer トークンを送った際に同期が正常に走り、不正なトークンやトークン無しの場合に `401 Unauthorized` が返り、ログイン画面への `307` リダイレクトが発生しないことを検証します。
