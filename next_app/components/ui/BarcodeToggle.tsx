'use client'

import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'

type BarcodeToggleProps = {
  janCode: string | null | undefined
}

export function BarcodeToggle({ janCode }: BarcodeToggleProps) {
  const [showBarcode, setShowBarcode] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const [error, setError] = useState(false)

  const value = janCode?.trim() || ''

  useEffect(() => {
    if (showBarcode && svgRef.current && value) {
      try {
        // JANコードは通常13桁または8桁の数値
        const isNumeric = /^\d+$/.test(value)
        let format = 'CODE128' // フォールバック

        if (isNumeric) {
          if (value.length === 13) {
            format = 'EAN13'
          } else if (value.length === 8) {
            format = 'EAN8'
          }
        }

        JsBarcode(svgRef.current, value, {
          format: format,
          width: 1.5,
          height: 45,
          displayValue: true,
          fontSize: 11,
          font: 'monospace',
          margin: 4,
          background: '#ffffff',
          lineColor: '#000000',
        })
        setError(false)
      } catch (err) {
        console.error('バーコード生成エラー:', err)
        setError(true)
        setShowBarcode(false)
      }
    }
  }, [showBarcode, value])

  if (!value) {
    return <span className="text-gray-400">-</span>
  }

  if (showBarcode && !error) {
    return (
      <div
        onClick={() => setShowBarcode(false)}
        className="inline-block cursor-pointer bg-white p-1 rounded-lg border border-gray-200 shadow-sm hover:border-gray-300 transition duration-200"
        title="クリックしてJANテキストに戻す"
      >
        <svg ref={svgRef} className="max-w-full block" />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setShowBarcode(true)}
      className="font-mono text-sky-600 hover:text-sky-800 hover:underline cursor-pointer focus:outline-none select-all text-sm font-semibold transition"
      title="クリックしてバーコードを表示"
    >
      {value}
    </button>
  )
}
