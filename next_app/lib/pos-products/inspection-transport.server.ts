import 'server-only'

import { signPosProductRequest } from './protocol'
import type { PosProductInspector } from './edit-preparation.server'

const FAILURE = 'POSの商品情報を取得できません。入力を保持して取得し直してください。'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAX_BYTES = 524_288

function reject(): never { throw new Error(FAILURE) }
function destination(value: unknown): string {
  if (typeof value !== 'string' || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,256}\/exec$/.test(value)) reject()
  return value
}
function responseTarget(location: string | null): string {
  if (!location) reject()
  const url = new URL(location)
  // GASの結果取得先だけ許可。署名本文や認証ヘッダーは転送しない。
  if (url.protocol !== 'https:' || url.hostname !== 'script.googleusercontent.com' || url.port || url.username || url.password ||
      url.pathname !== '/macros/echo' || url.hash || url.search.length > 8192) reject()
  return url.href
}
async function readJson(response: Response): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    if (response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) reject()
    const declared = response.headers.get('content-length')
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) reject()
    if (!response.body) reject()
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) reject()
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } finally {
    if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock() }
    else await response.body?.cancel().catch(() => undefined)
  }
}

/** 署名本文を一度だけ送信し、GASの既知結果URLへは本文なしGETだけを送る。 */
export async function postPosProductEnvelope(destinationUrl: string, body: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  const url = destination(destinationUrl)
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 24576) reject()
  const signal = AbortSignal.timeout(90_000)
  let response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    redirect: 'manual', cache: 'no-store', signal })
  if (response.status === 302 || response.status === 303) {
    let resultUrl: string
    try { resultUrl = responseTarget(response.headers.get('location')) }
    finally { await response.body?.cancel().catch(() => undefined) }
    response = await fetcher(resultUrl, { method: 'GET', redirect: 'manual', cache: 'no-store', signal })
  }
  return readJson(response)
}

/** サーバー設定からだけ生成する。利用者のURL/秘密鍵を受け付ける公開Actionではない。 */
export function createSignedPosProductInspector(config: { enabled: boolean; url: string; secret: string }, fetcher: typeof fetch = fetch): PosProductInspector {
  if (!config.enabled || !/^[0-9a-f]{64}$/.test(config.secret)) reject()
  const url = destination(config.url)
  const secret = config.secret
  return {
    async inspect(target) {
      try {
        if (!target || (target.storeId !== 6 && target.storeId !== 7) || !UUID.test(target.operationId) || !UUID.test(target.actorId) ||
            typeof target.janCode !== 'string' || !/^(\d{8}|\d{12}|\d{13})$/.test(target.janCode)) reject()
        const body = JSON.stringify(signPosProductRequest({ action: 'inspect', operationId: target.operationId,
          actorId: target.actorId, storeId: target.storeId,
          payload: { operationId: target.operationId, storeId: target.storeId, janCode: target.janCode } }, secret))
        // 再試行しない。一回の読取り失敗でDB受付・POS保存へ進まない。
        const value = await postPosProductEnvelope(url, body, fetcher)
        if (!value || typeof value !== 'object' || Array.isArray(value)) reject()
        const result = value as Record<string, unknown>
        const keys = ['version', 'success', 'operationId', 'actorId', 'storeId', 'janCode', 'data']
        if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key)) ||
            result.version !== 1 || result.success !== true || result.operationId !== target.operationId || result.actorId !== target.actorId ||
            result.storeId !== target.storeId || result.janCode !== target.janCode) reject()
        // 業務DTO自体の厳格検査は、DB対象と結び付けるdecodeProductEditInspectionが行う。
        return result.data
      } catch { reject() }
    },
  }
}

export function configuredPosProductInspector(): PosProductInspector {
  return createSignedPosProductInspector({ enabled: process.env.POS_PRODUCT_INSPECTION_ENABLED === 'true',
    url: process.env.POS_PRODUCT_INSPECTION_GAS_URL ?? '', secret: process.env.POS_PRODUCT_SIGNING_SECRET ?? '' })
}
