'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  AlertTriangle,
  CalendarDays,
  ClipboardList,
  ListOrdered,
  Package,
} from 'lucide-react'

type NavItem = {
  name: string
  href: string
  icon: typeof ClipboardList
  match: 'exact' | 'startsWith'
}

const navItems: NavItem[] = [
  { name: '客注', href: '/orders', icon: ClipboardList, match: 'exact' },
  { name: '未一致', href: '/products/unmatched', icon: AlertTriangle, match: 'startsWith' },
  { name: '一覧', href: '/sales', icon: ListOrdered, match: 'exact' },
  { name: '日次', href: '/sales/daily', icon: CalendarDays, match: 'exact' },
  { name: '商品別', href: '/sales/products', icon: Package, match: 'exact' },
]

function isActivePath(pathname: string, item: NavItem) {
  if (item.match === 'startsWith') {
    return pathname.startsWith('/products')
  }

  return pathname === item.href
}

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white pb-safe md:hidden">
      <div className="flex h-16 items-center justify-around">
        {navItems.map((item) => {
          const isActive = isActivePath(pathname, item)

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex h-full w-full flex-col items-center justify-center space-y-1 ${
                isActive ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <item.icon className="h-6 w-6" />
              <span className="text-[10px] font-medium sm:text-xs">{item.name}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
