'use client'

import { Download, Printer } from 'lucide-react'

export function PrintToolbar({ csvHref }: { csvHref: string }) {
  return (
    <div className="print-toolbar">
      <button type="button" onClick={() => window.print()}>
        <Printer aria-hidden="true" />
        印刷ダイアログを開く
      </button>
      <a href={csvHref}>
        <Download aria-hidden="true" />
        CSVで出力
      </a>
      <button type="button" className="secondary" onClick={() => window.close()}>閉じる</button>
    </div>
  )
}
