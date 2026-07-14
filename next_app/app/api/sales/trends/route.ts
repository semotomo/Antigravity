import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const janCode = searchParams.get('janCode') || ''
    const productName = searchParams.get('productName') || ''
    const days = parseInt(searchParams.get('days') || '30', 10)

    if (!janCode && !productName) {
      return NextResponse.json(
        { message: 'janCode または productName を指定してください。' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // JST(日本時間)での本日および日数分の境界を計算
    const nowJst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
    const dateLimit = new Date(nowJst)
    dateLimit.setDate(dateLimit.getDate() - days)
    
    const yearLimit = dateLimit.getFullYear()
    const monthLimit = String(dateLimit.getMonth() + 1).padStart(2, '0')
    const dayLimit = String(dateLimit.getDate()).padStart(2, '0')
    const dateLimitStr = `${yearLimit}-${monthLimit}-${dayLimit}`

    // データベースから指定範囲の売上を取得
    let query = supabase
      .from('sales_enriched_v')
      .select('sale_date, quantity, sales_amount')
      .gte('sale_date', dateLimitStr)

    if (janCode) {
      query = query.eq('jan_code', janCode)
    } else {
      query = query.eq('product_name', productName)
    }

    const { data: rawData, error } = await query

    if (error) {
      console.error('Supabase query error in trends API:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // 取得したデータを日付ごとに集約
    const salesMap = new Map<string, { quantity: number; amount: number }>()
    if (rawData) {
      rawData.forEach((row: any) => {
        const date = row.sale_date
        const current = salesMap.get(date) || { quantity: 0, amount: 0 }
        salesMap.set(date, {
          quantity: current.quantity + (row.quantity || 0),
          amount: current.amount + (row.sales_amount || 0),
        })
      })
    }

    // 過去 N 日間の日付リストを生成してデータをマッピング (JST基準)
    const resultList = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(nowJst)
      d.setDate(d.getDate() - i)
      
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`
      
      const val = salesMap.get(dateStr) || { quantity: 0, amount: 0 }
      resultList.push({
        date: `${month}/${day}`, // グラフ用ラベル (例: "07/14")
        fullDate: dateStr,
        quantity: val.quantity,
        amount: val.amount,
      })
    }

    return NextResponse.json({
      success: true,
      data: resultList,
    })
  } catch (error: any) {
    console.error('Unexpected error in trends API:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
