import type { InventoryPrintData } from './management'

type CsvCell = string | number | null

const UTF8_BOM = '\uFEFF'

function formatJstDate(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Googleスプレッドシートで数式として評価されないよう、危険な先頭文字を文字列化する。 */
function serializeCsvCell(value: CsvCell) {
  if (value === null) return ''
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

function quantityColumns(data: InventoryPrintData): string[] {
  if (data.mode === 'blank') return ['数量']
  if (data.status !== 'finalized') return ['入力数量']
  return ['実在庫', '販売', '返品', '移動入', '移動出', '物品使用', '手動調整', '現在庫']
}

function quantityValues(data: InventoryPrintData, index: number): CsvCell[] {
  const item = data.items[index]
  if (data.mode === 'blank') return [null]
  if (data.status !== 'finalized') return [item.countedQuantity]
  return [
    item.physicalQuantity,
    item.salesQuantity,
    item.returnQuantity,
    item.transferInQuantity,
    item.transferOutQuantity,
    item.usageQuantity,
    item.adjustmentDelta,
    item.calculatedQuantity,
  ]
}

export function buildInventoryCsv(data: InventoryPrintData, storeName: string) {
  const inventoryDate = formatJstDate(data.startedAt)
  const rows: CsvCell[][] = [
    ['店舗名', '棚卸し日', 'JAN', '商品名', 'カテゴリ', '商品状態', '棚卸し状態', ...quantityColumns(data)],
    ...data.items.map((item, index) => [
      storeName,
      inventoryDate,
      item.janCode,
      item.productName,
      item.category ?? '',
      item.isActive ? '使用中' : '停止',
      item.excluded ? '除外' : '対象',
      ...quantityValues(data, index),
    ]),
  ]
  return `${UTF8_BOM}${rows.map((row) => row.map(serializeCsvCell).join(',')).join('\r\n')}\r\n`
}

export function buildInventoryCsvFilename(data: InventoryPrintData, storeName: string) {
  const kind = data.mode === 'blank' ? '記入用' : data.status === 'finalized' ? '計算結果' : '入力結果'
  const safeStoreName = storeName.replace(/[\\/:*?"<>|]/g, '_')
  return `棚卸し_${safeStoreName}_${formatJstDate(data.startedAt)}_${kind}.csv`
}
