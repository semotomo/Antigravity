'use client'

import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from '@zxing/library'
import { X, Camera, RefreshCw, AlertTriangle } from 'lucide-react'

interface BarcodeScannerModalProps {
  isOpen: boolean
  onClose: () => void
  onScanSuccess: (barcode: string) => void
}

export function BarcodeScannerModal({ isOpen, onClose, onScanSuccess }: BarcodeScannerModalProps) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [isScanning, setIsScanning] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null)

  useEffect(() => {
    if (!isOpen) {
      stopScanning()
      return
    }

    startScanning()

    return () => {
      stopScanning()
    }
  }, [isOpen])

  const startScanning = async () => {
    setErrorMsg('')
    setHasPermission(null)

    try {
      // 1. カメラパーミッション確認
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      setHasPermission(true)
      // 一時的なストリームは即座に停止（ZXingが内部で再取得するため）
      stream.getTracks().forEach((track) => track.stop())

      // 2. ZXing Readerの初期化
      const hints = new Map()
      const formats = [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
      ]
      hints.set(DecodeHintType.POSSIBLE_FORMATS, formats)

      const reader = new BrowserMultiFormatReader(hints)
      codeReaderRef.current = reader
      setIsScanning(true)

      // 3. 背面カメラ優先でのスキャン開始
      await reader.decodeFromVideoDevice(
        null, // デフォルトで背面カメラを選択（環境優先）
        videoRef.current,
        (result, err) => {
          if (result) {
            // スキャン成功
            const scannedText = result.getText()
            if (scannedText) {
              // 読み取り成功音（簡易ビープ）
              playBeep()
              onScanSuccess(scannedText)
              stopScanning()
              onClose()
            }
          }
          if (err && !(err.name === 'NotFoundException')) {
            console.warn('ZXing scan error:', err)
          }
        }
      )
    } catch (err: any) {
      console.error('Barcode scanner initialization failed:', err)
      setHasPermission(false)
      if (err.name === 'NotAllowedError') {
        setErrorMsg('カメラへのアクセスが拒否されました。設定からカメラの使用を許可してください。')
      } else if (err.name === 'NotFoundError') {
        setErrorMsg('有効なカメラが見つかりません。')
      } else {
        setErrorMsg('カメラの起動に失敗しました。時間をおいて再度お試しください。')
      }
    }
  }

  const stopScanning = () => {
    if (codeReaderRef.current) {
      try {
        codeReaderRef.current.reset()
      } catch (e) {
        console.error('Error resetting ZXing reader:', e)
      }
      codeReaderRef.current = null
    }
    setIsScanning(false)
  }

  // 読み取り成功音の再生（Web Audio API）
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const oscillator = audioCtx.createOscillator()
      const gainNode = audioCtx.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(audioCtx.destination)

      oscillator.type = 'sine'
      oscillator.frequency.value = 1000 // 1000Hz (ピッ)
      gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime)

      oscillator.start()
      oscillator.stop(audioCtx.currentTime + 0.1) // 0.1秒再生
    } catch (e) {
      console.warn('Web Audio API not supported or blocked:', e)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl transition-all">
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-indigo-600 animate-pulse" />
            <h3 className="text-base font-bold text-gray-900">JANコードスキャン</h3>
          </div>
          <button
            onClick={() => {
              stopScanning()
              onClose()
            }}
            className="rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-6">
          <p className="text-xs text-gray-500 mb-4 text-center">
            枠内に商品のバーコード（JANコード）を収めてください。自動的に認識してスキャンします。
          </p>

          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black">
            {/* ビデオストリーム */}
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              playsInline
              muted
            />

            {/* スキャンエフェクト (レーザー線) */}
            {isScanning && hasPermission && (
              <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-8">
                {/* 四隅のターゲットフレーム */}
                <div className="absolute inset-x-8 inset-y-6 border border-white/20 rounded-xl">
                  {/* アニメーションレーザー */}
                  <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-red-500 shadow-[0_0_8px_#ef4444] animate-bounce" />
                </div>
              </div>
            )}

            {/* ロード中・パーミッション待ち */}
            {hasPermission === null && !errorMsg && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900 text-white">
                <RefreshCw className="h-8 w-8 animate-spin text-indigo-400" />
                <span className="text-sm font-medium">カメラを準備中...</span>
              </div>
            )}

            {/* エラー表示 */}
            {errorMsg && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-gray-900 text-white gap-3">
                <AlertTriangle className="h-10 w-10 text-amber-500 animate-bounce" />
                <p className="text-xs font-semibold px-4 text-gray-200 leading-relaxed">{errorMsg}</p>
                <button
                  onClick={startScanning}
                  className="mt-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-gray-900 transition hover:bg-gray-100"
                >
                  再試行する
                </button>
              </div>
            )}
          </div>
        </div>

        {/* フッター */}
        <div className="border-t border-gray-100 bg-gray-50 px-6 py-4 flex justify-end">
          <button
            onClick={() => {
              stopScanning()
              onClose()
            }}
            className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
