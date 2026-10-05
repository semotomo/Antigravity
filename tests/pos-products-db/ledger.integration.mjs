import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test, { before, after } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const manager6 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const manager7 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const staff6 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const another6 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const fingerprint = 'a'.repeat(64)
const fields = {name:'試験商品', groupId:'group-test', price:'1000', cost:'500', supplierId:null}
const command = (overrides={}) => ({kind:'create', operationId:randomUUID(), storeId:6, janCode:'0490123456789', fields:{...fields},...overrides})
const hash = text => createHash('sha256').update(text).digest('hex')

before(async () => {
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
    CREATE TABLE public.stores(id integer PRIMARY KEY);
    CREATE TABLE public.products(id integer PRIMARY KEY, store_id integer NOT NULL REFERENCES public.stores(id),
      jan_code text, product_name text, updated_at timestamptz DEFAULT clock_timestamp(),
      UNIQUE(id,store_id), UNIQUE(store_id,jan_code));
    INSERT INTO public.stores VALUES (6),(7);
    INSERT INTO auth.users VALUES ('${manager6}'),('${manager7}'),('${staff6}'),('${another6}');
    INSERT INTO public.products(id,store_id,jan_code,product_name) VALUES
      (42,6,'4901234567890','わんわん商品'), (43,7,'4901234567890','本店商品');
  `)
  // 既存の権限helper・RLS・複合制約も本物のmigrationからロードする。
  await db.exec(await readFile(new URL('../../supabase/migrations/20260823163000_inventory_phase1_schema.sql', import.meta.url), 'utf8'))
  await db.exec(`INSERT INTO public.user_store_access(user_id,store_id,role) VALUES
    ('${manager6}',6,'manager'),('${manager7}',7,'manager'),('${staff6}',6,'staff'),('${another6}',6,'manager');`)
  for (const name of ['20260908120000_pos_product_operation_ledger.sql','20260908121000_pos_product_operation_functions.sql']) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'))
  }
})
after(async () => { await db.close() })

async function role(roleName, actor, action) {
  await db.exec(`SET ROLE ${roleName}`)
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor??''])
  try { return await action() } finally { await db.exec('RESET ROLE') }
}
async function prepare(c, actor=manager6, resultFingerprint=fingerprint) {
  const text=JSON.stringify(c)
  return role('service_role',null,async()=> (await db.query(
    'SELECT public.prepare_pos_product_operation($1,$2,$3,$4) AS result',
    [actor,text,c.kind==='create'?null:'pos-42',resultFingerprint])).rows[0].result)
}
async function claim(op, actor=op.actor_id, version=op.row_version) {
  return role('service_role',null,async()=> (await db.query(
    'SELECT public.claim_pos_product_operation($1,$2,$3,$4,$5) AS result',
    [actor,op.store_id,op.id,op.payload_hash,version])).rows[0].result)
}
async function event(op, name, verified=null, actor=op.actor_id) {
  return role('service_role',null,async()=> (await db.query(
    'SELECT public.record_pos_product_operation_result($1,$2,$3,$4,$5,$6,$7) AS result',
    [actor,op.store_id,op.id,op.payload_hash,op.row_version,name,verified])).rows[0].result)
}

test('受付は本人の店舗manager権限をDBで再確認する', async()=> {
  for (const actor of [manager7,staff6,randomUUID(),null]) await assert.rejects(prepare(command(),actor),/access denied/)
  await assert.rejects(prepare(command({storeId:7})),/access denied/)
})
test('操作IDの再受付は同じ内容だけ返し、監査やロックを重複作成しない',async()=> {
  const c=command()
  const op=await prepare(c)
  assert.equal(op.payload_hash,hash(JSON.stringify(c)))
  assert.equal((await prepare(c)).id,op.id)
  await assert.rejects(prepare({...c,fields:{...fields,price:'900'}}),/operation conflict/)
  await assert.rejects(prepare(c,another6),/operation conflict/)
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.pos_product_operation_events WHERE operation_id=$1',[op.id])).rows[0].count,1)
  await event(op,'reject_before_dispatch')
})
test('同店舗JANの別操作は排他し、他店舗の同じJANとは独立する',async()=> {
  const op=await prepare(command())
  await assert.rejects(prepare(command()),/resource busy/)
  const main=await prepare(command({storeId:7}),manager7)
  assert.equal(main.store_id,7)
  await event(op,'reject_before_dispatch'); await event(main,'reject_before_dispatch')
})
test('他店舗の商品ID、既存JANの新規作成、未実装の削除/JAN訂正を拒否する',async()=> {
  await assert.rejects(prepare(command({janCode:'4901234567890'})),/already exists/)
  const update={kind:'update',operationId:randomUUID(),storeId:6,productId:43,expectedFingerprint:fingerprint,fields}
  await assert.rejects(prepare(update),/product unavailable/)
  for (const kind of ['delete','change_jan']) await assert.rejects(prepare({...update,kind}),/unsupported command/)
})
test('SQLへ直接不正payloadを渡しても許可外項目や型を拒否する',async()=> {
  for (const c of [command({storeId:'6'}),command({extra:'unsafe'}),command({fields:{...fields,price:-1}}),
    command({fields:{...fields,supplierId:{secret:'x'}}}),command({fields:{...fields,cost:'1e3'}})]) await assert.rejects(prepare(c))
})
test('claimは一度だけtrueを返し、プロセス再起動相当の再claimで再送を許可しない',async()=> {
  const op=await prepare(command())
  const first=await claim(op)
  assert.equal(first.claimed,true)
  assert.equal(first.operation.send_attempts,1)
  assert.equal((await claim(op)).claimed,false)
  let uncertain=await event(first.operation,'outcome_unknown')
  assert.equal(uncertain.status,'uncertain')
  assert.equal((await claim(uncertain)).claimed,false)
  await assert.rejects(event(uncertain,'reject_before_dispatch'),/invalid transition/)
  // 結果不明はロックを解放しないので、新規作成による二重登録も阻止する。
  await assert.rejects(prepare(command()),/resource busy/)
})
test('POS確認前のDB成功を拒否し、照合不一致・古いversionを拒否する',async()=> {
  const op=await prepare(command({janCode:'0490123456796'}))
  const claimed=(await claim(op)).operation
  await assert.rejects(event(op,'dispatch_returned'),/version conflict/)
  const verifying=await event(claimed,'dispatch_returned')
  await assert.rejects(event(verifying,'pos_verified','b'.repeat(64)),/fingerprint mismatch/)
  const confirmed=await event(verifying,'pos_verified',fingerprint)
  assert.equal(confirmed.status,'pos_confirmed')
  const pending=await event(confirmed,'db_failed')
  assert.equal(pending.status,'db_pending')
  assert.equal((await claim(pending)).claimed,false)
  // DB反映transactionが未実装の間は、汎用イベントで完了を偽装できない。
  await assert.rejects(event(pending,'db_completed'),/invalid transition/)
})
test('受付後の権限剥奪もclaim時に検知する',async()=> {
  const op=await prepare(command({janCode:'0490123456703'}),another6)
  await db.query('DELETE FROM public.user_store_access WHERE user_id=$1',[another6])
  await assert.rejects(claim(op),/access denied/)
  await db.query("INSERT INTO public.user_store_access(user_id,store_id,role) VALUES ($1,6,'manager')",[another6])
  await event(op,'reject_before_dispatch')
})
test('authenticatedは自分の店舗内操作だけ読め、直接更新・claim・監査改変はできない',async()=> {
  const op=await prepare(command({janCode:'0490123456710'}))
  const own=await role('authenticated',manager6,()=>db.query('SELECT id FROM public.pos_product_operations WHERE id=$1',[op.id]))
  assert.equal(own.rows.length,1)
  for (const actor of [manager7,staff6,another6]) {
    const rows=await role('authenticated',actor,()=>db.query('SELECT id FROM public.pos_product_operations WHERE id=$1',[op.id]))
    assert.equal(rows.rows.length,0)
  }
  await role('authenticated',manager6,async()=> {
    await assert.rejects(db.query("UPDATE public.pos_product_operations SET status='completed' WHERE id=$1",[op.id]),/permission denied/)
    await assert.rejects(db.query('SELECT public.claim_pos_product_operation($1,6,$2,$3,0)',[manager6,op.id,op.payload_hash]),/permission denied/)
  })
  await role('service_role',null,async()=> {
    await assert.rejects(db.query('DELETE FROM public.pos_product_operation_events WHERE operation_id=$1',[op.id]),/permission denied/)
  })
  await assert.rejects(db.query('DELETE FROM public.pos_product_operation_events WHERE operation_id=$1',[op.id]),/append only/)
  await event(op,'reject_before_dispatch')
})
test('商品・棚卸し正本への書込みは操作台帳の処理では発生しない',async()=> {
  const rows=(await db.query('SELECT id,store_id,product_name FROM public.products ORDER BY id')).rows
  assert.deepEqual(rows,[{id:42,store_id:6,product_name:'わんわん商品'},{id:43,store_id:7,product_name:'本店商品'}])
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.inventory_sessions')).rows[0].n,0)
})

test('管理用SQLでも送信回数の巻戻し・状態飛ばし・監査識別子の変更を拒否する',async()=> {
  const op=await prepare(command({janCode:'0490123456727'}))
  await assert.rejects(db.query("UPDATE public.pos_product_operations SET status='completed',send_attempts=1,verified_fingerprint=expected_result_fingerprint,row_version=1,last_event='db_completed' WHERE id=$1",[op.id]),/invalid transition/)
  await assert.rejects(db.query("UPDATE public.pos_product_operations SET actor_id=$1,row_version=1 WHERE id=$2",[another6,op.id]),/immutable/)
  await event(op,'reject_before_dispatch')
})

test('編集操作は店舗と商品IDの予約を持ち、受付後にJANが変われば送信claimを拒否する',async()=> {
  const c={kind:'update',operationId:randomUUID(),storeId:6,productId:42,expectedFingerprint:fingerprint,fields}
  const op=await prepare(c)
  const locks=(await db.query('SELECT resource_key FROM public.pos_product_operation_locks WHERE operation_id=$1 ORDER BY resource_key',[op.id])).rows
  assert.deepEqual(locks,[{resource_key:'jan:4901234567890'},{resource_key:'product:42'}])
  await db.query("UPDATE public.products SET jan_code='4901234567897' WHERE id=42")
  try { await assert.rejects(claim(op),/product identity changed/) }
  finally { await db.query("UPDATE public.products SET jan_code='4901234567890' WHERE id=42") }
  await event(op,'reject_before_dispatch')
})

test('期限切れ・予約欠損ではclaimを拒否し、送信回数を増やさない',async()=> {
  const c=command({janCode:'0490123456734'});const text=JSON.stringify(c)
  // 過去時刻の初期行をテスト専用DBへ用意する。実在の商品・外部DBは使わない。
  const expired=(await db.query(`INSERT INTO public.pos_product_operations
    (id,store_id,actor_id,kind,jan_code,command_text,payload_hash,expected_result_fingerprint,dispatch_expires_at)
    VALUES ($1,6,$2,'create',$3,$4,$5,$6,clock_timestamp()-interval '1 minute') RETURNING *`,
    [c.operationId,manager6,c.janCode,text,hash(text),fingerprint])).rows[0]
  await assert.rejects(claim(expired),/expired/)
  assert.equal((await db.query('SELECT send_attempts FROM public.pos_product_operations WHERE id=$1',[expired.id])).rows[0].send_attempts,0)
  await event(expired,'reject_before_dispatch')
  const op=await prepare(command({janCode:'0490123456741'}))
  await db.query('DELETE FROM public.pos_product_operation_locks WHERE operation_id=$1',[op.id])
  await assert.rejects(claim(op),/reservation unavailable/)
  await event(op,'reject_before_dispatch')
})

test('適用前確認SQLは読取りだけで実行でき、操作データを変更しない',async()=> {
  const before=(await db.query('SELECT count(*)::int AS n FROM public.pos_product_operations')).rows[0].n
  const report=await db.exec(await readFile(new URL('../../supabase/preflight_pos_product_operation_ledger.sql',import.meta.url),'utf8'))
  assert.ok(report.some(r=>r.rows.some(row=>row.store_access_helper_exists===true)))
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.pos_product_operations')).rows[0].n,before)
})
