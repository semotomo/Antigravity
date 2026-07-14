# 商品マスタ・売上データの自動同期（定期実行）のタスクリスト

- [x] APIエンドポイントの実装
  - [x] `next_app/app/api/cron/products/sync/route.ts` を新規作成し、Bearer トークン検証と商品マスタ同期の呼び出しを実装
  - [x] `next_app/app/api/cron/sales/import/route.ts` を新規作成し、Bearer トークン検証、現在年月の自動判定、売上データ取込の呼び出しを実装
- [x] 定期実行スケジュール（Cron）の設定
  - [x] `next_app/vercel.json` を更新し、マスタ同期（週1回日曜日午前3:00）と売上取込（毎日午前3:30）のスケジュールを追加
- [x] UI表示の追加
  - [x] `next_app/app/(dashboard)/sales/page.tsx` を修正し、商品マスタの最終同期日時と売上データの最終取込日時を取得し、各同期ボタンの近くに小さく表示する
- [x] 検証
  - [x] `npx tsc --noEmit` を実行して型エラーがないかチェック
- [x] リリース
  - [x] docsフォルダおよび修正コードを Git コミット・プッシュし本番反映
