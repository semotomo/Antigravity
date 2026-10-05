import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as crypto from 'node:crypto'
import vm from 'node:vm'

const require=createRequire(new URL('../next_app/package.json',import.meta.url)),ts=require('typescript')
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
function load(path,imports={}) {
 const module={exports:{}}
 vm.runInNewContext(ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {module,exports:module.exports,Buffer,Request,Response,TextDecoder,Uint8Array,AbortSignal,process,require:n=>n==='server-only'?{}:n==='node:crypto'?crypto:imports[n]??(()=>{throw Error('Unexpected import '+n)})()})
 return module.exports
}
const protocol=load('next_app/lib/pos-products/consume-protocol.server.ts')
const secret='d'.repeat(64),now=1_800_000_000_000
const target={operationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actorId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',storeId:6,dispatchHash:'c'.repeat(64)}
const sign=(changes={})=>protocol.signProductEditConsumeRequest({...target,...changes},secret,now)
const receipt=accepted=>({...target,accepted})
const flags=['POS_PRODUCT_WRITES_ENABLED','POS_PRODUCT_DISPATCH_ENABLED','POS_PRODUCT_CONSUME_ENABLED','POS_PRODUCT_CONSUME_SECRET','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']
async function configured(fn) {
 const old=Object.fromEntries(flags.map(k=>[k,process.env[k]]))
 for(const k of flags.slice(0,3))process.env[k]='true'
 process.env.POS_PRODUCT_CONSUME_SECRET=secret;process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='private-test-key'
 try {await fn()}finally {for(const k of flags)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k]}
}
function handlerFixture({answer=receipt(true),error=false,onRpc=()=>{},clock=()=>now}={}) {
 const calls=[]
 const api=load('next_app/lib/pos-products/consume-handler.server.ts',{'./consume-protocol.server':protocol,'@supabase/supabase-js':{createClient:()=>({rpc:(name,args)=>{calls.push({name,args});onRpc();return{abortSignal:async()=>({data:answer,error:error?'private-db-body':null})}}})}})
 const run=(body=JSON.stringify(sign()),options={})=>api.handleProductEditConsumeRequest(new Request('https://kennel-dashboard.vercel.app/api/pos-products/consume',{method:'POST',headers:{'content-type':'application/json',...options.headers},body}),clock)
 return{calls,run}
}
test('consumeは専用audience/鍵/店舗/操作/hash/30秒期限に束縛し、応答署名も要求単位で検証する',()=>{
 for(const storeId of [6,7]) {
  const request=sign({storeId}),verified=protocol.verifyProductEditConsumeRequest(JSON.stringify(request),secret,now)
  assert.equal(verified.storeId,storeId)
  for(const accepted of [true,false]) {
   const ack={...target,storeId,accepted},response=protocol.signProductEditConsumeResponse(request,ack,secret)
   assert.deepEqual(JSON.parse(JSON.stringify(protocol.verifyProductEditConsumeResponse(response,request,secret))),ack)
   assert.throws(()=>protocol.verifyProductEditConsumeResponse(response,protocol.signProductEditConsumeRequest({...target,storeId},secret,now+1),secret))
  }
 }
 for(const changes of [{storeId:7},{actorId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},{dispatchHash:'e'.repeat(64)},{audience:'kennel.pos-products.v1'},{issuedAt:now+5001},{expiresAt:now},{expiresAt:now+30001},{extra:'private'}]) {
  assert.throws(()=>protocol.verifyProductEditConsumeRequest(JSON.stringify({...sign(),...changes}),secret,now))
 }
 assert.throws(()=>protocol.verifyProductEditConsumeRequest(JSON.stringify(sign()),'e'.repeat(64),now))
 assert.throws(()=>protocol.verifyProductEditConsumeRequest('x'.repeat(8193),secret,now))
 assert.throws(()=>protocol.signProductEditConsumeResponse(sign(),{...receipt(true),extra:'private'},secret))
})
test('HTTP callbackは署名検証後に4引数RPCを1回だけ呼び、true/falseを署名付き・no-storeで返す',async()=>configured(async()=>{
 for(const accepted of [true,false]) {
  const fixture=handlerFixture({answer:receipt(accepted)}),response=await fixture.run()
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store')
  assert.equal(protocol.verifyProductEditConsumeResponse(await response.json(),sign(),secret).accepted,accepted)
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls)),[{name:'consume_pos_product_edit_dispatch',args:{p_actor_id:target.actorId,p_store_id:6,p_operation_id:target.operationId,p_dispatch_hash:target.dispatchHash}}])
 }
}))
test('既定OFF/不正署名/大きな本文/非JSON/認可DB拒否は消費せず、失敗本文に資格情報を出さない',async()=>configured(async()=>{
 for(const flag of flags.slice(0,3)) {
  process.env[flag]='false';const f=handlerFixture();assert.notEqual((await f.run()).status,200);assert.equal(f.calls.length,0);process.env[flag]='true'
 }
 for(const [body,options] of [['{}',{}],['x'.repeat(8193),{}],[JSON.stringify(sign()),{headers:{'content-type':'text/html'}}]]) {
  const f=handlerFixture();assert.notEqual((await f.run(body,options)).status,200);assert.equal(f.calls.length,0)
 }
 for(const options of [{error:true},{answer:{...receipt(true),storeId:7}},{answer:{...receipt(true),extra:'private-db-body'}}]) {
  const f=handlerFixture(options),response=await f.run();assert.notEqual(response.status,200);assert.equal(f.calls.length,1);assert.doesNotMatch(await response.text(),/private|test-key|supabase/)
 }
}))
test('本文await中にフラグOFF/鍵更新/期限切れになればRPCを呼ばない',async()=>configured(async()=>{
 const api=load('next_app/lib/pos-products/consume-handler.server.ts',{'./consume-protocol.server':protocol,'@supabase/supabase-js':{createClient:()=>{throw Error('RPC must not be reached')}}})
 for(const change of [()=>process.env.POS_PRODUCT_WRITES_ENABLED='false',()=>process.env.POS_PRODUCT_CONSUME_SECRET='e'.repeat(64),()=>{}]) {
  process.env.POS_PRODUCT_WRITES_ENABLED='true';process.env.POS_PRODUCT_CONSUME_SECRET=secret
  let reads=0
  const body=new ReadableStream({pull(controller){change();controller.enqueue(new TextEncoder().encode(JSON.stringify(sign())));controller.close()}})
  const req=new Request('https://kennel-dashboard.vercel.app/api/pos-products/consume',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'})
  const response=await api.handleProductEditConsumeRequest(req,()=>++reads>1?now+30000:now)
  assert.notEqual(response.status,200)
 }
}))
test('RPCのcommit後でも停止/鍵更新/期限切れはtrue応答を出さず、消費を再試行しない',async()=>configured(async()=>{
 for(const mode of ['flag','secret','expiry']) {
  process.env.POS_PRODUCT_CONSUME_ENABLED='true';process.env.POS_PRODUCT_CONSUME_SECRET=secret
  let clockNow=now
  const f=handlerFixture({clock:()=>clockNow,onRpc:()=>{
   if(mode==='flag')process.env.POS_PRODUCT_CONSUME_ENABLED='false'
   if(mode==='secret')process.env.POS_PRODUCT_CONSUME_SECRET='e'.repeat(64)
   if(mode==='expiry')clockNow=now+30000
  }})
  assert.notEqual((await f.run()).status,200);assert.equal(f.calls.length,1)
 }
}))
test('GAS専用POSTの完全一致だけCookieログインを使わず、隣接API/GETの認証を維持する',async()=>{
 const calls=[]
 const middleware=load('next_app/lib/supabase/middleware.ts',{'@supabase/ssr':{createServerClient:()=>{calls.push('client');return{auth:{getUser:async()=>({data:{user:null}})}}}},'next/server':{NextResponse:{next:()=>({kind:'next'}),redirect:url=>({kind:'redirect',path:url.pathname})}}})
 const run=(path,method)=>middleware.updateSession({method,nextUrl:{pathname:path,clone:()=>new URL('https://kennel-dashboard.vercel.app'+path)},cookies:{getAll:()=>[],set:()=>{}}})
 assert.equal((await run('/api/pos-products/consume','POST')).kind,'next');assert.equal(calls.length,0)
 for(const [path,method] of [['/api/pos-products/consume','GET'],['/api/pos-products/consume/','POST'],['/api/pos-products/consume/other','POST'],['/products','GET'],['/inventory','GET']]) {
  assert.equal((await run(path,method)).path,'/login')
 }
 assert.equal(calls.length,5)
 const route=load('next_app/app/api/pos-products/consume/route.ts',{'@/lib/pos-products/consume-handler.server':{handleProductEditConsumeRequest:async()=>({disabled:true})}})
 assert.equal(route.runtime,'nodejs');assert.equal(route.maxDuration,30);assert.equal((await route.POST(new Request('https://fixture.local'))).disabled,true)
})
