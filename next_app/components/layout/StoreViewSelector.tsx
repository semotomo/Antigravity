'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Store, Layers, Building2, ShieldCheck } from 'lucide-react'
import { StoreView, StoreType } from '@/lib/storeAuth'

interface StoreViewSelectorProps {
  initialView: StoreView
  storeType: StoreType
}

export function StoreViewSelector({ initialView, storeType }: StoreViewSelectorProps) {
  const router = useRouter()
  const [view, setView] = useState<StoreView>(initialView)

  const handleViewChange = (newView: StoreView) => {
    setView(newView)
    
    // Cookie に値を保存 (期限: 1年)
    const maxAge = 60 * 60 * 24 * 365
    document.cookie = `current_store_view=${newView}; path=/; max-age=${maxAge}; SameSite=Lax`
    
    // ページを強制再読み込みして連動させる
    router.refresh()
    window.location.reload()
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-gray-55/60 p-3.5 border border-gray-150 backdrop-blur-md">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        <Store className="h-3 w-3" />
        <span>表示対象の店舗</span>
      </div>

      <div className="grid grid-cols-3 gap-1 bg-gray-100 p-0.5 rounded-xl border border-gray-200">
        <button
          type="button"
          onClick={() => handleViewChange('all')}
          className={`flex flex-col items-center justify-center gap-1 py-1.5 text-[11px] font-bold rounded-lg transition cursor-pointer ${
            view === 'all'
              ? 'bg-white text-gray-900 shadow-sm border border-gray-200/80'
              : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          全店舗
        </button>

        <button
          type="button"
          onClick={() => handleViewChange('main')}
          className={`flex flex-col items-center justify-center gap-1 py-1.5 text-[11px] font-bold rounded-lg transition cursor-pointer ${
            view === 'main'
              ? 'bg-white text-gray-900 shadow-sm border border-gray-200/80'
              : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          <Building2 className="h-3.5 w-3.5 text-indigo-500" />
          本店のみ
        </button>

        <button
          type="button"
          onClick={() => handleViewChange('wanwan')}
          className={`flex flex-col items-center justify-center gap-1 py-1.5 text-[11px] font-bold rounded-lg transition cursor-pointer ${
            view === 'wanwan'
              ? 'bg-white text-gray-900 shadow-sm border border-gray-200/80'
              : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          <Building2 className="h-3.5 w-3.5 text-amber-500" />
          わんわん
        </button>
      </div>

      <div className="mt-1 flex items-center gap-1 text-[10px] text-gray-400 font-medium justify-center">
        <ShieldCheck className="h-3 w-3 text-indigo-400" />
        <span>権限: {storeType === 'master' ? 'マスター管理者' : '店舗アカウント'}</span>
      </div>
    </div>
  )
}
