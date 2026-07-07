# 生体価格の値下げ表記対応のタスクリスト

- [x] DBマイグレーション定義の作成
  - [x] `supabase/migrations/20260707141000_add_pet_price_text.sql` を作成
  - [x] Supabase 管理画面（SQL Editor）でSQLコマンドを実行して本番DBを拡張
- [x] 型定義ファイルの更新
  - [x] `next_app/lib/types/database.ts` に `price_text` カラムの型定義を追加
- [x] 同期アクションの修正
  - [x] `next_app/lib/actions/petsSync.ts` で価格テキストのHTMLタグ除去・改行維持および格納処理を追加
  - [x] 価格数値の抽出処理において、最も後ろの金額（値下げ価格）を優先的に採用するロジックに変更
- [x] 詳細UIの改修
  - [x] `next_app/components/pets/PetDetailModal.tsx` で `price_text` を改行維持（whitespace-pre-line）で表示するロジックを実装
- [x] 検証
  - [x] `npx tsc --noEmit` を実行して型エラーがないかチェック
  - [x] 手動再同期を実行し、生体 `126152` などの値下げ価格表示をUI上で動作確認
- [x] リリース
  - [x] docsフォルダおよび修正コードを Git コミット・プッシュし本番反映
