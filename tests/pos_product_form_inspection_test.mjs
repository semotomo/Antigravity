import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import * as validation from '../next_app/lib/pos-products/validation.ts'
import * as identity from '../next_app/lib/pos-products/identity.ts'

const require = createRequire(new URL('../next_app/package.json', import.meta.url))
const ts = require('typescript')
const read = p => readFileSync(new URL('../'+p, import.meta.url), 'utf8')
const now = 1800000000000, jan = '0490123456789'
const plain = v => JSON.parse(JSON.stringify(v))
const utilities = { DigestAlgorithm:{SHA_256:'sha256'}, Charset:{UTF_8:'utf8'},
  computeDigest:(algorithm,text,encoding) => [...createHash(algorithm).update(text,encoding).digest()] }
const gas = vm.createContext({Utilities:utilities})
vm.runInContext(read('gas/posProductReadDiagnostic.js')+'\n'+read('gas/posProductForm.js'),gas)
const imports = {'server-only':{},'node:crypto':{createHash},'./validation':validation,'./identity':identity}
function load(path, extra={}) {
  const module = {exports:{}}
  vm.runInNewContext(ts.transpileModule(read('next_app/lib/pos-products/'+path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,structuredClone,process,Date,require:n=>{if(Object.hasOwn(extra,n))return extra[n];if(Object.hasOwn(imports,n))return imports[n];throw Error('Unexpected import '+n)}})
  return module.exports
}
const reviews = load('edit-review.server.ts')
const inspectionApi = load('inspection.server.ts',{'./edit-review.server':reviews})
const prefix = 'includeChildBody:hmma02403Form:'
const escape = v => String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
const input = (key,value,type='text',extra='') => `<input type="${type}" name="${prefix+key}" value="${escape(value)}" ${extra}>`
const select = (key,options) => `<select name="${prefix+key}" onchange="if (x > 0) { const name='fake'; }">${options.map(o=>`<option value="${escape(o.id)}" ${o.selected?'selected="selected"':''}>${escape(o.name)}</option>`).join('')}</select>`
const radio = (key,value,checked) => input(key,value,'radio',checked?'checked="checked"':'')
function form(storeId=7,overrides={}) {
  const group = storeId===7?'11098':'11099'
  const v = {id:'fixture-id-'+storeId,group,sales:'2',productCode:jan,makerCode:jan,name:'商品 & 名前',price:'126',cost:'75',kana:'ショウヒン',short:'既存略称',state:'private-session-state',description:'説明文',...overrides}
  return `<form id="hmma02403Form" method="post" action="/hm-hmma/view/hmma/hmma024/hmma02403.html;jsessionid=fixture.jvm1?te-uniquekey=fixture">`+
    input('goodsId-30',v.id,'hidden')+input('goodsSalesKbn',v.sales,'hidden')+input('tenpoGroupHid',v.group,'hidden')+
    select('tenpoGroup',[{id:'11097',name:'全店'},{id:group,name:'対象店舗',selected:true}])+
    input('gdsPublicGoodsCd',v.productCode)+input('gdsManufacturerPartNumber',v.makerCode)+input('goodsName',v.name)+
    input('goodsNameKana',v.kana)+input('abbreviateGoodsName',v.short)+input('gddGoodsPrice',v.price)+input('gddGoodsCost',v.cost)+
    select('goodsGroup',[{id:'group-'+storeId,name:'商品グループ',selected:true},{id:'next-'+storeId,name:'次の分類'}])+
    select('gddSupplierCd',[{id:'',name:'選択してください',selected:true},{id:'supplier-'+storeId,name:'仕入先'}])+
    select('goodsTax',[{id:'0',name:'消費税'},{id:'tax-fixture',name:'非課税'}])+
    radio('gdsGoodsPriceFlg','0',true)+radio('gdsGoodsPriceFlg','1',false)+
    radio('gddPriceInputFlg','false',true)+radio('gddPriceInputFlg','true',false)+
    radio('gdsSupplierFlg','0',true)+radio('gdsSupplierFlg','1',false)+
    input('goodsDto4UpdSave',v.state,'hidden')+`<textarea name="${prefix}sdGoodsText">${escape(v.description)}</textarea>`+
    input('doUpdate','','submit')+input('doDelete','','submit')+input('unknownButton','','submit')+'</form>'
}
function parse(store=7,overrides={}) {return plain(gas.readPosProductEditForm_(form(store,overrides),store,jan))}
function raw(store=7) {
  const f = parse(store)
  return {storeId:store,janCode:jan,capturedAt:now,searches:['schGoodsId','schMakerCd'].map(field=>({field,count:1,inspected:true,
    internalId:f.identity.posProductId,internalIdPresent:true,salesKind:'2',storeGroupId:f.identity.groupId,
    productCodeMatches:f.identity.productCode===jan,manufacturerCodeMatches:f.identity.manufacturerCode===jan,formInspection:structuredClone(f)}))}
}
const target=(storeId=7)=>({storeId,productId:42,janCode:jan})
const decode=(r=raw(),store=7)=>inspectionApi.decodeProductEditInspection(target(store),r,now)

test('現行POS形式から業務値と店舗別候補を抽出し、セッションや保存ボタンは返さない',()=>{
  const f=parse()
  assert.equal(f.fields.name,'商品 & 名前');assert.equal(f.fields.cost,'75')
  assert.equal(f.settings.taxId,'0');assert.equal(f.settings.abbreviation,'既存略称')
  assert.deepEqual(f.groups.map(g=>g.id),['group-7','next-7'])
  assert.ok(!JSON.stringify(f).match(/private|doUpdate|doDelete|unknownButton|jsessionid/))
  assert.equal(parse(6).identity.groupId,'11099');assert.notEqual(parse(6).identity.posProductId,f.identity.posProductId)
})
test('通信hiddenの更新は業務指紋を変えず、説明・フリガナ・略称の外部変更は検出する',()=>{
  const f=parse()
  assert.equal(parse(7,{state:'another-private-state'}).settings.otherSettingsFingerprint,f.settings.otherSettingsFingerprint)
  for(const change of [{description:'変更後'},{kana:'変更後'},{short:'変更後'}]) assert.notEqual(parse(7,change).settings.otherSettingsFingerprint,f.settings.otherSettingsFingerprint)
  assert.equal(parse(7,{name:'次の商品名',cost:'65'}).settings.otherSettingsFingerprint,f.settings.otherSettingsFingerprint)
})
test('店舗・区分・JAN二欄・内部ID・隠れた所属の不一致は停止する',()=>{
  for(const change of [{group:'11099'},{sales:'1'},{id:''},{id:'<bad>'},{productCode:'9999999999999'},{makerCode:'9999999999999'},{productCode:'',makerCode:''}]) assert.throws(()=>parse(7,change))
  assert.equal(parse(7,{productCode:''}).identity.productCode,'')
  assert.throws(()=>gas.readPosProductEditForm_(form(7),6,jan))
})
test('欠落・重複・selectedなし店舗・複数選択・非対応価格方式は推測しない',()=>{
  const html=form()
  const reject=s=>assert.throws(()=>gas.readPosProductEditForm_(s,7,jan))
  reject(html.replace(input('goodsId-30','fixture-id-7','hidden'),''))
  reject(html.replace('</form>',input('goodsId-30','second-id','hidden')+'</form>'))
  reject(html.replace('value="11098" selected="selected"','value="11098"'))
  reject(html.replace('value="11097"','value="11097" selected'))
  reject(html.replace(radio('gdsGoodsPriceFlg','0',true),radio('gdsGoodsPriceFlg','0',false)))
  reject(html.replace(radio('gddPriceInputFlg','false',true),radio('gddPriceInputFlg','false',false)).replace(radio('gddPriceInputFlg','true',false),radio('gddPriceInputFlg','true',true)))
  reject(html.replace('<select name="'+prefix+'goodsGroup"','<select multiple name="'+prefix+'goodsGroup"'))
  reject(html.replace('</form>','</form>'+html))
  reject(html.replace('action="/hm-hmma','action="https://evil.test/hm-hmma'))
  reject(html.replace(input('doUpdate','','submit'),''))
  reject(html.replace('name="'+prefix+'goodsName"','name="'+prefix+'goodsName" name="ambiguous"'))
})
test('コメント・script・textarea内の偽フォームは項目として認識しない',()=>{
  const f=form(7,{description:'<input name="fake"> & 説明'})
  const safe=`<!-- ${form(6)} --><script>const html=${JSON.stringify(form(6))}</script>`+f
  assert.equal(gas.readPosProductEditForm_(safe,7,jan).identity.groupId,'11098')
  assert.throws(()=>gas.readPosProductEditForm_(form().replace('説明文','<script>説明文</script>'),7,jan))
})
test('templateや他タグの引用属性内の所属selectを実フォームとして受け入れない',()=>{
  const storeSelect=select('tenpoGroup',[{id:'11097',name:'全店'},{id:'11098',name:'対象店舗',selected:true}])
  const missing=form().replace(storeSelect,'')
  for(const fake of [`<template>${storeSelect}</template>`,`<noscript>${storeSelect}</noscript>`,`<div data-html='${storeSelect}'></div>`]) {
    assert.throws(()=>gas.readPosProductEditForm_(missing.replace('</form>',fake+'</form>'),7,jan))
  }
})
test('文字参照は一度だけdecodeし、未対応や省略形を勝手に保存値へ変えない',()=>{
  const nameInput=input('goodsName','商品 & 名前')
  const withValue=v=>form().replace(nameInput,`<input type="text" name="${prefix}goodsName" value="${v}">`)
  assert.equal(gas.readPosProductEditForm_(withValue('商品&nbsp;名前'),7,jan).fields.name,'商品\u00a0名前')
  assert.equal(gas.readPosProductEditForm_(withValue('商品&amp;nbsp;名前'),7,jan).fields.name,'商品&nbsp;名前')
  for(const v of ['商品&copy;名前','商品&nbsp 名前'])assert.throws(()=>gas.readPosProductEditForm_(withValue(v),7,jan))
})
test('表示専用class/style重複は無視するが、業務属性の重複は拒否する',()=>{
  const source=input('goodsName','商品 & 名前')
  const styled=source.replace('<input','<input class="legacy" class="second" style="width:100%" style="height:10px"')
  assert.equal(gas.readPosProductEditForm_(form().replace(source,styled),7,jan).fields.name,'商品 & 名前')
  assert.equal(gas.readPosProductEditForm_(form().replace(source,source.replace('<input','<input type="text"')),7,jan).fields.name,'商品 & 名前')
  assert.throws(()=>gas.readPosProductEditForm_(form().replace(source,source.replace('<input','<input type="hidden"')),7,jan))
  for(const attr of ['name="duplicate"','value="duplicate"','disabled disabled','onclick="a()" onclick="b()"']) {
    assert.throws(()=>gas.readPosProductEditForm_(form().replace(source,source.replace('<input',`<input ${attr}`)),7,jan))
  }
})
test('両検索・同一商品・同一snapshot・候補が揃ったDTOだけレビューへ渡す',()=>{
  const i=decode();assert.equal(i.snapshot.productId,42);assert.equal(i.choices.storeId,7)
  const cmd={kind:'update',operationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storeId:7,productId:42,expectedFingerprint:i.fingerprint,fields:{...i.snapshot.fields,name:'編集後商品'}}
  const review=reviews.buildProductEditReview(cmd,i.snapshot,i.choices,now)
  assert.deepEqual(plain(review.patch),{goodsName:'編集後商品'})
  for(const change of ['store','field','multi','identity','name','choice','hidden','stale']) {
    const r=raw()
    if(change==='store')r.storeId=6
    if(change==='field')r.searches[1].field='schGoodsId'
    if(change==='multi')r.searches[1].count=2
    if(change==='identity')r.searches[1].internalId='different-id'
    if(change==='name')r.searches[1].formInspection.fields.name='外部変更'
    if(change==='choice')r.searches[1].formInspection.groups[0].name='外部変更'
    if(change==='hidden')r.searches[1].formInspection.secret='private'
    if(change==='stale')r.capturedAt=now-120001
    assert.throws(()=>decode(r),change)
  }
})
test('メーカー品番のみ一致は許可し、0件・未検索・共有商品は拒否する',()=>{
  const r=raw();r.searches[0]={field:'schGoodsId',count:0,inspected:false}
  r.searches[1].formInspection=parse(7,{productCode:''});r.searches[1].productCodeMatches=false
  assert.equal(decode(r).snapshot.identity.productCode,'')
  r.searches[1]={field:'schMakerCd',count:0,inspected:false};assert.throws(()=>decode(r))
  assert.throws(()=>decode({...raw(),searches:[raw().searches[0]]}))
  const shared=raw();shared.searches[0].formInspection.identity.exclusiveStore=false;assert.throws(()=>decode(shared))
})
test('取得結果はコピーし、呼出元の後の変更でレビュー基準を変えない',()=>{
  const r=raw(),i=decode(r);r.searches[0].formInspection.fields.name='後の変更'
  assert.equal(i.snapshot.fields.name,'商品 & 名前')
})
test('GASの両検索からフォーム解析まで実行し、保存actionは一度も送らない',()=>{
  const simple=(id,fields)=>`<form id="${id}" action="/hm-hmma/view/hmma/hmma000/hmma00000.html">${Object.entries(fields).map(([k,v])=>`<input type="hidden" name="${id==='hmma00000Form'?'':'includeChildBody:'}${id}:${k}" value="${escape(v)}">`).join('')}</form>`
  const list=n=>`${n}件中`+simple('hmma02400Form',{schOfficeCd:'',schTenpoGroupNoSingle:'',schGoodsId:'',schMakerCd:'',schGoodsName:'',doSerchNormal:'','goodsItems:0:doHmma02402':'',doDelete:''})
  const edit=form(7,{productCode:'4902397868767',makerCode:'4902397868767'})
  const pages=[simple('hmma00000Form',{loginId:'',password:'',doLogin:''}),'portal',list(0),list(1),simple('hmma02402Form',{doHmma02403:''}),edit,list(0),list(1),simple('hmma02402Form',{doHmma02403:''}),edit]
  const calls=[],logs=[]
  const context=vm.createContext({Utilities:utilities,Logger:{log:s=>logs.push(s)},UrlFetchApp:{fetch:(url,options)=>{
    calls.push({url,options});const html=pages.shift();if(html===undefined)throw Error('Unexpected request')
    return {getResponseCode:()=>200,getContentText:()=>html,getHeaders:()=>({}),getAllHeaders:()=>({})}
  }}})
  vm.runInContext(read('gas/autoDownload.js')+'\n'+read('gas/posProductReadDiagnostic.js')+'\n'+read('gas/posProductForm.js'),context)
  context.getPOSConfig_=()=>({baseUrl:'https://cg8.power-k.jp/0D890OGI',loginId:'fixture-user',password:'private-password'})
  const result=context.diagnoseHontenProductEditInspection()
  assert.equal(result.fields.price,'126');assert.equal(result.identicalInspections,true)
  assert.equal(calls.length,10)
  for(const call of calls.filter(c=>c.options.payload))assert.ok(Object.keys(call.options.payload).every(k=>!/:doUpdate|:doDelete|:delflg/.test(k)))
  assert.ok(!logs.join('\n').match(/private-password|private-session-state/))
})
test('純粋フォーム解析とinspectはWeb公開・商品保存・DB・Drive更新を呼ばない',()=>{
  assert.doesNotMatch(read('gas/posProductForm.js'),/UrlFetchApp|PropertiesService|DriveApp|SpreadsheetApp|function do(?:Post|Get)|Logger\.log/)
  assert.doesNotMatch(read('next_app/lib/pos-products/edit-preparation.server.ts'),/['"]use server['"]|claimProductOperation|consumeProductEdit|executePosProduct|fetch\(/)
})

function preparationFixture({authorized=true,productStore=7,dbError=false,posFailure=false,operationStatus='prepared',registrationReplyLost=false,recoveryStatus=operationStatus,recoveryFailure=false,recoveryMismatch=false}={}) {
  const calls=[],query=[]
  let savedDispatch=null,preparedReview=null
  const operation={operationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actorId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',storeId:7,payloadHash:'a'.repeat(64),expectedResultFingerprint:'b'.repeat(64),version:0,status:operationStatus}
  const inspector={inspect:async target=>{calls.push('inspect');assert.equal(target.janCode,jan);if(posFailure)throw Error('private-password');return raw()}}
  const db={from:name=>{calls.push('db:'+name);const q={select:()=>q,eq:(key,val)=>{query.push([key,val]);return q},maybeSingle:async()=>({data:{id:42,store_id:productStore,jan_code:jan},error:dbError?'private-error':null})};return q}}
  const api=load('edit-preparation.server.ts',{
    '@/lib/supabase/server':{createClient:async()=>db},
    '@/lib/inventory/auth':{requireInventoryManagerAccess:async(_,store)=>{calls.push('authorize:'+store);if(!authorized)throw Error('denied');return{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}}},
    './inspection.server':{decodeProductEditInspection:(t,r)=>inspectionApi.decodeProductEditInspection(t,r,now)},
    './inspection-transport.server':{configuredPosProductInspector:()=>{calls.push('configure');return inspector}},
    './ledger.server':{
      prepareProductEditOperation:async(input,snapshot,choices,catalog)=>{calls.push('prepare');preparedReview=reviews.buildProductEditReview(input,snapshot,choices,now);return {operation,review:preparedReview,catalog}},
      loadProductEditDispatchRecovery:async(store,id)=>{calls.push('recover');assert.equal(store,7);assert.equal(id,operation.operationId);if(recoveryFailure)throw Error('fixed failure');return{operation:{...operation,status:recoveryStatus,payloadHash:recoveryMismatch?'c'.repeat(64):operation.payloadHash},dispatch:savedDispatch,receiptConsumedAt:null}},
      registerProductEditDispatch:async(op,input,inspection)=>{calls.push('register');assert.equal(op.status,'prepared');assert.equal(input.storeId,7);assert.equal(inspection.snapshot.productId,42);assert.equal(inspection.groups[0].id,'group-7');savedDispatch={registered:true,dispatchText:'fixed body',reviewedAt:now,command:{expiresAt:now+120000},review:{...preparedReview,savedBaseline:true}};if(registrationReplyLost)throw Error('fixed failure');return{operation:op,dispatch:savedDispatch}},
    },
  })
  const i=decode()
  const command={kind:'update',operationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storeId:7,productId:42,expectedFingerprint:i.fingerprint,fields:{...i.snapshot.fields,name:'新商品名'}}
  return {calls,query,run:()=>api.prepareProductEditFromPos(command,inspector),runConfigured:()=>api.prepareProductEditFromPos(command)}
}
test('準備経路はmanager認可→店舗別DB→POS取得→レビュー受付の順で接続する',async()=>{
  const before=process.env.POS_PRODUCT_WRITES_ENABLED
  delete process.env.POS_PRODUCT_WRITES_ENABLED
  const disabled=preparationFixture()
  await assert.rejects(disabled.run)
  assert.deepEqual(disabled.calls,[])
  process.env.POS_PRODUCT_WRITES_ENABLED='true'
  try {
    const f=preparationFixture(),result=await f.run()
    assert.deepEqual(f.calls,['authorize:7','db:products','inspect','prepare'])
    assert.deepEqual(f.query,[['store_id',7],['id',42]])
    assert.equal(result.catalog.group.id,'group-7');assert.equal(result.catalog.supplier,null)
    for(const opts of [{authorized:false},{productStore:6},{dbError:true}]) {
      const denied=preparationFixture(opts);await assert.rejects(denied.run);assert.ok(!denied.calls.includes('inspect'));assert.ok(!denied.calls.includes('prepare'))
    }
    const failed=preparationFixture({posFailure:true});await assert.rejects(failed.run,e=>!e.message.includes('private'));assert.ok(!failed.calls.includes('prepare'))
    const configured=preparationFixture();await configured.runConfigured()
    assert.deepEqual(configured.calls,['authorize:7','db:products','configure','inspect','prepare'])
    const rejected=preparationFixture({authorized:false});await assert.rejects(rejected.runConfigured);assert.ok(!rejected.calls.includes('configure'))
  } finally {if(before===undefined)delete process.env.POS_PRODUCT_WRITES_ENABLED;else process.env.POS_PRODUCT_WRITES_ENABLED=before}
})

test('専用フラグON時だけ固定登録し、prepared再受付/登録応答消失では本文・期限・基準を再利用する',async()=>{
  const beforeWrites=process.env.POS_PRODUCT_WRITES_ENABLED,beforeDispatch=process.env.POS_PRODUCT_DISPATCH_ENABLED
  process.env.POS_PRODUCT_WRITES_ENABLED='true';process.env.POS_PRODUCT_DISPATCH_ENABLED='true'
  try {
    const f=preparationFixture(),result=await f.run()
    assert.deepEqual(f.calls,['authorize:7','db:products','inspect','prepare','recover','register']);assert.equal(result.dispatch.registered,true)
    const repeated=await f.run()
    assert.equal(f.calls.filter(c=>c==='register').length,1);assert.equal(repeated.dispatch,result.dispatch);assert.equal(repeated.review.savedBaseline,true)
    assert.equal(repeated.dispatch.command.expiresAt,now+120000);assert.equal(repeated.dispatch.reviewedAt,now)
    const lost=preparationFixture({registrationReplyLost:true});await assert.rejects(lost.run)
    const recovered=await lost.run();assert.equal(lost.calls.filter(c=>c==='register').length,1);assert.equal(recovered.dispatch.dispatchText,'fixed body');assert.equal(recovered.review.savedBaseline,true)
    const already=preparationFixture({operationStatus:'dispatching'}),stored=await already.run()
    assert.equal(stored.operation.status,'dispatching');assert.ok(!already.calls.includes('register'))
    const advanced=preparationFixture({recoveryStatus:'dispatching'});assert.equal((await advanced.run()).operation.status,'dispatching');assert.ok(!advanced.calls.includes('register'))
    for(const opts of [{recoveryFailure:true},{recoveryMismatch:true}]) {const failed=preparationFixture(opts);await assert.rejects(failed.run);assert.ok(!failed.calls.includes('register'))}
    const denied=preparationFixture({authorized:false});await assert.rejects(denied.run);assert.ok(!denied.calls.includes('register'))
  } finally {
    if(beforeWrites===undefined)delete process.env.POS_PRODUCT_WRITES_ENABLED;else process.env.POS_PRODUCT_WRITES_ENABLED=beforeWrites
    if(beforeDispatch===undefined)delete process.env.POS_PRODUCT_DISPATCH_ENABLED;else process.env.POS_PRODUCT_DISPATCH_ENABLED=beforeDispatch
  }
})
