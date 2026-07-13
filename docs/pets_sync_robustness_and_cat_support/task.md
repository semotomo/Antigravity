# 同期処理の堅牢化（猫の同期漏れ防止）と警告ポップアップ追加のタスクリスト

- [x] 診断一時スクリプトのクリーンアップ
  - [x] `next_app/check_species.mjs` を削除
  - [x] `next_app/simulate_sync.mjs` を削除
- [x] サーバーアクションの堅牢化・修正 (`next_app/lib/actions/petsSync.ts`)
  - [x] `fetchWithRetry` (リトライ機能付き接続関数) の実装
  - [x] すべての fetch 呼び出しを `fetchWithRetry` に置き換え
  - [x] 犬猫のループに、ブログ切り替え時の 1秒間のディレイ (`await delay(1000)`) を追加
  - [x] 各ブログ処理の末尾で、即座にバルクUpsertを実行するように変更（ブログ処理の独立化）
- [x] フロントエンドの警告ポップアップ追加 (`next_app/components/pets/PetsBoard.tsx`)
  - [x] フル同期実行前に `window.confirm` を出す確認ロジックを追加
- [x] 検証
  - [x] `npx tsc --noEmit` を実行して型エラーがないかチェック
  - [x] 画面上でのフル同期ポップアップと、犬猫両方の正常同期完了を動作確認
- [x] リリース
  - [x] docsフォルダおよび修正コードを Git コミット・プッシュし本番反映
