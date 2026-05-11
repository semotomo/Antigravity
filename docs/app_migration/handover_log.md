# Fletアプリ移行 引き継ぎログ 第3報（2026-03-19）

## 概要
Streamlit版アプリをFlet版へ移行するプロジェクト。Flet **0.82.2** を使用中。
起動コマンド: `.\venv\Scripts\python -m flet_app.main`

## 現在のディレクトリ構成
```
flet_app/
├── main.py              # エントリポイント（ルーティング・認証ガード）
├── core/
│   ├── config.py        # 環境変数（SUPABASE_URL, SUPABASE_KEY）
│   ├── supabase_client.py  # SupabaseAuthClient（sign_in / sign_out）
│   ├── data_service.py  # REST APIで売上データ取得
│   ├── shift/
│   │   ├── solver.py    # ビームサーチ シフト自動生成（★正常）
│   │   ├── utils.py     # 祝日判定・役割マッピング等（★正常）
│   │   └── data_io.py   # JSON設定読み書き・店舗管理（★正常）
│   └── inventory/
│       └── db.py        # Supabase REST操作（在庫移動・商品検索）
├── components/
│   ├── navigation.py    # 共通ナビゲーションバー
│   └── shift_ui.py      # シフト用DataTableビルダー（現在未使用）
└── pages/
    ├── login.py         # ログイン画面（★正常動作）
    ├── dashboard.py     # POS売上ダッシュボード（★正常動作）
    ├── shift.py         # シフト管理画面（★エラーあり）
    └── inventory.py     # 在庫管理画面（★エラーあり）
```

## 完了済みタスク
- [x] Flet 0.82対応の基本構造（async/await、ft.run）
- [x] ログイン画面（Supabase認証連携）
- [x] ダッシュボード画面（売上データ表示）
- [x] NavigationBarによる画面遷移
- [x] solver.py / utils.py / data_io.py のロジック（正常動作）

## 未解決のエラー（最重要）

### エラー1: `ft.colors` → `ft.Colors`
```
AttributeError: module 'flet' has no attribute 'colors'. Did you mean: 'Colors'?
```
**該当ファイル**: `inventory.py` (L82, L84, L86)、`dashboard.py` にも可能性あり
**原因**: Flet 0.82では小文字 `ft.colors` が廃止され `ft.Colors` に変更
**修正方法**: `ft.colors.TRANSPARENT` → `ft.Colors.TRANSPARENT`、`ft.colors.OUTLINE` → `ft.Colors.OUTLINE` に置換

### エラー2: `ft.Dropdown` の `on_change` → `on_select`
一部のファイル（特に `shift_ui.py`）でまだ旧API `on_change` が残っている可能性あり。
Flet 0.82の `Dropdown` は `on_select` のみ。

### エラー3: `ElevatedButton` の `text=` キーワード引数廃止
Flet 0.82では `ft.ElevatedButton(text="...")` は不可。
→ `ft.ElevatedButton("...", ...)` と位置引数にする。
（大部分は修正済みだが、残存箇所がないか全検索推奨）

### エラー4: `ft.icons` → `ft.Icons`（大文字）
小文字の `ft.icons.*` は全て `ft.Icons.*` へ変更が必要。
（大部分は修正済みだが、全検索推奨）

## Flet 0.82 APIの主な変更点まとめ
| 旧API | 新API |
|---|---|
| `ft.icons.XXX` | `ft.Icons.XXX` |
| `ft.colors.XXX` | `ft.Colors.XXX` |
| `Dropdown(on_change=...)` | `Dropdown(on_select=...)` |
| `ElevatedButton(text="...")` | `ElevatedButton("...", ...)` |
| `page.go("/path")` | `await page.push_route("/path")` |
| `page.dialog = dlg; dlg.open = True` | `page.open(dlg)` |
| `ft.app(target=main)` | `ft.run(main)` |

## テスト用認証情報
- ID: testtest1234@gmail.com
- パスワード: 1234

## バックエンドロジック状態
- `solver.py` (357行): ビームサーチシフト生成 → **正常、変更不要**
- `utils.py` (281行): 祝日判定・役割計算 → **正常、変更不要**
- `data_io.py` (369行): JSON読み書き・店舗管理 → **正常、変更不要**
- `db.py` (444行): 在庫REST操作 → **正常だが未結合**

## 次のステップ（優先順）
1. **全ファイルのFlet 0.82非互換を一掃する**（`ft.colors` → `ft.Colors` 等）
2. シフト管理画面・在庫管理画面がエラーなく表示されることを確認
3. 在庫管理のバーコード入力→商品検索→リスト追加→確定（db連携）
4. シフト管理のデータ編集UI（DataTable、希望休・出勤指定テーブル）

# Fletアプリ移行 引き継ぎログ 第4報（2026-03-19 17:00）

## シフト管理画面 (`shift.py`) の進捗
Streamlit版の機能をベースに、Flet版の大幅な機能追加を行いました。

### 実装済み
- **タブ構造**: 「基本設定」「スタッフ・休日設定」「シフト生成」の3タブ。
- **データ連携**: `shift_ui.py` のテーブルコンポーネントを統合。スタッフ編集や希望休指定が可能。
- **基本設定**: `DatePicker` による期間選択、最低人数・各曜日目標人数の設定項目。
- **結果表示**: シフト生成ボタン押下後、結果を `DataTable` で表示。
- **CSV保存**: `FilePicker` を利用したCSV書き出し機能。

### 解決済みのエラー
- `FilePicker.__init__() got an unexpected keyword argument 'on_result'`
  - **対応**: `on_result` 引数を外し、初期化後に `csv_picker.on_result = on_csv_save` と代入する形式に変更。

### 現在直面しているエラー（最優先で修正が必要）
- `Tab.__init__() got an unexpected keyword argument 'text'`
  - **箇所**: `shift.py` の `ft.Tabs` 内の `ft.Tab` 呼び出し。
  - **原因**: Flet 0.82では `ft.Tab(text="...")` が廃止され、`ft.Tab(label="...")` に変更された可能性が高い。
  - **さらに注意**: `ft.Tabs` 本体のシグネチャも変更されている（`Tabs(content=..., length=...)` 等）。従来の `tabs=[...]` 引数が使えるか含め、0.82のドキュメントまたはソースコードの再確認が必要。

## 次のステップ
1.  `shift.py` 内の `ft.Tab` を `ft.Tab(label="...", content=...)` に修正し、`ft.Tabs` の構造を 0.82 に適合させる。
2.  画面が表示されるようになったら、実際にシフトを生成し、表が表示され、CSVが保存できるかの一連のテストを行う。
3.  在庫管理画面 (`inventory.py`) の `ft.colors` 修正（第3報参照）がまだ残っているため対応する。

---

# Fletアプリ移行 引き継ぎログ 第5報（2026-03-24）

## 今回の到達点
- `flet_app/pages/shift.py` は Flet 0.82.2 で起動できる状態まで修正済み。
- `Tab.__init__() got an unexpected keyword argument 'text'` は解消済み。
- シフト管理は「基本設定 / スタッフ・休日設定 / シフト生成」の3タブで表示・編集・生成・CSV保存までつながっている。
- 在庫管理 (`flet_app/pages/inventory.py`) は `ft.Colors` へ統一済みで、移動入力 / 移動履歴 / 商品マスタの3タブ構成に再整理済み。
- シフト自動生成中の画面移動確認、生成履歴保存、履歴閲覧/削除まで実装済み。

## 今回解消した主な不具合

### 1. シフト画面のFlet 0.82互換対応
- `ft.Tab(text=...)` 問題は、最終的に現行Flet 0.82で安定するタブ構成へ調整して解消。
- `FilePicker` の扱い変更による `Unknown control: FilePicker` は解消。
  - 画面常駐ではなく、保存時に呼び出す形へ変更。
- `DatePicker` 周りの不具合を解消。
  - `Page.open` 非対応
  - `Dialog is already opened`
  - 日付が1日ずれる

### 2. シフト生成中のUX改善
- 生成中に他画面へ移動しようとすると、確認ダイアログを表示。
  - この画面に残る
  - 生成を続けて移動
  - キャンセルして移動
- 生成完了結果は履歴へ自動保存するため、移動後でも再確認可能。
- 生成結果プレビューと履歴プレビューを切り替え可能。

### 3. シフト生成速度の大幅改善
- 重さの主因は Flet 描画ではなく `flet_app/core/shift/solver.py` の CPU 計算だった。
- 旧状態の実測:
  - 5日分生成でも約52秒
  - 31日分は120秒タイムアウト
- 対応内容:
  - 役割カバー判定の事前計算
  - 探索幅 (`BEAM_WIDTH`) の入力規模に応じた自動調整
  - 日別パターン上限の自動調整
  - 毎候補ごとの巨大 `numpy` 配列コピー削減
  - 生成開始時にUIを先に更新してからバックグラウンド計算へ移行
- 改善後の実測:
  - 5日分: 約3.2秒
  - 31日分: 約7.1秒

### 4. デフォルト値とシフトロジックの改善
- デフォルト設定:
  - 朝の最低人数: 3
  - 夜の最低人数: 3
  - 優先曜日: 土・日
- `優先曜日` UI を追加し、余剰人数を寄せやすい曜日として solver に連携済み。
- 以前の「月末に余分な人数が寄って見える」問題は、意図仕様ではなく制約バランスの副作用だった。
  - 現在は優先曜日設定で寄せ先を明示可能。

### 5. スタッフ設定UIの拡張
- `flet_app/components/shift_ui.py` を拡張し、以下を編集可能にした。
  - 名前
  - 優先役割
  - 正社員
  - 朝可 / 夜可
  - 各役割可否
  - 前月末の連勤数
  - 最大連勤
  - 公休数
- `ID` 入力欄は廃止し、`No.` 表示へ整理。
- 旧保存データでも不足カラムを補完して読み込めるように `flet_app/core/shift/data_io.py` を拡張済み。

### 6. レイアウトの圧縮とモバイル寄せ
- `shift.py` のヘッダー・カード・日付ボタン・入力欄の余白を圧縮。
- `shift_ui.py` の `TextField / Dropdown / Checkbox / DataTable` をコンパクト化。
- シフト生成結果テーブルは、日付ヘッダーと役割セルをほぼ正方形に近いサイズへ調整済み。
- 基本設定タブで日付変更時に重い同期処理を避け、軽い再描画に寄せた。

### 7. 在庫管理の移植進捗
- `flet_app/pages/inventory.py` を Streamlit 版寄せで再構成済み。
  - 移動入力
  - 移動履歴
  - 商品マスタ
- `flet_app/core/inventory/view_model.py` を追加し、整形ロジックを純粋関数化。
- `tests/test_inventory_view_model.py` でテスト追加済み。

### 8. Supabase通信の軽量化
- `flet_app/core/supabase_client.py` で接続使い回し寄せに修正。
- `flet_app/core/data_service.py` に売上取得キャッシュを追加。
- `flet_app/core/inventory/db.py` でも毎回クライアントを作らない形へ整理。
- ログインやダッシュボード初期表示の待ち時間は短縮済みだが、端末環境次第でまだ体感差あり。

## 現在の主要ファイル
- `flet_app/pages/shift.py`
  - シフト画面本体
  - 日付選択
  - 生成中表示
  - 履歴UI
  - CSV保存
- `flet_app/components/shift_ui.py`
  - スタッフ設定テーブル
  - 希望休テーブル
  - 出勤指定テーブル
- `flet_app/core/shift/solver.py`
  - シフト生成ロジック
  - キャンセル対応
  - 高速化対応
- `flet_app/core/shift/data_io.py`
  - 店舗別設定保存
  - 履歴保存/読込/削除
  - 旧データ補完
- `flet_app/components/navigation.py`
  - 生成中ナビゲーションガード
- `flet_app/pages/inventory.py`
  - 商品管理UI
- `flet_app/core/inventory/view_model.py`
  - 商品管理画面の整形ロジック

## 検証結果
- 2026-03-24 時点で以下を確認済み。
- `python -m unittest tests.test_inventory_view_model tests.test_shift_ui_helpers`
  - 14 tests passed
- `py_compile`
  - `flet_app/pages/shift.py`
  - `flet_app/components/shift_ui.py`
  - `flet_app/core/shift/solver.py`
  - など主要変更ファイルで成功
- `python -m flet_app.main`
  - 起動スモーク成功
- 実操作上の確認済み項目
  - ログイン
  - シフト画面表示
  - タブ表示
  - シフト生成
  - CSV保存
  - 生成履歴

## 現在残っている課題

### 優先度 高
1. `dashboard.py` を Streamlit版基準でもう一段実用レベルへ寄せる
- KPI / フィルタ / 表示整理はまだ改善余地あり。

2. `inventory.py` のモバイル最適化を継続する
- 余白はかなり縮めたが、スマホ幅での詰めはまだ続きあり。

3. シフト画面の微調整
- 期間設定のレスポンスは改善済みだが、まだ完全に即時ではない。
- 見た目はだいぶ詰めたが、名前列や結果表の列幅はまだ微調整余地あり。

### 優先度 中
4. シフト生成のモード切替
- `高速生成 / 標準生成` の切替を付けると、体感速度と品質のバランスを選べる。

5. シフト生成の進捗表示強化
- 現状は生成中表示あり。
- 日別進捗や残り時間目安があるとさらにUX向上。

## 次の担当向けの推奨着手順
1. `flet_app/pages/shift.py` の見た目最終調整
- 基本設定の入力幅
- スタッフ設定の列幅
- 生成結果テーブルの名前列と日付列の最終バランス

2. `flet_app/pages/dashboard.py` の実用化
- Streamlit版のKPIと一覧に寄せる
- 表示待ちの原因がAPI取得か描画かを切り分ける

3. `flet_app/pages/inventory.py` のモバイル最適化
- 小さい画面でのレイアウト崩れを詰める
- 入力ブロックの縦長感を抑える

4. 必要なら `solver.py` に生成モード追加
- 高速モードはさらに探索幅を絞る
- 標準モードは現状維持

## 次のAIへの依頼テンプレート
以下を新しいチャットに貼ると続行しやすい。

---
Flet 0.82.2 移行の続きです。直近の作業ログは `docs/app_migration/handover_log.md` の第5報を参照してください。

現在の状態:
- `shift.py` は起動・編集・生成・CSV保存まで動作します
- `solver.py` は高速化済みで、31日生成が約7秒まで短縮されています
- `inventory.py` は3タブ構成で機能移植済みです

次にやりたいこと:
1. `flet_app/pages/shift.py` の余白・列幅・生成結果テーブルの見た目をさらに調整
2. `flet_app/pages/dashboard.py` を Streamlit 版により近づける
3. 必要なら `solver.py` に 高速生成 / 標準生成 の切替を追加

検証は `python -m unittest tests.test_inventory_view_model tests.test_shift_ui_helpers` と `python -m flet_app.main` の起動確認までお願いします。
---
## 次のAIへの指示用プロンプト例文
以下のプロンプトを新しいチャットに貼り付けてください：

---
Flet 0.82.2 への移行作業の続きをお願いします。
現在 `flet_app/pages/shift.py` を編集中ですが、`Tab.__init__() got an unexpected keyword argument 'text'` というエラーで画面が開きません。

1. `flet_app/pages/shift.py` の `ft.Tab` の `text="..."` を `label="..."` に修正してください。
2. また、Flet 0.82では `ft.Tabs` の構造（コンストラクタ引数）も変更されている可能性があるため、`tabs=[...]` という形式がエラーになる場合は 0.82 の仕様（TabBarとTabBarViewの組み合わせ、あるいはTabsの引数順）に合わせて修正してください。
3. 修正後、`flet_app/main.py` からアプリを起動し、ログイン（testtest1234@gmail.com / 1234）して「シフト管理」画面が正しく表示されるか確認してください。
4. シフト管理の各タブ（基本設定、スタッフ設定、シフト生成）が機能し、CSV保存まで行えるかを確認してください。
5. `flet_app/pages/inventory.py` に残っている `ft.colors`（小文字）を `ft.Colors`（大文字）に一括置換してください。
---

# Fletアプリ移行 引き継ぎログ 第6報（2026-03-24）

## 今回の到達点
- 新機能として `客注（お取り寄せ）管理機能` を Flet 側へ追加。
- `customer_orders` テーブル向けの Supabase CRUD 層を実装。
- Flet 画面に以下を実装。
  - 進行中4ステータスのタブ切替
  - 客注カード一覧
  - ワンクリックの次ステータス更新
  - 新規登録ダイアログ
  - 編集 / キャンセル / 削除
- ナビゲーションバーに `客注管理` を追加し、`/customer-orders` ルートへ接続済み。

## 追加・更新した主なファイル
- `flet_app/core/customer_orders/view_model.py`
  - 客注の表示整形、必須入力チェック、ステータス件数集計、次アクション判定
- `flet_app/core/customer_orders/db.py`
  - `customer_orders` テーブル向け CRUD
- `flet_app/pages/customer_orders.py`
  - 客注管理画面本体
- `flet_app/components/navigation.py`
  - 下部ナビに `客注管理` を追加
- `flet_app/main.py`
  - `CustomerOrdersView` のルーティング追加
- `tests/test_customer_orders_view_model.py`
  - 客注ロジックのテスト追加

## 実装メモ
- Flet 0.82.2 では `ft.UserControl` が存在しないため、画面状態とイベントをまとめたクラス (`CustomerOrdersPageController`) でモジュール化した。
- 完了・キャンセルはタブには出さず、上部サマリー件数で確認する構成。
- ステータス更新は一覧全再読込ではなく、更新済みレコードをローカル state に反映して UI を差し替える形。

## 検証結果
- `python -m unittest tests.test_customer_orders_view_model tests.test_inventory_view_model tests.test_shift_ui_helpers`
  - 20 tests passed
- `python -m py_compile flet_app/core/customer_orders/view_model.py flet_app/core/customer_orders/db.py flet_app/pages/customer_orders.py flet_app/main.py flet_app/components/navigation.py`
  - 成功
- `python -m flet_app.main`
  - 起動スモーク成功

## まだ残る課題
1. `flet_app/pages/customer_orders.py`
- 実機でのスマホ幅 / タブレット幅の押しやすさ確認は未実施。
- 完了 / キャンセル一覧を別途見たい運用なら、アーカイブ表示導線の追加余地あり。

2. 既存優先タスク
- `flet_app/pages/shift.py` の見た目最終調整
- `flet_app/pages/dashboard.py` の Streamlit 版寄せ
- 必要なら `flet_app/core/shift/solver.py` の `高速生成 / 標準生成` 切替

## 次に触るべきファイル
- `flet_app/pages/customer_orders.py`
  - 実機フィードバックを受けた UI 微調整
- `flet_app/pages/shift.py`
  - 余白・列幅・結果テーブルの最終調整
- `flet_app/pages/dashboard.py`
  - KPI / フィルタ / 一覧の改善

## Render 公開向けメモ
- `flet_app/main.py`
  - `get_runtime_options()` を追加し、`PORT` を見て `port / host / view` を切り替える構成へ変更済み。
- `main.py`
  - ルートに薄い起動エントリを追加済み。
- Render の Start Command 例
  - `python main.py`

# Fletアプリ移行 引き継ぎログ 第7報（2026-03-27）

## 今回の到達点
- `dashboard.py` を「売上サマリー画面」から「社内ダッシュボードのホーム画面」寄りに再構成。
- `inventory.py` の商品管理レイアウトを詰め、概要カードと2カラム寄りの構成へ整理。
- `customer_orders.py` の一覧描画を Render/Flet Web 互換寄りの単純なカード構成へ置き換え。
- 新規ページ `売上管理 (/sales)` を追加。
  - 期間指定
  - 店舗絞り込み
  - 商品名 / JAN / カテゴリ検索
  - 販売数 / 売上金額 / 粗利試算
  - ABC分析
  - カテゴリ構成の円グラフ風表示
  - 店舗別 / 日別の棒グラフ
  - 商品マスタ未紐付け一覧
- 一度ログインしたら再訪時にログイン画面を飛ばせるよう、認証情報の永続化を追加。

## 追加・更新した主なファイル
- `flet_app/pages/dashboard.py`
  - 社内ホーム画面向けレイアウトに改修
- `flet_app/pages/sales.py`
  - 売上管理画面を新規追加
- `flet_app/core/sales/view_model.py`
  - 売上データの結合、フィルタ、ABC分析、カテゴリ集計、未紐付け抽出
- `flet_app/core/auth_session.py`
  - 認証情報の保存 / 復元 / ログアウト共通化
- `flet_app/pages/login.py`
  - ログイン成功時に認証情報を保存
- `flet_app/main.py`
  - 起動時に保存済みセッションを復元
  - `/sales` ルートを追加
- `flet_app/components/navigation.py`
  - 下部ナビに `売上管理` を追加
- `flet_app/pages/customer_orders.py`
  - 客注一覧カードを簡素化
- `flet_app/core/data_service.py`
  - 売上取得列に `quantity` を追加
- `flet_app/core/supabase_client.py`
  - `refresh_session()` を追加
- `tests/test_sales_view_model.py`
  - 売上分析ロジックのテスト追加
- `tests/test_auth_session.py`
  - ログイン保持まわりのテスト追加

## 実装メモ
- 商品カテゴリ連携は現時点では `product_name` ベースで商品マスタと結合している。
- 結合できなかった売上は `未分類` / `JANコード "-"` / `unmatched_master=True` として扱う。
- 未紐付け商品の原価は楽観計算を避けるため、粗利試算では `売上 = 原価見込み` 扱いにしている。
- `Dropdown.__init__() got an unexpected keyword argument 'on_change'` は、現行 Flet では `on_select` を使う仕様だったため修正済み。
- Render 無料プランでは一定時間の非アクティブ後にスリープし、Flet Web 側が白画面っぽく見えることがある。アプリ側の完全解決ではなく、無料プラン由来の影響も強い。

## この回で push 済みのコミット
- `d9e636b` Refine dashboard home and stabilize customer orders
- `043ba13` Fix dashboard alignment for Render Flet version
- `1993a81` Polish inventory management layout
- `58f00d7` Add sales management and persistent login
- `77d2377` Fix sales dropdown event for current Flet

## 検証結果
- `python -m py_compile`
  - `flet_app/main.py`
  - `flet_app/pages/login.py`
  - `flet_app/pages/dashboard.py`
  - `flet_app/pages/sales.py`
  - `flet_app/pages/inventory.py`
  - `flet_app/pages/shift.py`
  - `flet_app/pages/customer_orders.py`
  - `flet_app/core/auth_session.py`
  - `flet_app/core/sales/view_model.py`
  - など今回の主要変更ファイルで成功
- `python -m unittest tests.test_sales_view_model tests.test_auth_session tests.test_customer_orders_view_model tests.test_inventory_view_model tests.test_shift_ui_helpers tests.test_flet_runtime`
  - 38 tests passed
- `python -m flet_app.main`
  - 起動スモーク成功
- Render 上で確認済み
  - ログイン復帰
  - 売上管理ページ遷移
  - `Dropdown` イベント互換修正後のページ表示

## まだ残る課題
1. `flet_app/pages/customer_orders.py`
- 灰色崩れ対策コードは入れたが、Render 実画面での十分な長時間確認はまだ必要。
- 実データ件数が増えた時の縦スクロール感やタブレット幅の見え方は未確認。

2. `flet_app/pages/sales.py`
- グラフは Flet 純正チャートではなく、棒グラフUIと SVG ベースの円グラフ風表示で構成している。
- 実運用データ件数が大きい場合の速度確認は未実施。
- `product_name` 完全一致連携のため、表記ゆれ吸収は今後の改善候補。

3. セッション維持
- ログイン保持は SharedPreferences ベース。
- ブラウザや環境によって保存可否差がある可能性はあるため、実ブラウザでの継続確認は今後も必要。

4. Render 無料プランの白画面
- 10数分放置後に白画面になる現象は、Render Free のスリープ影響の可能性が高い。
- 根本回避には有料化、または再接続導線の追加検討が必要。

## 次に触るべきファイル
- `flet_app/pages/customer_orders.py`
  - 一覧表示の長時間確認と必要ならさらに簡素化
- `flet_app/pages/sales.py`
  - 実データに合わせたレイアウト調整
  - 集計精度確認
  - CSV出力や詳細表の追加検討
- `flet_app/core/sales/view_model.py`
  - 商品名の表記ゆれ補正
  - JANベース連携への移行準備
- `flet_app/main.py`
  - Render 切断 / 再接続時の導線改善

## 次回の推奨着手順
1. Render 上で `客注管理` を実データ登録込みで再確認
- 灰色ブロックが完全に消えたか
- 登録、編集、ステータス更新、削除を通しで見る

2. `売上管理` の実データチューニング
- 期間指定の使いやすさ
- カテゴリ結合結果
- 未紐付け一覧の妥当性

3. Render 無料プラン対策
- 再接続時メッセージ
- 画面更新導線
- 必要なら有料化判断

# Fletアプリ移行 引き継ぎログ 第8報（2026-03-28 16:00頃）

## 今回の到達点

- 今日 15:08 に更新されていた `docs/app_migration/budibase_supabase_schema.md` と、15:44 に更新されていた `docs/app_migration/supabase_schema_checklist.md` を確認。
- いまの作業フェーズは「Flet の画面修正」ではなく、「Budibase + Supabase へ載せ替えるための共通スキーマ整理」であることを再確認。
- 現行 Flet コードが依存している列・型・ステータスを読み直し、スキーマ案とのズレを整理した。

## 今回確認した現行アプリのスキーマ契約

### 在庫管理

- `stores`
  - `id`
  - `name`
- `products`
  - `jan_code`
  - `product_name`
  - `cost_price`
  - `selling_price`
  - `category`
  - `markup_rate`
  - `updated_at`
- `transfers`
  - `transfer_date`
  - `from_store_id`
  - `to_store_id`
  - `jan_code`
  - `product_name`
  - `quantity`
  - `cost_price`
  - `total_cost`
  - `selling_price`
  - `memo`
- さらに一覧取得では
  - `stores!transfers_from_store_id_fkey(name)`
  - `stores!transfers_to_store_id_fkey(name)`
  の外部キー名に依存している

### 客注管理

- 列名
  - `customer_name`
  - `phone_number`
  - `item_name`
  - `item_details`
  - `staff_name`
  - `notes`
  - `status`
- ステータス
  - `pending`
  - `ordered`
  - `arrived`
  - `contacted`
  - `completed`
  - `cancelled`

### 売上管理

- `product_sales_data` から直接参照している列
  - `store_name`
  - `product_name`
  - `quantity`
  - `total_amount`
  - `transaction_date`
- GAS 仕様書側の `sale_date / sales_amount` とズレがあるため、まずは view で吸収する方針が安全

## 今回ドキュメントへ反映した判断

- `docs/app_migration/budibase_supabase_schema.md` に「現行 Flet 互換を保つための移行判断」を追記。
- Phase 1 は destructive change を避け、`追加列` と `view` を中心に進める方針を明文化。
- `transfers` 分割、`customer_orders.status` 再設計、`product_sales_data` の列名統一、`uuid` 全面移行は Phase 2 以降に回す方針を整理。

## この回で更新したファイル

- `docs/app_migration/budibase_supabase_schema.md`
  - 現行コードとの互換前提
  - Phase 1 / Phase 2 の切り分け
  - 直近で先に確定すべき 4 判断
- `docs/app_migration/handover_log.md`
  - 本ログ追記

## 次にやること

1. `docs/app_migration/supabase_schema_checklist.md` を使って、実 Supabase の列・型・外部キーを確認する
2. `stores.id` / `products.id` の型を確定する
3. `product_sales_data` の実列名を確定する
4. その結果を踏まえて、Phase 1 用の additive SQL を作る

## 補足

- 今回はドキュメント整理のみで、アプリコードの変更はなし
- テストや起動確認も今回は未実施

# Fletアプリ移行 引き継ぎログ 第9報（2026-03-28 16:20頃）

## 今回の到達点

- `.streamlit/secrets.toml` の接続設定を使い、実 Supabase REST API へ問い合わせて主要テーブルの実態を確認した。
- ドキュメントベースの想定ではなく、実DBの列名・主キー型・join 可否を確認できた。

## 実 Supabase で確認できた内容

### `stores`

- 実列:
  - `id`
  - `name`
  - `created_at`
- `id` は実データ上 `integer`

### `products`

- 実列:
  - `id`
  - `jan_code`
  - `product_name`
  - `cost_price`
  - `selling_price`
  - `category`
  - `markup_rate`
  - `updated_at`
- `id` は実データ上 `integer`

### `transfers`

- 実列:
  - `id`
  - `transfer_date`
  - `from_store_id`
  - `to_store_id`
  - `jan_code`
  - `product_name`
  - `quantity`
  - `cost_price`
  - `total_cost`
  - `selling_price`
  - `memo`
  - `created_at`
- `id` は実データ上 `integer`
- `stores!transfers_from_store_id_fkey(name)` と `stores!transfers_to_store_id_fkey(name)` の join は実際に成功

### `customer_orders`

- 実列:
  - `id`
  - `created_at`
  - `updated_at`
  - `customer_name`
  - `phone_number`
  - `item_name`
  - `item_details`
  - `staff_name`
  - `notes`
  - `status`
- `id` は実データ上 `uuid`
- 現時点で取得できた `status` は `pending`

### `product_sales_data`

- 実列:
  - `id`
  - `transaction_date`
  - `store_name`
  - `product_name`
  - `quantity`
  - `total_amount`
  - `created_at`
- `id` は実データ上 `integer`
- 実列名は `sale_date / sales_amount` ではなく `transaction_date / total_amount`

## 今回確定した判断

- Phase 1 用 additive SQL は `stores/products/transfers` の `integer` 主キー前提で書く
- `customer_orders` の拡張列 `store_id / product_id` を追加する場合も、まずは `integer` でそろえる
- 売上 view は `transaction_date / total_amount` を基準に組む
- `transfers` は少なくとも Phase 1 では残してよい

## 今回更新したファイル

- `docs/app_migration/supabase_schema_checklist.md`
  - 実 Supabase 確認結果を追記
- `docs/app_migration/schema_alignment_snapshot_2026-03-28.md`
  - 実DBで確定した事項を反映
- `docs/app_migration/handover_log.md`
  - 本ログ追記
- `.claude/memory/session-log.md`
  - セッション記録更新
- `.claude/memory/decisions.md`
  - 意思決定メモ更新

## 次にやること

1. Phase 1 用 additive SQL の草案を作る
2. `product_aliases` と売上 view 群を優先して SQL 化する
3. `customer_orders` の互換拡張列を整理する

# Fletアプリ移行 引き継ぎログ 第10報（2026-03-28 16:40頃）

## 今回の到達点

- 実 Supabase 確認結果を前提に、Phase 1 用の additive SQL 草案を追加した。
- あわせて、移行の「完成定義」を独立ドキュメント化した。

## 追加したファイル

- `inventory/supabase_phase1_additive.sql`
  - `products` の分析補助列追加
  - `product_aliases` 作成
  - `customer_orders` の互換拡張列追加
  - `sales_enriched_v`
  - `sales_daily_summary_v`
  - `sales_product_summary_v`
- `docs/app_migration/completion_definition.md`
  - 直近マイルストーンの Done 条件
  - 最終的な完成形
  - 直近で含めないもの
  - 各サービスの役割分担

## 今回の判断

- Phase 1 SQL は、既存 `transfers` を残す前提で作成
- `customer_orders.status` は現行 6 値前提を維持
- 売上 view は実列 `transaction_date / total_amount` から組み立てる
- Budibase 向けの列名としては view 上で `sale_date / sales_amount` 相当を吸収する

## 補足

- まだ SQL は Supabase に適用していない
- まだ Budibase 側の画面作成には着手していない
- 今回は「適用前の安全な草案を残す」段階

## 次にやること

1. `inventory/supabase_phase1_additive.sql` を見直して適用順を確定する
2. Supabase SQL Editor へ適用する
3. `sales_enriched_v` を前提に Budibase 売上画面の項目を固める
4. 在庫を `transfers` 継続にするか、`header + items` へ進めるかを確定する

# Fletアプリ移行 引き継ぎログ 第11報（2026-03-28 17:00頃）

## 今回の到達点

- Phase 1 用 SQL を「適用用」と「検証用」に分けた。
- `product_aliases` について、Budibase / Flet から publishable key で読めるように RLS と policy も SQL に含めた。

## 更新したファイル

- `inventory/supabase_phase1_additive.sql`
  - `product_aliases` の RLS / policy を追加
- `inventory/supabase_phase1_verify.sql`
  - 適用前後の確認 SQL を追加
  - 列確認
  - view 存在確認
  - サンプル取得
  - 未紐付け件数確認
  - FK 候補異常確認
  - `order_no` 重複確認

## 今回の判断

- Phase 1 の新設テーブルは、実運用で publishable key から触る前提まで含めて定義しておく
- 適用後に見るべき確認 SQL を先に作り、手順を固定する

## 次にやること

1. `inventory/supabase_phase1_additive.sql` を Supabase SQL Editor に適用する
2. 直後に `inventory/supabase_phase1_verify.sql` を流して結果を確認する
3. `sales_enriched_v` のサンプル結果を見て、Budibase 売上画面の列を確定する

# Fletアプリ移行 引き継ぎログ 第12報（2026-03-28 17:15頃）

## 今回の到達点

- repo をどう切るかの具体案を文書化した。
- 結論は「branch は今すぐ分ける」「repo は段階分離」「運用前にまず `gas/` を切る」。

## 追加したファイル

- `docs/app_migration/repo_split_strategy.md`
  - branch 戦略
  - 先に分ける repo
  - 後で分ける repo
  - 現ディレクトリをどう扱うか

## 今回の判断

- いまは monorepo のまま移行を進める
- `migration/budibase-phase1` を本線 branch として扱うのが良い
- `gas/` は運用前に別 repo 化する価値が高い
- Supabase 運用 repo は Phase 1 安定後に切る
- Budibase / Flet の repo 分離はまだ急がない

## 次にやること

1. branch 名を確定する
2. `gas/` を別 repo 化するタイミングを決める
3. Supabase Phase 1 SQL の適用へ戻る

# Fletアプリ移行 引き継ぎログ 第13報（2026-03-28 17:30頃）

## 今回の到達点

- 推奨どおり `migration/budibase-phase1` branch を作成して切り替えた。
- この環境では `psql` / `supabase` CLI / DB 接続文字列が無いため、自動適用はせず、Supabase SQL Editor 用の適用 runbook を追加した。

## 更新したファイル

- `docs/app_migration/phase1_sql_apply_runbook.md`
  - 適用前チェック
  - additive SQL 実行手順
  - verify SQL 実行手順
  - 適用後の確認観点
  - Git 上の扱い

## 今回の判断

- Git は `migration/budibase-phase1` branch で継続する
- DB 変更は、この環境から無理に自動化せず Supabase SQL Editor 前提で運用する
- 適用後は必ず `supabase_phase1_verify.sql` で確認する

## 次にやること

1. Supabase SQL Editor で `inventory/supabase_phase1_additive.sql` を適用する
2. 直後に `inventory/supabase_phase1_verify.sql` を流す
3. その結果をもとに Budibase 売上画面の項目定義へ進む

# Fletアプリ移行 引き継ぎログ 第14報（2026-03-28 18:00頃）

## 今回の到達点

- `npx.cmd supabase` で Supabase CLI を利用可能にした。
- `supabase init` を実行し、repo 内に `supabase/` ディレクトリを追加した。
- Phase 1 SQL を CLI でも `db push` に載せられるよう、migration ファイルを `supabase/migrations/` に追加した。

## 確認できたこと

- `supabase projects list` は未ログインのため失敗
- したがって remote 操作には次のいずれかが必要
  - `supabase login`
  - `SUPABASE_ACCESS_TOKEN`
- `supabase link --help` から、remote 適用には `project-ref` と remote DB password が必要
- project ref は `wpxewebmezghoulnasre`

## 更新したファイル

- `supabase/config.toml`
  - `supabase init` で生成
- `supabase/migrations/20260328173000_phase1_additive.sql`
  - Phase 1 additive SQL を CLI migration 形式でも配置
- `docs/app_migration/phase1_sql_apply_runbook.md`
  - CLI ルートを追記

## 今回の判断

- これ以降は SQL Editor ルートと CLI ルートの両方が選べる
- ただし CLI で remote 実行するには、DB password か適切な認証情報が必要
- `psql` はまだ未導入で問題なし

## 次にやること

1. remote DB password を用意できるなら `supabase link` を実行する
2. その後 `supabase db push --include-all` で migration を適用する
3. 適用後は `inventory/supabase_phase1_verify.sql` で確認する

# Fletアプリ移行 引き継ぎログ 第15報（2026-03-30）

## 今回の到達点

- 次の AI 向けに、現在地だけを短く読める handoff メモを追加した。
- `.claude/memory/context.json` も新規作成し、branch / phase / blocker / next step を拾えるようにした。

## 追加したファイル

- `docs/app_migration/next_ai_handoff_2026-03-30.md`
  - 現在地
  - branch
  - 完了済み作業
  - ブロッカー
  - 次にやること
- `.claude/memory/context.json`
  - 次AI向けの短い現在地情報

## 現時点のブロッカー

- `SUPABASE_ACCESS_TOKEN` または `supabase login`
- remote DB password

## 次にやること

1. handoff メモを起点に再開する
2. 認証情報があれば `supabase link` → `db push`
3. 無ければ SQL Editor ルートか Budibase 項目定義を先に進める

# Fletアプリ移行 引き継ぎログ 第16報（2026-03-30）

## 今回の到達点

- `supabase login` 後に `supabase link` を実行し、remote Supabase へ接続した。
- `npx.cmd supabase db push --include-all` により、`20260328173000_phase1_additive.sql` を remote DB へ適用した。
- 主要な verify クエリを linked DB に対して実行し、列 / policy / view / 整合性を確認した。
- `sales_enriched_v` の sample と未紐付け件数を確認し、Budibase 売上画面の初版列候補を整理した。

## 確認できたこと

- `products` の追加列 `product_group / brand / is_active` は反映済み
- `product_aliases` は作成済み
- `customer_orders` の追加列 9 個は反映済み
- `sales_enriched_v / sales_daily_summary_v / sales_product_summary_v` は存在確認済み
- `product_aliases` policy は `Allow all access to product_aliases`
- `invalid_store_refs = 0`
- `invalid_product_refs = 0`
- `duplicate_order_nos = 0`
- `sales_enriched_v.unmatched_master = true` は 271 件
- 未紐付け上位は `爪切りのみ / プードル（Ｃ） / 爪切りセット / 足裏バリカン / 犬（超小型）１〜５ｋｇ(土日祝)` など

## 今回の判断

- DB 適用フェーズのブロッカーは解消した
- 次の主作業は SQL 適用ではなく、`sales_enriched_v` を前提にした Budibase 売上画面の定義と `product_aliases` 整備
- Budibase 売上一覧の初版は
  - `sale_date`
  - `store_name`
  - `product_name`
  - `quantity`
  - `sales_amount`
  - `category`
  - `match_source`
  - `unmatched_master`
  を優先表示にする

## 更新したファイル

- `docs/app_migration/budibase_supabase_schema.md`
  - 実DB適用後の確定事項と Budibase 売上画面向け列メモを追記
- `docs/app_migration/budibase_sales_screen_spec.md`
  - Budibase 売上画面の初版仕様を新規作成
- `docs/app_migration/next_ai_handoff_2026-03-30.md`
  - blocker と next step を最新化
- `docs/app_migration/handover_log.md`
  - 本ログ追記
- `.claude/memory/context.json`
  - 現在地を SQL 適用後の状態へ更新
- `.claude/memory/session-log.md`
  - セッション記録更新

## 次にやること

1. `sales_enriched_v` を前提に Budibase 売上画面のフィルタと表示列を確定する
2. `unmatched_master = true` の商品名上位を抽出して `product_aliases` 登録候補を作る
3. 必要に応じて `sales_product_summary_v` を商品別ランキング画面へ割り当てる

# Fletアプリ移行 引き継ぎログ 第17報（2026-03-30）

## 今回の到達点

- `sales_enriched_v / sales_daily_summary_v / sales_product_summary_v` の実列を linked DB で確認した。
- 既存 Flet 売上画面の機能を読み直し、Budibase 初版へ移す対象を整理した。
- Budibase 売上画面の初版仕様を独立ドキュメントとして追加した。

## 今回確認したこと

- `sales_enriched_v` は
  - `sale_date`
  - `store_name`
  - `product_name`
  - `quantity`
  - `sales_amount`
  - `jan_code`
  - `category`
  - `product_group`
  - `brand`
  - `estimated_cost`
  - `estimated_profit`
  - `match_source`
  - `unmatched_master`
  を Budibase 表示用にそのまま使える
- `sales_daily_summary_v` は日次集計画面に十分
- `sales_product_summary_v` は商品別ランキング画面に十分
- Flet の ABC 分析は、Phase 1 初版では Budibase に無理に持ち込まず後続対応が安全

## 追加したファイル

- `docs/app_migration/budibase_sales_screen_spec.md`
  - 売上一覧
  - 日次集計
  - 商品別集計
  - 未紐付け確認
  - 初版フィルタ
  - 既定表示列
  - KPI 方針
  - `product_aliases` 運用メモ

## 次にやること

1. Budibase 上で `sales_enriched_v` を使った売上一覧画面を作る
2. 仕様どおりにフィルタと既定列を設定する
3. 未紐付け専用ビューを作り、`product_aliases` 登録運用へつなげる

# Fletアプリ移行 引き継ぎログ 第18報（2026-03-30）

## 今回の到達点

- Budibase 売上画面の仕様書を、Builder 上の実装手順へ落とした。
- datasource 追加から 4 画面作成、公開前チェックまでを 1 本の guide にまとめた。
- 秘密情報を repo に残さない前提で、Supabase 接続情報の扱いも明記した。

## 追加したファイル

- `docs/app_migration/budibase_sales_build_guide.md`
  - datasource 追加
  - `sales_enriched_v` 取り込み
  - 売上一覧の列 / フィルタ / ソート
  - 日次集計の作り方
  - 商品別集計の作り方
  - 未紐付け確認の作り方
  - 公開前チェック

## 今回の判断

- Budibase 実装は `sales_enriched_v` の売上一覧から着手する
- 初版は KPI や ABC 分析を無理に作り込まず、一覧とフィルタの完成を優先する
- Budibase では `sales_amount` を表示用の正本とし、`total_amount` は前面に出さない

## 次にやること

1. `budibase_sales_build_guide.md` に沿って Budibase で datasource を追加する
2. `売上一覧` 画面を先に完成させる
3. その後 `日次集計` と `商品別集計` を追加する
4. `未紐付け確認` から `product_aliases` 運用へつなげる

# Fletアプリ移行 引き継ぎログ 第19報（2026-03-30）

## 今回の到達点

- Budibase Builder 上のクリック順を、そのまま追えるメモとして追加した。
- `Data` から datasource を追加し、`Screens` と `Design` で 4 画面を作る順を固定した。
- 公式 docs の現在の用語に合わせて、`Screens / Table / Filter / Data Provider / Chart` ベースで整理した。

## 追加したファイル

- `docs/app_migration/budibase_sales_click_guide.md`
  - datasource 追加のクリック順
  - view 取り込みのクリック順
  - `売上一覧` の作り方
  - `日次集計` の作り方
  - `商品別集計` の作り方
  - `未紐付け確認` の作り方
  - 公開前チェック

## 今回の判断

- 最初の 1 画面は `売上一覧` に集中する
- 初版の全文検索は無理に作り込まず、まずは Table + Filter で成立させる
- `未紐付け確認` は `sales_enriched_v` の固定 filter で十分スタートできる

## 次にやること

1. `budibase_sales_click_guide.md` を見ながら Budibase で datasource を追加する
2. `売上一覧` を 1 画面だけ先に完成させる
3. 完成後に `日次集計` と `商品別集計` を足す
4. `未紐付け確認` を alias 運用の起点にする

# Fletアプリ移行 引き継ぎログ 第20報（2026-03-30）

## 今回の到達点

- Budibase の最初の 1 画面 `売上一覧` について、具体設定値のサンプルを独立メモ化した。
- `Data Provider / Dynamic Filter / Table` に何を入れるかを、列レベルまで固定した。
- 初版では `sales_amount` を表示用の正本にし、`total_amount` を隠す方針をさらに明確化した。

## 追加したファイル

- `docs/app_migration/budibase_sales_list_screen_sample.md`
  - Screen 名
  - Data Provider 設定
  - Dynamic Filter 設定
  - Table 表示列
  - 列ラベル
  - Row settings
  - 初期ソート
  - 初版確認手順

## 今回の判断

- `売上一覧` は `sale_date / store_name / product_name / quantity / sales_amount / category / match_source / unmatched_master` の 8 列で始める
- `transaction_date / total_amount / matched_product_id` などは初版では隠す
- `Add/Edit/Delete` は OFF にして、最初は読み取り専用の明細画面として成立させる

## 次にやること

1. `budibase_sales_list_screen_sample.md` の値をたたき台に `売上一覧` を作る
2. 作成後に `store_name` と `unmatched_master` の絞り込みを確認する
3. 問題なければ `日次集計` へ進む

# Fletアプリ移行 引き継ぎログ 第21報（2026-03-30）

## 今回の到達点

- ドキュメントだけでなく、未紐付け売上を alias 運用へつなぐ実装を追加した。
- `sales_enriched_v` の未紐付け商品名を集計して、CSV と JSON をローカルへ出力できるようにした。
- `product_aliases` 用の import たたき台 CSV も同時生成できるようにした。

## 追加したファイル

- `flet_app/core/sales/unmatched_export.py`
  - 未紐付け売上集計 SQL の生成
  - alias import 行の生成
  - CSV / JSON 出力
- `scripts/export_unmatched_sales_candidates.py`
  - linked Supabase へ問い合わせて export を実行
- `tests/test_unmatched_sales_export.py`
  - SQL 生成
  - CLI 出力 JSON 抽出
  - CSV 出力
  のテスト追加

## 確認できたこと

- `venv\\Scripts\\python.exe scripts\\export_unmatched_sales_candidates.py --limit 100`
  で export 実行成功
- 出力先:
  - `local_exports/budibase/unmatched_sales_candidates.csv`
  - `local_exports/budibase/product_aliases_import_template.csv`
  - `local_exports/budibase/unmatched_sales_candidates.json`
- 今回の出力件数は `111`

## 今回の判断

- Budibase 実装前に alias 候補を CSV で見られる状態にしておく価値が高い
- `product_aliases` は手入力だけでなく、CSV 下書きから埋める運用に寄せられる
- `sales_enriched_v` の未紐付け対応は、Budibase 画面作成と並行して進めてよい

## 次にやること

1. `budibase_sales_list_screen_sample.md` を見ながら `売上一覧` を作る
2. 並行して `local_exports/budibase/product_aliases_import_template.csv` を使い alias 候補を埋める
3. `product_aliases` 反映後に export を再実行して未紐付け減少を確認する

# Fletアプリ移行 引き継ぎログ 第22報（2026-03-30）

## 今回の到達点

- `product_aliases` の CSV 取り込みロジックを追加し、dry-run と apply の両方を回せるようにした。
- export で出した `product_aliases_import_template.csv` をそのまま入力に使える形にそろえた。
- テストを追加し、行正規化 / 重複検知 / product_id 検証 / upsert の主要フローを確認した。

## 追加したファイル

- `flet_app/core/sales/product_alias_import.py`
  - CSV 読み込み
  - import 行の正規化
  - duplicate alias 検知
  - product_id 検証 SQL
  - `product_aliases` upsert SQL
- `scripts/import_product_aliases_from_csv.py`
  - linked Supabase へ dry-run / apply を行う CLI

## 更新したファイル

- `flet_app/core/sales/__init__.py`
- `tests/test_product_alias_import.py`
- `docs/app_migration/next_ai_handoff_2026-03-30.md`
- `.claude/memory/context.json`
- `.claude/memory/session-log.md`

## 確認できたこと

- `venv\\Scripts\\python.exe -m unittest tests.test_product_alias_import tests.test_unmatched_sales_export tests.test_sales_view_model`
  で 14 テスト成功
- `venv\\Scripts\\python.exe scripts\\import_product_aliases_from_csv.py`
  で dry-run 実行成功
- 現在のテンプレート CSV は `product_id` 未入力のため、`actionable_rows = 0` / `skipped_rows = 111` / `errors = []`

## 今回の判断

- alias 運用は `CSV を埋める -> dry-run -> apply -> export 再実行` の順で進める
- `product_id` が空欄の行はエラーではなく skip として扱い、テンプレートを段階的に埋められるようにする
- 同一 `alias_name + source_system` の重複は DB 反映前に検知して止める

## 次にやること

1. `local_exports/budibase/product_aliases_import_template.csv` に `product_id` を埋める
2. `venv\\Scripts\\python.exe scripts\\import_product_aliases_from_csv.py` で dry-run 検証する
3. 問題なければ `venv\\Scripts\\python.exe scripts\\import_product_aliases_from_csv.py --apply` で反映する
4. `venv\\Scripts\\python.exe scripts\\export_unmatched_sales_candidates.py --limit 100` を再実行して未紐付け減少を確認する
5. 並行して Budibase の `売上一覧` を Builder 上で作る

# Fletアプリ移行 引き継ぎログ 第23報（2026-03-30）

## 今回の到達点

- linked Supabase を確認し、未紐付け上位 20 件は `products` に exact match が 1 件もないことを確認した。
- このため `product_aliases` だけでは解消できず、先に `products` 側へサービス商品を追加する必要があると判明した。
- その次段に備えて、未紐付け名をそのまま `products` 追加候補として埋められる seed テンプレートを export に追加した。

## 追加・更新したファイル

- `flet_app/core/sales/unmatched_export.py`
  - `products_seed_template.csv` の出力を追加
- `scripts/export_unmatched_sales_candidates.py`
  - product seed CSV のパスを JSON 出力に追加
- `tests/test_unmatched_sales_export.py`
  - seed template 行生成と CSV 出力のテストを追加
- `docs/app_migration/next_ai_handoff_2026-03-30.md`
- `docs/app_migration/handover_log.md`
- `.claude/memory/context.json`
- `.claude/memory/session-log.md`

## 確認できたこと

- `WITH top_aliases ... LEFT JOIN public.products p ON p.product_name = ta.alias_name`
  の確認で、上位 20 件は `product_id = null`
- `venv\\Scripts\\python.exe -m unittest tests.test_product_alias_import tests.test_unmatched_sales_export tests.test_sales_view_model`
  で 15 テスト成功
- `venv\\Scripts\\python.exe scripts\\export_unmatched_sales_candidates.py --limit 100`
  で再出力成功
- 新規出力:
  - `local_exports/budibase/products_seed_template.csv`

## 今回の判断

- 次の実務は `product_aliases` 直投入ではなく、先にサービス商品を `products` に追加すること
- 追加候補の初期値は alias 名そのものを seed として扱い、カテゴリや価格は後から確定できる形にする
- `products` 追加後に alias import を進める順に切り替える

## 次にやること

1. `local_exports/budibase/products_seed_template.csv` を見て、サービス商品として `products` に追加する候補を確定する
2. `venv\\Scripts\\python.exe scripts\\import_products_from_csv.py` で dry-run し、問題なければ `--apply` で `products` を追加する
3. `products` 追加後に `local_exports/budibase/product_aliases_import_template.csv` へ `product_id` を埋める
4. `venv\\Scripts\\python.exe scripts\\import_product_aliases_from_csv.py` で dry-run する
5. 問題なければ `--apply` で `product_aliases` を反映する
6. export を再実行して未紐付け件数が下がるか確認する

# Fletアプリ移行 引き継ぎログ 第24報（2026-03-30）

## 今回の到達点

- `products_seed_template.csv` を linked Supabase へ流すための import ロジックを追加した。
- Windows のコマンド長制限に当たらないよう、長い SQL は一時 `.sql` ファイル経由で `supabase db query --file` に切り替えた。
- 現在の seed テンプレートに対する dry-run は `actionable_rows = 111` / `errors = []` まで確認できた。

## 追加したファイル

- `flet_app/core/sales/product_seed_import.py`
  - seed CSV 読み込み
  - 自動 `jan_code` 生成
  - 既存 product 名 / jan_code 衝突の検知
  - `products` update / insert SQL
- `scripts/import_products_from_csv.py`
  - linked Supabase へ dry-run / apply を行う CLI
- `tests/test_product_seed_import.py`
  - 自動 `jan_code`
  - duplicate product_name
  - 既存 product 衝突
  - apply 戻り値
  のテスト追加

## 更新したファイル

- `flet_app/core/sales/unmatched_export.py`
  - `products_seed_template.csv` に `jan_code` 列を追加
- `scripts/import_product_aliases_from_csv.py`
  - 長い SQL を `--file` 経由に変更
- `flet_app/core/sales/__init__.py`
- `docs/app_migration/next_ai_handoff_2026-03-30.md`
- `.claude/memory/context.json`
- `.claude/memory/session-log.md`

## 確認できたこと

- `venv\\Scripts\\python.exe -m unittest tests.test_product_seed_import tests.test_product_alias_import tests.test_unmatched_sales_export tests.test_sales_view_model`
  で 22 テスト成功
- `venv\\Scripts\\python.exe scripts\\export_unmatched_sales_candidates.py --limit 100`
  で seed テンプレート再出力成功
- `venv\\Scripts\\python.exe scripts\\import_products_from_csv.py`
  で dry-run 実行成功
  - `total_rows = 111`
  - `actionable_rows = 111`
  - `errors = []`

## 今回の判断

- 次は `products_seed_template.csv` を埋めて `products` 追加を先に進める
- alias import より先に products import を通せる状態になった
- `product_aliases` import も同じ `--file` 経由にして、大きめ CSV でも詰まりにくくした

## 次にやること

1. `local_exports/budibase/products_seed_template.csv` に category / product_group / selling_price など必要値を埋める
2. `venv\\Scripts\\python.exe scripts\\import_products_from_csv.py` で再度 dry-run する
3. 問題なければ `venv\\Scripts\\python.exe scripts\\import_products_from_csv.py --apply` で `products` を追加する
4. 追加された `products.id` を `product_aliases_import_template.csv` へ反映する
5. `scripts/import_product_aliases_from_csv.py` を dry-run / apply する
6. export を再実行して未紐付け件数の差分を確認する

# Fletアプリ移行 引き継ぎログ 第25報（2026-03-30）

## 今回の到達点

- `products_seed_template.csv` にレビューしやすい推奨値を自動入力する改善を追加した。
- `category` は `サービス`、`product_group` は alias 名のパターンから `トリミング / オプション / 送迎 / ホテル` を推定する。
- `selling_price` は未紐付け売上の平均単価ベースで自動計算し、現時点で 111 行とも dry-run 可能な状態を維持した。

## 更新したファイル

- `flet_app/core/sales/unmatched_export.py`
  - `infer_service_product_group`
  - `estimate_service_selling_price`
  - seed 行への推奨値入力
- `tests/test_unmatched_sales_export.py`
- `flet_app/core/sales/__init__.py`
- `docs/app_migration/next_ai_handoff_2026-03-30.md`
- `docs/app_migration/handover_log.md`
- `.claude/memory/context.json`
- `.claude/memory/session-log.md`

## 確認できたこと

- 再出力後の `local_exports/budibase/products_seed_template.csv` 先頭例:
  - `爪切りのみ -> サービス / オプション / 812`
  - `プードル（Ｃ） -> サービス / トリミング / 7718`
  - `送迎料` のような名称は `送迎`
  - `一時預かり` を含む名称は `ホテル`
- `venv\\Scripts\\python.exe scripts\\import_products_from_csv.py`
  の dry-run は引き続き `actionable_rows = 111` / `errors = []`
- `venv\\Scripts\\python.exe -m unittest tests.test_product_seed_import tests.test_product_alias_import tests.test_unmatched_sales_export tests.test_sales_view_model`
  で 24 テスト成功

## 今回の判断

- `products_seed_template.csv` は blank 叩き台ではなく、推奨値入りのレビュー用テンプレートとして扱う
- `--apply` 前に価格や分類を必要箇所だけ直す運用に寄せる
- これで `products` 追加前の手作業はかなり減らせる

## 次にやること

1. `local_exports/budibase/products_seed_template.csv` をレビューし、必要な行だけ price / group を微修正する
2. `venv\\Scripts\\python.exe scripts\\import_products_from_csv.py --apply` で `products` を追加する
3. 追加された `products.id` を alias CSV に反映する
4. `scripts/import_product_aliases_from_csv.py` を dry-run / apply する
5. export を再実行して未紐付け件数の差分を確認する

# Fletアプリ移行 引き継ぎログ 第26報（2026-03-30）

## 今回の到達点

- `products_seed_template.csv` を `--apply` で linked Supabase へ反映し、111 件のサービス商品を `products` に追加した。
- 追加後に `sales_enriched_v` を確認したところ、`unmatched_master = true` は `0` 件になった。
- これにより、当面の `product_aliases` 対応は不要になり、主作業を Budibase 画面実装へ戻せる状態になった。

## 確認できたこと

- `venv\\Scripts\\python.exe scripts\\import_products_from_csv.py --apply`
  - `upserted_rows = 111`
  - `errors = []`
- `SELECT COUNT(*)::INTEGER AS unmatched_count FROM public.sales_enriched_v WHERE unmatched_master = TRUE;`
  - `unmatched_count = 0`
- `SELECT product_name ... WHERE unmatched_master = TRUE ... LIMIT 20;`
  - 空配列

## 今回の判断

- `products` 追加だけで現時点の未紐付けは解消できた
- 今すぐ `product_aliases` を入れなくても、`sales_enriched_v` の初版用途には支障がない
- 次の優先は DB 整備ではなく Budibase 売上画面の Builder 実装

## 次にやること

1. `budibase_sales_click_guide.md` と `budibase_sales_list_screen_sample.md` を見ながら `売上一覧` を作る
2. `sales_enriched_v` で filter / sort / 列表示を確認する
3. 問題なければ `日次集計` と `商品別集計` を追加する
4. 新しい未紐付けが出た時だけ `product_aliases` 運用へ戻る

# Fletアプリ移行 引き継ぎログ 第27報（2026-04-02）

## 今回の到達点

- Next.js Phase 2 の最初の対象として、`/orders` の初版を実装した。
- 一覧、ステータスタブ、新規登録、編集、ステータス前進、キャンセルまで Next.js 上で完結できる状態にした。
- サイドナビ / ボトムナビにも `/orders` 導線を追加した。
- `npm run lint` と `npm run build` が通る状態まで確認した。

## 更新したファイル

- `next_app/app/(dashboard)/orders/page.tsx`
- `next_app/app/actions/orders.ts`
- `next_app/components/orders/OrdersBoard.tsx`
- `next_app/components/orders/OrderCard.tsx`
- `next_app/components/orders/OrderFormModal.tsx`
- `next_app/lib/orders.ts`
- `next_app/lib/queries/orders.ts`
- `next_app/lib/types/database.ts`
- `next_app/components/layout/SideNav.tsx`
- `next_app/components/layout/BottomNav.tsx`

検証のために最小限修正:

- `next_app/components/ui/DataTable.tsx`
- `next_app/lib/supabase/server.ts`
- `next_app/lib/supabase/client.ts`
- `next_app/lib/supabase/middleware.ts`
- `next_app/lib/queries/sales.ts`
- `next_app/app/(dashboard)/sales/page.tsx`
- `next_app/app/(dashboard)/sales/daily/page.tsx`
- `next_app/app/(dashboard)/sales/products/page.tsx`
- `docs/app_migration/next_ai_handoff_phase2.md`

## 実装内容の要点

- 読み取りは Server Component 側で実施
- 更新は `app/actions/orders.ts` の Server Actions に集約
- 各 action 内で Supabase Auth の `getUser()` を再確認
- 更新後は `revalidatePath('/orders')` と `refresh()` を実行
- UI はモバイルでも扱いやすいカードベース
- 既存 Flet の 6 ステータス運用を維持

## 確認できたこと

- `npm run lint`
  - 成功
- `npm run build`
  - 成功
- build 結果に `/orders` が dynamic route として出力されることを確認

## 今回の判断

- `/orders/[id]` は今回は作らず、まず一覧運用を成立させる方を優先した
- `customer_orders` / `stores` の型は手書きで補完した
- ただし Supabase 型はまだ完全自動生成版ではないため、将来的には `lib/types/database.ts` を正式生成型へ寄せた方がよい
- 次の実装優先は `Phase 2 Step 3` の `/products/unmatched` が妥当

## 次にやること

1. `/products/unmatched` の設計と実装
2. `products` / `product_aliases` を使う Server Actions の設計
3. 必要なら `lib/types/database.ts` を Supabase 生成型へ置き換える
4. その後に `/products` と `/products/aliases` を進める
