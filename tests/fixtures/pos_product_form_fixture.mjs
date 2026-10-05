// 合成フォームのみ。実POSのHTML・資格情報・hidden状態は保存しない。
export const jan = '0490123456789'
export const prefix = 'includeChildBody:hmma02403Form:'
const escape = value => String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
export const input = (key,value,type='text',extra='') => `<input type="${type}" name="${prefix+key}" value="${escape(value)}" ${extra}>`
const select = (key,options) => `<select name="${prefix+key}">${options.map(o=>`<option value="${escape(o.id)}" ${o.selected?'selected':''} ${o.disabled?'disabled':''}>${escape(o.name)}</option>`).join('')}</select>`
const radio = (key,value,checked) => input(key,value,'radio',checked?'checked':'')
export function form(store=7,override={}) {
  const group=store===7?'11098':'11099'
  const v={id:'fixture-id-'+store,name:'商品 & 名前',state:'synthetic-private-state',description:'説明\n次の行',...override}
  return '<form id="hmma02403Form" method="post" action="/hm-hmma/view/hmma/hmma024/hmma02403.html;jsessionid=fixture.jvm1?te-uniquekey=fixture">'+
    input('goodsId-30',v.id,'hidden')+input('goodsSalesKbn','2','hidden')+input('tenpoGroupHid',group,'hidden')+
    select('tenpoGroup',[{id:'11097',name:'全店'},{id:group,name:'対象店舗',selected:true}])+
    input('gdsPublicGoodsCd',jan)+input('gdsManufacturerPartNumber',jan)+input('goodsName',v.name,'text','maxlength="200"')+
    input('goodsNameKana','ショウヒン')+input('abbreviateGoodsName','既存略称')+input('gddGoodsPrice','126')+input('gddGoodsCost','75')+
    select('goodsGroup',[{id:'group-'+store,name:'店舗の分類',selected:true},{id:'next-'+store,name:'次の分類'}])+
    select('gddSupplierCd',[{id:'',name:'選択してください',selected:true},{id:'supplier-'+store,name:'店舗の仕入先'},{id:'disabled-'+store,name:'停止候補',disabled:true}])+
    select('goodsTax',[{id:'0',name:'消費税'}])+radio('gdsGoodsPriceFlg','0',true)+radio('gdsGoodsPriceFlg','1',false)+
    radio('gddPriceInputFlg','false',true)+radio('gddPriceInputFlg','true',false)+radio('gdsSupplierFlg','0',true)+radio('gdsSupplierFlg','1',false)+
    input('goodsDto4UpdSave',v.state,'hidden')+input('imageFileName','既存画像.png','hidden')+
    `<input type="hidden" name="te-conditions" value="${escape(v.state)}">`+
    `<textarea name="${prefix}sdGoodsText">${escape(v.description)}</textarea>`+
    input('checkedSetting','yes','checkbox','checked')+input('uncheckedSetting','no','checkbox')+
    input('ignored','disabled-value','text','disabled')+input('doUpdate','保存','submit')+input('doDelete','削除','submit')+'</form>'
}
