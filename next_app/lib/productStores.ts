import type { StoreView } from '@/lib/storeAuth'

export const PRODUCT_STORE = {
  main: {
    id: 7,
    name: '本店',
  },
  wanwan: {
    id: 6,
    name: 'わんわん',
  },
} as const

export type ProductStoreId = (typeof PRODUCT_STORE)[keyof typeof PRODUCT_STORE]['id']

export function getProductStoreId(view: StoreView): ProductStoreId | null {
  if (view === 'main') {
    return PRODUCT_STORE.main.id
  }

  if (view === 'wanwan') {
    return PRODUCT_STORE.wanwan.id
  }

  return null
}

export function getProductStoreName(storeId: number | null | undefined) {
  if (storeId === PRODUCT_STORE.wanwan.id) {
    return PRODUCT_STORE.wanwan.name
  }

  if (storeId === PRODUCT_STORE.main.id) {
    return PRODUCT_STORE.main.name
  }

  return '店舗未設定'
}

export function requireProductStore(view: StoreView) {
  const storeId = getProductStoreId(view)

  if (storeId === null) {
    throw new Error('商品を変更する店舗を「本店のみ」または「わんわん」から選択してください。')
  }

  return {
    id: storeId,
    name: getProductStoreName(storeId),
  }
}
