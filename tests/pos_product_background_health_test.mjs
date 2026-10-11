import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const HEALTH = 'POS_PRODUCT_BACKGROUND_WORKER_HEALTH'
const ENABLED = 'POS_PRODUCT_BACKGROUND_EDIT_ENABLED'
const RESERVATION_MS = 6 * 60_000
const BUDGET_MS = 45 * 60_000
const HORIZON_MS = 24 * 60 * 60_000 + RESERVATION_MS
const START = Date.UTC(2026, 9, 12, 23, 59, 30)
const SECRET = 'synthetic-private-pos-password'
const plain = value => JSON.parse(JSON.stringify(value))
const stateText = (runs = [], last = null) => JSON.stringify({ version: 1, runs, last })
const running = startedAt => ({ startedAt, completedAt: null, durationMs: null, code: 'RUNNING', processed: false })
const finished = (startedAt, code = 'EMPTY', processed = false, durationMs = 10) =>
  ({ startedAt, completedAt: startedAt + durationMs, durationMs, code, processed })
const sources = ['gas/posProductBackgroundWorker.js', 'gas/posProductBackgroundHealth.js']
  .map(path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')).join('\n')

function setup(options = {}) {
  const properties = new Map([[ENABLED, 'true'], ...Object.entries(options.properties ?? {})])
  if (Object.hasOwn(options, 'health')) properties.set(HEALTH, options.health)
  const writes = [], logs = [], events = []
  let now = options.now ?? START, locked = false, jobs = 0, releases = 0
  const port = {
    getProperty: key => properties.get(key) ?? null,
    setProperty: (key, value) => {
      writes.push({ key, value, locked })
      events.push('write')
      properties.set(key, value)
    },
  }
  const context = vm.createContext({
    Date: { now: () => now },
    PropertiesService: { getScriptProperties: () => port },
    Logger: { log: value => { logs.push(String(value)); events.push('log') } },
    LockService: { getScriptLock: () => ({
      tryLock: timeout => {
        assert.equal(timeout, 1)
        events.push('lock')
        if (options.busy) return false
        assert.equal(locked, false)
        locked = true
        return true
      },
      releaseLock: () => { assert.equal(locked, true); locked = false; releases++; events.push('release') },
    }) },
    // 外部通信が紛れた場合は、テストを即座に失敗させる。
    UrlFetchApp: { fetch: () => assert.fail('health test attempted external communication') },
  })
  vm.runInContext(sources, context)
  const fixture = { context, port, properties, writes, logs, events,
    advance: ms => { now += ms }, setNow: value => { now = value },
    read: () => plain(context.readPosProductBackgroundHealth_(port, now)),
    saved: () => JSON.parse(properties.get(HEALTH)),
    run: (scheduled = false) => plain(scheduled ? context.runScheduledPosProductBackgroundWorker() : context.runPosProductBackgroundWorker()),
    get now() { return now }, get jobs() { return jobs }, get releases() { return releases }, get locked() { return locked },
  }
  context.executePosProductBackgroundJob_ = () => {
    jobs++; events.push('job')
    assert.equal(locked, true)
    return options.job ? options.job(fixture) : { processed: false, code: 'EMPTY' }
  }
  return fixture
}

test('OFFとBUSYではjob・heartbeat書込み・ログを開始しない', () => {
  for (const options of [{ properties: { [ENABLED]: null } }, { properties: { [ENABLED]: 'false' } }, { busy: true }]) {
    const f = setup(options)
    assert.deepEqual(f.run(), { processed: false, code: options.busy ? 'BUSY' : 'DISABLED' })
    assert.equal(f.jobs, 0); assert.equal(f.writes.length, 0); assert.equal(f.logs.length, 0); assert.equal(f.releases, 0)
    assert.equal(f.properties.has(HEALTH), false)
  }
})

test('lock取得後に6分を予約してjobを開始し、終了時に実時間へ精算する', () => {
  const f = setup({ job: current => {
    assert.deepEqual(current.saved(), { version: 1, runs: [[START, RESERVATION_MS]], last: running(START) })
    assert.deepEqual(current.events, ['lock', 'write', 'job'])
    current.advance(12_345)
    return { processed: true, code: 'COMPLETED' }
  } })
  assert.deepEqual(f.run(), { processed: true, code: 'COMPLETED' })
  assert.deepEqual(f.saved(), { version: 1, runs: [[START, 12_345]], last: finished(START, 'COMPLETED', true, 12_345) })
  assert.ok(f.writes.every(write => write.locked)); assert.equal(f.releases, 1); assert.equal(f.locked, false)
  assert.equal(f.logs.length, 1)
  assert.deepEqual(JSON.parse(f.logs[0].slice('KENNEL_POS_BACKGROUND_HEALTH '.length)), f.saved().last)
})

test('強制終了で精算できなかった6分予約を次のVMでも保持する', () => {
  const f = setup(), reservation = f.context.beginPosProductBackgroundHealth_(f.port, START)
  assert.equal(reservation.paused, false)
  const raw = f.properties.get(HEALTH)
  const next = setup({ now: START + RESERVATION_MS + 1, health: raw })
  assert.deepEqual(next.read(), { version: 1, runs: [[START, RESERVATION_MS]], last: running(START) })
  assert.equal(next.writes.length, 0); assert.equal(next.logs.length, 0); assert.equal(next.jobs, 0)
})

test('終了時計の逆行・6分超過は予約を消さずlockを解放する', () => {
  for (const elapsed of [-1, RESERVATION_MS + 1]) {
    const f = setup({ job: current => { current.advance(elapsed); return { processed: true, code: 'COMPLETED' } } })
    assert.throws(() => f.run(), /POS_PRODUCT_BACKGROUND_HEALTH_INVALID/)
    assert.deepEqual(f.saved(), { version: 1, runs: [[START, RESERVATION_MS]], last: running(START) })
    assert.equal(f.logs.length, 0); assert.equal(f.releases, 1)
  }
})

test('日付を跨いでも履歴をリセットせず、24時間と6分の境界まで保守的に保持する', () => {
  const f = setup({ now: START + 60_000, health: stateText([[START, 60_000]]) })
  assert.deepEqual(f.read().runs, [[START, 60_000]])
  f.setNow(START + HORIZON_MS - 1)
  assert.deepEqual(f.read().runs, [[START, 60_000]])
  f.setNow(START + HORIZON_MS)
  assert.deepEqual(f.read().runs, [])
  assert.equal(f.writes.length, 0)
})

test('45分予算から次の6分を予約できる境界だけjobを開始する', () => {
  for (const excess of [0, 1]) {
    const runs = Array.from({ length: 6 }, (_, index) => [START - 60_000 * (index + 1), RESERVATION_MS])
    runs.push([START - 600_000, 3 * 60_000 + excess])
    const f = setup({ health: stateText(runs), job: current => { current.advance(100); return { processed: false, code: 'EMPTY' } } })
    assert.equal(f.run().code, excess ? 'BUDGET_PAUSED' : 'EMPTY')
    assert.equal(f.jobs, excess ? 0 : 1)
    assert.equal(f.saved().runs.reduce((sum, run) => sum + run[1], 0), 39 * 60_000 + excess + (excess ? 0 : 100))
    assert.equal(f.saved().last.code, excess ? 'BUDGET_PAUSED' : 'EMPTY')
    assert.equal(f.releases, 1)
  }
})

test('未精算予約も45分予算へ加算し、超過時にjobを始めない', () => {
  const runs = Array.from({ length: 8 }, (_, index) => [START - (index + 1) * 60_000, RESERVATION_MS])
  const f = setup({ health: stateText(runs, running(START - 60_000)) })
  assert.deepEqual(f.run(), { processed: false, code: 'BUDGET_PAUSED' })
  assert.deepEqual(f.saved().runs, runs); assert.equal(f.jobs, 0); assert.equal(f.releases, 1)
  assert.equal(f.saved().runs.reduce((sum, run) => sum + run[1], 0), 48 * 60_000)
})

test('履歴300件では新しい予約を作らずbudget pauseを記録する', () => {
  const runs = Array.from({ length: 300 }, (_, index) => [START - index - 1, 0])
  const f = setup({ health: stateText(runs) })
  assert.equal(f.run().code, 'BUDGET_PAUSED')
  assert.deepEqual(f.saved().runs, runs); assert.equal(f.jobs, 0); assert.equal(f.releases, 1)
})

test('破損・未来時刻・過大なhealthはjob開始前に拒否し初期化しない', () => {
  const badLast = finished(START - 100)
  const invalid = [
    '', '{', 'null', '[]', 'true', '{}', ' '.repeat(8001), 123,
    JSON.stringify({ version: 2, runs: [], last: null }),
    JSON.stringify({ version: 1, runs: [], last: null, password: SECRET }),
    stateText({}), stateText(Array.from({ length: 301 }, () => [START, 0])),
    ...[[START], [START, 0, 0], ['0', 0], [-1, 0], [START + 1, 0], [START + 0.5, 0],
      [START, -1], [START, RESERVATION_MS + 1], [START, 0.5], [START, '1']].map(run => stateText([run])),
    ...[{ ...badLast, startedAt: START + 1 }, { ...badLast, completedAt: START + 1 },
      { ...badLast, completedAt: badLast.startedAt - 1 }, { ...badLast, durationMs: 9 },
      { ...badLast, processed: SECRET }, { ...badLast, code: SECRET }, { ...badLast, password: SECRET },
      { ...running(START), durationMs: 0 }, { ...running(START), completedAt: START },
      { ...badLast, completedAt: null }, { ...badLast, durationMs: null }].map(last => stateText([], last)),
  ]
  for (const health of invalid) {
    const f = setup({ health })
    assert.throws(() => f.run(), /(?:POS_PRODUCT_BACKGROUND_HEALTH_INVALID|INVALID_WORKER_RECORD)/)
    assert.equal(f.jobs, 0); assert.equal(f.writes.length, 0); assert.equal(f.logs.length, 0)
    assert.equal(f.properties.get(HEALTH), health); assert.equal(f.releases, 1)
  }
  for (const now of [-1, START + 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const f = setup({ now })
    assert.throws(() => f.run(), /POS_PRODUCT_BACKGROUND_HEALTH_INVALID/)
    assert.equal(f.jobs, 0); assert.equal(f.writes.length, 0); assert.equal(f.logs.length, 0); assert.equal(f.releases, 1)
  }
})

test('差し替え済みと古い予約は後続実行の記録を上書きしない', () => {
  const f = setup(), first = f.context.beginPosProductBackgroundHealth_(f.port, START)
  f.advance(1)
  f.context.beginPosProductBackgroundHealth_(f.port, f.now)
  const latest = f.properties.get(HEALTH), writes = f.writes.length
  assert.throws(() => f.context.finishPosProductBackgroundHealth_(f.port, first, { processed: false, code: 'EMPTY' }, f.now), /POS_PRODUCT_BACKGROUND_HEALTH_INVALID/)
  assert.equal(f.properties.get(HEALTH), latest); assert.equal(f.writes.length, writes); assert.equal(f.logs.length, 0)

  const replaced = setup(), reservation = replaced.context.beginPosProductBackgroundHealth_(replaced.port, START)
  replaced.properties.set(HEALTH, stateText([], finished(START - 100)))
  const replacement = replaced.properties.get(HEALTH)
  assert.throws(() => replaced.context.finishPosProductBackgroundHealth_(replaced.port, reservation, { processed: false, code: 'EMPTY' }, START), /POS_PRODUCT_BACKGROUND_HEALTH_INVALID/)
  assert.equal(replaced.properties.get(HEALTH), replacement); assert.equal(replaced.writes.length, 1); assert.equal(replaced.logs.length, 0)
})

test('不正な結果codeとprocessedは記録せず6分予約を残す', () => {
  for (const result of [{ processed: true, code: SECRET }, { processed: SECRET, code: 'COMPLETED' },
    { processed: 1, code: 'EMPTY' }, { processed: false }, { code: 'EMPTY' }, { processed: false, code: 'RUNNING' }]) {
    const f = setup({ job: () => result })
    assert.throws(() => f.run(), /(?:POS_PRODUCT_BACKGROUND_HEALTH_INVALID|INVALID_WORKER_RECORD)/)
    assert.deepEqual(f.saved(), { version: 1, runs: [[START, RESERVATION_MS]], last: running(START) })
    assert.equal(f.logs.length, 0); assert.equal(f.releases, 1)
    assert.doesNotMatch(f.properties.get(HEALTH), /synthetic-private/)
  }
})

test('商品本文・鍵・未知フィールドを持つsummaryはLoggerへ渡さない', () => {
  const valid = finished(START - 100)
  for (const last of [{ ...valid, code: SECRET }, { ...valid, password: SECRET }, { ...valid, janCode: SECRET },
    { ...valid, operationId: SECRET }, { ...valid, processed: SECRET }, { ...valid, durationMs: SECRET }]) {
    const f = setup()
    assert.throws(() => f.context.logPosProductBackgroundHealth_(last), /(?:POS_PRODUCT_BACKGROUND_HEALTH_INVALID|INVALID_WORKER_RECORD)/)
    assert.equal(f.logs.length, 0); assert.equal(f.writes.length, 0)
  }
  const f = setup({ job: () => ({ processed: true, code: 'COMPLETED', password: SECRET, janCode: SECRET }) })
  f.run()
  assert.doesNotMatch(f.logs.join('\n') + f.properties.get(HEALTH), /synthetic-private|password|janCode/)
})

test('各固定結果codeを記録し、時間トリガーの失敗は固定エラーだけを返す', () => {
  const codes = ['EMPTY', 'COMPLETED', 'REVIEW_REQUIRED', 'WORKER_RESPONSE_FAILED', 'POS_READ_FAILED',
    'POS_PREPARE_FAILED', 'EXECUTION_DISABLED', 'BUDGET_PAUSED']
  const attention = codes.filter(code => !['EMPTY', 'COMPLETED'].includes(code))
  for (const code of codes) {
    const result = { processed: !['EMPTY', 'EXECUTION_DISABLED', 'BUDGET_PAUSED'].includes(code), code }
    const f = setup({ job: current => { current.advance(100); return result } })
    if (attention.includes(code)) {
      assert.throws(() => f.run(true), error => error.message === 'POS_PRODUCT_BACKGROUND_ATTENTION_REQUIRED')
    } else assert.deepEqual(f.run(true), result)
    assert.deepEqual(f.saved().last, finished(START, code, result.processed, 100))
    assert.equal(f.logs.length, 1); assert.equal(f.releases, 1)
    assert.doesNotMatch(f.logs[0], /synthetic-private/)
  }
  for (const options of [{ properties: { [ENABLED]: null } }, { busy: true }]) {
    const f = setup(options)
    assert.deepEqual(f.run(true), { processed: false, code: options.busy ? 'BUSY' : 'DISABLED' })
    assert.equal(f.jobs, 0); assert.equal(f.writes.length, 0); assert.equal(f.logs.length, 0)
  }
  const f = setup()
  f.context.logPosProductBackgroundHealth_(running(START))
  assert.equal(JSON.parse(f.logs[0].slice('KENNEL_POS_BACKGROUND_HEALTH '.length)).code, 'RUNNING')
})

test('job例外でも実時間と固定失敗summaryを記録し秘密本文をログに出さない', () => {
  const f = setup({ job: current => { current.advance(200); throw new Error(SECRET) } })
  assert.throws(() => f.run(), error => error.message === SECRET)
  assert.deepEqual(f.saved().last, finished(START, 'WORKER_RESPONSE_FAILED', false, 200))
  assert.deepEqual(f.saved().runs, [[START, 200]])
  assert.doesNotMatch(f.logs.join('\n') + f.properties.get(HEALTH), /synthetic-private/)
  assert.equal(f.releases, 1)
})

test('時間トリガーは秘密本文を含むjob例外も固定エラーへ変換する', () => {
  const f = setup({ job: current => { current.advance(200); throw new Error(SECRET) } })
  assert.throws(() => f.run(true), error => error.message === 'POS_PRODUCT_BACKGROUND_ATTENTION_REQUIRED')
  assert.deepEqual(f.saved().last, finished(START, 'WORKER_RESPONSE_FAILED', false, 200))
  assert.deepEqual(f.saved().runs, [[START, 200]])
  assert.equal(f.logs.length, 1)
  assert.doesNotMatch(f.logs.join('\n') + f.properties.get(HEALTH), /synthetic-private/)
  assert.equal(f.releases, 1); assert.equal(f.locked, false)
})

test('管理者health表示は状態と予算だけを返し、設定・job・予約を変更しない', () => {
  const last = finished(START - 100), health = stateText([[START - HORIZON_MS, 500], [START - 100, 10]], last)
  const f = setup({ health, properties: { POS_PRODUCT_CONSUME_SECRET: SECRET } })
  const before = [...f.properties]
  assert.deepEqual(plain(f.context.showPosProductBackgroundWorkerHealth()), {
    enabled: true, last, chargedRuntimeMs: 10, budgetLimitMs: BUDGET_MS,
  })
  assert.deepEqual([...f.properties], before); assert.equal(f.writes.length, 0); assert.equal(f.jobs, 0); assert.equal(f.releases, 0)
  assert.equal(f.logs.length, 1); assert.match(f.logs[0], /^KENNEL_POS_BACKGROUND_STATUS /)
  assert.doesNotMatch(f.logs[0], /synthetic-private|POS_PRODUCT_CONSUME_SECRET/)

  const empty = setup({ properties: { [ENABLED]: 'false' } })
  assert.deepEqual(plain(empty.context.showPosProductBackgroundWorkerHealth()), {
    enabled: false, last: null, chargedRuntimeMs: 0, budgetLimitMs: BUDGET_MS,
  })
  assert.equal(empty.writes.length, 0); assert.equal(empty.properties.has(HEALTH), false)
})
