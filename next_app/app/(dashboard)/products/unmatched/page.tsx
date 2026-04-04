import { UnmatchedBoard } from '@/components/products/UnmatchedBoard'
import { fetchActiveProducts, fetchUnmatchedProducts } from '@/lib/queries/products'

export const metadata = {
  title: '未一致商品の解消 | Kennel Dashboard',
}

export default async function ProductsUnmatchedPage() {
  const [unmatchedProducts, products] = await Promise.all([
    fetchUnmatchedProducts(),
    fetchActiveProducts(),
  ])

  return <UnmatchedBoard unmatchedProducts={unmatchedProducts} products={products} />
}
