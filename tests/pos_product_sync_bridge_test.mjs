import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = name => readFileSync(new URL(`../gas/${name}`, import.meta.url), 'utf8')
function fixture(enabled=true) {
  const props={POS_PRODUCT_SYNC_FENCE_ENABLED:enabled?'true':'false',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-key'}
  const calls=[];let response={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storeId:6,startedAt:'2026-09-10T00:00:00Z'};let code=200
  const context=vm.createContext({PropertiesService:{getScriptProperties:()=>({getProperty:key=>props[key]??null})},
    Logger:{log:()=>{}},Utilities:{parseCsv:s=>s.split('\n').map(l=>l.split(',')),sleep:()=>{}},
    UrlFetchApp:{fetch:(url,options)=>{calls.push({url,options});return {getResponseCode:()=>code,getContentText:()=>JSON.stringify(response)}}}})
  vm.runInContext(source('importCSV.js'),context)
  vm.runInContext(source('posProductSync.js'),context)
  context.upsertProductMasterToSupabase_=()=>{throw new Error('legacy writes forbidden')}
  context.reconcileStaleProductStoreMembership_=()=>{throw new Error('legacy writes forbidden')}
  return {context,props,calls,setResponse:(v,c=200)=>{response=v;code=c}}
}
const csv = (jan='0490123456789', price='999', cost='499') => ['11054', 'わんわんペットセンター', '2',jan,'','犬フード','商品','',''+price,'','',cost].join(',')
const blob = text => ({getDataAsString:()=>text})

test('既定OFFとdry-runでは同期受付RPCを呼ばない',()=>{
  const f=fixture(false)
  assert.equal(f.context.beginCoordinatedProductMasterSync_('わんわん'),null)
  f.props.POS_PRODUCT_SYNC_FENCE_ENABLED='true'
  assert.equal(f.context.beginCoordinatedProductMasterSync_('わんわん',{dryRun:true}),null)
  assert.equal(f.calls.length,0)
})
test('取得前に店舗別の同期IDを受け取り、専用のservice資格情報だけを使う',()=>{
  const f=fixture();const run=f.context.beginCoordinatedProductMasterSync_('わんわん')
  assert.equal(run.storeId,6)
  assert.equal(f.calls[0].url,'https://fixture.supabase.co/rest/v1/rpc/begin_product_master_sync')
  assert.deepEqual(JSON.parse(f.calls[0].options.payload),{p_store_id:6})
  assert.equal(f.calls[0].options.headers.Authorization,'Bearer fixture-key')
  delete f.props.SUPABASE_SERVICE_ROLE_KEY;f.props.SUPABASE_KEY='legacy-key'
  assert.throws(()=>f.context.beginCoordinatedProductMasterSync_('わんわん'))
  assert.equal(f.calls.length,1)
})
test('商品全件と同期IDを一回のRPCへ渡し、旧upsert・無効化を呼ばない',()=>{
  const f=fixture();const run=f.context.beginCoordinatedProductMasterSync_('わんわん')
  f.setResponse({success:true,count:2,deactivatedCount:1,syncStartedAt:run.startedAt})
  const result=f.context.processProductMasterCSV_(blob(csv()+'\n'+csv('0490123456796')),'わんわん',run)
  assert.equal(result.count,2);assert.equal(f.calls.length,2)
  const payload=JSON.parse(f.calls[1].options.payload)
  assert.equal(payload.p_run_id,run.id);assert.equal(payload.p_store_id,6)
  assert.equal(payload.p_records.length,2);assert.equal(payload.p_records[0].jan_code,'0490123456789')
})
test('同期IDなし・店舗不一致・重複JAN・金額異常なら全件適用前に拒否する',()=>{
  const f=fixture();const run=f.context.beginCoordinatedProductMasterSync_('わんわん')
  for(const args of [[blob(csv()),'わんわん'],[blob(csv()),'本店',run],[blob(csv()+'\n'+csv()),'わんわん',run],[blob(csv('0490123456789','999','不明')),'わんわん',run]]) {
    assert.throws(()=>f.context.processProductMasterCSV_(...args))
  }
  assert.equal(f.calls.length,1)
})
test('競合・通信失敗の詳細を漏らさず、自動再送や旧同期への後退をしない',()=>{
  const f=fixture();const run=f.context.beginCoordinatedProductMasterSync_('わんわん')
  f.setResponse({code:'40001',message:'PRIVATE record or secret'},409)
  assert.throws(()=>f.context.processProductMasterCSV_(blob(csv()),'わんわん',run),e=>/取得し直|再同期/.test(e.message)&&!e.message.includes('PRIVATE'))
  assert.equal(f.calls.length,2)
})
test('不正な受付応答・適用件数不足を成功として返さない',()=>{
  const f=fixture();f.setResponse({id:'bad',storeId:6,startedAt:'bad'})
  assert.throws(()=>f.context.beginCoordinatedProductMasterSync_('わんわん'))
  const run={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storeId:6,startedAt:'2026-09-10T00:00:00Z'}
  f.setResponse({success:true,count:0})
  assert.throws(()=>f.context.processProductMasterCSV_(blob(csv()),'わんわん',run))
})

test('取得中にフラグをOFFにしても受付済みCSVを旧書込みへ戻さない',()=>{
  const f=fixture();const run=f.context.beginCoordinatedProductMasterSync_('わんわん')
  f.props.POS_PRODUCT_SYNC_FENCE_ENABLED='false'
  f.setResponse({success:true,count:1,deactivatedCount:0,syncStartedAt:run.startedAt})
  assert.equal(f.context.processProductMasterCSV_(blob(csv()),'わんわん',run).success,true)
  assert.equal(f.calls.length,2)
  assert.match(f.calls[1].url,/apply_product_master_sync$/)
})

test('CSV自身の店舗が違う・不明・商品名欠落なら一括適用しない',()=>{
  const f=fixture();const run=f.context.beginCoordinatedProductMasterSync_('わんわん')
  f.setResponse({success:true,count:1,deactivatedCount:0,syncStartedAt:run.startedAt})
  const other=csv('0490123456796')
  for(const invalid of [other.replace('11054','11053'),other.replace('11054',''),other.replace('わんわんペットセンター','からつケンネル本店'),other.replace(',商品,',',,')]) {
    assert.throws(()=>f.context.processProductMasterCSV_(blob(csv()+'\n'+invalid),'わんわん',run))
  }
  assert.equal(f.calls.length,1)
})
test('実ダウンロード経路はPOS取得より前に同期受付し、そのIDをCSV処理へ渡す',()=>{
  const code=source('autoDownload.js')
  const body=code.slice(code.indexOf('function downloadProductMasterFromPOS_('),code.indexOf('function findFormFieldKeyBySuffix_'))
  assert.ok(body.indexOf('beginCoordinatedProductMasterSync_')>=0)
  assert.ok(body.indexOf('beginCoordinatedProductMasterSync_')<body.indexOf('UrlFetchApp.fetch'))
  assert.match(body,/processProductMasterCSV_\(csvResponse\.getBlob\(\), storePrefix, syncContext\)/)
})

test('読取り診断は店舗別JANの同一行重複・区分違い・値違いを件数だけで区別する',()=>{
  const f=fixture();vm.runInContext(source('autoDownload.js'),f.context)
  const base=csv();const conflict=csv('0490123456796')
  const lines=[base,base,conflict,conflict.replace(',2,',',1,').replace(',999,',',1000,'),
    base.replace('11054','11053').replace('わんわんペットセンター','からつケンネル本店'),csv(''),csv('0490123456703','不明')]
  const result=f.context.inspectProductMasterCSV_(blob(lines.join('\n'))).syncSafety
  assert.equal(result.duplicateGroups,2)
  assert.equal(result.duplicateExtraRows,2)
  assert.equal(result.identicalRowGroups,1)
  assert.equal(result.conflictingRowGroups,1)
  assert.equal(result.mixedKindGroups,1)
  assert.equal(result.missingJanRows,1)
  assert.equal(result.invalidMoneyRows,1)
  assert.equal(result.rowsByKind['2'],6)
  assert.equal(result.differingColumns['2'],1)
  assert.equal(result.differingColumns['8'],1)
  assert.ok(!JSON.stringify(result).includes('0490123456789'))
  assert.ok(!JSON.stringify(result).includes('商品'))
  assert.equal(f.calls.length,0)
})
