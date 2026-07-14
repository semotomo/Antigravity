# 商品売上分析機能の大幅改善・リニューアル計画

現在の売上分析画面（ABC分析、商品別集計など）を、コンビニや大手小売でデファクトスタンダードとして使用されている分析手法（パレート図の導入など）に沿ってリニューアルし、各商品の日別の売上推移をパッと確認できる詳細モーダルを追加します。

## ユーザーレビューが必要な事項

- **パレート図の導入**:
  - ABC分析のグラフを、単なる上位売上の棒グラフから、**売上高（縦棒グラフ）と累積比率（折れ線グラフ、0〜100%の二軸重ね合わせ）を一体化した「パレート図（Pareto Chart）」** にアップグレードします。
  - これは大手流通業でABC分析の標準ツールとして広く活用されています。

- **商品売上トレンドモーダルの新設**:
  - 売上一覧画面やABC分析画面にて、**商品名をクリック**するとモーダルが開き、過去7日間または過去30日間の日別の販売数量・売上額の推移グラフ（棒グラフ/折れ線）を表示する機能を追加します。
  - これにより、特定の商品が過去どの程度売れているかを簡単に把握できます。

- **初期表示フィルタの改善**:
  - ABC分析ページの初回読み込み時（デフォルト）の除外カテゴリを **「サービス」以外**（`excludeCategory = 'サービス'`）に設定し、粗利や商品売上の実態に合わせたデータが最初から表示されるようにします。

---

## Proposed Changes (提案する変更内容)

### 1. APIエンドポイントの新設 (商品別日別トレンド)
#### [NEW] [route.ts (トレンドデータ API)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/api/sales/trends/route.ts)
- `jan_code` または `product_name` と期間（過去7日 / 30日）を受け取り、その期間内の日別販売数量・金額データを返すエンドポイントを新設します。

### 2. コンポーネントの追加と修正
#### [NEW] [ProductSalesTrendsModal.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/sales/ProductSalesTrendsModal.tsx)
- Recharts を用いて、選択された特定商品の「日別販売数量の推移（棒グラフ／折れ線）」を美しくビジュアル化するモーダルコンポーネントを作成します。
- 期間の切り替え（過去7日間 / 過去30日間）のタブを含めます。

#### [MODIFY] [AbcAnalysisCharts.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/sales/AbcAnalysisCharts.tsx)
- Recharts の `ComposedChart` を使用し、上位15商品の「売上金額（棒）」と「累積売上構成比（折れ線：右第2軸）」を重ね合わせた **パレート図** にリニューアルします。

### 3. 各画面でのモーダル組み込みとデフォルト切り替え
#### [MODIFY] [page.tsx (売上一覧)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/(dashboard)/sales/page.tsx)
#### [MODIFY] [page.tsx (ABC分析)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/(dashboard)/sales/abc/page.tsx)
- 商品テーブルの商品名をクリック可能（リンク・下線表示）にし、クリック時に `ProductSalesTrendsModal` をポップアップする仕組みを組み込みます。
- ABC分析ページの `excludeCategory` の初期値を `'サービス'` に変更します。

---

## Verification Plan (検証計画)

### 1. 型チェックとビルド検証
- `npx tsc --noEmit` を実行し、すべての新規ファイルや修正箇所に TypeScript のビルドエラーがないことを検証します。

### 2. UI・動作確認
- 画面をリロードし、ABC分析のデフォルトが「サービス以外」になっていることを確認します。
- 商品名をクリックして過去のトレンドグラフが美しく表示されること、および期間切り替え（7日/30日）が機能することを確認します。
- ABC分析の上部に大手企業標準のパレート図が表示されることを確認します。
