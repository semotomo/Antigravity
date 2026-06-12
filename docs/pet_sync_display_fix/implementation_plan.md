# 生体情報（犬猫）の同期・表示およびソート順の修正計画

実際のSupabaseデータベースのテーブルスキーマと、Next.jsの型定義・コードで想定されていたカラム名に乖離があったため、同期しても情報が表示されない不具合が発生していました。
本計画では、このスキーマの乖離を解消し、店舗情報のマッピングと並び替え要件（犬が先、猫が後、他は生体番号順）を実装します。

## 調査によって判明した原因

1. **スキーマの不一致**:
   - DB上の実際のカラムは `management_no`、`cms_entry_id`、`coat_color`、`birth_place`、`vaccines` 等ですが、Next.js側は `pet_number`、`entry_id`、`color`、`origin`、`vaccine_status` などの異なるカラム名を想定して実装されていました。
   - `petsSync.ts` のDB挿入処理で `as any` を使用しエラーを無視していたため、不整合に気づかず同期成功と表示されていました。
2. **店舗情報の未マッピング**:
   - `store_id` が同期処理内で設定されておらず、DB上で常に `NULL` になっていました。
   - CMS編集画面のHTMLソースから、カテゴリIDと各店舗の対応マッピングが判明しました。
     - 唐津本店 (ID: 379) ➔ `stores` ID: 7 (本店)
     - ペッツマックス唐津店 (ID: 380) ➔ `stores` ID: 2 (マックス)
     - ペットセンター (ID: 381) ➔ `stores` ID: 6 (わんわん)
     - ペットアミ周船寺店 (ID: 414) ➔ `stores` ID: 5 (周船寺)
     - ペットアミ伊万里店 (ID: 426) ➔ `stores` ID: 3 (伊万里)
     - ペットアミ佐世保店 (ID: 425) ➔ `stores` ID: 1 (佐世保)
     - ペットアミ武雄店 (ID: 432) ➔ `stores` ID: 4 (武雄)

---

## 提案する変更内容

### 1. 型定義の修正

#### [MODIFY] [database.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/types/database.ts)
- `cms_pets` テーブルの定義を実際のDBスキーマ（`management_no`, `cms_entry_id`, `coat_color`, `birth_place`, `vaccines`, `publish_status`, `price_tax_excluded`, `price_tax_included`, `cms_category_ids`, `cms_updated_at` 等）に完全に書き換えます。

---

### 2. 同期アクションの修正

#### [MODIFY] [petsSync.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/actions/petsSync.ts)
- **カラムマッピングの修正**: パースした各フィールドを、実際のDBのカラム名に正しくマッピングして挿入するように修正します。
- **店舗IDのマッピング実装**: `cms_category_ids` の値をカンマ分割し、上記の対応表に基づいて `store_id`（1〜7）を判定・設定する関数を実装し、DBに保存します。
- **生体番号パースの改善**: タイトルや本文のパースで、6桁の数字（`management_no`）を安全に抽出できるように正規表現を `\b(\d{6})\b` などに緩和・修正します。

---

### 3. UI表示とソート処理の修正

#### [MODIFY] [PetsBoard.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/pets/PetsBoard.tsx)
- **プロパティ参照の修正**: `pet.pet_number` を `pet.management_no`、`pet.color` を `pet.coat_color` など、正しい変数名を参照するように変更します。
- **店舗名の取得**: Supabaseの取得クエリを `.select('*, stores(name)')` に変更し、各ペットの所属店舗名を取得できるようにします。
- **UIへの店舗名表示**: 各カード内に「所属店舗: ○○店」という表示を追加します。
- **ソート処理の実装**:
  - 表示前に以下の優先順位でソートするロジックを追加します。
    1. 「種別（`species`）」が **犬（dog）** のものを先、**猫（cat）** のものを後に並べます。
    2. 同じ種別の中では、**生体番号（`management_no`）** の昇順で並べます。

#### [MODIFY] [PetDetailModal.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/pets/PetDetailModal.tsx)
- 表示項目を正しいカラム名（`pet.management_no`、`pet.coat_color`、`pet.birth_place`、`pet.vaccines` 等）に修正します。
- 基本情報エリアに「所属店舗: {店舗名}」の表示項目を追加します。

---

### 4. 不要なファイルの削除

#### [DELETE] [check_db.mjs](file:///C:/Users/kirik/Desktop/Antigravity/next_app/check_db.mjs)
- 今回の調査で使用した一時スクリプトを削除します。

---

## 検証計画

### 1. 手動同期とデータの確認
- 管理画面の「最新情報を同期」ボタンを再度実行します。
- Supabaseのダッシュボードまたはログから、`cms_pets` テーブルに `management_no` や `store_id` が正しく格納されていることを確認します。

### 2. 表示・ソート順の確認
- 一覧画面（`PetsBoard`）で、すべての犬猫に生体番号（6桁）と所属店舗名が正しく表示されているか確認します。
- 並び順が「犬が先、猫が後、同じ種別内は生体番号順」になっているか確認します。
- 詳細モーダルを開き、出身地やワクチン等の詳細項目が正しく表示されることを確認します。
