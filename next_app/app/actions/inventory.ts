'use server'

import { revalidatePath } from 'next/cache'

import {
  InventoryAccessError,
  requireInventoryManagerAccess,
  requireInventoryStoreAccess,
} from '@/lib/inventory/auth'
import {
  addInventoryAdjustment,
  correctFinalizedInventoryCount,
  finalizeInventorySession,
  setInventoryItemExclusion,
  setInventoryProductStatus,
} from '@/lib/inventory/management'
import {
  InventorySynchronizationError,
  prepareInventoryFinalization,
  recalculateInventorySession,
} from '@/lib/inventory/recalculationService'
import {
  parseInventoryAdjustmentRequest,
  parseInventoryCountRequest,
  parseInventoryCorrectionRequest,
  parseInventoryExclusionRequest,
  parseInventoryFinalizeLatestRequest,
  parseInventoryProductStatusRequest,
  parseInventoryRecalculationRequest,
  parseInventoryStartRequest,
} from '@/lib/inventory/validation'
import {
  getInventoryFinalizationReadiness,
  saveInventoryCount,
  startInventorySession,
  type InventoryCountSaveResult,
} from '@/lib/inventory/workspace'
import { createClient } from '@/lib/supabase/server'

export type InventoryMutationResult<T> =
  | { success: true; data: T }
  | { success: false; message: string; conflict?: boolean }

export type InventoryFinalizationActionData =
  | {
      status: 'not_ready'
      readiness: Awaited<ReturnType<typeof getInventoryFinalizationReadiness>>
    }
  | {
      status: 'blocked'
      review: Awaited<ReturnType<typeof prepareInventoryFinalization>>
    }
  | {
      status: 'finalized'
      calculatedAsOf: string
      finalization: Record<string, unknown>
    }

function inventoryActionFailure(error: unknown): InventoryMutationResult<never> {
  const message = error instanceof Error ? error.message : '棚卸し処理に失敗しました。'
  if (error instanceof InventoryAccessError) {
    return { success: false, message: error.message }
  }
  if (error instanceof InventorySynchronizationError) {
    return { success: false, message: error.message }
  }
  if (/updated by another user|changed by another device|40001/i.test(message)) {
    return {
      success: false,
      message: '他の端末で数量が更新されました。一覧を更新してもう一度入力してください。',
      conflict: true,
    }
  }
  if (/不正|必要|理由|見つかりません|not found|already counted|not editable|no inventory products|cannot be|must be counted|require confirmation/i.test(message)) {
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

export async function refreshInventoryBalanceAction(
  input: unknown,
): Promise<InventoryMutationResult<Record<string, unknown>>> {
  try {
    const validated = parseInventoryRecalculationRequest(input)
    const supabase = await createClient()
    await requireInventoryStoreAccess(supabase, validated.storeId)
    const data = await recalculateInventorySession(supabase, validated)
    revalidatePath('/inventory')
    return { success: true, data: data as unknown as Record<string, unknown> }
  } catch (error) {
    return inventoryActionFailure(error)
  }
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

export async function setInventoryProductStatusAction(
  input: unknown,
): Promise<InventoryMutationResult<Record<string, unknown>>> {
  try {
    const validated = parseInventoryProductStatusRequest(input)
    const supabase = await createClient()
    await requireInventoryManagerAccess(supabase, validated.storeId)
    const data = await setInventoryProductStatus(supabase, validated)
    revalidatePath('/inventory')
    revalidatePath('/products')
    revalidatePath('/sales')
    return { success: true, data }
  } catch (error) {
    return inventoryActionFailure(error)
  }
}

export async function setInventoryItemExclusionAction(
  input: unknown,
): Promise<InventoryMutationResult<Record<string, unknown>>> {
  try {
    const validated = parseInventoryExclusionRequest(input)
    const supabase = await createClient()
    await requireInventoryStoreAccess(supabase, validated.storeId)
    const data = await setInventoryItemExclusion(supabase, validated)
    revalidatePath('/inventory')
    return { success: true, data }
  } catch (error) {
    return inventoryActionFailure(error)
  }
}

export async function prepareInventoryFinalizationAction(
  input: unknown,
): Promise<InventoryMutationResult<Awaited<ReturnType<typeof getInventoryFinalizationReadiness>>>> {
  try {
    const validated = parseInventoryRecalculationRequest(input)
    const supabase = await createClient()
    await requireInventoryStoreAccess(supabase, validated.storeId)
    const data = await getInventoryFinalizationReadiness(supabase, validated)
    return { success: true, data }
  } catch (error) {
    return inventoryActionFailure(error)
  }
}

export async function finalizeInventorySessionAction(
  input: unknown,
): Promise<InventoryMutationResult<InventoryFinalizationActionData>> {
  try {
    const validated = parseInventoryFinalizeLatestRequest(input)
    const supabase = await createClient()
    await requireInventoryStoreAccess(supabase, validated.storeId)
    const readiness = await getInventoryFinalizationReadiness(supabase, validated)
    if (!readiness.canFinalize) {
      return { success: true, data: { status: 'not_ready', readiness } }
    }
    if (readiness.rowVersion !== validated.expectedRowVersion) {
      throw new Error('inventory session was changed by another device')
    }
    // 外部POS取得は利用者が実際に確定した時だけ1回行い、そのsnapshotで確定する。
    const review = await prepareInventoryFinalization(supabase, validated)
    if (!review.canFinalize) {
      return { success: true, data: { status: 'blocked', review } }
    }
    const finalization = await finalizeInventorySession(supabase, {
      ...validated,
      snapshotId: review.snapshotId,
      calculatedAsOf: review.calculatedAsOf,
    })
    revalidatePath('/inventory')
    return {
      success: true,
      data: {
        status: 'finalized',
        calculatedAsOf: review.calculatedAsOf,
        finalization,
      },
    }
  } catch (error) {
    return inventoryActionFailure(error)
  }
}

export async function correctFinalizedInventoryCountAction(
  input: unknown,
): Promise<InventoryMutationResult<Record<string, unknown>>> {
  try {
    const validated = parseInventoryCorrectionRequest(input)
    const supabase = await createClient()
    await requireInventoryManagerAccess(supabase, validated.storeId)
    const correction = await correctFinalizedInventoryCount(supabase, validated)
    let syncWarning: string | null = null
    try {
      await recalculateInventorySession(supabase, validated)
    } catch (error) {
      syncWarning = error instanceof Error ? error.message : '最新履歴での再計算に失敗しました。'
    }
    revalidatePath('/inventory')
    return { success: true, data: { correction, syncWarning } }
  } catch (error) {
    return inventoryActionFailure(error)
  }
}

export async function addInventoryAdjustmentAction(
  input: unknown,
): Promise<InventoryMutationResult<Record<string, unknown>>> {
  try {
    const validated = parseInventoryAdjustmentRequest(input)
    const supabase = await createClient()
    await requireInventoryManagerAccess(supabase, validated.storeId)
    const adjustment = await addInventoryAdjustment(supabase, validated)
    let syncWarning: string | null = null
    try {
      await recalculateInventorySession(supabase, validated)
    } catch (error) {
      syncWarning = error instanceof Error ? error.message : '最新履歴での再計算に失敗しました。'
    }
    revalidatePath('/inventory')
    return { success: true, data: { adjustment, syncWarning } }
  } catch (error) {
    return inventoryActionFailure(error)
  }
}
