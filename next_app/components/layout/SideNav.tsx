'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CalendarDays,
  ClipboardList,
  ListOrdered,
  LogOut,
  Package,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type NavItem = {
  name: string
  href: string
  icon: typeof ClipboardList
  match: 'exact' | 'startsWith'
}

const navItems: NavItem[] = [
  { name: '客注管理', href: '/orders', icon: ClipboardList, match: 'exact' },
  { name: '未一致解消', href: '/products/unmatched', icon: AlertTriangle, match: 'startsWith' },
  { name: '売上一覧', href: '/sales', icon: ListOrdered, match: 'exact' },
  { name: '日次集計', href: '/sales/daily', icon: CalendarDays, match: 'exact' },
  { name: '商品別集計', href: '/sales/products', icon: Package, match: 'exact' },
]

function isActivePath(pathname: string, item: NavItem) {
  if (item.match === 'startsWith') {
    return pathname.startsWith('/products')
  }

  return pathname === item.href
}

export default function SideNav() {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="hidden md:fixed md:inset-y-0 md:flex md:w-64 md:flex-col border-r border-gray-800 bg-gray-900">
      <div className="flex h-16 flex-shrink-0 items-center bg-gray-900 px-4">
        <span className="text-xl font-bold uppercase tracking-widest text-white">Kennel</span>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <nav className="flex-1 space-y-1 px-2 py-4">
          {navItems.map((item) => {
            const isActive = isActivePath(pathname, item)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center rounded-md px-2 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                <item.icon
                  className={`mr-3 h-5 w-5 flex-shrink-0 ${
                    isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-300'
                  }`}
                  aria-hidden="true"
                />
                {item.name}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-gray-800 p-4">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <LogOut className="h-5 w-5" />
            ログアウト
          </button>
        </div>
      </div>
    </div>
  )
}
