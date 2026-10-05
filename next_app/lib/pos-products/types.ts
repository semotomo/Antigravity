export type PosProductStoreId = 6 | 7

export type PosProductFields = {
  name: string
  groupId: string
  price: string
  cost: string
  supplierId: string | null
}

type CommandBase = { operationId: string; storeId: PosProductStoreId }
type ExistingProduct = { productId: number; expectedFingerprint: string }

export type PosProductCommand =
  | (CommandBase & { kind: 'create'; janCode: string; fields: PosProductFields })
  | (CommandBase & ExistingProduct & { kind: 'update'; fields: PosProductFields })
  | (CommandBase & ExistingProduct & {
    kind: 'change_jan'; oldJanCode: string; newJanCode: string; reason: string
  })
  | (CommandBase & ExistingProduct & { kind: 'delete'; janCode: string; reason: string })

export type PosProductChoices = {
  storeId: PosProductStoreId
  salesKind: 'retail'
  groupIds: readonly string[]
  supplierIds: readonly string[]
}

export type PosProductCandidate = {
  posProductId: string
  officeId: string
  groupId: string
  salesKind: string
  productCode: string
  manufacturerCode: string
  exclusiveStore: boolean
}

export type ProductIdentityRequest = {
  storeId: PosProductStoreId
  productId: number
  expectedFingerprint: string
}

export type ProductReferenceSnapshot = {
  storeId: PosProductStoreId
  productId: number
  fingerprint: string
  complete: boolean
  counts: Record<string, number>
  currentStock: number | null
  pendingOperation: boolean
  posReferencesChecked: boolean
  posHasReferences: boolean
}
