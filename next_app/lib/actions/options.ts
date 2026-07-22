'use server'

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type CreateUserResult = {
  success: boolean
  message: string
}

export type UpdateStoreResult = {
  success: boolean
  message: string
}

/**
 * 新規アカウントを作成する (signUpセッションを上書きしないため独立したクライアントを使用)
 */
export async function createUserAction(
  email: string,
  password: string,
  storeType: 'master' | 'wanwan'
): Promise<CreateUserResult> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('SupabaseのURLまたはAnon Keyが設定されていません。')
    }

    // セッションを上書きしないように persistSession: false でクライアントを直接作成
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/login`,
        data: {
          store_type: storeType,
        },
      },
    })

    if (error) {
      console.error('Error creating user:', error)
      return {
        success: false,
        message: `アカウント作成に失敗しました: ${error.message}`,
      }
    }

    return {
      success: true,
      message: `アカウント「${email}」を作成しました。ログインするにはアカウントの認証（メール確認等）が必要な場合があります。`,
    }
  } catch (error: any) {
    console.error('Unexpected error in createUserAction:', error)
    return {
      success: false,
      message: error.message || '予期しないエラーが発生しました。',
    }
  }
}

/**
 * 店舗の POS グループ設定を更新する
 */
export async function updateStoreSettingsAction(
  storeId: number,
  posGroupId: string | null,
  posGroupName: string | null
): Promise<UpdateStoreResult> {
  try {
    const supabase = (await createServerClient()) as any
    
    // 現在ログイン中のユーザーが master（管理者）であることを念のため確認
    const { data: { user } } = await supabase.auth.getUser()
    if (user?.user_metadata?.store_type !== 'master') {
      return {
        success: false,
        message: 'この操作を行う権限がありません。マスター管理者アカウントでログインしてください。',
      }
    }

    const { error } = await supabase
      .from('stores')
      .update({
        pos_group_id: posGroupId || null,
        pos_group_name: posGroupName || null,
      })
      .eq('id', storeId)

    if (error) {
      console.error('Error updating store mapping:', error)
      return {
        success: false,
        message: `店舗設定の更新に失敗しました: ${error.message}`,
      }
    }

    revalidatePath('/sales')
    revalidatePath('/products')
    revalidatePath('/products/transfers')
    
    return {
      success: true,
      message: '店舗設定を更新しました。',
    }
  } catch (error: any) {
    console.error('Unexpected error in updateStoreSettingsAction:', error)
    return {
      success: false,
      message: error.message || '予期しないエラーが発生しました。',
    }
  }
}
