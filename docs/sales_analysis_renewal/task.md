# 商品売上分析機能リニューアルのタスクリスト

- [x] APIエンドポイントの実装
  - [x] `next_app/app/api/sales/trends/route.ts` を新規作成し、特定商品の期間内日別売上数を返すエンドポイントを実装
- [x] コンポーネントの作成と修正
  - [x] `next_app/components/sales/ProductSalesTrendsModal.tsx` を新規作成し、Recharts による日別推移チャートを実装
  - [x] `next_app/components/sales/AbcAnalysisCharts.tsx` を修正し、売上貢献度上位15商品の売上（棒）と累積（折れ線：右軸）のパレート図（二軸複合チャート）にリニューアル
- [x] 各画面への機能組み込み
  - [x] `next_app/app/(dashboard)/sales/abc/page.tsx` を修正し、デフォルトの除外カテゴリを「サービス」に設定
  - [x] ABC分析および売上一覧のテーブルに商品名クリックでの `ProductSalesTrendsModal` 起動処理を組み込み
- [x] 【追加】ABC分析への商品検索機能の組み込み
  - [x] フォームに商品名・JANの入力ボックスを追加し、Supabaseクエリへ部分一致OR条件を追加
- [x] 【追加】不要な「商品別集計」ページの完全削除
  - [x] `sales/products` ディレクトリを削除し、SideNav、SalesMoreMenu、各種キャッシュ再検証処理の参照を全てクリーンアップ
- [x] 検証
  - [x] `npx tsc --noEmit` を実行してビルド型エラーがないか確認

## 🚀 指標切り替え＆カメラJANコードスキャン（追加開発）
- [x] クエリ・ロジックの修正
  - [x] `next_app/lib/queries/abc.ts` の `fetchAbcAnalysis` を修正し、分析対象 (`target: 'amount' | 'quantity'`) の切り替えをサポート
- [x] UIコンポーネントの修正・新設
  - [x] `next_app/components/sales/AbcAnalysisCharts.tsx` を修正し、選択された `target`（金額/数量）に応じてグラフ描画やタイトル、単位、ドーナツ統計を動的に切り替え可能にする
  - [x] `next_app/components/sales/BarcodeScannerModal.tsx` を新規作成し、`@zxing/browser` を使用したJANコードスキャナーを実装
  - [x] `next_app/app/(dashboard)/sales/abc/page.tsx` を修正し、数量/金額の切り替えUI（タブ）の配置、および「カメラでスキャン」ボタンとモーダル連携を実装
- [x] 検証
  - [x] `npx tsc --noEmit` および `npm run build` にてコンパイル・ビルドエラーがないか検証
