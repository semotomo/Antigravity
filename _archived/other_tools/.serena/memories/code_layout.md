# コードレイアウト

## ファイル構成（v3.1）

| ファイル | 役割 | 行数(約) |
|---------|------|---------|
| `app.py` | メインUI（Streamlit） | 1090行 |
| `solver.py` | シフト生成ソルバー | 350行 |
| `utils.py` | ユーティリティ関数 | 230行 |
| `data_io.py` | データ入出力 + 店舗管理 | 370行 |
| `requirements.txt` | 依存関係 | 4行 |
| `.streamlit/config.toml` | テーマ設定 | 12行 |
| `README.md` | プロジェクト説明 | 80行 |
| `.serena/project.yml` | Serena設定 | 4行 |

## app.py の構成（UI専用）

| セクション | 概要 |
|-----------|------|
| CSS注入 | レスポンシブ対応CSS、グラデーション、角丸 |
| `initialize_session()` | セッション状態初期化 |
| ヘッダー | タイトル、キャプション |
| ヘルプガイド | 初回表示の使い方3カラム |
| サイドバー | 保存/読込、日付設定、バックアップDL/UP |
| 基本設定 | 朝夜人数、優先曜日、曜日別目標 |
| 基本設定 | 朝夜人数、優先曜日、曜日別目標 |
| 🎭 役割設定 | 追加/削除/名前変更/必要人数/優先順位 |
| スタッフ設定 | data_editor、名前重複チェック、優先役割ドロップダウン |
| 希望休入力 | 日付表示マッピング付きdata_editor |
| 出勤指定入力 | 出勤強制チェックボックスグリッド |
| コンフリクト警告 | 希望休×出勤指定の重複検知 |
| メモ・連絡事項 | 日ごとのメモ入力（2列表示） |
| シフト作成 | バリデーション → ソルバー呼出 → サマリー → 結果表示 |
| 公平性ダッシュボード | 土日出勤・役割分布・勤務バランス |
| 手動微調整 | シフト結果の手動編集+CSV |
| プレビューモード | 印刷用コンパクトHTML表 |
| フッター | バージョン情報 |

## solver.py の構成

| 関数 | 概要 |
|------|------|
| `solve_schedule_from_ui()` | メインソルバー（ビームサーチ） |
| └ `expand_paths()` | 内部関数：1日分パス展開 |

## utils.py の構成

| 関数 | 概要 |
|------|------|
| `is_holiday(d)` | 祝日判定 |
| `get_role_map_from_df(staff_df)` | 役割マップ生成 |
| `can_cover_required_roles(...)` | 役割カバー可否チェック |
| `get_possible_day_patterns(...)` | 出勤パターン生成 |
| `assign_roles_smartly(...)` | 役割自動割り当て |
| `highlight_cells(data)` | セルカラーリング |
| `get_default_date_range()` | デフォルト日付範囲 |

## data_io.py の構成

| 関数 | 概要 |
|------|------|
| `load_settings_from_file()` | JSONから設定読込 |
| `get_default_data()` | デフォルトデータ生成 |
| `save_settings_to_file(...)` | JSONに設定保存 |
| `generate_custom_csv(...)` | CSV出力（UTF-8 BOM） |
