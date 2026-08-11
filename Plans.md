# シフト作成ツール 改善・デプロイ計画

> 生成日: 2026-02-23
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

- なし

## ✅ 完了済みのタスク

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
