import { cookies } from 'next/headers'

import { InventoryBoard } from '@/components/inventory/InventoryBoard'
import { getInventoryAllowedStores } from '@/lib/inventory/auth'
import { getInventoryWorkspace } from '@/lib/inventory/workspace'
import { createClient } from '@/lib/supabase/server'

type InventorySearchParams = { [key: string]: string | string[] | undefined }

export const metadata = {
  title: '棚卸し・在庫管理 | Kennel Dashboard',
}

function requestedStoreId(value: string | string[] | undefined) {
  const raw = typeof value === 'string' ? Number(value) : null
  return raw === 6 || raw === 7 ? raw : null
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<InventorySearchParams>
}) {
  const [resolvedParams, cookieStore, supabase] = await Promise.all([
    searchParams,
    cookies(),
    createClient(),
  ])
  const allowedStores = await getInventoryAllowedStores(supabase)

  if (allowedStores.length === 0) {
    return (
      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
        <h1 className="text-balance text-xl font-bold">棚卸し・在庫管理を利用できません</h1>
        <p className="mt-2 text-pretty text-sm">
          店舗権限が登録されていません。管理者へ確認してください。
        </p>
      </section>
    )
  }

  const requested = requestedStoreId(resolvedParams.store)
  const cookieView = cookieStore.get('current_store_view')?.value
  const cookieStoreId = cookieView === 'wanwan' ? 6 : cookieView === 'main' ? 7 : null
  const selectedStoreId = requested && allowedStores.includes(requested)
    ? requested
    : cookieStoreId && allowedStores.includes(cookieStoreId)
      ? cookieStoreId
      : allowedStores[0]

  const initialWorkspace = await getInventoryWorkspace(supabase, {
    storeId: selectedStoreId,
    sessionId: null,
    query: '',
    countStatus: 'uncounted',
    limit: 100,
    offset: 0,
  })

  return (
    <InventoryBoard
      allowedStores={allowedStores}
      initialWorkspace={initialWorkspace}
      storeId={selectedStoreId}
    />
  )
}
