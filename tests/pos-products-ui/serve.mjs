import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const harness = dirname(fileURLToPath(import.meta.url))
const nextApp = resolve(harness, '../../next_app')
const nextRequire = createRequire(join(nextApp, 'package.json'))
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--sync-notices')) throw new Error('Unexpected preview argument')
const previewEntry = process.argv[2] === '--sync-notices' ? resolve(harness, '../product-sync-ui/preview.tsx') : join(harness, 'preview.tsx')
const webpack = nextRequire('next/dist/compiled/webpack/webpack')
const output = await mkdtemp(join(tmpdir(), 'kennel-pos-ui-'))
let server

async function cleanup() {
  // この実行で生成した一時bundleだけを削除し、workspaceや既存データへ触れない。
  const resolved = resolve(output)
  if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith('kennel-pos-ui-')) throw new Error('Unexpected preview output directory')
  await rm(resolved, { recursive: true, force: true })
}

try {
  await new Promise((accept, reject) => {
    webpack.webpack({
      mode: 'production', target: 'web', devtool: false,
      entry: previewEntry,
      output: { path: output, filename: 'preview.js' },
      optimization: { minimize: false },
      resolve: {
        extensions: ['.tsx', '.ts', '.js'], modules: [join(nextApp, 'node_modules')],
        alias: { '@/app/actions/posProducts$': join(harness, 'mock-actions.ts'), '@/app/actions/posProductExecution$': join(harness, 'mock-actions.ts'), '@': nextApp },
      },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: { loader: join(harness, 'typescript-loader.cjs') } }] },
      performance: { hints: false },
    }, (error, stats) => {
      if (error) return reject(error)
      if (stats?.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true, errorDetails: true })))
      accept()
    })
  })
  const bundle = await readFile(join(output, 'preview.js'))
  // 完全一致aliasが外れた場合は実Action/DALを読み込まず、起動前に停止する。
  if (/POS_PRODUCT_SIGNING_SECRET|POS_PRODUCT_INSPECTION_GAS_URL|requireInventoryManagerAccess|loadProductEditor/.test(bundle.toString('utf8'))) {
    throw new Error('Unexpected production service code in preview bundle')
  }
  const cssDirectory = join(nextApp, '.next/static/chunks')
  const cssFiles = (await readdir(cssDirectory)).filter(name => /^[A-Za-z0-9_-]+\.css$/.test(name)).sort()
  if (!cssFiles.length) throw new Error('Build the application before starting the preview; no built CSS was found')
  const css = Buffer.concat(await Promise.all(cssFiles.map(name => readFile(join(cssDirectory, name)))))
  const html = Buffer.from('<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>検証用・合成データ・本番非接続</title><link rel="stylesheet" href="/preview.css"></head><body class="bg-gray-50"><div id="root"></div><script src="/preview.js" defer></script></body></html>')
  const assets = new Map([
    ['/', { type: 'text/html; charset=utf-8', body: html }],
    ['/preview.js', { type: 'application/javascript; charset=utf-8', body: bundle }],
    ['/preview.css', { type: 'text/css; charset=utf-8', body: css }],
  ])
  server = createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; font-src 'none'; img-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'")
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
    const asset = assets.get(request.url)
    if (!asset) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.body.length })
    response.end(asset.body)
  })
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Preview did not bind a loopback port')
  console.log(`POS_UI_PREVIEW_URL=http://127.0.0.1:${address.port}/`)
  console.log('検証用・合成データ・本番非接続。停止: Ctrl+C')
  let closing = false
  const close = () => {
    if (closing) return
    closing = true
    server.close(() => { cleanup().then(() => process.exit(0), () => process.exit(1)) })
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
} catch (error) {
  server?.close()
  await cleanup()
  console.error(error instanceof Error ? error.message : 'Preview startup failed')
  process.exitCode = 1
}
