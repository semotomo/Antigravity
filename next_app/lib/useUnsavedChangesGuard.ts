'use client'

import { useEffect } from 'react'

const DEFAULT_MESSAGE =
  '入力途中の商品があります。ページを移動すると内容が失われます。移動しますか？'

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
 */
export function useUnsavedChangesGuard(enabled: boolean, message = DEFAULT_MESSAGE) {
  useEffect(() => {
    if (!enabled) {
      return
    }

    let allowConfirmedUnload = false

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowConfirmedUnload) {
        return
      }

      event.preventDefault()
      event.returnValue = message
    }

    const handleLinkClick = (event: MouseEvent) => {
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

      if (window.confirm(message)) {
        // 外部リンクなどがフルページ遇移する場合の二重警告を防ぐ
        allowConfirmedUnload = true
        window.setTimeout(() => {
          allowConfirmedUnload = false
        }, 0)
        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleLinkClick, true)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleLinkClick, true)
    }
  }, [enabled, message])
}
