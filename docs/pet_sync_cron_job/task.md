# 1日1回自動同期（定期実行）のタスクリスト

- [x] APIエンドポイントの実装
  - [x] `next_app/app/api/cron/sync/route.ts` を新規作成し、Bearer トークン検証と `syncPetsData` 呼び出しロジックを記述
- [x] 定期実行トリガーの設定
  - [x] `next_app/vercel.json` を新規作成し、Vercel Cron 用のスケジュールを定義
  - [x] `docs/pet_sync_cron_job/gas_trigger_sample.js` を作成し、GASから呼び出す場合のコードサンプルを用意
- [x] 検証
  - [x] `npx tsc --noEmit` を実行して型エラーがないかチェック
- [x] リリース
  - [x] docsフォルダおよび修正コードを Git コミット・プッシュし本番反映
