# 商品売上分析機能リニューアルのタスクリスト

- [ ] APIエンドポイントの実装
  - [ ] `next_app/app/api/sales/trends/route.ts` を新規作成し、特定商品の期間内日別売上数を返すエンドポイントを実装
- [ ] コンポーネントの作成と修正
  - [ ] `next_app/components/sales/ProductSalesTrendsModal.tsx` を新規作成し、Recharts による日別推移チャートを実装
  - [ ] `next_app/components/sales/AbcAnalysisCharts.tsx` を修正し、売上貢献度上位15商品の売上（棒）と累積（折れ線：右軸）のパレート図（二軸複合チャート）にリニューアル
- [ ] 各画面への機能組み込み
  - [ ] `next_app/app/(dashboard)/sales/abc/page.tsx` を修正し、デフォルトの除外カテゴリを「サービス」に設定
  - [ ] ABC分析および売上一覧のテーブルに商品名クリックでの `ProductSalesTrendsModal` 起動処理を組み込み
- [ ] 検証
  - [ ] `npx tsc --noEmit` を実行してビルド型エラーがないか確認
