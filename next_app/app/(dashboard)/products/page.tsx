import { ProductsBoard } from '@/components/products/ProductsBoard'
import { fetchProducts } from '@/lib/queries/products'

export const metadata = {
  title: '商品マスタ | Kennel Dashboard',
}

export default async function ProductsPage() {
  const products = await fetchProducts()

  return <ProductsBoard products={products} />
}
