# Repo Split Strategy

更新日: 2026-03-28

## 1. 結論

運用前にやるべきことは、まず `branch を分けること` であり、`repo を全部いきなり分けること` ではない。

現時点のおすすめは次の通り。

- 今すぐやる
  - 移行専用 branch を切る
  - `gas/` を別 repo にする準備を始める
- Phase 1 安定後にやる
  - Supabase 運用用の SQL / 検証 / ドキュメントを別 repo 化する
- まだやらない
  - Budibase と Flet を細かく別 repo に分ける

## 2. なぜ全部を今すぐ分けないか

現状はまだ移行途中で、次が密接につながっている。

- Flet の現行実装
- Supabase の実テーブル確認
- Budibase 向けのスキーマ拡張
- 移行ドキュメント

この段階で repo を細かく分けすぎると、むしろ変更の追跡とレビューが複雑になる。

## 3. 今すぐ分けるべきもの

### 3-1. branch

最低限、branch は分ける。

おすすめ:

- `main`
  - 現行安定線
- `migration/budibase-phase1`
  - 現在の移行作業本線
- `hotfix/flet-*`
  - 現行 Flet 側の緊急修正

推奨タグ:

- `pre-budibase-phase1`
- `pre-cutover`
- `post-phase1-schema`

### 3-2. GAS

`gas/` は運用前に別 repo にする価値が高い。

理由:

- 実行環境が Apps Script で別
- 認証や権限の扱いが別
- デプロイと障害切り分けの単位が別
- Budibase / Supabase スキーマ変更とは連動するが、リリース周期は分けた方が安全

候補名:

- `antigravity-gas-automation`
- `antigravity-pos-automation`

切り出し対象:

- `gas/autoDownload.gs`
- `gas/importCSV.gs`
- `gas/README.md`
- `gas/supabase_integration_guide.md`
- `gas/supabase_product_sales_integration_guide.md`

## 4. Phase 1 安定後に分けるもの

### 4-1. Supabase 運用 repo

Phase 1 の SQL が安定したら、Supabase 運用用 repo を分けるのが良い。

候補名:

- `antigravity-supabase-ops`
- `antigravity-data-platform`

入れるもの:

- `inventory/supabase_phase1_additive.sql`
- `inventory/supabase_phase1_verify.sql`
- 既存 schema SQL
- `docs/app_migration/` のうちスキーマ / 移行 / 完成定義に関する文書

理由:

- SQL と検証手順を本番運用の単位で管理できる
- Budibase 側の画面調整と切り離してレビューできる
- DB 変更履歴を明確に残せる

## 5. まだ分けない方がよいもの

### 5-1. Budibase

Budibase は、今の時点では別 repo にしなくてよい。

理由:

- まだ本格的な Budibase アプリ資産が repo 内に存在していない
- まずは Supabase の schema/view と業務項目定義を固める方が先
- Budibase が SaaS / 管理画面中心なら、repo に置くべきものは export 定義や設定資料になる

分けるタイミング:

- Budibase アプリの export JSON
- カスタムコンポーネント
- 運用手順

が増えてからで十分

### 5-2. Flet

Flet は移行完了までは今の repo に残す方がよい。

理由:

- まだ現行参照元として必要
- Supabase 契約の互換確認に使う
- hotfix が出る可能性がある

分けるタイミング:

- Budibase 側で主要 4 領域
  - 売上
  - 商品移動
  - 客注
  - シフト結果閲覧
  が成立した後

## 6. おすすめの段階的な切り方

### Step 1. 今

- この repo を継続利用
- `migration/budibase-phase1` branch を本線にする
- Flet / Supabase / docs は同じ repo で進める

### Step 2. 運用前

- `gas/` を別 repo に切り出す
- Secrets とデプロイ手順を GAS repo 側で管理する

### Step 3. Phase 1 安定後

- Supabase 運用 repo を切る
- SQL
- verify SQL
- schema docs
- runbook
を集約する

### Step 4. Budibase 本格運用後

- 必要なら Budibase export / custom code 専用 repo を作る
- Flet は `legacy` として branch か archive repo に移す

## 7. 現在のディレクトリをどう扱うか

### 当面この repo に残す

- `flet_app/`
- `tests/`
- `docs/app_migration/`
- `inventory/`
- `stores/`
- `shift_history/`

### 先に分離候補

- `gas/`

### 後で整理候補

- 旧 Streamlit 由来ファイル
  - `app.py`
  - backup 群
  - 検証スクリプト群

## 8. 最小構成の推奨

いま一番バランスが良いのは次。

1. branch は分ける
2. repo はまだ monorepo ベースで進める
3. 運用前に `gas/` だけ別 repo にする
4. Phase 1 安定後に Supabase 運用 repo を追加する

## 9. 参照

- [completion_definition.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/completion_definition.md)
- [implementation_plan.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/implementation_plan.md)
- [schema_alignment_snapshot_2026-03-28.md](/Users/kirik/Desktop/Antigravity/docs/app_migration/schema_alignment_snapshot_2026-03-28.md)
- [supabase_phase1_additive.sql](/Users/kirik/Desktop/Antigravity/inventory/supabase_phase1_additive.sql)
- [supabase_phase1_verify.sql](/Users/kirik/Desktop/Antigravity/inventory/supabase_phase1_verify.sql)
