'use server'

import { InventoryAccessError, requireInventoryStoreAccess } from '@/lib/inventory/auth'
import { recalculateInventorySession } from '@/lib/inventory/recalculationService'
import { parseInventoryRecalculationRequest } from '@/lib/inventory/validation'
import {
  parseInventoryCountRequest,
  parseInventoryStartRequest,
} from '@/lib/inventory/validation'
import {
  saveInventoryCount,
  startInventorySession,
  type InventoryCountSaveResult,
} from '@/lib/inventory/workspace'
import { createClient } from '@/lib/supabase/server'

export type InventoryMutationResult<T> =
  | { success: true; data: T }
  | { success: false; message: string; conflict?: boolean }

function inventoryActionFailure(error: unknown): InventoryMutationResult<never> {
  const message = error instanceof Error ? error.message : '棚卸し処理に失敗しました。'
  if (error instanceof InventoryAccessError) {
    return { success: false, message: error.message }
  }
  if (/updated by another user|40001/i.test(message)) {
    return {
      success: false,
      message: '他の端末で数量が更新されました。一覧を更新してもう一度入力してください。',
      conflict: true,
    }
  }
  if (/不正|必要|見つかりません|not found|already counted|not editable|no inventory products/i.test(message)) {
    return { success: false, message }
  }
  return { success: false, message: '棚卸し処理に失敗しました。時間をおいて再度お試しください。' }
}

export async function recalculateInventoryAction(input: unknown) {
  const validated = parseInventoryRecalculationRequest(input)
  const supabase = await createClient()
  await requireInventoryStoreAccess(supabase, validated.storeId)
  return recalculateInventorySession(supabase, validated)
}

export async function startInventorySessionAction(
  input: unknown,
): Promise<InventoryMutationResult<Record<string, unknown>>> {
  try {
    const validated = parseInventoryStartRequest(input)
    const supabase = await createClient()
    await requireInventoryStoreAccess(supabase, validated.storeId)
    const data = await startInventorySession(supabase, validated.storeId)
    return { success: true, data }
  } catch (error) {
    return inventoryActionFailure(error)
  }
}

export async function saveInventoryCountAction(
  input: unknown,
): Promise<InventoryMutationResult<InventoryCountSaveResult>> {
  try {
    const validated = parseInventoryCountRequest(input)
    const supabase = await createClient()
    await requireInventoryStoreAccess(supabase, validated.storeId)
    const data = await saveInventoryCount(supabase, validated)
    return { success: true, data }
  } catch (error) {
    return inventoryActionFailure(error)
  }
}
