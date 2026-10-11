import 'server-only'

/** サイズ上限はContent-Lengthだけでなく、受信中の実バイト数にも適用する。 */
export async function readBackgroundJson(request: Request, limit: number): Promise<string> {
  const declared = request.headers.get('content-length')
  if (request.method !== 'POST' || !/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '') ||
      (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) || !request.body) throw new Error('REQUEST_REJECTED')
  const reader = request.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('REQUEST_REJECTED')
      chunks.push(value)
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
