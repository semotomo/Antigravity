'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'

const PRODUCT_NAV_ITEMS = [
  { href: '/products/transfers', label: '店舗間移動' },
  { href: '/products', label: '商品マスタ' },
  { href: '/products/aliases', label: 'エイリアス管理' },
] as const

const PRODUCT_MENU_ITEMS = [{ href: '/products/unmatched', label: '未一致解消' }] as const

function isActivePath(pathname: string, href: (typeof PRODUCT_NAV_ITEMS)[number]['href']) {
  if (href === '/products') {
    return pathname === href
  }

  return pathname.startsWith(href)
}

export function ProductsSubnav() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  const isMenuActive = PRODUCT_MENU_ITEMS.some((item) => pathname.startsWith(item.href))

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
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
      </div>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
          className={`inline-flex items-center justify-center rounded-full border px-3 py-2 text-sm font-medium transition ${
            isMenuActive || menuOpen
              ? 'border-gray-900 bg-gray-900 text-white'
              : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-900'
          }`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="商品メニューを開く"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>

        {menuOpen ? (
          <div className="absolute right-0 top-full z-20 mt-2 min-w-44 overflow-hidden rounded-2xl border border-gray-200 bg-white p-2 shadow-xl">
            {PRODUCT_MENU_ITEMS.map((item) => {
              const isActive = pathname.startsWith(item.href)

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={`block rounded-xl px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        ) : null}
      </div>
    </nav>
  )
}
