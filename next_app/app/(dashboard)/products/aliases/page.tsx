import { AliasesBoard } from '@/components/products/AliasesBoard'
import { fetchProductAliases, fetchProducts } from '@/lib/queries/products'

export const metadata = {
  title: 'エイリアス管理 | Kennel Dashboard',
}

export default async function ProductAliasesPage() {
  const [aliases, products] = await Promise.all([fetchProductAliases(), fetchProducts()])

  return <AliasesBoard aliases={aliases} products={products} />
}
