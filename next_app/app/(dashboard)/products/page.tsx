import { ProductsBoard } from '@/components/products/ProductsBoard'

export const metadata = {
  title: '商品マスタ | Kennel Dashboard',
}

export default async function ProductsPage() {
  return <ProductsBoard products={[]} />
}
