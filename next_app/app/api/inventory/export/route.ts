import { NextResponse } from 'next/server'

import { buildInventoryCsv, buildInventoryCsvFilename } from '@/lib/inventory/csv'
import { InventoryAccessError, requireInventoryStoreAccess } from '@/lib/inventory/auth'
import { getInventoryPrintData } from '@/lib/inventory/management'
import { getProductStoreName } from '@/lib/productStores'
import { createClient } from '@/lib/supabase/server'

function parseStoreId(value: string | null): 6 | 7 {
  const storeId = Number(value)
  if (storeId !== 6 && storeId !== 7) throw new Error('出力対象店舗が不正です。')
  return storeId
}

function encodeDispositionFilename(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const storeId = parseStoreId(searchParams.get('store'))
    const mode = searchParams.get('mode') === 'result' ? 'result' : 'blank'
    const sortValue = searchParams.get('sort')
    const sort = sortValue === 'name' ? 'name' : 'category'
    const sessionId = searchParams.get('session')?.trim() || null

    const supabase = await createClient()
    await requireInventoryStoreAccess(supabase, storeId)
    const data = await getInventoryPrintData(supabase, { storeId, sessionId, mode, sort })
    const storeName = getProductStoreName(storeId)
    const filename = buildInventoryCsvFilename(data, storeName)

    return new Response(buildInventoryCsv(data, storeName), {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="inventory-store-${storeId}.csv"; filename*=UTF-8''${encodeDispositionFilename(filename)}`,
        'Content-Type': 'text/csv; charset=utf-8',
      },
    })
  } catch (error) {
    if (error instanceof InventoryAccessError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'CSVの出力に失敗しました。'
    const isValidationError = /不正|必要/.test(message)
    return NextResponse.json(
      { success: false, message: isValidationError ? message : 'CSVの出力に失敗しました。' },
      { status: isValidationError ? 400 : 500 },
    )
  }
}
