# 実装計画書 (Implementation Plan) - バーコード表示 ＆ 店舗間移動の8列スリム化・編集機能

本計画書は、商品マスタ一覧での「リアルタイムバーコード生成トグル機能」の実装、および店舗間移動画面における「8列へのスリム化・余白詰め・編集機能の追加」に関する実装計画です。

---

## 🎯 実装の目的と成功基準
- **目的**:
  1. 商品マスタのJANコード（テキスト）をクリックした瞬間に、その場で読み取り可能な「バーコード画像（SVG）」へ切り替えるトグル機能を実装します（発注管理のテストも兼ねます）。
  2. 店舗間移動画面（`/products/transfers`）のレイアウトはみ出しを解消するため、列数を **8列** にスリム化し、余白を詰め、操作を「削除」から「編集（削除機能付き編集モーダル）」へアップグレードし、区分を一番右へ移動します。
- **成功基準**:
  - JANコードをクリックすると、テキストと高精度なバーコードSVGがその場で切り替わる。
  - 店舗間移動画面が、PC・タブレット・スマートフォンのすべての画面幅で横はみ出しを起こさず美しく表示される。
  - 店舗間移動の各行に「編集」ボタンが設置され、1件の移動履歴を専用モーダルでスマートに修正・削除できる。

---

## 📦 追加するパッケージ
JANコードの数値から、高精度でスキャン可能なSVGバーコードをクライアントサイドで超軽量にリアルタイム生成するために、業界標準の軽量ライブラリ **`jsbarcode`** を導入します。

- パッケージ名: `jsbarcode`

---

## 🛠 変更・新規追加するファイル

| アプローチ / ファイルパス | 変更区分 | 役割・変更内容 |
| :--- | :--- | :--- |
| **[package.json](file:///C:/Users/kirik/Desktop/Antigravity/next_app/package.json)** | `[MODIFY]` | `jsbarcode` ライブラリの追加。 |
| **`next_app/components/ui/BarcodeToggle.tsx`** | `[NEW]` | `jsbarcode` を用いた、JANコードとバーコード画像のトグル切り替え用コンポーネント。 |
| **[ProductsBoard.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/products/ProductsBoard.tsx)** | `[MODIFY]` | DataTable の JAN列に `BarcodeToggle` を統合。 |
| **[transfers.ts (Actions)](file:///C:/Users/kirik/Desktop/Antigravity/next_app/app/actions/transfers.ts)** | `[MODIFY]` | 移動履歴の更新を行う `updateTransferAction` サーバーアクションの新規追加。 |
| **`next_app/components/transfers/TransferEditModal.tsx`** | `[NEW]` | 1件の移動履歴を修正、またはその場で削除できるシンプルな編集用モーダルコンポーネントの作成。 |
| **[TransfersBoard.tsx](file:///C:/Users/kirik/Desktop/Antigravity/next_app/components/transfers/TransfersBoard.tsx)** | `[MODIFY]` | テーブル列を **8列** に再構成（物品使用区分・メモをテーブルから除外し、余白を詰め、操作を編集に変更し、区分を一番右へ配置）。はみ出しバグを完全解決。 |

---

## 📐 店舗間移動テーブルの新しい構成（合計8列）

1.  **登録日時** (render: 日時)
2.  **店舗** (余白を詰める: `min-w-[180px]` などの制限を外し、コンパクトな表示へ)
3.  **商品** (商品名とJANコード)
4.  **数量**
5.  **原価**
6.  **原価合計**
7.  **操作 (編集)** (クリックすると `TransferEditModal` が開き、修正や削除が行えます)
8.  **区分 (一番右)** (店舗間移動 / 物品使用 の StatusBadge)

*※テーブル幅が劇的に削減され、画面内に完璧に収まるようになります！また、メモや細かい項目は「編集モーダル」内で確認・編集できるため、データの欠落もありません。*

---

## 🧪 検証計画
1.  **ビルド検証**
    - `npm run build` を実行し、TypeScriptの型チェックおよびTurbopackによるコンパイルが完全にパスすることを確認します。
2.  **表示・動作検証**
    - 商品マスタでJANコードをクリックし、バーコードに切り替わり、スマホ等で正しくスキャンできるかテストします。
    - 店舗間移動画面（`/products/transfers`）の幅が自動伸縮し、はみ出しが解消していること。
    - 各行の「編集」ボタンから情報が変更（または削除）され、一覧に正しく反映されること。

---

## 📅 今後の予定（ステップ）
1.  **本計画書のユーザー承認（y/n）** 👈 現在ここ
2.  `jsbarcode` のインストール
3.  `updateTransferAction` サーバーアクションの追加
4.  `TransferEditModal.tsx`（編集モーダル）の新規作成
5.  `TransfersBoard.tsx` の8列化＆スリム化修正
6.  `BarcodeToggle.tsx` の新規作成 ＆ `ProductsBoard.tsx` への組み込み
7.  ビルドチェック・動作確認・本番デプロイ
