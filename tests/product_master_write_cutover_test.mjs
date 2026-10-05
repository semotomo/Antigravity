import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const ts = createRequire(new URL('../next_app/package.json',import.meta.url))('typescript')
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8')
test('古い商品編集・追加・CSV・仕入先ActionはフラグOFFでもDB呼出し前に拒否する',async () => {
  const exports = {}, calls = []
  const fail = () => { calls.push('mutation'); throw Error('想定外の接続') }
  const imports = {'next/cache':{revalidatePath:fail,refresh:fail},'@/lib/products':{initialProductMutationState:{status:'idle',message:'',fieldErrors:{}}},
    '@/lib/productStores':{requireProductStore:fail},'@/lib/storeAuth':{getStoreContext:fail},'@/lib/supabase/server':{createClient:fail}}
  vm.runInNewContext(ts.transpileModule(read('next_app/app/actions/products.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
    {exports,process:{env:{}},console:{error(){}},require:name=>{assert.ok(Object.hasOwn(imports,name),name);return imports[name]}})
  for (const name of ['createNewProductAndMatchAction','updateProductAction','uploadProductMasterCsv','uploadSupplierCsv']) {
    const result = name.endsWith('Action') ? await exports[name]({}, {}) : await exports[name]({})
    assert.ok(result.status==='error'||result.success===false)
    assert.match(result.message,/直接変更・CSV取込みは停止/)
  }
  assert.deepEqual(calls,[])
})
test('GAS切替ONでは旧UPSERT/欠落商品のPATCHを接続前に拒否し、売上関数は影響を受けない', () => {
  const calls = [], context = vm.createContext({PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='POS_PRODUCT_MASTER_SYNC_ENABLED'?'true':'synthetic'})},
    UrlFetchApp:{fetch:()=>{calls.push('fetch');return {getResponseCode:()=>201}}},Logger:{log(){}},console})
  vm.runInContext(read('gas/importCSV.js'),context)
  assert.throws(()=>context.upsertProductMasterToSupabase_([],new Date().toISOString(),'本店'),/旧直接書込みは停止/)
  assert.throws(()=>context.reconcileStaleProductStoreMembership_('本店',new Date().toISOString()),/旧直接書込みは停止/)
  assert.deepEqual(calls,[])
  context.sendProductSalesDataToSupabase_([{transaction_date:'2026-10-05',store_name:'本店',product_name:'商品',quantity:1}])
  assert.deepEqual(calls,['fetch'])
})
