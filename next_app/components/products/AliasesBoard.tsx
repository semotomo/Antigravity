'use client'

import { useActionState, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Link2, Search, Shuffle, Trash2, X } from 'lucide-react'
import { deleteAliasAction, updateAliasTargetAction } from '@/app/actions/products'
import { ProductSearchCombobox } from '@/components/products/ProductSearchCombobox'
import { ProductsSubnav } from '@/components/products/ProductsSubnav'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  formatProductDateTime,
  initialProductMutationState,
  type ProductAliasListRow,
  type ProductOption,
} from '@/lib/products'

type AliasesBoardProps = {
  aliases: ProductAliasListRow[]
  products: ProductOption[]
}

type DialogState = {
  alias: ProductAliasListRow
  nonce: number
} | null

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
    >
      {pending ? '保存中...' : '紐付け先を更新'}
    </button>
  )
}

function AliasTargetModal({
  alias,
  products,
  onClose,
}: {
  alias: ProductAliasListRow
  products: ProductOption[]
  onClose: () => void
}) {
  const [state, formAction] = useActionState(
    updateAliasTargetAction,
    initialProductMutationState
  )

  useEffect(() => {
    if (state.status === 'success') {
      onClose()
    }
  }, [onClose, state.status])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-gray-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-5">
          <div>
            <h2 className="mt-2 text-2xl font-bold text-gray-900">紐付け先を変更</h2>
            <p className="mt-1 text-sm text-gray-500">
              POS 名「{alias.alias_name}」を別の商品マスタへ付け替えます。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50 hover:text-gray-900"
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form action={formAction} className="space-y-6 px-6 py-6">
          <input type="hidden" name="id" value={alias.id} />
          <input type="hidden" name="alias_name" value={alias.alias_name} />

          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-700">
            <p className="font-semibold text-gray-900">現在の紐付け</p>
            <p className="mt-1">
              {alias.product?.product_name ?? '商品未設定'} / JAN: {alias.product?.jan_code || '-'} /
              区分: {alias.product?.category || '-'}
            </p>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-gray-700">新しい紐付け先を検索</span>
            <ProductSearchCombobox
              name="product_id"
              products={products}
              initialValue={String(alias.product_id)}
              defaultQuery={alias.product?.product_name ?? alias.alias_name}
            />
            {state.fieldErrors.product_id ? (
              <span className="text-xs text-red-600">{state.fieldErrors.product_id}</span>
            ) : null}
          </label>

          {state.message ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                state.status === 'error'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}
            >
              {state.message}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-3 border-t border-gray-200 pt-5 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              閉じる
            </button>
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  )
}

export function AliasesBoard({ aliases, products }: AliasesBoardProps) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [dialogState, setDialogState] = useState<DialogState>(null)

  const filteredAliases = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase()

    if (!normalized) {
      return aliases
    }

    return aliases.filter((alias) =>
      [alias.alias_name, alias.product?.product_name ?? '', alias.product?.jan_code ?? '']
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    )
  }, [aliases, deferredQuery])

  const counts = useMemo(
    () => ({
      total: aliases.length,
      active: aliases.filter((alias) => alias.is_active).length,
      inactive: aliases.filter((alias) => !alias.is_active).length,
    }),
    [aliases]
  )

  const columns: DataTableColumn<ProductAliasListRow>[] = [
    {
      key: 'alias_name',
      header: '生 POS 名',
      render: (alias) => <span className="font-semibold text-gray-900">{alias.alias_name}</span>,
    },
    {
      key: 'product',
      header: '紐付け先商品',
      render: (alias) => (
        <div className="min-w-[240px]">
          <p className="font-semibold text-gray-900">
            {alias.product?.product_name ?? '商品が見つかりません'}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            JAN: {alias.product?.jan_code || '-'} / 区分: {alias.product?.category || '-'}
          </p>
        </div>
      ),
    },
    {
      key: 'created_at',
      header: '登録日時',
      render: (alias) => formatProductDateTime(alias.created_at),
    },
    {
      key: 'status',
      header: '状態',
      align: 'center',
      render: (alias) => (
        <StatusBadge variant={alias.is_active ? 'success' : 'gray'}>
          {alias.is_active ? '有効' : '停止'}
        </StatusBadge>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      align: 'center',
      render: (alias) => (
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() =>
              setDialogState({
                alias,
                nonce: Date.now(),
              })
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <Shuffle className="h-4 w-4" />
            先を変更
          </button>

          <form action={deleteAliasAction}>
            <input type="hidden" name="id" value={alias.id} />
            <button
              type="submit"
              onClick={(event) => {
                if (!window.confirm(`「${alias.alias_name}」の紐付けを削除しますか？`)) {
                  event.preventDefault()
                }
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
            >
              <Trash2 className="h-4 w-4" />
              削除
            </button>
          </form>
        </div>
      ),
    },
  ]

  return (
    <>
      <div className="space-y-6">
        <ProductsSubnav />

        <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-gray-900 via-slate-800 to-amber-600 px-6 py-7 text-white">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">エイリアス管理</h1>
                <p className="mt-2 max-w-2xl text-sm text-amber-50/90">
                  登録済みの POS 名と商品マスタの紐付けを見直し、誤登録の修正や削除を行います。
                </p>
              </div>
              <div className="rounded-3xl bg-white/10 px-4 py-3 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-100">
                  表示件数
                </p>
                <p className="mt-2 text-2xl font-bold">{filteredAliases.length}</p>
                <p className="text-xs text-amber-50/90">検索条件に一致した別名</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 px-6 py-5 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                総登録数
              </p>
              <p className="mt-3 text-3xl font-bold text-gray-900">{counts.total}</p>
              <p className="mt-1 text-sm text-gray-500">POS 名の揺れ吸収に使われる別名</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                有効
              </p>
              <p className="mt-3 text-3xl font-bold text-gray-900">{counts.active}</p>
              <p className="mt-1 text-sm text-gray-500">現在売上ビューで参照される別名</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                停止中
              </p>
              <p className="mt-3 text-3xl font-bold text-gray-900">{counts.inactive}</p>
              <p className="mt-1 text-sm text-gray-500">過去データとして残っている別名</p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-gray-700">POS 名で検索</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="POS 名 / 紐付け先商品名 / JAN"
                  className="w-full rounded-2xl border border-gray-300 py-2.5 pl-10 pr-3 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                />
              </div>
            </label>
          </div>

          <div className="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <div className="flex items-start gap-3">
              <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                削除すると、その POS 名を使う売上は未一致扱いに戻ります。新しい紐付け先が決まっている場合は、先に「先を変更」を使うほうが安全です。
              </p>
            </div>
          </div>

          <DataTable
            data={filteredAliases}
            columns={columns}
            keyExtractor={(alias) => String(alias.id)}
            emptyMessage="条件に一致する別名データが見つかりませんでした。"
          />
        </section>
      </div>

      {dialogState ? (
        <AliasTargetModal
          key={`${dialogState.alias.id}-${dialogState.nonce}`}
          alias={dialogState.alias}
          products={products}
          onClose={() => setDialogState(null)}
        />
      ) : null}
    </>
  )
}
