# 棚卸し・在庫管理 Phase 0 調査結果

> 実施日: 2026-08-23
> 状態: **Phase 0完了 / Phase 1・2へ反映済み**
> 外部変更: GAS Script Property設定・version 56本番デプロイ済み。DB DDL/DML、Vercelデプロイ、Git commit/pushは未実施

## 1. 結論

- 在庫計算の主方式は、承認済みの「商品別`counted_at`から毎回全量再計算し、投影在庫を上書きする方式」で進める。
- 現行GAS履歴のJSONは8項目だけで、安定取引IDを持たない。version 56の`history_schema`で元CSVも確認した結果、両店舗とも8項目と末尾空列の計9列だけで、安定取引ID候補列は0件だった。
- POSの販売・返品数量は両方とも正数だった。計算時は販売を`-abs(quantity)`、返品を`+abs(quantity)`へ正規化する。
- 同一内容行が実在するため、8項目ハッシュでの重複排除は行わない。同じ取得結果を再同期しても、1スナップショットだけを選んで基準時刻から再計算する。
- POSには「調整」も存在するが意味と在庫効果が未確定で、JANなし行もある。初期版では自動反映せず未照合・要確認へ送る。
- Supabase CLIの管理経路は確立できた。専用worktreeを本番`kennel_DB`へlinkし、remote migration一覧を読み取り確認できる。今回migration適用はしていない。
- 商品同期のanon直接upsertは、productsのRLSを閉じる前に専用のサーバー同期経路へ移す必要がある。

## 2. 作業分離とアクセス状況

| 対象 | Phase 0確認結果 | 変更の有無 |
|---|---|---|
| Git | `codex/inventory-management` branchと専用worktreeを作成。`main`の既存未コミット差分とは物理分離済み | branch/worktreeのみ。commit/pushなし |
| GitHub | `doo-se`で認証済み。originは`semotomo/Antigravity` | 読み取りのみ |
| GAS | `clasp 3.3.0`で認証済み。専用tokenをScript Propertyへ保存し、検証済みversion 56へ本番Web Appを更新 | GAS HEAD/version/deploymentのみ変更。v55は切り戻し用に保持 |
| Supabase | CLI 2.115.0。`kennel_DB`は`ACTIVE_HEALTHY`。project linkとremote migration一覧の読み取り成功 | ローカルlink情報のみ。DDL/DMLなし |
| Vercel | GitHub DeploymentでHEAD `2cc0b3f`のProduction成功を確認 | deployなし |
| 公開HTTP | deployment URLはVercelログインへ転送され、Deployment Protection下 | GETのみ |

Supabaseのlocal/remote migrationは、`20260328173000`から`20260811210000`まで13件が一致した。

## 3. 現行GAS履歴データ契約

匿名化fixture: `tests/fixtures/gas_history_response_current.json`

各行の項目は次の8つだけである。

```text
productCode, productName, taskContent, storeName,
taskDateTime, quantity, cost, totalCost
```

- 日時は全件`yyyy/MM/dd HH:mm`で秒を持たない。
- 取引ID、伝票番号、レシート番号、event IDに相当するJSON項目はない。
- 元CSVは両店舗とも9列で、9列目は空ヘッダーだった。追加のID列は存在しない。
- fixtureには販売、返品、注文、調整、JANなし販売、完全同一行を含め、後続実装がこれらを誤って捨てない契約にした。
- fixtureの値は匿名テスト値であり、本番の商品名・JAN・取引値を保存していない。

## 4. 2026-08-01〜2026-08-22 POS履歴監査

現行GASデプロイを読み取り専用で呼び、行データやGASログを出力せず集計した。

| 店舗 | 総行数 | 販売 | 返品 | 注文 | 調整 | JANなし販売/返品 | 完全重複group / 余剰行 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 本店 7 | 858 | 852 | 6 | 0 | 0 | 8 | 9 / 10 |
| わんわん 6 | 2,199 | 1,099 | 3 | 1,091 | 6 | 194 | 213 / 301 |

追加確認:

- 販売852+1,099件、返品6+3件はすべて正数。
- わんわんの調整6件も正数で、うち4件はJANなし。
- 全3,057行が分単位で、秒付き行は0件。
- 追加JSON項目と安定ID項目は0件。
- 返品は本店で8月7日・10日、わんわんで8月16日・20日に確認でき、表現は両店舗とも`返品`だった。

したがって初期計算ルールは次で固定する。

| POS種別 | 在庫効果 | 扱い |
|---|---:|---|
| 販売 | `-abs(quantity)` | `store_id + JAN`完全一致時だけ反映 |
| 返品 | `+abs(quantity)` | `store_id + JAN`完全一致時だけ反映 |
| 注文 | 0 | 在庫計算から除外 |
| 調整 | 0（初期版） | 意味を確認するまで未照合・要確認へ送る |
| JANなし販売/返品 | 自動反映しない | 未照合一覧に出し、確定前に確認させる |

## 5. 商品マスタ監査

| 項目 | 本店 7 | わんわん 6 | 合計/備考 |
|---|---:|---:|---|
| 商品数 | 3,780 | 2,764 | 6,544 |
| 有効 | 3,778 | 2,754 | 6,532 |
| 停止 | 2 | 10 | 12。棚卸し対象に含める |
| JANなし | 0 | 0 | 0 |
| カテゴリあり | 3,780 | 2,764 | 全件 |
| 仕入れ先あり | 2,837 | 1,059 | 未設定商品あり |

- `store_id + JAN`重複は0件、対象外store IDは0件。
- 同じJANがstore 6/7の両方にあるものは1,359件。必ず店舗別商品として扱う。
- JAN長は6桁1件、8桁12件、12桁19件、13桁6,511件、14桁1件。
- 13桁先頭0を12桁と同一視すると、同一店舗内で1 conflict groupが生じる。
- よって自動照合は保存文字列の完全一致のみとし、6/14桁を長さだけで拒否しない。先頭0候補は自動統合せず曖昧エラーにする。

## 6. 店舗間移動・物品使用監査

- 366件: transfer 360件、usage 6件。
- ID欠落0、ID重複0、JAN欠落0、数量0以下0。
- 移動経路は7→6が100件。他に7→1〜5への出庫が260件あり、本店在庫からの減算対象になる。
- usageは7→nullが6件で、本店だけの減算対象になる。
- `transfers.id`は安定ソースキーとして、移動出`transfer:{id}:out`、移動入`transfer:{id}:in`、使用`usage:{id}`へ展開できる。

## 7. GASヘッダー診断の本番検証

`gas/autoDownload.js`に`history_schema`モードを追加し、GAS version 56として既存Web App deploymentへ反映した。

- POSから同じCSVを取得するが、レスポンスの`data`は常に空配列、`count`は0。
- GETでは実行できず、POSTでもScript Property `HISTORY_SCHEMA_DIAGNOSTIC_TOKEN`との完全一致を必須にする。
- 返すのはヘッダー名、列数、データ行数、行の列数分布、安定IDらしいヘッダー候補だけ。
- 商品名、JAN、取引ID値などの行値は返さない。
- 通常履歴を含め、CSV先頭400字や先頭データ行をGASログへ残さない。Web Appログは診断レスポンスへ返さない。
- 候補を見つけても`stableTransactionIdVerified`は必ずfalse。ヘッダー名だけで安定性を断定しない。

2026-08-01〜2026-08-22を本番version 56で診断した。

| 店舗 | データ行数 | 列数 | 安定ID候補 | 行データ返却 | GASログ返却 |
|---|---:|---:|---:|---:|---:|
| 本店 7 | 858 | 9 | 0 | 0 | 0 |
| わんわん 6 | 2,199 | 9 | 0 | 0 | 0 |

両店舗のヘッダーは`商品コード, 商品名, 作業内容, 店舗名, 作業日時, 個数, 原価, 原価合計, 空列`で一致した。GET診断と不正token POSTはいずれも拒否された。通常`history`モードの回帰監査も同じ件数・8項目契約で成功した。

わんわん専用POS認証情報を直接渡す経路では、対象画面に店舗グループ選択欄がなく診断に失敗した。既存の本店側セッションから店舗グループ11099へ切り替える実運用経路では成功したため、在庫同期もこの既存経路を使う。

以上から、安定POS取引IDによるイベント台帳は初期設計に採用せず、商品別`counted_at`からの全量再計算方式を正式採用する。

## 8. Supabase管理経路と商品同期の移行案

### DB管理

- Supabase CLIのログインとproject linkが機能しているため、Phase 1 migrationはローカル作成、差分確認、dry-run、本番適用前承認の流れを取れる。
- 今回は`migration list --linked`だけを実行し、`db push`、SQL実行、テーブル更新はしていない。

### 推奨する商品同期経路

現行GASはanon keyで`products?on_conflict=store_id,jan_code`へ直接upsertする。productsのanon policyを閉じると同期が停止するため、次へ移行する。

1. GASはScript Propertiesの専用`GAS_SYNC_SECRET`で、Vercelの内部同期Routeへ署名付きPOSTを送る。
2. Routeはtimestamp、body hash、署名、再送時間窓を検証する。
3. Route側で店舗名を固定のstore 6/7へ変換し、各行のクライアント指定`store_id`を信用しない。
4. server-onlyのSupabase service roleで、複合キーupsertと旧商品の無効化を1つのDB RPC/transactionとして実行する。
5. service roleはVercelだけに置き、GAS・ブラウザ・リポジトリへ渡さない。
6. 新経路の本番同期成功を確認してからproductsのanon DML policyを閉じる。

Supabase Edge Function案も可能だが、既存Next.jsの監視・Vercel環境変数・Route Handler認証パターンへ集約できるため、初期案はVercel Routeを推奨する。

### 既存GAS履歴APIの認証負債

現行の通常`history`モードはNext.js専用の共有secretを検証していない。今回の`history_schema`は専用tokenで閉じるが、通常履歴の認証はNext.js側の環境変数追加と同時切替が必要なためPhase 0では変更しない。棚卸しAPIを本番利用する前に、GASとVercel Routeの共有secret、リクエスト署名または同等のサーバー間認証を必須化する。

## 9. Phase 0完了と次の承認ゲート

Phase 0の調査、GAS安全診断、本番回帰確認は完了した。GASはversion 56、既存本番deploymentもversion 56を指している。診断tokenの値はリポジトリ、`.env.local`、資料へ保存していない。再診断が必要な場合は、別途承認を得てtokenを安全にローテーションする。

商品同期Route、service role環境変数、products RLS変更はPhase 0では実装・適用していない。次はPhase 1のmigration SQLと権限テストをローカル作成し、SQL全文・影響範囲・ロールバック方針を提示する。本番DB適用はその後の別承認まで行わない。

## 10. 再現コマンド

```powershell
node --test tests/gas_history_contract_test.mjs tests/gas_product_master_parser_test.mjs
node tests/audit_inventory_phase0.mjs --env-file="D:\data\desktop\Kennel\next_app\.env.local"
node tests/audit_gas_history_contract.mjs --store=本店 --start=2026/08/01 --end=2026/08/22 --env-file="D:\data\desktop\Kennel\next_app\.env.local"
node tests/audit_gas_history_contract.mjs --store=わんわん --start=2026/08/01 --end=2026/08/22 --env-file="D:\data\desktop\Kennel\next_app\.env.local"
```

`history_schema`のtokenはローカルへ永続保存していないため、再実行時は安全な一時注入またはtokenローテーションを行う。値をコマンド履歴、資料、Git管理ファイルへ残さない。
