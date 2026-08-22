import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..')

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

test('連続スキャン中はスマホ画面いっぱいに広げて上部操作を小型化する', () => {
  const form = source('next_app/components/transfers/TransferFormModal.tsx')

  assert.match(form, /h-\[100dvh\] max-h-\[100dvh\]/)
  assert.match(form, /sm:h-\[90vh\] sm:max-h-\[90vh\]/)
  assert.match(form, /読み取り完了/)
  assert.match(form, /aria-label=\{isScannerActive \? '読み取り完了' : '閉じる'\}/)
  assert.doesNotMatch(form, /読み取りを終了する \(完了\)/)
})

test('連続スキャン中はJAN見出しと余白を除き、案内文字を小さくする', () => {
  const form = source('next_app/components/transfers/TransferFormModal.tsx')
  const scanner = source('next_app/components/orders/JanCodeScannerField.tsx')

  assert.match(form, /compactScanner=\{isScannerActive\}/)
  assert.match(form, /label=\{isScannerActive \? '' : 'JANコード'\}/)
  assert.match(scanner, /compactScanner\?: boolean/)
  assert.match(scanner, /compactScanner\s*\?[^:]+text-\[11px\]/s)
  assert.match(scanner, /\{label \? \(/)
})

test('スキャン商品リストは残りの高さを使い、スマホで縦スクロールできる', () => {
  const form = source('next_app/components/transfers/TransferFormModal.tsx')

  assert.match(form, /touch-pan-y/)
  assert.match(form, /overflow-y-auto/)
  assert.match(form, /overscroll-contain/)
  assert.match(form, /flex min-h-0 flex-1 flex-col overflow-hidden/)
  assert.doesNotMatch(form, /h-\[250px\] md:h-\[350px\]/)
})
