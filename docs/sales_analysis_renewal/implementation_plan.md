# ABC分析指標切り替え＆カメラJANコードスキャン機能 実装計画

ABC分析の指標（販売数・売上金額）の動的切り替え機能の追加、および商品検索時のカメラを用いたJANコード自動スキャン機能の実装を行います。

## ユーザーレビューが必要な内容

> [!IMPORTANT]
> - **ABC分析のデフォルト基準**: ユーザー様の要望に基づき、ABC分析のデフォルトの基準を「売上金額」から **「販売数（数量）」** に変更します。
> - **動的切り替え**: 画面上に「数量ベース」「金額ベース」を切り替えるスイッチ（タブ）を設け、選択に応じてパレート図やABCテーブル、円グラフが瞬時に切り替わるようにします。
> - **バーコードスキャン（カメラ読み取り）**: モバイル端末などのブラウザカメラを使用し、JANコードバーコードをスキャンして検索窓に自動入力するモーダルを導入します。

---

## 提案する変更点

### 1. クエリおよびデータ構造の変更
#### [MODIFY] [abc.ts (lib/queries/abc.ts)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/lib/queries/abc.ts)
- `fetchAbcAnalysis` に `target?: 'amount' | 'quantity'` 引数を追加（デフォルト：`'quantity'`）。
- `target` の値に応じて、ソート基準、シェアの分母（総数量 or 総売上金額）、および累積シェアを動的に算出してABCランク（A/B/C）を決定するようにロジックを修正。

### 2. UIコンポーネントの修正・新設
#### [MODIFY] [page.tsx (app/(dashboard)/sales/abc/page.tsx)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/(dashboard)/sales/abc/page.tsx)
- URLのクエリパラメータ `target` を読み取り、`fetchAbcAnalysis` に渡す。
- 検索フォーム内に、基準（数量・金額）を選択するための切り替えタブ/スイッチUIを追加。
- 検索窓の隣に「カメラでスキャン」ボタンを追加し、スキャンモーダルを起動できるようにする。

#### [MODIFY] [AbcAnalysisCharts.tsx (components/sales/AbcAnalysisCharts.tsx)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/sales/AbcAnalysisCharts.tsx)
- プロップスに `target?: 'amount' | 'quantity'` を追加。
- 選択された `target` に応じて以下を動的に切り替える：
  - TOP15商品のソートおよびグラフ描画データ（売上金額 or 販売数量）。
  - Y軸の単位（円 `¥` or 個 `個`）。
  - カテゴリシェア円グラフの算出基準（金額 or 数量）および中央に表示する総計値。
  - ツールチップ内の表示内容や文言。

#### [NEW] [BarcodeScannerModal.tsx (components/sales/BarcodeScannerModal.tsx)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/sales/BarcodeScannerModal.tsx)
- `@zxing/browser` を用いた、JANコードスキャン用のクライアントコンポーネント。
- カメラ映像を表示するビデオ領域をモーダルで表示し、バーコードが検出されたら読み取り音（または視覚的フィードバック）とともにコードを親コンポーネントに返して自動的にモーダルを閉じます。
- カメラへのアクセス許可がない場合や非対応デバイスのためのエラーハンドリングを実装。

---

## 検証計画

### 自動テスト
- `npx tsc --noEmit` によるTypeScriptのコンパイルおよび型定義チェック。
- `npm run build` による本番ビルドの正常動作確認。

### 手動検証（ユーザー様による確認推奨項目）
- ABC分析ページにアクセスした際、標準で「数量」基準でABC分析が行われていることの確認。
- 画面上で「金額」切り替えを選択した際、即座にグラフ・表・カテゴリシェアが売上金額基準に更新されることの確認。
- 「カメラでスキャン」ボタンをクリックし、カメラが起動して商品のJANバーコードを認識し、検索窓に入力され自動検索されるかの確認（PC/スマホ実機）。
