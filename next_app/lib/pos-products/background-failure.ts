// 入力・鍵・元例外を含めず、利用者と運用ログで共有できる固定の診断コード。
export const BACKGROUND_EDIT_FAILURE_CODES = Object.freeze([
  'BG_EDIT_ORIGIN', 'BG_EDIT_BODY', 'BG_EDIT_VALIDATION', 'BG_EDIT_DISABLED', 'BG_EDIT_ACCESS',
  'BG_EDIT_DB_CONFIG', 'BG_EDIT_DB_TRANSPORT', 'BG_EDIT_DB_REJECTED', 'BG_EDIT_RECEIPT',
  'BG_EDIT_INPUT', 'BG_EDIT_STORAGE', 'BG_EDIT_CHECK_REQUEST', 'BG_EDIT_CHECK_RESPONSE',
  'BG_EDIT_ACCEPT_REQUEST', 'BG_EDIT_ACCEPT_RESPONSE', 'BG_EDIT_NO_INTAKE',
] as const)

export type BackgroundEditFailureCode = typeof BACKGROUND_EDIT_FAILURE_CODES[number]

export class BackgroundEditFailure extends Error {
  constructor(readonly code: BackgroundEditFailureCode) {
    super('商品変更の受付を確認できません。入力と操作IDは保持されています。')
    this.name = 'BackgroundEditFailure'
  }
}

export function parseBackgroundEditFailureCode(value: unknown): BackgroundEditFailureCode | null {
  return typeof value === 'string' && BACKGROUND_EDIT_FAILURE_CODES.some(code => code === value)
    ? value as BackgroundEditFailureCode : null
}

export function backgroundEditFailureCode(error: unknown, fallback: BackgroundEditFailureCode): BackgroundEditFailureCode {
  return error instanceof BackgroundEditFailure ? parseBackgroundEditFailureCode(error.code) ?? fallback : fallback
}
