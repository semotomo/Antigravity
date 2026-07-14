'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, CalendarDays, MoreHorizontal, Package } from 'lucide-react'

type SalesMoreMenuVariant = 'bottom' | 'header'

type SalesMoreMenuProps = {
  variant: SalesMoreMenuVariant
}

const SALES_MORE_ITEMS = [
  { name: '日次集計', href: '/sales/daily', icon: CalendarDays },
  { name: 'ABC分析', href: '/sales/abc', icon: BarChart3 },
] as const

function isActivePath(pathname: string, href: string) {
  return pathname === href
}

export function isSalesMorePath(pathname: string) {
  return SALES_MORE_ITEMS.some((item) => isActivePath(pathname, item.href))
}

export function SalesMoreMenu({ variant }: SalesMoreMenuProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const isActive = isSalesMorePath(pathname)
  const isBottom = variant === 'bottom'

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  return (
    <div ref={menuRef} className={isBottom ? 'relative h-full min-w-0' : 'relative'}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={
          isBottom
            ? `flex h-full w-full min-w-0 flex-col items-center justify-center gap-1 px-1 ${
                isActive || open ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'
              }`
            : `inline-flex items-center justify-center rounded-full border p-2 transition ${
                isActive || open
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-900'
              }`
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="売上集計メニューを開く"
      >
        <MoreHorizontal className={isBottom ? 'h-5 w-5 sm:h-6 sm:w-6' : 'h-5 w-5'} />
        {isBottom ? (
          <span className="truncate text-[10px] font-medium sm:text-xs">・・・</span>
        ) : null}
      </button>

      {open ? (
        <div
          className={
            isBottom
              ? 'absolute bottom-full right-1 z-[60] mb-2 w-52 overflow-hidden rounded-2xl border border-gray-200 bg-white p-2 shadow-2xl'
              : 'absolute right-0 top-full z-[60] mt-2 w-52 overflow-hidden rounded-2xl border border-gray-200 bg-white p-2 shadow-2xl'
          }
          role="menu"
        >
          {SALES_MORE_ITEMS.map((item) => {
            const itemActive = isActivePath(pathname, item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  itemActive
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                }`}
                role="menuitem"
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span>{item.name}</span>
              </Link>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
