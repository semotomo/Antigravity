# シフト作成ツール 改善・デプロイ計画

> 生成日: 2026-02-23
> 最終更新: 2026-08-24 10:42 JST
> ステータス: 計画中

## 目標
誰でも簡単に使える、どの端末からでもアクセスできるシフト作成ツールを実現する。

---

## 優先度マトリクス

| 優先度 | 機能 |
|--------|------|
| 🔴 必須 | UI/UX改善、レスポンシブ対応、エラーハンドリング強化、デプロイ |
| 🟡 推奨 | 入力バリデーション、ヘルプUI、設定プリセット |
| 🟢 任意 | ダークモード、多言語対応 |

---

## タスク一覧

## 🔴 進行中のタスク

- [ ] Next.js版「棚卸し・在庫管理」 `cc:WIP` `[feature:security]` `[feature:tdd]` `[feature:a11y]`
  - 状態: **Phase 5.1本番反映・実データ確認完了。実機カメラ/JANリーダー/物理プリンター確認待ち**
  - 詳細: `docs/inventory_management/implementation_plan.md`
  - 方針: 営業中の事前計数に対応し、商品ごとの計数時刻以降の販売・返品・移動・使用・調整を毎回再集計して現在庫を上書きする
  - 安全条件: `store_id + JAN` をUI・Server Action・API・DBで強制し、POSの在庫数は使用しない
  - [x] Phase 0: POS履歴のデータ契約・安定取引ID・認証経路を確定 `cc:done`
    - 完了確認: GAS version 56へ認証付きヘッダー診断を反映。両店舗とも元CSVに安定取引ID候補0件、行データ/ログ返却0件。通常履歴の本店858件・わんわん2,199件も回帰成功
  - [x] Phase 1: 店舗権限基盤と棚卸しDBスキーマをテスト先行で追加 `cc:done`
    - [x] ローカルmigration: 10テーブル、private権限helper、複合FK/CHECK/RLS/append-only監査を追加
    - [x] 検証: schema/preflight/rollback test 9/9、Phase 1を含む関連回帰35/35、Supabase linked dry-run、remote DB lint、型検査、本番build成功
    - [x] 本番前: 対象データbackup、schema snapshot、読み取り専用preflight、空テーブル限定rollbackを作成
    - [x] 初期権限確定: 本店専用1アカウントはstore 7、指定2アカウントはstore 6・7、すべてmanager
    - [x] 本番適用: 論理backupで進める承認後、preflight PASS、migration 1件、初期権限5行を適用
    - [x] 本番確認: migration 14/14一致、10テーブルRLS/FORCE RLS、権限helper、複合制約、DB lint、3アカウントの店舗分離を確認
  - [x] Phase 2: 冪等な在庫再計算・同期・監査ロジックを実装 `cc:done`
    - [x] 商品別`counted_at`以降のPOS/移動/使用/調整を全量再集計し、balanceを上書き
    - [x] POS snapshot、未照合、同分曖昧、重複ordinal、source fingerprint、run再利用を実装
    - [x] API/Action/RPCの認証・店舗再認可と、`store_id + JAN`のDB商品解決を実装
    - [x] 楽観ロック付き確定RPC、preflight/postapply/非破壊rollbackを実装
    - [x] Phase 2 TDD 17/17、関連回帰59/59、型、対象Lint、本番build、linked dry-run、本番読み取りpreflightを確認
    - [x] 本番migration 2件、postapply、実DB店舗越境・再計算冪等性テスト、migration 16/16、DB lintを確認
    - [x] Git commit `b8bc1f9`をmainへpushし、Vercel Preview・Production成功を確認
  - [x] Phase 3: 下書き・数量入力・JAN読取・進捗UIを実装 `cc:done`
    - [x] PCサイドメニューとスマホ「その他」の設定オプション直上へ導線を追加
    - [x] 店舗別の棚卸し開始・下書き再開・商品snapshot・数量保存RPCを追加
    - [x] 一覧数量入力、停止商品、カメラ/JANリーダー/手入力、再読取3択を実装
    - [x] 棚卸し済み・未棚卸し・進捗率・保存状態と店舗越境拒否を実装
    - [x] Phase 3 TDD 13/13、関連回帰72/72、型、対象Lint、本番build、linked dry-runを確認
    - [x] 本番DBへmigration 1件を適用し、postapply、rollback付きruntime test、履歴17/17、DB lintを確認
    - [x] Git commit `b08e195`をmainへpushし、Vercel Preview・Production成功を確認
    - [x] 本番PCと390×844スマホで導線・本店/わんわん開始画面・設定直上配置を確認（実データ保護のため開始/数量保存は未実行）
  - [x] Phase 3.1: 商品停止/解除とA4印刷基盤を追加 `cc:完了` (2026-08-24)
    - [x] 店舗別・理由必須・manager限定の商品停止/解除とappend-only監査を追加
    - [x] POS同期より手動停止を優先し、停止後も棚卸し数量を入力可能にする
    - [x] A4記入用/入力結果用の印刷ボタンと全件印刷専用画面を追加
  - [x] Phase 4: 確定・修正履歴・手動調整・現在庫画面を実装 `cc:完了` (2026-08-24)
    - [x] 現在庫を書き換えない確定前previewと問題一覧を追加
    - [x] 楽観ロック付き確定、理由付き除外、確定後数量訂正、手動調整を追加
    - [x] 販売/返品/移動/使用/調整の内訳、マイナス在庫、再同期を表示
    - [x] Phase 4 TDD 12/12、関連回帰84/84、型、対象Lint、本番build、linked dry-runを確認
    - [x] JSON論理backup（6,544商品、store 6下書き1件・2,764明細、SHA-256付き）と本番読み取りpreflightを完了
    - [x] migration本番適用、postapply、rollback付きruntime test、DB lintを実施（履歴18/18、runtime痕跡0件）
    - [x] Git commit `b082cfe`をmainへ反映し、Vercel Preview・Production成功と本番認証済み画面を確認
  - [x] Phase 5: A4記入用/結果リストと差異表示を実装 `cc:完了` (2026-08-24)
    - [x] 数量非表示の記入用と計算済み結果用、4種類の並び替え、A4印刷CSSをローカル実装
    - [x] Vercel Preview/Productionでスマホ表示、印刷画面、記入用88ページ・入力結果用67ページのA4 PDFを全ページ視覚確認
    - [x] 計算済み結果の全内訳列、マイナス赤表示、差異大の警告色がA4横へ収まることをQA fixtureで確認
  - [x] Phase 5.1: 印刷項目整理とGoogleスプレッドシート向けCSV出力 `cc:完了` (2026-08-24)
    - [x] 記入用タイトルを簡潔化し、仕入れ先・棚番号を印刷UIから外してカテゴリ幅を96pxへ縮小
    - [x] 店舗認証済みのUTF-8 CSV出力を追加し、記入用空欄・入力結果・計算結果をGoogleスプレッドシート向けに整形
    - [x] BOM/CRLF/引用符/改行/数式注入、店舗分離、関連回帰88/88、型、対象Lint、本番buildを確認
    - [x] commit `7382cbb`をGitHub mainへfast-forwardし、Vercel Production Readyと認証済み実データ2,764件の記入用/結果用表示、CSVボタンを確認
  - [ ] Phase 6: 回帰・型・Lint・本番ビルド・スマホ・印刷・段階リリース検証
    - [x] 静的回帰88/88、型検査、棚卸し対象Lint、本番build成功を本番反映前に確認
    - [x] 本番DB履歴18/18、Git main `7382cbb`、Vercel Production Ready、公開認証済み画面を確認
    - [x] スマホ導線、店舗分離、下書き再開、停止理由、A4全ページと計算結果警告色を確認
    - [ ] 実機カメラ/JANリーダー読取と物理プリンターでのA4出力を確認
    - [ ] 既存全体Lint 4 errors / 4 warningsは今回差分外として残存

## ✅ 完了済みのタスク

- [x] 商品移動・スマホ連続スキャン画面の表示領域改善 `cc:done` `[bugfix:reproduce-first]` `[feature:a11y]`
  - 対応内容: スマホでは連続スキャン画面を全画面化し、ヘッダー・完了ボタン・案内文を小型化。JANコード見出しとスキャン画面上部の余白を除去し、商品リストへ残りの高さを割り当ててタッチスクロールに対応
  - 完了確認: 2026-08-23（回帰テスト11件、型検査、対象Lint、本番ビルド成功。`origin/main`: `2e98826`、Vercel Productionデプロイ成功）

- [x] 入出庫履歴の返品相殺・商品一覧の価格表示調整 `cc:done` `[feature:tdd]` `[feature:a11y]`
  - 対応内容: 選択期間・店舗・同一商品ごとに販売数から返品数を相殺し、0以下は非表示。価格列を仕入れ先の左へ移し、粗利率を10%税込価格へ変更
  - 完了確認: 2026-08-23（回帰テスト16件、型検査、対象Lint、本番ビルド成功。`origin/main`: `a556eeb`、Vercelデプロイ成功）

- [x] 商品移動フォームの戻る操作離脱警告 `cc:done`
  - 対応内容: 入力途中のブラウザ戻る、Android戻る、iPhoneスワイプ戻るでも警告し、キャンセル時は入力を保持。続行時は保護履歴を残さず本来の前画面へ移動
  - 完了確認: 2026-08-23（回帰テスト11件、型検査、対象Lint、本番ビルド成功。`origin/main`: `d0f6bd4`、Vercelデプロイ成功）

- [x] 商品移動の離脱警告・登録リスト並び順修正 `cc:done`
  - 対応内容: 入力途中はスマホ下部タブを含むページリンクの移動前に警告し、キャンセル時は入力を保持する。新しく追加した商品と手入力待ち商品はリストの先頭に表示
  - 完了確認: 2026-08-23（回帰テスト9件、型検査、対象Lint、本番ビルド成功。`origin/main`: `0ad8559`、Vercelデプロイ成功）

- [x] 停止商品整理・リアルタイム入出庫履歴キャッシュ/自動更新 `cc:done`
  - 対応内容: 本店に残ったわんわんの停止商品10件を移管し、通常検索から停止商品を除外。店舗ごとの最終入出庫履歴をSupabaseに1世代保存し、画面再表示時に復元
  - 自動更新: Vercel Hobbyの実行幅と60秒上限を考慮し、本店は15時台/17時台、わんわんは16時台/18時台に店舗別実行
  - 完了確認: 2026-08-11（本店50件、わんわん67件を初回保存。店舗不整合・JAN重複・参照不整合0件。回帰テスト6件・型検査・Lint・本番ビルド成功）

- [x] 商品マスタの本店・わんわん完全分離 `cc:done`
  - 対応内容: Supabaseの商品キーを`store_id + jan_code`へ変更し、GAS同期、商品検索、客注、店舗間移動、POS別名、売上紐付けを店舗IDで分離
  - 完了確認: 2026-08-11（本店3,778件、わんわん2,754件、複合キー重複0件、不整合0件。GAS v55、`origin/main`: `7340f4e`、Vercelデプロイ成功）
  - 対象: Supabase `products` / `product_aliases` / 売上ビュー、GAS商品同期、Next.js商品検索・関連フォーム

- [x] POS商品マスタ本番反映・リアルタイム履歴店舗切替修復 `cc:done`
  - 対応内容: 履歴画面の`doSelectTenpoGroup`コールバックをGASで再現し、Next.jsの店舗ID対応・GASエラー表示・Vercel実行時間を修正。GAS v54とNext.js本番をデプロイ
  - 完了確認: 2026-08-11（本番画面の履歴: 本店2,532件、わんわん3,387件。商品同期: 本店3,778件、わんわん2,754件。`origin/main`: `0d7e375`、Vercelデプロイ成功）
  - 対象: `gas/autoDownload.js`、`next_app/app/api/gas/sync-products/route.ts`、`next_app/app/api/gas/history/route.ts`、`next_app/components/sales/SalesHistoryModal.tsx`

- [x] POS商品マスタの店舗分離・同期修復 `cc:done`
  - 対応内容: GAS/Git接続確認、店舗グループID検証、本店CSV 0件修復、CSV店舗ガード、共通JANの複数店舗タグ、店舗単位の旧所属整理、GAS v53デプロイ
  - 完了確認: 2026-08-11（本店3,778件、わんわん2,754件、共通JAN1,359件を本番同期・監査）
  - 対象: `gas/autoDownload.js`、`gas/importCSV.js`、`next_app/app/api/gas/sync-products/route.ts`、Supabase `products`

- [x] Next.js 売上/バーコード follow-up 修正 `cc:done`
  - 対応内容: iPad/写真バーコード読取の改善と、ホテル系サービスを「サービス以外」から除外する判定強化
  - 完了確認: 2026-05-01（`origin/main`: `62c1c1f`）

## 🟡 未着手のタスク

### Phase 1: コード品質 & 安定化
- [ ] 1. `app.py` を機能別にモジュール分割（ロジック / UI / ユーティリティ）[feature:refactor]
- [ ] 2. エラーハンドリング強化（不正入力、0人スタッフ等での例外処理）[feature:stability]
- [ ] 3. 入力バリデーション追加（公休数 > 日数チェック、名前重複チェック等）[feature:validation]

### Phase 2: UI/UX 改善
- [ ] 4. レスポンシブ対応CSS（モバイル・タブレットで使えるレイアウト）[feature:a11y]
- [ ] 5. 初回ユーザー向けのヘルプ/ガイド表示（使い方説明、ツールチップ）[feature:ux]
- [ ] 6. シフト結果のサマリー表示（統計情報：各スタッフの勤務日数、不足日のカウント等）[feature:ux]
- [ ] 7. ステータスメッセージとフィードバックの改善（成功/エラーの分かりやすい表示）[feature:ux]

### Phase 3: デプロイ準備
- [ ] 8. `requirements.txt` の作成（依存関係の明確化）[feature:deploy]
- [ ] 9. GitHubリポジトリの整備（`.gitignore`、README.md）[feature:deploy]
- [ ] 10. Streamlit Community Cloud へのデプロイ設定（`.streamlit/config.toml`）[feature:deploy]
- [ ] 11. デプロイ実行 & 動作確認 [feature:deploy]
