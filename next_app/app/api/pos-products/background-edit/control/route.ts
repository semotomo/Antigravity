import { controlBackgroundProductEdit } from '@/lib/pos-products/background-edit.server'
import { readBackgroundJson } from '@/lib/pos-products/background-http.server'
import { isSameOriginInventoryRequest } from '@/lib/inventory/validation'

export const runtime = 'nodejs'
export const maxDuration = 30
const headers = { 'Cache-Control': 'no-store' }
export async function POST(request: Request) {
  if (!isSameOriginInventoryRequest(request) || request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ success: false, error: '操作の受付を確認できません。' }, { status: 403, headers })
  }
  try {
    const data = await controlBackgroundProductEdit(JSON.parse(await readBackgroundJson(request, 1024)))
    return Response.json({ success: true, data }, { headers })
  } catch {
    return Response.json({ success: false, error: 'この状態では依頼した操作を行えません。希望値は保持しています。再保存せず、管理者に操作IDを伝えて確認してください。' }, { status: 400, headers })
  }
}
