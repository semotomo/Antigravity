import { handleProductEditConsumeRequest } from '@/lib/pos-products/consume-handler.server'

export const runtime = 'nodejs'
export const maxDuration = 30

/** 既定OFFのGAS署名受付。ブラウザの商品登録・変更入口としては使わない。 */
export async function POST(request: Request) {
  return handleProductEditConsumeRequest(request)
}
