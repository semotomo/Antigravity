import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const janCode = searchParams.get('janCode') || ''
    const productName = searchParams.get('productName') || ''
    const daysParam = searchParams.get('days')
    const dateFrom = searchParams.get('dateFrom') || ''
    const dateTo = searchParams.get('dateTo') || ''

    if (!janCode && !productName) {
      return NextResponse.json(
        { message: 'janCode または productName を指定してください。' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    let dateLimitStr = ''
    let dateEndStr = ''
    let totalDays = 30
    let nowJst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))

    // dateFrom と dateTo が両方指定されている場合、その日付範囲を使用
    if (dateFrom && dateTo) {
      dateLimitStr = dateFrom
      dateEndStr = dateTo
      
      const dFrom = new Date(dateFrom)
      const dTo = new Date(dateTo)
      const diffTime = Math.abs(dTo.getTime() - dFrom.getTime())
      totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
      
      // 最大90日までに制限してパフォーマンスを維持
      if (totalDays > 90) {
        totalDays = 90
        const limitedLimit = new Date(dTo)
        limitedLimit.setDate(limitedLimit.getDate() - 89)
        const y = limitedLimit.getFullYear()
        const m = String(limitedLimit.getMonth() + 1).padStart(2, '0')
        const d = String(limitedLimit.getDate()).padStart(2, '0')
        dateLimitStr = `${y}-${m}-${d}`
      }
    } else {
      const days = parseInt(daysParam || '30', 10)
      totalDays = days
      const dateLimit = new Date(nowJst)
      dateLimit.setDate(dateLimit.getDate() - days)
      
      const yearLimit = dateLimit.getFullYear()
      const monthLimit = String(dateLimit.getMonth() + 1).padStart(2, '0')
      const dayLimit = String(dateLimit.getDate()).padStart(2, '0')
      dateLimitStr = `${yearLimit}-${monthLimit}-${dayLimit}`
      
      const yearEnd = nowJst.getFullYear()
      const monthEnd = String(nowJst.getMonth() + 1).padStart(2, '0')
      const dayEnd = String(nowJst.getDate()).padStart(2, '0')
      dateEndStr = `${yearEnd}-${monthEnd}-${dayEnd}`
    }

    // データベースから指定範囲の売上を取得
    let query = supabase
      .from('sales_enriched_v')
      .select('sale_date, quantity, sales_amount')
      .gte('sale_date', dateLimitStr)
      .lte('sale_date', dateEndStr)

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

    // 日付リストを生成してデータをマッピング (JST基準)
    const resultList = []
    const baseDate = dateFrom && dateTo ? new Date(dateLimitStr) : new Date(nowJst)
    
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(baseDate)
      if (dateFrom && dateTo) {
        d.setDate(d.getDate() + i)
      } else {
        d.setDate(d.getDate() - (totalDays - 1 - i))
      }
      
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
