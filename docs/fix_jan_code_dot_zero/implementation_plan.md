# 商品マスタのJANコード末尾「.0」バグ修正計画

商品マスタ同期時に、一部の商品のJANコード末尾に `.0` が付いて登録されてしまうバグを修正し、データベース内の既存のゴミデータをクリーンアップします。

## ユーザーレビューが必要な事項

- **GAS（Google Apps Script）の更新**:
  ローカルの `gas/importCSV.gs` ファイルを修正します。修正後、ユーザー様側でGoogleスプレッドシートの「拡張機能 > Apps Script」を開き、`importCSV.gs` の内容を最新のコードに貼り替えていただく必要があります。

- **既存データのクリーンアップ SQL**:
  Supabase 側に既に登録されている `.0` 付きのJANコードをクリーンアップするため、Supabase の SQL Editor でクエリを実行していただく必要があります。

---

## Proposed Changes (提案する変更内容)

### 1. GAS（Google Apps Script）の修正
#### [MODIFY] [importCSV.gs](file:///C:/Users/kirik/Desktop/Antigravity/gas/importCSV.gs)
- JANコード読み込み時に、末尾が `.0` の場合にそれを除去する処理を追加します。

### 2. 既存データのクリーンアップ
- Supabase SQL Editor 用のクリーンアップ SQL を提供します。

---

## Verification Plan (検証計画)

### 1. 手動同期テスト
- GASのスクリプトを更新後、「商品マスタ同期」を実行し、新規登録される商品に `.0` が付かないことを確認します。
