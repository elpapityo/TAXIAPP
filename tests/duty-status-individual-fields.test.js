'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
const head=source.indexOf('const DRIVE_STATUS_FIELDS=['),end=source.indexOf('function renderGuidedHeading(',head);
assert.ok(head>0&&end>head,'real production status renderer must be found');
const js=source.slice(head,end);
new Function(js);
const model={prefs:{ui:{driveStatusDisplay:'on'},cruisingSummaryFields:{}}};
const status={
 state:'実車中',dispatch:false,waiting:false,from:'北本町１',to:'駅前',
 dispatchSource:'GO',dispatchType:'その他・無線',payment:'未選択',meter:'未入力',highway:'実車高速'
};
const blank={id:'abc',date:'2026-10-20',startedAt:'08:00',records:[],settings:{},
 draft:{kind:'ride'},waiting:null,breakActive:null};
let renderCount=0,saves=0;
const context={
 model,Date,
 safeText:String,money:n=>'¥'+n,
 displayPrefs:()=>model.prefs.ui,
 currentDutySummary:()=>status,
 cruisingSummaryVisible:key=>model.prefs.cruisingSummaryFields[key]!==false,
 driverDutyPlan:()=>({distanceKm:275}),
 dutyRemaining:()=>({overdueMinutes:0,minutes:60,distanceKm:2}),
 totals:()=>({meter:12345}),
 cruisingUnitMetrics:()=>({kmUnit:120,distanceProjection:15000,hourUnit:1200,rideUnit:2500}),
 saveLater(){saves++;},
 render(){renderCount++;}
};
vm.createContext(context);
vm.runInContext(js,context);
const keys=Array.from(vm.runInContext('DRIVE_STATUS_FIELDS.map(x=>x[0])',context));
assert.deepEqual(keys,['state','dispatchSource','waiting','dispatchType','payment','meter','highway','from','to']);
const render=()=>vm.runInContext('renderDutyStatus(shift)',Object.assign(context,{shift:blank}));
const cells=[
 ['state','data-duty-field="state"'],
 ['dispatchType','data-duty-field="dispatchType"'],
 ['payment','data-duty-field="payment"'],
 ['meter','data-duty-field="meter"'],
 ['highway','data-duty-field="highway"'],
 ['from','data-duty-jump="from"'],
 ['to','data-duty-jump="to"']
];
const fields=vm.runInContext('renderDriveStatusFieldSettings()',context);
for(const key of keys)assert.ok(fields.includes('data-drive-status-field="'+key+'"'),'setting checkbox missing '+key);
assert.equal((fields.match(/data-drive-status-field=/g)||[]).length,9);
const oldValue={...status},saved={records:[],breakSessions:[],fields:{raw:'preserve'}};
const stored=JSON.stringify(saved);
for(let mask=0;mask<512;mask++){
 model.prefs.driveStatusFields=Object.fromEntries(keys.map((k,i)=>[k,Boolean(mask&(1<<i))]));
 const output=render();
 for(const [key,token] of cells){
  assert.equal(output.includes(token),model.prefs.driveStatusFields[key],
    'wrong visibility at mask '+mask+' for '+key);
 }
 if(!model.prefs.driveStatusFields.from && !model.prefs.driveStatusFields.to){
  assert.doesNotMatch(output,/class="preview-duty-route"/,'no blank route frame');
 } else if(model.prefs.driveStatusFields.from !==model.prefs.driveStatusFields.to){
  assert.doesNotMatch(output,/➜/,'arrow only when both locations shown');
 }
}
assert.equal(JSON.stringify(saved),stored,'visibility must never mutate stored diary entries');
model.prefs.driveStatusFields={};
const defaults=render();
for(const [,token] of cells)assert.ok(defaults.includes(token),'all existing status cells should default visible');
model.prefs.ui.driveStatusDisplay='off';
assert.equal(render(),'','master OFF must hide entire summary');
model.prefs.ui.driveStatusDisplay='on';
// Dispatch and waiting previews also obey individual controls.
status.state='迎車中';status.dispatch=true;status.waiting=false;
model.prefs.driveStatusFields={dispatchSource:false,from:true};
assert.doesNotMatch(render(),/data-duty-field="dispatch"/);
assert.match(render(),/お迎え場所/);
model.prefs.driveStatusFields.from=false;
assert.doesNotMatch(render(),/class="preview-duty-route"/);
status.dispatch=false;status.waiting=true;status.state='待機中';
model.prefs.driveStatusFields={waiting:false,from:false,to:false};
assert.doesNotMatch(render(),/data-duty-field="wait"/);
status.waiting=false;status.state='空車・流し中';blank.draft=null;
model.prefs.driveStatusFields={state:false,from:false,to:false};
assert.match(render(),/data-duty-field="state"/,
 'cruising selection is still controlled by its old saved setting');
model.prefs.cruisingSummaryFields.state=false;
assert.doesNotMatch(render(),/data-duty-field="state"/);
assert.match(source,/data-drive-status-settings><summary>営業情報の表示/);
assert.match(source,/renderDriveStatusFieldSettings\(\)/);
assert.match(source,/if\(target\.dataset\.driveStatusField\)/);
assert.match(source,/model\.prefs\.driveStatusFields\[key\]=target\.checked/);
assert.match(source,/data-cruising-summary-field\],\[data-drive-status-field\]/);
assert.match(source,/if\(!columns\.length&&!route\)return '';/);
assert.match(source,/<title>TAXIAPP v0\.3\.110 — 乗務日報<\/title>/);
console.log('PASS 512 combinations × ride duty status cells, master ON/OFF, dispatch, waiting and cruising separation; old data untouched');
