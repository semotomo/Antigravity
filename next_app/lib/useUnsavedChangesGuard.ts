'use client'

import { useEffect, useRef } from 'react'

const DEFAULT_MESSAGE =
  '入力途中の商品があります。ページを移動すると内容が失われます。移動しますか？'
const HISTORY_GUARD_KEY = '__kennelUnsavedChangesGuard'

function getHistoryGuardId(state: unknown) {
  if (typeof state !== 'object' || state === null) {
    return null
  }

  const guardId = (state as Record<string, unknown>)[HISTORY_GUARD_KEY]
  return typeof guardId === 'string' ? guardId : null
}

function createGuardHistoryState(state: unknown, guardId: string) {
  const currentState = typeof state === 'object' && state !== null ? state : {}

  return {
    ...currentState,
    [HISTORY_GUARD_KEY]: guardId,
  }
}

function isNavigationLink(anchor: HTMLAnchorElement) {
  const href = anchor.getAttribute('href')

  if (!href || href.startsWith('#') || anchor.hasAttribute('download')) {
    return false
  }

  // 新規タブは現在の入力内容を失わないため警告対象外
  if (anchor.target && anchor.target !== '_self') {
    return false
  }

  try {
    return new URL(anchor.href, window.location.href).href !== window.location.href
  } catch {
    return true
  }
}

/**
 * フォームに未保存の入力がある間、ページ内リンクとブラウザ離脱を確認する。
 * Next.js Linkのクリックより先にcaptureフェーズで判定するため、
 * スマホ下部ナビなどモーダル外のリンクにも適用できる。
 * 同一URLの履歴保護を挟み、ブラウザ・端末の戻る操作も確認対象にする。
 */
export function useUnsavedChangesGuard(enabled: boolean, message = DEFAULT_MESSAGE) {
  const cleanupTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      return
    }

    // React Strict Modeの再実行時は、直前の保護履歴をそのまま再利用する
    if (cleanupTimerRef.current !== null) {
      window.clearTimeout(cleanupTimerRef.current)
      cleanupTimerRef.current = null
    }

    const existingGuardId = getHistoryGuardId(window.history.state)
    const guardId =
      existingGuardId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

    if (!existingGuardId) {
      window.history.pushState(
        createGuardHistoryState(window.history.state, guardId),
        '',
        window.location.href,
      )
    }

    let allowConfirmedUnload = false
    let listenersRemoved = false
    let restoringGuardEntry = false
    let removingGuardForLink = false
    let pendingNavigationHref: string | null = null

    const isCurrentGuardEntry = () => getHistoryGuardId(window.history.state) === guardId

    const removeEventListeners = () => {
      if (listenersRemoved) {
        return
      }

      listenersRemoved = true
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('popstate', handlePopState)
      document.removeEventListener('click', handleLinkClick, true)
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (allowConfirmedUnload) {
        return
      }

      event.preventDefault()
      event.returnValue = message
    }

    function handlePopState() {
      if (removingGuardForLink) {
        removingGuardForLink = false
        const navigationHref = pendingNavigationHref
        pendingNavigationHref = null

        if (navigationHref) {
          removeEventListeners()
          window.location.assign(navigationHref)
        }
        return
      }

      if (restoringGuardEntry) {
        restoringGuardEntry = false
        return
      }

      if (window.confirm(message)) {
        // 保護履歴から一度戻った状態なので、もう一度戻ると本来の前画面へ進む
        allowConfirmedUnload = true
        removeEventListeners()
        window.history.back()
        return
      }

      // キャンセル時は同一URLの保護履歴へ進み直し、フォームを維持する
      restoringGuardEntry = true
      window.history.forward()
    }

    function handleLinkClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return
      }

      const anchor = event.target.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || !isNavigationLink(anchor)) {
        return
      }

      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      // Next.jsの遷移を一旦止め、保護履歴を除去してから目的URLへ移動する
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      allowConfirmedUnload = true
      pendingNavigationHref = anchor.href

      if (isCurrentGuardEntry()) {
        removingGuardForLink = true
        window.history.back()
        return
      }

      const navigationHref = pendingNavigationHref
      pendingNavigationHref = null
      removeEventListeners()
      window.location.assign(navigationHref)
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('popstate', handlePopState)
    document.addEventListener('click', handleLinkClick, true)

    return () => {
      removeEventListeners()

      // 通常の保存・閉じる操作では、同じ画面が戻る履歴に二重で残らないようにする
      cleanupTimerRef.current = window.setTimeout(() => {
        cleanupTimerRef.current = null
        if (isCurrentGuardEntry()) {
          window.history.back()
        }
      }, 0)
    }
  }, [enabled, message])
}
