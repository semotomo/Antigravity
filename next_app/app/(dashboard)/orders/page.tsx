import { OrdersBoard } from '@/components/orders/OrdersBoard'
import { fetchOrderFormOptions, fetchOrders } from '@/lib/queries/orders'

export const metadata = {
  title: '客注管理 | Kennel Dashboard',
}

export default async function OrdersPage() {
  const [orders, formOptions] = await Promise.all([
    fetchOrders(),
    fetchOrderFormOptions(),
  ])

  return (
    <OrdersBoard
      orders={orders}
      stores={formOptions.stores}
      products={formOptions.products}
    />
  )
}
