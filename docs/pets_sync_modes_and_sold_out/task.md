# 同期漏れバグの修正タスク

- [x] 調査用一時ファイルのクリーンアップ
  - [x] `C:\Users\kirik\Desktop\Antigravity\next_app\check_db_status.mjs` を削除
  - [x] `C:\Users\kirik\Desktop\Antigravity\next_app\find_sold_out_entry.mjs` を削除
  - [x] その他の追加調査用スクリプト（`check_db_pets.mjs`、`investigate_sold_out.mjs`、`find_search_form.mjs`、`manual_sync_all.mjs`）の削除
- [x] 同期アクションの修正 (`next_app/lib/actions/petsSync.ts`)
  - [x] 動的フィルター用の日付算出・DB問い合わせロジックを削除
  - [x] クイック同期時の `items` パラメータ（`modified_on` フィルター）の送信処理を削除
  - [x] 無条件で最新50件を取得・同期する元の高速バルクUpsert方式に差し替え
- [x] ビルド・動作検証
  - [x] `npx tsc --noEmit` を実行して、TypeScript型エラーがないか確認
  - [x] 手動一括同期（最新250件）を実行し、販売終了生体（126156, 126155, 126152）のステータス更新動作を検証・完了
  - [x] 不要な過去の非公開ペットレコード（315件）のクリーンアップ削除を確認
