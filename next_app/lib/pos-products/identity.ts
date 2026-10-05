import type { PosProductCandidate, PosProductStoreId, ProductIdentityRequest, ProductReferenceSnapshot } from './types'

// 2026-09-08の実POS画面で確認。アプリ店舗ID、POS店舗コード、POS所属グループは別の値。
export const POS_PRODUCT_STORES = {
  7: { officeId: '11053', groupId: '11098', name: 'からつケンネル本店' },
  6: { officeId: '11054', groupId: '11099', name: 'わんわんペットセンター' },
} as const

export function resolveWritablePosProduct(search: {
  storeId: PosProductStoreId
  janCode: string
  complete: boolean
  searchedFields: readonly string[]
  candidates: readonly PosProductCandidate[]
}): PosProductCandidate {
  const store = POS_PRODUCT_STORES[search.storeId]
  if (!store || !/^(\d{8}|\d{12}|\d{13})$/.test(search.janCode) || search.complete !== true ||
      !['productCode', 'manufacturerCode'].every(field => search.searchedFields.includes(field))) {
    throw new Error('店舗とJANの両検索を完了できていないため保存できません。')
  }
  const matches = new Map<string, PosProductCandidate>()
  for (const candidate of search.candidates) {
    if (candidate.productCode !== search.janCode && candidate.manufacturerCode !== search.janCode) continue
    if (candidate.officeId !== store.officeId || candidate.groupId !== store.groupId ||
        candidate.exclusiveStore !== true || candidate.salesKind !== 'retail') {
      throw new Error('他店舗・共有所属・店販以外の商品は保存できません。')
    }
    if (!candidate.posProductId?.trim() ||
        [candidate.productCode, candidate.manufacturerCode].some(code => code !== '' && code !== search.janCode)) {
      throw new Error('POS内部商品IDまたは商品コード・メーカー品番の照合が一致しません。')
    }
    const prior = matches.get(candidate.posProductId)
    if (prior && (prior.productCode !== candidate.productCode || prior.manufacturerCode !== candidate.manufacturerCode)) {
      throw new Error('検索中にPOSの商品が変更されました。取得し直してください。')
    }
    matches.set(candidate.posProductId, candidate)
  }
  if (matches.size !== 1) throw new Error('JANに一致するPOS商品が一意ではありません。追加や更新は行いません。')
  return { ...matches.values().next().value! }
}

export const PRODUCT_REFERENCE_KINDS = [
  'inventoryItems', 'inventoryStatusChanges', 'inventoryAdjustments', 'inventoryBalances',
  'posSnapshotRows', 'sales', 'transfers', 'usage', 'orders', 'aliases',
] as const

function assertCompleteUsage(request: ProductIdentityRequest, usage: ProductReferenceSnapshot): void {
  if ((request.storeId !== 6 && request.storeId !== 7) || !Number.isSafeInteger(request.productId) || request.productId <= 0 ||
      !/^[0-9a-f]{64}$/.test(request.expectedFingerprint) || usage.complete !== true ||
      usage.storeId !== request.storeId || usage.productId !== request.productId || usage.fingerprint !== request.expectedFingerprint) {
    throw new Error('対象商品と最新の参照状況を確認できません。再確認してください。')
  }
  if (!usage.counts || PRODUCT_REFERENCE_KINDS.some(kind => !Number.isSafeInteger(usage.counts[kind]) || usage.counts[kind] < 0)) {
    throw new Error('履歴の確認が未完了のため実行できません。')
  }
  if (usage.pendingOperation !== false || usage.currentStock === null || !Number.isFinite(usage.currentStock) ||
      usage.posReferencesChecked !== true || typeof usage.posHasReferences !== 'boolean') {
    throw new Error('POSと在庫の確認が未完了、または別の操作が進行中です。')
  }
}

/** 最終的な参照検査と変更はDBロック内で行う。この判定だけで物理削除を送信しない。 */
export function assertProductDeletionSafe(request: ProductIdentityRequest, usage: ProductReferenceSnapshot): void {
  assertCompleteUsage(request, usage)
  if (usage.currentStock !== 0 || usage.posHasReferences || PRODUCT_REFERENCE_KINDS.some(kind => usage.counts[kind] !== 0)) {
    throw new Error('履歴または在庫があるため削除できません。商品停止を利用してください。')
  }
}

export function assertProductIdentityChangeSafe(
  request: ProductIdentityRequest & { oldJanCode: string; newJanCode: string },
  usage: ProductReferenceSnapshot,
  reservations: { complete: boolean; storeId: PosProductStoreId; janCode: string; owners: readonly number[] },
): void {
  assertCompleteUsage(request, usage)
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(request.oldJanCode) || !/^(\d{8}|\d{12}|\d{13})$/.test(request.newJanCode) ||
      request.oldJanCode === request.newJanCode || reservations.complete !== true ||
      reservations.storeId !== request.storeId || reservations.janCode !== request.newJanCode || !Array.isArray(reservations.owners)) {
    throw new Error('新旧JANと店舗の重複確認を完了できません。')
  }
  if (reservations.owners.length !== 0) throw new Error('この店舗で現在または過去に使用したJANへは変更できません。')
  // 旧JAN対応表のDB移行・履歴再集計の検証が済むまでは、履歴を持つ商品を変更しない。
  if (usage.currentStock !== 0 || usage.posHasReferences || PRODUCT_REFERENCE_KINDS.some(kind => usage.counts[kind] !== 0)) {
    throw new Error('履歴を持つ商品のJAN訂正には旧JAN履歴の移行が必要です。現在は変更できません。')
  }
}
