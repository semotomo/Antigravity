'use server'

import { requireInventoryStoreAccess } from '@/lib/inventory/auth'
import { recalculateInventorySession } from '@/lib/inventory/recalculationService'
import { parseInventoryRecalculationRequest } from '@/lib/inventory/validation'
import { createClient } from '@/lib/supabase/server'

export async function recalculateInventoryAction(input: unknown) {
  const validated = parseInventoryRecalculationRequest(input)
  const supabase = await createClient()
  await requireInventoryStoreAccess(supabase, validated.storeId)
  return recalculateInventorySession(supabase, validated)
}
