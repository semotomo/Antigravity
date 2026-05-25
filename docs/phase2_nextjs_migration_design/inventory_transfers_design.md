# 商品移動管理の新設 & `/products` 導線リファクタリング 設計書

更新日: 2026-04-08
対象: 次の実装担当 AI / 開発者

---

## 0. 現状理解の要約

### 0-1. Next.js 側（現在のダッシュボード）

**実装済みルート:**

| パス | 機能 | 備考 |
|------|------|------|
| `/orders` | 客注管理 | カード一覧 + ステータス更新 |
| `/products` | 商品マスタ一覧 | DataTable + 編集モーダル |
| `/products/aliases` | エイリアス管理 | 紐付けリスト + 変更・削除 |
| `/products/unmatched` | 未一致商品の解消 | 2ペイン（左: POS名一覧 / 右: 紐付けパネル） |
| `/sales`, `/sales/daily`, `/sales/products` | 売上系 | 実装済み |

**`/products` まわりの現在の導線:**
- `ProductsSubnav.tsx` が「商品マスタ」「エイリアス管理」「未一致解消」の3タブを横並びで出している
- SideNav.tsx は「未一致解消」が `/products/unmatched` へ直リンク（アイコン: AlertTriangle）
- BottomNav.tsx も同様に「未一致」が `/products/unmatched` へ直リンク
- SideNav / BottomNav には `/products` 本体への直リンクがない

**課題:**
- 「未一致解消」は日常的に使うものではないのに SideNav / BottomNav のトップレベルにいる
- 商品移動管理がまだ Next.js 側に存在しない（Flet版のみ）
- `/products` ルートグループが「マスタ」「エイリアス」「未一致」の3つだけで、より重要な「移動管理」がない

### 0-2. 旧 Flet 版の在庫移動機能

`flet_app/pages/inventory.py` + `flet_app/core/inventory/db.py` + `view_model.py` を調査した結果:

**Flet 版の概要:**
- **3タブ構成**: 「移動入力」「移動履歴」「商品マスタ」
- **移動入力フロー**: 移動元 / 移動先の店舗を選択 → JAN コードで商品検索 → 移動リストに追加（数量 ±）→ 一括登録
- **移動履歴**: 日付範囲 + 店舗フィルタで `transfers` テーブルを検索して表示
- **データモデル**: `transfers` テーブルへフラットに 1商品1行で保存（ヘッダ/明細分離なし）

**Flet 版が使っている DB テーブル:**
- `stores` — 店舗マスタ（`id: integer`, `name`)
- `products` — 商品マスタ（JAN検索で利用）
- `transfers` — 移動記録（フラット構造。`from_store_id`, `to_store_id`, `jan_code`, `product_name`, `quantity`, `cost_price`, `total_cost`, `selling_price`, `memo`, `transfer_date`）
- join: `stores!transfers_from_store_id_fkey(name)`, `stores!transfers_to_store_id_fkey(name)`

### 0-3. DB スキーマドキュメントの計画

`budibase_supabase_schema.md` には将来のヘッダ+明細分離として以下が計画されている:
- `inventory_transfer_headers` — 1回の移動登録を1件管理（`transfer_no`, `from_store_id`, `to_store_id`, `status`, `memo`, `created_by`）
- `inventory_transfer_items` — 明細（`transfer_id`, `product_id`, `jan_code`, `product_name`, `quantity`, `cost_price`, `selling_price`）

ただし、**この2テーブルは現時点で Supabase 上に存在しない**（SQL に言及はあるが `CREATE TABLE` 未実行）。
現在実在するのは `transfers`（フラット構造）のみ。

---

## 1. 推奨する情報設計

### 1-1. `/products` まわりのナビゲーション再編

#### 変更の方針

| 項目 | 現状 | 変更後 |
|------|------|--------|
| SideNav トップレベル | 「未一致解消」→ `/products/unmatched` | **「商品管理」→ `/products`**（商品全般のハブ） |
| BottomNav | 「未一致」→ `/products/unmatched` | **「商品」→ `/products`** |
| ProductsSubnav タブ | 商品マスタ / エイリアス管理 / 未一致解消 | **商品マスタ / エイリアス管理 / 店舗間移動** |
| 未一致解消への導線 | タブに常時表示 | **ProductsSubnav 右端の「⋯」メニュー内に移動** |

#### PC レイアウト

```
SideNav                  │ メインコンテンツ
─────────────────────────┤──────────────────────────────────────
客注管理                 │ [ ProductsSubnav ]
商品管理 ← NEW          │  商品マスタ | エイリアス管理 | 店舗間移動  [⋯]
売上一覧                 │                                    └→ 未一致解消
日次集計                 │ (ページ本体)
商品別集計               │
```

#### モバイル レイアウト

```
┌────────────────────────────────────┐
│ KENNEL                             │
├────────────────────────────────────┤
│ [ ProductsSubnav ]                 │
│  マスタ | エイリアス | 移動  [⋯]    │
│                          └→ 未一致  │
│ (ページ本体)                       │
├────────────────────────────────────┤
│ 客注 │ 商品 │ 一覧 │ 日次 │ 商品別 │
└────────────────────────────────────┘
      ↑ NEW（/products へリンク）
```

### 1-2. ルート構成

| パス | 機能 | 変更種別 |
|------|------|----------|
| `/products` | 商品マスタ一覧・編集 | 既存（変更なし） |
| `/products/aliases` | エイリアス管理 | 既存（変更なし） |
| `/products/unmatched` | 未一致解消 | 既存（コード変更なし。導線のみ移動） |
| **`/products/transfers`** | **店舗間移動管理** | **新規** |

> **Q: なぜ `/transfers` や `/inventory` ではなく `/products/transfers` か？**
> - `ProductsSubnav` のタブとして自然に並べられる
> - 商品に関わる操作が `/products` 配下に集約される
> - SideNav のリンク先は `/products`（ハブ）1本に統一でき、余計なトップレベルメニューが増えない

---

## 2. データ設計の整理

### 2-1. 現行テーブル `transfers`（フラット構造）をそのまま使う理由

| 選択肢 | メリット | デメリット |
|--------|---------|-----------|
| 既存 `transfers` をそのまま使う | DB変更なし / Flet版と並行運用可能 / 即座に着手可能 | 今後の拡張（承認フロー等）には不向き |
| 新規 `inventory_transfer_headers` + `items` を作る | 将来設計に沿う / ステータス管理が自然 | DDL 適用が必要 / Flet版との並行が複雑に |

**推奨: Phase 1 は `transfers` をそのまま使う。**

理由:
- 現在 `inventory_transfer_headers` / `items` は Supabase に存在しない
- DDL 追加はリスク要因になる（既存の RLS や policy との整合確認が必要）
- 旧 Flet 版を並行運用している間は、同じテーブルを共有した方が安全
- 承認フローやステータス管理の要件は現時点では不明

**Phase 2 以降で `header + items` 構造への移行を検討する。**

### 2-2. 使用するテーブルと関係

```
stores (id: int, name)
  │
  ├── transfers.from_store_id ──→ stores.id
  └── transfers.to_store_id  ──→ stores.id
       │
       └── transfers (id: int, transfer_date, from_store_id, to_store_id,
                       jan_code, product_name, quantity,
                       cost_price, total_cost, selling_price, memo, created_at)

products (id: int, jan_code, product_name, cost_price, selling_price, category, ...)
  └── JAN検索で transfers に追加する商品情報を引くために利用
```

### 2-3. `database.ts` に追加が必要な型

現在 `database.ts` には `transfers` テーブルの型定義がない。以下を追加する:

```typescript
transfers: {
  Row: {
    id: number
    transfer_date: string
    from_store_id: number
    to_store_id: number
    jan_code: string
    product_name: string
    quantity: number
    cost_price: number
    total_cost: number
    selling_price: number
    memo: string | null
    created_at: string
  }
  Insert: {
    id?: number
    transfer_date?: string
    from_store_id: number
    to_store_id: number
    jan_code: string
    product_name: string
    quantity: number
    cost_price: number
    total_cost?: number
    selling_price: number
    memo?: string | null
    created_at?: string
  }
  Update: { /* 各フィールド optional */ }
  Relationships: []
}
```

---

## 3. UI 設計

### 3-1. `/products/transfers` — 店舗間移動管理

この画面は Flet 版の「移動入力」タブと「移動履歴」タブを 1 ページに統合する。

#### 画面構成

```
┌──────────────────────────────────────────────────┐
│ [ ProductsSubnav ]                               │
│  商品マスタ | エイリアス管理 | (店舗間移動) [⋯]   │
├──────────────────────────────────────────────────┤
│ ヒーロー: 「店舗間移動管理」                      │
│  サマリーカード × 3                               │
│  - 今日の移動件数                                │
│  - 今月の移動件数                                │
│  - 原価合計                                      │
├──────────────────────────────────────────────────┤
│ [新規移動を登録] ボタン → モーダルが開く          │
├──────────────────────────────────────────────────┤
│ フィルタバー                                     │
│  期間: [開始日] ～ [終了日]                       │
│  移動元: [店舗選択]  移動先: [店舗選択]           │
│  [検索]                                          │
├──────────────────────────────────────────────────┤
│ 移動履歴テーブル (DataTable)                     │
│  日時 | 移動元 | 移動先 | JAN | 商品名           │
│       | 数量 | 原価 | 原価合計 | メモ             │
└──────────────────────────────────────────────────┘
```

#### 新規移動登録モーダル (`TransferFormModal`)

```
┌──────────────────────────────────────┐
│ 新規移動の登録                       │
│                                      │
│ 移動元店舗: [▼ セレクト]             │
│ 移動先店舗: [▼ セレクト]             │
│                                      │
│ ─── 商品を追加 ───                   │
│ JANコード: [入力] [📷 カメラで読取]  │
│            [🔍 検索]                 │
│                                      │
│ (検索結果: 商品名 / 原価 / 売価)     │
│ 数量: [1] [+ -]                      │
│ メモ: [入力]                         │
│ [移動リストに追加]                   │
│                                      │
│ ─── 今回の移動リスト (0件) ───        │
│ (追加した商品がカード形式で並ぶ)     │
│ 合計: 0種 / 0個 / ¥0               │
│                                      │
│ [キャンセル]          [一括登録する]  │
└──────────────────────────────────────┘
```

**モーダル内のフロー（Flet版を参考）:**
1. 移動元・移動先を選択
2. JAN コードで商品検索 → **カメラ読取 or 手入力** → `products` テーブルから取得
3. 見つかった場合: 情報を表示 → 「リストに追加」
4. 見つからない場合: 手入力フォーム（商品名・原価・売価）を表示 → 「未登録商品として追加」
5. リストに複数商品を追加可能（数量 ±、削除）
6. 「一括登録する」で `transfers` に一括 INSERT

#### バーコード（JAN コード）読取の実装方針

**既存資産の活用:**
`components/orders/JanCodeScannerField.tsx` がすでに客注管理で使われており、以下の機能を持つ:
- Web BarcodeDetector API を利用したカメラ読取
- EAN-13 / EAN-8 / UPC-A / UPC-E フォーマット対応
- 自動正規化（UPC-A → 13桁 JAN への変換）
- HTTPS / localhost 判定によるフォールバック
- カメラ権限エラーのハンドリング

**移動管理での利用方法:**
`JanCodeScannerField` をそのまま再利用するか、コアロジック（カメラ起動・検出・正規化）を共通 hook `useJanScanner()` として切り出し、移動管理モーダルの JAN 入力欄に組み込む。

推奨は **そのまま `<JanCodeScannerField>` を `TransferFormModal` 内で使う**（最も工数が少ない）。読み取った JAN コードが `input` の `value` に反映されるので、その値で `searchProductByJan()` を呼ぶだけでフローが繋がる。

**注意:** `JanCodeScannerField` の `name` 属性は `"jan_code"` 固定なので、フォーム構造内で名前の衝突がないことを確認する。

### 3-2. `ProductsSubnav` の右端メニュー（未一致解消への導線）

```
[ 商品マスタ ] [ エイリアス管理 ] [ 店舗間移動 ]     [⋯]
                                                      │
                                                      ├── 未一致解消
                                                      └── (将来: CSV一括登録 など)
```

- `⋯` ボタンクリックで Popover / DropdownMenu が開く
- 「未一致解消」リンクが `/products/unmatched` へ遷移
- 既存の `/products/unmatched` ページのコードは一切変更しない

---

## 4. 実装アーキテクチャ設計

### 4-1. Server Component / Client Component / Server Actions の責務分割

既存の `/orders` や `/products` のパターンに完全に合わせる:

| レイヤー | ファイル | 責務 |
|----------|---------|------|
| Server Component | `app/(dashboard)/products/transfers/page.tsx` | 初期データ取得（移動履歴 + 店舗一覧）を `lib/queries/transfers.ts` 経由で行い、Client Component に渡す |
| Client Component | `components/transfers/TransfersBoard.tsx` | 一覧表示、フィルタの状態管理、モーダル開閉 |
| Client Component | `components/transfers/TransferFormModal.tsx` | 新規移動登録モーダル。ローカル state で移動リストを管理し、送信時に Server Action を呼ぶ |
| Server Actions | `app/actions/transfers.ts` | `createTransfersAction(formData)` — 一括 INSERT + `revalidatePath` |
| Query 層 | `lib/queries/transfers.ts` | `fetchTransferHistory()`, `fetchStores()`, `searchProductByJan()` |
| ドメイン型 | `lib/transfers.ts` | 型定義、バリデーション、定数 |

### 4-2. 既存コンポーネントの参考先

| 新規コンポーネント | 参考にすべき既存コンポーネント | 理由 |
|---|---|---|
| `TransfersBoard.tsx` | `ProductsBoard.tsx` | ヒーロー + サマリーカード + 検索 + DataTable のレイアウトパターン |
| `TransferFormModal.tsx` | `OrderFormModal.tsx` | モーダル + `useActionState` + Server Action の結合パターン |
| JAN 入力 + カメラ | `JanCodeScannerField.tsx` | **そのまま再利用**。カメラ読取 + 手入力 + 正規化が完成済み |
| JAN 検索 UI | `ProductSearchCombobox.tsx` | 検索して候補を出すパターン（ただし移動ではJAN完全一致検索に寄せる） |

### 4-3. Query 関数一覧

**`lib/queries/transfers.ts`:**

| 関数名 | 用途 | 備考 |
|--------|------|------|
| `fetchTransferHistory(filters)` | 移動履歴を日付範囲・店舗で絞り込んで取得 | `transfers` + `stores` を join。Flet の `db.get_transfers()` 相当 |
| `fetchStores()` | 全店舗一覧を取得 | `stores` テーブル。移動元/先のドロップダウン用 |
| `searchProductByJan(jan)` | JAN コードで商品を 1 件検索 | `products` テーブル。Flet の `db.search_product_by_jan()` 相当 |

**既存 `lib/queries/products.ts` からの再利用:**
- `fetchActiveProducts()` は必要なら再利用可能だが、移動画面ではJAN完全一致検索が主なので新関数 `searchProductByJan` を別途作る

### 4-4. Server Actions 一覧

**`app/actions/transfers.ts`:**

| Action 名 | 責務 | 入力 | 出力 |
|-----------|------|------|------|
| `createTransfersAction(prevState, formData)` | 移動リストを一括で `transfers` に INSERT | FormData に JSON エンコードした移動アイテム配列 | `TransferMutationState` |

FormData の構造:
```
items: JSON.stringify([
  { jan_code, product_name, quantity, cost_price, selling_price, memo },
  ...
])
from_store_id: "1"
to_store_id: "2"
```

Action 内の処理:
1. `requireAuthenticatedClient()` で認証確認
2. `from_store_id`, `to_store_id` のバリデーション（同一店舗チェック含む）
3. `items` JSON をパースし、各アイテムのバリデーション
4. `transfers` テーブルへ一括 INSERT（`transfer_date` は Server 側で `new Date().toISOString()` を付与）
5. `revalidatePath('/products/transfers')`
6. `refresh()`

### 4-5. `revalidatePath` の方針

| アクション | revalidate 対象 |
|-----------|----------------|
| `createTransfersAction` | `/products/transfers` |
| 既存の `updateProductAction` | `/products` + `/sales` 系（変更なし） |
| 既存の `matchToExistingProductAction` | `/products/unmatched` + `/sales` 系（変更なし） |

### 4-6. URL search params の方針

移動履歴のフィルタ（日付範囲、店舗）は **`useState` でクライアント側に保持** する。

理由:
- 既存の `ProductsBoard` や `OrdersBoard` もフィルタを URL に出さず state で管理している
- 一貫したパターンを保つ
- 初期データは Server Component で直近30日分を渡し、クライアントでのフィルタ変更は `useTransition` + Router refresh または追加のクライアントサイドフェッチで対応

ただし将来的にフィルタ状態を URL に持たせたくなった場合は、`searchParams` を Server Component で受けて query に反映する構成にリファクタ可能。

---

## 5. 追加・更新が必要なファイル一覧

### 新規作成（商品移動関連）

| ファイル | 役割 |
|---------|------|
| `app/(dashboard)/products/transfers/page.tsx` | 移動管理画面の Server Component |
| `app/actions/transfers.ts` | 移動関連の Server Actions |
| `lib/queries/transfers.ts` | 移動関連のデータ取得関数 |
| `lib/transfers.ts` | 型定義・定数・バリデーション |
| `components/transfers/TransfersBoard.tsx` | 移動管理の本体 Client Component |
| `components/transfers/TransferFormModal.tsx` | 新規移動登録モーダル（`JanCodeScannerField` を内包） |

### 新規作成（売上機能追加）

| ファイル | 役割 |
|---------|------|
| `app/(dashboard)/sales/abc/page.tsx` | ABC分析画面 |
| `lib/queries/abc.ts` | ABC分析用のクエリ関数 |
| `app/api/gas/trigger/route.ts` | GAS Web App を呼び出す API Route |

### 既存修正（商品導線）

| ファイル | 変更内容 |
|---------|---------|
| `components/products/ProductsSubnav.tsx` | タブに「店舗間移動」追加 / 右端に overflow メニュー（「未一致解消」）/ 「未一致解消」をタブから削除 |
| `components/layout/SideNav.tsx` | 「未一致解消」→「商品管理」(`/products`) に変更 + アイコン変更 |
| `components/layout/BottomNav.tsx` | 「未一致」→「商品」(`/products`) に変更 |
| `lib/types/database.ts` | `transfers` テーブルの型定義を追加 |

### 既存修正（売上改善）

| ファイル | 変更内容 |
|---------|---------|
| `app/(dashboard)/sales/page.tsx` | カテゴリフィルタに「サービス以外」追加 / 日付ソート切替ボタン追加 / GASデータ取込ボタン追加 |
| `lib/queries/sales.ts` | `fetchSales` に `sortOrder` パラメータ追加 / `excludeCategory` フィルタ追加 |
| `app/(dashboard)/sales/daily/page.tsx` | 営業日（`sale_date`）を `/sales` へのリンクに変更 |
| `components/layout/SideNav.tsx` | ABC分析メニューを追加（`/sales/abc`） |
| `components/layout/BottomNav.tsx` | モバイルでの ABC 分析導線（overflow or タブ追加） |

### 変更しないファイル

| ファイル | 理由 |
|---------|------|
| `app/(dashboard)/products/unmatched/page.tsx` | ページ自体は変更不要。導線のみ変わる |
| `components/products/UnmatchedBoard.tsx` | Subnav 側の変更で自動的に対応される |
| `components/orders/JanCodeScannerField.tsx` | 変更なし。移動管理のモーダルからそのまま import して使う |

---

## 6. 段階的な実装計画

### Step 1: 導線のリファクタリング（コード変更は最小限、新規画面なし）

**所要規模**: 小（3ファイル修正）

1. `SideNav.tsx` を修正: 「未一致解消」→「商品管理」(`/products`) + アイコン変更
2. `BottomNav.tsx` を修正: 「未一致」→「商品」(`/products`) + アイコン変更
3. `ProductsSubnav.tsx` を修正: 
   - タブ項目に「店舗間移動」(`/products/transfers`) を追加
   - 右端に overflow メニュー `[⋯]` を追加し、中に「未一致解消」リンクを配置
   - タブ配列から「未一致解消」を削除

**検証**: `npm run build` が通ること、既存ページが壊れていないこと

### Step 2: データ層の確立（型・クエリ・アクション）

**所要規模**: 中（4ファイル新規 + 1ファイル修正）

1. `lib/types/database.ts` に `transfers` の型定義を追加
2. `lib/transfers.ts` を作成（型エイリアス、`TransferMutationState` 等）
3. `lib/queries/transfers.ts` を作成（`fetchTransferHistory`, `fetchStores`, `searchProductByJan`）
4. `app/actions/transfers.ts` を作成（`createTransfersAction` のスケルトン）

**検証**: クエリ関数を page.tsx から呼んで Supabase からデータが返ることを確認

### Step 3: 移動履歴一覧画面の構築

**所要規模**: 中（2ファイル新規）

1. `app/(dashboard)/products/transfers/page.tsx` を作成
2. `components/transfers/TransfersBoard.tsx` を作成（ヒーロー + サマリー + フィルタ + DataTable）

**検証**: `/products/transfers` にアクセスして移動履歴が表示されること

### Step 4: 新規移動登録モーダル + バーコード読取 + 削除機能

**所要規模**: 大（1ファイル新規 + Actions の本実装）

1. `components/transfers/TransferFormModal.tsx` を作成
   - `JanCodeScannerField` を `@/components/orders/JanCodeScannerField` から import して使う
   - カメラ読取 → JAN 取得 → `searchProductByJan()` → 商品情報表示 → リストに追加
2. `app/actions/transfers.ts` を本実装:
   - `createTransfersAction` — 一括 INSERT
   - `deleteTransferAction` — 個別削除（確認ダイアログ付き）
3. 移動履歴テーブルの各行に「削除」ボタンを追加

**検証**: 
- テキスト入力で JAN 検索 → リスト追加 → 登録できること
- カメラ読取で JAN が入力欄に反映されること（HTTPS 環境で検証）
- 登録済みの移動を削除できること（確認ダイアログが出ること）

### Step 5: 売上一覧の改善 + GAS Web App 連携

**所要規模**: 中〜大（3ファイル修正 + GAS 側デプロイ + API Route 新規）

1. `app/(dashboard)/sales/page.tsx` を修正:
   - カテゴリフィルタに「サービス以外」ボタンを追加
   - 日付の昇順/降順を切り替えるボタンを追加
   - 「📊 売上データ取込」ボタンを追加（Server Action 経由で GAS を呼ぶ）
2. `lib/queries/sales.ts` を修正:
   - `fetchSales()` に `sortOrder: 'asc' | 'desc'` パラメータを追加
   - カテゴリ除外フィルタ `excludeCategory` を追加
3. `app/(dashboard)/sales/daily/page.tsx` を修正:
   - 営業日の `sale_date` 列を `/sales?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` へのリンクに変更
4. GAS 側: `doGet()` 関数を追加し Web App としてデプロイ
5. `app/api/gas/trigger/route.ts` を作成: GAS Web App URL を呼び出す API Route

**検証**: 
- 「サービス以外」ボタンでサービスカテゴリが除外されること
- 日付ソートが切り替わること
- 日次集計から日付クリックで売上一覧へ遷移し、該当日のデータが表示されること
- 「売上データ取込」ボタンで GAS が実行され、完了後にデータが反映されること

### Step 6: ABC 分析画面の新設

**所要規模**: 大（2ファイル新規 + ナビ修正）

1. `lib/queries/abc.ts` を作成
2. `app/(dashboard)/sales/abc/page.tsx` を作成
3. SideNav / BottomNav に ABC 分析メニューを追加

**検証**: ABC 分析画面で商品のランク付けが表示されること

### 最小リリース単位

- **Step 1 単独** でリリース可能（導線変更のみ）
- **Step 1 + 2 + 3 + 4** で移動管理フル機能（バーコード込み）
- **Step 5** は独立してリリース可能（売上改善のみ）
- **Step 6** は独立してリリース可能（ABC 分析のみ）

---

## 7. 売上系の追加機能 詳細設計

### 7-1. カテゴリフィルタ「サービス以外」の追加

**現状**: `/sales` のカテゴリフィルタは `すべて` + 各カテゴリ名のピル型ボタン。

**変更内容**:
- 「すべて」の隣に **「サービス以外」** ピルを追加する
- クリックすると `?excludeCategory=サービス` を URL search params に追加
- `fetchSales()` に `excludeCategory` フィルタを追加:
  ```typescript
  if (filter.excludeCategory) {
    query = query.neq('category', filter.excludeCategory)
  }
  ```
- 「サービス以外」と特定カテゴリフィルタは排他（同時に有効にしない）

### 7-2. 日付の昇順/降順切り替え

**現状**: `fetchSales()` は常に `sale_date` 降順（新しい順）で返す。

**変更内容**:
- 売上一覧のフィルタバリアに **ソート切替ボタン**（`↓ 新しい順` / `↑ 古い順`）を追加
- URL search params に `sort=asc` or `sort=desc`（デフォルト desc）を追加
- `fetchSales(filter)` の `.order('sale_date', { ascending: filter.sortOrder === 'asc' })` で対応
- ボタンは `<Link>` を使い、既存の searchParams を保ったまま `sort` パラメータだけ切り替える

### 7-3. GAS 売上データ取込ボタン（Web App 方式）

**現状の GAS の仕組み**:
- GAS プロジェクト: `https://script.google.com/u/0/home/projects/1nixIMLQV4pA2Panl2LAvvXumftccUrZ6dPixbPLDygIxveYXViy-1Hhj/edit`
- `autoDownload.gs` の `downloadProductSalesFromPOS_()` が POS にログインし、商品別 CSV を取得
- `importCSV.gs` の `processProductSalesCSV_()` が CSV を縦持ちに変換し `product_sales_data` へ upsert
- 現在は Google Sheets のメニューから手動実行、または月次トリガーで自動実行
- **Web App としてデプロイすれば、URL を叩くだけで実行可能**

**Phase 1 の実装方針（確定）: GAS Web App + Next.js API Route**

Google Sheets を開かずにスクリプトを実行したいため、GAS を **Web App としてデプロイ** し、Next.js のボタンから直接呼び出す方式にする。

```
売上一覧画面のヘッダー
  ├── [📊 売上データ取込] ボタン
  └── クリック → API Route (app/api/gas/trigger) を呼ぶ
       → API Route が GAS Web App URL を fetch()
       → GAS 側で POS → CSV → Supabase の処理が走る
       → 完了応答を受け取り、画面にトースト表示
       → revalidatePath('/sales') で最新データに更新
```

**GAS 側の変更（実装担当 AI が実施）:**

既存の GAS に以下の `doGet()` を追加し、Web App としてデプロイする:

```javascript
// ===================================================================
// Web App エントリーポイント（外部からの HTTP GET で実行）
// ===================================================================
function doGet(e) {
  // パラメータで対象月を受け取る（省略時は前月）
  var now = new Date();
  var targetMonth = e.parameter.month ? parseInt(e.parameter.month, 10) : now.getMonth();
  var targetYear = e.parameter.year ? parseInt(e.parameter.year, 10) : now.getFullYear();
  if (targetMonth === 0) { targetMonth = 12; targetYear -= 1; }

  var posConfig = getPOSConfig_();
  if (!posConfig) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, message: 'POS設定が未完了です' })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var result = downloadProductSalesFromPOS_(posConfig, targetYear, targetMonth);
    return ContentService.createTextOutput(
      JSON.stringify(result)
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, message: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
```

**GAS デプロイ手順:**
1. 上記の `doGet()` を `autoDownload.gs` に追記
2. GAS エディタ → 「デプロイ」→「新しいデプロイ」
3. 種類: 「ウェブアプリ」
4. 実行するユーザー: 「自分」
5. アクセス可能なユーザー: 「自分のみ」（セキュリティ確保）
6. デプロイ → 生成された URL を `.env.local` の `GAS_WEBAPP_URL` に設定

**Next.js 側の実装:**

`app/api/gas/trigger/route.ts`（API Route）:
```typescript
export async function POST() {
  const gasUrl = process.env.GAS_WEBAPP_URL
  if (!gasUrl) {
    return Response.json({ success: false, message: 'GAS URL未設定' }, { status: 500 })
  }

  const response = await fetch(gasUrl, { method: 'GET' })
  const result = await response.json()

  if (result.success) {
    revalidatePath('/sales')
  }

  return Response.json(result)
}
```

売上画面のボタン:
- クリック → `fetch('/api/gas/trigger', { method: 'POST' })` をサーバーに送信
- ローディング中はスピナー表示
- 完了後にトーストで結果表示
- `GAS_WEBAPP_URL` はサーバー側環境変数（`NEXT_PUBLIC_` 不要。API Route 内でのみ使用）

**セキュリティ:**
- GAS Web App のアクセス権を「自分のみ」にすることで、第三者がURLを知っても叩けないようにする
- Next.js API Route はログイン済みユーザーのみアクセス可能（Supabase 認証チェック）
- `GAS_WEBAPP_URL` はサーバーサイド環境変数なのでクライアントに露出しない

### 7-4. 日次集計 → 売上一覧への遷移

**現状**: `sales/daily/page.tsx` の DataTable で `sale_date` は単なるテキスト表示。

**変更内容**:
- `sale_date` 列の `render` 関数を変更し、`<Link>` で囲む:
  ```tsx
  render: (item) => (
    <Link
      href={`/sales?dateFrom=${item.sale_date}&dateTo=${item.sale_date}&store=${item.store_name}`}
      className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium"
    >
      {item.sale_date}
    </Link>
  )
  ```
- クリックすると `/sales` にその日付 + 店舗名でフィルタされた状態で遷移する
- `/sales` 側は既に `searchParams` でフィルタを受け取る構造になっているため、追加作業は不要

### 7-5. ABC 分析画面

**概要**: 指定期間の商品を売上金額でランク付け（A: 上位70% / B: 70-90% / C: 90-100%）し、パレート図的な分析ができる画面。

**データソース**: `sales_product_summary_v` をベースに期間フィルタを追加して集計する。`sales_abc_summary` テーブルが将来作られれば、GAS で事前計算した結果を使うこともできるが、Phase 1 ではビュー上でリアルタイム計算する。

**UI 構成**:
```
┌──────────────────────────────────────────┐
│ ABC 分析                                 │
│ 期間: [開始日] ～ [終了日] [適用]        │
│ 店舗: [すべて] [本店] [わんわん]         │
├──────────────────────────────────────────┤
│ サマリーカード × 3                       │
│  A ランク: XX品 / ¥XXX (YY%)           │
│  B ランク: XX品 / ¥XXX (YY%)           │
│  C ランク: XX品 / ¥XXX (YY%)           │
├──────────────────────────────────────────┤
│ DataTable                                │
│  ランク | 商品名 | 販売数 | 売上金額     │
│         | 構成比 | 累積構成比             │
└──────────────────────────────────────────┘
```

**ルート**: `/sales/abc`
**クエリ**: `lib/queries/abc.ts` に `fetchAbcAnalysis(dateFrom, dateTo, storeName?)` を作成
- `sales_product_summary_v` を期間フィルタして集計
- JS側で売上金額降順ソート → 累積構成比を計算 → A/B/C ランクを付与

---

## 8. リスクと注意点

### 8-1. `transfers` テーブル関連

- **FK 名依存**: Flet 版では `stores!transfers_from_store_id_fkey(name)` という外部キー名でjoinしている。Next.js の Supabase クライアントでも同じ FK 名を使う必要があるため、実際のクエリで動作確認が必須
- **Flet 版との並行運用**: 同じ `transfers` テーブルに書き込むため、データ競合はないが、Flet 版で期待している列構造を壊さないよう注意
- **`total_cost` の計算**: Flet 版は `cost_price * quantity` を INSERT 時に計算して `total_cost` に入れている。Next.js 版でも同じ計算を Server Action 側で行う

### 8-2. JAN 検索 + バーコード読取の UX

- `JanCodeScannerField` は HTTPS 環境でのみカメラ読取が有効
- Vercel デプロイ環境は HTTPS なので問題なし。ローカル開発は `localhost` でも動作する
- BarcodeDetector API は Chrome / Edge / Samsung Internet などで対応。Safari（iOS）は未対応のため、iOS ではテキスト入力へのフォールバック表示が自動で出る（`getUnavailableScannerMessage()` で処理済み）
- JAN コードで商品が見つからないケースの UI（手入力フォーム）は Flet 版を踏襲する

### 8-3. ProductsSubnav の overflow メニュー

- `useRef` + `useState` で Popover を自前実装するか、Headless UI のようなライブラリを入れるかの判断が必要
- 既存プロジェクトに UI ライブラリ追加を最小限にしたい場合は、Tailwind + 自前実装が無難

### 8-4. GAS 連携のセキュリティ

- GAS Web App URL にはパスワードやキーは含まれない（GAS 内で ScriptProperties から読む）
- ただし、GAS Web App URL を公開すると誰でも叩けてしまうため、実運用では GAS 側で Execution as: 「自分」 / Access: 「自分のみ」として、Next.js からの呼び出しは Google OAuth 経由にするか、API Key チェックを入れる必要がある
- Phase 1 では「GAS 管理画面を直接開く」方式が最もセキュアで簡単

### 8-5. ABC 分析のパフォーマンス

- `sales_product_summary_v` は期間をまたぐ集計ビューなので、データ量が増えるとクエリが遅くなる可能性がある
- Phase 1 ではクライアント側でランク計算を行い、ビューの再設計は Phase 2 以降で検討

---

## 9. ユーザー確認事項（全件 ✅ 確認済み）

### 9-1. テーブル選択 ✅

> **Q1**: 商品移動は既存の `transfers` テーブル（フラット構造）をそのまま使う前提で進めてよいですか？

**決定**: 既存 `transfers` をそのまま使う。問題なし。

### 9-2. 移動のステータス管理 ✅

> **Q2**: 移動にステータス（下書き / 提出済み / 完了 / 取消）の概念は必要ですか？

**決定**: ステータスなし（Flet版と同じ。登録＝確定）

### 9-3. 移動の削除 ✅

> **Q3**: 登録済みの移動を削除する機能は必要ですか？

**決定**: **削除機能は必要**。間違って登録した場合に削除できるようにする。
- 履歴テーブルの各行に「削除」ボタンを追加
- クリック時に確認ダイアログ（「この移動記録を削除しますか？」）
- `deleteTransferAction(transferId)` Server Action で `transfers` テーブルから DELETE
- 編集機能は Phase 1 では含めない（削除して再登録で対応）

### 9-4. GAS 連携の方式 ✅

> **Q4**: GAS は Web App としてデプロイ済みですか？

**決定**: 現在未デプロイ → **Web App としてデプロイし、Next.js から直接呼び出す方式** に確定。
- GAS 側に `doGet()` を追加し Web App デプロイ（実装担当 AI が対応）
- GAS プロジェクト: `1nixIMLQV4pA2Panl2LAvvXumftccUrZ6dPixbPLDygIxveYXViy-1Hhj`
- Next.js API Route → GAS Web App → POS → Supabase の全自動フロー
- Google Sheets を開く必要なし

### 9-5. ABC 分析のランク閾値 ✅

> **Q5**: ABC ランクの閾値は A:70% / B:90% / C:100% でよいですか？

**決定**: A:70% / B:90% / C:100% で実装。閾値の変更 UI は Phase 2 以降。

### 9-6. 「サービス以外」カテゴリ ✅

> **Q6**: 除外したいカテゴリの正確な名称は「サービス」で合っていますか？

**決定**: 「サービス」で確定。

---

## 10. 将来考慮すべき点（今回は実装しない）

1. **ヘッダ+明細分離**: `inventory_transfer_headers` + `items` への移行
2. **CSV エクスポート**: 移動履歴をCSVでダウンロード
3. **承認フロー**: 登録→承認→完了のワークフロー
4. **在庫数の自動計算**: 移動データから店舗ごとの理論在庫を出す
5. **未一致件数バッジ**: ProductsSubnav or SideNav に未解消件数を表示
6. **移動の編集機能**: 登録済みの移動を削除ではなく内容修正する機能
7. **ABC 分析の閾値設定 UI**: 画面上で A/B/C の閾値をスライダーで変更できる機能
