'use strict';
/** No real accounts, Firebase, GAS or sheets. Real production browser math
 * is evaluated with its actual calculation functions (no UI/data access).
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {makeTrustedPrintPacket}=require('../server-drafts/print-stage-v2-trusted-packet.js');
const {projectTrustedPacket}=require('../server-drafts/print-stage-legacy-rows.js');
const {prepareV2,decodeV2}=require('../server-drafts/print-stage-v2.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const uid='synthetic-owner',id='shift-1792550000000-standalone';
const extract=name=>{
 const start=html.indexOf('function '+name+'(');
 assert.ok(start>=0,'missing browser function '+name);
 const body=html.indexOf('){',start)+1;
 assert.ok(body>start,'missing function body '+name);
 let level=0,close=-1;
 for(let i=body;i<html.length;i++){
  if(html[i]==='{')level++;
  if(html[i]==='}'&&--level===0){close=i+1;break;}
 }
 assert.ok(close>body,'missing closing brace '+name);
 return html.slice(start,close);
};
const deps=['number','driverCollects','goCollectionFee',
 'hasRealHighway','hasEmptyHighway','calculatedDiscount','deriveRaw',
 'uberHasInCabPayment','uberAppAmounts','uberDispatchFeeApplies',
 'estimatedCashDue','splitPaymentMeta','paymentBreakdown','pricing',
 'settledTenderAmounts','totals','googleShiftPacket'];
const context={
 feeSettings:s=>({goFee:Number(s?.goFee??200),cancelFee:0,uberRate:0,
  uberSurcharge:Number(s?.uberSurcharge??100),uberCrewShare:0}),
 amount:v=>v===undefined||v===null||v===''?0:Number(v),
 amountDiscount:()=>0,
 dateStamp:()=> '2026-10-21'
};
vm.createContext(context);
vm.runInContext(deps.map(extract).join('\n'),context);
const browser=shift=>vm.runInContext('googleShiftPacket',context)(shift);
const shift=(records)=>({id,date:'2026-10-21',
 startedAt:'08:00',endedAt:'18:00',startedIso:'2026-10-20T23:00:00.000Z',
 endedIso:'2026-10-21T09:00:00.000Z',settings:{goFee:200,uberSurcharge:100},
 records});
const ride=(n,type='現',price=1000,toll=0)=>({
 kind:'ride',status:'complete',raw:{A:n,E:'G',N:type,
  K:price,W:toll,AQ:0,AR:0,AL:'【合成】乗車',AM:'【合成】降車',
  G:'08:10',M:'08:20'},
 meta:{}
});
const cancel=n=>({kind:'cancel',status:'complete',
 raw:{A:n,E:'G',K:700,N:'現',C:'09:10',AQ:200,
  AL:'【合成】キャンセル地点'},
 meta:{dispatchAt:'09:10',cancelAt:'09:15'}});
const cases=[
 ['GO現金＋QR複合',()=>{
  const a=ride(1);
  a.meta.splitPayment={second:'Q',manualSlot:0,manualAmount:'700'};
  return shift([a,cancel(2)]);
 }],
 ['GO現金のみ',()=>shift([ride(1)])],
 ['GO完全QR決済・高速500',()=>shift([ride(1,'Q',1000,500)])],
 ['GOペイ',()=>shift([ride(1,'G',1500,0)])],
 ['一般乗込クレジット',()=>shift([{...ride(1,'ク',2000,0),raw:{...ride(1,'ク',2000,0).raw,E:'D'}}])],
 ['複合金種・後側入力',()=>{
  const a=ride(1,'現',1800,0);
  a.meta.splitPayment={second:'ク',manualSlot:1,manualAmount:'800'};
  return shift([a]);
 }],
 ['キャンセルのみ',()=>shift([cancel(1)])]
];
for(const [name,build] of cases){
 const orig=build(),before=JSON.stringify(orig);
 const got=makeTrustedPrintPacket(orig),expected=browser(orig);
 assert.equal(JSON.stringify(orig),before,'must not modify input '+name);
 for(const key of Object.keys(got.summary)){
  assert.equal(got.summary[key],expected.summary[key],
   'browser parity for '+name+' summary.'+key);
 }
 for(let i=0;i<orig.records.length;i++){
  const ours=got.shift.records[i],theirs=expected.shift.records[i];
  for(const key of ['AQ','AR','K','N']){
   assert.equal(ours.raw[key],theirs.raw[key],
    'derived raw '+name+' #'+i+' '+key);
  }
  assert.deepEqual(ours.payments.map(p=>({...p})),theirs.payments.map(p=>({...p})),
   'trusted payment split must equal browser '+name);
 }
 const print=projectTrustedPacket({packet:got,sourceRevision:2});
 const packed=prepareV2({sourceUid:uid,sourceRevision:2,expectedCommittedRevision:0,virtual:print});
 assert.equal(decodeV2(packed,uid).rows['TAXIAPP_乗務一覧'][0][8],got.summary.meter);
 assert.equal(packed.chunks.join('').includes('splitPayment'),false);
}
const sample=cases[0][1]();
sample.records[0].payments=[{type:'現',received:999999,company:0}];
sample.records[0].amounts={goFee:999999};
const independent=makeTrustedPrintPacket(sample);
assert.equal(independent.shift.records[0].payments[0].received,700);
assert.equal(independent.shift.records[0].amounts.goFee,200);
const unsupported=[
 ['Uber',x=>x.records[0].raw.E='U'],
 ['障害割引',x=>x.records[0].raw.O='シ'],
 ['手入力割引',x=>x.records[0].raw.AR=100],
 ['空車高速',x=>x.records[0].raw.P='空'],
 ['空車高速距離',x=>x.records[0].raw.AI=100],
 ['高速区間詳細',x=>x.records[0].meta.highwaySections=[{}]],
 ['Uberチップ',x=>x.records[0].meta.uberTip='100'],
 ['料金手入力',x=>x.records[0].raw.AN='1000'],
 ['不正GO料金',x=>x.records[0].raw.AQ=300],
 ['複合金種不明',x=>x.records[0].meta.splitPayment={second:'Q'}],
 ['複合金種超過',x=>x.records[0].meta.splitPayment={second:'Q',manualSlot:0,manualAmount:'40000'}],
 ['番号不連続',x=>x.records[0].raw.A=2],
 ['入力途中',x=>x.records[0].status='draft'],
 ['未対応支払',x=>x.records[0].raw.N='UNKNOWN'],
 ['欠落メーター',x=>x.records[0].raw.K='']
];
for(const [label,mutation] of unsupported){
 const x=shift([ride(1)]);mutation(x);
 assert.throws(()=>makeTrustedPrintPacket(x),undefined,
  'unsupported '+label+' must refuse to emit print data');
}
const noGoSettings=shift([ride(1)]);delete noGoSettings.settings.goFee;
assert.throws(()=>makeTrustedPrintPacket(noGoSettings),/GO手数料/);
const negatives=shift([ride(1)]);negatives.records[0].raw.K=-1;
assert.throws(()=>makeTrustedPrintPacket(negatives),/金額/);
const over=shift(Array.from({length:61},(_,i)=>ride(i+1)));
assert.throws(()=>makeTrustedPrintPacket(over),/乗務形式/);
console.log('Stage15 trusted Firestore pricing PASS: browser formula parity in 7 synthetic cases, 15 fail-closed cases, forged totals ignored');
