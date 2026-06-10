# タスクリスト：店舗間移動8列化 ＆ バーコード表示トグル実装

- [x] 1. 店舗間移動画面 (`TransfersBoard.tsx`) の改修
  - [x] 1-1. `columns` 配列から「物品使用区分」列と「メモ」列を削除
  - [x] 1-2. 「区分」列を一番右端へ移動
  - [x] 1-3. 「店舗」列の余白（`min-w-[180px]`）を解除または極小化し、余白を詰める
  - [x] 1-4. 操作列の「削除」ボタンを「編集」ボタン（`SquarePen`）に変更し、クリック時に対象行データを `editTarget` ステートにセットする
  - [x] 1-5. 既存の `TransferEditModal` をインポートし、`editTarget` にバインドして接続
- [x] 2. バーコード表示トグルコンポーネント (`BarcodeToggle.tsx`) の新規作成
  - [x] 2-1. `next_app/components/ui/BarcodeToggle.tsx` を新規作成
  - [x] 2-2. `jsbarcode` を用いたSVGバーコード描画（EAN13/EAN8等のJAN規格、およびフォールバックとしてCODE128）を実装
  - [x] 2-3. 初期表示はJANテキスト、クリックでバーコード表示へ切り替えるトグル状態を管理
  - [x] 2-4. 不正なJANコードでのエラーをキャッチし、安全にテキスト表示に戻すエラーハンドリングを実装
- [x] 3. 商品マスタ (`ProductsBoard.tsx`) への適用
  - [x] 3-1. `ProductsBoard.tsx` に `BarcodeToggle` をインポート
  - [x] 3-2. テーブル of 「JAN」列の描画処理（`columns`）を `BarcodeToggle` に差し替え
- [x] 4. 動作検証とデプロイ
  - [x] 4-1. `npm run build` によるビルドチェックの実施
  - [x] 4-2. 修正内容の確認書 (`walkthrough.md`) の作成
  - [x] 4-3. Gitコミット＆リモートプッシュ
