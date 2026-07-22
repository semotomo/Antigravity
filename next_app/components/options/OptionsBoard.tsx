'use client'

import { useState } from 'react'
import { UserPlus, Settings, Save, Shield, KeyRound, Mail, CheckCircle2, AlertCircle, Loader2, Building } from 'lucide-react'
import { createUserAction, updateStoreSettingsAction } from '@/lib/actions/options'

interface StoreOption {
  id: number
  name: string
  pos_group_id: string | null
  pos_group_name: string | null
}

interface OptionsBoardProps {
  initialStores: StoreOption[]
}

export function OptionsBoard({ initialStores }: OptionsBoardProps) {
  // アカウント作成フォームの状態
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [storeType, setStoreType] = useState<'master' | 'wanwan'>('wanwan')
  const [createUserLoading, setCreateUserLoading] = useState(false)
  const [createUserMessage, setCreateUserMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 店舗設定フォームの状態
  const [stores, setStores] = useState<StoreOption[]>(initialStores)
  const [storeLoadingId, setStoreLoadingId] = useState<number | null>(null)
  const [storeMessage, setStoreMessage] = useState<Record<number, { type: 'success' | 'error'; text: string }>>({})

  // アカウント作成処理
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateUserLoading(true)
    setCreateUserMessage(null)

    if (password.length < 6) {
      setCreateUserMessage({
        type: 'error',
        text: 'パスワードは6文字以上で入力してください。',
      })
      setCreateUserLoading(false)
      return
    }

    try {
      const result = await createUserAction(email, password, storeType)
      if (result.success) {
        setCreateUserMessage({ type: 'success', text: result.message })
        setEmail('')
        setPassword('')
      } else {
        setCreateUserMessage({ type: 'error', text: result.message })
      }
    } catch (err: any) {
      setCreateUserMessage({
        type: 'error',
        text: err.message || 'アカウント作成処理中に予期せぬエラーが発生しました。',
      })
    } finally {
      setCreateUserLoading(false)
    }
  }

  // 店舗設定の保存処理
  const handleUpdateStore = async (storeId: number) => {
    const targetStore = stores.find((s) => s.id === storeId)
    if (!targetStore) return

    setStoreLoadingId(storeId)
    // 個別のメッセージをリセット
    setStoreMessage((prev) => ({ ...prev, [storeId]: undefined } as any))

    try {
      const result = await updateStoreSettingsAction(
        storeId,
        targetStore.pos_group_id,
        targetStore.pos_group_name
      )
      if (result.success) {
        setStoreMessage((prev) => ({
          ...prev,
          [storeId]: { type: 'success', text: '設定を更新しました。' },
        }))
      } else {
        setStoreMessage((prev) => ({
          ...prev,
          [storeId]: { type: 'error', text: result.message },
        }))
      }
    } catch (err: any) {
      setStoreMessage((prev) => ({
        ...prev,
        [storeId]: { type: 'error', text: err.message || '更新中にエラーが発生しました。' },
      }))
    } finally {
      setStoreLoadingId(null)
    }
  }

  const handleStoreFieldChange = (storeId: number, field: 'pos_group_id' | 'pos_group_name', value: string) => {
    setStores((prev) =>
      prev.map((s) => (s.id === storeId ? { ...s, [field]: value || null } : s))
    )
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto py-4">
      {/* ヘッダーセクション */}
      <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-gray-900 via-slate-800 to-indigo-700 px-6 py-7 text-white">
          <div className="flex flex-col gap-4">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2.5">
              <Settings className="h-8 w-8 text-indigo-300" />
              システム設定・オプション
            </h1>
            <p className="max-w-2xl text-sm text-indigo-50/90 leading-relaxed">
              店舗ごとのPOSグループID設定や、店舗専用アカウント（「わんわん」など）の新規作成と管理を行います。
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        {/* 左側: 新規アカウント作成 */}
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-6">
          <div className="flex items-center gap-2 border-b border-gray-100 pb-4">
            <UserPlus className="h-5.5 w-5.5 text-indigo-600" />
            <h2 className="text-xl font-bold text-gray-900">アカウント新規作成</h2>
          </div>

          <form onSubmit={handleCreateUser} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <Mail className="h-4 w-4 text-gray-400" />
                メールアドレス *
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@kennel.com"
                className="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <KeyRound className="h-4 w-4 text-gray-400" />
                パスワード (6文字以上) *
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                className="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-gray-400" />
                アカウント権限（店舗）*
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setStoreType('wanwan')}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border transition cursor-pointer ${
                    storeType === 'wanwan'
                      ? 'bg-amber-50 text-amber-800 border-amber-300 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Building className="h-4 w-4 text-amber-500" />
                  わんわん店舗
                </button>
                <button
                  type="button"
                  onClick={() => setStoreType('master')}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border transition cursor-pointer ${
                    storeType === 'master'
                      ? 'bg-indigo-50 text-indigo-800 border-indigo-300 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Shield className="h-4 w-4 text-indigo-500" />
                  マスター管理者
                </button>
              </div>
            </div>

            {createUserMessage && (
              <div
                className={`rounded-2xl border px-4 py-3 text-sm flex items-start gap-2.5 ${
                  createUserMessage.type === 'error'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                }`}
              >
                {createUserMessage.type === 'error' ? (
                  <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                )}
                <span>{createUserMessage.text}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={createUserLoading}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gray-900 py-3 text-sm font-bold text-white transition hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed shadow-md cursor-pointer"
            >
              {createUserLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              アカウントを作成する
            </button>
          </form>
        </section>

        {/* 右側: 店舗別のPOSマッピング設定 */}
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-6">
          <div className="flex items-center gap-2 border-b border-gray-100 pb-4">
            <Building className="h-5.5 w-5.5 text-indigo-600" />
            <h2 className="text-xl font-bold text-gray-900">店舗POSグループマッピング</h2>
          </div>

          <div className="space-y-6 overflow-y-auto max-h-[480px] pr-1">
            {stores.map((store) => (
              <div
                key={store.id}
                className="p-4 rounded-2xl border border-gray-200 bg-gray-50/70 space-y-3.5 relative"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gray-800 text-sm flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-indigo-500" />
                    {store.name}
                  </span>
                  <span className="text-xs text-gray-400 font-medium">店舗ID: {store.id}</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                      POSグループID
                    </label>
                    <input
                      type="text"
                      value={store.pos_group_id || ''}
                      placeholder="未登録"
                      onChange={(e) =>
                        handleStoreFieldChange(store.id, 'pos_group_id', e.target.value)
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-900 outline-none bg-white transition focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                      POSグループ名
                    </label>
                    <input
                      type="text"
                      value={store.pos_group_name || ''}
                      placeholder="未登録"
                      onChange={(e) =>
                        handleStoreFieldChange(store.id, 'pos_group_name', e.target.value)
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-900 outline-none bg-white transition focus:border-indigo-500"
                    />
                  </div>
                </div>

                {storeMessage[store.id] && (
                  <div
                    className={`rounded-xl border px-3 py-1.5 text-[11px] font-medium flex items-center gap-1.5 ${
                      storeMessage[store.id].type === 'error'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {storeMessage[store.id].type === 'error' ? (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    )}
                    <span>{storeMessage[store.id].text}</span>
                  </div>
                )}

                <button
                  type="button"
                  disabled={storeLoadingId !== null}
                  onClick={() => handleUpdateStore(store.id)}
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 rounded-lg bg-indigo-650 hover:bg-indigo-700 px-3.5 py-1.5 text-xs font-bold text-white transition disabled:bg-gray-400 shadow-sm cursor-pointer ml-auto"
                >
                  {storeLoadingId === store.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  設定を保存
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
