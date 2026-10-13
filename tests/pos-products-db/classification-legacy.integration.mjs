import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// 既存13ケースを新migration適用後のfixtureでもそのまま実行する。
// 元のcase/fixtureは編集せず、入口のimportだけを明示的に差し替える。
const source = await readFile(new URL('./intake.integration.mjs', import.meta.url), 'utf8')
const fixtureImport = "import { setupIntakeDatabase, manager, other, staff } from './intake-fixture.mjs'"
const databaseImport = "import { PGlite } from '@electric-sql/pglite'"
if (source.split(fixtureImport).length !== 2 || source.split(databaseImport).length !== 2) {
  throw new Error('legacy intake test imports changed')
}
const require = createRequire(import.meta.url)
const updated = source.replace(fixtureImport,
  `import { setupClassificationDatabase as setupIntakeDatabase, manager, other, staff } from '${new URL('./classification-fixture.mjs', import.meta.url)}'`)
  .replace(databaseImport, `import { PGlite } from '${pathToFileURL(require.resolve('@electric-sql/pglite'))}'`)
await import('data:text/javascript;base64,' + Buffer.from(updated, 'utf8').toString('base64'))
