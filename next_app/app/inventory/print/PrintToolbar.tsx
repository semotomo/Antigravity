'use client'

import { Printer } from 'lucide-react'

export function PrintToolbar() {
  return (
    <div className="print-toolbar">
      <button type="button" onClick={() => window.print()}>
        <Printer aria-hidden="true" />
        印刷ダイアログを開く
      </button>
      <button type="button" className="secondary" onClick={() => window.close()}>閉じる</button>
    </div>
  )
}
