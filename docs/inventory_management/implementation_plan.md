# Next.js版「棚卸し・在庫管理」実装計画

> 作成日: 2026-08-23
> 状態: **Phase 2本番DB適用・実DB検証完了 / Git・Vercel反映中**
> 対象店舗: 本店 `store_id=7`、わんわん `store_id=6`

## 1. 目的と前提

- 営業中に事前計数を進め、棚卸し当日は簡単な確認で済む運用にする。
- 商品ごとの数量入力を最優先し、数量を保存したサーバー時刻を計数基準時刻として記録する。
- POSが保持する「在庫数」は一切使用しない。
- 商品照合は常に `store_id + JAN` で行い、両店舗に同じJANがあっても別商品・別在庫とする。
- 現在庫は増減を継ぎ足すのではなく、物理計数を基準に履歴を再集計して上書きする。
- 既存の店舗分離、リアルタイム入出庫履歴、店舗間移動、JANスキャナーを再利用し、再実装しない。

## 2. 調査結果

### 2-1. 外部サービスと作業ツリー

| 対象 | 確認結果 | 実装前の扱い |
|---|---|---|
| Git/GitHub | `gh` 認証・GitHub APIとも利用可能。ローカルHEADとリモート`main`は同じ `2cc0b3f` | 通常の`git status`は古いGitリンク参照で失敗するため、当面`--ignore-submodules=all`を使用。実装は専用worktree/branchで分離する |
| 未コミット差分 | `next_app/scratch/test_gas.mjs` 1件の変更と、既存の未追跡調査ファイル多数 | 今回の変更へ含めず、stage/commit対象をパスで限定する |
| GAS | `clasp 3.3.0`で認証済み。認証付きヘッダー診断をversion 56として既存Web Appへ反映し、両店舗と通常履歴を本番検証済み | v55を切り戻し用に保持。通常履歴の認証強化は後続Phaseで同時切替する |
| Supabase | linked CLI管理経路を確立。Phase 1・2 migrationを本番適用し、履歴16/16一致、DB lint 0件、実DB店舗越境テスト成功 | 破壊的rollbackや追加migrationは引き続き対象と差分を事前確認する |
| Vercel | GitHub Deployment/Statusから最新Production成功を確認 | Vercel CLI/Tokenはローカル未確認。GitHub連携の状態確認は可能 |
| Serena | AGENTS.md記載の`.serena/memories/`は現在の作業ツリーに存在しない | Plans、現行コード、Git履歴、既存設計書で補完する |

### 2-2. 商品マスタ

- `products` は `UNIQUE (store_id, jan_code)`。`products(id, store_id)`にも複合一意制約がある。
- 現在6544件: 本店3780件（有効3778/停止2）、わんわん2764件（有効2754/停止10）。
- `store_id + JAN` 重複は0件。同じJANが両店舗に存在する組み合わせは1359件で、店舗別レコードとして分離済み。
- カテゴリは全商品にあり、仕入れ先は本店2837件、わんわん1059件に設定済み。
- JAN長は8/12/13桁が中心だが、本店に6桁・14桁の商品が各1件ある。先頭0を同一視すると店舗内で1組が衝突するため、棚卸しでは完全一致を優先し、曖昧候補はエラーにする。
- 既存商品Actionは選択店舗をサーバー側で再判定し、更新時にも`store_id`を絞っている。ただし既存RLSはanon全許可で、DB単独では店舗権限を保証していない。

### 2-3. POS入出庫履歴キャッシュ

- `realtime_history_cache` は店舗ごとに1行だけ保持し、指定期間のJSONを上書きする表示用キャッシュ。
- 現在の履歴行は `productCode/productName/taskContent/storeName/taskDateTime/quantity/cost/totalCost` の8項目だけで、安定した取引IDはない。version 56の元CSVヘッダー診断でも、両店舗とも8項目と末尾空列の計9列だけでID候補は0件だった。
- POS日時は分単位（`yyyy/MM/dd HH:mm`）で、商品計数時刻との同一分内の前後関係を判定できない。
- 最新キャッシュでは、わんわんの販売41件のうちJANなし13件、同内容の販売重複2行を確認した。内容ハッシュだけで重複排除すると正当な複数販売を消す危険がある。
- 現在の表示ロジックは販売と返品を画面表示時に相殺するが、在庫台帳ではない。
- キャッシュは店舗間移動・物品使用を移動元側だけ追加しており、移動先への入庫は含まない。

### 2-4. 店舗間移動・物品使用

- `transfers` は安定した連番`id`を持つフラットテーブル。現在366件（移動360、物品使用6）。
- 移動元は現在すべて本店で、わんわんへの移動は100件。他店舗への出庫も本店在庫から減算する必要がある。
- 在庫計算では `from_store_id` と `to_store_id` の両方を取得し、移動元を減算、移動先を加算する。
- 現行の更新・削除Actionは認証だけで対象店舗の再認可が不足している。棚卸し導入時の権限強化対象に含める。

### 2-5. 店舗認証

- Supabase Authの`user_metadata.store_type`と`current_store_view` Cookieで、master/wanwanと表示店舗を決めている。
- わんわんアカウントはCookieを書き換えても`currentView=wanwan`に固定される。
- ただしCookieは表示ヒントであり、DB権限の根拠にはできない。また`user_metadata`はユーザー自身が更新可能なため、RLSの認可情報には使用しない。
- 棚卸しではDB管理の`user_store_access`を権限の正本とし、本店専用アカウントは7、指定2アカウントは6/7、将来追加するわんわん専用アカウントは6だけを許可する。

## 3. 在庫計算方式

### 3-1. 採用方式: 計数基準からの全量再計算

商品ごとに次を保持する。

- `counted_quantity`: 実際に入力した物理数量。`0`は有効な棚卸し済み値。
- `counted_at`: 数量を初回入力または「置き換え」したサーバー時刻。
- `uncounted`: 数量未入力。`0`とは別状態。

計算区間は原則 `(counted_at, calculation_as_of]` とする。

```text
現在庫
= 物理計数
- 計数後の販売
+ 計数後の返品
+ 計数後の店舗移動入
- 計数後の店舗移動出
- 計数後の物品使用
± 計数後の手動調整
```

同期のたびに全項目を再集計し、`inventory_balances`へ計算結果を上書きする。前回値へ差分を足し引きしないため、同じPOS販売を何度取得しても二重減算しない。

### 3-2. 営業中棚卸しの時刻ルール

- 時刻はクライアント端末ではなくDB/サーバーで記録する。
- 初回入力: 数量と`counted_at`を同時に確定する。
- 「追加」: 数量を加算するが、元の`counted_at`は維持する。操作時刻は監査履歴へ別記録する。
- 「数量を置き換える」: 全数を再確認した扱いとし、数量を置換して`counted_at`を新しいサーバー時刻へ更新する。
- 「キャンセル」: DBを変更しない。
- 簡単な「確認済み」操作だけでは`counted_at`を更新しない。更新すると事前入力後の販売が消えるため。
- POS日時が分単位なので、計数と同じ分の販売/返品は自動判定せず「時刻境界不明」として確認対象にする。確認後の数量置換、または明示的な前後判定を要求する。

### 3-3. POS履歴の扱い

- 在庫へ反映するのは`販売`と`返品`だけ。`注文`などは在庫増減0。
- 数量符号は表示値に依存せず、販売`-abs(quantity)`、返品`+abs(quantity)`へ正規化する。
- 商品照合は`store_id + JAN`完全一致。JANなし販売や曖昧JANは在庫へ自動反映せず、未照合一覧と件数を表示する。
- 取得したPOS行はスナップショット単位で保存し、行順を含めて保持する。同一スナップショット内の同一内容行は勝手に削除しない。
- 計算実行は常に1つのPOSスナップショットだけを選ぶ。同じ期間を再取得しても複数スナップショットを合算しない。
- 遅れて現れるPOS履歴にも追従できるよう、確定後も元の`counted_at`から再計算できる物理計数を保持する。確定時点の数量だけへ基準を潰さない。

### 3-4. 方式比較

| 方式 | 二重減算 | 遅延履歴 | 現状適合 | 判断 |
|---|---|---|---|---|
| 最終同期日時から差分減算 | 防ぎにくい | 取りこぼす | 安定IDなし | 不採用 |
| 内容ハッシュを取引ID代用 | 同一行は抑止 | 追跡可能 | 正当な同内容販売を誤削除 | 不採用 |
| 計数時刻から履歴を全量再計算 | 発生しない | 次回再計算で反映 | 現行8項目で可能 | **採用** |
| 安定POS取引IDのイベント台帳 | UNIQUEで防止 | 後着も登録可能 | 元CSVにもID候補なし | POS仕様変更時だけ再検討 |

## 4. DB設計案

### 4-1. 権限

| テーブル/関数 | 主な列・責務 |
|---|---|
| `user_store_access` | `user_id, store_id, role`。店舗権限の正本。本店専用には7、両店舗担当には6/7、将来のわんわん専用には6を付与 |
| `private.can_access_store(store_id)` | RLS用。ユーザーが直接変更できない権限表を参照 |

`user_metadata`やCookieはRLSで信用しない。すべての棚卸しテーブルでRLSを有効化し、anonの直接DMLを拒否する。DB関数は原則`SECURITY INVOKER`とし、必要な場合だけ`SECURITY DEFINER SET search_path=''`、完全修飾名、`anon/public`からのEXECUTE revokeを適用する。

### 4-2. 棚卸しと監査

| テーブル | 主な列・制約 |
|---|---|
| `inventory_sessions` | `id, store_id, status, started_at/by, finalized_at/by, row_version`。`store_id IN (6,7)`。店舗ごとにdraft/finalizingは最大1件 |
| `inventory_session_items` | `session_id, store_id, product_id, jan_snapshot, product_name_snapshot, category_snapshot, supplier_snapshot, shelf_snapshot, counted_quantity NULL, counted_at NULL, counted_by, row_version` |
| `inventory_count_changes` | 初回/追加/置換/確認/確定後訂正を追記。変更前後数量、操作時刻、操作者、理由を保存。更新・削除不可 |
| `inventory_adjustments` | `store_id, product_id, quantity_delta, effective_at, reason, created_by/at`。差分0禁止、理由必須、更新・削除不可 |
| `inventory_product_settings` | `store_id, product_id, shelf_code, display_order, variance_threshold`。POS商品同期から棚番号を分離 |

主なDB制約:

- `inventory_sessions`に`UNIQUE(id, store_id)`を置く。
- itemは`FOREIGN KEY(session_id, store_id)`と`FOREIGN KEY(product_id, store_id)`でセッション・商品・店舗を一致させる。
- `UNIQUE(session_id, store_id, jan_snapshot)`で同一棚卸し内の重複商品を禁止する。
- `counted_quantity IS NULL`を未棚卸し、`counted_quantity >= 0`を棚卸し済みとしてCHECKで整合させる。
- 商品追加はDB関数内で`store_id + JAN`から商品を解決し、クライアントが送った`product_id`を信用しない。
- 確定済みitemは直接UPDATEせず、理由必須の訂正履歴を追記する。

### 4-3. POSスナップショットと計算結果

| テーブル | 主な列・責務 |
|---|---|
| `pos_inventory_snapshots` | 店舗、取得期間、取得時刻、行数、payload hash、成功/失敗を追記 |
| `pos_inventory_snapshot_rows` | `snapshot_id, row_no, store_id, JAN, event_kind, event_at, quantity, signature_hash, source_event_id NULL`。PKはsnapshot+row_no |
| `inventory_calculation_runs` | 対象店舗/セッション、計算区間、使用snapshot、source fingerprint、未照合/同分曖昧/重複候補件数、結果、エラー |
| `inventory_balances` | `(store_id, product_id)` PK。物理計数、計数時刻、計算現在庫、計算基準時刻、run IDを保持する上書き可能な投影キャッシュ |

`inventory_balances`は表示高速化用であり正本ではない。正本は確定物理計数、POSスナップショット、`transfers.id`、手動調整、監査履歴で、いつでも再構築できるようにする。

### 4-4. 将来POSに安定取引IDが追加された場合

- GASのヘッダー診断でPOS固有IDが安定していることを複数回取得・期間重複・店舗切替で検証する。
- 安定と確認できた場合だけ`inventory_source_events`を追加し、`UNIQUE(source_system, store_id, source_event_id, effect_kind)`で冪等登録する。
- 移動は`transfer:{id}:out`と`transfer:{id}:in`、使用は`usage:{id}`を安定キーにできる。
- それでも`inventory_balances`はイベント合計から上書き再構築し、増減の継ぎ足しだけにはしない。

## 5. UI/UX

### 5-1. 配置

- PC SideNav: 「設定オプション」の直上に「棚卸し・在庫管理」(`/inventory`)を追加。
- スマホ: 下部主要タブは6個のまま。「・・・」メニュー内で「設定オプション」の直上に追加。
- `user_store_access`で6/7の両方を付与されたアカウントだけが本店/わんわんを選べる。棚卸し中の店舗は必ず1店舗に固定し、「全店舗」での入力・確定は不可。
- store 7専用アカウントは本店、将来追加するstore 6専用アカウントはわんわん以外を表示・送信・DB更新できない。

### 5-2. 数量入力を中心にした画面

- 店舗ごとに新規開始、下書き自動保存、再開、確定。
- 初期対象は店舗の商品を停止商品込みでsnapshotし、停止商品も検索・スキャン・数量入力可能にする。
- 数量一覧は未棚卸し優先、商品名/JAN/カテゴリ/仕入れ先/棚番号で検索・絞り込み。
- 数量入力は大きな数値欄、テンキー、Enterで次商品、保存状態表示、行単位自動保存を提供。
- 既存`JanCodeScannerField`を再利用し、カメラ、写真、外付けJANリーダー、手入力を提供。
- 同一商品再読取時は「追加」「数量を置き換える」「キャンセル」の3択を必ず表示する。
- 棚卸し済み、未棚卸し、進捗率、JAN未照合、同分時刻曖昧を常時表示する。
- `0`は「棚卸し済み0」、未入力は「未棚卸し」と表示・集計する。
- 複数端末更新は`row_version`で競合検出し、他端末の変更を無言で上書きしない。

### 5-3. 確定と修正

- 確定前に未棚卸し、JAN未照合、同分時刻曖昧、マイナス在庫、差異大を一覧表示する。
- 原則、全対象が棚卸し済みになるまで確定をブロックする。除外を許す場合は商品ごとの理由を必須にする。
- 確定後の物理数量訂正と手動在庫調整は別操作にし、どちらも理由・操作者・時刻・変更前後を残す。
- データの物理削除は行わず、必要なら取消状態と監査履歴で表現する。

## 6. 印刷

- A4印刷専用レイアウトと`@media print`/`@page`を用意する。
- 共通列: 店舗名、棚卸し日、JAN、商品名、カテゴリ、仕入れ先、棚番号。
- 記入用: 数量を隠し、広い数量記入欄を表示。
- 結果用: 物理数、販売/返品、移動入/出、使用、調整、計算現在庫、差異を表示。
- 並び順: カテゴリ、仕入れ先、棚番号、商品名。棚番号は`inventory_product_settings`で将来追加可能にする。
- マイナス在庫は赤、差異大は警告色。差異閾値は店舗共通既定値と商品別上書きを持てる設計にする。
- 印刷プレビューをPC/スマホ幅で確認し、A4改ページ、見出し繰り返し、途中行分割を検証する。

## 7. 優先度マトリクス

| 優先度 | 機能 | 理由 |
|---|---|---|
| 必須 | 店舗完全分離、権限表、RLS、複合FK | 他店舗在庫混入を防ぐ根幹 |
| 必須 | 下書き/再開/確定、0と未棚卸し区別、進捗 | 棚卸しの基本業務 |
| 必須 | 数量入力、カメラ/JANリーダー/手入力、重複3択、停止商品 | 現場入力の中心 |
| 必須 | 計数時刻、販売/返品/移動/使用/調整の全量再計算 | 営業中運用と二重減算防止 |
| 必須 | JAN未照合・同分曖昧・確定後訂正の監査 | 無言の在庫ずれを防ぐ |
| 必須 | A4記入用/結果用、差異・マイナス表示 | 棚卸し実務と確認 |
| 推奨 | 複数端末の競合検出、同期健康状態、再計算履歴 | 運用事故の早期発見 |
| 推奨 | 差異閾値設定、棚番号設定 | 印刷・確認効率を改善 |
| 任意 | 安定POS取引IDによるイベント台帳 | ID取得可否の調査後に判断 |
| 任意 | CSV出力、承認ワークフロー | 初期運用後に追加判断 |

## 8. TDDテスト設計

在庫計算、認証、状態遷移、外部API統合をすべてテスト先行にする。

| ケース | 入力 | 期待結果 |
|---|---|---|
| 店舗分離 | 同JANをstore 6/7で登録 | 別商品・別在庫として計算 |
| 越境拒否 | store 7専用ユーザーがstore 6をUI/Action/API/DBへ送信 | 各層で拒否、DBに行ができない |
| 0と未入力 | 数量0 / 数量NULL | 前者だけ棚卸し済みに計上 |
| 販売・返品 | 計数後に販売3、返品1 | 差引-2 |
| 移動 | 7→6を2個 | store 7は-2、store 6は+2 |
| 物品使用 | store 7で2個使用 | store 7だけ-2 |
| 再同期 | 同じPOS snapshotで2回計算 | 現在庫とfingerprintが同一、二重減算なし |
| snapshot更新 | 後着販売が次snapshotに追加 | 元の計数時刻から再計算され1回だけ反映 |
| 同内容販売 | 同一8項目の行が2行 | snapshot内の2行を保持し、勝手に1行化しない |
| JANなし | 販売行にJANなし | 自動反映せず未照合警告 |
| 同分境界 | 計数と販売が同じ分 | 確定前確認へ送り、無言で加減しない |
| 再読取・追加 | 登録済み数量5へ2追加 | 数量7、元のcounted_at維持、監査行追加 |
| 再読取・置換 | 登録済み数量5を4へ置換 | 数量4、counted_at更新、監査行追加 |
| 停止商品 | store内停止商品のJANを読取 | 同一店舗なら棚卸し可能 |
| 確定競合 | 同じdraftを2端末で更新 | 古いrow_versionを拒否し再読込要求 |
| 確定後訂正 | 理由なし/あり | 理由なし拒否、ありは追記監査付きで反映 |
| 印刷 | 記入用/結果用 | 記入用は数量非表示、結果用は計算内訳・警告表示 |

## 9. 段階的実装計画

### Phase 0: データ契約・安全基盤の確定（1〜2人日）

進捗: **完了（2026-08-23、GAS version 56本番検証済み）**
結果: `docs/inventory_management/phase0_findings.md`

- 専用`codex/inventory-management` branch/worktreeを作り、既存未コミット差分を物理的に分離する。
- GASに変更を加えず現行レスポンス契約をfixture化する。
- ヘッダー名だけ返す認証付きGAS診断モードをversion 56へ反映し、両店舗・重複期間で安定取引ID候補0件を確認した。
- POS日時の精度、返品表現、JANなし販売の正体、6/14桁商品、先頭0衝突を監査する。
- Supabase管理CLI/service roleまたは安全なサーバーRPC経路を確立する。
- GASのanon直接商品upsertを維持したままproducts RLSを閉じると同期が壊れるため、専用同期経路の移行案を確定する。

**完了確認:** GET/不正token拒否、行データ/ログ返却0、通常履歴の両店舗回帰成功。DB/Vercel/Git pushは未変更。

### Phase 1: 店舗権限とDBスキーマ（2〜3人日）

進捗: **完了（2026-08-23、本番DB適用・初期権限登録・RLS実DB確認済み）**
結果: `docs/inventory_management/phase1_schema.md`

- [x] `user_store_access`と権限helperを追加。
- [x] 棚卸し、監査、調整、POS snapshot、計算run、balanceのマイグレーションを作成。
- [x] 複合FK/CHECK/partial UNIQUE/RLS/権限テストを先に作成し、RED→GREENを確認。
- [x] Supabase linked dry-run、remote DB lint、対象データbackup、schema snapshot、既存回帰、型検査、本番buildを確認。
- [x] 読み取り専用preflight SQLと、空テーブル限定rollback SQLを作成・テスト。
- [x] Authユーザー候補を確認し、本店専用1名をstore 7、指定2名をstore 6・7とする5権限行のguard付きseedを作成。
- [x] 読み取り専用preflightで商品6,544件、欠損・不正店舗・重複・衝突・競合lockがすべて0であることを確認。
- [x] 論理backupで進めるユーザー承認後、本番migrationと初期権限5行を適用。
- [x] postapply、migration履歴14/14、DB lint、3アカウントのRLS店舗分離、authenticated直接DML拒否を実DBで確認。

**承認ゲート:** 2026-08-23完了。SQL全文、対象、論理backup、ロック/rollback方針、5権限行を提示して本番適用承認を取得。

### Phase 2: 冪等な計算コアとAPI（4〜6人日）

進捗: **本番DB適用・実DB検証完了 / Git・Vercel反映中（2026-08-23）**
結果: `docs/inventory_management/phase2_recalculation.md`

- [x] POS snapshot取得・正規化・保存、移動入出庫/使用/調整の符号化を実装。
- [x] 商品別`counted_at`からの再計算とbalance上書きを実装。
- [x] JAN未照合、同分曖昧、source fingerprint、計算run監査を実装。
- [x] Server Action/Route Handlerごとに認証・店舗認可・入力検証を実装。
- [x] 確定処理を楽観ロック付きDB transaction/RPCとして実装（画面接続はPhase 4）。
- [x] preflight/postapply/非破壊rollbackとTDDを追加し、linked dry-run・本番読み取りpreflightを確認。
- [x] 機能migrationとDB lint修正forward migrationを本番適用し、履歴16/16とDB lint 0件を確認。
- [x] rollback付き実DBテストで`authenticated`権限、`store_id + JAN`、store 6越境拒否、10−販売2=8、同一run再利用、確定を確認。

**承認ゲート:** 本番DB適用は2026-08-23に承認取得・完了。Git commit/pushとVercel反映も最終差分提示後に承認を取得し、実施中。

### Phase 3: 数量入力と下書きUI（4〜6人日）

- `/inventory`、PC SideNav、スマホ「・・・」メニューを追加。
- 店舗別開始/再開、全商品snapshot、一覧数量入力、自動保存、進捗を実装。
- 既存JANスキャナーを再利用し、完全一致検索、曖昧拒否、停止商品対応を実装。
- 再読取の追加/置換/キャンセルとrow version競合を実装。
- スマホ実機相当のカメラ/写真/外付けリーダー/ソフトキーボードを検証。

### Phase 4: 確定・現在庫・訂正（3〜4人日）

- 確定前問題一覧、確定、現在庫内訳、再同期を実装。
- 確定後訂正と手動調整を理由必須・append-only監査で実装。
- マイナス在庫、差異大、同期未完了を明確に表示。

### Phase 5: A4印刷（1〜2人日）

- 数量非表示の記入用と計算結果用の2レイアウトを実装。
- カテゴリ/仕入れ先/棚番号ソート、A4改ページ、警告色を実装。
- ブラウザ印刷プレビューとPDF出力で視覚確認する。

### Phase 6: 回帰・段階リリース（2〜4人日）

- 在庫ドメインテスト、店舗越境テスト、API/Actionテスト、既存商品/履歴/移動テストを実行。
- `npx tsc --noEmit`、対象Lint、全Lint、本番`npm run build`を実行。
- PC/スマホ表示、入力再開、カメラ、印刷プレビューを確認。
- Supabase migration dry-run → 対象/差分確認 → 本番適用。
- GAS差分確認 → 必要時のみデプロイ。
- Git diff/statusを確認し、既存未コミットファイルを除外したコミットだけ作成。
- Git push前にコミット内容を提示。Vercel Production成功と公開HTTP、可能なら認証済みE2Eを確認。

総規模の目安は16〜25人日。POS安定IDの有無、既存products RLSの安全な閉鎖方法、営業中の同分時刻曖昧件数で変動する。

## 10. 承認済み設計判断と次のゲート

1. 主方式を「商品別計数時刻からの全量再計算」とする。
2. 再読取の「追加」は元の計数時刻を維持し、「置き換え」だけ計数時刻を更新する。
3. POSと計数が同じ分のイベントは自動決定せず、確定前確認へ送る。
4. 原則、全対象商品の計数または理由付き除外が終わるまで確定を許可しない。
5. 新しいDB権限の正本として`user_store_access`を導入する。
6. 実装は専用worktree/branchに分離し、Phase 0から段階的に進める。
7. Phase 1の新規テーブルはauthenticated/anonの直接DMLを許可せず、書込みRPCはPhase 2で追加する。

上記は2026-08-23に承認済み。Phase 1はSQL全文・対象・論理backup・ロールバック方針・初期権限差分を提示して別承認を取得し、本番migration、初期権限5行、実DB検証まで完了した。Phase 2も対象差分を提示して本番DB適用承認を取得し、2 migration、実DB店舗越境・冪等性テスト、DB lintまで完了した。Git commit/pushとVercel反映も別承認を取得して実施中。
