import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import * as validation from '../next_app/lib/pos-products/validation.ts'
import * as identity from '../next_app/lib/pos-products/identity.ts'
import * as operations from '../next_app/lib/pos-products/operations.ts'

const require=createRequire(new URL('../next_app/package.json',import.meta.url)),ts=require('typescript')
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
function compile(source,imports) {
  const module={exports:{}}
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,Buffer,JSON,require:n=>{if(Object.hasOwn(imports,n))return imports[n];throw Error('Unexpected import '+n)}})
  return module.exports
}
const review=compile(read('next_app/lib/pos-products/edit-review.server.ts'),{'server-only':{},'node:crypto':{createHash},'./validation':validation,'./identity':identity})
const source=read('next_app/lib/pos-products/edit-dispatch.server.ts')
const api=compile(source,{'server-only':{},'node:crypto':{createHash},'./validation':validation,'./operations':operations,'./edit-review.server':review})
const operationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actorId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const now=1_800_000_000_000,hash=t=>createHash('sha256').update(t,'utf8').digest('hex')
function fixture(storeId=6) {
  const snapshot={storeId,productId:42,janCode:'0490123456789',capturedAt:now-1000,complete:true,
    identity:{posProductId:'fixture-pos-'+storeId,officeId:storeId===6?'11054':'11053',groupId:storeId===6?'11099':'11098',salesKind:'retail',productCode:'',manufacturerCode:'0490123456789',exclusiveStore:true},
    fields:{name:'旧名',groupId:'g'+storeId,price:'126',cost:'75',supplierId:null},
    settings:{nameKana:'キュウメイ',abbreviation:'既存略称',taxId:'0',priceScope:'all',priceMode:'fixed',supplierScope:'all',otherSettingsFingerprint:'c'.repeat(64)}}
  const inspection={snapshot,fingerprint:review.fingerprintProductEditSnapshot(snapshot,now),
    choices:{storeId,salesKind:'retail',groupIds:['g'+storeId],supplierIds:['s'+storeId]},
    groups:[{id:'g'+storeId,name:'店舗の分類'}],suppliers:[{id:'s'+storeId,name:'店舗の仕入先'}]}
  const command=validation.parsePosProductCommand({kind:'update',operationId,storeId,productId:42,expectedFingerprint:inspection.fingerprint,fields:{...snapshot.fields,name:'新名'}})
  const expected=review.buildProductEditReview(command,snapshot,inspection.choices,now)
  const operation={operationId,actorId,storeId,payloadHash:hash(JSON.stringify(command)),status:'prepared',version:0,sendAttempts:0,expectedResultFingerprint:expected.expectedResultFingerprint,verifiedFingerprint:null}
  const build=()=>api.buildProductEditDispatch(operation,command,inspection,now)
  return {snapshot,inspection,command,operation,build}
}
function stored(f,d=f.build(),overrides={}) {
  return {operation:{id:operationId,actor_id:actorId,store_id:f.operation.storeId,payload_hash:f.operation.payloadHash,status:'dispatching',row_version:1,send_attempts:1,
    expected_result_fingerprint:f.operation.expectedResultFingerprint,verified_fingerprint:null,command_text:JSON.stringify(f.command),product_id_snapshot:42,jan_code:f.snapshot.janCode,pos_product_id:f.snapshot.identity.posProductId},
    dispatch:{operation_id:operationId,store_id:f.operation.storeId,dispatch_text:d.dispatchText,dispatch_hash:d.dispatchHash,
      before_fingerprint_text:d.beforeFingerprintText,expected_fingerprint_text:d.expectedFingerprintText,reviewed_at:d.reviewedAt},receipt:null,...overrides}
}
test('両店舗でGASの7項目だけをcanonical化し、台帳hashとは別のdispatchHashを生成する',()=>{
  for(const store of [6,7]) {
    const f=fixture(store),d=f.build(),c=JSON.parse(d.dispatchText)
    assert.deepEqual(Object.keys(c).sort(),['operationId','actorId','storeId','janCode','before','patch','expiresAt'].sort())
    assert.equal(c.actorId,actorId);assert.equal(c.storeId,store);assert.equal(c.expiresAt,now+120000)
    assert.equal(c.before.fields.cost,'75');assert.equal(c.patch.goodsName,'新名');assert.equal(Object.keys(c.patch).length,1)
    assert.equal(hash(d.dispatchText),d.dispatchHash);assert.notEqual(d.dispatchHash,f.operation.payloadHash)
    assert.equal(hash(d.beforeFingerprintText),f.command.expectedFingerprint)
    assert.equal(hash(d.expectedFingerprintText),f.operation.expectedResultFingerprint)
    assert.doesNotMatch(d.dispatchText,/password|Cookie|goodsDto4UpdSave|te-conditions|imageFileName/)
  }
})
test('プロパティ順序に依存せず、GASと同じ再帰sort形式になる',()=>{
  const f=fixture(),first=f.build()
  f.inspection.snapshot.identity=Object.fromEntries(Object.entries(f.inspection.snapshot.identity).reverse())
  f.inspection.snapshot.fields=Object.fromEntries(Object.entries(f.inspection.snapshot.fields).reverse())
  assert.equal(f.build().dispatchText,first.dispatchText)
  const sorted=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(sorted).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+sorted(v[k])).join(',')+'}'
  assert.equal(first.dispatchText,sorted(JSON.parse(first.dispatchText)))
})
test('別店舗/商品/台帳内容/期待値/途中変更・古いsnapshotを束縛前に拒否する',()=>{
  for(const mutate of [f=>{f.operation.storeId=7},f=>{f.operation.payloadHash='0'.repeat(64)},
    f=>{f.operation.expectedResultFingerprint='0'.repeat(64)},f=>{f.command.productId=43},
    f=>{f.inspection.snapshot.fields.name='外部変更'},f=>{f.inspection.snapshot.capturedAt=now-120001},
    f=>{f.operation.status='dispatching';f.operation.version=1;f.operation.sendAttempts=1}]) {
    const f=fixture();mutate(f);assert.throws(f.build)
  }
})
test('未知キー・hidden状態・壊れた候補・過大なカタログを永続本文へ混入させない',()=>{
  for(const mutate of [f=>{f.inspection.snapshot.hidden='synthetic-private'},f=>{f.inspection.secret='synthetic-private'},
    f=>{f.inspection.groups[0].secret='synthetic-private'},f=>{f.inspection.groups.push({...f.inspection.groups[0]})},
    f=>{f.inspection.suppliers[0].id='bad id'},f=>{f.inspection.groups=[]},
    f=>{f.inspection.groups=Array.from({length:200},(_,i)=>({id:'g'+i,name:'長'.repeat(1000)}))}]) {
    const f=fixture();mutate(f);assert.throws(f.build,e=>!e.message.includes('synthetic-private'))
  }
})
test('保存済みの業務指紋・内部ID・店舗・commandを再検証し、期限後も送信用ではなく復旧情報として取得できる',()=>{
  const f=fixture(),s=stored(f),r=api.restoreProductEditDispatch(s.operation,s.dispatch,s.receipt,now+300000)
  assert.equal(r.operation.operationId,operationId);assert.equal(r.dispatch.review.posProductId,f.snapshot.identity.posProductId)
  assert.equal(r.dispatch.review.expectedResultFingerprint,f.operation.expectedResultFingerprint)
  assert.equal(r.dispatch.command.expiresAt,now+120000);assert.equal(r.receiptConsumedAt,null)
  const actual={...f.snapshot,capturedAt:now+300000,fields:{...f.snapshot.fields,name:'新名'}}
  assert.equal(review.verifyProductEditResult(r.dispatch.review,actual,now+300000),f.operation.expectedResultFingerprint)
})
test('復旧時の台帳/dispatch本文/指紋/receiptの差し替えを拒否し、本文を例外へ出さない',()=>{
  const mutations=[s=>{s.operation.command_text=s.operation.command_text.replace('新名','改竄')},s=>{s.operation.pos_product_id='別商品'},
    s=>{s.dispatch.dispatch_hash='0'.repeat(64)},s=>{s.dispatch.dispatch_text=s.dispatch.dispatch_text.replace('新名','改竄')},
    s=>{s.dispatch.before_fingerprint_text=s.dispatch.before_fingerprint_text.replace('旧名','改竄')},
    s=>{s.dispatch.expected_fingerprint_text=s.dispatch.expected_fingerprint_text.replace('新名','改竄')},
    s=>{s.dispatch.store_id=7},s=>{s.dispatch.reviewed_at='invalid'},
    s=>{s.receipt={operation_id:operationId,store_id:7,dispatch_hash:s.dispatch.dispatch_hash,consumed_at:new Date(now+10).toISOString()}},
    s=>{s.receipt={operation_id:operationId,store_id:6,dispatch_hash:'0'.repeat(64),consumed_at:new Date(now+10).toISOString()}}]
  for(const mutate of mutations) {
    const s=stored(fixture());mutate(s)
    assert.throws(()=>api.restoreProductEditDispatch(s.operation,s.dispatch,s.receipt,now+300000),e=>!e.message.includes('改竄'))
  }
})
test('消費記録は同一店舗/操作/hashと時刻を確認し、未登録の復旧には保存本文がない',()=>{
  const f=fixture(),s=stored(f),consumed=new Date(now+20).toISOString()
  s.receipt={operation_id:operationId,store_id:6,dispatch_hash:s.dispatch.dispatch_hash,consumed_at:consumed}
  assert.equal(api.restoreProductEditDispatch(s.operation,s.dispatch,s.receipt,now+300000).receiptConsumedAt,now+20)
  s.receipt.consumed_at=new Date(now+400000).toISOString()
  assert.throws(()=>api.restoreProductEditDispatch(s.operation,s.dispatch,s.receipt,now+300000))
  const empty=api.restoreProductEditDispatch(s.operation,null,null,now+300000)
  assert.equal(empty.dispatch,null);assert.equal(empty.receiptConsumedAt,null)
  assert.throws(()=>api.restoreProductEditDispatch(s.operation,null,s.receipt,now+300000))
})
test('private復旧moduleは公開入口・POS通信・状態更新を持たない',()=>{
  assert.match(source,/import 'server-only'/)
  assert.doesNotMatch(source,/['"]use server['"]|fetch\(|console\.|UrlFetchApp|\.rpc\(/)
})
