# タスクリスト

生体情報（犬猫）の同期不具合の解消、店舗マッピングの実装、および表示ソート順の修正タスクです。

- [x] 一時調査ファイルの削除
  - [x] `check_db.mjs` の削除
- [x] データベース型定義の修正
  - [x] `next_app/lib/types/database.ts` の `cms_pets` テーブルスキーマを実態に合わせる
- [x] 同期処理（Server Action） of 修正
  - [x] `next_app/lib/actions/petsSync.ts` 内のインサート用カラム名の書き換え
  - [x] カテゴリIDから `store_id` を判定するマッピング関数の実装
  - [x] 生体番号のパース用正規表現の緩和（6桁の数値を安全に抽出）
- [x] UIコンポーネントの修正
  - [x] `next_app/components/pets/PetsBoard.tsx`
    - [x] データ参照用のプロパティ名を修正（`management_no`, `coat_color` 等）
    - [x] Supabaseのクエリで `stores(name)` を JOIN して取得するように変更
    - [x] 各カードに所属店舗名の表示を追加
    - [x] 「犬が先、猫が後、同じ種別内は生体番号順」のソート処理を適用
  - [x] `next_app/components/pets/PetDetailModal.tsx`
    - [x] データ参照用のプロパティ名を修正
    - [x] モーダル内に所属店舗名の表示を追加
- [/] デプロイと最終動作検証
  - [/] 変更内容をGitHubにコミット＆プッシュし、Vercelのデプロイを走らせる
  - [ ] 同期ボタンを押し、データがDBに登録され、画面に正しく店舗や生体番号が表示・ソートされることを手動確認する
