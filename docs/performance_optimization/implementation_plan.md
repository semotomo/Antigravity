# Kennelダッシュボード パフォーマンス ＆ UX全面改善計画

この計画書は、客注管理画面を含むダッシュボード全体で発生している「画面の深刻なフリーズ（数秒〜十数秒の遅延）」を根本的に解決し、同時に「クリック後の無反応状態」を解消して快適な操作性を実現するための実装計画書です。

## 📌 現状の課題と原因分析

### 1. 【極めて深刻】Supabaseクエリの全件逐次ロードによる同期ブロック
* **ファイル**: [next_app/lib/queries/orders.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/queries/orders.ts)
* **内容**: 客注一覧（`fetchOrders`）やフォームオプション（`fetchOrderFormOptions`）の読み込み時に、`fetchAllRows` という関数を使って `products`（商品マスタ）テーブルの数万件の全データを「1000件ずつ再帰的にループ通信でロード」していました。
* **影響**: ページを開くたびに膨大なネットワーク往復が発生し、全商品データをメモリ上に乗せきるまでNext.jsサーバーが数秒〜十数秒フリーズしていました。

### 2. アクション実行時の無反応（UXの欠如）
* **ファイル**: 
  * [next_app/app/(dashboard)/orders/[id]/page.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/%28dashboard%29/orders/%5Bid%5D/page.tsx)（キャンセルボタン）
  * [next_app/components/orders/DeleteOrderButton.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/orders/DeleteOrderButton.tsx)（削除ボタン）
* **内容**: 「キャンセルにする」「削除する」などの送信ボタンがクリックされた後、裏側のデータベース（Supabase）通信が終わるまでの間、UI上は何の変化も起きない「完全な静止」になっていました。
* **影響**: ユーザーは裏で処理が動いているのか判別できず、フリーズしているような不安な印象を与えていました。

---

## 🛠️ 提案する変更内容

### Component 1: データ取得クエリのリファクタリング（Joinによる爆速化）
商品マスタの全件メモリロードを完全に廃止し、Supabase（PostgREST）のリレーション結合機能を使って、**1回のクエリで注文データと一緒に店舗情報・商品情報を一挙にデータベース内で結合取得**します。

#### [MODIFY] [orders.ts](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/queries/orders.ts)
* **`fetchOrders` のリファクタリング**:
  * 全商品マスタのループロード（`fetchAllRows`）を廃止。
  * `customer_orders` の `select` に `store:stores(id, name)` および `product:products(id, product_name, jan_code, category)` を追加し、リレーション関係にある別テーブルデータを1発で結合取得します。
* **`fetchOrderDetails` のリファクタリング**:
  * 注文詳細も同様に、1回のクエリで店舗・商品データを結合取得するように書き換えます。
* **`fetchOrderFormOptions` の商品制限**:
  * 商品選択用のマスタ取得について、全商品の無条件取得を廃止し、まずは `limit(100)` 程度に制御をかけるか、キャッシュを適用して初期ロード時間をゼロにします（※将来的には入力型コンボボックスでの動的フェッチに移行可能ですが、まずは初期ロードをミリ秒に落とします）。

---

### Component 2: ボタンのローディング状態（フィードバック）の導入
サーバーへのデータ送信中（`pending`）に、ボタンテキストを「処理中...」に変え、同時にボタンを無効化（`disabled`）して二重送信とフリーズ感を防ぎます。

#### [NEW] [CancelOrderButton.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/orders/CancelOrderButton.tsx)
* **内容**: 詳細画面の「キャンセルにする」フォームをクライアントコンポーネント化し、React 19 の `useFormStatus` を適用した `CancelOrderButton` を新規作成します。キャンセル実行中は「キャンセル中...」と表示されます。

#### [MODIFY] [page.tsx (詳細ページ)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/%28dashboard%29/orders/%5Bid%5D/page.tsx)
* 新規作成した `<CancelOrderButton orderId={order.id} />` を使うよう変更し、サーバーコンポーネントのインラインフォームから切り離します。

#### [MODIFY] [DeleteOrderButton.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/orders/DeleteOrderButton.tsx)
* 削除ボタンのコンポーネント内に `useFormStatus` を用いた送信中ステートを追加し、削除ボタンがクリックされて確認ダイアログをパスした後は「削除中...」に切り替えてボタンを無効化します。

---

## 📈 期待される改善効果
* **データロード速度**: 数秒〜十数秒 ➔ **50ミリ秒以下（ほぼ一瞬）へ短縮**
* **操作性**: クリック後即座に「処理中...」になりボタンがロックされるため、フリーズ感がなくなり、誤操作も根絶されます。

---

## 🧪 検証計画

### 自動・ローカル検証
* `npm run build` を実行して、リファクタリング後の TypeScript の型チェック、および Next.js ビルドがエラーなく成功することを確認します。

### 手動・動作検証
1. 客注一覧ページ（`/orders`）が、クリック後ほぼ待たずに（0.1秒以下で）開くことを確認します。
2. 客注詳細ページ（`/orders/[id]`）も同様に、一瞬で開くことを確認します。
3. キャンセルボタン、削除ボタンを押した際、即座にボタンが「キャンセル中...」「削除中...」と非活性化（薄暗くロック）され、処理完了後に適切にリダイレクトされることを確認します。
