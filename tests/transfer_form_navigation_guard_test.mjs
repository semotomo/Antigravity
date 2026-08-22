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

test('未保存時はスマホ下部タブを含むページリンクの移動を確認する', () => {
  const guard = source('next_app/lib/useUnsavedChangesGuard.ts')
  const form = source('next_app/components/transfers/TransferFormModal.tsx')

  assert.match(form, /useUnsavedChangesGuard\(open && hasDraftChanges\)/)
  assert.match(guard, /event\.target\.closest<HTMLAnchorElement>\('a\[href\]'\)/)
  assert.match(guard, /window\.confirm\(message\)/)
  assert.match(guard, /document\.addEventListener\('click', handleLinkClick, true\)/)
  assert.match(guard, /event\.preventDefault\(\)/)
  assert.match(guard, /event\.stopImmediatePropagation\(\)/)
})

test('再読み込みやタブを閉じる操作でもブラウザの離脱確認を有効にする', () => {
  const guard = source('next_app/lib/useUnsavedChangesGuard.ts')

  assert.match(guard, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(guard, /event\.returnValue = message/)
  assert.match(guard, /window\.removeEventListener\('beforeunload', handleBeforeUnload\)/)
})

test('新規商品は登録リストの先頭に追加する', () => {
  const form = source('next_app/components/transfers/TransferFormModal.tsx')

  assert.doesNotMatch(form, /return \[\s*\.\.\.current,\s*(?:createTransferDraftItem|\{)/)
  assert.doesNotMatch(
    form,
    /setItems\(\(current\) => \[\s*\.\.\.current,\s*createTransferDraftItem/,
  )

  const prependCount = (form.match(/\.\.\.current,\s*\]/g) || []).length
  assert.ok(prependCount >= 5, `先頭追加の実装数が不足しています: ${prependCount}`)
})
