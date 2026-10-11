import { enqueueBackgroundProductEdit, readBackgroundProductEdits } from '@/lib/pos-products/background-edit.server'
import { readBackgroundJson } from '@/lib/pos-products/background-http.server'
import { isSameOriginInventoryRequest } from '@/lib/inventory/validation'

export const runtime = 'nodejs'
export const maxDuration = 30
const headers = { 'Cache-Control': 'no-store' }
const ERROR = '商品変更の受付を確認できません。入力は保持されています。同じ操作の受付状態を確認してください。'
function failure(status: number) { return Response.json({ success: false, error: ERROR }, { status, headers }) }

/** ブラウザ入口では永続受付だけを行い、POS通信・確認済み商品値の更新はしない。 */
export async function POST(request: Request) {
  if (!isSameOriginInventoryRequest(request) || request.headers.get('origin') !== new URL(request.url).origin) return failure(403)
  try {
    const data = await enqueueBackgroundProductEdit(JSON.parse(await readBackgroundJson(request, 4096)))
    return Response.json({ success: true, data }, { headers })
  } catch { return failure(400) }
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams, keys = [...query.keys()]
    if (keys.length !== 2 || new Set(keys).size !== keys.length || !query.has('store') ||
        keys.some(key => !['store', 'operationId', 'products'].includes(key)) ||
        query.has('operationId') === query.has('products') || !/^[67]$/.test(query.get('store') ?? '')) return failure(400)
    const storeId = Number(query.get('store'))
    const products = query.get('products')
    if (products !== null && !/^[1-9]\d*(?:,[1-9]\d*){0,99}$/.test(products)) return failure(400)
    const data = await readBackgroundProductEdits(products !== null ? { storeId, productIds: products.split(',').map(Number) }
      : { storeId, operationId: query.get('operationId') })
    return Response.json({ success: true, data }, { headers })
  } catch { return failure(400) }
}
