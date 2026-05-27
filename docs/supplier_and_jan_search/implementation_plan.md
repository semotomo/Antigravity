# 実装計画書: 商品情報への仕入れ先追加およびカメラJANスキャン検索の一体化

このドキュメントは、商品の情報への「仕入れ先（`supplier_name`）」情報の追加（専用CSVインポートおよびUI表示・編集）と、商品マスタ検索バーへのカメラJANコードスキャナーの一体化に関する実装設計計画書です。

## 🎯 目標と成果基準

1. **仕入れ先情報（`supplier_name`）のデータ拡張と管理**:
   - `products` テーブルに `supplier_name` カラム（テキスト型、空許容）を追加する。
   - 個別商品編集（`ProductFormModal`）および新規作成アクションで、仕入れ先情報の手動編集・保存ができるようにする。

2. **仕入れ先CSVの専用同期システムの実装**:
   - POSポータルの「在庫管理商品一覧出力」からダウンロードしたCSVに対応するサーバーアクション `uploadSupplierCsv` を実装する。
   - **仕入れ先CSVの解析仕様**:
     - A列（インデックス0）：JANコード（8, 12, 13桁の数字をインポート対象とすることで、ヘッダー行などを自動で安全に除外）。
     - D列（インデックス3）：仕入れ先（サプライヤー名）。
     - その他の情報は一切使用しない。
     - すでに存在する商品（JANコード基準）に対して、他のデータを一切壊さずに `supplier_name` のみを上書き更新（マージ）する。

3. **CSVアップロードモーダル（`CsvUploadModal`）のマルチタブ化**:
   - モーダル内に「商品マスタCSV同期」と「仕入れ先CSV同期」の2つのタブを実装。
   - タブ切り替えによって、それぞれのCSV用の案内文が表示され、アップロード時に対応するサーバーアクションを正確に呼び分けるようにする。

4. **商品マスタ一覧での仕入れ先表示**:
   - 商品マスタ一覧の DataTable に「仕入れ先」列を追加し、ひと目で仕入れ先がわかるようにする。

5. **商品検索バーへの「カメラJANスキャナー」のシームレスな統合**:
   - 商品マスタ検索ボックスの右端（インプットの枠内）に `JanCodeScannerField` の「カメラで読取」ボタンを美しく埋め込む。
   - スキャンに成功した場合は自動的に検索窓の `query` にJANコードが入力され、連動して高速な自動絞り込み検索が走るようにする。

---

## 🛠️ 提案する変更点

### 1. データベース・型定義の更新
* **[NEW] [20260527151300_add_supplier_name_to_products.sql](file:///C:/Users/kirik/Desktop/Antigravity/supabase/migrations/20260527151300_add_supplier_name_to_products.sql)**
  - マイグレーションファイルを作成：
    ```sql
    ALTER TABLE products ADD COLUMN supplier_name text;
    ```
* **[MODIFY] [database.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/types/database.ts)**
  - `products` の `Row`, `Insert`, `Update` 型に `supplier_name: string | null` を追加。
* **[MODIFY] [products.ts (Lib)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/products.ts)**
  - `ProductActionField` 型定義に `'supplier_name'` を追加。

### 2. サーバーアクションの実装
* **[MODIFY] [products.ts (Actions)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/actions/products.ts)**
  - `uploadSupplierCsv(formData: FormData)` アクションの追加。
    - CSVのA列が有効なJANコードの場合のみ、A列（JANコード）とD列（仕入れ先）を抽出し、`supabase.from('products').upsert(chunk, { onConflict: 'jan_code' })` を用いて仕入れ先情報のみを安全にマージ。
  - `updateProductAction` および `createNewProductAndMatchAction` / `buildProductPayload` の更新：
    - `formData` から `supplier_name` を読み込み、`products` への保存ペイロードに含めるように修正。

### 3. コンポーネントおよびUIの更新
* **[MODIFY] [CsvUploadModal.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/products/CsvUploadModal.tsx)**
  - モーダル内にタブUI（「商品マスタCSV」と「仕入れ先CSV」）を追加し、それぞれの同期アクションを切り替え実行可能にする。
* **[MODIFY] [ProductFormModal.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/products/ProductFormModal.tsx)**
  - 商品マスタ手動編集フォームに「仕入れ先」のテキスト入力欄を追加。
* **[MODIFY] [ProductsBoard.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/products/ProductsBoard.tsx)**
  - マスタ一覧テーブルの列 (`columns`) に「仕入れ先」列を追加。
  - 検索窓の `relative` なインプット枠の右端に `JanCodeScannerField`（`showInput={false}`）を美しく統合配置。スキャンしたJANコードで `query` が自動更新されて検索が走るように連動。

---

## 🧪 検証プラン

### 1. データベースSQL適用とビルド検証
- SupabaseのSQLエディタで `ALTER TABLE products ADD COLUMN supplier_name text;` が正常に実行できることを確認する。
- `npm run build` を実行して、追加した `supplier_name` カラムに関するTypeScript型チェックやビルドエラーが一切ないことを検証する。

### 2. 仕入れ先CSV同期テスト
- POSポータルから仕入れ先CSVをダウンロード。
- CSVアップロードモーダルを開き、新規追加された「仕入れ先CSV同期」タブからファイルをアップロード。
- 同期完了メッセージが表示され、A列のJANコードに対応する商品の「仕入れ先」情報のみが綺麗に更新されていることを確認する（商品名や価格などは壊れずに保持されていること）。

### 3. 一覧表示・編集テスト
- 商品マスタ一覧で、各商品の右隣に「仕入れ先」列が追加され、インポートした仕入れ先名が綺麗に表示されることを確認する。
- 各商品の「編集」ボタンを押し、編集モーダル内で仕入れ先名が表示され、手動で書き換えて「更新する」とデータベースが正しく書き換わることを検証する。

### 4. 検索窓の一体型カメラスキャンテスト
- 検索バーの右端に「カメラで読取」ボタンが綺麗に埋め込まれていることを確認する。
- カメラを起動して商品のバーコードをかざすと、「ピッ」と鳴って検索窓にスキャンしたJANコードが自動入力され、連動してその商品の検索結果が一瞬で表示されることを確認する。
