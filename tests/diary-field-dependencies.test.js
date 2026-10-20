'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const highway=require('../highway-sections.js');
const html=fs.readFileSync('index.html','utf8');
const cut=(a,b)=>{const x=html.indexOf(a),y=html.indexOf(b,x+a.length);
 assert.ok(x>0&&y>x,'missing source boundary '+a);return html.slice(x,y)};
const source=[
 cut('function validateDraft(','function deepCopy('),
 cut('function renderDispatchForm(','function amountDiscount('),
 cut('function renderHighwaySections(','function renderEmptyForm('),
 cut('function renderEmptyForm(','function renderAllFields(')
].join('\n');
const model={prefs:{rideFieldVisibility:{},pickupDropDistance:'on',highwayDistance:'on'}};
const numeric=x=>(x===null||x===undefined||String(x).trim()===''?null:Number.isFinite(Number(x))?Number(x):null);
const escape=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;');
const context={
 model,console,
 window:{TAXIAPP_HIGHWAY_SECTIONS:highway},
 number:numeric,money:n=>'¥'+Number(n).toFixed(0),kmOne:x=>String(x??''),
 safeText:escape,shortTime:s=>String(s||'').slice(0,5),
 feeSettings:()=>({uberSurcharge:100}),updateDiscountForDraft(){},applyUberDisplayedDefault:()=>false,
 saveLater(){throw Error('Rendering only must never save')},
 gpsTripUI:null,RAW_COLUMNS:[],PAYMENTS:[],TYPES:['乗'],
 feeSettingsForDraft:()=>({}),uberAppAmounts:()=>null,uberDispatchFeeApplies:()=>false,
 cashChange:()=>({due:1000,change:0,shortage:0}),
 paymentBreakdown:()=>({items:[{type:'現'}]}),
 renderPaymentSplit:()=>'<div class="payment-split">金種照合</div>',
 renderAllFields:()=>'<div data-compat-raw>補足項目</div>',
 userFields:(keys,raw)=>'<div>'+keys.map(k=>'<input data-col="'+k+'" value="'+escape(raw[k]||'')+'">').join('')+'</div>',
 locationField:(key)=>'<input data-col="'+key+'">',
 passengerChoice:(key)=>'<input data-col="'+key+'">',
 selector:(key)=>'<select data-col="'+key+'"></select>',
 field:(key)=>context.distanceEnabled(key)?'<input data-col="'+key+'">':'',
 kmControl:x=>x,
 discountFoldOpen:false
};
context.distanceEnabled=field=>field==='F'||field==='L'?
 model.prefs.pickupDropDistance!=='off':
 ['S','V','AB','AE','X','Y','AJ','AK'].includes(field)?model.prefs.highwayDistance!=='off':true;
context.hasRealHighway=r=>String(r?.P||'').includes('実');
context.hasEmptyHighway=r=>String(r?.P||'').includes('空');
vm.createContext(context);
vm.runInContext(source,context);
const prefs=vm.runInContext('RIDE_FIELD_PREFS',context);
const keys=Array.from(prefs.map(x=>x[0]));
assert.equal(keys.length,9);
assert.equal(new Set(keys).size,keys.length);
for(const must of ['received','passengers','dropAddress','highway','discount','cashCheckout',
 'dispatchNote','cancelPickupAddress','emptyHighwayRoute'])assert.ok(keys.includes(must));
function call(name,shift,d){context.shift=shift;context.d=d;return vm.runInContext(name+'(shift,d)',context)}
const shift={settings:{},date:'2026-10-20'};
const raw={C:'08:00',E:'乗',G:'08:12',AL:'駅',K:'1300',M:'08:21',N:'現',
 F:'100.1',L:'102.3',AM:'',I:'1',J:'0',P:'',O:'',AR:'',AO:''};
const draft={raw,meta:{highwaySections:[]},kind:'ride',status:'draft'};
const before=JSON.stringify(draft);
let simulations=0;
for(let mask=0;mask<(1<<keys.length);mask++){
 model.prefs.rideFieldVisibility=Object.fromEntries(keys.map((k,i)=>[k,Boolean(mask&(1<<i))]));
 for(const start of ['on','off'])for(const highwayFlag of ['on','off']){
  model.prefs.pickupDropDistance=start;model.prefs.highwayDistance=highwayFlag;
  let out=call('renderRideForm',shift,draft);simulations++;
  for(const key of ['E','G','AL','K','M','N'])assert.match(out,new RegExp('data-col="'+key+'"'),
   key+' always visible');
  for(const key of ['F','L']){
   assert.equal(out.includes('data-col="'+key+'"'),start==='on',
    key+' must follow ONE global ride distance preference');
  }
  assert.equal(out.includes('data-col="C"'),model.prefs.rideFieldVisibility.received);
  assert.equal(out.includes('data-col="I"'),model.prefs.rideFieldVisibility.passengers);
  assert.equal(out.includes('data-col="AM"'),model.prefs.rideFieldVisibility.dropAddress);
  assert.equal(out.includes('data-highway-fold'),model.prefs.rideFieldVisibility.highway);
  assert.equal(out.includes('discount-fold'),model.prefs.rideFieldVisibility.discount);
  assert.equal(out.includes('class="cash-checkout"'),model.prefs.rideFieldVisibility.cashCheckout);
  assert.match(out,/data-compat-raw/,'compatibility editor remains available');
  assert.match(out,/data-action="saveDraft"/,'save button is never hidden');
  assert.match(out,/data-action="gpsTripAlight"|data-action="saveDraft"/,'alight or save always available');
  assert.match(out,/payment-split/,'payment reconciliation is mandatory');
  const dispatch={...draft,kind:'dispatch',meta:{},raw:{...raw,E:'G'}};
  const dispatchOut=call('renderDispatchForm',shift,dispatch);
  assert.equal(dispatchOut.includes('data-meta="dispatchNote"'),model.prefs.rideFieldVisibility.dispatchNote);
  assert.match(dispatchOut,/data-col="E"/);
  assert.match(dispatchOut,/data-col="AL"/);
  assert.match(dispatchOut,/data-action="boardDispatch"/);
  const cancel={...draft,kind:'cancel',raw:{...raw,AL:''}};
  const cancelOut=call('renderCancelForm',shift,cancel);
  assert.equal(cancelOut.includes('data-col="AL"'),model.prefs.rideFieldVisibility.cancelPickupAddress);
  for(const key of ['C','B','N'])assert.ok(cancelOut.includes('data-col="'+key+'"'));
  const empty={...draft,kind:'empty'};
  const emptyOut=call('renderEmptyForm',shift,empty);
  for(const fee of ['AF','AG','AH'])assert.ok(emptyOut.includes('data-col="'+fee+'"'));
  assert.equal(emptyOut.includes('data-col="Z"'),model.prefs.rideFieldVisibility.emptyHighwayRoute);
  assert.equal(emptyOut.includes('data-col="AB"'),highwayFlag==='on',
   'blank highway distance must be shown only if distance management is ON');
  assert.equal(JSON.stringify(draft),before,'render must not change existing record data');
 }
}
assert.equal(simulations,2048);
model.prefs.rideFieldVisibility=Object.fromEntries(keys.map(k=>[k,false]));
model.prefs.pickupDropDistance='on';model.prefs.highwayDistance='on';
const recordedHighway={...draft,raw:{...raw,P:'実',O:'シ',AR:'100',AO:'2000'},
 meta:{highwaySections:[{mode:'実',entryIC:'吹田',entryKm:'14.0',exitIC:'宝塚',exitKm:'23.0',fee:'900'}]}};
const preserved=JSON.stringify(recordedHighway);
let shown=call('renderRideForm',shift,recordedHighway);
assert.match(shown,/data-highway-fold/,'already-entered toll sections cannot vanish');
assert.match(shown,/discount-fold/,'already-entered discounts cannot vanish');
assert.match(shown,/cash-checkout/,'already-entered cash deposit cannot vanish');
assert.equal(JSON.stringify(recordedHighway),preserved);
let sectionsOn=vm.runInContext('renderHighwaySections(d,"実")',context);
assert.match(sectionsOn,/data-hwy-field="entryKm"/);
assert.match(sectionsOn,/data-hwy-field="exitKm"/);
model.prefs.highwayDistance='off';
const sectionsOff=vm.runInContext('renderHighwaySections(d,"実")',context);
assert.doesNotMatch(sectionsOff,/data-hwy-field="entryKm"/);
assert.doesNotMatch(sectionsOff,/data-hwy-field="exitKm"/);
assert.match(sectionsOff,/data-hwy-field="fee"/);
assert.match(sectionsOff,/data-hwy-field="entryIC"/);
assert.equal(JSON.stringify(recordedHighway),preserved,'distance toggle does not clear saved kilometres');
const invalid={kind:'ride',raw:{...raw, F:'',K:'1300',N:'現'},meta:{highwaySections:[
 {mode:'実',entryIC:'入口',entryKm:'10',exitIC:'出口',exitKm:'',fee:'500'}]}};
model.prefs.pickupDropDistance='on';model.prefs.highwayDistance='on';
context.draft=invalid;
let issues=vm.runInContext('validateDraft(draft)',context);
assert.ok(issues.includes('乗車時の走行距離'),'active required F must block save');
assert.ok(issues.some(x=>x.includes('乗距離・降距離')),'visible half-entered highway must be flagged');
model.prefs.pickupDropDistance='off';model.prefs.highwayDistance='off';
const original=JSON.stringify(invalid);
issues=vm.runInContext('validateDraft(draft)',context);
assert.deepEqual(Array.from(issues),[],'hidden distances must never trigger save errors');
assert.equal(JSON.stringify(invalid),original,'validation must not clear hidden values');
invalid.meta.highwaySections[0].fee='-1';
assert.ok(vm.runInContext('validateDraft(draft)',context).some(x=>x.includes('料金')),
 'bad toll fee must not slip through merely because distance is hidden');
assert.match(html,/data-ride-distance-setting="\\$\\{key\\}"/);
assert.match(html,/event\\.target\\.matches\\('\\[data-distance-setting\\],\\[data-ride-distance-setting\\]'\\)/);
assert.match(html,/dataset\\.distanceSetting\\|\\|event\\.target\\.dataset\\.rideDistanceSetting/);
assert.match(html,/data-ride-field.*render\\(\\)/s);
console.log('PASS 2,048 diary visibility combinations × ride/dispatch/cancel/empty, required fields, shared distance, hidden save validation, unchanged raw data');
