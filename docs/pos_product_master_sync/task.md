# 次回タスクリスト (Next Steps)

- [x] **Task 1: 手動CSVアップロード機能の実装**
  - [x] `next_app` で `papaparse` をインストール
  - [x] サーバーアクション `uploadProductMasterCsv` を作成（パース処理とSupabase UPSERT）
  - [x] クライアントUI `CsvUploadModal.tsx` を作成
  - [x] `ProductsBoard.tsx` または関連箇所にアップロードボタンを追加
  - [ ] ダミーCSVで動作確認

- [x] **Task 2: 当日の入出庫履歴（本日売れた商品）の表示**
  - [x] GAS (`autoDownload.gs`) に履歴取得関数 `downloadSalesHistoryFromPOS_` を追加
  - [x] GASの `doGet` に `mode=history` を追加し、JSONを返すように改修
  - [x] Next.js 側に履歴取得用関数と UI（`SalesHistoryBoard.tsx` 等）を追加
  - [x] 売上ダッシュボードに組み込み、日付範囲指定UIを実装

- [x] **Task 3: 「商品別集計」ページの見直し（今月のトレンドへ）**
  - [x] `/sales/products` ページの集計クエリを「全期間」から「今月」に変更
  - [x] UIのタイトルを「商品別トレンド（今月）」等へ変更
