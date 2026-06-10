# タスクリスト

店舗間移動・物品使用のUI改善および月次レポート印刷ボタンの移動タスク一覧です。

- [x] `TransfersBoard.tsx` の修正
  - [x] ヘッダーの「月次レポート印刷」ボタンを削除
  - [x] 期間検索フォームのボタンエリアに「月次レポート印刷」ボタンを追加
  - [x] ボタンのデザインを白背景ベース（クリアボタンと同様）に修正
- [x] `TransferFormModal.tsx` の修正（データ連携）
  - [x] `scanList` のデータ配列に、元のインデックス（`originalIndex`）または `id` を追加
- [x] `TransferFormModal.tsx` の修正（個数選択UI）
  - [x] スキャンリスト内の個数表示を `<select>` 要素に変更
  - [x] ドロップダウンで1〜100個を選択可能にし、変更時に状態更新関数を呼ぶように実装
- [x] `TransferFormModal.tsx` の修正（はみ出し防止＆スクロール化）
  - [x] カメラ起動時のモーダル高さを `h-[90vh] max-h-[90vh]` に固定
  - [x] 積み上げリスト（スキャン商品一覧）のコンテナクラスを `h-[250px] md:h-[350px] lg:h-full flex-1 lg:flex-none flex flex-col min-h-0` に修正
- [x] ビルド検証
  - [x] `npm run build` を実行してビルドが通ることを確認する
- [x] 完了報告ドキュメント作成
  - [x] `walkthrough.md` を作成する
