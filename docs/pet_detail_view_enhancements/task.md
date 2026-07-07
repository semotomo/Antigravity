# 性別色分け・ワクチン追加・値下げ価格の赤色化のタスクリスト

- [x] 性別・価格表示用のヘルパー定義の追加 (`next_app/components/pets/PetsBoard.tsx` / `PetDetailModal.tsx`)
  - [x] 性別の女の子（ピンク）、男の子（ブルー）の色分け判定処理を実装
  - [x] 価格テキスト分割・値下げ前後色分け（値下げ後赤色、値下げ前打消し線）処理を実装
- [x] 一覧画面の改修 (`next_app/components/pets/PetsBoard.tsx`)
  - [x] 詳細リスト表示で、性別色分けを反映
  - [x] 3列目にワクチン情報（`pet.vaccines`）を追加
  - [x] リッチ価格表示関数 `renderPriceText` をリスト表示部分に適用
- [x] 詳細モーダルの改修 (`next_app/components/pets/PetDetailModal.tsx`)
  - [x] モーダル内の性別表示にピンク・ブルーの色分けを適用
  - [x] モーダル内の価格表示（`price_text`）にリッチ価格表示関数 `renderPriceText` を適用
- [x] 検証
  - [x] `npx tsc --noEmit` を実行して型エラーがないかチェック
  - [x] 画面上での性別・ワクチン・値下げ価格の表示を検証・確認
- [x] リリース
  - [x] docsフォルダおよび修正コードを Git コミット・プッシュし本番反映
