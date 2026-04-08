'use client'

import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { BarcodeFormat, BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { DecodeHintType } from '@zxing/library'
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

type BarcodeFormatLike = string | BarcodeFormat | null | undefined

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor
  }
}

function normalizeDetectedJanCode(rawValue: string, format?: BarcodeFormatLike) {
  const digits = rawValue.replace(/\D/g, '')

  if ((format === 'upc_a' || format === BarcodeFormat.UPC_A) && digits.length === 12) {
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

  return ''
}

function isRecoverableDecodeError(error: unknown) {
  const name = error instanceof Error ? error.name : ''
  return (
    name === 'NotFoundException' ||
    name === 'ChecksumException' ||
    name === 'FormatException'
  )
}

function createFallbackReader() {
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
  ])

  return new BrowserMultiFormatReader(hints)
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
  const fallbackControlsRef = useRef<IScannerControls | null>(null)
  const [value, setValue] = useState(defaultValue)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerMessage, setScannerMessage] = useState('')
  const unavailableScannerMessage = scannerOpen ? getUnavailableScannerMessage() : ''

  const stopScanner = useEffectEvent(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (fallbackControlsRef.current) {
      fallbackControlsRef.current.stop()
      fallbackControlsRef.current = null
    }

    detectorRef.current = null

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

    const startNativeScanner = async () => {
      try {
        const Detector = window.BarcodeDetector
        if (!Detector) {
          return false
        }

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
          return true
        }

        streamRef.current = stream

        if (!videoRef.current) {
          stopScanner()
          return true
        }

        videoRef.current.srcObject = stream
        await videoRef.current.play()
        scheduleScan()
        return true
      } catch (cameraError) {
        setScannerMessage(getCameraErrorMessage(cameraError))
        return true
      }
    }

    const startFallbackScanner = async () => {
      try {
        if (!videoRef.current) {
          setScannerMessage('カメラの初期化に失敗しました。JAN コードを手入力してください。')
          return
        }

        const reader = createFallbackReader()
        setScannerMessage(
          'Safari / iPad 向けの互換モードで読取中です。バーコードをカメラに映してください。'
        )

        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: 'environment' },
            },
            audio: false,
          },
          videoRef.current,
          (result, decodeError, activeControls) => {
            if (cancelled) {
              return
            }

            if (result) {
              const detectedCode = normalizeDetectedJanCode(
                result.getText(),
                result.getBarcodeFormat()
              )

              if (detectedCode) {
                activeControls.stop()
                fallbackControlsRef.current = null
                setValue(detectedCode)
                setScannerMessage('JAN コードを読み取りました。')
                setScannerOpen(false)
                return
              }
            }

            if (decodeError && !isRecoverableDecodeError(decodeError)) {
              setScannerMessage(
                'バーコードを読み取れませんでした。明るさや距離を調整して再度お試しください。'
              )
            }
          }
        )

        fallbackControlsRef.current = controls
      } catch (cameraError) {
        setScannerMessage(getCameraErrorMessage(cameraError))
      }
    }

    const startScanner = async () => {
      const startedWithNative = await startNativeScanner()

      if (!startedWithNative && !cancelled) {
        await startFallbackScanner()
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
