import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = name => fs.readFileSync(new URL(`../gas/${name}`, import.meta.url), 'utf8')
const privateValue = 'PRIVATE_SOURCE_PRODUCT_COOKIE_EXCEPTION'
const mutationFlags = ['POS_PRODUCT_EDIT_GATEWAY_ENABLED', 'POS_PRODUCT_EDIT_EXECUTION_ENABLED',
  'POS_PRODUCT_CONSUME_ENABLED', 'POS_PRODUCT_MASTER_SYNC_ENABLED', 'POS_PRODUCT_SYNC_FENCE_ENABLED']
const config = () => ({ baseUrl: 'https://cg8.power-k.jp/0D890OGI', tenpoGroupId: '11098',
  tenpoGroupName: 'からつケンネル本店', loginId: 'private-login', password: 'private-password',
  companyCd: 'private-company', companyKey: '' })
const diagnostic = () => ({ success: true, dryRun: true, csvRowCount: 2, syncResult: null,
  original: privateValue, diagnostics: { rawRowCount: 2, skippedRowCount: 0, sample: [privateValue],
    rowShapeSample: [privateValue], storeSummary: [{ storeCode: '11053', storeName: 'からつケンネル本店', rowCount: 2 }],
    columnStats: [3, 7].map(columnIndex => ({ columnIndex, nonEmptyCount: 2, uniqueCount: 2,
      janLikeCount: 2, examples: [privateValue] })), rowWidthCounts: { 12: 2 },
    syncSafety: { duplicateGroups: 0, duplicateExtraRows: 0, identicalRowGroups: 0,
      conflictingRowGroups: 0, mixedKindGroups: 0, missingJanRows: 0, missingNameRows: 0,
      shortRows: 0, invalidMoneyRows: 0, rowsByKind: { 2: 2 }, differingColumns: {}, extra: privateValue,
      duplicateProfile: { groupsByKind: { 1: 0, 2: 0, 3: 0, unknown: 0, mixed: 0 }, groupSizeCounts: {},
        rawIdenticalGroups: 0, normalizedVariantGroups: 0,
        transformAffectedGroups: { whitespace: 0, fullWidthDigits: 0, trailingDotZero: 0 }, extra: privateValue } } } })

function fixture() {
  const props = { POS_PRODUCT_SIGNING_SECRET: 'a'.repeat(64), POS_PRODUCT_CONSUME_SECRET: 'b'.repeat(64),
    POS_PRODUCT_MASTER_SYNC_SECRET: 'c'.repeat(64), SUPABASE_SERVICE_ROLE_KEY: 'private-service-key' }
  const logs = [], calls = [], context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => props[name] ?? null,
      setProperty: () => { throw Error('property writes forbidden') } }) },
    Logger: { log: text => logs.push(text) },
    getPOSConfig_: config,
    downloadProductMasterFromPOS_: (...args) => { calls.push(args); return diagnostic() },
  })
  vm.runInContext(source('posProductReadinessDiagnostic.js'), context)
  const run = () => JSON.parse(JSON.stringify(context.diagnoseHontenProductMasterReadiness()))
  return { props, logs, calls, context, run }
}

function noLeak(f, result, extras = []) {
  const text = JSON.stringify([result, f.logs])
  for (const value of [privateValue, 'private-login', 'private-password', 'private-company',
    'private-service-key', ...Object.values(f.props).filter(v => typeof v === 'string' && v.length === 64), ...extras]) {
    assert.ok(!text.includes(value), `private value leaked: ${value.slice(0, 8)}`)
  }
  assert.equal(f.logs.length, 1)
  assert.ok(f.logs[0].startsWith('KENNEL_POS_MASTER_READINESS '))
}

test('本店の明示設定からdry-runだけを実行し、返却と最終ログは件数だけに限定する', () => {
  const f = fixture(), result = f.run()
  assert.equal(result.success, true)
  assert.equal(result.code, 'READINESS_CSV_INSPECTED')
  assert.deepEqual(result.keyReadiness, { signingSecretValid: true, consumeSecretValid: true,
    masterSyncSecretValid: true, secretsDistinct: true, serviceKeyPresent: true })
  assert.deepEqual(result.storeConsistency, { storeCount: 1, matchingStoreCount: 1, mismatchingStoreCount: 0,
    rowCount: 2, allExpectedStore: true })
  assert.equal(f.calls.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])), [config(), '本店', { dryRun: true }])
  assert.deepEqual(result.csv.rowWidthCounts, { 12: 2 })
  assert.ok(result.csv.columnCounts.every(item => !Object.hasOwn(item, 'examples')))
  noLeak(f, result)
})

test('書込みフラグが有効・曖昧ならPOSへ接続せず、未設定またはfalseだけを許可する', () => {
  for (const name of mutationFlags) for (const value of ['true', 'TRUE', '']) {
    const f = fixture(); f.props[name] = value
    assert.equal(f.run().code, 'READINESS_FLAGS_ACTIVE')
    assert.equal(f.calls.length, 0)
  }
  const f = fixture(); mutationFlags.forEach(name => { f.props[name] = 'false' })
  assert.equal(f.run().success, true)
})

test('専用鍵の欠落・書式不正・使い回し・service鍵欠落を検出し、POSへ接続しない', () => {
  for (const change of [{ POS_PRODUCT_SIGNING_SECRET: null }, { POS_PRODUCT_CONSUME_SECRET: 'B'.repeat(64) },
    { POS_PRODUCT_MASTER_SYNC_SECRET: 'bad' }, { POS_PRODUCT_CONSUME_SECRET: 'a'.repeat(64) },
    { SUPABASE_SERVICE_ROLE_KEY: null }, { SUPABASE_SERVICE_ROLE_KEY: ' ' }]) {
    const f = fixture(); Object.assign(f.props, change)
    const result = f.run()
    assert.equal(result.code, 'READINESS_KEYS_INVALID'); assert.equal(f.calls.length, 0)
    noLeak(f, result)
  }
})

test('既知URLと明示本店11098がない設定は推測せず接続を拒否する', () => {
  for (const change of [null, { baseUrl: 'https://other.test/private' }, { tenpoGroupId: '' },
    { tenpoGroupId: '11099' }, { tenpoGroupId: 11098 }, { tenpoGroupName: '' },
    { tenpoGroupName: 'わんわんペットセンター' }, { loginId: null }, { password: '' },
    { companyCd: null }, { companyKey: null }]) {
    const f = fixture(); f.context.getPOSConfig_ = () => change === null ? null : { ...config(), ...change }
    const result = f.run()
    assert.equal(result.code, 'READINESS_CONFIG_INVALID'); assert.equal(f.calls.length, 0)
    noLeak(f, result)
  }
})

test('CSV取得失敗や秘密を含む例外でも原文を返さず、dry-run応答以外を拒否する', () => {
  for (const action of [() => { throw Error(privateValue) }, () => ({ success: false, message: privateValue }),
    () => ({ ...diagnostic(), dryRun: false }), () => ({ ...diagnostic(), syncResult: { privateValue } })]) {
    const f = fixture(); f.context.downloadProductMasterFromPOS_ = action
    const result = f.run()
    assert.equal(result.success, false); assert.equal(result.code, 'READINESS_CSV_FAILED')
    noLeak(f, result)
  }
})

test('CSV内の他店舗は固定店舗件数だけで示し、準備完了として扱わない', () => {
  const f = fixture(), raw = diagnostic()
  raw.diagnostics.storeSummary[0].storeCode = '11054'
  raw.diagnostics.storeSummary[0].storeName = privateValue
  f.context.downloadProductMasterFromPOS_ = () => raw
  const result = f.run()
  assert.equal(result.success, false); assert.equal(result.code, 'READINESS_STORE_MISMATCH')
  assert.equal(result.storeConsistency.mismatchingStoreCount, 1)
  noLeak(f, result)
})

test('件数に文字列・負値・小数・非有限値・未許可mapキーを混入しても公開しない', () => {
  const changes = [d => { d.rawRowCount = privateValue }, d => { d.skippedRowCount = -1 },
    d => { d.columnStats[0].uniqueCount = 0.5 }, d => { d.columnStats[1].janLikeCount = Infinity },
    d => { d.rowWidthCounts = { 12: NaN } }, d => { d.rowWidthCounts[privateValue] = 1 },
    d => { d.syncSafety.rowsByKind[privateValue] = 1 }, d => { d.syncSafety.duplicateGroups = privateValue },
    d => { d.syncSafety.differingColumns[privateValue] = 0 }, d => { d.storeSummary[0].rowCount = 9007199254740992 },
    d => { d.syncSafety.invalidMoneyRows = 3 }, d => { d.rowWidthCounts = { 12: 1 } }]
  for (const change of changes) {
    const f = fixture(), raw = diagnostic(); change(raw.diagnostics)
    f.context.downloadProductMasterFromPOS_ = () => raw
    const result = f.run()
    assert.equal(result.success, false); assert.equal(result.code, 'READINESS_CSV_INVALID')
    assert.equal(Object.hasOwn(result, 'csv'), false)
    noLeak(f, result)
  }
})

test('実CSV診断の列幅と区分混在の重複を件数で保持し、厳密同期の重複拒否は維持する', () => {
  const f = fixture()
  f.context.Utilities = { parseCsv: text => text.split('\n').map(line => line.split(',')) }
  vm.runInContext(source('importCSV.js'), f.context)
  vm.runInContext(source('posProductSync.js'), f.context)
  vm.runInContext(source('autoDownload.js'), f.context)
  const text = ['11053,からつケンネル本店,2,0490123456789,,フード,非公開商品,,100,1,,50',
    '11053,からつケンネル本店,1,0490123456789,,フード,非公開商品,,200,1,,50,追加列'].join('\n')
  const blob = { getDataAsString: () => text }
  const inspected = f.context.inspectProductMasterCSV_(blob)
  f.context.getPOSConfig_ = config
  f.context.downloadProductMasterFromPOS_ = (_, target, options) => {
    assert.equal(target, '本店'); assert.equal(options.dryRun, true)
    return { success: true, dryRun: true, syncResult: null, csvRowCount: inspected.validRowCount, diagnostics: inspected }
  }
  const result = f.run()
  assert.equal(result.success, true)
  assert.deepEqual(result.csv.rowWidthCounts, { 12: 1, 13: 1 })
  assert.equal(result.csv.syncSafety.duplicateExtraRows, 1)
  assert.equal(result.csv.syncSafety.mixedKindGroups, 1)
  assert.equal(result.csv.syncSafety.conflictingRowGroups, 1)
  noLeak(f, result, ['0490123456789', '非公開商品', '追加列'])
  f.context.applyCoordinatedProductMasterSync_ = () => { throw Error('must not apply invalid CSV') }
  assert.throws(() => f.context.processProductMasterCSV_(blob, '本店',
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', storeId: 7 }), e => e.code === 'PRODUCT_SYNC_INVALID_DATA')
})

test('正規化による集約と元表記一致を区別し、区分と群サイズと各変換を件数だけで返す', () => {
  const f = fixture()
  f.context.Utilities = { parseCsv: text => text.split('\n').map(line => line.split(',')) }
  vm.runInContext(source('importCSV.js'), f.context)
  vm.runInContext(source('autoDownload.js'), f.context)
  const row = (jan, kind = '2', name = 'PRIVATE_SOURCE_PRODUCT_COOKIE_EXCEPTION') =>
    ['11053', 'からつケンネル本店', kind, jan, '', '非公開分類', name, '', '100', '', '', '50'].join(',')
  const text = [row('00123456', '1'), row('00123456', '1', '別名'),
    row('00223456'), row(' ００２２３４５６.０ '), row('00223456.0'),
    row('00323456', '2'), row('00323456', '3'),
    row('０１２３４５６７', 'x'), row('０１２３４５６７', 'x'),
    row('00012345'), row('12345')].join('\n')
  const inspected = f.context.inspectProductMasterCSV_({ getDataAsString: () => text })
  f.context.getPOSConfig_ = config
  f.context.downloadProductMasterFromPOS_ = () => ({ success: true, dryRun: true, syncResult: null,
    csvRowCount: inspected.validRowCount, diagnostics: inspected })
  const result = f.run(), safety = result.csv.syncSafety
  assert.equal(safety.duplicateGroups, 4)
  assert.equal(safety.duplicateExtraRows, 5)
  assert.deepEqual(safety.duplicateProfile, {
    groupsByKind: { 1: 1, 2: 1, 3: 0, unknown: 1, mixed: 1 },
    groupSizeCounts: { 2: 3, 3: 1 }, rawIdenticalGroups: 3, normalizedVariantGroups: 1,
    transformAffectedGroups: { whitespace: 1, fullWidthDigits: 2, trailingDotZero: 1 },
  })
  assert.equal(result.csv.validRowCount, 6)
  assert.equal(f.context.normalizeProductMasterJanCode_('00012345'), '00012345')
  assert.equal(f.context.normalizeProductMasterJanCode_('12345'), '12345')
  assert.equal(f.context.normalizeProductMasterJanCode_('12345.00'), '12345.00')
  assert.equal(f.context.normalizeProductMasterJanCode_('1.23E4'), '1.23E4')
  noLeak(f, result, ['00123456', '00223456', '00323456', '０１２３４５６７', '00012345', '12345', '非公開分類', '別名'])
})

test('duplicateProfileの未許可mapキー・不正数値・群数や余分行数の矛盾は全体拒否する', () => {
  const changes = [p => { p.groupsByKind[privateValue] = 0 }, p => { p.groupSizeCounts[privateValue] = 1 },
    p => { p.transformAffectedGroups[privateValue] = 0 }, p => { p.rawIdenticalGroups = privateValue },
    p => { p.normalizedVariantGroups = -1 }, p => { p.groupsByKind['2'] = 0.5 },
    p => { p.transformAffectedGroups.whitespace = NaN }, p => { p.groupSizeCounts = { 1: 1 } },
    p => { p.groupSizeCounts = { '02': 1 } }, p => { p.groupSizeCounts = { 3: 1 } },
    p => { p.rawIdenticalGroups = 0 }, p => { p.groupsByKind.mixed = 1; p.groupsByKind['2'] = 0 },
    p => { delete p.groupsByKind.unknown }, p => { delete p.transformAffectedGroups.fullWidthDigits },
    p => { p.rawIdenticalGroups = 0; p.normalizedVariantGroups = 1 }]
  for (const change of changes) {
    const f = fixture(), raw = diagnostic(), safety = raw.diagnostics.syncSafety
    raw.csvRowCount = 1; raw.diagnostics.skippedRowCount = 1
    Object.assign(safety, { duplicateGroups: 1, duplicateExtraRows: 1, identicalRowGroups: 1,
      duplicateProfile: { groupsByKind: { 1: 0, 2: 1, 3: 0, unknown: 0, mixed: 0 }, groupSizeCounts: { 2: 1 },
        rawIdenticalGroups: 1, normalizedVariantGroups: 0,
        transformAffectedGroups: { whitespace: 0, fullWidthDigits: 0, trailingDotZero: 0 } } })
    change(safety.duplicateProfile)
    f.context.downloadProductMasterFromPOS_ = () => raw
    const result = f.run()
    assert.equal(result.success, false); assert.equal(result.code, 'READINESS_CSV_INVALID')
    assert.equal(Object.hasOwn(result, 'csv'), false)
    noLeak(f, result)
  }
})
