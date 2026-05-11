# Flet版アプリ移行タスクリスト

- [x] プロジェクト構成（Fletルーティング・ナビゲーションの導入）の基礎検討と実装
- [x] Streamlitアプリ（シフト管理）のバックエンド分離（`data_io.py`, `solver.py`）
- [x] ログイン画面実装およびSupabase認証連携
- [x] 非同期（async/await）警告の解消およびFlet 1.0相当の対応
- [x] シフト管理 (`ShiftView`): データテーブルUI（スタッフ、希望休、出勤設定）
- [x] シフト管理 (`ShiftView`): シフト自動生成バックエンド連携
- [x] **シフト管理 (`ShiftView`): データの保存機能（`save_settings_to_file`の連携）**
- [x] **在庫管理 (`InventoryView`): 画面UI実装**
  - [x] 手入力テキストフィールドと一覧表示（`DataTable`）の実装
  - [x] カメラ使用のバーコード読み取り操作用UIフックの実装
- [x] 検証と最終確認（Walkthrough作成）
