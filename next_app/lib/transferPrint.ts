import type { TransferListRow } from '@/lib/transfers'

/**
 * 店舗間移動・物品使用の月次レポートを新しいウィンドウで印刷する。
 *
 * レイアウト仕様:
 * - 見出し: 「店舗間移動・物品使用 月次レポート YYYY年M月」（1行）
 * - 移動先ルートごとにグループ化し、見出し「■ 店舗A → 店舗B」で区切る
 * - 物品使用は「■ 物品使用（店舗名）」としてまとめる
 * - テーブル列: 商品 / 数量 / 原価 / 原価合計
 * - 末尾に合計金額を表示
 * - 枠線付きで印刷時に見やすいデザイン
 */

type RouteGroup = {
  label: string
  sortKey: string
  items: TransferListRow[]
}

type MonthGroup = {
  monthLabel: string
  sortKey: string
  routes: RouteGroup[]
  total: number
}

/** 日付文字列からJST基準の「YYYY-MM」キーを取得 */
function getMonthKey(dateStr: string): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return '0000-00'

  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)

  const year = parts.find((p) => p.type === 'year')?.value ?? '0000'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  return `${year}-${month}`
}

/** 「YYYY-MM」キーを「YYYY年M月」表示に変換 */
function formatMonthLabel(key: string): string {
  const [year, month] = key.split('-')
  return `${year}年${Number(month)}月`
}

/** 金額のフォーマット */
function fmtYen(value: number | null | undefined): string {
  return `¥${(value ?? 0).toLocaleString('ja-JP')}`
}

/** ルートラベルの生成 */
function getRouteKey(transfer: TransferListRow): string {
  if (transfer.entry_type === 'usage') {
    return `usage:${transfer.from_store?.name ?? '不明'}`
  }
  return `transfer:${transfer.from_store?.name ?? '不明'}→${transfer.to_store?.name ?? '不明'}`
}

function getRouteLabel(transfer: TransferListRow): string {
  if (transfer.entry_type === 'usage') {
    return `物品使用（${transfer.from_store?.name ?? '不明'}）`
  }
  return `${transfer.from_store?.name ?? '不明'} → ${transfer.to_store?.name ?? '不明'}`
}

/** 移動データを月→ルートでグルーピング */
function groupTransfers(transfers: TransferListRow[]): MonthGroup[] {
  // 月ごとにグループ化
  const monthMap = new Map<string, TransferListRow[]>()

  for (const t of transfers) {
    const key = getMonthKey(t.transfer_date)
    if (!monthMap.has(key)) monthMap.set(key, [])
    monthMap.get(key)!.push(t)
  }

  // 月を新しい順に並べ替え
  const sortedMonthKeys = Array.from(monthMap.keys()).sort((a, b) => b.localeCompare(a))

  return sortedMonthKeys.map((monthKey) => {
    const items = monthMap.get(monthKey)!

    // ルートごとにグループ化（店舗間移動を先、物品使用を後に）
    const routeMap = new Map<string, RouteGroup>()

    for (const t of items) {
      const rKey = getRouteKey(t)
      if (!routeMap.has(rKey)) {
        routeMap.set(rKey, {
          label: getRouteLabel(t),
          sortKey: rKey,
          items: [],
        })
      }
      routeMap.get(rKey)!.items.push(t)
    }

    // 店舗間移動を先に、物品使用を後に
    const routes = Array.from(routeMap.values()).sort((a, b) => {
      const aIsUsage = a.sortKey.startsWith('usage:')
      const bIsUsage = b.sortKey.startsWith('usage:')
      if (aIsUsage !== bIsUsage) return aIsUsage ? 1 : -1
      return a.sortKey.localeCompare(b.sortKey)
    })

    const total = items.reduce((sum, t) => sum + (t.total_cost ?? 0), 0)

    return {
      monthLabel: formatMonthLabel(monthKey),
      sortKey: monthKey,
      routes,
      total,
    }
  })
}

/** 商品名に応じて動的にフォントサイズスタイルを返す */
function getProductNameStyle(name: string): string {
  const len = name.length
  let fontSize = '10px'
  let lineHeight = '1.2'
  if (len > 30) {
    fontSize = '7px'
    lineHeight = '1.0'
  } else if (len > 20) {
    fontSize = '8px'
    lineHeight = '1.1'
  } else if (len > 12) {
    fontSize = '9px'
    lineHeight = '1.1'
  }
  return `font-size:${fontSize};line-height:${lineHeight};word-break:break-all;`
}

/** テーブルHTMLを生成 */
function buildRouteTableHtml(group: RouteGroup): string {
  const rows = group.items
    .map(
      (t) => `
      <tr>
        <td style="border:1px solid #ccc;padding:2px 4px;font-size:10px;vertical-align:middle;white-space:nowrap;">${t.jan_code ?? '-'}</td>
        <td style="border:1px solid #ccc;padding:2px 4px;vertical-align:middle;">
          <div style="${getProductNameStyle(t.product_name)}">
            ${t.product_name}
          </div>
        </td>
        <td style="border:1px solid #ccc;padding:2px 4px;font-size:10px;vertical-align:middle;text-align:right;white-space:nowrap;">${t.quantity.toLocaleString('ja-JP')}</td>
        <td style="border:1px solid #ccc;padding:2px 4px;font-size:10px;vertical-align:middle;text-align:right;white-space:nowrap;">${fmtYen(t.cost_price)}</td>
        <td style="border:1px solid #ccc;padding:2px 4px;font-size:10px;vertical-align:middle;text-align:right;white-space:nowrap;">${fmtYen(t.total_cost)}</td>
      </tr>`
    )
    .join('')

  return `
    <table style="width:100%;border-collapse:collapse;margin-bottom:3px;table-layout:fixed;">
      <thead>
        <tr style="background:#f5f5f5;">
          <th style="border:1px solid #ccc;padding:2px 4px;font-size:9px;text-align:left;font-weight:600;width:95px;">JAN</th>
          <th style="border:1px solid #ccc;padding:2px 4px;font-size:9px;text-align:left;font-weight:600;">商品</th>
          <th style="border:1px solid #ccc;padding:2px 4px;font-size:9px;text-align:right;font-weight:600;width:35px;">数量</th>
          <th style="border:1px solid #ccc;padding:2px 4px;font-size:9px;text-align:right;font-weight:600;width:65px;">原価</th>
          <th style="border:1px solid #ccc;padding:2px 4px;font-size:9px;text-align:right;font-weight:600;width:75px;">原価合計</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>`
}
/** 印刷用の完全なHTMLドキュメントを生成 */
function buildPrintHtml(months: MonthGroup[]): string {
  const sections = months
    .map((month) => {
      const routeSections = month.routes
        .map(
          (route) => `
        <div style="margin-bottom:6px;">
          <div style="font-size:11px;font-weight:700;padding:2px 0;border-bottom:1px solid #333;margin-bottom:2px;">■ ${route.label}</div>
          ${buildRouteTableHtml(route)}
        </div>`
        )
        .join('')

      return `
      <div style="margin-bottom:12px;page-break-inside:avoid;">
        <h2 style="font-size:13px;font-weight:700;margin:0 0 6px 0;padding-bottom:2px;border-bottom:1px solid #999;">
          店舗間移動・物品使用 月次レポート　${month.monthLabel}
        </h2>
        ${routeSections}
        <div style="text-align:right;font-size:12px;font-weight:700;margin-top:4px;padding-top:4px;border-top:1px solid #333;">
          合計: ${fmtYen(month.total)}
        </div>
      </div>`
    })
    .join('<hr style="border:none;border-top:1px dashed #ccc;margin:10px 0;">')

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>店舗間移動・物品使用 月次レポート</title>
  <style>
    @page { margin: 8mm; size: A4; }
    body { font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif; margin: 0; padding: 0; color: #222; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  ${sections}
</body>
</html>`
}

/** メインのエクスポート関数: 新しいウィンドウで印刷ダイアログを開く */
export function printTransferReport(transfers: TransferListRow[]) {
  if (transfers.length === 0) {
    alert('印刷対象のデータがありません。')
    return
  }

  const months = groupTransfers(transfers)
  const html = buildPrintHtml(months)

  const printWindow = window.open('', '_blank', 'width=800,height=600')
  if (!printWindow) {
    alert('ポップアップがブロックされました。ブラウザの設定を確認してください。')
    return
  }

  printWindow.document.write(html)
  printWindow.document.close()

  // レンダリング完了後に印刷ダイアログを起動
  printWindow.onload = () => {
    printWindow.print()
  }
}
