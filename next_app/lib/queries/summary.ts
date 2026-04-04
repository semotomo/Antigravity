import { createClient } from '@/lib/supabase/server'
import { Database } from '../types/database'

export type DailySummaryRow = Database['public']['Views']['sales_daily_summary_v']['Row']
export type ProductSummaryRow = Database['public']['Views']['sales_product_summary_v']['Row']

export async function fetchDailySummary(): Promise<DailySummaryRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sales_daily_summary_v')
    .select('*')
    .order('sale_date', { ascending: false })

  if (error) {
    console.error('Error fetching daily summary:', error)
    return []
  }
  return data || []
}

export async function fetchProductSummary(): Promise<ProductSummaryRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sales_product_summary_v')
    .select('*')
    .order('total_sales_amount', { ascending: false })

  if (error) {
    console.error('Error fetching product summary:', error)
    return []
  }
  return data || []
}
