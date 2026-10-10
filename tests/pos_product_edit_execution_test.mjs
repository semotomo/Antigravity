import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { form, input, jan, prefix } from './fixtures/pos_product_form_fixture.mjs'

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const operationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actorId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const simple=(id,fields)=>`<form id="${id}" action="/hm-hmma/view/hmma/hmma000/hmma00000.html">${Object.entries(fields).map(([key,value])=>`<input type="hidden" name="${id==='hmma00000Form'?'':'includeChildBody:'}${id}:${key}" value="${value}">`).join('')}</form>`
const list=n=>`${n}件中`+simple('hmma02400Form',{schOfficeCd:'',schTenpoGroupNoSingle:'',schGoodsId:'',schMakerCd:'',schGoodsName:'',doSerchNormal:'','goodsItems:0:doHmma02402':'',doDelete:''})
const searchPages=(html,second=html)=>[list(0),list(1),simple('hmma02402Form',{doHmma02403:''}),html,list(0),list(1),simple('hmma02402Form',{doHmma02403:''}),second]
function setup(options={}) {
  const store=options.store??7, before=options.before??form(store), after=options.after??form(store,{name:'新しい名前'})
  const pages=[simple('hmma00000Form',{loginId:'',password:'',doLogin:''}),'portal',...searchPages(before,options.beforeSecond),...searchPages(after,options.afterSecond)]
  const calls=[],events=[],logs=[],receipts=new Set()
  let tick=1_800_000_000_000,saveCount=0,flagChecks=0
  const utilities={DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,text)=>[...createHash('sha256').update(text).digest()],
    getUuid:()=>operationId,newBlob:text=>({getBytes:()=>Buffer.from(text,'utf8')})}
  const context=vm.createContext({Utilities:utilities,Date:{now:()=>++tick},Logger:{log:value=>logs.push(String(value))},
    PropertiesService:{getScriptProperties:()=>({getProperty:name=>{
      flagChecks++
      return name==='POS_PRODUCT_EDIT_EXECUTION_ENABLED'&&options.enabled!==false&&(!options.disableAfterRead||flagChecks===1)&&(!options.disableAfterConsume||flagChecks<3)?'true':null
    }})},
    UrlFetchApp:{fetch:(url,request)=>{
      calls.push({url,request}); events.push('http')
      const isSave=request.method==='post'&&typeof request.payload==='string'
      if(isSave) {
        saveCount++;events.push('save')
        if(options.saveThrows)throw Error('synthetic-private-network-'+request.payload)
        return {getResponseCode:()=>options.saveCode??303,getContentText:()=>{throw Error('save HTML must not be read')},
          getHeaders:()=>({Location:options.saveLocation??'/hm-hmma/view/hmma/hmma024/hmma02400.html'}),getAllHeaders:()=>({'Set-Cookie':'synthetic=new-session; Path=/'})}
      }
      if(options.afterReadThrows&&saveCount)throw Error('synthetic-private-read-failure')
      const html=pages.shift(); if(html===undefined)throw Error('Unexpected request')
      return {getResponseCode:()=>200,getContentText:()=>html,getHeaders:()=>({}),getAllHeaders:()=>({'Set-Cookie':'synthetic=session; Path=/'})}
    }}})
  vm.runInContext(['gas/autoDownload.js','gas/posProductReadDiagnostic.js','gas/posProductForm.js','gas/posProductSubmission.js','gas/posProductEditExecution.js'].map(read).join('\n'),context)
  const config={baseUrl:'https://cg8.power-k.jp/0D890OGI',loginId:'fixture-user',password:'synthetic-private-password'}
  const command={operationId,actorId,storeId:store,janCode:jan,before:context.readPosProductEditForm_(before,store,jan),patch:options.patch??{goodsName:'新しい名前'},expiresAt:tick+120000}
  const consume=receipt=>{
    events.push('consume')
    if(options.expireDuringConsume)tick+=120001
    if(options.mutateDuringConsume)options.mutateDuringConsume(command)
    if(options.consumeThrows)throw Error('synthetic-private-consume-failure')
    if(options.receipt)return options.receipt(receipt)
    const accepted=options.accepted!==false&&!receipts.has(receipt.operationId)
    if(accepted)receipts.add(receipt.operationId)
    return {...receipt,accepted}
  }
  const execute=(c=command,port=consume)=>context.executePosProductEdit_(config,c,port)
  return {context,config,command,consume,execute,calls,events,logs,get saveCount(){return saveCount},
    retryReads:()=>pages.push(simple('hmma00000Form',{loginId:'',password:'',doLogin:''}),'portal',...searchPages(before))}
}

test('専用フラグOFF/永続実行権ポート欠落はPOSへ通信しない',()=>{
  for(const options of [{enabled:false},{}]) {
    const fixture=setup(options)
    const result=options.enabled===false?fixture.execute():fixture.execute(fixture.command,null)
    assert.equal(result.outcome,'not_sent');assert.equal(result.saveRequestStarted,false)
    assert.equal(fixture.calls.length,0)
  }
})

test('本店/わんわんの最新両検索→consume→保存1回→新規両検索/全設定照合を行う',()=>{
  for(const store of [7,6]) {
    const f=setup({store}),result=f.execute()
    assert.equal(result.outcome,'values_verified');assert.equal(result.saveRequestStarted,true)
    assert.equal(result.inspection.storeId,store);assert.equal(result.inspection.searches.length,2)
    assert.equal(result.inspection.searches[0].formInspection.fields.name,'新しい名前')
    assert.equal(f.calls.length,19);assert.equal(f.saveCount,1)
    assert.ok(f.events.indexOf('consume')<f.events.indexOf('save'))
    const save=f.calls.find(c=>typeof c.request.payload==='string')
    const body=new URLSearchParams(save.request.payload)
    assert.equal(body.get(prefix+'goodsName'),'新しい名前');assert.equal(body.get(prefix+'gddGoodsCost'),'75')
    assert.equal(body.getAll(prefix+'doUpdate').length,1);assert.equal(body.get(prefix+'doDelete'),null)
    assert.equal(save.request.followRedirects,false)
    for(const call of f.calls.filter(c=>c.request.payload&&typeof c.request.payload!=='string'))assert.ok(Object.keys(call.request.payload).every(k=>!/:doUpdate|:doDelete/.test(k)))
  }
})

test('実行権消費は操作/利用者/店舗/dispatchHashを束縛し、拒否/例外/曖昧ackでは保存0回',()=>{
  for(const options of [{accepted:false},{consumeThrows:true},{receipt:r=>({...r,storeId:6})},{receipt:r=>({...r,actorId:operationId})},
    {receipt:r=>({...r,dispatchHash:'0'.repeat(64)})},{receipt:r=>({...r,extra:'synthetic-private'})},{receipt:()=>true}]) {
    const f=setup(options),result=f.execute()
    assert.equal(result.outcome,'verification_required');assert.equal(result.saveRequestStarted,false)
    assert.equal(f.saveCount,0);assert.equal(f.calls.length,10)
    assert.doesNotMatch(JSON.stringify(result),/synthetic-private/)
  }
})

test('同じ操作の再配送を実行権消費で止め、保存POSTを再送しない',()=>{
  const f=setup();assert.equal(f.execute().outcome,'values_verified')
  f.retryReads()
  const result=f.execute()
  assert.equal(result.outcome,'verification_required');assert.equal(f.saveCount,1)
  assert.equal(f.events.filter(e=>e==='consume').length,2)
})

test('準備中の運用OFF/実行権消費中の期限切れは保存開始前に停止する',()=>{
  for(const options of [{disableAfterRead:true},{disableAfterConsume:true},{expireDuringConsume:true}]) {
    const f=setup(options),result=f.execute()
    assert.equal(result.code,'POS_PRODUCT_EDIT_EXECUTION_WINDOW_CLOSED');assert.equal(result.saveRequestStarted,false)
    assert.equal(f.saveCount,0)
  }
})

test('通常編集5項目と未設定仕入先を照合し、原価や分類を固定値にしない',()=>{
  const changed=form(7,{name:'新しい名前'})
    .replace(input('gddGoodsPrice','126'),input('gddGoodsPrice','999')).replace(input('gddGoodsCost','75'),input('gddGoodsCost','499'))
    .replace(/(<option value="group-7") selected/,'$1').replace(/(<option value="next-7")/,'$1 selected')
    .replace(/(<option value="") selected/,'$1').replace(/(<option value="supplier-7")/,'$1 selected')
  const f=setup({after:changed,patch:{goodsName:'新しい名前',goodsGroup:'next-7',gddGoodsPrice:'999',gddGoodsCost:'499',gddSupplierCd:'supplier-7'}})
  assert.equal(f.execute().outcome,'values_verified');assert.equal(f.saveCount,1)
  const before=form().replace(/(<option value="") selected/,'$1').replace(/(<option value="supplier-7")/,'$1 selected')
  const unset=setup({before,patch:{goodsName:'新しい名前',gddSupplierCd:''}})
  assert.equal(unset.execute().outcome,'values_verified')
})

test('期限切れ/過剰な期限は通信0、consume中の入力変更は送信内容を差し替えない',()=>{
  for(const expiresAt of [0,1_800_000_120_002,'tomorrow']) {
    const f=setup(),result=f.execute({...f.command,expiresAt})
    assert.equal(result.outcome,'not_sent');assert.equal(f.calls.length,0)
  }
  const f=setup({mutateDuringConsume:c=>{c.patch.goodsName='差し替え';c.storeId=6}})
  assert.equal(f.execute().outcome,'values_verified')
  assert.equal(new URLSearchParams(f.calls.find(c=>typeof c.request.payload==='string').request.payload).get(prefix+'goodsName'),'新しい名前')
})

test('店舗/JAN/内部ID/変更前値が違う場合はconsume前に保存準備を拒否する',()=>{
  for(const mutate of [c=>({...c,storeId:6}),c=>({...c,janCode:'4901234567890'}),
    c=>({...c,before:{...c.before,identity:{...c.before.identity,posProductId:'different'}}}),
    c=>({...c,before:{...c.before,fields:{...c.before.fields,name:'変更前が不一致'}}})]) {
    const f=setup(),result=f.execute(mutate(f.command))
    assert.equal(result.outcome,'not_sent');assert.equal(f.saveCount,0);assert.ok(!f.events.includes('consume'))
  }
})

test('任意URL/資格情報/未知キー/不正ID/JANや保存以外のpatchを入力できない',()=>{
  for(const mutate of [c=>({...c,url:'https://evil.test/'}),c=>({...c,password:'synthetic-private'}),
    c=>({...c,operationId:'bad'}),c=>({...c,actorId:null}),c=>({...c,janCode:123}),
    c=>({...c,patch:{doDelete:'true'}}),c=>({...c,patch:{goodsName:'新しい名前',tenpoGroup:'11099'}})]) {
    const f=setup(),result=f.execute(mutate(f.command))
    assert.equal(result.outcome,'not_sent');assert.equal(f.calls.length,0);assert.doesNotMatch(JSON.stringify(result),/synthetic-private|evil/)
  }
})

test('保存の成功画面/HTTP200だけでは成功にせず、新規取得値が違えば再確認扱い',()=>{
  for(const after of [form(),form(7,{name:'新しい名前',description:'説明が変化'}),form(7,{name:'新しい名前'}).replace('既存画像.png','別画像.png'),form(7,{name:'新しい名前',id:'別内部ID'}),form(6,{name:'新しい名前'})]) {
    const f=setup({after,saveCode:200}),result=f.execute()
    assert.equal(result.outcome,'verification_required');assert.equal(result.saveRequestStarted,true);assert.equal(f.saveCount,1)
  }
})

test('画像hiddenの欠落/重複/型変更/無効化/両検索不一致は保持確認不可として停止する',()=>{
  const image=input('imageFileName','既存画像.png','hidden')
  const invalid=[html=>html.replace(image,''),html=>html.replace(image,image+image),
    html=>html.replace(image,input('imageFileName','既存画像.png','text')),
    html=>html.replace(image,input('imageFileName','既存画像.png','hidden','disabled')),
    html=>html.replace('既存画像.png','別画像.png')]
  for(const change of invalid) {
    const before=setup({beforeSecond:change(form())}),prepared=before.execute()
    assert.equal(prepared.outcome,'not_sent');assert.equal(before.saveCount,0);assert.ok(!before.events.includes('consume'))
    const after=setup({afterSecond:change(form(7,{name:'新しい名前'}))}),verified=after.execute()
    assert.equal(verified.outcome,'verification_required');assert.equal(after.saveCount,1)
    assert.doesNotMatch(JSON.stringify(verified),/imageFileName|既存画像|別画像/)
  }
  const blank=html=>html.replace(image,input('imageFileName','','hidden'))
  const absentImage=setup({before:blank(form()),after:blank(form(7,{name:'新しい名前',state:'synthetic-private-next-state'}))})
  assert.equal(absentImage.execute().outcome,'values_verified')
})

test('保存直後の切断でも再送せず、独立した再取得値だけを確認する',()=>{
  const f=setup({saveThrows:true}),result=f.execute()
  assert.equal(result.outcome,'values_verified');assert.equal(result.responseReceived,false)
  assert.equal(f.saveCount,1);assert.doesNotMatch(JSON.stringify(result),/synthetic-private|payload|Cookie/)
})

test('保存後の取得失敗/不明応答は原文非公開・再確認扱いで再送0回',()=>{
  for(const options of [{afterReadThrows:true},{saveCode:500},{saveLocation:'https://evil.test/?secret=synthetic-private'}]) {
    const f=setup(options),result=f.execute()
    assert.equal(result.outcome,'verification_required');assert.equal(result.saveRequestStarted,true);assert.equal(f.saveCount,1)
    assert.ok(f.calls.every(c=>c.url.startsWith('https://cg8.power-k.jp/')))
    assert.doesNotMatch(JSON.stringify(result),/synthetic-private|evil|secret=/)
  }
})

test('multipart/空file/最新状態を保持し、公開結果に本文・hidden値・Cookieを含めない',()=>{
  const multipart=html=>html.replace('method="post"','method="post" enctype="multipart/form-data"').replace('</form>',input('uploadThumbnailFile','','file')+'</form>')
  const f=setup({before:multipart(form()),after:multipart(form(7,{name:'新しい名前',state:'synthetic-private-new-state'}))}),result=f.execute()
  assert.equal(result.outcome,'values_verified');assert.equal(f.saveCount,1)
  const save=f.calls.find(c=>typeof c.request.payload==='string')
  assert.match(save.request.contentType,/^multipart\/form-data; boundary=/);assert.match(save.request.payload,/filename=""/)
  assert.doesNotMatch(JSON.stringify(result),/synthetic-private|Content-Disposition|Cookie|payload|jsessionid|imageFileName|既存画像/)
  assert.doesNotMatch(f.logs.join('\n'),/synthetic-private|Content-Disposition|Cookie|jsessionid/)
})

test('保存アダプターを公開入口/所有者診断/既存同期へ接続しない',()=>{
  const source=read('gas/posProductEditExecution.js')
  assert.doesNotMatch(source,/function\s+(?:doGet|doPost|onOpen|onEdit)\b|Logger\.|console\.|DriveApp|SpreadsheetApp/)
  for(const p of ['gas/autoDownload.js','gas/importCSV.js','gas/posProductReadDiagnostic.js','gas/posProductInspection.js'])assert.ok(!read(p).includes('executePosProductEdit_'))
})

// 実DOMの項目名を使う合成契約。HTML/opaque値は架空で、両店舗の実保存保証ではない。
const syntheticImageState={
  'thumbnailImageUrl-30':'',
  'imageFileCnt-30':'synthetic-private-opaque-count+/=&unchanged',
  delImageFileUrl:'',
  goodsImageItemsSave:'synthetic-private-opaque-items+/=&unchanged',
}
function syntheticImageForm(store=7,override={},imageOverride={}) {
  const imageState={...syntheticImageState,...imageOverride}
  const hidden=Object.entries(imageState).map(([key,value])=>input(key,value,'hidden')).join('')
  return form(store,override).replace(input('imageFileName','既存画像.png','hidden'),hidden)
    .replace('method="post"','method="post" enctype="multipart/form-data"')
    .replace('</form>',input('uploadThumbnailFile','','file')+input('doThumbnailFileUpLoad','合成画像アップロード','submit')+'</form>')
}
function imageStateNotPublished(f,result) {
  assert.doesNotMatch(JSON.stringify(result),/synthetic-private|imageState|imageFileName|thumbnailImageUrl|imageFileCnt|delImageFileUrl|goodsImageItemsSave|Content-Disposition|Cookie|payload|jsessionid/)
  assert.ok(f.logs.length>0)
  for(const log of f.logs)assert.match(log,/^extractAllFormFields_: (?:全input数=3, 全select数=0, "hmma00000Form"マッチ=3|全input数=8, 全select数=0, "hmma02400Form"マッチ=8|全input数=1, 全select数=0, "hmma02402Form"マッチ=1)$/)
  assert.doesNotMatch(f.logs.join('\n'),/synthetic-private|imageState|imageFileName|thumbnailImageUrl|imageFileCnt|delImageFileUrl|goodsImageItemsSave|Content-Disposition|Cookie|payload|jsessionid/)
}

test('実項目名の合成4hidden契約は両店舗でopaqueを完全保持し、空fileと保存submitだけを送る',async()=>{
  for(const store of [7,6]) {
    const before=syntheticImageForm(store),after=syntheticImageForm(store,{name:'新しい名前',state:'synthetic-private-next-framework'})
    const f=setup({store,before,after}),result=f.execute()
    assert.equal(result.outcome,'values_verified');assert.equal(result.code,'POS_PRODUCT_EDIT_VALUES_VERIFIED')
    assert.equal(result.saveRequestStarted,true);assert.equal(result.responseReceived,true)
    assert.equal(result.inspection.storeId,store);assert.equal(result.inspection.searches.length,2)
    assert.equal(f.calls.length,19);assert.equal(f.saveCount,1);assert.equal(f.events.filter(e=>e==='consume').length,1)
    assert.ok(f.events.indexOf('consume')<f.events.indexOf('save'))
    const save=f.calls.find(c=>typeof c.request.payload==='string')
    assert.match(save.request.contentType,/^multipart\/form-data; boundary=/)
    assert.equal(save.request.followRedirects,false)
    const body=await new Response(save.request.payload,{headers:{'Content-Type':save.request.contentType}}).formData()
    for(const [key,value] of Object.entries(syntheticImageState))assert.deepEqual(body.getAll(prefix+key),[value])
    assert.equal(body.get(prefix+'imageFileName'),null)
    const emptyFile=body.getAll(prefix+'uploadThumbnailFile')
    assert.equal(emptyFile.length,1);assert.equal(emptyFile[0].name,'');assert.equal(emptyFile[0].size,0)
    assert.equal(emptyFile[0].type,'application/octet-stream')
    assert.equal(body.get(prefix+'goodsName'),'新しい名前');assert.equal(body.get(prefix+'gddGoodsCost'),'75')
    assert.equal(body.getAll(prefix+'doUpdate').length,1)
    assert.equal(body.get(prefix+'doDelete'),null);assert.equal(body.get(prefix+'doThumbnailFileUpLoad'),null)
    imageStateNotPublished(f,result)
  }
})

test('合成4hiddenの各欠落/重複/型変更/disabledをconsume前に拒否し秘密値を出さない',()=>{
  const before=syntheticImageForm(),after=syntheticImageForm(7,{name:'新しい名前'})
  for(const [key,value] of Object.entries(syntheticImageState)) {
    const control=input(key,value,'hidden')
    for(const [kind,replacement] of [['missing',''],['duplicate',control+control],['type',input(key,value,'text')],
      ['disabled',input(key,value,'hidden','disabled')]]) {
      const f=setup({before,beforeSecond:before.replace(control,replacement),after}),result=f.execute()
      assert.deepEqual(JSON.parse(JSON.stringify(result)),{outcome:'not_sent',code:'POS_PRODUCT_EDIT_PREPARE_REJECTED',saveRequestStarted:false,responseReceived:false},key+':'+kind)
      assert.equal(f.saveCount,0);assert.equal(f.events.filter(e=>e==='consume').length,0);assert.equal(f.calls.length,10)
      imageStateNotPublished(f,result)
    }
  }
})

test('合成4hiddenの空opaque/参照削除指定/別family混在/未知画像名/空file欠落/encoding変更はconsume前に拒否する',()=>{
  const before=syntheticImageForm(),after=syntheticImageForm(7,{name:'新しい名前'})
  const invalid=[
    ...['imageFileCnt-30','goodsImageItemsSave'].map(key=>[key+':empty',html=>html.replace(input(key,syntheticImageState[key],'hidden'),input(key,'','hidden'))]),
    ...['imageFileCnt-30','goodsImageItemsSave'].flatMap(key=>[['LF','\n'],['CR','\r'],['CRLF','\r\n'],['TAB','\t'],['NUL','\x00'],['DEL','\x7f']].map(([kind,value])=>
      [key+':'+kind,html=>html.replace(input(key,syntheticImageState[key],'hidden'),input(key,syntheticImageState[key]+value+'synthetic-private-tail','hidden'))])),
    ['reference',html=>html.replace(input('thumbnailImageUrl-30','','hidden'),input('thumbnailImageUrl-30','synthetic-private-image-reference','hidden'))],
    ['delete',html=>html.replace(input('delImageFileUrl','','hidden'),input('delImageFileUrl','synthetic-private-image-delete','hidden'))],
    ['mixed',html=>html.replace('</form>',input('imageFileName','synthetic-private-legacy-image','hidden')+'</form>')],
    ...['thumbnailImageUrl-31','imageFileCnt-31','goodsImageItemsSaveOther','delImageFileUrlOther','imageUnexpectedState'].map(key=>
      [key,html=>html.replace('</form>',input(key,'synthetic-private-unknown-image','hidden')+'</form>')]),
    ['file-missing',html=>html.replace(input('uploadThumbnailFile','','file'),'')],
    ['encoding',html=>html.replace('enctype="multipart/form-data"','enctype="application/x-www-form-urlencoded"')],
  ]
  for(const [kind,change] of invalid) {
    const f=setup({before,beforeSecond:change(before),after}),result=f.execute()
    assert.deepEqual(JSON.parse(JSON.stringify(result)),{outcome:'not_sent',code:'POS_PRODUCT_EDIT_PREPARE_REJECTED',saveRequestStarted:false,responseReceived:false},kind)
    assert.equal(f.saveCount,0);assert.equal(f.events.filter(e=>e==='consume').length,0);assert.equal(f.calls.length,10)
    imageStateNotPublished(f,result)
  }
})

test('合成opaque生成差は両検索で比較省略せずconsume前に停止する',()=>{
  const before=syntheticImageForm(),after=syntheticImageForm(7,{name:'新しい名前'})
  for(const key of ['imageFileCnt-30','goodsImageItemsSave']) {
    const second=before.replace(input(key,syntheticImageState[key],'hidden'),input(key,'synthetic-private-generated-difference','hidden'))
    const f=setup({before,beforeSecond:second,after}),result=f.execute()
    assert.deepEqual(JSON.parse(JSON.stringify(result)),{outcome:'not_sent',code:'POS_PRODUCT_EDIT_PREPARE_REJECTED',saveRequestStarted:false,responseReceived:false},key)
    assert.equal(f.saveCount,0);assert.equal(f.events.filter(e=>e==='consume').length,0);assert.equal(f.calls.length,10)
    imageStateNotPublished(f,result)
  }
})

test('合成4hiddenの保存後差分と保存後両検索の差分は再保存せず再確認扱いにする',()=>{
  const before=syntheticImageForm(),after=syntheticImageForm(7,{name:'新しい名前'})
  for(const [key,value] of Object.entries(syntheticImageState)) {
    const changed=after.replace(input(key,value,'hidden'),input(key,'synthetic-private-post-save-difference','hidden'))
    for(const options of [{after:changed,afterSecond:changed},{after,afterSecond:changed}]) {
      const f=setup({before,...options}),result=f.execute()
      assert.deepEqual(JSON.parse(JSON.stringify(result)),{outcome:'verification_required',code:'POS_PRODUCT_EDIT_VERIFY_REQUIRED',saveRequestStarted:true,responseReceived:true},key)
      assert.equal(f.saveCount,1);assert.equal(f.events.filter(e=>e==='consume').length,1)
      assert.ok(f.events.indexOf('consume')<f.events.indexOf('save'))
      imageStateNotPublished(f,result)
    }
  }
})
