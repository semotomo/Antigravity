'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const PRODUCT_NAV_ITEMS = [
  { href: '/products', label: '商品マスタ' },
  { href: '/products/aliases', label: 'エイリアス管理' },
  { href: '/products/unmatched', label: '未一致解消' },
] as const

function isActivePath(pathname: string, href: (typeof PRODUCT_NAV_ITEMS)[number]['href']) {
  if (href === '/products') {
    return pathname === href
  }

  return pathname.startsWith(href)
}

export function ProductsSubnav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-wrap gap-2">
      {PRODUCT_NAV_ITEMS.map((item) => {
        const isActive = isActivePath(pathname, item.href)

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              isActive
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-900'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
