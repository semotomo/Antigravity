import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import * as validation from '../next_app/lib/pos-products/validation.ts'
import * as identity from '../next_app/lib/pos-products/identity.ts'
import { form,jan } from './fixtures/pos_product_form_fixture.mjs'

const ts=createRequire(new URL('../next_app/package.json',import.meta.url))('typescript')
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const gas=vm.createContext({Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,text)=>[...createHash('sha256').update(text).digest()]}})
vm.runInContext(read('gas/posProductReadDiagnostic.js')+'\n'+read('gas/posProductForm.js'),gas)
const plain=v=>JSON.parse(JSON.stringify(v))
function load(path,imports) {
  const module={exports:{}}
  vm.runInNewContext(ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,structuredClone,process,Date,require:n=>{if(Object.hasOwn(imports,n))return imports[n];throw Error('Unexpected import '+n)}})
  return module.exports
}
const reviews=load('next_app/lib/pos-products/edit-review.server.ts',{'server-only':{},'node:crypto':{createHash},'./validation':validation,'./identity':identity})
const inspection=load('next_app/lib/pos-products/inspection.server.ts',{'server-only':{},'./identity':identity,'./edit-review.server':reviews})
const operationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actorId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
function raw(store=7,override={}) {
  const parsed=plain(gas.readPosProductEditForm_(form(store,override),store,jan))
  return {storeId:store,janCode:jan,capturedAt:Date.now(),searches:['schGoodsId','schMakerCd'].map(field=>({field,count:1,inspected:true,internalId:parsed.identity.posProductId,internalIdPresent:true,
    salesKind:'2',storeGroupId:parsed.identity.groupId,productCodeMatches:true,manufacturerCodeMatches:true,formInspection:structuredClone(parsed)}))}
}
function fixture({store=7,authorized=true,dbStore=store,dbJan=jan,dbError=false,posFailure=false,rawStore=store}={}) {
  const calls=[],query=[],state={override:{}}
  const reader={inspect:async target=>{
    calls.push('inspect');assert.equal(target.janCode,jan);assert.equal(target.actorId,actorId)
    assert.deepEqual(Object.keys(target).sort(),['storeId','operationId','janCode','actorId'].sort())
    if(posFailure)throw Error('synthetic-private-password')
    return raw(rawStore,state.override)
  }}
  const db={from:name=>{
    calls.push('db:'+name)
    const q={select:()=>q,eq:(key,val)=>{query.push([key,val]);return q},maybeSingle:async()=>({data:{id:42,store_id:dbStore,jan_code:dbJan},error:dbError?'synthetic-private-db-error':null})}
    return q
  }}
  const api=load('next_app/lib/pos-products/editor.server.ts',{
    'server-only':{},'./validation':validation,'./inspection.server':inspection,'./edit-review.server':reviews,
    '@/lib/supabase/server':{createClient:async()=>{calls.push('client');return db}},
    '@/lib/inventory/auth':{requireInventoryManagerAccess:async(_,s)=>{calls.push('authorize:'+s);if(!authorized)throw Error('synthetic-private-auth-error');return {id:actorId}}},
    './inspection-transport.server':{configuredPosProductInspector:()=>{calls.push('configure');return reader}},
  })
  const target={storeId:store,productId:42,operationId}
  return {api,calls,query,state,target,reader}
}
async function enabled(fn) {
  const before=process.env.POS_PRODUCT_EDITOR_ENABLED
  process.env.POS_PRODUCT_EDITOR_ENABLED='true'
  try {await fn()} finally {if(before===undefined)delete process.env.POS_PRODUCT_EDITOR_ENABLED;else process.env.POS_PRODUCT_EDITOR_ENABLED=before}
}
test('準備機能OFFでは認証・DB・POS接続を行わず拒否する',async()=>{
  const before=process.env.POS_PRODUCT_EDITOR_ENABLED;delete process.env.POS_PRODUCT_EDITOR_ENABLED
  try {const f=fixture();await assert.rejects(()=>f.api.loadProductEditor(f.target));assert.deepEqual(f.calls,[])}
  finally {if(before!==undefined)process.env.POS_PRODUCT_EDITOR_ENABLED=before}
})
test('manager認可→店舗別DB→接続生成→POSの順で読込み、ブラウザDTOを限定する',()=>enabled(async()=>{
  for(const store of [7,6]) {
    const f=fixture({store}),data=await f.api.loadProductEditor(f.target)
    assert.deepEqual(f.calls,['client','authorize:'+store,'db:products','configure','inspect'])
    assert.deepEqual(f.query,[['store_id',store],['id',42]])
    assert.deepEqual(Object.keys(data).sort(),['storeId','productId','janCode','capturedAt','fingerprint','fields','groups','suppliers'].sort())
    assert.equal(data.storeId,store);assert.equal(data.fields.cost,'75')
    assert.ok(!JSON.stringify(data).match(/fixture-id|settings|private|identity|patch/))
  }
}))
test('manager未認可・店舗/JAN不一致・DBエラーではPOSや資格情報へアクセスしない',()=>enabled(async()=>{
  for(const options of [{authorized:false},{dbStore:6},{dbJan:'invalid'},{dbError:true}]) {
    const f=fixture(options)
    await assert.rejects(()=>f.api.loadProductEditor(f.target),e=>!e.message.includes('private'))
    assert.ok(!f.calls.includes('inspect'));assert.ok(!f.calls.includes('configure'))
  }
}))
test('ブラウザ提供JANやsnapshot、無効な店舗/ID/操作UUIDを読み込み入口で拒否する',()=>enabled(async()=>{
  const f=fixture()
  for(const extra of [{janCode:jan},{snapshot:{}},{storeId:5},{productId:0},{operationId:'invalid'}])await assert.rejects(()=>f.api.loadProductEditor({...f.target,...extra}))
  assert.deepEqual(f.calls,[])
}))
test('POS通信失敗・他店舗応答は固定の安全なエラー、台帳/保存へのfallbackなし',()=>enabled(async()=>{
  for(const options of [{posFailure:true},{rawStore:6}]) {
    const f=fixture(options)
    await assert.rejects(()=>f.api.loadProductEditor(f.target),e=>e instanceof f.api.ProductEditorError&&!e.message.includes('private'))
  }
}))
test('レビューは認可とPOS再取得後の差分のみ返し、内部snapshot/patch/台帳を返さない',()=>enabled(async()=>{
  const f=fixture(),data=await f.api.loadProductEditor(f.target)
  f.calls.length=0
  const command={...f.target,kind:'update',expectedFingerprint:data.fingerprint,fields:{...data.fields,name:'新しい名前'}}
  const result=await f.api.reviewProductEditor(command)
  assert.deepEqual(Object.keys(result).sort(),['operationId','reviewedAt','changes'].sort())
  assert.deepEqual(plain(result.changes),[{field:'name',label:'商品名',before:'商品 & 名前',after:'新しい名前'}])
  assert.deepEqual(f.calls,['client','authorize:7','db:products','configure','inspect'])
}))
test('外部変更・他店舗候補・小数円・変更なしはレビューで停止し入力を補正しない',()=>enabled(async()=>{
  const f=fixture(),data=await f.api.loadProductEditor(f.target)
  const command={...f.target,kind:'update',expectedFingerprint:data.fingerprint,fields:{...data.fields,name:'新しい名前'}}
  f.state.override={name:'POSで外部変更'}
  await assert.rejects(()=>f.api.reviewProductEditor(command),/編集開始後/)
  f.state.override={}
  for(const fields of [{...command.fields,groupId:'next-6'},{...command.fields,cost:'0.5'},data.fields])await assert.rejects(()=>f.api.reviewProductEditor({...command,fields}))
  assert.equal(command.fields.name,'新しい名前')
}))
test('ブラウザの変更確認は店舗別の商品グループ・仕入先を名前で表示する',()=>enabled(async()=>{
  const f=fixture(),data=await f.api.loadProductEditor(f.target)
  const result=await f.api.reviewProductEditor({...f.target,kind:'update',expectedFingerprint:data.fingerprint,fields:{...data.fields,groupId:'next-7',supplierId:'supplier-7'}})
  assert.deepEqual(plain(result.changes).map(change=>[change.before,change.after]),[['店舗の分類','次の分類'],[null,'店舗の仕入先']])
}))
test('公開Actionは準備DAL以外を呼ばず、未知の例外原文は返さない',async()=>{
  const errorFixture=fixture()
  const actions=load('next_app/app/actions/posProducts.ts',{'@/lib/pos-products/editor.server':{
    ProductEditorError:errorFixture.api.ProductEditorError,
    loadProductEditor:async()=>{throw Error('synthetic-private-cookie')},
    reviewProductEditor:async()=>{throw new errorFixture.api.ProductEditorError('入力は保持されています。')},
  }})
  assert.equal((await actions.loadPosProductEditorAction({})).success,false)
  assert.ok(!JSON.stringify(await actions.loadPosProductEditorAction({})).includes('private'))
  assert.equal((await actions.reviewPosProductEditorAction({})).error,'入力は保持されています。')
  assert.doesNotMatch(read('next_app/lib/pos-products/editor.server.ts'),/ledger\.server|prepareProductEditOperation|\.update\(|\.insert\(|\.rpc\(/)
})
test('準備UI有効時には既存DB直接編集Actionを迂回できない',()=>{
  const body=read('next_app/app/actions/products.ts').split('export async function updateProductAction(')[1]
  assert.match(body,/POS_PRODUCT_EDITOR_ENABLED === 'true'[\s\S]*?return \{ status: 'error'/)
  assert.ok(body.indexOf('POS_PRODUCT_EDITOR_ENABLED')<body.indexOf('buildProductPayload'))
})
