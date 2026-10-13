import { readBackgroundClassification, refreshBackgroundClassification } from '@/lib/pos-products/classification.server'
import { parseBackgroundClassificationTarget } from '@/lib/pos-products/classification'
import { readBackgroundJson } from '@/lib/pos-products/background-http.server'
import { isSameOriginInventoryRequest } from '@/lib/inventory/validation'
import { backgroundEditFailureCode } from '@/lib/pos-products/background-failure'
import type { BackgroundEditFailureCode } from '@/lib/pos-products/background-failure'

export const runtime = 'nodejs'
export const maxDuration = 60
const headers = { 'Cache-Control': 'no-store' }
function failure(status: number, diagnosticCode: BackgroundEditFailureCode) {
  return Response.json({ success: false, error: '商品分類・仕入先候補を確認できません。入力は保持されています。', diagnosticCode }, { status, headers })
}
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams, keys = [...query.keys()]
    if (keys.length !== 2 || new Set(keys).size !== 2 || keys.some(key => !['storeId', 'productId'].includes(key)) ||
        !/^[67]$/.test(query.get('storeId') ?? '') || !/^[1-9]\d{0,9}$/.test(query.get('productId') ?? '')) return failure(400, 'BG_EDIT_VALIDATION')
    const target = parseBackgroundClassificationTarget({ storeId: Number(query.get('storeId')), productId: Number(query.get('productId')) })
    const data = await readBackgroundClassification(target)
    return Response.json({ success: true, data }, { headers })
  } catch (error) { return failure(400, backgroundEditFailureCode(error, 'BG_EDIT_RECEIPT')) }
}
export async function POST(request: Request) {
  if (!isSameOriginInventoryRequest(request) || request.headers.get('origin') !== new URL(request.url).origin) return failure(403, 'BG_EDIT_ORIGIN')
  let input: unknown
  try { input = parseBackgroundClassificationTarget(JSON.parse(await readBackgroundJson(request, 4096))) }
  catch { return failure(400, 'BG_EDIT_BODY') }
  try {
    const data = await refreshBackgroundClassification(input)
    return Response.json({ success: true, data }, { headers })
  } catch (error) { return failure(400, backgroundEditFailureCode(error, 'BG_EDIT_RECEIPT')) }
}
