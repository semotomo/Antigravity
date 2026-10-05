import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import * as validation from '../next_app/lib/pos-products/validation.ts'
import * as operations from '../next_app/lib/pos-products/operations.ts'
import * as identity from '../next_app/lib/pos-products/identity.ts'

const require = createRequire(new URL('../next_app/package.json', import.meta.url))
const ts = require('typescript')
const source = readFileSync(new URL('../next_app/lib/pos-products/ledger.server.ts', import.meta.url),'utf8')
const authSource = readFileSync(new URL('../next_app/lib/inventory/auth.ts', import.meta.url),'utf8')
function compile(source, imports, env={}) {
  const module = { exports:{} }
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  runInNewContext(code,{module,exports:module.exports,Buffer,JSON,process:{env},require:name=>{
    if (Object.hasOwn(imports,name)) return imports[name]
    throw new Error(`Unexpected import: ${name}`)
  }})
  return module.exports
}
const realAuth = compile(authSource,{})
const editReview = compile(readFileSync(new URL('../next_app/lib/pos-products/edit-review.server.ts', import.meta.url),'utf8'), {'server-only':{},'node:crypto':{createHash},'./validation':validation,'./identity':identity})
const dispatchApi = compile(readFileSync(new URL('../next_app/lib/pos-products/edit-dispatch.server.ts', import.meta.url),'utf8'), {'server-only':{},'node:crypto':{createHash},'./validation':validation,'./operations':operations,'./edit-review.server':editReview})
const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const fields = {name:'商品',groupId:'group6',price:'1000',cost:'500',supplierId:null}
const command = () => ({operationId,storeId:6,kind:'create',janCode:'0490123456789',fields:{...fields}})
const review = () => ({posProductId:null,expectedResultFingerprint:'b'.repeat(64),choices:{storeId:6,salesKind:'retail',groupIds:['group6'],supplierIds:[]}})
const state = () => ({operationId,actorId:actor,storeId:6,payloadHash:'a'.repeat(64),status:'prepared',version:0,sendAttempts:0,expectedResultFingerprint:'b'.repeat(64),verifiedFingerprint:null})
const row = s => ({id:s.operationId,actor_id:s.actorId,store_id:s.storeId,payload_hash:s.payloadHash,status:s.status,row_version:s.version,send_attempts:s.sendAttempts,expected_result_fingerprint:s.expectedResultFingerprint,verified_fingerprint:s.verifiedFingerprint})
function editFixture() {
  const now=Date.now()
  const snapshot={storeId:6,productId:42,janCode:'0490123456789',capturedAt:now-1000,complete:true,
    identity:{posProductId:'fixture-pos-1',officeId:'11054',groupId:'11099',salesKind:'retail',productCode:'',manufacturerCode:'0490123456789',exclusiveStore:true},
    fields:{...fields},settings:{nameKana:'ショウヒン',abbreviation:'',taxId:'fixture-tax',priceScope:'all',priceMode:'fixed',supplierScope:'all',otherSettingsFingerprint:'c'.repeat(64)}}
  const input={kind:'update',operationId,storeId:6,productId:42,expectedFingerprint:editReview.fingerprintProductEditSnapshot(snapshot,now),fields:{...fields,name:'変更後'}}
  return {now,snapshot,input,choices:review().choices,catalog:{storeId:6,group:{id:'group6',name:'分類'},supplier:null}}
}
function fixture() {
  const calls=[]
  const auth={loggedIn:true,manager:true,authChecks:0,accessError:null}
  const filters=[]
  let answer=null
  const client={auth:{getUser:async()=>{auth.authChecks++;auth.onAuth?.();return {data:{user:auth.loggedIn?{id:actor}:null},error:null}}},from:table=>{
    const query={select:()=>query,eq:(key,value)=>{filters.push([table,key,value]);return query},maybeSingle:async()=>({data:table==='user_store_access'?(auth.manager?{role:'manager'}:null):answer,error:table==='user_store_access'?auth.accessError:null})}
    return query
  }}
  const env={POS_PRODUCT_WRITES_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only-not-a-key'}
  let respond=async()=>({data:null,error:null})
  const api=compile(source,{'server-only':{},'node:crypto':{createHash},'@supabase/supabase-js':{createClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return respond(name,args)}})},'@/lib/supabase/server':{createClient:async()=>client},'@/lib/inventory/auth':realAuth,'./validation':validation,'./operations':operations,'./edit-review.server':editReview,'./edit-dispatch.server':dispatchApi},env)
  return {api,auth,calls,env,filters,setAnswer:v=>{answer=v},setResponder:fn=>{respond=fn}}
}

test('台帳モジュールはserver-onlyで、公開Server Actionを新設しない',()=>{
  assert.match(source,/import 'server-only'/)
  assert.doesNotMatch(source,/['"]use server['"]|console\.(log|error)|fetch\(/)
})

test('編集差分で計算した期待指紋とPOS内部IDを認可済み台帳へ束縛する',async()=>{
  const f=fixture();const e=editFixture()
  f.setResponder(async(name,args)=>({data:row({...state(),payloadHash:createHash('sha256').update(args.p_command_text).digest('hex'),expectedResultFingerprint:args.p_expected_result_fingerprint}),error:null}))
  const result=await f.api.prepareProductEditOperation(e.input,e.snapshot,e.choices,e.catalog,e.now)
  assert.equal(f.calls[0].name,'prepare_pos_product_edit')
  assert.equal(JSON.parse(f.calls[0].args.p_catalog_text).previousPosName,e.snapshot.fields.name)
  assert.equal(f.calls.length,1)
  assert.equal(f.calls[0].args.p_pos_product_id,e.snapshot.identity.posProductId)
  assert.equal(result.operation.expectedResultFingerprint,result.review.expectedResultFingerprint)
  assert.equal(result.review.patch.goodsName,'変更後')
  assert.equal(f.auth.authChecks,1)
  e.snapshot.fields.name='外部で変更'
  await assert.rejects(f.api.prepareProductEditOperation(e.input,e.snapshot,e.choices,e.catalog,e.now))
  assert.equal(f.calls.length,1)
})

test('保存後照合の失敗・別操作・権限剥奪はPOS確認済み記録を作らない',async()=>{
  const f=fixture();const e=editFixture()
  const r=editReview.buildProductEditReview(e.input,e.snapshot,e.choices,e.now)
  const actual=JSON.parse(JSON.stringify(r.expectedSnapshot));actual.capturedAt=e.now+1000
  const op={...state(),status:'verifying',version:2,sendAttempts:1,expectedResultFingerprint:r.expectedResultFingerprint}
  const wrong=structuredClone(actual);wrong.fields.cost='499'
  await assert.rejects(f.api.recordProductEditVerification(op,r,wrong,e.now+2000))
  await assert.rejects(f.api.recordProductEditVerification({...op,operationId:actor},r,actual,e.now+2000))
  f.auth.manager=false
  await assert.rejects(f.api.recordProductEditVerification(op,r,actual,e.now+2000))
  assert.equal(f.calls.length,0)
  f.auth.manager=true
  f.setResponder(async()=>({data:row(operations.advanceProductOperation(op,{type:'pos_verified',fingerprint:r.expectedResultFingerprint,expectedVersion:2})),error:null}))
  const result=await f.api.recordProductEditVerification(op,r,actual,e.now+2000)
  assert.equal(result.status,'pos_confirmed')
  assert.equal(f.calls[0].args.p_verified_fingerprint,r.expectedResultFingerprint)
})

test('保存前のカタログは対象店舗・商品グループ・仕入先を照合する',async()=>{
  const f=fixture();const e=editFixture()
  for(const catalog of [null,{...e.catalog,storeId:7},{...e.catalog,group:{id:'wrong',name:'別分類'}},{...e.catalog,group:{id:'group6',name:''}},{...e.catalog,supplier:{id:'other',name:'他仕入先'}}]) {
    await assert.rejects(f.api.prepareProductEditOperation(e.input,e.snapshot,e.choices,catalog,e.now))
  }
  assert.equal(f.calls.length,0)
})

test('DB反映は毎回再認可し、POS確認前と別利用者ではRPCを呼ばない',async()=>{
  const f=fixture();const op={...state(),status:'pos_confirmed',version:3,sendAttempts:1,verifiedFingerprint:state().expectedResultFingerprint}
  for(const invalid of [state(),{...op,actorId:operationId}]) await assert.rejects(f.api.applyProductEditToDatabase(invalid))
  f.auth.manager=false
  await assert.rejects(f.api.applyProductEditToDatabase(op))
  assert.equal(f.calls.length,0)
})

test('DB反映には操作識別子だけ送り、復旧・完了応答を検証する',async()=>{
  const f=fixture()
  for(const status of ['pos_confirmed','db_pending','completed']) {
    const op={...state(),status,version:4,sendAttempts:1,verifiedFingerprint:state().expectedResultFingerprint}
    const expected=status==='completed'?op:operations.advanceProductOperation(op,{type:'db_completed',expectedVersion:4})
    f.setResponder(async()=>({data:row(expected),error:null}))
    assert.equal((await f.api.applyProductEditToDatabase(op)).status,'completed')
    const sent=f.calls.at(-1)
    assert.equal(sent.name,'apply_pos_product_edit')
    assert.deepEqual(Object.keys(sent.args).sort(),['p_actor_id','p_store_id','p_operation_id','p_payload_hash','p_expected_version'].sort())
  }
})

test('DB反映の通信失敗・不正な完了応答では自動再送や成功扱いをしない',async()=>{
  const f=fixture();const op={...state(),status:'db_pending',version:4,sendAttempts:1,verifiedFingerprint:state().expectedResultFingerprint}
  f.setResponder(async()=>({data:null,error:{message:'private details'}}))
  await assert.rejects(f.api.applyProductEditToDatabase(op),e=>!e.message.includes('private'))
  assert.equal(f.calls.length,1)
  f.setResponder(async()=>({data:row({...op,status:'completed',storeId:7,version:5}),error:null}))
  await assert.rejects(f.api.applyProductEditToDatabase(op))
  assert.equal(f.calls.length,2)
})
test('新規受付の認可await中に保存フラグがOFFならprepare受付RPCを呼ばない',async()=>{
  const f=fixture()
  f.auth.onAuth=()=>{f.env.POS_PRODUCT_WRITES_ENABLED='false'}
  await assert.rejects(()=>f.api.prepareProductOperation(command(),review()))
  assert.equal(f.auth.authChecks,1)
  assert.equal(f.calls.length,0)
})

test('編集受付の認可await中に保存フラグがOFFならedit受付RPCを呼ばない',async()=>{
  const f=fixture(),e=editFixture()
  f.auth.onAuth=()=>{f.env.POS_PRODUCT_WRITES_ENABLED='false'}
  await assert.rejects(()=>f.api.prepareProductEditOperation(e.input,e.snapshot,e.choices,e.catalog,e.now))
  assert.equal(f.auth.authChecks,1)
  assert.equal(f.calls.length,0)
})

test('認可のawait中に保存フラグがOFFになった場合はclaim/結果記録/DB反映のRPCを呼ばない',async()=>{
  const dispatching={...state(),status:'dispatching',version:1,sendAttempts:1}
  const confirmed={...state(),status:'pos_confirmed',version:3,sendAttempts:1,verifiedFingerprint:state().expectedResultFingerprint}
  for(const invoke of [
    api=>api.claimProductOperation(state()),
    api=>api.recordProductOperationResult(dispatching,{type:'outcome_unknown'}),
    api=>api.applyProductEditToDatabase(confirmed),
  ]) {
    const f=fixture()
    f.auth.onAuth=()=>{f.env.POS_PRODUCT_WRITES_ENABLED='false'}
    await assert.rejects(()=>invoke(f.api),error=>error.message==='POS商品保存はまだ有効になっていません。')
    assert.equal(f.auth.authChecks,1)
    assert.equal(f.calls.length,0)
  }
})

test('無効フラグ・未ログイン・店舗managerなしでは特権RPCを呼ばない',async()=>{
  for (const change of ['disabled','loggedOut','staff']) {
    const f=fixture()
    if(change==='disabled') f.env.POS_PRODUCT_WRITES_ENABLED='false'
    if(change==='loggedOut') f.auth.loggedIn=false
    if(change==='staff') f.auth.manager=false
    await assert.rejects(f.api.prepareProductOperation(command(),review()))
    assert.equal(f.calls.length,0)
  }
})
test('受付には認証した本人ID・正規化した入力のみを送り、他店舗候補を拒否する',async()=>{
  const f=fixture()
  f.setResponder(async(name,args)=>({data:row({...state(),payloadHash:createHash('sha256').update(args.p_command_text).digest('hex')}),error:null}))
  const c=command();c.fields.name=' 商品 '
  const result=await f.api.prepareProductOperation(c,review())
  assert.equal(result.actorId,actor)
  assert.equal(f.calls[0].args.p_actor_id,actor)
  assert.equal(JSON.parse(f.calls[0].args.p_command_text).fields.name,'商品')
  assert.equal(c.fields.name,' 商品 ')
  await assert.rejects(f.api.prepareProductOperation({...c,actorId:actor},review()))
  await assert.rejects(f.api.prepareProductOperation(c,{...review(),choices:{...review().choices,storeId:7}}))
  assert.equal(f.calls.length,1)
})
test('claim毎にDB店舗権限を再確認し、本人と違う操作を拒否する',async()=>{
  const f=fixture()
  const claimed=operations.advanceProductOperation(state(),{type:'claim_dispatch',expectedVersion:0})
  f.setResponder(async()=>({data:{claimed:true,operation:row(claimed)},error:null}))
  assert.equal((await f.api.claimProductOperation(state())).claimed,true)
  f.auth.manager=false
  await assert.rejects(f.api.claimProductOperation(state()))
  assert.equal(f.auth.authChecks,2)
  f.auth.manager=true
  await assert.rejects(f.api.claimProductOperation({...state(),actorId:operationId}))
  assert.equal(f.calls.length,1)
})
test('claimの通信結果不明は一回で止まり、自動再送・成功表示をしない',async()=>{
  const f=fixture()
  f.setResponder(async()=>{throw new Error('PRIVATE transport detail')})
  await assert.rejects(f.api.claimProductOperation(state()),error=>!error.message.includes('PRIVATE')&&/状態/.test(error.message))
  assert.equal(f.calls.length,1)
})
test('RPCの店舗・hash・version不一致や不正claim応答を成功と扱わない',async()=>{
  for(const change of [{store_id:7},{payload_hash:'c'.repeat(64)},{row_version:0},{send_attempts:0}]) {
    const f=fixture()
    const claimed=operations.advanceProductOperation(state(),{type:'claim_dispatch',expectedVersion:0})
    f.setResponder(async()=>({data:{claimed:true,operation:{...row(claimed),...change}},error:null}))
    await assert.rejects(f.api.claimProductOperation(state()))
    assert.equal(f.calls.length,1)
  }
})
test('結果記録は許可された遷移だけ送り、DB完了を偽装しない',async()=>{
  const f=fixture()
  const claimed=operations.advanceProductOperation(state(),{type:'claim_dispatch',expectedVersion:0})
  const uncertain=operations.advanceProductOperation(claimed,{type:'outcome_unknown',expectedVersion:1})
  f.setResponder(async()=>({data:row(uncertain),error:null}))
  assert.equal((await f.api.recordProductOperationResult(claimed,{type:'outcome_unknown'})).status,'uncertain')
  await assert.rejects(f.api.recordProductOperationResult(uncertain,{type:'db_completed'}))
  assert.equal(f.calls.length,1)
})
test('状態参照は特権鍵なしでも本人・店舗で絞り、payload等を画面へ返さない',async()=>{
  const f=fixture();delete f.env.SUPABASE_SERVICE_ROLE_KEY;f.env.POS_PRODUCT_WRITES_ENABLED='false'
  f.setAnswer({...row(state()),command_text:'private-input',pos_product_id:'private-pos-id'})
  const dto=await f.api.getProductOperationStatus(6,operationId)
  assert.deepEqual(Object.keys(dto).sort(),['operationId','sendAttempts','status','storeId','version'].sort())
  for (const pair of [['store_id',6],['actor_id',actor],['id',operationId]]) assert.ok(f.filters.some(([t,k,v])=>t==='pos_product_operations'&&k===pair[0]&&v===pair[1]))
  assert.equal(f.calls.length,0)
  f.setAnswer(null)
  assert.equal(await f.api.getProductOperationStatus(6,operationId),null)
})

test('DBや権限確認のエラー本文を利用者へ漏らさない',async()=>{
  const f=fixture()
  f.auth.accessError={message:'PRIVATE access query detail'}
  await assert.rejects(f.api.prepareProductOperation(command(),review()),error=>!error.message.includes('PRIVATE'))
  assert.equal(f.calls.length,0)
  f.auth.accessError=null
  f.setResponder(async()=>({data:null,error:{message:'PRIVATE RPC query detail'}}))
  await assert.rejects(f.api.claimProductOperation(state()),error=>!error.message.includes('PRIVATE'))
  assert.equal(f.calls.length,1)
})

test('再受付の保存済み状態をpreparedへ戻さず、claim falseを送信許可と扱わない',async()=>{
  const f=fixture()
  let preparedHash
  f.setResponder(async(name,args)=>{
    preparedHash=createHash('sha256').update(args.p_command_text).digest('hex')
    return {data:row({...state(),status:'dispatching',version:1,sendAttempts:1,payloadHash:preparedHash}),error:null}
  })
  const stored=await f.api.prepareProductOperation(command(),review())
  assert.equal(stored.status,'dispatching')
  f.setResponder(async()=>({data:{claimed:false,operation:row(stored)},error:null}))
  const replay=await f.api.claimProductOperation({...state(),payloadHash:preparedHash})
  assert.equal(replay.claimed,false)
  assert.equal(replay.operation.sendAttempts,1)
  assert.equal(f.calls.length,2)
})

function dispatchFixture() {
  const e=editFixture(),input=validation.parsePosProductCommand(e.input)
  const inspection={snapshot:e.snapshot,fingerprint:e.input.expectedFingerprint,choices:e.choices,groups:[e.catalog.group],suppliers:[]}
  const op={...state(),payloadHash:createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    expectedResultFingerprint:editReview.buildProductEditReview(input,e.snapshot,e.choices,e.now).expectedResultFingerprint}
  const dispatch=dispatchApi.buildProductEditDispatch(op,input,inspection,e.now)
  const rawOperation={...row(op),command_text:JSON.stringify(input),product_id_snapshot:input.productId,jan_code:e.snapshot.janCode,pos_product_id:e.snapshot.identity.posProductId}
  const rawDispatch={operation_id:operationId,store_id:6,dispatch_text:dispatch.dispatchText,dispatch_hash:dispatch.dispatchHash,
    before_fingerprint_text:dispatch.beforeFingerprintText,expected_fingerprint_text:dispatch.expectedFingerprintText,reviewed_at:dispatch.reviewedAt}
  return {...e,input,inspection,op,dispatch,rawOperation,rawDispatch}
}
test('dispatch登録は既定OFFで、本人manager再認可後にだけ9引数のRPCを1回呼ぶ',async()=>{
  const f=fixture(),e=dispatchFixture()
  await assert.rejects(f.api.registerProductEditDispatch(e.op,e.input,e.inspection,e.now));assert.equal(f.calls.length,0)
  f.env.POS_PRODUCT_DISPATCH_ENABLED='true';f.auth.manager=false
  await assert.rejects(f.api.registerProductEditDispatch(e.op,e.input,e.inspection,e.now));assert.equal(f.calls.length,0)
  f.auth.manager=true
  f.setResponder(async()=>({data:{operation:e.rawOperation,dispatch:e.rawDispatch},error:null}))
  const registered=await f.api.registerProductEditDispatch(e.op,e.input,e.inspection,e.now)
  assert.equal(registered.dispatch.dispatchHash,e.dispatch.dispatchHash)
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'register_pos_product_edit_dispatch')
  assert.equal(Object.keys(f.calls[0].args).length,9)
  assert.equal(f.calls[0].args.p_actor_id,actor);assert.equal(f.calls[0].args.p_dispatch_text,e.dispatch.dispatchText)
  assert.equal(f.calls[0].args.p_payload_hash,e.op.payloadHash)
})
test('dispatch登録のDB通信切断・本文/hash/期待値/version不一致は成功扱いも再送もしない',async()=>{
  for(const mutation of [()=>null,r=>{r.dispatch.dispatch_hash='0'.repeat(64)},r=>{r.operation.store_id=7},
    r=>{r.operation.row_version=1},r=>{r.extra='PRIVATE'}]) {
    const f=fixture(),e=dispatchFixture();f.env.POS_PRODUCT_DISPATCH_ENABLED='true'
    const response={operation:e.rawOperation,dispatch:e.rawDispatch};mutation(response)
    f.setResponder(async()=>mutation.length===0?{data:null,error:{message:'PRIVATE DB detail'}}:{data:response,error:null})
    await assert.rejects(f.api.registerProductEditDispatch(e.op,e.input,e.inspection,e.now),error=>!error.message.includes('PRIVATE'))
    assert.equal(f.calls.length,1)
  }
})
test('dispatch登録の認可await中に呼出元が変更しても対象は固定し、書込みOFFへの変更ならRPC前に停止する',async()=>{
  const f=fixture(),e=dispatchFixture();f.env.POS_PRODUCT_DISPATCH_ENABLED='true'
  f.auth.onAuth=()=>{e.op.storeId=7;e.op.operationId=actor;e.op.actorId=operationId;e.input.fields.name='差し替え';e.inspection.groups[0].name='差し替え'}
  f.setResponder(async()=>({data:{operation:e.rawOperation,dispatch:e.rawDispatch},error:null}))
  const registered=await f.api.registerProductEditDispatch(e.op,e.input,e.inspection,e.now)
  assert.equal(registered.operation.storeId,6);assert.equal(registered.dispatch.command.patch.goodsName,'変更後')
  assert.equal(f.calls[0].args.p_operation_id,operationId);assert.equal(f.calls[0].args.p_actor_id,actor);assert.equal(f.calls[0].args.p_store_id,6)
  const stopped=fixture(),other=dispatchFixture();stopped.env.POS_PRODUCT_DISPATCH_ENABLED='true'
  stopped.auth.onAuth=()=>{stopped.env.POS_PRODUCT_WRITES_ENABLED='false'}
  await assert.rejects(stopped.api.registerProductEditDispatch(other.op,other.input,other.inspection,other.now));assert.equal(stopped.calls.length,0)
})
test('中断後の復旧読取りは書込みOFF/期限後でも本人managerで再認可し、保存済み期待値を復元する',async()=>{
  const f=fixture(),e=dispatchFixture();f.env.POS_PRODUCT_WRITES_ENABLED='false'
  e.rawOperation={...e.rawOperation,status:'uncertain',row_version:2,send_attempts:1}
  const receipt={operation_id:operationId,store_id:6,dispatch_hash:e.dispatch.dispatchHash,consumed_at:new Date(e.now+10).toISOString()}
  f.setResponder(async()=>({data:{operation:e.rawOperation,dispatch:e.rawDispatch,receipt},error:null}))
  const recovery=await f.api.loadProductEditDispatchRecovery(6,operationId,e.now+300000)
  assert.equal(recovery.operation.status,'uncertain');assert.equal(recovery.dispatch.review.expectedResultFingerprint,e.op.expectedResultFingerprint)
  assert.equal(recovery.receiptConsumedAt,e.now+10)
  assert.deepEqual(Object.keys(f.calls[0].args).sort(),['p_actor_id','p_store_id','p_operation_id'].sort())
  assert.equal(f.calls[0].name,'get_pos_product_edit_dispatch')
  f.auth.manager=false
  await assert.rejects(f.api.loadProductEditDispatchRecovery(6,operationId,e.now+300000));assert.equal(f.calls.length,1)
})
test('復旧RPCの別利用者/別店舗/不正receipt/通信失敗を拒否し、状態DTOへprivate本文を追加しない',async()=>{
  for(const change of [r=>{r.operation.actor_id=operationId},r=>{r.operation.store_id=7},r=>{r.receipt={secret:'PRIVATE'}},r=>{r.extra='PRIVATE'}]) {
    const f=fixture(),e=dispatchFixture(),data={operation:e.rawOperation,dispatch:e.rawDispatch,receipt:null};change(data)
    f.setResponder(async()=>({data,error:null}))
    await assert.rejects(f.api.loadProductEditDispatchRecovery(6,operationId,e.now+300000),error=>!error.message.includes('PRIVATE'))
    assert.equal(f.calls.length,1)
  }
  const f=fixture();f.setResponder(async()=>{throw Error('PRIVATE transport')})
  await assert.rejects(f.api.loadProductEditDispatchRecovery(6,operationId),error=>!error.message.includes('PRIVATE'));assert.equal(f.calls.length,1)
})
