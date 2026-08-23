import { NextResponse } from 'next/server'

import { InventoryAccessError, requireInventoryStoreAccess } from '@/lib/inventory/auth'
import { parseInventoryWorkspaceRequest } from '@/lib/inventory/validation'
import { getInventoryWorkspace } from '@/lib/inventory/workspace'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const input = parseInventoryWorkspaceRequest({
      storeId: searchParams.get('storeId'),
      sessionId: searchParams.get('sessionId'),
      query: searchParams.get('query'),
      countStatus: searchParams.get('countStatus'),
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset'),
    })
    const supabase = await createClient()
    await requireInventoryStoreAccess(supabase, input.storeId)
    const workspace = await getInventoryWorkspace(supabase, input)
    return NextResponse.json({ success: true, data: workspace })
  } catch (error) {
    if (error instanceof InventoryAccessError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : '棚卸し一覧の取得に失敗しました。'
    const isValidationError = /不正|必要/.test(message)
    return NextResponse.json(
      { success: false, message: isValidationError ? message : '棚卸し一覧の取得に失敗しました。' },
      { status: isValidationError ? 400 : 500 },
    )
  }
}
