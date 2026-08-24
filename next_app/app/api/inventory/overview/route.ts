import { NextResponse } from 'next/server'

import { InventoryAccessError, requireInventoryStoreAccess } from '@/lib/inventory/auth'
import { getInventoryOverview } from '@/lib/inventory/management'
import { parseInventoryOverviewRequest } from '@/lib/inventory/validation'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const input = parseInventoryOverviewRequest({
      storeId: searchParams.get('storeId'),
      query: searchParams.get('query'),
      stockStatus: searchParams.get('stockStatus'),
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset'),
    })
    const supabase = await createClient()
    await requireInventoryStoreAccess(supabase, input.storeId)
    const overview = await getInventoryOverview(supabase, input)
    return NextResponse.json({ success: true, data: overview })
  } catch (error) {
    if (error instanceof InventoryAccessError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : '現在庫一覧の取得に失敗しました。'
    const isValidationError = /不正|必要/.test(message)
    return NextResponse.json(
      { success: false, message: isValidationError ? message : '現在庫一覧の取得に失敗しました。' },
      { status: isValidationError ? 400 : 500 },
    )
  }
}
