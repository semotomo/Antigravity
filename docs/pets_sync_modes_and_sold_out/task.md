# 同期モード切り替えと販売終了子連動機能の実装タスク

- [x] 調査用一時ファイルのクリーンアップ
  - [x] `C:\Users\kirik\Desktop\Antigravity\next_app\check_entry_fields.mjs` を削除
- [x] 同期アクション of 修正 (`next_app/lib/actions/petsSync.ts`)
  - [x] `syncPetsData` のシグネチャを `(mode: 'quick' | 'full' = 'quick')` に変更
  - [x] クイック/フルでの limit (50 / 500) およびループ件数の切り替えロジック実装
  - [x] 詳細パース部で `checkboxoff01_acf` を使った「販売終了」判定処理の追加
  - [x] 詳細取得後の更新日時（`authored_on_date` & `authored_on_time`）パース処理と、DB既存レコード比較による重複Upsertスキップ（高速化）
  - [x] フル同期完了時、今回ヒットしなかった古い非公開・対象外レコードの一括物理削除ロジック追加
- [x] UIコンポーネント of 修正 (`next_app/components/pets/PetsBoard.tsx`)
  - [x] 店舗セレクトボックスの隣に「販売終了の子を含める」チェックボックスを追加（デフォルト: オフ）
  - [x] `fetchPets` での publish_status フィルタを `['公開', '販売終了']` に拡張
  - [x] `filteredPets` の中で販売終了（チェックオフ時）を除外するフィルタリング処理 of 追加
  - [x] 同期ボタンを2つに分割し、「最新情報を同期」（quick）と「フル同期を実行」（full）を配置（同期ローディング状態連動）
  - [x] ペットカード上に「販売終了」バッジを表示するUI調整
- [x] ビルド・動作検証
  - [x] `npx tsc --noEmit` を実行して、TypeScript型エラーがないか確認
  - [x] クイック同期とフル同期の動作（手動確認）
  - [x] 販売終了子のフィルタ表示切り替えの動作（手動確認）
