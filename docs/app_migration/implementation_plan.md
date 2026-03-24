# 実装計画: 既存StreamlitアプリのFletへの移植・統合 (Phase 5)

本計画は、現在Streamlitで稼働している「シフト作成ツール(app.py)」および「商品移動管理システム(inventory_app.py)」を、今回新しく構築したFletベースのPOSダッシュボードアプリ (`flet_app/`) へ統合・移植するための実装ステップを定義します。

## 目的

1. 全ての業務ツール（売上ダッシュボード、シフト管理、商品移動管理）を単一のFletアプリケーションにまとめ、利便性を向上させる。
2. Supabaseによる共通の認証基盤を利用し、セキュリティを統一する。
3. StreamlitからFletへUIを書き換え、よりリッチで高速な動作を実現する。

## User Review Required

> [!IMPORTANT]  
> 今回の移植作業では、既存のStreamlit特有のコンポーネント（特に `st.data_editor`のような表計算風の直接編集機能）をFletで完全再現することは難しいため、Fletの `DataTable` や `TextField` などを組み合わせたUI設計に変更されます。
> または、入力しやすい動的なフォームへ変更になります。この方針での進め方にご承認いただけるかご確認ください。

## 提案する変更

### 1. 共通ルーティングとナビゲーションの追加
アプリ全体のメニュー構成を拡張し、各機能へアクセスできるようにします。

#### [MODIFY] `flet_app/main.py`
ルーターに新しい画面（ `/shift`, `/inventory` ）へのルーティング処理を追加します。

#### [MODIFY] `flet_app/components/sidebar.py`
サイドバーナビゲーションに「シフト管理」「在庫移動管理」のリンクを追加します。

---

### 2. シフト作成ツールの移植 (`app.py` → Flet)
バックエンドの計算ロジックは活用し、UI部分のみFletで再構築します。

#### [NEW] `flet_app/core/shift/` (ディレクトリ)
既存の `solver.py`, `utils.py`, `data_io.py`, などをこのディレクトリの下に移管し、パスを適合させます。

#### [NEW] `flet_app/pages/shift.py`
- Fletの `ft.Tabs` を利用し、「シフト作成」「スタッフ設定」「過去履歴」などの画面分割を行います。
- `DataTable` や `TextField` を用いて、スケジュール作成の入力を代替します。

---

### 3. 商品移動管理システムの移植 (`inventory_app.py` → Flet)
データベース操作クライアントを今回作成した `SupabaseAuthClient` に統一し、リファクタリングします。

#### [NEW] `flet_app/core/inventory/` (ディレクトリ)
既存の `inventory/db.py` などを移管し、Fletアプリ側のSupabase接続を用いるように変更します。

#### [NEW] `flet_app/pages/inventory.py`
こちらも `ft.Tabs` を活用し、「移動入力」「移動履歴」「商品マスタ管理」の画面を作成します。
- バーコードの入力方式として以下3つをサポートします：
  1. **バーコードリーダー入力**: `ft.TextField(on_submit=..., autofocus=True)`
  2. **手動入力**: 数値キーボードによるJANコードの手打ち
  3. **カメラによるバーコード認識**: デバイスのカメラ（iPad等）を起動し、映像からJANコードを読み取る機能（ブラウザやOSのカメラAPI連携を想定）

## 検証プラン (Verification Plan)

### Validation
- Fletアプリを起動・ログインし、サイドバーから各新メニューに遷移できるか。
- シフト機能: 既存設定が正しく読み込まれ、ソルバーを実行してシフト表が生成・表示されるか。
- 商品移動機能: 商品をスキャンでき、リストに追加後、Supabaseの関連テーブルへ正常に登録されるか。
