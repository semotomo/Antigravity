import 'server-only'

import { signProductMasterSyncRequest, verifyProductMasterSyncResponse } from './master-sync-protocol'
import type { ProductMasterSyncResult } from './master-sync-protocol'
export type { ProductMasterSyncResult } from './master-sync-protocol'

export type ProductMasterSyncTransport = { sync(storeId: 6 | 7, attemptId: string): Promise<ProductMasterSyncResult> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HEX = /^[0-9a-f]{64}$/
const failure = (storeId: 6 | 7, code: 'PRODUCT_SYNC_DISABLED' | 'PRODUCT_SYNC_UNAVAILABLE' | 'PRODUCT_SYNC_UNKNOWN', runId?: string): ProductMasterSyncResult =>
  ({ success: false, storeId, code, outcome: code === 'PRODUCT_SYNC_UNKNOWN' ? 'unknown' : 'rejected', ...(runId ? { runId } : {}) })
function reject(): never { throw new Error('PRODUCT_SYNC_UNKNOWN') }
function destination(value: string) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,256}\/exec$/.test(value)) reject()
  return value
}
function resultDestination(location: string | null) {
  if (!location) reject()
  const url = new URL(location)
  // 既知のGAS結果先へは署名本文・認証ヘッダーを送らず、GETだけを行う。
  if (url.protocol !== 'https:' || url.hostname !== 'script.googleusercontent.com' || url.port || url.username || url.password ||
      url.pathname !== '/macros/echo' || url.hash || !url.search || url.search.length > 8192) reject()
  return url.href
}
async function readJson(response: Response): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    if (response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) reject()
    const declared = response.headers.get('content-length')
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 8192)) reject()
    if (!response.body) reject()
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []; let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength; if (size > 8192) reject()
      chunks.push(value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } finally {
    if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock() }
    else await response.body?.cancel().catch(() => undefined)
  }
}

/** manager/cronの認可後にだけ利用するサーバー専用通信。送信結果不明を再送で解消しない。 */
export function createSignedProductMasterSyncTransport(config: { enabled: boolean; url: string; secret: string }, fetcher: typeof fetch = fetch): ProductMasterSyncTransport {
  return { async sync(storeId, attemptId) {
    if (storeId !== 6 && storeId !== 7) reject()
    if (typeof attemptId !== 'string' || !UUID.test(attemptId)) return failure(storeId, 'PRODUCT_SYNC_UNAVAILABLE')
    if (!config.enabled) return failure(storeId, 'PRODUCT_SYNC_DISABLED')
    let url: string
    try { if (!HEX.test(config.secret)) reject(); url = destination(config.url) }
    catch { return failure(storeId, 'PRODUCT_SYNC_UNAVAILABLE') }
    try {
      const request = signProductMasterSyncRequest(storeId, attemptId, config.secret)
      const signal = AbortSignal.timeout(90_000)
      let response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request), redirect: 'manual', cache: 'no-store', signal })
      if (response.status === 302 || response.status === 303) {
        let resultUrl: string
        try { resultUrl = resultDestination(response.headers.get('location')) }
        finally { await response.body?.cancel().catch(() => undefined) }
        response = await fetcher(resultUrl, { method: 'GET', redirect: 'manual', cache: 'no-store', signal })
      }
      return verifyProductMasterSyncResponse(await readJson(response), request, config.secret)
    } catch { return failure(storeId, 'PRODUCT_SYNC_UNKNOWN', attemptId) }
  } }
}
export function configuredProductMasterSyncTransport(): ProductMasterSyncTransport {
  const dedicatedSecret = process.env.POS_PRODUCT_MASTER_SYNC_SECRET ?? ''
  return createSignedProductMasterSyncTransport({ enabled: process.env.POS_PRODUCT_MASTER_SYNC_ENABLED === 'true',
    url: process.env.POS_PRODUCT_MASTER_SYNC_GAS_URL ?? '',
    secret: dedicatedSecret === process.env.POS_PRODUCT_SIGNING_SECRET ? '' : dedicatedSecret })
}
