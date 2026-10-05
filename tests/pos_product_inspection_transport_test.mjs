import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash, createHmac } from 'node:crypto'
import * as protocol from '../next_app/lib/pos-products/protocol.ts'

const require=createRequire(new URL('../next_app/package.json',import.meta.url)),ts=require('typescript')
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const module={exports:{}}
vm.runInNewContext(ts.transpileModule(read('next_app/lib/pos-products/inspection-transport.server.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {module,exports:module.exports,fetch,Response,AbortSignal,Buffer,TextDecoder,Uint8Array,URL,process,require:n=>n==='server-only'?{}:n==='./protocol'?protocol:(()=>{throw Error('Unexpected import')})()})
const api=module.exports
const secret='a'.repeat(64),url='https://script.google.com/macros/s/'+'b'.repeat(40)+'/exec'
const target={storeId:7,janCode:'0490123456789',operationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actorId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}
const config={enabled:true,url,secret}
const dto={storeId:7,janCode:target.janCode,capturedAt:Date.now(),searches:[]}
const envelope=(changes={})=>({version:1,success:true,...target,data:dto,...changes})
const request=(action='inspect',payload={operationId:target.operationId,storeId:target.storeId,janCode:target.janCode})=>JSON.stringify(protocol.signPosProductRequest({...target,action,payload},secret))
function gasFixture({enabled=true,signingSecret=secret,fail=false}={}) {
  const calls=[]
  const context=vm.createContext({Date,Utilities:{Charset:{UTF_8:'utf8'},DigestAlgorithm:{SHA_256:'sha256'},newBlob:s=>({getBytes:()=>[...Buffer.from(s)]}),
    computeDigest:(_,s)=>[...createHash('sha256').update(s).digest()],computeHmacSha256Signature:(s,k)=>[...createHmac('sha256',k).update(s).digest()]},
    PropertiesService:{getScriptProperties:()=>({getProperty:n=>n==='POS_PRODUCT_INSPECTION_ENABLED'?(enabled?'true':null):signingSecret})},
    getPOSConfig_:()=>({baseUrl:'https://cg8.power-k.jp/0D890OGI'}),inspectPosProductEdit_:(c,store,jan)=>{calls.push([store,jan]);if(fail)throw Error('private-cookie');return dto}})
  vm.runInContext(read('gas/posProductProtocol.js')+'\n'+read('gas/posProductInspection.js'),context)
  return {calls,run:body=>JSON.parse(JSON.stringify(context.handlePosProductInspection_(body)))}
}

test('認可済みターゲットを署名POSTし、GAS受付と相関する業務DTOだけ返す',async()=>{
  const handler=gasFixture(),calls=[]
  const inspector=api.createSignedPosProductInspector(config,async(dest,options)=>{
    calls.push([dest,options]);assert.equal(protocol.verifyPosProductRequest(options.body,secret).action,'inspect')
    return Response.json(handler.run(options.body))
  })
  assert.deepEqual(JSON.parse(JSON.stringify(await inspector.inspect(target))),dto)
  assert.equal(calls.length,1);assert.equal(calls[0][0],url);assert.equal(calls[0][1].redirect,'manual');assert.ok(calls[0][1].signal)
  assert.deepEqual(handler.calls,[[7,target.janCode]])
})
test('GAS結果リダイレクトは既知ホストへのGETだけで、署名本文を転送しない',async()=>{
  const calls=[],redirect='https://script.googleusercontent.com/macros/echo?user_content_key=fixture&lib=fixture'
  const inspector=api.createSignedPosProductInspector(config,async(dest,options)=>{
    calls.push([dest,options]);return calls.length===1?new Response(null,{status:302,headers:{location:redirect}}):Response.json(envelope())
  })
  assert.deepEqual(JSON.parse(JSON.stringify(await inspector.inspect(target))),dto);assert.equal(calls.length,2)
  assert.equal(calls[1][0],redirect);assert.equal(calls[1][1].method,'GET');assert.equal(calls[1][1].body,undefined);assert.equal(calls[1][1].headers,undefined)
  assert.equal(calls[0][1].signal,calls[1][1].signal)
})
test('無効設定・不正URL/鍵/店舗/JANは通信前に拒否する',async()=>{
  let calls=0;const fetcher=async()=>{calls++;return Response.json(envelope())}
  for(const c of [{...config,enabled:false},{...config,secret:''},{...config,url:url+'?token=private'},{...config,url:url.replace('script.google.com','evil.test')}])assert.throws(()=>api.createSignedPosProductInspector(c,fetcher))
  const inspector=api.createSignedPosProductInspector(config,fetcher)
  for(const t of [{...target,storeId:8},{...target,janCode:12345678},{...target,actorId:'bad'},{...target,operationId:'bad'}])await assert.rejects(()=>inspector.inspect(t))
  assert.equal(calls,0)
})
test('別ホスト転送・二回転送・巨大/HTML応答・相関違い・追加鍵を拒否する',async()=>{
  const responses=[()=>new Response(null,{status:302,headers:{location:'https://evil.test/macros/echo'}}),
    ()=>new Response(null,{status:307,headers:{location:'https://script.googleusercontent.com/macros/echo'}}),
    ()=>new Response('private-html',{headers:{'content-type':'text/html'}}),
    ()=>new Response('x'.repeat(524289),{headers:{'content-type':'application/json'}}),
    ...[{storeId:6},{janCode:'9999999999999'},{operationId:target.actorId},{actorId:target.operationId},{extra:'private'},{success:false}].map(c=>()=>Response.json(envelope(c)))]
  for(const response of responses) {
    let calls=0;const inspector=api.createSignedPosProductInspector(config,async()=>{calls++;return response()})
    await assert.rejects(()=>inspector.inspect(target),e=>!e.message.includes('private'));assert.equal(calls,1)
  }
  let calls=0;const twice=api.createSignedPosProductInspector(config,async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://script.googleusercontent.com/macros/echo?lib=fixture'}})})
  await assert.rejects(()=>twice.inspect(target));assert.equal(calls,2)
})
test('通信例外を漏らさず、自動再送を行わない',async()=>{
  let calls=0;const inspector=api.createSignedPosProductInspector(config,async()=>{calls++;throw Error('private-secret-cookie')})
  await assert.rejects(()=>inspector.inspect(target),e=>!e.message.includes('private'));assert.equal(calls,1)
})
test('異常ヘッダーや不正転送を拒否した時も本文を閉じる',async()=>{
  for(const options of [{headers:{'content-type':'text/html'}},{headers:{'content-type':'application/json','content-length':'524289'}},
    {status:302,headers:{location:'https://evil.test/macros/echo'}}]) {
    let cancelled=0,calls=0
    const body=new ReadableStream({cancel(){cancelled++}})
    const inspector=api.createSignedPosProductInspector(config,async()=>{calls++;return new Response(body,options)})
    await assert.rejects(()=>inspector.inspect(target));assert.equal(calls,1);assert.equal(cancelled,1)
  }
})
test('GASは専用フラグ・署名・inspect限定・正確なpayloadを確認してから読む',()=>{
  for(const opts of [{enabled:false},{signingSecret:''},{signingSecret:'b'.repeat(64)}]) {
    const handler=gasFixture(opts),result=handler.run(request());assert.equal(result.success,false);assert.equal(handler.calls.length,0)
  }
  for(const body of [request('dispatch'),request('reconcile'),request('inspect',{operationId:target.operationId,storeId:7,janCode:target.janCode,extra:'private'}),request('inspect',{operationId:target.operationId,storeId:7,janCode:'bad'}),'private-malformed']) {
    const handler=gasFixture(),result=handler.run(body);assert.equal(result.success,false);assert.equal(handler.calls.length,0);assert.ok(!JSON.stringify(result).includes('private'))
  }
  const failed=gasFixture({fail:true});assert.equal(failed.run(request()).success,false);assert.equal(failed.calls.length,1)
})
test('署名inspectは専用公開分岐だけへ接続し、トリガー・保存/DB処理を呼ばない',()=>{
  assert.doesNotMatch(read('gas/posProductInspection.js'),/function do(?:Post|Get)|Trigger|DriveApp|SpreadsheetApp|doUpdate|doDelete|Logger\.log/)
  assert.match(read('gas/autoDownload.js'),/POS_PRODUCT_PUBLIC_GATEWAY_ENABLED/)
  assert.match(read('gas/autoDownload.js'),/handlePosProductInspection_/)
  assert.doesNotMatch(read('next_app/lib/pos-products/inspection-transport.server.ts'),/['"]use server['"]|dispatch|claimProductOperation/)
})
