import { createClient } from '@/lib/supabase/server'
import type {
  OrderListRow,
  OrderProductOption,
  OrderStoreOption,
} from '@/lib/orders'

export async function fetchOrders(limit = 500): Promise<OrderListRow[]> {
  const supabase = await createClient()
  const [{ data: orders, error: ordersError }, { data: stores, error: storesError }, {
    data: products,
    error: productsError,
  }] = await Promise.all([
    supabase
      .from('customer_orders')
      .select(`
        id,
        order_no,
        customer_name,
        phone_number,
        item_name,
        item_details,
        staff_name,
        notes,
        status,
        store_id,
        product_id,
        jan_code,
        quantity,
        unit_price,
        order_date,
        expected_arrival_date,
        pickup_due_date,
        created_at,
        updated_at
      `)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase.from('stores').select('id, name'),
    supabase.from('products').select('id, product_name, jan_code, category'),
  ])

  if (ordersError) {
    console.error('Error fetching customer orders:', ordersError)
    return []
  }

  if (storesError) {
    console.error('Error fetching stores for customer orders:', storesError)
  }

  if (productsError) {
    console.error('Error fetching products for customer orders:', productsError)
  }

  const storeMap = new Map(((stores ?? []) as OrderStoreOption[]).map((store) => [store.id, store]))
  const productMap = new Map(
    ((products ?? []) as OrderProductOption[]).map((product) => [product.id, product])
  )

  return ((orders ?? []) as Omit<OrderListRow, 'store' | 'product'>[]).map((order) => ({
    ...order,
    store: order.store_id ? storeMap.get(order.store_id) ?? null : null,
    product: order.product_id ? productMap.get(order.product_id) ?? null : null,
  }))
}

export async function fetchOrderDetails(id: string): Promise<OrderListRow | null> {
  const supabase = await createClient()
  const { data: order, error } = await supabase
    .from('customer_orders')
    .select(
      `
        id,
        order_no,
        customer_name,
        phone_number,
        item_name,
        item_details,
        staff_name,
        notes,
        status,
        store_id,
        product_id,
        jan_code,
        quantity,
        unit_price,
        order_date,
        expected_arrival_date,
        pickup_due_date,
        created_at,
        updated_at
      `
    )
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('Error fetching customer order detail:', error)
    return null
  }

  if (!order) {
    return null
  }

  const normalizedOrder = order as Omit<OrderListRow, 'store' | 'product'>

  const [{ data: stores, error: storesError }, { data: products, error: productsError }] =
    await Promise.all([
      normalizedOrder.store_id
        ? supabase
            .from('stores')
            .select('id, name')
            .eq('id', normalizedOrder.store_id)
            .maybeSingle()
        : Promise.resolve({ data: null as OrderStoreOption | null, error: null }),
      normalizedOrder.product_id
        ? supabase
            .from('products')
            .select('id, product_name, jan_code, category')
            .eq('id', normalizedOrder.product_id)
            .maybeSingle()
        : Promise.resolve({ data: null as OrderProductOption | null, error: null }),
    ])

  if (storesError) {
    console.error('Error fetching store for order detail:', storesError)
  }

  if (productsError) {
    console.error('Error fetching product for order detail:', productsError)
  }

  return {
    ...normalizedOrder,
    store: (stores as OrderStoreOption | null) ?? null,
    product: (products as OrderProductOption | null) ?? null,
  }
}

export async function fetchOrderFormOptions(): Promise<{
  stores: OrderStoreOption[]
  products: OrderProductOption[]
}> {
  const supabase = await createClient()

  const [{ data: stores, error: storesError }, { data: products, error: productsError }] =
    await Promise.all([
      supabase.from('stores').select('id, name').order('id', { ascending: true }),
      supabase
        .from('products')
        .select('id, product_name, jan_code, category')
        .eq('is_active', true)
        .order('product_name', { ascending: true }),
    ])

  if (storesError) {
    console.error('Error fetching stores:', storesError)
  }

  if (productsError) {
    console.error('Error fetching products:', productsError)
  }

  return {
    stores: (stores ?? []) as OrderStoreOption[],
    products: ((products ?? []) as OrderProductOption[]).filter(
      (product) => Boolean(product.product_name)
    ),
  }
}
