# 入出庫履歴の返品相殺・商品一覧の価格表示調整 検証結果

## 実装内容

- 選択期間・店舗・商品コード単位で販売と返品を相殺する表示用処理を追加した。
- 商品コードがない履歴は商品名を代替キーとして扱う。
- 返品がある商品は販売数量と原価合計から返品分を差し引き、最新の作業日時で販売1行へまとめる。
- 相殺後の数量が0以下の場合は、対象商品の販売・返品行を表示しない。
- 返品のない販売、注文、店舗間移動、物品使用などの履歴は維持する。
- 保存済みキャッシュは変更せず、API応答の表示用データへ相殺を適用する。
- 商品一覧の価格列を仕入れ先列の左へ移動した。
- 粗利率表示を削除し、売価へ10%の切り捨て税額を加えた税込価格を表示する。

## 自動検証

- `node --test tests/history_returns_and_product_price_test.mjs tests/realtime_history_cache_test.mjs tests/product_store_separation_test.mjs tests/transfer_form_navigation_guard_test.mjs`: 16件成功
- `npx tsc --noEmit`: 成功
- `npx eslint lib/realtimeHistory.ts lib/products.ts components/products/ProductsBoard.tsx`: 成功
- `npm run build`: 成功

## 本番確認

- 実装コミット`a556eeb`を`origin/main`へpushし、Vercelデプロイ成功を確認した。
- 本番の`/products`と`/sales`は未認証時に`/login`へリダイレクトされる構成を維持している。
- 現在の保存履歴には返品行がなかったため、本番データでの相殺結果は未確認。販売2・返品1、販売と返品が同数、返品超過のテストデータで動作を確認した。
