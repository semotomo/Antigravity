import 'server-only'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { verifyProductEditConsumeRequest, signProductEditConsumeResponse } from './consume-protocol.server'

const CODE = 'POS_PRODUCT_CONSUME_UNAVAILABLE'
function enabled() {
  return process.env.POS_PRODUCT_WRITES_ENABLED === 'true' && process.env.POS_PRODUCT_DISPATCH_ENABLED === 'true' &&
    process.env.POS_PRODUCT_CONSUME_ENABLED === 'true'
}
function failure(status: number) { return Response.json({ version: 1, success: false, code: CODE }, { status, headers: { 'Cache-Control': 'no-store' } }) }
async function readBody(request: Request): Promise<string> {
  const declared = request.headers.get('content-length')
  if (request.method !== 'POST' || !/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '') ||
      (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 8192)) || !request.body) throw new Error(CODE)
  const reader = request.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 8192) throw new Error(CODE)
      chunks.push(value)
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
/** GAS専用署名受付。ブラウザ認証を代用せず、DB RPCでも本人の店舗managerを再検査する。 */
export async function handleProductEditConsumeRequest(request: Request, clock = Date.now): Promise<Response> {
  if (!enabled()) return failure(503)
  const secret = process.env.POS_PRODUCT_CONSUME_SECRET
  try {
    const startedAt = clock()
    const body = await readBody(request)
    // 本文待機中の停止・鍵更新・期限切れでも特権RPCへ進めない。
    if (!enabled() || process.env.POS_PRODUCT_CONSUME_SECRET !== secret || clock() < startedAt) return failure(503)
    const verified = verifyProductEditConsumeRequest(body, secret, clock())
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) return failure(503)
    const service = createServiceClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    const { data, error } = await service.rpc('consume_pos_product_edit_dispatch', {
      p_actor_id: verified.actorId, p_store_id: verified.storeId, p_operation_id: verified.operationId, p_dispatch_hash: verified.dispatchHash,
    }).abortSignal(AbortSignal.timeout(25000))
    if (error) return failure(503)
    const completedAt = clock()
    if (!enabled() || process.env.POS_PRODUCT_CONSUME_SECRET !== secret || !Number.isSafeInteger(completedAt) ||
        completedAt < startedAt || completedAt >= verified.expiresAt) return failure(503)
    // true/falseを再掲せず、今回のRPC結果だけを今回の要求へ束縛して返す。
    return Response.json(signProductEditConsumeResponse(verified, data, secret as string), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    // SQL本文/署名/キー/例外原文は監視サービスにも渡さない。
    return failure(403)
  }
}
