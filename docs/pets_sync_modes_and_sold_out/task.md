# 同期漏れバグの修正タスク

- [x] 調査用一時ファイルのクリーンアップ
  - [x] `C:\Users\kirik\Desktop\Antigravity\next_app\check_db_status.mjs` を削除
  - [x] `C:\Users\kirik\Desktop\Antigravity\next_app\find_sold_out_entry.mjs` を削除
- [x] 同期アクションの修正 (`next_app/lib/actions/petsSync.ts`)
  - [x] 動的フィルター用の日付算出・DB問い合わせロジックを削除
  - [x] クイック同期時の `items` パラメータ（`modified_on` フィルター）の送信処理を削除
  - [x] 無条件で最新50件を取得・同期する元の高速バルクUpsert方式に差し替え
- [/] ビルド・動作検証
  - [x] `npx tsc --noEmit` を実行して、TypeScript型エラーがないか確認
  - [ ] クイック同期の実行時間および販売終了ステータスの更新動作の検証（手動確認）
