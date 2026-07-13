# 猫の所属店舗カテゴリIDマッピング修正のタスクリスト

- [x] 猫の店舗カテゴリID（コード）の調査
  - [x] 調査用スクリプト `next_app/check_cat_categories.mjs` を作成
  - [x] スクリプトを実行し、カテゴリIDと店舗名の対応関係を特定
  - [x] 調査スクリプトのクリーンアップ（削除）
- [x] サーバーアクションの修正
  - [x] `next_app/lib/actions/petsSync.ts` 内の `getStoreIdFromCategoryIds` に猫用カテゴリID定義を追加
- [x] 検証
  - [x] 同期を再実行し、画面上で猫の店舗バッジが正常に表示されるか動作確認
- [x] リリース
  - [x] docsフォルダおよび修正コードを Git コミット・プッシュし本番反映
