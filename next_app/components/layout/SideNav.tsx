'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ArrowRightLeft,
  BarChart3,
  CalendarDays,
  ClipboardList,
  ListOrdered,
  LogOut,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Dog,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useState, useEffect } from 'react'
import { StoreViewSelector } from './StoreViewSelector'
import { APP_VERSION, BUILD_TIMESTAMP } from '@/lib/version'

type NavMatch = 'exact' | 'products' | 'transfers'

type NavItem = {
  name: string
  href: string
  icon: LucideIcon
  match: NavMatch
}

type SideNavProps = {
  collapsed: boolean
  onToggle: () => void
}

const navItems: NavItem[] = [
  { name: '客注管理', href: '/orders', icon: ClipboardList, match: 'exact' },
  { name: '商品管理', href: '/products', icon: Package, match: 'products' },
  { name: '店舗間移動', href: '/products/transfers', icon: ArrowRightLeft, match: 'transfers' },
  { name: '売上一覧', href: '/sales', icon: ListOrdered, match: 'exact' },
  { name: '日次集計', href: '/sales/daily', icon: CalendarDays, match: 'exact' },
  { name: 'ABC分析', href: '/sales/abc', icon: BarChart3, match: 'exact' },
  { name: '生体管理', href: '/pets', icon: Dog, match: 'exact' },
]

function isActivePath(pathname: string, item: NavItem) {
  if (item.match === 'products') {
    return (
      pathname === '/products' ||
      pathname.startsWith('/products/aliases') ||
      pathname.startsWith('/products/unmatched')
    )
  }

  if (item.match === 'transfers') {
    return pathname.startsWith('/products/transfers')
  }

  return pathname === item.href
}

export default function SideNav({ collapsed, onToggle }: SideNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [storeType, setStoreType] = useState<'master' | 'wanwan'>('master')
  const [storeView, setStoreView] = useState<'all' | 'main' | 'wanwan'>('main')

  useEffect(() => {
    const cookiesObj = document.cookie.split('; ').reduce((acc, current) => {
      const parts = current.split('=')
      if (parts.length >= 2) {
        acc[parts[0]] = parts.slice(1).join('=')
      }
      return acc
    }, {} as Record<string, string>)
    
    if (cookiesObj.current_store_view) {
      setStoreView(cookiesObj.current_store_view as any)
    }

    const fetchUser = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.user_metadata?.store_type === 'wanwan') {
        setStoreType('wanwan')
      }
    }
    fetchUser()
  }, [])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div
      className={`hidden border-r border-gray-800 bg-gray-900 transition-[width] duration-200 md:fixed md:inset-y-0 md:z-40 md:flex md:flex-col ${
        collapsed ? 'md:w-20' : 'md:w-64'
      }`}
    >
      <div
        className={`flex h-16 flex-shrink-0 items-center border-b border-gray-800 bg-gray-900 ${
          collapsed ? 'justify-center px-2' : 'justify-between px-4'
        }`}
      >
        <span className="text-xl font-bold uppercase tracking-widest text-white">
          {collapsed ? 'K' : 'Kennel'}
        </span>
        {!collapsed ? (
          <button
            type="button"
            onClick={onToggle}
            className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-800 hover:text-white"
            aria-label="サイドバーを最小化"
            title="サイドバーを最小化"
          >
            <PanelLeftClose className="h-5 w-5" />
          </button>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
        {collapsed ? (
          <div className="flex justify-center px-2 py-3">
            <button
              type="button"
              onClick={onToggle}
              className="rounded-xl border border-gray-700 bg-gray-800 p-2 text-gray-300 transition hover:border-gray-600 hover:text-white"
              aria-label="サイドバーを展開"
              title="サイドバーを展開"
            >
              <PanelLeftOpen className="h-5 w-5" />
            </button>
          </div>
        ) : null}

        <nav className={`flex-1 space-y-1 py-4 ${collapsed ? 'px-2' : 'px-2'}`}>
          {(() => {
            const displayItems = [...navItems]
            if (storeType === 'master') {
              displayItems.push({
                name: '設定オプション',
                href: '/options',
                icon: Settings,
                match: 'exact',
              })
            }
            return displayItems.map((item) => {
              const isActive = isActivePath(pathname, item)

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.name : undefined}
                  className={`group flex items-center rounded-md text-sm font-medium transition-colors ${
                    collapsed
                      ? 'justify-center px-0 py-3'
                      : 'px-2 py-2'
                  } ${
                    isActive
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  <item.icon
                    className={`h-5 w-5 flex-shrink-0 ${
                      collapsed
                        ? isActive
                          ? 'text-white'
                          : 'text-gray-400 group-hover:text-gray-300'
                        : `mr-3 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-300'}`
                    }`}
                    aria-hidden="true"
                  />
                  {collapsed ? <span className="sr-only">{item.name}</span> : item.name}
                </Link>
              )
            })
          })()}
        </nav>
        <div className="border-t border-gray-800 p-4 space-y-4">
          {!collapsed && (
            <StoreViewSelector initialView={storeView} storeType={storeType} />
          )}
          <div className="flex flex-col gap-2">
            <button
              onClick={handleLogout}
              title={collapsed ? 'ログアウト' : undefined}
              className={`flex w-full items-center rounded-md text-sm font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-white ${
                collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-2 py-2'
              }`}
            >
              <LogOut className="h-5 w-5" />
              {collapsed ? <span className="sr-only">ログアウト</span> : 'ログアウト'}
            </button>
            {!collapsed && (
              <div className="px-2 text-right text-[10px] text-gray-500 font-mono tracking-tighter">
                {APP_VERSION} ({BUILD_TIMESTAMP})
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
