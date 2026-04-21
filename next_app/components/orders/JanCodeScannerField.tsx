'use client'

import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from 'react'
import { BarcodeFormat, BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { DecodeHintType } from '@zxing/library'
import { Camera, ImagePlus, ScanLine, X } from 'lucide-react'

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

  if (
    format === 'upc_a' ||
    format === BarcodeFormat.UPC_A ||
    digits.length === 8 ||
    digits.length === 12 ||
    digits.length === 13
  ) {
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

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()

    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('画像の読み込みに失敗しました。'))
    image.src = src
  })
}

function buildPreparedCanvasImageUrl(image: HTMLImageElement, rotationDegrees: number) {
  const maxDimension = 1600
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const isSideways = Math.abs(rotationDegrees) % 180 === 90
  const canvas = document.createElement('canvas')

  canvas.width = isSideways ? height : width
  canvas.height = isSideways ? width : height

  const context = canvas.getContext('2d')

  if (!context) {
    return null
  }

  // iOSの撮影画像は向きが崩れることがあるため、複数方向を試せるようにする。
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate((rotationDegrees * Math.PI) / 180)
  context.drawImage(image, -width / 2, -height / 2, width, height)

  return canvas.toDataURL('image/jpeg', 0.92)
}

async function buildPreparedImageUrls(file: File) {
  const originalUrl = URL.createObjectURL(file)

  try {
    const image = await loadImageElement(originalUrl)
    const preparedTargets = [0, 90, -90, 180]
      .map((rotation) => buildPreparedCanvasImageUrl(image, rotation))
      .filter((target): target is string => Boolean(target))

    return {
      originalUrl,
      decodeTargets: [...preparedTargets, originalUrl],
    }
  } catch {
    return {
      originalUrl,
      decodeTargets: [originalUrl],
    }
  }
}

function isAppleMobileDevice() {
  if (typeof navigator === 'undefined') {
    return false
  }

  const userAgent = navigator.userAgent
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function subscribeToDeviceProfile() {
  return () => {}
}

export function JanCodeScannerField({
  defaultValue = '',
  error,
}: JanCodeScannerFieldProps) {
  const inputId = useId()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const detectorRef = useRef<BarcodeDetectorLike | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const fallbackControlsRef = useRef<IScannerControls | null>(null)
  const [value, setValue] = useState(defaultValue)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerMessage, setScannerMessage] = useState('')
  const shouldUsePhotoScannerOnly = useSyncExternalStore(
    subscribeToDeviceProfile,
    isAppleMobileDevice,
    () => false
  )
  const unavailableScannerMessage = scannerOpen ? getUnavailableScannerMessage() : ''

  function cleanupScannerResources() {
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
  }

  const stopScanner = useEffectEvent(() => {
    cleanupScannerResources()
  })

  useEffect(() => {
    return () => {
      stopScanner()
    }
  }, [])

  async function handlePhotoSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setScannerMessage('写真を解析しています。バーコードがはっきり写っているか確認してください。')

    try {
      const reader = createFallbackReader()
      const { originalUrl, decodeTargets } = await buildPreparedImageUrls(file)
      let detectedCode: string | null = null

      try {
        for (const target of decodeTargets) {
          try {
            const result = await reader.decodeFromImageUrl(target)
            detectedCode = normalizeDetectedJanCode(result.getText(), result.getBarcodeFormat())

            if (detectedCode) {
              break
            }
          } catch {
            continue
          }
        }
      } finally {
        URL.revokeObjectURL(originalUrl)
      }

      if (!detectedCode) {
        setScannerMessage(
          '写真から JAN / UPC コードを判別できませんでした。バーコードだけが大きく写るように再撮影してください。'
        )
        return
      }

      cleanupScannerResources()
      setValue(detectedCode)
      setScannerMessage('写真から JAN / UPC コードを読み取りました。')
      setScannerOpen(false)
    } catch {
      setScannerMessage(
        '写真からバーコードを読み取れませんでした。ピントを合わせて再度撮影してください。'
      )
    } finally {
      event.target.value = ''
    }
  }

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
            width: { ideal: 1920 },
            height: { ideal: 1080 },
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
          'Safari / iPad 向けの互換モードで読取中です。難しい場合は写真から読取をお試しください。'
        )

        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
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
      const startedWithNative = isAppleMobileDevice() ? false : await startNativeScanner()

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
        <div className="flex flex-wrap gap-2">
          {shouldUsePhotoScannerOnly ? null : (
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
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-100"
          >
            <ImagePlus className="h-4 w-4" />
            {shouldUsePhotoScannerOnly ? '写真で撮影して読取' : '写真から読取'}
          </button>
        </div>
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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoSelection}
        className="hidden"
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
          8桁・12桁・13桁の JAN / UPC コードを入力できます。
          {shouldUsePhotoScannerOnly
            ? 'iPad / iPhone では「写真で撮影して読取」を使ってください。'
            : 'スマホのカメラ読取は HTTPS または localhost で利用できます。'}
        </p>
      )}

      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  )
}
