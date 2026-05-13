'use client'

import { useState, useRef, useTransition } from 'react'
import { UploadCloud, X, Loader2 } from 'lucide-react'
import { uploadProductMasterCsv } from '@/app/actions/products'

export function CsvUploadModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setError(null)
    setSuccess(null)

    try {
      const buffer = await file.arrayBuffer()
      const decoder = new TextDecoder('shift_jis')
      const csvString = decoder.decode(buffer)

      const formData = new FormData()
      formData.append('csvContent', csvString)
      formData.append('fileName', file.name)

      startTransition(async () => {
        const result = await uploadProductMasterCsv(formData)
        if (result.success) {
          setSuccess(result.message)
          if (fileInputRef.current) fileInputRef.current.value = ''
        } else {
          setError(result.message)
        }
      })
    } catch (err) {
      console.error(err)
      setError('ファイルの読み込みに失敗しました。')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <h2 className="text-xl font-bold text-gray-900">CSV手動アップロード</h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
            disabled={isPending}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 space-y-6">
          <p className="text-sm text-gray-600">
            POSポータルからダウンロードした「全店舗用の商品マスタCSV」を選択してください。<br/>
            ファイルは自動的にUTF-8に変換され、データベースと同期（UPSERT）されます。
          </p>

          <label
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 transition ${
              isPending
                ? 'border-gray-200 bg-gray-50'
                : 'border-sky-300 bg-sky-50 hover:bg-sky-100 hover:border-sky-400'
            }`}
          >
            {isPending ? (
              <Loader2 className="mb-3 h-8 w-8 animate-spin text-gray-400" />
            ) : (
              <UploadCloud className="mb-3 h-8 w-8 text-sky-500" />
            )}
            <span className="text-sm font-medium text-gray-700">
              {isPending ? 'アップロード処理中...' : 'ここをクリックしてCSVを選択'}
            </span>
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
              disabled={isPending}
              ref={fileInputRef}
            />
          </label>

          {error && (
            <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 border border-red-200">
              <p className="font-semibold">エラー</p>
              <p className="mt-1">{error}</p>
            </div>
          )}

          {success && (
            <div className="rounded-xl bg-green-50 p-4 text-sm text-green-700 border border-green-200">
              <p className="font-semibold">完了</p>
              <p className="mt-1 whitespace-pre-wrap">{success}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
