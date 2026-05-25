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

## ⚡ 追加提案: 「最初のクリックからの遷移フリーズ」解消計画

Next.js App Routerの仕様上、サーバーコンポーネント内でのデータフェッチが完了するまで画面遷移が完全にブロックされ、「クリック後に無反応」となる問題が発生します。これに対し、即時画面遷移を実現するベストプラクティスを導入します。

### 1. `loading.tsx`（即時スケルトン表示）の導入 【効果絶大】
ユーザーがメニューやカードをクリックした瞬間に画面を遷移させ、裏でデータをロードする **「Instant Loading States（即時ローディング）」** を実現します。

#### [NEW] [loading.tsx (共通ダッシュボード)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/%28dashboard%29/loading.tsx)
* **内容**: ダッシュボードのメインコンテンツ部に表示する美しい骨組み（スケルトン）画面を構築します。ヘッダー、フィルター、ダミーカードのフェードインアニメーションを配置します。

#### [NEW] [loading.tsx (客注詳細)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/%28dashboard%29/orders/%5Bid%5D/loading.tsx)
* **内容**: 客注詳細ページ専用のスケルトン画面を作成し、詳細をクリックした際も0秒で遷移が開始されるようにします。

### 2. 初期ロードフェッチのさらなる軽量化（遅延読み込み）
* **内容**: `next_app/app/(dashboard)/orders/page.tsx` で、まだ開いていない新規登録モーダル用のマスタ情報（`fetchOrderFormOptions`）を事前に `await` して待つのは非効率です。
* **改善**: 初期ロード時は `fetchOrders()` のみにして遷移時間を極限まで削減し、商品・店舗マスタはモーダルが開いた段階でクライアント側から非同期に動的ロードする構造にリファクタリングします。

---

## 🔍 追加提案: 商品マスタの「オンデマンド・デバウンス高速検索」移行計画

商品マスタの全件取得を廃止し、入力に基づいたオンデマンド検索を導入します。

### 1. 高速検索APIの新規作成
#### [NEW] [route.ts (商品高速検索API)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/api/products/search/route.ts)
* **内容**: クライアントから受け取った検索クエリ `q`（スペース区切りの複数ワードに対応）を、PostgreSQL データベース側で `ilike` による高速結合AND検索で処理し、上位50件に制限（DOM爆発を防止）してミリ秒で返却します。

### 2. `ProductsBoard.tsx` のデバウンス検索化
#### [MODIFY] [ProductsBoard.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/products/ProductsBoard.tsx)
* **デバウンス（Debounce）の実装**:
  * ユーザーのキーボード入力イベントに対して、`300ms` のタイマー遅延（デバウンスアルゴリズム）を適用します。タイピング中はクエリの送信を抑制し、タイピングが止まった時点で1回だけ検索APIへフェッチを投げます。
  * フェッチ中（`loading: true`）は、テーブルの代わりに美しいローディングスピナー（Loading Spinner）を表示して進捗を明示します。
* **初期状態の軽量化**:
  * 初期表示時（検索ワードが空のとき）は、重いテーブルのDOM生成を行わず、「キーワードを入力して商品を検索してください」というヒント用プレースホルダーを表示します。

### 3. 初期取得の廃止（一瞬で開く商品管理ページ）
#### [MODIFY] [page.tsx (商品管理)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/%28dashboard%29/products/page.tsx)
* **改善**: 初期表示時の `fetchProducts()`（全件フェッチ）を完全に廃止し、初期表示データは `[]`（空）とします。これにより、商品マスタのメニューをクリックした瞬間の**フリーズ時間は0.00秒（完全な一瞬）**になります。

---

## 🧪 検証計画

### 自動・ローカル検証
* `npm run build` を実行して、リファクタリング後の TypeScript の型チェック、および Next.js ビルドがエラーなく成功することを確認します。

### 手動・動作検証
1. 客注一覧ページ（`/orders`）が、クリック後ほぼ待たずに（0.1秒以下で）開くことを確認します。
2. 客注詳細ページ（`/orders/[id]`）も同様に、一瞬で開くことを確認します。
3. キャンセルボタン、削除ボタンを押した際、即座にボタンが「キャンセル中...」「削除中...」と非活性化（薄暗くロック）され、処理完了後に適切にリダイレクトされることを確認します。
