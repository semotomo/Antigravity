# 実装済み機能・TODO

## Next.js 現状サマリー（2026-05-01） ✅

### 本番状態
- [x] Vercel 本番URL: `https://antigravity-steel-one.vercel.app`
- [x] `main` 連動で本番デプロイ
- [x] 2026-05-01 時点の `origin/main`: `62c1c1f`
- [x] 作業ブランチ `feature/nextjs-app-vercel`: `cd469d3`
- [x] `next_app/` は `origin/main` と差分なし
- [x] Supabase migrations `20260410193000` / `20260410224000` は linked project に適用済み

### 2026-04-24 時点までに本番反映済みの追加改善
- [x] `/orders/[id]` の客注入力フロー改善
- [x] `/products` の商品検索から JAN スキャナを利用可能
- [x] 売上レポート（`/sales/daily` / `/sales/products` / `/sales/abc`）をモバイルメニューに集約
- [x] `/products/transfers` の JAN 入力フローと商品検索フローを改善

### 運用中の主要仕様
- [x] iPad / iPhone は `写真で撮影して読取` を使う
- [x] Android は `カメラで読取` と `写真から読取` の両方を使える
- [x] JAN / UPC は 8桁 / 12桁 / 13桁を保存・検索対象にする
- [x] 店舗間移動は `/products/transfers` をメイン導線として運用
- [x] 物品使用は `賞味期限切れ / 店内使用 / プレゼント用 / その他`
- [x] `サービス以外` は美容・ホテル・マイクロチップ等のサービス系を除外する
- [x] ABC分析はカテゴリ別集計ではなく、カテゴリフィルタ付きの商品別ABCとして運用

### 次に仕様追加しやすい候補
- [ ] 店舗間移動 / 物品使用の履歴編集
- [ ] 店舗間移動 / 物品使用の承認・完了・取消フロー
- [ ] 物品使用の集計画面（日次/月次、区分別、店舗別）
- [ ] サービス判定の管理画面化（コード内パターンではなくマスタで管理）
- [ ] 売上取込 `GAS_WEBAPP_URL` の本番運用確認とエラー通知
- [ ] Next.js 側の自動テスト（unit / E2E）

## Next.js 移行（実装済み） ✅

### 基盤・デプロイ
- [x] `next_app/` を GitHub に反映
- [x] Vercel で Production デプロイ
- [x] Supabase Auth の `Site URL / Redirect URLs` を本番URL向けに設定
- [x] ログイン安全対策（`method="POST"` + サーバーアクション寄せ）

### 商品管理
- [x] `/products` 商品マスタ一覧・編集
- [x] `/products/aliases` エイリアス管理
- [x] `/products/unmatched` 未一致解消
- [x] `/products/transfers` 店舗間移動管理
- [x] 商品系導線の再編
  - [x] SideNav / BottomNav は `/products` をハブ化
  - [x] `未一致解消` は `ProductsSubnav` 右上メニューへ移動

### 客注管理
- [x] `/orders` 客注一覧
- [x] `/orders/[id]` 客注詳細
- [x] 客注に JAN コード入力追加
- [x] 客注でバーコード読取
  - [x] Android はライブカメラ読取
  - [x] iPad / iPhone は写真撮影読取を主導線化
- [x] `管理番号` → `受付No.` 表記変更
- [x] `受付店舗` の既定値を `本店` に設定
- [x] `お渡し期限` の削除
- [x] `受付担当` 入力欄の追加

### 売上管理
- [x] `/sales` 初期表示を JST の当日に固定
- [x] `/sales` の `From / To` 期間検索修正
- [x] カテゴリ候補の拡充
- [x] `サービス以外` フィルタ追加・サービス判定強化
- [x] 日付ソート切替追加
- [x] GAS Web App 呼び出し API (`/api/gas/trigger`) 追加
- [x] 売上一覧から GAS 取込ボタン追加
- [x] `/sales/daily` から `/sales` への日付リンク追加
- [x] `/sales/abc` ABC分析画面追加

### 検証
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] 2026-05-01 時点で `next_app/` の `lint` / `tsc` / `build` を再確認
- [x] 本番 HTTPS 上で Android バーコード読取確認
- [x] 本番 HTTPS 上で iPad 写真読取確認

## Next.js 移行（未実装 / 要確認） 📋

### 未実装
- [ ] `inventory_transfer_headers / inventory_transfer_items` への移行判断と実装
- [ ] Next.js 側の自動テスト（ユニット / E2E）追加

### 要確認
- [ ] Vercel 本番環境変数 `GAS_WEBAPP_URL` 設定と「売上データ取込」ボタンの本番動作確認
- [x] `/products/transfers` の本番での登録 / 物品使用フロー確認
- [ ] `/products/transfers` の削除フローの継続確認
- [ ] `/sales/abc` の実データに対する集計妥当性確認
- [ ] 店舗間移動の運用仕様（履歴編集要否、承認フロー要否）の確定

## 実装済み ✅

### コア機能
- [x] スタッフ情報入力UI（名前、正社員フラグ、朝可/夜可、役割、最大連勤、公休数）
- [x] 🎭 動的役割カスタマイズ（追加/削除/名前変更/必要人数/優先順位）
- [x] スタッフ別「優先役割」設定（ドロップダウン）
- [x] 希望休入力UI（チェックボックスグリッド）
- [x] ✅ 出勤指定入力（必ず出勤させたい日を指定）
- [x] ⚠️ コンフリクト警告（希望休×出勤指定の重複検知）
- [x] 日付範囲設定（開始日・終了日）
- [x] シフト自動生成エンジン（ビームサーチ、BEAM_WIDTH=600）
- [x] 制約充足チェック（朝/夜最低人数、連勤制限、公休数遵守）
- [x] 役割割り当てロジック（動的roles_config対応）
- [x] 曜日別目標人数設定
- [x] 優先曜日設定
- [x] 動的リソース保全ペナルティ
- [x] 正社員の週末休暇制限（月1回まで）

### UI/UX
- [x] カラーリング表示（動的roles_config対応色分け）
- [x] CSVエクスポート（エクセル対応UTF-8 BOM付き）
- [x] 設定の保存・読込（JSON形式、roles_config含む）
- [x] 📊 公平性ダッシュボード（土日出勤・役割分布・勤務バランス）
- [x] 🔧 手動微調整（シフト結果の編集+CSV）
- [x] 📱 プレビューモード（印刷用コンパクトHTML表）
- [x] 📈 シフト履歴管理（自動保存・閲覧・削除）
- [x] 📝 メモ・連絡事項欄
- [x] レスポンシブCSS（モバイル対応）
- [x] 初回ヘルプガイド（動的生成）
- [x] シフト結果サマリー（充足率、不足日カウント等）
- [x] ピーチ/コーラル系デザイン
- [x] 入力バリデーション（名前重複、スタッフ不足、日付範囲チェック）

### アーキテクチャ
- [x] モジュール分割（app.py / solver.py / utils.py / data_io.py）
- [x] デプロイ準備（requirements.txt, .gitignore, README.md, config.toml）
- [x] GitHubリポジトリ整備・プッシュ（v3.1: commit `770bb43`）

### 店舗管理
- [x] 🏪 複数店舗の切替・追加・削除・名前変更
- [x] 店舗ごとに独立したJSON保存（`stores/`フォルダ）
- [x] 店舗切替時のデータ自動読込

## TODO 📋
- [ ] Streamlit Community Cloud へのデプロイ（ユーザー操作）
- [ ] テストコードの追加
- [ ] パフォーマンス最適化（大人数対応）
- [ ] ダークモード対応
