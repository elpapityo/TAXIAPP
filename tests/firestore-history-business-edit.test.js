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
let priceCalls=0,validationCalls=0;
const ctx={
 HISTORY_DEBUG:false,Set,Object,Number,String,JSON,Error,
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
console.log('Firestore過去日報：正式料金計算・複合決済・原本保護・不正値拒否を確認');
