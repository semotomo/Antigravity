# 進捗管理表: 商品情報への仕入れ先追加およびカメラJANスキャン検索の一体化

このタスクリストは、商品の情報への「仕入れ先」情報の追加（専用CSVインポートおよびUI表示・編集）と、商品マスタ検索へのカメラJANコードスキャナーの一体化に関する実装の進捗を追跡するためのものです。

- [ ] `[ ]` 未完了
- [/] `[/]` 進行中
- [x] `[x]` 完了

---

## 📋 タスクリスト

### 1. 設計とドキュメント作成
- [x] 実装計画書 (`implementation_plan.md`) の作成
- [x] 進捗管理表 (`task.md`) の作成

### 2. データベース拡張と型定義の更新
- [x] データベースマイグレーションファイルの作成 (`supabase/migrations/20260527151300_add_supplier_name_to_products.sql`)
- [x] Supabaseの型定義 (`lib/types/database.ts`) に `supplier_name` カラム（`string | null`）を追加
- [x] `lib/products.ts` の `ProductActionField` に `'supplier_name'` を追加

### 3. サーバーアクションの実装
- [x] `app/actions/products.ts` に `uploadSupplierCsv` サーバーアクションを追加
  - [x] PapaparseによるCSVパースロジックの実装
  - [x] A列 (JANコード基準) / D列 (仕入れ先名) の抽出と、有効なJANのみを対象とするフィルタ処理
  - [x] 既存商品の他のデータを破壊しない安全な `upsert` マージ処理の実装
- [x] `updateProductAction` および `createNewProductAndMatchAction` で仕入れ先フォーム送信値を保存できるように拡張

### 4. CSVアップロード画面のタブ機能化
- [x] `CsvUploadModal.tsx` のリファクタリング
  - [x] タブUI（[商品マスタCSV] と [仕入れ先CSV]）の実装
  - [x] タブ選択に応じた説明文の表示切り替え
  - [x] タブ選択に応じたアップロードサーバーアクションの切り替え呼び出し

### 5. 商品マスタUI（表示 ＆ 手動編集）の拡張
- [x] `ProductsBoard.tsx` の一覧テーブルのカラム (`columns`) に「仕入れ先」列を追加
- [x] `ProductFormModal.tsx` に「仕入れ先」の手動編集用のテキスト入力項目を追加

### 6. 商品マスタ検索フォームへのカメラスキャナーのシームレスな統合
- [x] `ProductsBoard.tsx` の商品検索バーの `relative` なインプット枠の右端（インプット of 枠内）に `JanCodeScannerField` (showInput={false}) を美しく統合配置
- [x] スキャンしたJANコードで `query` が自動更新されて、連動して自動で高速絞り込み検索が走るように連動

### 7. テストと検証
- [x] SupabaseでのSQL適用の案内
- [x] `npm run build` によるビルドのパス確認
- [x] 実機やブラウザでのインポート動作確認・表示確認
- [x] 完了ドキュメント (`walkthrough.md`) の作成
