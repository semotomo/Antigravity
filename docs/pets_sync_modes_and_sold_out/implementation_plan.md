# 同期モード切り替えと動的更新日フィルター機能の実装計画

CMS（Movable Type）からの生体データ同期において、日常的な更新用の「クイック同期」にCMSの「更新日（`modified_on`）」フィルターを動的に適用し、前回の同期以降に更新されたペットだけをピンポイントでフェッチ・更新する高速な仕組みを導入します。また、定期メンテナンス用の「フル同期（一括削除含む）」と組み合わせることで、完全性と超高速動作を両立させます。

## 調査結果

1. **更新日フィルターのパラメータ特定**:
   - CMSのエントリー一覧画面のHTMLを解析した結果、フィルター適用時は `items` という POST パラメータに JSON 形式の配列を渡して AJAX リクエスト（`__mode=filtered_list`）を送信していることが判明しました。
   - 「更新日（`modified_on`）」を指定する際のJSON構造は以下の通りです：
     ```json
     [
       {
         "type": "modified_on",
         "args": {
           "option": "range",
           "from": "YYYY-MM-DD",
           "to": "YYYY-MM-DD"
         }
       }
     ]
     ```
2. **動作検証**:
   - 上記の `items` パラメータを渡すことで、指定した期間内に更新されたエントリーだけを CMS 側でフィルタリングして取得可能です。

---

## 提案する変更内容

### 1. 同期アクションの修正
#### [MODIFY] [petsSync.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/actions/petsSync.ts)
- **最終同期日時の取得**:
  - `mode === 'quick'` の場合、Supabase の `cms_pets` テーブルから最新の `updated_at`（または `cms_updated_at`）を取得し、最終同期日を特定します。
- **動的フィルターの適用**:
  - 最終同期日から安全マージンとして **1日前** の日付を `from` とし、本日（日本時間基準）を `to` とする日付範囲（`YYYY-MM-DD`）を算出します。
  - パラメータ `items` に `[{ type: "modified_on", args: { option: "range", from: fromDate, to: toDate } }]` を JSON 文字列化して追加し、CMS にリクエストを送信します。
  - 初回同期など最終同期日時が取得できない場合は、過去7日間を対象とします。
  - クイック同期時のAPIリミットは `limit: 50` とします（期間内の更新が50件を超えることは通常ないため十分です）。
- **フル同期の挙動**:
  - `mode === 'full'` の場合はフィルターを設定せず、全頭（最大500件）を取得・同期し、今回同期されなかった古いペットレコードをDBから一括削除します。

### 2. 調査用一時ファイルのクリーンアップ
#### [DELETE] [check_cms_list.mjs](file:///C:/Users/kirik/Desktop/Antigravity/next_app/check_cms_list.mjs)
- 調査で使用した一時スクリプトを削除します。
#### [DELETE] [list_page.html](file:///C:/Users/kirik/Desktop/Antigravity/next_app/list_page.html)
- ダウンロードした一時HTMLファイルを削除します。

---

## Verification Plan (検証計画)

### 1. 自動テスト・型チェック
- `npx tsc --noEmit` を実行して、TypeScriptの型エラーが発生しないことを確認します。

### 2. 手動検証
- **クイック同期のテスト**:
  - クイック同期を実行し、直近に更新されたエントリだけがピンポイントでフェッチされ、DBの更新日が最新になることを確認します（処理時間が数秒〜十数秒から1〜2秒へと大幅に短縮されることを確認します）。
- **フル同期のテスト**:
  - フル同期を実行し、全件が取得され、不要な古いデータがクリーンアップされることを確認します。
