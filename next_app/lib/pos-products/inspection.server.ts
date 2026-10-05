import 'server-only'

import { resolveWritablePosProduct } from './identity'
import { fingerprintProductEditSnapshot } from './edit-review.server'
import type { ProductEditSnapshot } from './edit-review.server'
import type { PosProductChoices, PosProductStoreId } from './types'

type Choice = { id: string; name: string }
export type ProductEditInspection = {
  snapshot: ProductEditSnapshot
  fingerprint: string
  choices: PosProductChoices
  groups: Choice[]
  suppliers: Choice[]
}
const FAILURE = 'POSの商品情報を確認できません。入力を保持して取得し直してください。'

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error(FAILURE)
  return value as Record<string, unknown>
}
function choices(value: unknown): Choice[] {
  if (!Array.isArray(value) || value.length > 5000) throw new Error(FAILURE)
  const ids = new Set<string>()
  return value.map(item => {
    const r = record(item, ['id', 'name'])
    if (typeof r.id !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(r.id) || ids.has(r.id) ||
        typeof r.name !== 'string' || !r.name.trim() || r.name.length > 1000 || /[\x00-\x1f\x7f]/.test(r.name)) throw new Error(FAILURE)
    ids.add(r.id)
    return { id: r.id, name: r.name }
  })
}

/** targetは認可後にDBから取得する。同一JANの別店舗やブラウザ提供snapshotを混ぜない。 */
export function decodeProductEditInspection(target: { storeId: PosProductStoreId; productId: number; janCode: string }, raw: unknown, now = Date.now()): ProductEditInspection {
  if ((target.storeId !== 6 && target.storeId !== 7) || !Number.isSafeInteger(target.productId) || target.productId <= 0 ||
      !/^(\d{8}|\d{12}|\d{13})$/.test(target.janCode)) throw new Error(FAILURE)
  const result = record(raw, ['storeId', 'janCode', 'capturedAt', 'searches'])
  if (result.storeId !== target.storeId || result.janCode !== target.janCode || !Array.isArray(result.searches) ||
      result.searches.length !== 2) throw new Error(FAILURE)
  const fields = new Set<string>()
  const found: ProductEditInspection[] = []
  for (const value of result.searches) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(FAILURE)
    const s = value as Record<string, unknown>
    if (typeof s.field !== 'string' || !['schGoodsId', 'schMakerCd'].includes(s.field) || fields.has(s.field) ||
        (s.count !== 0 && s.count !== 1)) throw new Error(FAILURE)
    fields.add(s.field)
    if (s.count === 0) {
      record(s, ['field', 'count', 'inspected'])
      if (s.inspected !== false) throw new Error(FAILURE)
      continue
    }
    record(s, ['field', 'count', 'inspected', 'internalId', 'internalIdPresent', 'salesKind', 'storeGroupId', 'productCodeMatches', 'manufacturerCodeMatches', 'formInspection'])
    if (s.inspected !== true || s.internalIdPresent !== true || s.salesKind !== '2') throw new Error(FAILURE)
    const f = record(s.formInspection, ['identity', 'fields', 'settings', 'groups', 'suppliers'])
    const snapshot = {
      ...target, capturedAt: result.capturedAt, complete: true, identity: f.identity, fields: f.fields, settings: f.settings,
    } as ProductEditSnapshot
    // 型assertionの値は使用前に既存の厳格snapshot validatorで全項目を検証する。
    const fingerprint = fingerprintProductEditSnapshot(snapshot, now)
    if (s.internalId !== snapshot.identity.posProductId || s.storeGroupId !== snapshot.identity.groupId ||
        s.productCodeMatches !== (snapshot.identity.productCode === target.janCode) ||
        s.manufacturerCodeMatches !== (snapshot.identity.manufacturerCode === target.janCode)) throw new Error(FAILURE)
    const groups = choices(f.groups), suppliers = choices(f.suppliers)
    if (!groups.some(g => g.id === snapshot.fields.groupId) ||
        (snapshot.fields.supplierId !== null && !suppliers.some(p => p.id === snapshot.fields.supplierId))) throw new Error(FAILURE)
    found.push({ snapshot: structuredClone(snapshot), fingerprint,
      choices: { storeId: target.storeId, salesKind: 'retail', groupIds: groups.map(g => g.id), supplierIds: suppliers.map(p => p.id) }, groups, suppliers })
  }
  resolveWritablePosProduct({ storeId: target.storeId, janCode: target.janCode, complete: fields.size === 2,
    searchedFields: ['productCode', 'manufacturerCode'], candidates: found.map(f => f.snapshot.identity) })
  const first = found[0]
  // 二つの検索の間に商品値/候補が変わっても、後勝ちで選択しない。
  if (found.some(f => f.fingerprint !== first.fingerprint || JSON.stringify(f.groups) !== JSON.stringify(first.groups) ||
      JSON.stringify(f.suppliers) !== JSON.stringify(first.suppliers))) throw new Error(FAILURE)
  return first
}
