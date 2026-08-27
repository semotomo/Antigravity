# Sentry 導入・段階リリース計画

## 現在の状態

- `@sentry/nextjs` をローカルの専用作業ツリーへ導入済み
- DSNが空の環境ではSDKを無効化し、外部送信しない
- client / Node.js server / Edge / Next.js request error / global error boundaryを接続済み
- Session Replayは導入しない
- Cookie、HTTPヘッダー、本文、URLクエリ、DBクエリ値、ローカル変数、パンくずを収集しない
- 本番既定のトレースサンプル率は5%。環境変数で0〜1の範囲に変更可能
- Sentryプロジェクト作成、Vercel環境変数登録、Git push、本番デプロイは未実施

## Phase 1: ローカル準備

1. SDK・各runtime設定・エラー境界を追加する
2. DSN未設定時の無効化とデータ収集制限をテストする
3. 回帰、型、Lint、本番build、依存関係監査を実施する

## Phase 2: 外部サービス準備（承認後）

1. Sentry上にKennel専用Organization/Projectを作成する
2. Data Scrubbingと保存期間をSentry管理画面でも確認する
3. Client Key (DSN) と、source map専用の最小権限tokenを発行する
4. コード内に残っていたCMSパスワードをCMS側で変更する

## 依存関係監査・更新（2026-08-27）

初回の`npm audit --omit=dev`は本番依存で高6件・低1件を報告した。Codex Securityのリポジトリスキャンとは別の、npm依存関係だけの結果である。

| 対象 | 経路 | 状態 |
|---|---|---|
| Next.js / eslint-config-next | 直接依存 | 16.2.1から16.3.3へ更新済み |
| PostCSS / sharp / nanoid | Next.js/Tailwind経由 | 親依存の更新で解消済み |
| undici | cheerio経由 | 7.29.0へ更新済み |
| ws | Supabase Realtime経由 | 8.21.3へ更新済み |
| Babel core | Sentry build plugin経由 | 7.29.7へ更新済み |
| brace-expansion / js-yaml | 開発ツール経由 | 許容範囲内の修正版へ更新済み |

`npm audit fix`は使用せず、対象を限定して更新した。更新後は`npm audit`と`npm audit --omit=dev`の両方で脆弱性0件、回帰100/100、型検査、対象Lint、本番build成功を確認した。

## Codex Security標準スキャン（2026-08-27）

scan ID `249454a2-26b5-491b-bf2b-91790475130c`で、専用作業ツリー全体452ファイルを対象に標準スキャンを完了した。結果はhigh 4件、medium 2件。棚卸し専用の`user_store_access`、`store_id + JAN`複合制約、確定・再計算RPC、追記監査、冪等調整には新しい重大指摘はなかった。

修正対象は、既存テーブルの匿名全許可RLS、編集可能な`user_metadata`を使うmaster判定、店舗間移動の更新・削除における対象店舗の再認可不足、移動履歴印刷の未エスケープHTML、売上推移APIの店舗混在、Git履歴に残る旧アプリ用パスワード。値のローテーション、本番RLS変更、コード修正、Git履歴整理はこのスキャンでは実施していない。

TAC状態はunknownで、独立レビュー用ワーカーは利用上限のため起動できなかった。親エージェントによる全対象の順次レビューは完了しているが、利用可能になり次第、独立レビューを追加する。

## Phase 3: Vercel Previewで確認（承認後）

次の値をVercel Previewだけに登録する。値はGitへ保存しない。

- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_ENVIRONMENT=preview`
- `NEXT_PUBLIC_SENTRY_ENVIRONMENT=preview`
- `SENTRY_TRACES_SAMPLE_RATE=0`
- `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0`
- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `CMS_USERNAME`
- `CMS_PASSWORD`

Previewで意図的なテストエラーを1件だけ送信し、本文・Cookie・認証ヘッダー・クエリ・商品情報が含まれないことを確認する。確認後はテスト用経路を削除する。

## Phase 4: Production反映（別承認）

1. 対象差分とPreview結果を提示する
2. Production用環境変数を設定する
3. 初期トレース率5%でデプロイする
4. 実エラー受信、source map解決、既存棚卸し・同期・認証の回帰を確認する
5. 通知先とアラート閾値を決める

## ロールバック

- DSNをVercelから外すとSDK送信は停止する
- 緊急時はSentry設定を戻して再デプロイする
- Sentry障害は棚卸し・同期処理の成功可否へ影響させない
