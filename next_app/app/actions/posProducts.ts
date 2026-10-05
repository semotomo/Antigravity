'use server'

import { loadProductEditor, reviewProductEditor, ProductEditorError } from '@/lib/pos-products/editor.server'
import type { ActionResult, ProductEditorData, ProductEditorReviewData } from '@/lib/pos-products/editor'

// 外部通信の例外原文・HTML・認証情報はクライアントや監視ログへ渡さない。
function publicError(error: unknown): string {
  return error instanceof ProductEditorError ? error.message : '商品情報を確認できません。入力を保持して、もう一度お試しください。'
}

export async function loadPosProductEditorAction(input: unknown): Promise<ActionResult<ProductEditorData>> {
  try { return { success: true, data: await loadProductEditor(input) } }
  catch (error) { return { success: false, error: publicError(error) } }
}

export async function reviewPosProductEditorAction(input: unknown): Promise<ActionResult<ProductEditorReviewData>> {
  try { return { success: true, data: await reviewProductEditor(input) } }
  catch (error) { return { success: false, error: publicError(error) } }
}
