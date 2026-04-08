'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ArrowRightLeft,
  BarChart3,
  CalendarDays,
  ClipboardList,
  ListOrdered,
  Package,
  type LucideIcon,
} from 'lucide-react'

type NavMatch = 'exact' | 'products' | 'transfers'

type NavItem = {
  name: string
  href: string
  icon: LucideIcon
  match: NavMatch
}

const navItems: NavItem[] = [
  { name: '客注', href: '/orders', icon: ClipboardList, match: 'exact' },
  { name: '商品', href: '/products', icon: Package, match: 'products' },
  { name: '移動', href: '/products/transfers', icon: ArrowRightLeft, match: 'transfers' },
  { name: '一覧', href: '/sales', icon: ListOrdered, match: 'exact' },
  { name: '日次', href: '/sales/daily', icon: CalendarDays, match: 'exact' },
  { name: '集計', href: '/sales/products', icon: Package, match: 'exact' },
  { name: 'ABC', href: '/sales/abc', icon: BarChart3, match: 'exact' },
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

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white pb-safe md:hidden">
      <div className="grid h-16 grid-cols-7">
        {navItems.map((item) => {
          const isActive = isActivePath(pathname, item)

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex h-full min-w-0 flex-col items-center justify-center gap-1 px-1 ${
                isActive ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <item.icon className="h-5 w-5 sm:h-6 sm:w-6" />
              <span className="truncate text-[10px] font-medium sm:text-xs">{item.name}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
