# 同期モード切り替えと販売終了子連動機能の実装計画

CMS（Movable Type）からの生体データ同期において、日常的な更新用の「クイック同期」と定期メンテナンス用の「フル同期（一括削除含む）」の2モードを実装し、さらに「販売終了」チェックボックス（`checkboxoff01_acf`）がオンになっているペットを同期時に検知してステータスを「販売終了」に更新し、UI側でその表示/非表示を切り替える機能を実装します。

## 調査結果

1. **「販売終了」チェックボックスの仕様**:
   - `entry_debug.html` を解析した結果、`input[name="checkboxoff01_acf"]` は `type="checkbox"`、`value="1"` として存在することを確認しました。
   - Cheerio を使用して `$entry('input[name="checkboxoff01_acf"]').prop('checked')` が `true` の場合、または属性 `checked` が存在する（`attr('checked') !== undefined`）場合に「販売終了」と判定します。
2. **CMS API `filtered_list` のレスポンス**:
   - `filtered_list` APIが返すオブジェクトは `["5902"]` のようにエントリIDのみを含む単一要素の配列でした。
   - APIレスポンス自体に更新日時等のメタデータが含まれていないため、詳細ページにリクエストを送る前に更新有無を判定することはできません。
   - 対策として、詳細ページ取得後に詳細画面HTML内の更新日時（`authored_on_date` と `authored_on_time`）をパースし、DBに保存されている `cms_updated_at` と比較して更新がなければDB書き込みをスキップすることで、DB負荷を最小限に抑えます。

---

## ユーザー確認・検討事項

> [!NOTE]
> - **クイック同期の件数**: ユーザーの「同期していない間に20件以上溜まる可能性」を考慮し、クイック同期は **最新50件** を対象とします。
> - **フル同期の件数**: フル同期は **最新500件** を対象とし、同期完了後に「今回同期されなかった古いペットデータ（そのブログカテゴリに属するもの）」をDBから一括物理削除します。
> - **UI配置**: 店舗セレクトボックスのすぐ隣に「販売終了の子を含める」チェックボックス（デフォルト：オフ）を配置します。

---

## Proposed Changes (提案する変更内容)

### 1. 同期アクションの修正
#### [MODIFY] [petsSync.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/actions/petsSync.ts)
- `syncPetsData(mode: 'quick' | 'full' = 'quick')` に関数署名を変更します。
- `mode === 'quick'` の場合は `limit: 50` で動作し、一括削除処理は行いません。
- `mode === 'full'` の場合は `limit: 500` で動作し、同期完了後に、今回同期されなかった古いペットデータをDBから一括物理削除します。
- 詳細ページのパース処理にて、`checkboxoff01_acf` の状態を判定します。
  ```typescript
  const isSoldOut = $entry('input[name="checkboxoff01_acf"]').prop('checked') || $entry('input[name="checkboxoff01_acf"]').attr('checked') !== undefined;
  const status = isSoldOut ? '販売終了' : '公開';
  ```
- 更新日時の比較によるDB書き込みの効率化：
  - 詳細ページから `authored_on_date`（例: `2025-10-08`）および `authored_on_time`（例: `14:45:40`）を取得。
  - DBから既存の `cms_pets` レコードを取得し、更新日時が一致している場合は upsert をスキップして次のエントリへ進みます。これによりDB書き込みと不要な更新を防ぎます。
- フル同期時の一括削除処理：
  - 同期中に成功したエントリID（`syncedEntryIds`）を蓄積。
  - フル同期完了後、DB内の `cms_pets` のうち、`species === '犬'`（または `'猫'`）かつ `cms_entry_id` が `syncedEntryIds` に含まれないレコードを一括物理削除します。

### 2. UIコンポーネントの修正
#### [MODIFY] [PetsBoard.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/pets/PetsBoard.tsx)
- **チェックボックスの追加**:
  - 店舗セレクトボックスの隣に「販売終了の子を含める」チェックボックス（`showSoldOut`）を配置します（デフォルト: `false`）。
- **データフェッチの修正**:
  - `fetchPets` でのクエリ条件を、`.in('publish_status', ['公開', '販売終了'])` に変更し、販売終了のペットもまとめて取得しておきます。
- **フィルタリングロジックの修正**:
  - `filteredPets` の中で、`showSoldOut` が `false` かつ `publish_status === '販売終了'` のペットを除外します。
- **同期ボタンの修正**:
  - 「最新情報を同期」ボタンのクリック時に `syncPetsData('quick')` を呼び出します。
  - その横に、目立たないアウトラインスタイルの「フル同期を実行」ボタンを配置し、クリック時に `syncPetsData('full')` を呼び出します（同期中はローディング表示）。
- **UI表示の調整**:
  - 「販売終了」ステータスのペットには、カード上に「販売終了」のラベルバッジ（グレー等）を表示し、一目でわかるようにします。

### 3. 調査用一時ファイルのクリーンアップ
#### [DELETE] [check_entry_fields.mjs](file:///C:/Users/kirik/Desktop/Antigravity/next_app/check_entry_fields.mjs)
- 調査で使用した一時スクリプトを削除します。

---

## Verification Plan (検証計画)

### 1. 自動テスト・型チェック
- `npx tsc --noEmit` を実行して、TypeScriptの型エラーが発生しないことを確認します。

### 2. 手動検証
- **クイック同期のテスト**:
  - クイック同期を実行し、最新のデータのみが同期され、DB内の古いレコードが削除されないことを確認します。
- **フル同期のテスト**:
  - フル同期を実行し、CMS上で非公開になった、または最新500件から漏れた古いペットデータがDBから正常に物理削除されることを確認します。
- **販売終了フラグのテスト**:
  - CMS側で「販売終了」がオンになっているペットが、同期後にDB上で `publish_status = '販売終了'` となっていることを確認します。
- **UIフィルタのテスト**:
  - 初期状態（「販売終了の子を含める」がオフ）では、販売終了のペットが表示されないことを確認します。
  - チェックを入れると、販売終了のペットも表示され、カード上に「販売終了」バッジが表示されることを確認します。
