import { ProductsBoard } from '@/components/products/ProductsBoard'
import { getProductStoreId } from '@/lib/productStores'
import { getStoreContext } from '@/lib/storeAuth'

export const metadata = {
  title: '商品マスタ | Kennel Dashboard',
}

export default async function ProductsPage() {
  const posEditorEnabled = process.env.POS_PRODUCT_EDITOR_ENABLED === 'true'
  const posSaveEnabled = posEditorEnabled && process.env.POS_PRODUCT_WRITES_ENABLED === 'true' &&
    process.env.POS_PRODUCT_DISPATCH_ENABLED === 'true' && process.env.POS_PRODUCT_EDIT_GATEWAY_ENABLED === 'true' &&
    process.env.POS_PRODUCT_CONSUME_ENABLED === 'true' && process.env.POS_PRODUCT_EDIT_EXECUTION_ENABLED === 'true'
  const selectedStoreId = getProductStoreId((await getStoreContext()).currentView)
  return <ProductsBoard products={[]} posEditorEnabled={posEditorEnabled} posSaveEnabled={posSaveEnabled} selectedStoreId={selectedStoreId} />
}
