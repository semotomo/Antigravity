# 店舗間移動・物品使用のUI改善および月次レポート印刷ボタンの移動

店舗間移動・物品使用の新規登録におけるバーコードスキャンUIの改善、および月次レポート印刷ボタンの配置移動を行います。

## ユーザー確認事項

特になし

## 提案する変更内容

### 1. 店舗間移動ボード (Transfers Board)

「月次レポート印刷」ボタンをヘッダーから期間・店舗検索フォームの右下（「検索」「クリア」ボタンの右隣）へ移動します。
また、白い検索フォームに馴染むよう、ボタンのスタイルを白背景・グレー境界線のすっきりしたデザインに調整します。

#### [MODIFY] [TransfersBoard.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/transfers/TransfersBoard.tsx)
- ヘッダー内の「月次レポート印刷」ボタンを削除。
- 期間検索フォーム内の「クリア」ボタンの右隣に「月次レポート印刷」ボタンを追加し、スタイルを調整。

---

### 2. 店舗間移動新規登録モーダル (Transfer Form Modal)

バーコードスキャン画面において、スキャン済み商品の個数選択を可能にし、商品が多くなった際のはみ出しを防止するためのスクロール対応を行います。

#### [MODIFY] [TransferFormModal.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/transfers/TransferFormModal.tsx)
- `scanList` の `useMemo` で作成される配列要素に、元の `items` 配列のインデックス（`originalIndex`）または `unmatchedItems` の `id` を含めるように修正。
- スキャン済み商品一覧の個数表示部分（単なるテキスト）を、1〜100個を選択できるドロップダウン `<select>` に変更。
  - 値変更時に `updateItemQuantity` または `updateUnmatchedItem` を呼び出し、即座に状態へ反映。
- モーダル全体のコンテナについて、`isScannerActive` が `true` の場合でも `md:h-auto` を適用せず、高さを `h-[90vh] max-h-[90vh]` に固定。
- スキャン中の商品一覧エリアのコンテナクラスを `h-[250px] md:h-[350px] lg:h-full flex-1 lg:flex-none flex flex-col min-h-0` に修正し、はみ出しを防ぎ、個別の縦スクロールが正常に機能するように調整。

## 検証計画

### 開発ビルド検証
- `npm run build` を実行し、TypeScriptの型エラーやNext.js의 ビルドエラーがないことを確認します。

### 手動確認
- 「店舗間移動・物品使用」画面の期間検索フォーム右下に「月次レポート印刷」ボタンが移動し、正しく動作することを確認。
- 新規登録のカメラ起動時、商品をスキャンした際に個数部分をタッチしてドロップダウンから個数が変更できることを確認。
- 多数の商品をスキャンした際に、画面外にはみ出さず、スキャン商品一覧エリアのみがスクロール可能になることを確認。
