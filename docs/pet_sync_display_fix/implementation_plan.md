# 生体情報（犬猫）の同期（公開・店舗・写真）およびUI表示の改善計画

ユーザーからのフィードバックに基づき、同期処理のフィルタリング（公開のみ）、店舗取得の安定化、写真URL取得の修正、および一覧画面の軽量化（画像の遅延ロード）を行います。

## 課題と解決アプローチ

1. **店舗情報の取得不具合の解決**:
   - **原因**: 編集画面の hidden input（`category_ids`）が空、もしくはチェックボックスの状態と同期されていないケースがありました。
   - **解決策**: HTMLソース内のチェックボックス（`input[name^="add_category_id_"]`）の `checked` 属性を Cheerio で直接スキャンし、チェック済みのカテゴリIDを確実に抽出します。
2. **写真URLの取得不具合の解決**:
   - **原因**: プラグイン「AnotherCustomFields (ACF)」により画像が管理されているため、従来の `og_image_url` 等からは正しく取得できていませんでした。
   - **解決策**: 各プレビュー領域（`#acf_image01_preview`〜`#acf_image30_preview`）内の `<img>` タグの `src` 属性を走査し、アップロードされた画像のURLを正確に抽出します。
3. **公開中のみに同期対象を制限する**:
   - **解決策**: ステータス選択セレクトボックス（`select[name="status"]`）の選択値（`value`）が **`2`**（公開）のものだけを同期対象とします。それ以外の未公開や下書きは同期せずスキップします。
4. **UIの表示軽量化（画像の遅延ロード）**:
   - **解決策**: 一覧画面（`PetsBoard.tsx`）から画像を完全に非表示にします。これにより、一覧読み込み時のネットワーク負荷が大幅に軽減され、1画面に表示できる件数を増やすことができます。画像は詳細モーダル（`PetDetailModal.tsx`）を開いたときに初めて読み込んで表示します。

---

## 提案する変更内容

### 1. 同期アクション of 修正

#### [MODIFY] [petsSync.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/actions/petsSync.ts)
- **ステータス制限の実装**:
  - `statusVal` を `select[name="status"]` から抽出し、値が `'2'`（公開）でない場合はそのエントリの同期処理を `continue` でスキップします。
- **店舗チェックボックスの直接パース**:
  - `input[name^="add_category_id_"]` から `checked` または `checked="checked"` 属性を持つものをループで抽出し、チェック済みIDの配列を作成します。これをマッピング関数に渡して `store_id` を判定します。
- **ACF画像URLの抽出**:
  - `acf_image01_preview` 〜 `acf_image30_preview` のコンテナ内にある最初の `<img>` の `src` を走査して `image_url` に設定します。

---

### 2. UIコンポーネントの修正

#### [MODIFY] [PetsBoard.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/pets/PetsBoard.tsx)
- 一覧カードから画像の描画部分（`w-32 bg-slate-100...`）を完全に削除します。
- レイアウトを画像なしのすっきりしたカード（またはリスト）に変更し、グリッドの列数を増やして（例: `md:grid-cols-3 lg:grid-cols-4`）1画面により多くの生体情報を表示できるようにします。
- 犬猫のアイコン（Dog/Cat）を品種名の横などにバッジとしてコンパクトに表示します。

#### [MODIFY] [PetDetailModal.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/pets/PetDetailModal.tsx)
- モーダル内でのみ画像（`pet.image_url`）を表示する部分はそのまま維持します（モーダルが開いた瞬間にのみネットワーク経由で画像が取得されます）。

---

## 検証計画

### 1. 同期処理とフィルタリングの検証
- 同期処理を実行し、「公開」以外のエントリが追加されていないこと、および「唐津本店（本店）」などの店舗IDが正しく `cms_pets.store_id` に設定されていることをSupabase上で確認します。
- ACFから写真URL（`upload_images/...`）が正しく抽出され保存されているか確認します。

### 2. UIとパフォーマンスの検証
- ダッシュボードの一覧画面で、画像が表示されず、1画面にすっきりと多くの生体が並んでいるか（店舗名や生体番号付きで）確認します。
- 任意の生体をクリックし、詳細モーダルを開いたときに写真が正常に表示されることを確認します。
