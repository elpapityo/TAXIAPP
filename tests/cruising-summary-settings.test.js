'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('index.html','utf8');
const start=src.indexOf('const CRUISING_SUMMARY_FIELDS='),end=src.indexOf('function renderGuidedHeading(',start);
assert.ok(start>0&&end>start);
const model={prefs:{}},ctx={model,number:v=>v==null||v===''?null:Number(v),
 safeText:String,money:n=>'¥'+n,driverDutyPlan:()=>({distanceKm:275}),
 dutyRemaining:()=>({minutes:75,distanceKm:125}),
 totals:()=>({meter:3200}),
 currentDutySummary:()=>({state:'空車・流し',from:'未記録',to:'未記録',dispatch:false,waiting:false}),
 dutyUiState:()=> '空車・流し'};
vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);
const shift={records:[],settings:{},date:'2026-10-19',draft:null,waiting:null};
ctx.shift=shift;
const render=()=>vm.runInContext('renderDutyStatus(shift)',ctx);
let first=render();
for(const label of ['現在の営業状態','現在の売上','残り時間','基準距離の残り','乗車地','降車地'])assert.ok(first.includes(label),label);
model.prefs.cruisingSummaryFields={state:false,sales:false,remaining:false,distance:false,route:false};
const cleared=render();
for(const label of ['現在の営業状態','現在の売上','残り時間','基準距離の残り','乗車地','降車地'])assert.ok(!cleared.includes(label),'should hide '+label);
model.prefs.cruisingSummaryFields={state:true,route:true};
const selective=render();
assert.match(selective,/現在の営業状態/);
assert.match(selective,/乗車地/);
assert.doesNotMatch(selective,/現在の売上/);
assert.match(src,/data-cruising-summary-field/);
assert.match(src,/model\.prefs\.cruisingSummaryFields\[key\]=target\.checked/);
shift.draft={kind:'ride'};
ctx.currentDutySummary=()=>({state:'実車中',from:'北本町1',to:'伊丹1',dispatch:false,waiting:false,dispatchType:'Uber',payment:'現金',meter:'¥6000',highway:''});
const active=render();
assert.match(active,/現在の営業状態/);
assert.match(active,/配車区分/);
assert.match(active,/乗車地/);
console.log('Cruising summary visibility and ride isolation passed');
