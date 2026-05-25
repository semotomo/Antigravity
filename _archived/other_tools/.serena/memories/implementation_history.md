# 実装・修正履歴

## 2026-05-01 — Next.js 現状同期と 4/24 本番反映確認

### 本番・ブランチ状態
- Vercel 本番URL: `https://antigravity-steel-one.vercel.app`
- 2026-05-01 時点の `origin/main`: `62c1c1f` — `fix: harden transfer jan lookup flow`
- `origin/feature/nextjs-app-vercel`: `cd469d3` — `fix: harden transfer jan lookup flow`
- ローカル作業ブランチ `feature/nextjs-app-vercel`: `cd469d3`
- `next_app/` は `origin/main` と差分なし
- リポジトリ直下には Next.js 以外の未整理変更が残っているため、引き続き対象ファイルだけ stage / commit する

### 2026-04-21 以降に本番反映済みの追加コミット
- `a4cda1c` — `feat: improve customer order entry`
- `a786d57` — `feat: add jan scanner to product search`
- `6acdea5` — `feat: group sales reports in mobile menu`
- `426fe12` — `feat: improve transfer jan entry flow`
- `83ec72a` — `fix: improve transfer lookup flow`
- `62c1c1f` — `fix: harden transfer jan lookup flow`

### 反映済みの追加仕様
- `/orders/[id]` の客注入力フローを改善
- `/products` の商品検索から JAN スキャナを呼び出せるようにした
- モバイルの下部ナビから `売上レポート` メニュー経由で `/sales/daily` / `/sales/products` / `/sales/abc` へ遷移できるようにした
- `/products/transfers` の JAN 入力フローと商品検索フローを改善し、lookup の堅牢性を上げた

### 2026-05-01 の再確認
- `next_app/` で以下を再度通過
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run build`
- 前回ログ `logs/2026-04-21-session.md` 時点の `origin/main = fb87391` は古く、現在の本番基準は `62c1c1f`

## 2026-04-21 — Next.js 本番運用状態と仕様拡張準備

### 本番・ブランチ状態
- Vercel 本番URL: `https://antigravity-steel-one.vercel.app`
- 本番連動ブランチ: `main`
- 2026-04-21 時点の `origin/main`: `fb87391` — `fix: prefer photo barcode scanning on ios`
- 作業ブランチ `feature/nextjs-app-vercel`: `6291030` — `fix: prefer photo barcode scanning on ios`
- `main` 反映は、作業ブランチ全体を混ぜずに必要コミットだけを temporary worktree で cherry-pick して実施

### 直近で確定した仕様
- iPad / iPhone のバーコード読取
  - ライブの `カメラで読取` は不安定だったため、iOS 系では非表示
  - iPad / iPhone では `写真で撮影して読取` を主導線にする
  - 写真読取は 0度 / 90度 / -90度 / 180度の画像補正を試して decode
- Android のバーコード読取
  - ライブの `カメラで読取` は動作確認済み
  - `写真から読取` も動作確認済み
- JAN / UPC
  - 8桁 / 12桁 / 13桁を受け付ける
  - 12桁コードは海外製品の UPC を想定して保存・検索対象に含める
- 店舗間移動 / 物品使用
  - `/products/transfers` はメイン導線として運用
  - `物品使用` に `賞味期限切れ / 店内使用 / プレゼント用 / その他` を実装
  - `物品使用` は移動先店舗なしで登録可能
  - Supabase migrations:
    - `20260410193000_add_transfer_usage_fields.sql`
    - `20260410224000_allow_transfer_usage_other.sql`
  - 上記2本は linked Supabase project へ適用済み
- 売上一覧 / ABC分析
  - `サービス以外` は単純な `category != 'サービス'` ではなく、サービス商品マスタ名・サービス系 product_group・サービス名パターンで除外
  - `ヨーキー（C）`、`マイクロチップ`、ホテル系、`犬（小型）5〜10kg` のような体重帯サービスも service 扱いに寄せた
  - ABC分析はカテゴリ集計ではなく、売上一覧と同じカテゴリフィルタで商品別に見る仕様

### 直近の検証
- `next_app/` で以下を通過
  - `npx tsc --noEmit`
  - `npm run lint`
  - `npm run build`
- ユーザー実機確認
  - iPad: 写真読取 OK、ライブカメラ読取 NG のため UI からライブボタンを外した
  - Android: カメラ読取 OK、写真読取 OK
  - 売上一覧の `サービス以外` は概ね OK
  - 店舗移動の新規登録ボタン重なりは解消
  - 物品使用 `その他` 登録 OK
  - 12桁コード保存・検索 OK

### 次の仕様追加時の注意
- iPad は今後も `写真で撮影して読取` 前提で案内する
- 新しいサービス名が漏れた場合は `next_app/lib/queries/sales.ts` の service 判定を追加する
- 店舗間移動は現状 `transfers` フラットテーブル運用。明細・承認・編集が必要になったら `inventory_transfer_headers / inventory_transfer_items` 移行を検討
- リポジトリ直下には Next.js 以外の未整理変更があるため、引き続き対象ファイルだけ stage / commit すること

## 2026-04-08 — Next.js Phase 2 実装と本番反映

### Next.js 側の到達点
- `next_app/` を GitHub / Vercel に反映し、Production を `main` ブランチ連動で運用開始
- Vercel 本番URL: `https://antigravity-steel-one.vercel.app`
- Supabase Auth の `Site URL / Redirect URLs` を本番URLに合わせて設定済み
- main 反映コミット:
  - `30257ec` — Next.js dashboard app 追加
  - `870e630` — 売上一覧フィルタレイアウト修正
  - `bd7d84e` — 商品移動管理 + 売上強化 + ABC分析

### 認証・基盤
- `next_app/app/(auth)/login/page.tsx`
  - `<form method="POST">` を追加し、JavaScript 未読込時の GET 送信によるパスワード露出を防止
  - サーバーアクション経由ログインへ寄せて、開発時の不安定さを軽減
- `next_app/next.config.ts`
  - 開発用 `allowedDevOrigins` を追加
- `next_app/package.json`
  - 開発時は `next dev --webpack` を使用

### 実装済み画面・機能
- 商品系
  - `/products` — 商品マスタ一覧・編集
  - `/products/aliases` — エイリアス管理（検索付き紐付け先変更）
  - `/products/unmatched` — 未一致解消
  - `/products/transfers` — 店舗間移動管理を新規実装
  - 商品系サブナビを再編し、「未一致解消」は右上メニューへ退避
- 客注系
  - `/orders` — 客注一覧
  - `/orders/[id]` — 客注詳細
  - 新規客注で JAN コード入力とカメラ読取に対応
  - `管理番号` 表記を `受付No.` に変更
  - `受付店舗` は `本店` を既定値化
  - `お渡し期限` は削除し、`受付担当` 入力を追加
- 売上系
  - `/sales` — 初期日付を JST の当日に固定
  - `From / To` 期間検索を修正
  - 店舗・カテゴリ・未紐付け絞り込みを整理
  - `サービス以外` フィルタを追加
  - 日付ソート切替を追加
  - `/sales/daily` から該当日の `/sales` へリンク
  - `/sales/abc` を新規追加
  - GAS Web App 呼び出し用 `POST /api/gas/trigger` を追加

### バーコード読取
- `next_app/components/orders/JanCodeScannerField.tsx` を客注・商品移動管理の両方で利用
- 本番 HTTPS 上でスマホカメラ読取が動作することを確認済み

### 検証
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- 上記は `next_app/` で通過済み

### 補足
- 店舗間移動は現時点では `transfers` のフラットテーブルを継続利用
- `inventory_transfer_headers / inventory_transfer_items` への移行は未着手
- リポジトリ直下には Next.js 以外の未整理変更があるため、main 反映は cherry-pick で必要コミットのみを投入

## 2026-02-24 — v3.1 追加改修

### 🏪 店舗管理機能
- `data_io.py`: `STORES_DIR`定数、`list_stores()`/`get_store_filepath()`/`create_store()`/`delete_store()`/`rename_store()`追加
- `data_io.py`: `load_settings_from_file()`/`save_settings_to_file()`にfilepath引数追加
- `app.py`: サイドバーに店舗セレクタ・追加/名前変更/削除UI追加
- 店舗ごとに`stores/店舗名.json`で独立管理
- コミット: `bb003ad`

### 🔧 役割設定UIレスポンス改善
- `save_roles_config()`の自動呼び出しを全削除（サイドバー保存に統一）
- 削除処理をforループ外に移動
- コミット: `c9ef3a1`

### Serena設定修正
- `.serena/project.yml`をフラット構造に修正（`project:`ラッパー除去でKeyError解消）

---

## 2026-02-24 — v3.1 動的役割カスタマイズ機能

### 動的役割対応
- `utils.py`: `DEFAULT_ROLES_CONFIG`定数追加、`get_role_map_from_df`/`can_cover_required_roles`/`assign_roles_smartly`/`highlight_cells`/`get_possible_day_patterns`を`roles_config`引数対応
- `data_io.py`: `load_roles_config()`/`save_roles_config()`追加。`load_settings_from_file()`が`roles_config`を返すように変更
- `solver.py`: `solve_schedule_from_ui()`に`roles_config`引数追加、全内部呼び出しに伝播
- `app.py`: 🎭役割設定UI追加（追加/削除/名前変更/必要人数/優先順位）
- `app.py`: スタッフ別「優先役割」ドロップダウン追加

### UI改善（v3.0）
- 出勤指定機能 + コンフリクト警告
- メモ・連絡事項欄
- 公平性ダッシュボード（土日出勤・役割分布・勤務バランス）
- 手動微調整 + プレビューモード
- 履歴管理（自動保存・閲覧・削除）
- ヘルプガイド・カラーマップの動的生成
- ピーチ/コーラル系デザインに刷新

### デプロイ
- `.gitignore` 更新（バックアップ/テスト/履歴除外）
- GitHubプッシュ（commit: `770bb43`, main）
- バックアップ: `*_backup_v3_20260224.py`

---

## 2026-02-23 — v2.0 大規模リファクタリング & デプロイ準備

### モジュール分割
- `app.py`（773行）を4ファイルに分割：
  - `utils.py` — ユーティリティ関数（祝日判定、役割マップ、パターン生成、役割割り当て、カラーリング）
  - `data_io.py` — データ入出力（設定読み書き、デフォルトデータ、CSV出力）
  - `solver.py` — シフト生成ソルバー（ビームサーチアルゴリズム）
  - `app.py` — UI専用（Streamlit）

### UI/UX改善
- レスポンシブCSS追加（モバイル768px以下対応）
- グラデーションヘッダー、カード風メトリクス、角丸フォーム
- 初回ヘルプガイド（3カラム構成の使い方説明）
- シフト結果サマリー（期間、スタッフ数、人員不足日、充足率）
- バリデーション強化（名前重複チェック、スタッフ4人未満警告、日付範囲チェック）
- ステータスメッセージ改善（成功/エラーの絵文字付き表示）

### デプロイ準備
- `requirements.txt` 作成（streamlit, pandas, numpy, jpholiday）
- `.gitignore` 作成（Python, IDE, OS, プロジェクト固有ファイル除外）
- `.streamlit/config.toml` 作成（テーマ設定: primaryColor #667eea）
- `README.md` 作成（機能説明、使い方、ファイル構成）
- GitHubプッシュ完了（commit: ec3db10）

### バグ修正
- `staff_df.at[j, '名前']` → `staff_df.iloc[j]['名前']` に修正
  - 原因: JSONから読み込んだDataFrameのインデックスが文字列になり、整数jでKeyError発生
  - 箇所: app.py 441行目（希望休入力の表示名マッピング部分）

### Serena MCPセットアップ
- `uv` (uvx 0.10.4) インストール
- `mcp_config.json` にSerena設定追加
- `.serena/project.yml` 作成
- メモリファイル5つ作成（project_overview, key_tasks, code_layout, cautions, implementation_history）
- `CLAUDE.md` と `.agents/AGENTS.md` をシフト作成ツール向けに書き換え

---

## これまでの主な実装履歴（過去チャットより再構成）

### シフト生成エンジン
- ビームサーチアルゴリズムの実装（BEAM_WIDTH=600）
- 動的リソース保全ペナルティの導入
- 正社員の週末休暇制限（月1回まで）
- 緊急モード（制約緩和フォールバック）の実装

### UI改善
- 曜日別目標人数設定UIの追加
- 優先曜日の選択機能
- プログレスバーの表示
- 名前列の幅詰め（CSS調整）
- 「勤(休)」集計列の追加

### バグ修正
- DataFrame形状不一致の修正（holidays_dfのインデックス/カラム整合）
- `applymap` → `map` への置き換え（pandas互換性）
