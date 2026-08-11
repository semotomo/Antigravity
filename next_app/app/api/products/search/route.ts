import { NextResponse } from 'next/server'
import { getProductStoreId } from '@/lib/productStores'
import { getStoreContext } from '@/lib/storeAuth'
import { createClient } from '@/lib/supabase/server'

// 商品高速検索用APIルート
// クライアント側からの入力に連動してSupabaseを高速部分一致検索（AND条件）する
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, message: 'ログインが必要です。' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')?.trim() || ''
    const includeInactive = searchParams.get('includeInactive') === 'true'

    if (!q) {
      return NextResponse.json({ success: true, data: [] })
    }

    const storeContext = await getStoreContext()
    const productStoreId = getProductStoreId(storeContext.currentView)

    // スペース区切りの複数キーワードに対応
    const keywords = q.split(/\s+/).filter(Boolean)
    let queryBuilder = supabase
      .from('products')
      .select('id, store_id, jan_code, product_name, cost_price, selling_price, category, markup_rate, product_group, brand, is_active, updated_at, supplier_name, tags')

    // 商品の所属はタグ文字列ではなく店舗IDで厳密に分離する
    if (productStoreId !== null) {
      queryBuilder = queryBuilder.eq('store_id', productStoreId)
    }

    // 通常検索では停止商品を除外し、必要な場合だけ画面の切り替えで含める
    if (!includeInactive) {
      queryBuilder = queryBuilder.eq('is_active', true)
    }

    // 各キーワードに対して、商品名・JAN・ブランド・カテゴリ・タグのいずれかに部分一致するAND条件をチェーンする
    keywords.forEach((kw) => {
      // JANコード（数字）の場合はJANに完全一致または前方一致、かつ他のテキストへの部分一致
      if (/^\d+$/.test(kw)) {
        queryBuilder = queryBuilder.or(`jan_code.ilike.%${kw}%,product_name.ilike.%${kw}%`)
      } else {
        queryBuilder = queryBuilder.or(`product_name.ilike.%${kw}%,brand.ilike.%${kw}%,category.ilike.%${kw}%`)
      }
    })

    const { data: products, error } = await queryBuilder
      .order('product_name', { ascending: true })
      .limit(50) // 最大50件に制限し、DOM爆発と通信遅延を防止

    if (error) {
      console.error('Error searching products:', error)
      return NextResponse.json({ success: false, message: '検索に失敗しました。' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: products })
  } catch (error) {
    console.error('Unexpected error in product search API:', error)
    return NextResponse.json({ success: false, message: '内部サーバーエラーが発生しました。' }, { status: 500 })
  }
}
