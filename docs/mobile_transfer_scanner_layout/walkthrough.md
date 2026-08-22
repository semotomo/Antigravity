# 商品移動・スマホ連続スキャン画面 改善結果

## 実装内容

- スマホの連続スキャンモーダルを`100dvh`の全画面表示に変更した。
- 「バーコード連続読み取り中」と「読み取り完了」を小型化し、完了ボタンの文言とアクセシブル名を統一した。
- 連続スキャン中はJANコード見出しを非表示にし、ヘッダーからスキャン映像までの外側余白を除去した。
- 読取結果とクールダウンの案内を11pxへ小型化した。
- 商品リストの250px固定高を廃止し、スキャン映像以外の残り領域を使用するflex構造へ変更した。
- 商品リストに`overflow-y-auto`、縦方向のタッチ操作、オーバースクロール制御、iOSの慣性スクロールを設定した。
- 通常入力と他画面のJANスキャナーは従来表示を維持した。

## 自動検証

- `node --test ../tests/mobile_transfer_scanner_layout_test.mjs ../tests/transfer_form_navigation_guard_test.mjs ../tests/product_store_separation_test.mjs`: 11件成功
- `npx tsc --noEmit`: 成功
- `npx eslint components/orders/JanCodeScannerField.tsx components/transfers/TransferFormModal.tsx`: 成功
- `npm run build`: 成功

## 本番確認

- 実装コミット`2e98826`を`origin/main`へpushした。
- GitHubとVercelの連携状態でProductionデプロイ成功を確認した。
- デプロイ固有URLはVercel認証保護対象のため、自動ブラウザによる実アカウントでのカメラ操作は未実施。スマホ実機では本番画面を再読み込みして確認する。
