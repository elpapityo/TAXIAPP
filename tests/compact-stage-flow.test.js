'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('index.html','utf8');
const scripts=[...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(v=>v[1]);
scripts.forEach(script=>new Function(script));
const main=scripts.find(v=>v.includes('function renderDrive(shift)'));
assert.ok(main,'main application script present');
const start=main.indexOf('function compactStageName(shift)');
const stop=main.indexOf('function renderDriveLayoutChooser()',start);
assert.ok(start>0&&stop>start,'standalone compact functions present');
const code=main.slice(start,stop);
const helpers={
 safeText:v=>String(v??''),shortTime:s=>String(s||'').slice(0,5),
 totals:()=>({meter:31400}),money:n=>'¥'+String(n||0),amount:n=>Number(n||0),
 number:n=>n==null||n===''?null:Number(n),waitingPlaces:()=>['川西能勢口','空港'],
 elapsedWaitingText:()=> '00:17',MAX_RECORDS:60,
 field:(key,raw)=>'<label>FIELD:'+key+'<input data-col="'+key+'" value="'+String(raw[key]??'')+'"></label>',
 locationField:(key,raw,label,action)=>'<div>LOCATION:'+key+'<button data-action="'+action+'">GPS</button></div>',
 selector:(k)=>'<div>SELECT:'+k+'</div>',
 passengerChoice:(k)=>'<div>PASSENGERS:'+k+'</div>',
 renderAllFields:()=>'<details>ALL RAW FIELDS A–AR</details>',
 renderRecent:()=>'<section>RECENT RECORDS</section>',
 metrics:()=>'<section>SUMMARY</section>',
 hasRealHighway:r=>r.P==='実'||r.P==='実空',
 hasEmptyHighway:r=>r.P==='空'||r.P==='実空',
 userFields:(keys)=>'<div>FIELDS:'+keys.join(',')+'</div>',
 paymentBreakdown:()=>({items:[],invalid:false}),
 cashChange:()=>({due:2400,change:0,shortage:0}),
 renderPaymentSplit:()=>'<section>PAYMENT SPLIT GO UBER</section>',
 feeSettings:()=>({uberSurcharge:100}),
 uberAppAmounts:()=>({valid:false}),
 uberDispatchFeeApplies:()=>false,
};
const ctx=vm.createContext(helpers);
vm.runInContext(code,ctx);
const get=(key,arg)=>vm.runInContext(key+'(shift'+(arg?',shift.draft':'')+')',vm.createContext({...helpers,shift:arg||null}));
const render=s=>vm.runInContext('renderCompactDrive(shift)',vm.createContext({...helpers,shift:s}));
const blank={A:1,G:'08:28',M:'',C:'08:20',K:'',P:'',AL:'川西能勢口',AM:'',E:'乗',N:'現'};
const makeShift=()=>({date:'2026-10-18',startedAt:'08:00',records:[],settings:{},waiting:null,draft:null});
let page=render(null);
assert.match(page,/出庫・入庫メニューへ/);
let shift=makeShift();page=render(shift);
for(const control of ['beginWait','beginRide','beginDispatch'])assert.match(page,new RegExp('data-action="'+control+'"'));
assert.match(page,/data-compact-stage="空車・流し"/);
shift.waiting={startedAt:'08:25',place:'川西能勢口',odometer:'123.4',gpsStatus:'取得済み'};
page=render(shift);
for(const entry of ['待機開始','経過時間','data-wait-field="place"','data-wait-field="odometer"','data-action="gpsWait"','data-action="registerWaitPlace"'])assert.ok(page.includes(entry),entry);
shift.draft={kind:'dispatch',raw:{...blank},meta:{}};
page=render(shift);
for(const entry of ['迎車受信時刻','LOCATION:AL','data-action="boardDispatch"','data-action="cancelDispatch"','dispatchNote'])assert.ok(page.includes(entry),entry);
assert.doesNotMatch(page,/PAYMENT SPLIT/);
shift.waiting=null;shift.draft={kind:'ride',status:'draft',raw:{...blank},meta:{}};
page=render(shift);
for(const entry of ['実車中','FIELD:G','FIELD:F','LOCATION:AL','PASSENGERS:I','data-time-now="M"','高速道路','ALL RAW FIELDS'])assert.ok(page.includes(entry),entry);
assert.doesNotMatch(page,/data-action="saveDraft"/,'cannot save from ride in one tap before explicit alighting');
shift.draft.raw.M='08:45';shift.draft.status='alighted';
page=render(shift);
for(const entry of ['降車・精算','FIELD:K','FIELD:L','FIELD:M','LOCATION:AM','PAYMENT SPLIT GO UBER','data-action="saveDraft"','ALL RAW FIELDS','割引・高速'])assert.ok(page.includes(entry),entry);
assert.doesNotMatch(page,/stepper/,'compact settlement does not display legacy form');
shift.draft.raw.E='U';page=render(shift);
assert.match(page,/uberAppDisplayed/,'Uber settlement input still available');
shift.draft.kind='cancel';page=render(shift);
assert.match(page,/キャンセルは0円/);assert.match(page,/data-action="saveDraft"/);
shift.draft.kind='empty';page=render(shift);
assert.match(page,/空車高速/);assert.match(page,/FIELDS:Z,AA,AB,AC,AD,AE/);
assert.match(src,/renderCompactDrive\(getShift\(\)\)/);
assert.match(src,/previousCompactStage===appEl.querySelector/);
assert.match(src,/\.compact-primary-actions/);
console.log('Compact stage flow passed: idle, wait GPS, dispatch, ride, explicit alight, settlement, Uber, cancel, empty and legacy isolation.');
