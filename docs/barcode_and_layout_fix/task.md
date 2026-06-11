# タスクリスト (Task List) - バーコードリアルタイム表示 ＆ 店舗間移動の8列スリム化・編集機能

本ドキュメントは、商品マスタにおけるJANコードのバーコード切り替え表示機能の実装、および店舗間移動画面の8列化・余白詰め・編集機能追加に関する進捗管理ToDoリストです。

---

## 📅 進捗状況

- `[ ]` 依存ライブラリの導入
  - `[ ]` `jsbarcode` のインストールおよび型定義の確認
  - `[ ]` ローカル開発環境でのコンパイルチェック
- `[ ]` 店舗間移動のサーバー処理追加
  - `[ ]` `next_app/app/actions/transfers.ts` への `updateTransferAction` の追加
- `[ ]` 編集用モーダルの作成
  - `[ ]` `next_app/components/transfers/TransferEditModal.tsx` の新規作成
  - `[ ]` 編集および削除（deleteActionの連携）機能の実装
- `[ ]` 店舗間移動画面の8列化 ＆ レイアウト修正
  - `[ ]` `next_app/components/transfers/TransfersBoard.tsx` の修正
  - `[ ]` テーブル列を **8列** に再構成
  - `[ ]` 店舗列の余白詰め（最小幅の縮小）
  - `[ ]` 区分列を一番右端へ移動、操作列に「編集」ボタンを設置
  - `[ ]` 画面外へのはみ出しがなくなり、綺麗に伸縮するかの検証
- `[ ]` バーコード表示トグルコンポーネントの作成
  - `[ ]` `next_app/components/ui/BarcodeToggle.tsx` の新規作成
  - `[ ]` クリックでのトグル表示 state 管理の実装
  - `[ ]` `jsbarcode` を用いた高精度SVGバーコード生成ロジックの実装
- `[ ]` 商品マスタへの統合
  - `[ ]` `next_app/components/products/ProductsBoard.tsx` での `BarcodeToggle` のインポートと DataTable への組み込み
- `[ ]` 検証とデプロイ
  - `[ ]` `npm run build` によるビルドチェックのパス
  - `[ ]` 変更ファイルの Git ステージング・コミット・プッシュ（本番デプロイ）
  - `[ ]` 完了報告書（`walkthrough.md`）の作成
