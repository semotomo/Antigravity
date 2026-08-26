import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/lib/types/database'
import type {
  InventoryCountRequest,
  InventoryWorkspaceRequest,
} from './validation'

type InventoryRpcError = { message: string }

type InventoryRpcDefinitions = {
  start_inventory_session: {
    args: { p_store_id: 6 | 7 }
    result: Json
  }
  get_inventory_workspace: {
    args: {
      p_count_status: 'all' | 'counted' | 'uncounted'
      p_limit: number
      p_offset: number
      p_query: string
      p_session_id: string | null
      p_store_id: 6 | 7
    }
    result: Json
  }
  save_inventory_count: {
    args: {
      p_expected_row_version: number
      p_jan_code: string
      p_mode: 'initial' | 'add' | 'replace'
      p_quantity: number
      p_session_id: string
      p_store_id: 6 | 7
    }
    result: Json
  }
}

type InventoryRpcClient = {
  rpc: <Name extends keyof InventoryRpcDefinitions>(
    name: Name,
    args: InventoryRpcDefinitions[Name]['args'],
  ) => Promise<{
    data: InventoryRpcDefinitions[Name]['result'] | null
    error: InventoryRpcError | null
  }>
}

export type InventorySessionSummary = {
  id: string
  storeId: 6 | 7
  status: 'draft' | 'finalizing' | 'finalized' | 'cancelled'
  startedAt: string
  updatedAt: string
  rowVersion: number
}

export type InventoryProgress = {
  totalCount: number
  countedCount: number
  uncountedCount: number
  excludedCount: number
  progressRate: number
}

export type InventoryWorkspaceItem = {
  id: string
  sessionId: string
  storeId: 6 | 7
  productId: number
  janSnapshot: string
  productNameSnapshot: string
  categorySnapshot: string | null
  supplierSnapshot: string | null
  shelfSnapshot: string | null
  countedQuantity: number | null
  countedAt: string | null
  excludedAt: string | null
  exclusionReason: string | null
  rowVersion: number
  isActive: boolean
}

export type InventoryWorkspace = {
  session: InventorySessionSummary | null
  progress: InventoryProgress
  items: InventoryWorkspaceItem[]
  filteredCount: number
  limit: number
  offset: number
}

export type InventoryCountSaveResult = {
  item: InventoryWorkspaceItem
  progress: Omit<InventoryProgress, 'excludedCount'>
}

export type InventoryFinalizationReadiness = {
  rowVersion: number
  totalCount: number
  countedCount: number
  pendingCount: number
  excludedCount: number
  canFinalize: boolean
}

function inventoryRpc(supabase: SupabaseClient<Database>) {
  // 手書きDatabase型へPhase 3 RPCを局所的に追加し、ブラウザへservice roleを出さない。
  return supabase as unknown as InventoryRpcClient
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${name}の応答が不正です。`)
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown, name: string) {
  if (typeof value !== 'string' || value === '') throw new Error(`${name}が不正です。`)
  return value
}

function nullableString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function numberValue(value: unknown, name: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name}が不正です。`)
  return value
}

function storeIdValue(value: unknown): 6 | 7 {
  if (value !== 6 && value !== 7) throw new Error('店舗IDの応答が不正です。')
  return value
}

function parseItem(value: unknown): InventoryWorkspaceItem {
  const item = record(value, '商品')
  return {
    id: stringValue(item.id, '商品ID'),
    sessionId: stringValue(item.sessionId, 'セッションID'),
    storeId: storeIdValue(item.storeId),
    productId: numberValue(item.productId, '商品マスタID'),
    janSnapshot: stringValue(item.janSnapshot, 'JAN'),
    productNameSnapshot: stringValue(item.productNameSnapshot, '商品名'),
    categorySnapshot: nullableString(item.categorySnapshot),
    supplierSnapshot: nullableString(item.supplierSnapshot),
    shelfSnapshot: nullableString(item.shelfSnapshot),
    countedQuantity: item.countedQuantity === null ? null : numberValue(item.countedQuantity, '数量'),
    countedAt: nullableString(item.countedAt),
    excludedAt: nullableString(item.excludedAt),
    exclusionReason: nullableString(item.exclusionReason),
    rowVersion: numberValue(item.rowVersion, '更新番号'),
    isActive: item.isActive === true,
  }
}

function parseProgress(value: unknown): InventoryProgress {
  const progress = record(value, '進捗')
  return {
    totalCount: numberValue(progress.totalCount, '全商品数'),
    countedCount: numberValue(progress.countedCount, '棚卸し済み数'),
    uncountedCount: numberValue(progress.uncountedCount, '未棚卸し数'),
    excludedCount: typeof progress.excludedCount === 'number' ? progress.excludedCount : 0,
    progressRate: numberValue(progress.progressRate, '進捗率'),
  }
}

export function parseInventoryWorkspace(value: unknown): InventoryWorkspace {
  const workspace = record(value, '棚卸し一覧')
  const sessionValue = workspace.session
  let session: InventorySessionSummary | null = null
  if (sessionValue !== null && sessionValue !== undefined) {
    const source = record(sessionValue, '棚卸しセッション')
    const status = source.status
    if (status !== 'draft' && status !== 'finalizing' && status !== 'finalized' && status !== 'cancelled') {
      throw new Error('棚卸し状態の応答が不正です。')
    }
    session = {
      id: stringValue(source.id, 'セッションID'),
      storeId: storeIdValue(source.storeId),
      status,
      startedAt: stringValue(source.startedAt, '開始日時'),
      updatedAt: stringValue(source.updatedAt, '更新日時'),
      rowVersion: numberValue(source.rowVersion, '更新番号'),
    }
  }

  if (!Array.isArray(workspace.items)) throw new Error('棚卸し商品一覧の応答が不正です。')
  return {
    session,
    progress: parseProgress(workspace.progress),
    items: workspace.items.map(parseItem),
    filteredCount: numberValue(workspace.filteredCount, '検索件数'),
    limit: numberValue(workspace.limit, '取得上限'),
    offset: numberValue(workspace.offset, '取得位置'),
  }
}

export async function getInventoryWorkspace(
  supabase: SupabaseClient<Database>,
  input: InventoryWorkspaceRequest,
) {
  const { data, error } = await inventoryRpc(supabase).rpc('get_inventory_workspace', {
    p_count_status: input.countStatus,
    p_limit: input.limit,
    p_offset: input.offset,
    p_query: input.query,
    p_session_id: input.sessionId,
    p_store_id: input.storeId,
  })
  if (error) throw new Error(`棚卸し一覧の取得に失敗しました: ${error.message}`)
  return parseInventoryWorkspace(data)
}

export async function getInventoryFinalizationReadiness(
  supabase: SupabaseClient<Database>,
  input: { storeId: 6 | 7; sessionId: string },
): Promise<InventoryFinalizationReadiness> {
  const workspace = await getInventoryWorkspace(supabase, {
    storeId: input.storeId,
    sessionId: input.sessionId,
    query: '',
    countStatus: 'all',
    limit: 1,
    offset: 0,
  })
  if (!workspace.session || workspace.session.id !== input.sessionId) {
    throw new Error('棚卸しセッションが見つかりません。')
  }
  if (workspace.session.status !== 'draft') {
    throw new Error('この棚卸しは確定前チェックできません。')
  }

  const progress = workspace.progress
  return {
    rowVersion: workspace.session.rowVersion,
    totalCount: progress.totalCount,
    countedCount: progress.countedCount,
    pendingCount: progress.uncountedCount,
    excludedCount: progress.excludedCount,
    canFinalize: progress.countedCount > 0 && progress.uncountedCount === 0,
  }
}

export async function startInventorySession(
  supabase: SupabaseClient<Database>,
  storeId: 6 | 7,
) {
  const { data, error } = await inventoryRpc(supabase).rpc('start_inventory_session', {
    p_store_id: storeId,
  })
  if (error) throw new Error(`棚卸しの開始に失敗しました: ${error.message}`)
  return record(data, '棚卸し開始')
}

export async function saveInventoryCount(
  supabase: SupabaseClient<Database>,
  input: InventoryCountRequest,
): Promise<InventoryCountSaveResult> {
  const { data, error } = await inventoryRpc(supabase).rpc('save_inventory_count', {
    p_expected_row_version: input.expectedRowVersion,
    p_jan_code: input.janCode,
    p_mode: input.mode,
    p_quantity: input.quantity,
    p_session_id: input.sessionId,
    p_store_id: input.storeId,
  })
  if (error) throw new Error(`数量の保存に失敗しました: ${error.message}`)

  const result = record(data, '数量保存')
  const progress = parseProgress(result.progress)
  return {
    item: parseItem(result.item),
    progress: {
      totalCount: progress.totalCount,
      countedCount: progress.countedCount,
      uncountedCount: progress.uncountedCount,
      progressRate: progress.progressRate,
    },
  }
}
