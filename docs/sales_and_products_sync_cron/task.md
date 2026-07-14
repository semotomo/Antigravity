# 商品マスタ・売上データの自動同期（定期実行）のタスクリスト

- [x] データベースの設定
  - [x] `supabase/migrations/20260714151000_add_sync_history.sql` を新規作成し、同期履歴テーブルを定義
- [x] APIエンドポイントの実装と修正
  - [x] `next_app/app/api/cron/products/sync/route.ts` を新規作成し、Bearer トークン検証、商品マスタ同期の呼び出し、同期成功時の履歴書き込みを実装
  - [x] `next_app/app/api/cron/sales/import/route.ts` を新規作成し、Bearer トークン検証、現在年月の自動判定、売上データ取込の呼び出し、同期成功時の履歴書き込みを実装
  - [x] 手動同期API (`next_app/app/api/gas/sync-products/route.ts`, `next_app/app/api/gas/trigger/route.ts`) に対し、同期成功時の履歴書き込み処理を追加
- [x] 定期実行スケジュール（Cron）の設定
  - [x] `next_app/vercel.json` を更新し、マスタ同期（週1回日曜日午前3:00）と売上取込（毎日午前3:30）のスケジュールを追加
- [x] UI表示の追加と修正
  - [x] `next_app/app/(dashboard)/sales/page.tsx` を修正し、`sync_history` テーブルから最新の最終同期日時と最終取込日時を取得し、各同期ボタンの近くに小さく日本時間（JST）で表示する
- [x] 検証
  - [x] `npx tsc --noEmit` を実行して型エラーがないかチェック
- [x] リリース
  - [x] docsフォルダおよび修正コードを Git コミット・プッシュし本番反映
