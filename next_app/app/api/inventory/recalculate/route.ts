import { NextResponse } from 'next/server'

import { InventoryAccessError, requireInventoryStoreAccess } from '@/lib/inventory/auth'
import { recalculateInventorySession } from '@/lib/inventory/recalculationService'
import {
  isSameOriginInventoryRequest,
  parseInventoryRecalculationRequest,
} from '@/lib/inventory/validation'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  if (!isSameOriginInventoryRequest(request)) {
    return NextResponse.json({ success: false, message: '不正な送信元です。' }, { status: 403 })
  }

  try {
    const input = parseInventoryRecalculationRequest(await request.json())
    const supabase = await createClient()
    await requireInventoryStoreAccess(supabase, input.storeId)
    const result = await recalculateInventorySession(supabase, input)
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof InventoryAccessError) {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status })
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ success: false, message: 'JSONが不正です。' }, { status: 400 })
    }

    const message = error instanceof Error ? error.message : '在庫の再計算に失敗しました。'
    const isValidationError = /不正|必要|ありません/.test(message)
    return NextResponse.json(
      { success: false, message },
      { status: isValidationError ? 400 : 500 },
    )
  }
}
