'use client'

import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { Camera, ScanLine, X } from 'lucide-react'

type JanCodeScannerFieldProps = {
  defaultValue?: string
  error?: string
}

type DetectedBarcode = {
  rawValue: string
  format?: string
}

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>
}

type BarcodeDetectorConstructor = new (options?: {
  formats?: string[]
}) => BarcodeDetectorLike

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor
  }
}

function normalizeDetectedJanCode(rawValue: string, format?: string) {
  const digits = rawValue.replace(/\D/g, '')

  if (format === 'upc_a' && digits.length === 12) {
    return `0${digits}`
  }

  if (digits.length === 8 || digits.length === 13) {
    return digits
  }

  return null
}

function getCameraErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'カメラへのアクセスが許可されていません。ブラウザの権限設定をご確認ください。'
    }

    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      return '利用できるカメラが見つかりませんでした。JAN コードを手入力してください。'
    }
  }

  return 'カメラを起動できませんでした。JAN コードを手入力してください。'
}

function getUnavailableScannerMessage() {
  if (typeof window === 'undefined') {
    return ''
  }

  if (!window.isSecureContext) {
    return 'カメラ読取は HTTPS または localhost で利用できます。'
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return 'この端末ではカメラが利用できません。JAN コードを手入力してください。'
  }

  if (!window.BarcodeDetector) {
    return 'このブラウザではバーコード読取に未対応です。JAN コードを手入力してください。'
  }

  return ''
}

export function JanCodeScannerField({
  defaultValue = '',
  error,
}: JanCodeScannerFieldProps) {
  const inputId = useId()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const detectorRef = useRef<BarcodeDetectorLike | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const [value, setValue] = useState(defaultValue)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerMessage, setScannerMessage] = useState('')
  const unavailableScannerMessage = scannerOpen ? getUnavailableScannerMessage() : ''

  const stopScanner = useEffectEvent(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.srcObject = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  })

  useEffect(() => {
    return () => {
      stopScanner()
    }
  }, [])

  useEffect(() => {
    if (!scannerOpen) {
      stopScanner()
      return
    }

    if (unavailableScannerMessage) {
      return
    }

    let cancelled = false
    const Detector = window.BarcodeDetector
    if (!Detector) {
      return
    }

    const scheduleScan = () => {
      timeoutRef.current = window.setTimeout(() => {
        void scanFrame()
      }, 350)
    }

    const scanFrame = async () => {
      if (cancelled || !detectorRef.current || !videoRef.current) {
        return
      }

      if (videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        scheduleScan()
        return
      }

      try {
        const barcodes = await detectorRef.current.detect(videoRef.current)
        const detectedCode = barcodes
          .map((barcode) => normalizeDetectedJanCode(barcode.rawValue, barcode.format))
          .find((barcode): barcode is string => Boolean(barcode))

        if (detectedCode) {
          stopScanner()
          setValue(detectedCode)
          setScannerMessage('JAN コードを読み取りました。')
          setScannerOpen(false)
          return
        }
      } catch {
        setScannerMessage('バーコードを読み取れませんでした。カメラ位置を調整して再度お試しください。')
      }

      scheduleScan()
    }

    const startScanner = async () => {
      try {
        detectorRef.current = new Detector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'],
        })
        setScannerMessage('バーコードをカメラに映してください。')

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
          },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream

        if (!videoRef.current) {
          stopScanner()
          return
        }

        videoRef.current.srcObject = stream
        await videoRef.current.play()
        scheduleScan()
      } catch (cameraError) {
        setScannerMessage(getCameraErrorMessage(cameraError))
      }
    }

    void startScanner()

    return () => {
      cancelled = true
      stopScanner()
    }
  }, [scannerOpen, unavailableScannerMessage])

  return (
    <div className="space-y-2 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
          JANコード
        </label>
        <button
          type="button"
          onClick={() => {
            setScannerMessage('')
            setScannerOpen((current) => !current)
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          {scannerOpen ? <X className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
          {scannerOpen ? 'カメラを閉じる' : 'カメラで読取'}
        </button>
      </div>

      <input
        id={inputId}
        name="jan_code"
        inputMode="numeric"
        placeholder="例: 4901234567894"
        value={value}
        onChange={(event) => setValue(event.target.value.replace(/\D/g, ''))}
        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-900"
      />

      {scannerOpen ? (
        <div className="space-y-3 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4">
          <div className="overflow-hidden rounded-2xl bg-gray-950">
            <video
              ref={videoRef}
              className="aspect-video w-full object-cover"
              muted
              playsInline
            />
          </div>
          <div className="flex items-start gap-2 text-sm text-gray-600">
            <ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
            <p>{scannerMessage || unavailableScannerMessage || 'バーコードをカメラに映してください。'}</p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          8桁または13桁の JAN コードを入力できます。スマホのカメラ読取は HTTPS または
          localhost で利用できます。
        </p>
      )}

      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  )
}
