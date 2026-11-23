'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
const start=source.indexOf('const HISTORY_EDIT_FIELDS=');
const end=source.indexOf('async function commitHistoryLocationEdit()',start);
assert.ok(start>0&&end>start,'Firestore過去日報の編集処理が必要');
const original={kind:'ride',status:'complete',
 id:'ride-demo',raw:{AL:'乗車地',AM:'降車地',K:'2200',N:'現',O:'',I:'1'},meta:{splitPayment:{second:'',manualSlot:null,manualAmount:''}}};
const clone=x=>JSON.parse(JSON.stringify(x));
const highway=require('../highway-sections.js');
let priceCalls=0,validationCalls=0;
const ctx={
 HISTORY_DEBUG:false,Set,Object,Number,String,JSON,Error,
 window:{TAXIAPP_HIGHWAY_SECTIONS:highway},
 number:v=>v===null||v===undefined||v===''?null:Number(v),
 TYPES:['G','D','乗','U'],
 PAYMENTS:[['現','現金'],['Q','QR決済'],['U','Uber'],['キ','キャンセル']],
 RAW_COLUMNS:[['K','メーター金額','精算']],
 updateDiscountForDraft:()=>{},
 validatePaymentBreakdown:()=>{validationCalls++;return [];},
 deriveRaw:(r)=>{priceCalls++;return {...r.raw,AQ:42}},
 historyCloudRows:[],historyLocationEdit:null,
 historyEditStorageKey:()=>'',localStorage:{},
 safeText:x=>String(x),deepCopy:clone
};
vm.createContext(ctx);
vm.runInContext(source.slice(start,end),ctx);
const makeDraft=()=>({
 sourceRecord:clone(original),al:'乗車地',am:'降車地',
 fields:{K:'2200',N:'現',O:'',I:'1'},
 metaFields:{uberAppDisplayed:'',uberReservation:'',uberTip:''},
 splitSecond:'',splitAmount:'',splitSlot:null
});
const updated=clone(original),draft=makeDraft();
draft.fields.K='2500';draft.fields.I='2';draft.splitSecond='Q';draft.splitAmount='1000';draft.splitSlot=0;
const count=ctx.applyHistoryBusinessEdits(updated,draft,{},'2026-10-22');
assert.ok(count>0);
assert.equal(updated.raw.K,'2500');
assert.equal(updated.raw.I,'2');
assert.equal(updated.raw.AQ,42,'正規のderiveRaw結果を使用');
assert.equal(updated.meta.splitPayment.second,'Q');
assert.equal(updated.meta.splitPayment.manualAmount,'1000');
assert.equal(updated.meta.splitPayment.manualSlot,0);
assert.equal(original.raw.K,'2200','元の乗務原本は不変');
assert.equal(priceCalls,1,'二重計算を行わない');
assert.equal(validationCalls,1,'正規の決済内訳検証を使用');
const noChange=clone(original);
assert.equal(ctx.applyHistoryBusinessEdits(noChange,makeDraft(),{},'2026-10-22'),0);
assert.equal(noChange.raw.K,'2200');
for(const [key,value] of [['K','-1'],['K','1.4'],['I','13'],['G','99:90'],['N','キ']]){
 const bad=makeDraft();bad.fields[key]=value;
 assert.throws(()=>ctx.applyHistoryBusinessEdits(clone(original),bad,{},'2026-10-22'),
  /不正|確認/,'不適切な値は拒否：'+key);
}
const negativeDistance=makeDraft();negativeDistance.fields.F='100';negativeDistance.fields.L='99';
assert.throws(()=>ctx.applyHistoryBusinessEdits(clone(original),negativeDistance,{},'2026-10-22'),/実車距離/);
const badDiscount=makeDraft();badDiscount.fields.AR='200';
assert.throws(()=>ctx.applyHistoryBusinessEdits(clone(original),badDiscount,{},'2026-10-22'),/割引区分/);
const dupe=makeDraft();dupe.splitSecond='現';dupe.splitAmount='500';dupe.splitSlot=0;
assert.throws(()=>ctx.applyHistoryBusinessEdits(clone(original),dupe,{},'2026-10-22'),/重複/);
const sections=[
 {mode:'実',entryIC:'A',entryTime:'10:00',entryKm:'1',exitIC:'B',exitTime:'10:10',exitKm:'4',fee:'400'},
 {mode:'実',entryIC:'C',entryTime:'10:30',entryKm:'6',exitIC:'D',exitTime:'10:50',exitKm:'9',fee:'300'}
];
const withHighway=clone(original);
withHighway.meta.highwaySections=clone(sections);
const multi=makeDraft();multi.sourceRecord=clone(withHighway);
multi.highwaySections=clone(sections);
multi.highwaySections[1].fee='500';
const multiUpdated=clone(withHighway);
ctx.applyHistoryBusinessEdits(multiUpdated,multi,{},'2026-10-22');
assert.equal(multiUpdated.meta.highwaySections[0].fee,'400');
assert.equal(multiUpdated.meta.highwaySections[1].fee,'500');
assert.equal(highway.aggregate(multiUpdated.meta.highwaySections).実.fee,900,'既存の高速計算による合計');
const badHighway=makeDraft();badHighway.sourceRecord=clone(withHighway);
badHighway.highwaySections=clone(sections);badHighway.highwaySections[1].exitKm='5';
assert.throws(()=>ctx.applyHistoryBusinessEdits(clone(withHighway),badHighway,{},'2026-10-22'),/高速区間/);
const legacyEmpty={id:'old-empty',kind:'empty',status:'complete',raw:{
 P:'空',Z:'入口',AB:'12.4',AF:'300',AG:'440',AH:'80',AL:'',AM:''},meta:{}};
const preparedEmpty=clone(legacyEmpty);
highway.initialize(preparedEmpty);
const emptyDraft={sourceRecord:preparedEmpty,al:'',am:'',
 highwaySections:clone(preparedEmpty.meta.highwaySections)};
emptyDraft.highwaySections[0].roadName='阪神高速 3号神戸線';
const correctedEmpty=clone(legacyEmpty);
ctx.applyHistoryBusinessEdits(correctedEmpty,emptyDraft,{},'2026-10-22');
assert.deepEqual([correctedEmpty.raw.AF,correctedEmpty.raw.AG,correctedEmpty.raw.AH],['300','440','80']);
assert.equal(correctedEmpty.raw.AB,'12.4','道路名の修正で片側しかない旧距離を保持');
assert.equal(correctedEmpty.meta.highwayEmptyRoadName,'阪神高速 3号神戸線');
assert.equal(correctedEmpty.meta.highwaySections,undefined,'旧形式のまま同じ内訳を保存');
emptyDraft.highwaySections[0].exitKm='20.4';
emptyDraft.highwaySections[0].exitIC='出口';
ctx.applyHistoryBusinessEdits(correctedEmpty,emptyDraft,{},'2026-10-22');
assert.equal(correctedEmpty.raw.AE,'20.4');
assert.equal(correctedEmpty.raw.AC,'出口');
emptyDraft.highwaySections=[];
ctx.applyHistoryBusinessEdits(correctedEmpty,emptyDraft,{},'2026-10-22');
assert.equal(correctedEmpty.raw.P,'');
assert.equal(correctedEmpty.raw.AF,'');
assert.equal(correctedEmpty.meta.highwayEmptyRoadName,undefined);

const preparedRide=clone(original);
highway.initialize(preparedRide);
const oldRideDraft={...makeDraft(),sourceRecord:preparedRide,highwaySections:[
 {mode:'実',roadName:'名神高速道路',entryIC:'吹田',entryTime:'',entryKm:'5',
  exitIC:'尼崎',exitTime:'',exitKm:'10',fee:'400'}]};
const correctedRide=clone(original);
ctx.applyHistoryBusinessEdits(correctedRide,oldRideDraft,{},'2026-10-22');
assert.equal(correctedRide.raw.P,'実','利用記録がなかった乗車に高速を追加');
assert.equal(correctedRide.raw.Q,'吹田');
assert.equal(correctedRide.meta.highwayRealRoadName,'名神高速道路');
console.log('Firestore過去日報：正式料金計算・複合決済・原本保護・不正値拒否を確認');
