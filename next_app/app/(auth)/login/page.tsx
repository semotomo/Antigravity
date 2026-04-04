import { redirect } from 'next/navigation'
import { LoginSubmitButton } from '@/components/auth/LoginSubmitButton'
import { createClient } from '@/lib/supabase/server'

type LoginSearchParams = {
  error?: string
}

function getTrimmedValue(formData: FormData, key: 'email' | 'password') {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function buildLoginErrorMessage(errorCode?: string) {
  switch (errorCode) {
    case 'invalid_credentials':
      return 'メールアドレスまたはパスワードが間違っています。'
    case 'missing_fields':
      return 'メールアドレスとパスワードを入力してください。'
    case 'auth_failed':
      return 'ログインに失敗しました。時間をおいて再度お試しください。'
    default:
      return null
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<LoginSearchParams>
}) {
  const resolvedSearchParams = await searchParams
  const errorMessage = buildLoginErrorMessage(resolvedSearchParams.error)

  async function loginAction(formData: FormData) {
    'use server'

    const email = getTrimmedValue(formData, 'email')
    const password = getTrimmedValue(formData, 'password')

    if (!email || !password) {
      redirect('/login?error=missing_fields')
    }

    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      console.error('Login error:', error)
      const errorCode =
        error.message === 'Invalid login credentials' ? 'invalid_credentials' : 'auth_failed'
      redirect(`/login?error=${errorCode}`)
    }

    redirect('/sales')
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 py-2">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-8 shadow-md">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Kennel Dashboard
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">Sign in to your account</p>
        </div>

        <form method="POST" action={loginAction} className="mt-8 space-y-6">
          <div className="space-y-4 rounded-md shadow-sm">
            <div>
              <label htmlFor="email-address" className="sr-only">
                Email address
              </label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="relative block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:z-10 focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm"
                placeholder="Email address"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="relative block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:z-10 focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm"
                placeholder="Password"
              />
            </div>
          </div>

          {errorMessage ? <div className="text-sm text-red-500">{errorMessage}</div> : null}

          <div>
            <LoginSubmitButton />
          </div>

          <div className="mt-4 text-center text-xs text-gray-500">
            <p>※開発中のため、テストアカウントでのログインをお願いします。</p>
          </div>
        </form>
      </div>
    </div>
  )
}
