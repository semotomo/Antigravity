import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { form,input,jan,prefix } from './fixtures/pos_product_form_fixture.mjs'

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const gas=vm.createContext({Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,text)=>[...createHash('sha256').update(text).digest()],
  getUuid:()=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',newBlob:text=>({getBytes:()=>Buffer.from(text,'utf8')})}})
vm.runInContext(['gas/posProductReadDiagnostic.js','gas/posProductForm.js','gas/posProductSubmission.js'].map(read).join('\n'),gas)
const plain=v=>JSON.parse(JSON.stringify(v))
const inspect=(html=form(),store=7)=>plain(gas.readPosProductEditForm_(html,store,jan))
const build=(html=form(),expected=inspect(),patch={goodsName:'新しい名前'},store=7)=>gas.buildPosProductEditSubmission_(html,store,jan,expected,patch)
const values=result=>new URLSearchParams(result.payload)
const get=(v,key)=>v.get(prefix+key)

const generatedScript=(markup='<input type="hidden" name="te-conditions" value="synthetic-generated-state">')=>`<script type="text/javascript">
<!--
var forms = ['hmmaLayoutForm', 'hmma02403Form'];
for (var i = 0, len = forms.length; i < len; ++i) {
  var span = document.createElement('span');
  span.style.display = 'none';
  span.style.position = 'absolute';
  var form = document.getElementById(forms[i]);
  form.appendChild(span);
  span.innerHTML = ${JSON.stringify(markup)};
}
//-->
</script>`
const generatedForm=(script=generatedScript(),store=7)=>'<form id="hmmaLayoutForm"></form>'+form(store).replace(/<input type="hidden" name="te-conditions"[^>]*>/,'')+script

test('実POSで確認したlanguage=JavaScript属性だけを許可し、他言語/外部script/未知属性を拒否する',()=>{
  for(const attributes of ['language="JavaScript" type="text/javascript"','type="text/javascript" LANGUAGE="javascript"','language="JAVASCRIPT"']) {
    const html=generatedForm(generatedScript().replace('type="text/javascript"',attributes))
    assert.equal(values(build(html,inspect(html))).get('te-conditions'),'synthetic-generated-state')
    assert.deepEqual(inspect(html),inspect(form()))
  }
  for(const attributes of ['language="VBScript" type="text/javascript"','language="JavaScript1.2" type="text/javascript"',
    'language="" type="text/javascript"','language="JavaScript" type="module"','language="JavaScript" src="https://evil.test/"',
    'language="JavaScript" defer','language="JavaScript" language="JavaScript"']) {
    const html=generatedForm(generatedScript().replace('type="text/javascript"',attributes))
    assert.throws(()=>build(html,inspect(html)),error=>/^POS_PRODUCT_FORM_REJECTED_GENERATED_FRAMEWORK_STATE/.test(error.message)&&!error.message.includes('evil'))
  }
})

test('生成状態の検査工程は固定コードだけで切り分け、受信値や例外原文を出さない',()=>{
  const source=generatedForm()
  const cases=[
    [generatedForm(generatedScript()+generatedScript()),'SCRIPT_CANDIDATES'],
    [source.replace('<form id="hmmaLayoutForm"></form>',''),'FORM_REFERENCES'],
    [source.replace('type="text/javascript"','language="synthetic-secret"'),'SCRIPT_ATTRIBUTES'],
    [source.replace('var forms','throw new Error("synthetic-secret"); var forms'),'SCRIPT_GRAMMAR'],
    [generatedForm(generatedScript('<input type="text" name="te-conditions" value="synthetic-secret">')),'MARKUP'],
    [generatedForm(generatedScript('<input type="hidden" name="te-conditions" value="'+('x'.repeat(200001))+'">')),'STATE_VALUE'],
  ]
  for(const [html,phase] of cases) {
    assert.throws(()=>build(html,inspect(html)),error=>error.message==='POS_PRODUCT_FORM_REJECTED_GENERATED_FRAMEWORK_STATE_'+phase)
  }
})

test('既知Teeda生成scriptの状態を静的解析で保持し、DTOや業務指紋には含めない',()=>{
  const html=generatedForm(),result=build(html,inspect(html))
  assert.equal(values(result).get('te-conditions'),'synthetic-generated-state')
  assert.equal(values(result).getAll('te-conditions').length,1)
  assert.deepEqual(inspect(html),inspect(form()))
  assert.doesNotMatch(JSON.stringify(inspect(html)),/synthetic-generated|te-conditions/)
  const latest=generatedForm(generatedScript('<input type="hidden" name="te-conditions" value="synthetic-latest-generated">'))
  assert.equal(values(build(latest,inspect(html))).get('te-conditions'),'synthetic-latest-generated')
})

test('生成状態はHTML文字参照を一度だけ復号し、multipartにも保持する',async()=>{
  const html=generatedForm(generatedScript('<input name="te-conditions" type="hidden" value="a&amp;amp;&quot;日本語" />'))
    .replace('method="post"','method="post" enctype="multipart/form-data"').replace('</form><script',input('uploadThumbnailFile','','file')+'</form><script')
  const result=build(html,inspect(html))
  const body=await new Response(result.payload,{headers:{'content-type':result.contentType}}).formData()
  assert.equal(body.get('te-conditions'),'a&amp;"日本語')
  assert.equal(body.getAll('te-conditions').length,1)
})

test('生成scriptを実行せず、余分な文/式/別フォーム/表示状態の変更は固定コードで拒否する',()=>{
  for(const script of [generatedScript().replace('var forms','throw new Error("synthetic-secret-error"); var forms'),
    generatedScript().replace('form.appendChild(span);','form.appendChild(span); fetch("https://evil.test/");'),
    generatedScript().replace("'hmmaLayoutForm'","'otherForm'"),generatedScript().replace("'none'","'block'"),
    generatedScript().replace('span.innerHTML =','span.innerHTML +=')]) {
    const html=generatedForm(script)
    assert.throws(()=>build(html,inspect(html)),error=>/^POS_PRODUCT_FORM_REJECTED_GENERATED_FRAMEWORK_STATE/.test(error.message)&&!error.message.includes('synthetic'))
  }
})

test('生成markupは既知hidden1個だけを許可し、業務/操作項目や余分な属性を拒否する',()=>{
  for(const markup of ['<input name="te-conditions" type="text" value="x">','<input name="te-conditions" type="hidden" value="x" disabled>',
    '<input name="te-conditions" type="hidden" value="x" onclick="bad()">','<input name="te-conditions" name="other" type="hidden" value="x">',
    '<input name="te-conditions" type="hidden" value="x" style="display:block">','<input name="te-conditions" type="hidden" value="x" class="unknown">',
    '<input name="te-conditions" type="hidden" value="x"><input name="doDelete" value="1">','<span><input name="te-conditions" type="hidden" value="x"></span>',
    '<input name="te-conditions" type="hidden" value="x" form="otherForm">']) {
    const html=generatedForm(generatedScript(markup))
    assert.throws(()=>build(html,inspect(html)),/POS_PRODUCT_FORM_REJECTED_GENERATED_FRAMEWORK_STATE/)
  }
})

test('生成状態の重複、外部script、未対応エスケープ、巨大状態は拒否する',()=>{
  for(const html of [form()+generatedScript(),generatedForm(generatedScript()+generatedScript()),
    generatedForm(generatedScript().replace('<script type="text/javascript">','<script src="https://evil.test/" type="text/javascript">')),
    generatedForm(generatedScript().replace('synthetic-generated-state','synthetic\\u002dgenerated-state')),
    generatedForm(generatedScript('<input type="hidden" name="te-conditions" value="'+('x'.repeat(200001))+'">'))]) {
    assert.throws(()=>build(html,inspect(html)),/POS_PRODUCT_FORM_REJECTED_GENERATED_FRAMEWORK_STATE/)
  }
})

test('生成scriptは実コメント/他タグ属性の偽scriptを読まず、他店舗商品も拒否する',()=>{
  const html=generatedForm('<!--'+generatedScript('bad')+'-->'+generatedScript())
  assert.equal(values(build(html,inspect(html))).get('te-conditions'),'synthetic-generated-state')
  const wanwan=generatedForm(generatedScript(),6)
  assert.equal(values(build(wanwan,inspect(wanwan,6),{goodsName:'わんわんの編集'},6)).get('te-conditions'),'synthetic-generated-state')
  assert.throws(()=>build(wanwan,inspect(form()),{goodsName:'別店舗'},7))
})

test('状態項目が欠落または未知の生成方式なら省略した送信準備を作らない',()=>{
  for(const html of [generatedForm(''),generatedForm('<script>var unknownGenerator=true;</script>')]) {
    assert.deepEqual(inspect(html),inspect(form()))
    assert.throws(()=>build(html,inspect(html)),/POS_PRODUCT_FORM_REJECTED_GENERATED_FRAMEWORK_STATE/)
  }
})

test('生成scriptの参照先は先に成立した一意なformだけ、欠落/同ID別要素/入れ子を拒否する',()=>{
  const source=generatedForm()
  for(const html of [source.replace('<form id="hmmaLayoutForm"></form>',''),
    '<div id="hmma02403Form"></div>'+source,'<div id="hmma02403&#70;orm"></div>'+source,
    '<form id="hmmaLayoutForm"></form>'+source,source.replace('<form id="hmmaLayoutForm">','<div id="hmmaLayoutForm">').replace('</form>','</div>'),
    generatedScript()+generatedForm(''),source.replace('<form id="hmmaLayoutForm"></form>','<form id="hmmaLayoutForm">').replace('<script','</form><script')]) {
    assert.throws(()=>build(html,inspect(html)),/POS_PRODUCT_FORM_REJECTED_GENERATED_FRAMEWORK_STATE/)
  }
})

test('変更5項目だけを置換し、最新hidden・画像名・JAN・店舗・既存原価を保持する',()=>{
  const latest=form(7,{state:'synthetic-latest-state'})
  const result=build(latest),v=values(result)
  assert.equal(get(v,'goodsName'),'新しい名前');assert.equal(get(v,'gddGoodsCost'),'75')
  assert.equal(get(v,'goodsDto4UpdSave'),'synthetic-latest-state');assert.equal(v.get('te-conditions'),'synthetic-latest-state')
  for(const [key,value] of Object.entries({imageFileName:'既存画像.png',gdsPublicGoodsCd:jan,gdsManufacturerPartNumber:jan,tenpoGroup:'11098',tenpoGroupHid:'11098','goodsId-30':'fixture-id-7',goodsNameKana:'ショウヒン',abbreviateGoodsName:'既存略称',goodsTax:'0'}))assert.equal(get(v,key),value)
  assert.match(result.url,/^https:\/\/cg8\.power-k\.jp\/hm-hmma\//)
  assert.equal(result.contentType,'application/x-www-form-urlencoded')
  assert.ok(!JSON.stringify(inspect(latest)).includes('synthetic-latest-state'))
})
test('成功コントロールのみ送信し、保存submitは1つ、削除・unchecked・disabledは送らない',()=>{
  const v=values(build())
  assert.deepEqual(v.getAll(prefix+'doUpdate'),['保存'])
  for(const key of ['doDelete','uncheckedSetting','ignored'])assert.equal(get(v,key),null)
  assert.equal(get(v,'checkedSetting'),'yes')
  assert.deepEqual(v.getAll(prefix+'gdsGoodsPriceFlg'),['0']);assert.deepEqual(v.getAll(prefix+'gddPriceInputFlg'),['false'])
})
test('日本語・ampersand・空白・特殊記号とtextarea改行をブラウザの形式で送る',()=>{
  const result=build(form(7,{description:'説明\r\n2行目\r3行目'}),inspect(form(7,{description:'説明\n2行目\n3行目'})),{goodsName:"商品 & !'()~*"})
  const v=values(result)
  assert.equal(get(v,'goodsName'),"商品 & !'()~*")
  assert.equal(get(v,'sdGoodsText'),'説明\r\n2行目\r\n3行目')
  assert.match(result.payload,/%21%27%28%29%7E\*/)
})
test('商品グループ・仕入先は同店舗の有効候補だけ、未選択は空欄で送る',()=>{
  assert.equal(get(values(build(form(),inspect(),{goodsGroup:'next-7',gddSupplierCd:'supplier-7'})),'goodsGroup'),'next-7')
  assert.equal(get(values(build(form(),inspect(),{goodsName:'新しい名前',gddSupplierCd:''})),'gddSupplierCd'),'')
  for(const patch of [{goodsGroup:'next-6'},{gddSupplierCd:'supplier-6'},{gddSupplierCd:'disabled-7'},{goodsGroup:''}])assert.throws(()=>build(form(),inspect(),patch))
  assert.equal(get(values(build(form(6),inspect(form(6),6),{goodsName:'わんわんの変更'},6)),'tenpoGroup'),'11099')
  assert.throws(()=>build(form(6),inspect(),{goodsName:'他店'},7))
})
test('JAN・店舗・区分・税・画像・hidden等をpatchに混ぜた場合は停止する',()=>{
  for(const key of ['gdsPublicGoodsCd','gdsManufacturerPartNumber','tenpoGroup','goodsSalesKbn','goodsTax','imageFileName','goodsDto4UpdSave','doDelete','__proto__']) {
    const patch=JSON.parse(`{"goodsName":"新しい名前","${key}":"禁止"}`)
    assert.throws(()=>build(form(),inspect(),patch))
  }
})
test('外部で商品名・説明・ID・候補等が変わった場合、保存準備を停止する',()=>{
  for(const html of [form(7,{name:'外部変更'}),form(7,{id:'different'}),form(7,{description:'外部変更'}),form().replace('次の分類','候補変更')])assert.throws(()=>build(html))
  assert.throws(()=>build(form(),{...inspect(),extra:'untrusted'}))
})
test('整数円・名前・maxlength・readonlyを確認し、切り捨てや空欄補完はしない',()=>{
  for(const patch of [{gddGoodsCost:'0.5'},{gddGoodsPrice:'-1'},{gddGoodsPrice:'0126'},{gddGoodsCost:'1000000000'},{goodsName:''},{goodsName:'前後空白 '},{goodsName:'改\n行'}])assert.throws(()=>build(form(),inspect(),patch))
  const short=form().replace('maxlength="200"','maxlength="3"')
  assert.throws(()=>build(short,inspect(short),{goodsName:'4文字以上'}))
  const readonly=form().replace('maxlength="200"','maxlength="200" readonly')
  assert.throws(()=>build(readonly,inspect(readonly)))
  assert.equal(get(values(build(form(),inspect(),{gddGoodsCost:'0'})),'gddGoodsCost'),'0')
})
test('変更なし、未知のファイル、別form所有者、submit転送先は拒否する',()=>{
  assert.throws(()=>build(form(),inspect(),{}));assert.throws(()=>build(form(),inspect(),{goodsName:'商品 & 名前'}))
  for(const html of [form().replace('</form>',input('goodsImage','','file')+'</form>'),form()+'<input form="hmma02403Form" name="outside" value="bad">',form().replace(input('doUpdate','保存','submit'),input('doUpdate','保存','submit','formaction="https://evil.test/"'))])assert.throws(()=>build(html))
})
test('未対応の外側業務コントロール・重複Teeda状態は省略せず拒否する',()=>{
  for(const extra of ['<input name="outside-business" value="keep">','<input type="hidden" name="te-conditions" value="ambiguous">','<input type="hidden" name="doDelete" value="true">'])assert.throws(()=>build(form().replace('</form>',extra+'</form>')))
})
test('保存準備に通信・ログ・公開入口・DB操作が存在しない',()=>{
  assert.doesNotMatch(read('gas/posProductSubmission.js'),/UrlFetchApp|Logger\.log|PropertiesService|DriveApp|SpreadsheetApp|function do(?:Post|Get)/)
})

const multipart=(extra='')=>form().replace('method="post"','method="post" enctype="multipart/form-data"').replace('</form>',input('uploadThumbnailFile','','file',extra)+'</form>')
test('実フォームと同じmultipartは既存hiddenと未選択の空file partを保持する',async()=>{
  const html=multipart(),result=build(html,inspect(html),{goodsName:'画像は変更しない'})
  assert.match(result.contentType,/^multipart\/form-data; boundary=/)
  const body=await new Response(result.payload,{headers:{'content-type':result.contentType}}).formData()
  assert.equal(body.get(prefix+'goodsName'),'画像は変更しない')
  assert.equal(body.get(prefix+'imageFileName'),'既存画像.png')
  assert.equal(body.get('te-conditions'),'synthetic-private-state')
  assert.equal(body.get(prefix+'sdGoodsText'),'説明\r\n次の行')
  const emptyFile=body.get(prefix+'uploadThumbnailFile')
  assert.equal(emptyFile.name,'');assert.equal(emptyFile.size,0);assert.equal(emptyFile.type,'application/octet-stream')
  assert.deepEqual(body.getAll(prefix+'doUpdate'),['保存'])
  assert.equal(body.get(prefix+'doDelete'),null)
})
test('実ファイル値・複数file・未対応enctype・boundary衝突・不正Unicodeは停止する',()=>{
  for(const html of [multipart('multiple'),multipart('value="existing-file"'),multipart().replace('</form>',input('uploadThumbnailFile','','file')+'</form>'),form().replace('method="post"','method="post" enctype="text/plain"'),multipart().replace('synthetic-private-state','----KennelPosProductaaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa')])assert.throws(()=>build(html,inspect(html)))
  assert.throws(()=>build(form(),inspect(),{goodsName:'不正\ud800'}))
  assert.throws(()=>build(multipart(),inspect(multipart()),{goodsName:'不正\ud800'}))
})
test('hidden操作名や重複保存名を送らず、外側form所有者は引用符/文字参照に関係なく拒否する',()=>{
  for(const key of ['doDelete','doUpdate','doHmma02400','delflg'])assert.throws(()=>build(form().replace('</form>',input(key,'true','hidden')+'</form>')))
  for(const owner of ['hmma02403Form','"hmma02403Form"','"hmma02403&#70;orm"'])assert.throws(()=>build(form()+`<input form=${owner} name="outside-business" value="keep">`))
  const framework=form().replace('</form>','<input type="hidden" name="includeChildBody:hmma02403Form/view/hmma/hmma024/hmma02403.html" value="synthetic-framework-state"></form>')
  assert.equal(values(build(framework,inspect(framework))).get('includeChildBody:hmma02403Form/view/hmma/hmma024/hmma02403.html'),'synthetic-framework-state')
})
test('form actionのqueryに操作名・未知キー・重複キーを混入できない',()=>{
  for(const query of [prefix+'doDelete=true','doUpdate=1','te-uniquekey=fixture&doDelete=true','te-uniquekey=fixture&te-uniquekey=other','%74e-uniquekey=fixture','te-uniquekey=fixture%26doDelete%3Dtrue'])assert.throws(()=>build(form().replace('te-uniquekey=fixture',query)))
})
function checkOwnerSubmissionDiagnostic(edit,expectedFormInput) {
  const simple=(id,fields)=>`<form id="${id}" action="/hm-hmma/view/hmma/hmma000/hmma00000.html">${Object.entries(fields).map(([key,value])=>`<input type="hidden" name="${id==='hmma00000Form'?'':'includeChildBody:'}${id}:${key}" value="${value}">`).join('')}</form>`
  const list=n=>`${n}件中`+simple('hmma02400Form',{schOfficeCd:'',schTenpoGroupNoSingle:'',schGoodsId:'',schMakerCd:'',schGoodsName:'',doSerchNormal:'','goodsItems:0:doHmma02402':'',doDelete:''})
  edit=edit.replaceAll(jan,'4902397868767')
  const pages=[simple('hmma00000Form',{loginId:'',password:'',doLogin:''}),'portal',list(0),list(1),simple('hmma02402Form',{doHmma02403:''}),edit,list(0),list(1),simple('hmma02402Form',{doHmma02403:''}),edit]
  const calls=[],logs=[]
  const context=vm.createContext({Utilities:gas.Utilities,Logger:{log:s=>logs.push(s)},UrlFetchApp:{fetch:(url,options)=>{
    calls.push({url,options});const html=pages.shift();if(html===undefined)throw Error('Unexpected request')
    return {getResponseCode:()=>200,getContentText:()=>html,getHeaders:()=>({}),getAllHeaders:()=>({})}
  }}})
  vm.runInContext(['gas/autoDownload.js','gas/posProductReadDiagnostic.js','gas/posProductForm.js','gas/posProductSubmission.js'].map(read).join('\n'),context)
  context.getPOSConfig_=()=>({baseUrl:'https://cg8.power-k.jp/0D890OGI',loginId:'fixture-user',password:'synthetic-private-password'})
  const result=context.diagnoseHontenProductEditSubmission()
  assert.equal(result.preparedCount,2);assert.equal(result.contract.emptyFilePartCount,1);assert.equal(result.contract.updateActionCount,1)
  assert.equal(result.contract.productSaveSent,false);assert.equal(result.contract.encoding,'multipart/form-data')
  assert.equal(result.contract.stateControls.conditions.formEnabledHiddenCount,expectedFormInput)
  assert.equal(result.contract.stateControls.conditions.preparedEntryCount,1)
  assert.equal(result.contract.hasFrameworkState,true)
  assert.equal(calls.length,10)
  for(const call of calls.filter(c=>c.options.payload))assert.ok(Object.keys(call.options.payload).every(key=>!/:doUpdate|:doDelete|:delflg/.test(key)))
  assert.ok(!logs.join('\n').match(/synthetic-private|synthetic-generated|Content-Disposition|Cookie|jsessionid/))
  assert.doesNotMatch(JSON.stringify(result),/synthetic-private|synthetic-generated/)
}

test('所有者の組立診断は両検索後に本文を生成するだけで商品保存・秘密出力をしない',()=>{
  checkOwnerSubmissionDiagnostic(multipart(),1)
})

test('生成状態も両検索の所有者診断へ接続し、通信10回だけで保存・状態値出力をしない',()=>{
  for(const script of [generatedScript(),generatedScript().replace('<script ','<script language="JavaScript" ')]) {
    const edit=generatedForm(script).replace('method="post"','method="post" enctype="multipart/form-data"').replace('</form><script',input('uploadThumbnailFile','','file')+'</form><script')
    checkOwnerSubmissionDiagnostic(edit,0)
  }
})

test('状態診断は固定2項目の件数だけ返し、他formと組立漏れを区別する',()=>{
  const viewName='includeChildBody:hmma02403Form/view/hmma/hmma024/hmma02403.html'
  const html='<form id="hmmaLayoutForm"><input type="hidden" name="te-conditions" value="synthetic-private-layout"></form>'+
    form().replace('</form>',`<input type="hidden" name="${viewName}" value="synthetic-private-view"></form>`)
  const entries=gas.parsePosProductEditForm_(html,7,jan,true).submission.entries
  const result=plain(gas.posReadSubmissionStateCounts_(html,entries))
  assert.deepEqual(result,{
    conditions:{htmlInputCount:2,formInputCount:1,formEnabledHiddenCount:1,preparedEntryCount:1,scriptMentionCount:0},
    viewState:{htmlInputCount:1,formInputCount:1,formEnabledHiddenCount:1,preparedEntryCount:1,scriptMentionCount:0},
  })
  const omitted=plain(gas.posReadSubmissionStateCounts_(html,entries.filter(e=>e.name!=='te-conditions')))
  assert.equal(omitted.conditions.formEnabledHiddenCount,1);assert.equal(omitted.conditions.preparedEntryCount,0)
  assert.doesNotMatch(JSON.stringify(result),/synthetic-private|value|payload|Cookie/)
})

test('状態診断はscript内の名前参照と実HTMLのinputを区別し、偽タグ/コメントを数えない',()=>{
  const html=form().replace(/<input type="hidden" name="te-conditions"[^>]*>/,'')+
    '<!-- <input type="hidden" name="te-conditions" value="synthetic-private-comment"> -->'+
    '<script>var conditionName="te-conditions"; var example=\'<input name="te-conditions" value="synthetic-private-script">\';</script>'+
    '<textarea>&lt;input name="te-conditions"&gt;</textarea><div title="<input name=\'te-conditions\'>"></div>'
  const result=plain(gas.posReadSubmissionStateCounts_(html,[]))
  assert.deepEqual(result.conditions,{htmlInputCount:0,formInputCount:0,formEnabledHiddenCount:0,preparedEntryCount:0,scriptMentionCount:2})
  assert.equal(result.viewState.scriptMentionCount,0)
  assert.doesNotMatch(JSON.stringify(result),/synthetic-private|value|payload/)
})

test('状態診断は旧式コメント付きの実scriptだけを数え、コメント/属性/textareaの偽scriptを除外する',()=>{
  const html=form().replace(/<input type="hidden" name="te-conditions"[^>]*>/,'')+
    '<!-- <script>var hidden="te-conditions";</script> -->'+
    '<div title="<script>te-conditions</script>"></div>'+
    '<textarea><script>te-conditions</script></textarea>'+
    '<style><script>te-conditions</script></style>'+
    '<script type="text/javascript"><!--\nvar forms=["synthetic-private-form"];'+
    'var markup=\'<input type="hidden" name="te-conditions" value="synthetic-private-state">\';\n//--></script>'
  const result=plain(gas.posReadSubmissionStateCounts_(html,[]))
  assert.deepEqual(result.conditions,{htmlInputCount:0,formInputCount:0,formEnabledHiddenCount:0,preparedEntryCount:0,scriptMentionCount:1})
  assert.equal(result.viewState.scriptMentionCount,0)
  assert.doesNotMatch(JSON.stringify(result),/synthetic-private|value|payload|Cookie/)
})

test('状態診断はdisabled/text/文字参照名を数え分け、未知の属性値を出力しない',()=>{
  const html=form().replace('<input type="hidden" name="te-conditions"','<input disabled type="hidden" name="te-conditions"')
    .replace('</form>','<input type="text" name="te-conditio&#110;s" value="synthetic-private-text"></form>')
  const result=plain(gas.posReadSubmissionStateCounts_(html,[]))
  assert.deepEqual(result.conditions,{htmlInputCount:2,formInputCount:2,formEnabledHiddenCount:0,preparedEntryCount:0,scriptMentionCount:0})
  assert.throws(()=>gas.posReadSubmissionStateCounts_(null,[]))
  assert.throws(()=>gas.posReadSubmissionStateCounts_(form(),null))
})

test('状態診断は既存POSと同じ一致type重複に対応し、曖昧な属性は固定コードで停止する',()=>{
  const html=form().replace('<input type="hidden" name="te-conditions"','<input type="hidden" type="hidden" name="te-conditions"')
  assert.equal(gas.posReadSubmissionStateCounts_(html,[]).conditions.formEnabledHiddenCount,1)
  for(const duplicate of ['type="text"','name="other-name"']) {
    const ambiguous=form().replace('<input type="hidden" name="te-conditions"',`<input type="hidden" name="te-conditions" ${duplicate}`)
    assert.throws(()=>gas.posReadSubmissionStateCounts_(ambiguous,[]),/POS_PRODUCT_FORM_REJECTED_STATE_COUNTS/)
  }
})

test('状態診断は対象外の別formの曖昧な属性で既存の組立診断を止めない',()=>{
  for(const attributes of ['name="other" name="other2"','name="other" type="text" type="hidden"','name="other" disabled disabled','name="other&#111111111111;"']) {
    const html=`<form id="otherForm"><input ${attributes} value="synthetic-private-outside"></form>`+form()
    const entries=gas.parsePosProductEditForm_(html,7,jan,true).submission.entries
    assert.doesNotThrow(()=>build(html,inspect(html)))
    assert.equal(gas.posReadSubmissionStateCounts_(html,entries).conditions.formEnabledHiddenCount,1)
  }
})
