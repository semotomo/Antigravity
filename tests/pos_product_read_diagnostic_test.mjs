import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'

const read=name=>readFileSync(new URL('../gas/'+name,import.meta.url),'utf8')
const jan='4902397868767'
test('照合失敗時も項目の有無・空欄・一致の真偽だけを記録する',()=>{
  const f=fixture()
  f.setPages([form('hmma00000Form',{loginId:'',password:'',doLogin:''}),'portal',list(0),list(1),form('hmma02402Form',{doHmma02403:''}),form('hmma02403Form',{tenpoGroup:'private-wrong-store',gdsPublicGoodsCd:''})])
  assert.throws(()=>f.context.diagnoseHontenProductReadContract(),/EDIT_PARSE\/POS_READ_IDENTITY_MISMATCH/)
  const log=f.logs.find(s=>s.startsWith('POS_READ_IDENTITY_CHECK '))
  const checks=JSON.parse(log.slice('POS_READ_IDENTITY_CHECK '.length))
  assert.deepEqual(checks,{
    tenpoGroup:{present:true,nonEmpty:true,matches:false},
    gdsPublicGoodsCd:{present:true,nonEmpty:false,matches:false},
    gdsManufacturerPartNumber:{present:false,nonEmpty:false,matches:false},
  })
  assert.ok(!f.logs.join('\n').includes('private'))
})
test('既知画面だけにセッション接尾辞を許可し、パス迂回や別ホストを拒否する',()=>{
  const f=fixture()
  const base='https://cg8.power-k.jp/hm-hmma/view/hmma/'
  for(const path of ['hmma000/hmma00000','hmma030/hmma03000','hmma024/hmma02400','hmma024/hmma02402','hmma024/hmma02403']) {
    const url=base+path+'.html;jsessionid=fixture123.jvm1?te-uniquekey=fixture'
    assert.equal(f.context.posReadDiagnosticUrl_(url),url)
  }
  const page=base+'hmma030/hmma03000.html'
  for(const suffix of [';jsessionid=',';jsessionid=x/../hmma02401.html',';jsessionid=x;doDelete=true',';jsessionid=x%2Ftest',';jsessionid=x#fragment',';jsessionid=x\\path',';jsessionid='+'a'.repeat(129)]) assert.throws(()=>f.context.posReadDiagnosticUrl_(page+suffix))
  assert.throws(()=>f.context.posReadDiagnosticUrl_('https://evil.test/hm-hmma/view/hmma/hmma030/hmma03000.html;jsessionid=x'))
  assert.throws(()=>f.context.posReadDiagnosticUrl_(base+'hmma024/hmma02401.html;jsessionid=x'))
})
test('固定工程名・完全一致のエラーコードだけを公開する',()=>{
  const f=fixture()
  f.setPages([form('hmma00000Form',{loginId:'',password:''})])
  assert.throws(()=>f.context.diagnoseHontenProductReadContract(),/LOGIN_PAYLOAD\/POS_READ_ACTION_MISSING/)
  const g=fixture({response:()=>{throw Error('POS_READ_HTTP_FAILURE private-cookie')}})
  assert.throws(()=>g.context.diagnoseHontenProductReadContract(),e=>e.message.includes('LOGIN_GET/UNEXPECTED_ERROR')&&!e.message.includes('private'))
})
const input=(name,value='',type='hidden')=>`<input type="${type}" name="${name}" value="${value}">`
const form=(id,fields)=>`<form id="${id}" action="/hm-hmma/view/hmma/hmma000/hmma00000.html">${Object.entries(fields).map(([k,v])=>id==='hmma02403Form'&&k==='tenpoGroup'?`<select name="includeChildBody:${id}:${k}"><option value="11097">全店</option><option value="${v}" selected="selected">対象店舗</option></select>`:input((id==='hmma00000Form'?'':'includeChildBody:')+id+':'+k,v)).join('')}</form>`
const list=count=>`${count}件中`+form('hmma02400Form',{schOfficeCd:'',schTenpoGroupNoSingle:'',schGoodsId:'',schMakerCd:'',schGoodsName:'',doSerchNormal:'',doDelete:'', 'goodsItems:0:delflg':'true','goodsItems:0:doHmma02402':'',state:'private&amp;state'})
const edit=(id='internal-product-42',store='11098')=>form('hmma02403Form',{'goodsId-30':id,goodsSalesKbn:'2',tenpoGroup:store,gdsPublicGoodsCd:jan,gdsManufacturerPartNumber:jan,goodsDto4UpdSave:'private-state',doUpdate:''})
function fixture(overrides={}) {
  const calls=[];const logs=[]
  const config={baseUrl:'https://cg8.power-k.jp/0D890OGI',loginId:'fixture-user',password:'private-password'}
  let queue=[form('hmma00000Form',{loginId:'',password:'',doLogin:''}),'portal',list(0),list(1),form('hmma02402Form',{doHmma02403:'',doDelete:''}),edit(),list(0),list(1),form('hmma02402Form',{doHmma02403:''}),edit()]
  const context=vm.createContext({Logger:{log:v=>logs.push(v)},UrlFetchApp:{fetch:(url,options)=>{
    calls.push({url,options})
    if(overrides.response) return overrides.response(url,options)
    const text=queue.shift();if(text===undefined) throw Error('unexpected request')
    return {getResponseCode:()=>200,getContentText:()=>text,getHeaders:()=>({}),getAllHeaders:()=>({})}
  }}})
  vm.runInContext(read('autoDownload.js'),context)
  vm.runInContext(read('posProductReadDiagnostic.js'),context)
  context.getPOSConfig_=()=>config
  return {context,calls,logs,config,setPages:pages=>{queue=pages}}
}

test('店舗selectは明示選択のみ読み、欠落・重複・複数選択・推測を拒否する',()=>{
  const f=fixture();const read=f.context.posReadSelectedValue_
  const name='includeChildBody:hmma02403Form:tenpoGroup'
  const good=`<select onchange="if (x > 0) { const name='fake'; }" name="${name}"><option value="11097">全店</option><option selected value='11098'>本店</option></select>`
  assert.equal(read(good,name),'11098')
  assert.equal(read('<!-- <select name="broken"> -->'+good,name),'11098')
  for(const bad of ['',good+good,good.replace('selected ',''),good.replace('value="11097"','selected value="11097"'),good.replace('</select>',''),good.replace(`name="${name}"`,`name="${name}" name="other"`)]) assert.throws(()=>read(bad,name))
})

test('両JAN検索から編集フォームを読むが、保存/削除ボタンと認証情報は結果へ出さない',()=>{
  const f=fixture();const result=f.context.diagnoseHontenProductReadContract()
  assert.equal(result.searches.length,2)
  assert.ok(result.searches.every(r=>r.internalId==='internal-product-42'&&r.storeGroupId==='11098'))
  assert.ok(!JSON.stringify(result).includes('private'))
  for(const call of f.calls.filter(c=>c.options.payload)) {
    assert.ok(Object.keys(call.options.payload).every(k=>!/:doDelete|:doUpdate|:delflg/.test(k)))
    assert.equal(call.options.followRedirects,false)
  }
  assert.equal(f.calls.length,10)
  assert.ok(!f.logs.join('\n').includes('private-password'))
})

test('書込みボタン、外部URL、別会社、未対応店舗は通信前に拒否する',()=>{
  const f=fixture()
  for(const action of ['doUpdate','doInsert','doDelete','doHmma02401']) assert.throws(()=>f.context.posReadPayload_(edit(),'hmma02403Form',action,{}))
  for(const url of ['https://evil.test/x','https://cg8.power-k.jp.evil.test/0D890OGI','http://cg8.power-k.jp/0D890OGI','https://cg8.power-k.jp/other','https://cg8.power-k.jp/hm-hmma/view/hmma/hmma024/hmma02401.html']) assert.throws(()=>f.context.posReadDiagnosticUrl_(url))
  assert.throws(()=>f.context.posReadDiagnostic_(f.config,8,jan))
  assert.throws(()=>f.context.posReadDiagnostic_({...f.config,baseUrl:'https://other.test'},7,jan))
  assert.equal(f.calls.length,0)
})

test('転送先が外部の場合はCookieやログイン情報を転送しない',()=>{
  const f=fixture({response:()=>({getResponseCode:()=>302,getHeaders:()=>({Location:'https://evil.test/'}),getAllHeaders:()=>({'Set-Cookie':'private=cookie; Path=/'})})})
  assert.throws(()=>f.context.diagnoseHontenProductReadContract(),e=>!e.message.includes('private'))
  assert.equal(f.calls.length,1)
})

test('複数候補は詳細へ進まず、識別子欠落をJANで埋めない',()=>{
  const f=fixture()
  f.setPages([form('hmma00000Form',{loginId:'',password:'',doLogin:''}),'portal',list(0),list(2),list(0),list(1),form('hmma02402Form',{doHmma02403:''}),edit('')])
  const result=f.context.diagnoseHontenProductReadContract()
  assert.equal(result.searches[0].inspected,false)
  assert.equal(result.searches[0].count,2)
  assert.equal(result.searches[1].internalId,null)
  assert.equal(result.searches[1].internalIdPresent,false)
  assert.equal(f.calls.length,8)
})

test('店舗不一致・検索件数不明・フォーム欠落は詳細を出さず中止する',()=>{
  for(const resultPage of ['unknown',list(1)]) {
    const f=fixture()
    f.setPages([form('hmma00000Form',{loginId:'',password:'',doLogin:''}),'portal',list(0),resultPage,form('hmma02402Form',{doHmma02403:''}),edit('internal-id','11099')])
    assert.throws(()=>f.context.diagnoseHontenProductReadContract())
    assert.ok(f.logs.every(s=>!s.includes('internal-id')))
  }
})

test('診断をWeb Appへ公開せず、DB/Drive/トリガー/商品同期を呼ばない',()=>{
  const diagnostic=read('posProductReadDiagnostic.js')
  assert.doesNotMatch(diagnostic,/DriveApp|SpreadsheetApp|ScriptApp|SUPABASE|doPost|doGet|\.createTrigger\(|upsert|processProductMasterCSV_/)
  assert.ok(!read('autoDownload.js').includes('diagnoseHontenProductReadContract'))
})

test('任意名のsubmit/image/buttonも除外し、読取りactionを一つだけ送る',()=>{
  const f=fixture()
  const prefix='includeChildBody:hmma02400Form:'
  const html=list(0).replace('</form>',[
    input(prefix+'danger','delete','submit'),input(prefix+'imageDelete','','image'),
    input(prefix+'unknownButton','','button'),'<button name="'+prefix+'resetNow">reset</button>',
    '</form>',
  ].join(''))
  const payload=f.context.posReadPayload_(html,'hmma02400Form','doSerchNormal',{})
  for(const key of ['danger','imageDelete','unknownButton','resetNow','doDelete','goodsItems:0:delflg']) assert.ok(!(prefix+key in payload))
  assert.deepEqual(Object.keys(payload).filter(k=>/:do[A-Z]/.test(k)),[prefix+'doSerchNormal'])
  assert.equal(payload[prefix+'state'],'private&state')
  assert.equal(f.context.posReadDecode_('&QUOT;&#X41;&#65;'),'"AA')
})

test('通信例外に秘密情報があっても手動実行のエラーとログには出さない',()=>{
  const f=fixture({response:()=>{throw Error('private-password private-cookie private-html')}})
  assert.throws(()=>f.context.diagnoseHontenProductReadContract(),e=>!e.message.includes('private'))
  assert.ok(!f.logs.join('\n').includes('private'))
})

test('わんわん検索も店舗とグループを固定し、別店舗は拒否する',()=>{
  const f=fixture()
  f.setPages([form('hmma00000Form',{loginId:'',password:'',doLogin:''}),'portal',list(0),list(1),form('hmma02402Form',{doHmma02403:''}),edit('wanwan-id','11099'),list(0),list(0)])
  const result=f.context.posReadDiagnostic_(f.config,6,jan)
  assert.equal(result.searches[0].storeGroupId,'11099')
  const payloads=f.calls.map(c=>c.options.payload).filter(p=>p&&Object.keys(p).some(k=>k.endsWith(':doSerchNormal')))
  assert.equal(payloads.length,2)
  for(const p of payloads) {
    assert.equal(p['includeChildBody:hmma02400Form:schOfficeCd'],'11054')
    assert.equal(p['includeChildBody:hmma02400Form:schTenpoGroupNoSingle'],'11099')
  }
})
