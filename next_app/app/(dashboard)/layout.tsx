'use client'

import { useSyncExternalStore } from 'react'
import SideNav from '@/components/layout/SideNav'
import BottomNav from '@/components/layout/BottomNav'
import { SalesMoreMenu } from '@/components/layout/SalesMoreMenu'

const SIDEBAR_STORAGE_KEY = 'dashboard-sidebar-collapsed'
const SIDEBAR_STORAGE_EVENT = 'dashboard-sidebar-storage-change'
const SIDEBAR_COLLAPSE_MEDIA_QUERY = '(max-width: 1279px)'

function getSidebarCollapsedSnapshot() {
  if (typeof window === 'undefined') {
    return true
  }

  const savedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)

  if (savedValue === 'true' || savedValue === 'false') {
    return savedValue === 'true'
  }

  return window.matchMedia(SIDEBAR_COLLAPSE_MEDIA_QUERY).matches
}

function subscribeToSidebarPreference(callback: () => void) {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const mediaQuery = window.matchMedia(SIDEBAR_COLLAPSE_MEDIA_QUERY)
  const handleMediaQueryChange = () => callback()
  const handleStorage = (event: StorageEvent) => {
    if (event.key === SIDEBAR_STORAGE_KEY) {
      callback()
    }
  }
  const handlePreferenceChange = () => callback()

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleMediaQueryChange)
  } else {
    mediaQuery.addListener(handleMediaQueryChange)
  }

  window.addEventListener('storage', handleStorage)
  window.addEventListener(SIDEBAR_STORAGE_EVENT, handlePreferenceChange)

  return () => {
    if (typeof mediaQuery.removeEventListener === 'function') {
      mediaQuery.removeEventListener('change', handleMediaQueryChange)
    } else {
      mediaQuery.removeListener(handleMediaQueryChange)
    }

    window.removeEventListener('storage', handleStorage)
    window.removeEventListener(SIDEBAR_STORAGE_EVENT, handlePreferenceChange)
  }
}

function updateSidebarCollapsedPreference(nextCollapsed: boolean) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextCollapsed))
  window.dispatchEvent(new Event(SIDEBAR_STORAGE_EVENT))
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const sidebarCollapsed = useSyncExternalStore(
    subscribeToSidebarPreference,
    getSidebarCollapsedSnapshot,
    () => true
  )

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 md:flex-row">
      <SideNav
        collapsed={sidebarCollapsed}
        onToggle={() => updateSidebarCollapsedPreference(!sidebarCollapsed)}
      />

      <div
        className={`flex min-h-screen flex-1 flex-col transition-[padding] duration-200 ${
          sidebarCollapsed ? 'md:pl-20' : 'md:pl-64'
        }`}
      >
        <header className="flex h-14 shrink-0 items-center justify-between bg-white px-4 shadow-sm md:hidden">
          <span className="font-bold tracking-wider text-gray-900">KENNEL</span>
          <SalesMoreMenu variant="header" />
        </header>

        <main className="mx-auto flex-1 w-full max-w-7xl overflow-auto p-4 pb-20 md:p-6 md:pb-6">
          {children}
        </main>

        <BottomNav />
      </div>
    </div>
  )
}
