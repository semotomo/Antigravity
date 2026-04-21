import { createClient } from '@/lib/supabase/server'
import type {
  OrderListRow,
  OrderProductOption,
  OrderStoreOption,
} from '@/lib/orders'

const ORDER_PRODUCT_BATCH_SIZE = 1000

type BatchedQueryResult<T> = {
  data: T[] | null
  error: unknown | null
}

async function fetchAllRows<T>(
  fetchBatch: (from: number, to: number) => Promise<BatchedQueryResult<T>>,
  label: string
) {
  const rows: T[] = []
  let from = 0

  while (true) {
    const to = from + ORDER_PRODUCT_BATCH_SIZE - 1
    const { data, error } = await fetchBatch(from, to)

    if (error) {
      console.error(`Error fetching ${label}:`, error)
      return []
    }

    const batch = data ?? []
    rows.push(...batch)

    if (batch.length < ORDER_PRODUCT_BATCH_SIZE) {
      break
    }

    from += batch.length
  }

  return rows
}

export async function fetchOrders(limit = 500): Promise<OrderListRow[]> {
  const supabase = await createClient()
  const [{ data: orders, error: ordersError }, { data: stores, error: storesError }, products] =
    await Promise.all([
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
    fetchAllRows<OrderProductOption>(
      async (from, to) =>
        await supabase
          .from('products')
          .select('id, product_name, jan_code, category')
          .order('product_name', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      'products for customer orders'
    ),
  ])

  if (ordersError) {
    console.error('Error fetching customer orders:', ordersError)
    return []
  }

  if (storesError) {
    console.error('Error fetching stores for customer orders:', storesError)
  }

  const storeMap = new Map(((stores ?? []) as OrderStoreOption[]).map((store) => [store.id, store]))
  const productMap = new Map(
    products.map((product) => [product.id, product])
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

  const [{ data: stores, error: storesError }, products] =
    await Promise.all([
      supabase.from('stores').select('id, name').order('id', { ascending: true }),
      fetchAllRows<OrderProductOption>(
        async (from, to) =>
          await supabase
            .from('products')
            .select('id, product_name, jan_code, category')
            .eq('is_active', true)
            .order('product_name', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to),
        'active products for customer orders'
      ),
    ])

  if (storesError) {
    console.error('Error fetching stores:', storesError)
  }

  return {
    stores: (stores ?? []) as OrderStoreOption[],
    products: products.filter((product) => Boolean(product.product_name)),
  }
}
