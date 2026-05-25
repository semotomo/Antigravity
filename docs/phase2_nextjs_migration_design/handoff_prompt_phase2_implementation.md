# 実装担当 AI へのハンドオフプロンプト

## あなたへの依頼

既存の Flet/Streamlit アプリから Next.js への移行プロジェクトの Phase 2 実装を担当してください。
今回は **2つの主要タスク** があります：

1. **商品移動管理（`/products/transfers`）の新設** + `/products` 周辺の導線リファクタリング
2. **売上管理機能の強化**（カテゴリフィルタ追加、ABC分析、日付ソート、GAS連携、日次→売上遷移）

設計は完了済みです。コード変更はまだしていません。

---

## 必読ドキュメント（この順番で読んでください）

1. `docs/ai_best_practices/best_practices.md` — AI ツール運用方針・禁止事項
2. `docs/phase2_nextjs_migration_design/inventory_transfers_design.md` — **メイン設計書（全体設計・UI・アーキテクチャ・実装ステップ）**
3. `docs/phase2_nextjs_migration_design/gas_webapp_setup_guide.md` — GAS Web App デプロイ手順（ユーザーが実施済みの前提）

## 必読ソースコード

以下のファイルを読んでパターンを把握してから実装してください：

### 既存パターンの理解（参考実装）
- `next_app/components/products/ProductsBoard.tsx` — ヒーロー+サマリー+DataTable パターン
- `next_app/components/orders/OrderFormModal.tsx` — モーダル+useActionState パターン
- `next_app/components/orders/JanCodeScannerField.tsx` — **バーコード読取コンポーネント（そのまま再利用）**
- `next_app/components/products/ProductsSubnav.tsx` — 現在のサブナビ（修正対象）
- `next_app/components/layout/SideNav.tsx` — サイドナビ（修正対象）
- `next_app/components/layout/BottomNav.tsx` — ボトムナビ（修正対象）

### 売上系（修正対象）
- `next_app/app/(dashboard)/sales/page.tsx` — 売上一覧ページ
- `next_app/app/(dashboard)/sales/daily/page.tsx` — 日次集計ページ
- `next_app/lib/queries/sales.ts` — 売上クエリ関数
- `next_app/lib/queries/summary.ts` — 集計クエリ関数

### 旧 Flet 版（移動ロジックの参考）
- `flet_app/core/inventory/db.py` — 移動関連の DB 操作
- `flet_app/core/inventory/view_model.py` — 移動関連のビジネスロジック

### GAS（Web App 連携）
- `gas/autoDownload.gs` — POS データ取得 + `doGet()` が追加済み（ユーザーがデプロイ済みの前提）
- `gas/importCSV.gs` — CSV → Supabase upsert 処理

---

## 実装ステップ（この順番で進めてください）

### Step 1: 導線のリファクタリング（3ファイル修正）

| ファイル | 変更内容 |
|---------|---------|
| `SideNav.tsx` | 「未一致解消」→「商品管理」(`/products`) に変更。アイコンを `AlertTriangle` → `Package` に |
| `BottomNav.tsx` | 「未一致」→「商品」(`/products`) に変更 |
| `ProductsSubnav.tsx` | タブに「店舗間移動」(`/products/transfers`) 追加。「未一致解消」をタブから削除し、右端の overflow メニュー `[⋯]` に移動 |

**検証**: `npm run build` が通ること

### Step 2: データ層の確立（4ファイル新規 + 1ファイル修正）

| ファイル | 内容 |
|---------|------|
| `lib/types/database.ts` | `transfers` テーブルの型定義を追加 |
| `lib/transfers.ts` | 型エイリアス、`TransferMutationState` 等 |
| `lib/queries/transfers.ts` | `fetchTransferHistory()`, `fetchStores()`, `searchProductByJan()` |
| `app/actions/transfers.ts` | `createTransfersAction`, `deleteTransferAction` のスケルトン |

**重要**: `transfers` テーブルの join は FK 名依存:
```typescript
.select(`
  *,
  stores!transfers_from_store_id_fkey(name),
  stores!transfers_to_store_id_fkey(name)
`)
```

### Step 3: 移動履歴一覧画面（2ファイル新規）

| ファイル | 内容 |
|---------|------|
| `app/(dashboard)/products/transfers/page.tsx` | Server Component。初期データ取得 |
| `components/transfers/TransfersBoard.tsx` | ヒーロー + サマリーカード + フィルタ + DataTable。各行に「削除」ボタン |

### Step 4: 移動登録モーダル + バーコード + 削除（1ファイル新規 + Actions 本実装）

| ファイル | 内容 |
|---------|------|
| `components/transfers/TransferFormModal.tsx` | 移動登録モーダル。`JanCodeScannerField` を import して使用 |
| `app/actions/transfers.ts` | `createTransfersAction`（一括INSERT）、`deleteTransferAction`（確認後DELETE） |

**バーコード連携**: `@/components/orders/JanCodeScannerField` をそのまま import。カメラ読取 → JAN → `searchProductByJan()` → リスト追加。

**削除機能**: 履歴テーブル各行の「削除」ボタン → 確認ダイアログ → `deleteTransferAction(transferId)` で DELETE + `revalidatePath`。

### Step 5: 売上一覧の改善 + GAS Web App 連携（3ファイル修正 + 1ファイル新規）

| ファイル | 内容 |
|---------|------|
| `sales/page.tsx` | カテゴリに「サービス以外」ピル追加 / 日付ソート切替ボタン / 「📊 売上データ取込」ボタン |
| `lib/queries/sales.ts` | `fetchSales()` に `sortOrder` パラメータ追加、`excludeCategory` フィルタ追加 |
| `sales/daily/page.tsx` | `sale_date` を `/sales?dateFrom=...&dateTo=...` へのリンクに変更 |
| `app/api/gas/trigger/route.ts` | GAS Web App URL を fetch() する API Route |

**GAS 連携の実装詳細**:
- `.env.local` の `GAS_WEBAPP_URL` がサーバー側環境変数として設定済み（ユーザーが設定）
- API Route は `POST` メソッドで受け付け、内部で GAS URL を `GET` で fetch
- 認証チェック必須（Supabase の `createClient()` で認証確認）
- 成功時に `revalidatePath('/sales')` を実行
- フロント側はボタンクリックで `fetch('/api/gas/trigger', { method: 'POST' })` を呼び、ローディング中はスピナー表示、完了後にトースト

**「サービス以外」フィルタ**:
- カテゴリ名は `サービス` で確定
- `fetchSales()` に `excludeCategory` が渡された場合: `.neq('category', excludeCategory)`

### Step 6: ABC 分析画面（2ファイル新規 + ナビ修正）

| ファイル | 内容 |
|---------|------|
| `lib/queries/abc.ts` | `fetchAbcAnalysis(dateFrom, dateTo, storeName?)` |
| `app/(dashboard)/sales/abc/page.tsx` | ABC 分析画面 |
| `SideNav.tsx` / `BottomNav.tsx` | ABC 分析メニュー追加 |

**ABC ランク閾値**: A: 上位70% / B: 70-90% / C: 90-100%（確定済み）
**データソース**: `sales_product_summary_v` を期間フィルタ → JS側で累積構成比計算 → ランク付与

---

## 確認済みの仕様（全件ユーザー承認済み）

| 項目 | 決定内容 |
|------|---------|
| 移動テーブル | 既存 `transfers`（フラット構造）をそのまま使う |
| ステータス | なし（登録＝確定） |
| 削除機能 | **必要**。確認ダイアログ付き。編集は Phase 1 では不要 |
| GAS 連携 | Web App デプロイ済み。API Route 経由で呼び出し |
| ABC 閾値 | A:70% / B:90% / C:100% |
| 除外カテゴリ | 「サービス」 |

---

## 守るべきルール

1. **コメントは日本語** で書くこと
2. **実装前にユーザーに計画を説明** し承認を得てから進めること
3. **既存パターンに合わせる**: Server Component でデータ取得 → Client Component で状態管理 → Server Actions でデータ更新
4. `JanCodeScannerField.tsx` は **変更しない**。import して使うだけ
5. `products/unmatched/page.tsx` も **変更しない**。導線のみ変わる
6. `total_cost` は Server Action 側で `cost_price * quantity` を計算して INSERT
7. `best_practices.md` の禁止事項を遵守すること

---

## 環境情報

- Next.js 16 (App Router)
- React 19 + `useActionState`
- Supabase (PostgreSQL) + `@supabase/ssr`
- Tailwind CSS v4
- Lucide React（アイコン）
- Vercel にデプロイ
- Node.js / npm

## 検証方法

各 Step 完了後に:
1. `npm run build` が通ること
2. ローカルで `npm run dev` → 該当ページが正常表示されること
3. ブラウザで実際の操作フロー（登録・削除・フィルタ等）が動くこと
