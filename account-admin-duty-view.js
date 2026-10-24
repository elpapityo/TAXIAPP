/* TAXIAPP 管理者用日報の読み取り専用表示。
 * Firestoreから受け取った値と保存済みの正式計算結果だけを表示する。
 * 料金・納金・手数料・走行距離の再計算は行わない。
 */
(function(root){
'use strict';
const PAYMENT_LABELS={
 '現':'現金','G':'GOペイ','D':'DiDiアプリ','U':'Uber',
 'Q':'QR決済','ク':'クレジット','交':'交通系IC',
 'チ':'チケット','乗':'乗込GOペイ','キ':'キャンセル'
};
const DISPATCH_LABELS={'G':'GO','D':'DiDi','U':'Uber','乗':'その他・無線'};
const SUMMARY_FIELDS=[
 ['meter','メーター売上','yen'],
 ['cashReceived','現金受取','yen'],
 ['cashDeposit','現金納金','yen'],
 ['rides','実車件数','count'],
 ['cancels','キャンセル件数','count'],
 ['goFee','GO手数料','yen'],
 ['uberFee','Uber手数料','yen'],
 ['uberSurcharge','Uber車内回収手数料','yen'],
 ['uberCrewShare','Uber乗務員還元','yen'],
 ['discount','割引額','yen'],
 ['realToll','実車高速料金','yen'],
 ['emptyToll','空車高速料金','yen'],
 ['reservation','予約料','yen'],
 ['tip','チップ','yen']
];
const RAW_FIELDS=[
 ['A','日報番号','text'],['C','受信・待機開始時刻','text'],['E','配車区分','dispatch'],
 ['G','乗車時刻','text'],['M','降車時刻','text'],
 ['AL','乗車地','text'],['AM','降車地','text'],
 ['D','乗車地（原本欄）','text'],['H','降車地（原本欄）','text'],
 ['I','男性人数','count'],['J','女性人数','count'],
 ['F','乗車時の距離','km'],['L','降車時の距離','km'],
 ['K','メーター金額','yen'],['N','支払方法','payment'],
 ['AN','料金記録値','yen'],['AO','預り金','yen'],['AP','おつり','yen'],
 ['AQ','GO手数料記録値','yen'],
 ['AR','割引額','yen'],['O','割引区分','text'],
 ['W','実車高速料金','yen'],['AI','空車高速料金','yen'],['P','高速利用区分','text'],
 ['Q','実車高速入口','text'],['T','実車高速出口','text'],
 ['X','実車高速区間距離','km'],['Y','実車高速免除距離','km'],
 ['Z','空車高速入口','text'],['AC','空車高速出口','text'],
 ['AJ','空車高速区間距離','km'],['AK','空車高速免除距離','km']
];
function present(value){return value!==null&&value!==undefined&&value!=='';}
function format(value,kind='text'){
 if(!present(value))return '未記録';
 if(kind==='payment')return PAYMENT_LABELS[value]||String(value);
 if(kind==='dispatch')return DISPATCH_LABELS[value]||String(value);
 if(kind==='yen'||kind==='km'||kind==='count'){
  const n=typeof value==='number'?value:Number(String(value).replace(/,/g,''));
  if(!Number.isFinite(n))return String(value);
  return n.toLocaleString('ja-JP')+(kind==='yen'?' 円':kind==='km'?' km':'');
 }
 return String(value);
}
function datetime(value){
 if(!present(value))return '未記録';
 if(typeof value==='string'&& /^\d{4}-\d\d-\d\d$/.test(value))return value.replace(/-/g,'/');
 const timestamp=typeof value==='string'?Date.parse(value):NaN;
 if(Number.isFinite(timestamp)){
  return new Date(timestamp).toLocaleString('ja-JP',{
   timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',
   hour:'2-digit',minute:'2-digit',hour12:false
  });
 }
 return String(value);
}
function el(tag,className,text){
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(text!==undefined)node.textContent=String(text);
 return node;
}
function info(section,label,value,kind='text',showEmpty=false){
 if(!showEmpty&&!present(value))return;
 const cell=el('div','admin-duty-value');
 cell.append(el('dt','',label),el('dd','',format(value,kind)));
 section.append(cell);
}
function panel(root,title){
 const section=el('section','admin-duty-panel');
 section.append(el('h3','',title));root.append(section);return section;
}
function grid(section){const dl=el('dl','admin-duty-grid');section.append(dl);return dl;}
function renderTotals(container,shift){
 const section=panel(container,'売上・手数料（保存済みの計算結果）');
 const summary=shift.__taxiPrintSummary;
 if(!summary||typeof summary!=='object'||Array.isArray(summary)){
  section.append(el('p','admin-duty-note',
   'この原本には計算済み集計が保存されていません。金額の合計や手数料はこの画面では再計算しません。各営業の記録値を下で確認してください。'));
  return;
 }
 const values=grid(section);
 for(const [key,label,kind] of SUMMARY_FIELDS)info(values,label,summary[key],kind);
 if(summary.paymentTotals&&typeof summary.paymentTotals==='object'){
  const methods=panel(container,'決済内訳（保存済みの集計値）');
  const dl=grid(methods);
  for(const [key,value] of Object.entries(summary.paymentTotals)){
   if(present(value))info(dl,PAYMENT_LABELS[key]||key,value,'yen');
  }
 }
 if(!values.children.length)section.append(el('p','admin-duty-note','表示できる集計項目は保存されていません。'));
}
function renderRecord(section,record,index){
 const raw=record?.raw||{};
 const details=el('details','admin-duty-record');
 if(index===0)details.open=true;
 const kind=record?.kind==='ride'?'実車':record?.kind==='cancel'?'キャンセル':
  record?.kind==='empty'?'空車高速':record?.kind==='dispatch'?'迎車':'その他';
 const time=present(raw.G)?String(raw.G):present(raw.C)?String(raw.C):'時刻未記録';
 const title='No.'+String(present(raw.A)?raw.A:index+1)+'　'+kind+'　'+time+
  (present(raw.AL)?'　'+String(raw.AL)+' → '+(raw.AM||'未記録'):'');
 details.append(el('summary','',title));
 const values=grid(details);
 const fields=record?.kind==='cancel'?RAW_FIELDS:
  RAW_FIELDS.filter(([key])=>record?.kind==='ride'||
   ['A','C','E','G','M','W','AI','P','Q','T','X','Y','Z','AC','AJ','AK'].includes(key));
 for(const [key,label,formatKind] of fields){
  if(!present(raw[key]))continue;
  // D/H は AL/AM が存在すれば補助欄として重複表示しない。
  if(key==='D'&&present(raw.AL)||key==='H'&&present(raw.AM))continue;
  info(values,label,raw[key],formatKind);
 }
 if(Array.isArray(record?.payments)&&record.payments.length){
  const settlement=el('div','admin-duty-settlement');
  settlement.append(el('strong','', '保存済みの決済明細'));
  for(const item of record.payments){
   const label=PAYMENT_LABELS[item.type]||item.type||'決済';
   settlement.append(el('p','',label+
    '／受取 '+format(item.received,'yen')+'／会社 '+format(item.company,'yen')));
  }
  details.append(settlement);
 }else if(record?.meta?.splitPayment){
  details.append(el('p','admin-duty-note',
   '複合決済の入力情報があります。確定した金額別内訳が原本に保存されていない場合、この画面では計算しません。'));
 }
 if(!values.children.length)details.append(el('p','admin-duty-note','表示できる営業項目はありません。'));
 section.append(details);
}
function render(container,shift,meta={}){
 if(!container||!shift||typeof shift!=='object')throw Error('表示対象の日報原本がありません');
 container.textContent='';
 const title=panel(container,'乗務の基本情報');
 const overview=grid(title);
 info(overview,'乗務日',datetime(shift.date),'text',true);
 info(overview,'出庫日時',datetime(shift.startedIso||shift.startedAt),'text',true);
 info(overview,'入庫日時',datetime(shift.endedIso||shift.endedAt),'text',true);
 info(overview,'乗務状態',meta.trashed?'ゴミ箱':shift.endedAt||shift.endedIso?'入庫済み':'進行中','text',true);
 info(overview,'乗務ID',shift.id,'text',true);
 info(overview,'更新番号',meta.revision,'text',true);
 info(overview,'出庫時トリップ距離',shift.startingOdo,'km');
 info(overview,'入庫時トリップ距離',shift.endingOdo,'km');
 if(shift.gpsTrip&&present(shift.gpsTrip.tripKm)){
  info(overview,'GPSトリップ記録値',shift.gpsTrip.tripKm,'km');
 }
 renderTotals(container,shift);
 const list=panel(container,'乗車・精算・高速道路の営業記録');
 if(!Array.isArray(shift.records)||!shift.records.length){
  list.append(el('p','admin-duty-note','営業記録はありません。'));
 }else{
  list.append(el('p','admin-duty-note',
   '各行を選択すると明細が開きます。金額・距離は原本に保存された値です。'));
  shift.records.forEach((r,index)=>renderRecord(list,r,index));
 }
 const extras=panel(container,'待機・休憩などの記録');
 const extraGrid=grid(extras);
 if(Array.isArray(shift.waitSegments))info(extraGrid,'待機記録',shift.waitSegments.length+' 件');
 if(Array.isArray(shift.breaks))info(extraGrid,'休憩記録',shift.breaks.length+' 件');
 if(!extraGrid.children.length)extras.append(el('p','admin-duty-note','追加の記録件数は未保存です。'));
 const fallback=el('details','admin-duty-source');
 fallback.append(el('summary','','元の内部データを確認する（調査用）'));
 fallback.append(el('p','admin-duty-note','通常の閲覧では開く必要はありません。'));
 fallback.append(el('pre','admin-duty-raw',JSON.stringify(shift,null,2)));
 container.append(fallback);
}
root.TAXIAPP_ADMIN_DUTY_VIEW={render};
})(window);
