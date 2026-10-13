import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// 検証済みloopback専用runnerの接続制限と既存の独立接続ケースを維持する。
// 元ケースを変更せず、新分類migrationを適用したfixtureで同じロック待機を確認する。
const source = await readFile(new URL('./intake-concurrency.integration.mjs', import.meta.url), 'utf8')
const fixtureImport = "import { setupIntakeDatabase, manager } from './intake-fixture.mjs'"
const postgresImport = "import pg from 'pg'"
if (source.split(fixtureImport).length !== 2 || source.split(postgresImport).length !== 2) {
  throw new Error('legacy intake concurrency imports changed')
}
const require = createRequire(import.meta.url)
const updated = source.replace(fixtureImport,
  `import { setupClassificationDatabase as setupIntakeDatabase, manager } from '${new URL('./classification-fixture.mjs', import.meta.url)}'`)
  .replace(postgresImport, `import pg from '${pathToFileURL(require.resolve('pg'))}'`)
await import('data:text/javascript;base64,' + Buffer.from(updated, 'utf8').toString('base64'))
