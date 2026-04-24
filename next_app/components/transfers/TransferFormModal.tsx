'use client'

import { useActionState, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useFormStatus } from 'react-dom'
import { Minus, PackagePlus, Plus, Search, Trash2, X } from 'lucide-react'
import { createTransfersAction } from '@/app/actions/transfers'
import { JanCodeScannerField } from '@/components/orders/JanCodeScannerField'
import { formatYen } from '@/lib/products'
import {
  TRANSFER_ENTRY_TYPE_OPTIONS,
  TRANSFER_USAGE_CATEGORY_OPTIONS,
  buildJanCodeCandidates,
  chooseDefaultTransferFromStoreId,
  chooseDefaultTransferToStoreId,
  formatTransferEntryTypeLabel,
  formatTransferUsageCategoryLabel,
  initialTransferMutationState,
  isValidJanCode,
  normalizeJanCode,
  summarizeTransferDraftItems,
  type TransferDraftItem,
  type TransferEntryType,
  type TransferProductOption,
  type TransferStoreOption,
  type TransferUsageCategory,
} from '@/lib/transfers'

type TransferFormModalProps = {
  open: boolean
  stores: TransferStoreOption[]
  products: TransferProductOption[]
  onClose: () => void
}

type JanCommitSource = 'manual' | 'scanner'

type TransferDraftContext = {
  from_store_id: number
  to_store_id: number | null
  entry_type: TransferEntryType
  usage_category: TransferUsageCategory | null
  quantity: number
  memo: string | null
}

type UnmatchedTransferDraftItem = {
  id: string
  from_store_id: number
  to_store_id: number | null
  jan_code: string
  product_name: string
  quantity: number
  cost_price: string
  selling_price: string
  entry_type: TransferEntryType
  usage_category: TransferUsageCategory | null
  memo: string
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
    >
      {pending ? '登録中...' : '一括登録する'}
    </button>
  )
}

export function TransferFormModal({
  open,
  stores,
  products,
  onClose,
}: TransferFormModalProps) {
  const [state, formAction] = useActionState(createTransfersAction, initialTransferMutationState)
  const formRef = useRef<HTMLFormElement | null>(null)
  const janInputRef = useRef<HTMLInputElement | null>(null)
  const [scannerNonce, setScannerNonce] = useState(0)
  const [items, setItems] = useState<TransferDraftItem[]>([])
  const [unmatchedItems, setUnmatchedItems] = useState<UnmatchedTransferDraftItem[]>([])
  const [quantity, setQuantity] = useState(1)
  const [memo, setMemo] = useState('')
  const [lookupMessage, setLookupMessage] = useState('')
  const [lookupPending, setLookupPending] = useState(false)
  const [resolvingUnmatchedId, setResolvingUnmatchedId] = useState<string | null>(null)
  const [submitWarning, setSubmitWarning] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<TransferProductOption | null>(null)
  const [manualMode, setManualMode] = useState(false)
  const [manualProductName, setManualProductName] = useState('')
  const [manualCostPrice, setManualCostPrice] = useState('0')
  const [manualSellingPrice, setManualSellingPrice] = useState('0')
  const [entryType, setEntryType] = useState<TransferEntryType>('transfer')
  const [usageCategory, setUsageCategory] = useState<TransferUsageCategory>('expired')
  const [fromStoreId, setFromStoreId] = useState<number | null>(chooseDefaultTransferFromStoreId(stores))
  const [toStoreId, setToStoreId] = useState<number | null>(
    chooseDefaultTransferToStoreId(stores, chooseDefaultTransferFromStoreId(stores))
  )

  const productsByJan = useMemo(
    () => {
      const candidateMap = new Map<string, TransferProductOption>()

      for (const product of products) {
        for (const candidate of buildJanCodeCandidates(product.jan_code ?? '')) {
          const existing = candidateMap.get(candidate)

          if (!existing || (!existing.is_active && product.is_active)) {
            candidateMap.set(candidate, product)
          }
        }
      }

      return candidateMap
    },
    [products]
  )

  const selectedFromStoreId = fromStoreId ?? chooseDefaultTransferFromStoreId(stores)

  const destinationStores = useMemo(
    () => stores.filter((store) => store.id !== selectedFromStoreId),
    [selectedFromStoreId, stores]
  )

  const selectedToStoreId = useMemo(() => {
    if (destinationStores.some((store) => store.id === toStoreId)) {
      return toStoreId
    }

    return chooseDefaultTransferToStoreId(stores, selectedFromStoreId)
  }, [destinationStores, selectedFromStoreId, stores, toStoreId])

  const storeNameById = useMemo(
    () => new Map(stores.map((store) => [store.id, store.name] as const)),
    [stores]
  )

  const summary = useMemo(() => summarizeTransferDraftItems(items), [items])
  const unmatchedQuantityTotal = useMemo(
    () => unmatchedItems.reduce((sum, item) => sum + item.quantity, 0),
    [unmatchedItems]
  )

  useEffect(() => {
    if (state.status === 'success') {
      onClose()
    }
  }, [onClose, state.status])

  if (!open) {
    return null
  }

  function clearProductEntryArea(resetScanner: boolean) {
    setSelectedProduct(null)
    setManualMode(false)
    setManualProductName('')
    setManualCostPrice('0')
    setManualSellingPrice('0')
    setQuantity(1)
    setMemo('')

    if (resetScanner) {
      setScannerNonce((current) => current + 1)
    }
  }

  function resetLookupArea() {
    clearProductEntryArea(true)
    setLookupMessage('')
    setSubmitWarning('')
  }

  function readJanCodeFromForm() {
    if (!formRef.current) {
      return ''
    }

    const formData = new FormData(formRef.current)
    return normalizeJanCode(String(formData.get('jan_code') ?? ''))
  }

  function focusJanInputSoon() {
    window.setTimeout(() => janInputRef.current?.focus(), 0)
  }

  function getTransferContextError() {
    if (!selectedFromStoreId) {
      return '使用店舗 / 移動元店舗を先に選択してください。'
    }

    if (entryType === 'transfer' && !selectedToStoreId) {
      return '店舗間移動では移動先店舗を選択してください。'
    }

    if (entryType === 'transfer' && selectedFromStoreId === selectedToStoreId) {
      return '移動元と移動先に同じ店舗は選べません。'
    }

    if (entryType === 'usage' && !usageCategory) {
      return '物品使用の区分を選択してください。'
    }

    return ''
  }

  function getQuantityError() {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return '数量は1以上で入力してください。'
    }

    return ''
  }

  function buildTransferDraftContext(): TransferDraftContext {
    return {
      from_store_id: selectedFromStoreId as number,
      to_store_id: entryType === 'transfer' ? (selectedToStoreId as number) : null,
      entry_type: entryType,
      usage_category: entryType === 'usage' ? usageCategory : null,
      quantity,
      memo: memo.trim() || null,
    }
  }

  function getCurrentJanQuantity(janCode: string) {
    return (
      items.reduce((sum, item) => sum + (item.jan_code === janCode ? item.quantity : 0), 0) +
      unmatchedItems.reduce((sum, item) => sum + (item.jan_code === janCode ? item.quantity : 0), 0)
    )
  }

  function buildScanFeedbackMessage(janCode: string, quantityAdded: number) {
    const nextJanQuantity = getCurrentJanQuantity(janCode) + quantityAdded
    const nextTotalQuantity = summary.totalQuantity + unmatchedQuantityTotal + quantityAdded

    return `JAN ${janCode} を読み取りました。このJAN累計 ${nextJanQuantity}個 / 総読取累計 ${nextTotalQuantity}個`
  }

  function formatItemStoreSummary(
    fromStoreId: number,
    toStoreId: number | null,
    itemEntryType: TransferEntryType
  ) {
    const fromStoreName = storeNameById.get(fromStoreId) ?? '未設定'

    if (itemEntryType === 'usage') {
      return `使用店舗: ${fromStoreName}`
    }

    const toStoreName = toStoreId ? storeNameById.get(toStoreId) ?? '未設定' : '未設定'
    return `移動: ${fromStoreName} → ${toStoreName}`
  }

  function createTransferDraftItem(
    context: TransferDraftContext,
    janCode: string,
    productName: string,
    costPrice: number,
    sellingPrice: number
  ): TransferDraftItem {
    return {
      from_store_id: context.from_store_id,
      to_store_id: context.to_store_id,
      jan_code: janCode,
      product_name: productName,
      quantity: context.quantity,
      cost_price: costPrice,
      selling_price: sellingPrice,
      entry_type: context.entry_type,
      usage_category: context.usage_category,
      memo: context.memo,
    }
  }

  function handleJanCodeCommit(rawJanCode: string, source: JanCommitSource) {
    const janCode = normalizeJanCode(rawJanCode)
    const resetScanner = source === 'manual'

    setSubmitWarning('')

    if (!isValidJanCode(janCode)) {
      setSelectedProduct(null)
      setManualMode(false)
      setLookupMessage('JANコードは8桁、12桁、13桁のいずれかで入力してください。')
      focusJanInputSoon()
      return 'JANコードは8桁、12桁、13桁のいずれかで入力してください。'
    }

    const contextError = getTransferContextError()

    if (contextError) {
      setLookupMessage(contextError)
      focusJanInputSoon()
      return contextError
    }

    const quantityError = getQuantityError()

    if (quantityError) {
      setLookupMessage(quantityError)
      focusJanInputSoon()
      return quantityError
    }

    const context = buildTransferDraftContext()
    const foundProduct = productsByJan.get(janCode) ?? null
    const itemUsageCategory = context.usage_category

    if (foundProduct) {
      const productName = foundProduct.product_name?.trim() || '商品名未設定'
      const costPrice = Number(foundProduct.cost_price ?? 0)
      const sellingPrice = Number(foundProduct.selling_price ?? 0)
      const feedbackMessage = buildScanFeedbackMessage(janCode, context.quantity)

      setItems((current) => [
        ...current,
        createTransferDraftItem(
          context,
          janCode,
          productName,
          Number.isFinite(costPrice) && costPrice >= 0 ? costPrice : 0,
          Number.isFinite(sellingPrice) && sellingPrice >= 0 ? sellingPrice : 0
        ),
      ])
      clearProductEntryArea(resetScanner)
      setLookupMessage(
        source === 'scanner'
          ? `${feedbackMessage} 商品マスタに一致しました。`
          : `${productName} を登録リストに追加しました。`
      )
      focusJanInputSoon()
      return `${feedbackMessage} 商品マスタに一致しました。`
    }

    setUnmatchedItems((current) => {
      const matchedIndex = current.findIndex(
        (item) =>
          item.jan_code === janCode &&
          item.from_store_id === context.from_store_id &&
          item.to_store_id === context.to_store_id &&
          item.entry_type === context.entry_type &&
          item.usage_category === itemUsageCategory &&
          item.memo === (context.memo ?? '')
      )

      if (matchedIndex >= 0) {
        return current.map((item, index) =>
          index === matchedIndex
            ? {
                ...item,
                quantity: item.quantity + context.quantity,
              }
            : item
        )
      }

      return [
        ...current,
        {
          id: `${janCode}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          from_store_id: context.from_store_id,
          to_store_id: context.to_store_id,
          jan_code: janCode,
          product_name: '',
          quantity: context.quantity,
          cost_price: '0',
          selling_price: '0',
          entry_type: context.entry_type,
          usage_category: itemUsageCategory,
          memo: context.memo ?? '',
        },
      ]
    })
    clearProductEntryArea(resetScanner)
    const feedbackMessage = buildScanFeedbackMessage(janCode, context.quantity)
    setLookupMessage(
      source === 'scanner'
        ? `${feedbackMessage} 商品マスタ未一致のため手入力待ちへ追加しました。`
        : `JAN ${janCode} は商品マスタ未一致です。手入力待ちに追加しました。`
    )
    focusJanInputSoon()
    return `${feedbackMessage} 商品マスタ未一致のため手入力待ちへ追加しました。`
  }

  function handleSearchProduct() {
    const janCode = readJanCodeFromForm()

    if (!isValidJanCode(janCode)) {
      setSelectedProduct(null)
      setManualMode(false)
      setLookupMessage('JAN コードは 8 桁・12 桁・13 桁のいずれかで入力してください。')
      return
    }

    const foundProduct = productsByJan.get(janCode) ?? null

    if (foundProduct) {
      setSelectedProduct(foundProduct)
      setManualMode(false)
      setLookupMessage('商品マスタが見つかりました。数量とメモを確認して追加してください。')
      return
    }

    setSelectedProduct(null)
    setManualMode(true)
    setManualProductName('')
    setManualCostPrice('0')
    setManualSellingPrice('0')
    setLookupMessage('商品マスタに見つからなかったため、手入力で登録リストへ追加できます。')
  }

  function runLookupAction(processingMessage: string, action: () => void) {
    setLookupPending(true)
    setLookupMessage(processingMessage)
    setSubmitWarning('')

    window.setTimeout(() => {
      try {
        action()
      } finally {
        setLookupPending(false)
      }
    }, 0)
  }

  function handleSearchProductAction() {
    runLookupAction('JANコードを検索中です...', handleSearchProduct)
  }

  function handleAddItem() {
    const janCode = readJanCodeFromForm()

    const contextError = getTransferContextError()
    if (contextError) {
      setLookupMessage(contextError)
      return
    }

    if (!isValidJanCode(janCode)) {
      setLookupMessage('JAN コードは 8 桁・12 桁・13 桁のいずれかで入力してください。')
      return
    }

    const quantityError = getQuantityError()
    if (quantityError) {
      setLookupMessage(quantityError)
      return
    }

    const context = buildTransferDraftContext()
    const productName = selectedProduct?.product_name?.trim() || manualProductName.trim()
    const costPrice = Number(selectedProduct?.cost_price ?? manualCostPrice)
    const sellingPrice = Number(selectedProduct?.selling_price ?? manualSellingPrice)

    if (!productName) {
      setLookupMessage('商品名を入力してください。')
      return
    }

    if (!Number.isFinite(costPrice) || costPrice < 0) {
      setLookupMessage('原価は 0 以上で入力してください。')
      return
    }

    if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
      setLookupMessage('売価は 0 以上で入力してください。')
      return
    }

    setItems((current) => [
      ...current,
      createTransferDraftItem(context, janCode, productName, costPrice, sellingPrice),
    ])
    clearProductEntryArea(true)
    setLookupMessage(`${productName} を登録リストに追加しました。`)
  }

  function handleAddItemAction() {
    runLookupAction('商品を登録リストへ追加中です...', handleAddItem)
  }

  function updateItemQuantity(index: number, nextQuantity: number) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              quantity: Math.max(1, nextQuantity),
            }
          : item
      )
    )
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  function updateUnmatchedItem(
    id: string,
    patch: Partial<Omit<UnmatchedTransferDraftItem, 'id' | 'jan_code' | 'entry_type' | 'usage_category'>>
  ) {
    setUnmatchedItems((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
            }
          : item
      )
    )
  }

  function removeUnmatchedItem(id: string) {
    setUnmatchedItems((current) => current.filter((item) => item.id !== id))
    setSubmitWarning('')
  }

  function resolveUnmatchedItem(item: UnmatchedTransferDraftItem) {
    const productName = item.product_name.trim()
    const costPrice = Number(item.cost_price)
    const sellingPrice = Number(item.selling_price)
    const itemQuantity = Math.max(1, Number(item.quantity) || 1)

    if (!productName) {
      setSubmitWarning(`JAN ${item.jan_code} の商品名を入力してください。`)
      return
    }

    if (!Number.isFinite(costPrice) || costPrice < 0) {
      setSubmitWarning(`JAN ${item.jan_code} の原価は0以上で入力してください。`)
      return
    }

    if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
      setSubmitWarning(`JAN ${item.jan_code} の売価は0以上で入力してください。`)
      return
    }

    setItems((current) => [
      ...current,
      {
        from_store_id: item.from_store_id,
        to_store_id: item.to_store_id,
        jan_code: item.jan_code,
        product_name: productName,
        quantity: itemQuantity,
        cost_price: costPrice,
        selling_price: sellingPrice,
        entry_type: item.entry_type,
        usage_category: item.usage_category,
        memo: item.memo.trim() || null,
      },
    ])
    removeUnmatchedItem(item.id)
    setLookupMessage(`${productName} を登録リストに追加しました。`)
  }

  function handleResolveUnmatchedItem(item: UnmatchedTransferDraftItem) {
    setResolvingUnmatchedId(item.id)
    setSubmitWarning('')

    window.setTimeout(() => {
      try {
        resolveUnmatchedItem(item)
      } finally {
        setResolvingUnmatchedId((current) => (current === item.id ? null : current))
      }
    }, 0)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (unmatchedItems.length > 0) {
      event.preventDefault()
      setSubmitWarning('商品マスタ未一致の商品が残っています。手入力を完了して登録リストへ移してください。')
      return
    }

    if (items.length === 0) {
      event.preventDefault()
      setSubmitWarning('登録リストに商品を追加してください。')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-gray-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
              Product Transfers
            </p>
            <h2 className="mt-2 text-2xl font-bold text-gray-900">新規登録</h2>
            <p className="mt-1 text-sm text-gray-500">
              店舗間移動と物品使用を、JAN コードからまとめて登録できます。
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

        <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="space-y-6 px-6 py-6">
          <input type="hidden" name="items_json" value={JSON.stringify(items)} />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700">使用店舗 / 移動元店舗</span>
              <select
                name="from_store_id"
                value={selectedFromStoreId ?? ''}
                onChange={(event) => setFromStoreId(Number(event.target.value) || null)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
              >
                <option value="">選択してください</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
              {state.fieldErrors.from_store_id ? (
                <span className="text-xs text-red-600">{state.fieldErrors.from_store_id}</span>
              ) : null}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700">移動先店舗</span>
              <select
                name="to_store_id"
                value={selectedToStoreId ?? ''}
                onChange={(event) => setToStoreId(Number(event.target.value) || null)}
                disabled={entryType === 'usage'}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition disabled:bg-gray-100 disabled:text-gray-400 focus:border-gray-900"
              >
                <option value="">選択してください</option>
                {destinationStores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
              {entryType === 'usage' ? (
                <span className="text-xs text-gray-500">物品使用では保存に使いません。</span>
              ) : null}
              {state.fieldErrors.to_store_id ? (
                <span className="text-xs text-red-600">{state.fieldErrors.to_store_id}</span>
              ) : null}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700">登録区分</span>
              <select
                value={entryType}
                onChange={(event) => setEntryType(event.target.value as TransferEntryType)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
              >
                {TRANSFER_ENTRY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {state.fieldErrors.entry_type ? (
                <span className="text-xs text-red-600">{state.fieldErrors.entry_type}</span>
              ) : null}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700">物品使用の区分</span>
              <select
                value={usageCategory}
                onChange={(event) => setUsageCategory(event.target.value as TransferUsageCategory)}
                disabled={entryType !== 'usage'}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition disabled:bg-gray-100 disabled:text-gray-400 focus:border-gray-900"
              >
                {TRANSFER_USAGE_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-gray-500">
                {entryType === 'usage'
                  ? '物品使用として登録する場合のみ保存されます。'
                  : '店舗間移動では使用しません。'}
              </span>
              {state.fieldErrors.usage_category ? (
                <span className="text-xs text-red-600">{state.fieldErrors.usage_category}</span>
              ) : null}
            </label>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">商品を追加</h3>
                <p className="text-sm text-gray-500">JAN コードから検索して登録リストに積み上げます。</p>
              </div>
              <button
                type="button"
                onClick={resetLookupArea}
                className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                入力をクリア
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <JanCodeScannerField
                key={scannerNonce}
                continuousScan
                helpText="JANを入力してEnter、またはカメラで読み取ると登録リストへ追加します。未一致の商品は手入力待ちに退避します。"
                inputRef={janInputRef}
                onDetectedCode={(value, source) =>
                  handleJanCodeCommit(value, source === 'photo' ? 'manual' : 'scanner')
                }
                onEnterKey={(value) => handleJanCodeCommit(value, 'manual')}
              />

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSearchProductAction}
                  disabled={lookupPending}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Search className="h-4 w-4" />
                  {lookupPending ? '処理中...' : '検索'}
                </button>
              </div>

              {lookupMessage ? (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                  {lookupMessage}
                </div>
              ) : null}

              {selectedProduct ? (
                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <p className="font-semibold text-gray-900">
                    {selectedProduct.product_name ?? '商品名未設定'}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    JAN: {selectedProduct.jan_code || '-'} / カテゴリ: {selectedProduct.category || '-'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                      {formatTransferEntryTypeLabel(entryType)}
                    </span>
                    {entryType === 'usage' ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                        {formatTransferUsageCategoryLabel(usageCategory)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                        原価
                      </p>
                      <p className="mt-2 text-lg font-bold text-gray-900">
                        {formatYen(selectedProduct.cost_price)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                        売価
                      </p>
                      <p className="mt-2 text-lg font-bold text-gray-900">
                        {formatYen(selectedProduct.selling_price)}
                      </p>
                    </div>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-gray-700">数量</span>
                      <input
                        type="number"
                        min={1}
                        value={quantity}
                        onChange={(event) => setQuantity(Number(event.target.value) || 1)}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                      />
                    </label>
                  </div>
                  <label className="mt-4 block space-y-2">
                    <span className="text-sm font-medium text-gray-700">メモ</span>
                    <input
                      value={memo}
                      onChange={(event) => setMemo(event.target.value)}
                      placeholder="任意"
                      className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                    />
                  </label>
                </div>
              ) : null}

              {manualMode ? (
                <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-4">
                  <div className="mb-4 flex flex-wrap gap-2">
                    <span className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900">
                      {formatTransferEntryTypeLabel(entryType)}
                    </span>
                    {entryType === 'usage' ? (
                      <span className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900">
                        {formatTransferUsageCategoryLabel(usageCategory)}
                      </span>
                    ) : null}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2 md:col-span-2">
                      <span className="text-sm font-medium text-gray-700">商品名</span>
                      <input
                        value={manualProductName}
                        onChange={(event) => setManualProductName(event.target.value)}
                        placeholder="未登録商品の名前"
                        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-gray-700">原価</span>
                      <input
                        type="number"
                        min={0}
                        value={manualCostPrice}
                        onChange={(event) => setManualCostPrice(event.target.value)}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-gray-700">売価</span>
                      <input
                        type="number"
                        min={0}
                        value={manualSellingPrice}
                        onChange={(event) => setManualSellingPrice(event.target.value)}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-gray-700">数量</span>
                      <input
                        type="number"
                        min={1}
                        value={quantity}
                        onChange={(event) => setQuantity(Number(event.target.value) || 1)}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-gray-700">メモ</span>
                      <input
                        value={memo}
                        onChange={(event) => setMemo(event.target.value)}
                        placeholder="任意"
                        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAddItemAction}
                  disabled={lookupPending}
                  className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
                >
                  <PackagePlus className="h-4 w-4" />
                  {lookupPending ? '処理中...' : '登録リストに追加'}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">今回の登録リスト</h3>
                <p className="text-sm text-gray-500">
                  複数商品を積み上げて、店舗間移動と物品使用をまとめて登録できます。
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                    商品数
                  </p>
                  <p className="mt-2 text-xl font-bold text-gray-900">{summary.productCount}</p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                    総数量
                  </p>
                  <p className="mt-2 text-xl font-bold text-gray-900">{summary.totalQuantity}</p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                    原価合計
                  </p>
                  <p className="mt-2 text-xl font-bold text-gray-900">{formatYen(summary.totalCost)}</p>
                </div>
              </div>
            </div>

            {state.fieldErrors.items ? (
              <span className="text-xs text-red-600">{state.fieldErrors.items}</span>
            ) : null}

            {unmatchedItems.length > 0 ? (
              <div className="space-y-3 rounded-3xl border border-amber-200 bg-amber-50 p-4">
                <div>
                  <h4 className="text-base font-semibold text-amber-950">商品マスタ未一致</h4>
                  <p className="mt-1 text-sm text-amber-900">
                    読み取りは止めずに続けられます。登録前に商品名・原価・売価を入力して登録リストへ移してください。
                  </p>
                </div>
                {unmatchedItems.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-amber-200 bg-white p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">JAN: {item.jan_code}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {formatItemStoreSummary(item.from_store_id, item.to_store_id, item.entry_type)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                            {formatTransferEntryTypeLabel(item.entry_type)}
                          </span>
                          {item.usage_category ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                              {formatTransferUsageCategoryLabel(item.usage_category)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeUnmatchedItem(item.id)}
                        className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
                      >
                        <Trash2 className="h-4 w-4" />
                        削除
                      </button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <label className="space-y-2 md:col-span-2">
                        <span className="text-sm font-medium text-gray-700">商品名</span>
                        <input
                          value={item.product_name}
                          onChange={(event) => updateUnmatchedItem(item.id, { product_name: event.target.value })}
                          placeholder="商品名を入力"
                          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-gray-700">数量</span>
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(event) =>
                            updateUnmatchedItem(item.id, {
                              quantity: Math.max(1, Number(event.target.value) || 1),
                            })
                          }
                          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-gray-700">原価</span>
                        <input
                          type="number"
                          min={0}
                          value={item.cost_price}
                          onChange={(event) => updateUnmatchedItem(item.id, { cost_price: event.target.value })}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-gray-700">売価</span>
                        <input
                          type="number"
                          min={0}
                          value={item.selling_price}
                          onChange={(event) => updateUnmatchedItem(item.id, { selling_price: event.target.value })}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                        />
                      </label>
                      <label className="space-y-2 md:col-span-2 xl:col-span-4">
                        <span className="text-sm font-medium text-gray-700">メモ</span>
                        <input
                          value={item.memo}
                          onChange={(event) => updateUnmatchedItem(item.id, { memo: event.target.value })}
                          placeholder="任意"
                          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
                        />
                      </label>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => handleResolveUnmatchedItem(item)}
                          disabled={resolvingUnmatchedId === item.id}
                          className="w-full rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
                        >
                          {resolvingUnmatchedId === item.id ? '処理中...' : '登録リストへ移す'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {items.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                まだ商品が追加されていません。JAN コードを検索して登録リストへ追加してください。
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item, index) => (
                  <div
                    key={`${item.jan_code}-${index}`}
                    className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{item.product_name}</p>
                        <p className="mt-1 text-xs text-gray-500">JAN: {item.jan_code}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {formatItemStoreSummary(item.from_store_id, item.to_store_id, item.entry_type)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                            {formatTransferEntryTypeLabel(item.entry_type)}
                          </span>
                          {item.usage_category ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                              {formatTransferUsageCategoryLabel(item.usage_category)}
                            </span>
                          ) : null}
                        </div>
                        {item.memo ? (
                          <p className="mt-2 text-sm text-gray-600">メモ: {item.memo}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
                          <p className="text-gray-500">原価</p>
                          <p className="mt-1 font-semibold text-gray-900">{formatYen(item.cost_price)}</p>
                        </div>
                        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
                          <p className="text-gray-500">原価合計</p>
                          <p className="mt-1 font-semibold text-gray-900">
                            {formatYen(item.cost_price * item.quantity)}
                          </p>
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-2 py-2">
                          <button
                            type="button"
                            onClick={() => updateItemQuantity(index, item.quantity - 1)}
                            className="rounded-full border border-gray-300 p-2 text-gray-600 transition hover:bg-gray-50"
                            aria-label="数量を減らす"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="min-w-10 text-center text-sm font-semibold text-gray-900">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateItemQuantity(index, item.quantity + 1)}
                            className="rounded-full border border-gray-300 p-2 text-gray-600 transition hover:bg-gray-50"
                            aria-label="数量を増やす"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
                        >
                          <Trash2 className="h-4 w-4" />
                          削除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

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

          {submitWarning ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
              {submitWarning}
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
            <SubmitButton disabled={items.length === 0 && unmatchedItems.length === 0} />
          </div>
        </form>
      </div>
    </div>
  )
}
