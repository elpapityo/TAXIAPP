'use strict';
// The milestone hooks must be attached to the same native-GPS ON/OFF settings
// rather than the retired v0.3.57 implicit browser-GPS path.
const assert=require('node:assert/strict'),fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const ui=fs.readFileSync('gps-trip-ui.js','utf8');
const checks=[
 ['wait start', /beginWaiting\(shift,new Date\(\)\);gpsTripUI\?\.fillWaitDistance\(shift,w,'waitStart'\)/],
 ['wait address', /if\(duty\?\.waiting\?\.id===waitId&&nativeAutoDistanceEnabled\(\)\)/],
 ['wait native fallback', /fillNativeDistanceSilently\(duty,target,'odometer',true\)/],
 ['wait browser fallback', /fillWaitDistance\(duty,target,'waitLocation'\)/],
 ['dispatch address native', /fillNativeDistanceSilently\(currentDuty,target,when==='pickup'\?'F':'L'\)/],
 ['dispatch address browser', /fillLocationDistance\(currentDuty,target,when\)/],
 ['dispatch start', /makeDispatch\(shift,new Date\(\),''\);saveOperationalEvent\(shift\);dutyInputAfterRender='dispatch';render\(\);captureDispatchStartDistance\(shift,shift.draft\)/],
 ['dispatch from break', /makeDispatch\(shift,now,''\);saveOperationalEvent\(shift\);dutyInputAfterRender='dispatch';render\(\);captureDispatchStartDistance\(shift,shift.draft\)/],
 ['board ride', /gpsTripUI\?\.board\(shift,d\)/],
 ['board F and alight L', /\{G:'F',M:'L',R:'S',U:'V',AA:'AB',AD:'AE'\}/],
 ['time-linked native only with ON', /if\(gpsDistanceField&&nativeAutoDistanceEnabled\(\)\)/],
 ['native fill', /fillNativeDistanceSilently\(s,d,gpsDistanceField\)/],
 ['alight handling', /function requestDropLocation\(/],
 ['pickup location', /locationField\('AL',r,'乗車地・住所','gpsPickup'\)/],
 ['drop location', /locationField\('AM',r,'降車地・住所','gpsDrop'\)/],
 ['inline clock', /class="inline-time-field"/],
 ['manual protection', /String\(waiting\?record\.odometer\?\?'':record\.raw\?\.\[col\]\?\?''\)\.trim\(\)!==''/],
 ['auto disabled until source explicit', /NATIVE_AUTO_DISTANCE_PREF='taxiapp-production-auto-distance-v140'/]
];
for(const [name,pattern] of checks)assert.match(html,pattern,'Missing '+name);
for(const p of [/function fillDistance\(/,/function fillWaitDistance\(/,/fillDistance\(shift,record,'F','board'\)/,/fillDistance\(shift,record,'L','alight'\)/])
 assert.match(ui,p);
assert.doesNotMatch(html,/data-preview-simulator/);

async function verifyDispatchCapture(){
 const start=html.indexOf('const dispatchStartGpsRequests=');
 const end=html.indexOf('function gpsTarget(',start);
 const input={value:''};
 let resolveRead,auto=true,native=true,editable=true,saves=0;
 const notices=[];
 const ctx=vm.createContext({
  accountScopeGeneration:0,accountScope:{uid:'driver'},tab:'drive',
  canEditNow:()=>editable,nativeAutoDistanceEnabled:()=>auto,nativeDiaryGpsEnabled:()=>native,
  getShift:()=>shift,gpsTripUI:{trusted:()=>true},fetch(){},localStorage:{},
  window:{TAXIAPP_EXTERNAL_GPS:{read:()=>new Promise(resolve=>{resolveRead=resolve;}),
   calculated:(raw,base)=>base+(raw-5)}},
  nativeDistanceBase:()=>20,kmOne:value=>value.toFixed(1),
  appEl:{querySelectorAll:()=>[input]},document:{activeElement:null},saveLater:()=>saves++,toast:(...args)=>notices.push(args)
 });
 vm.runInContext(html.slice(start,end),ctx);
 const record=()=>({kind:'dispatch',raw:{F:'42.0'},meta:{}});
 const shift={id:'shift-1',draft:record(),gpsTrip:{tripKm:30.5}};
 const capture=()=>ctx.captureDispatchStartDistance(shift,shift.draft);
 auto=false;
 assert.equal(capture(),undefined);
 assert.equal(shift.draft.meta.dispatchStartKm,undefined);
 auto=true;
 let pending=capture();
 resolveRead({tripKm:7.3,runId:'native'});
 await pending;
 assert.equal(shift.draft.meta.dispatchStartKm,'22.3');
 assert.equal(input.value,'22.3');
 assert.equal(shift.draft.raw.F,'42.0','boarding trip is independent of dispatch start');
 shift.draft=record();
 pending=capture();
 shift.draft.meta.dispatchStartKm='';
 resolveRead({tripKm:8});
 await pending;
 assert.equal(shift.draft.meta.dispatchStartKm,'','manual clearing is preserved');
 shift.draft=record();
 pending=capture();
 shift.draft.kind='ride';
 resolveRead({tripKm:9});
 await pending;
 assert.equal(shift.draft.meta.dispatchStartKm,undefined,'a late callback never changes an ongoing ride');
 shift.draft=record();
 pending=capture();
 ctx.accountScopeGeneration++;
 resolveRead({tripKm:10});
 await pending;
 assert.equal(shift.draft.meta.dispatchStartKm,undefined);
 native=false;
 capture();
 assert.equal(shift.draft.meta.dispatchStartKm,'30.5');
 assert.equal(saves,2);
 auto=false;
 native=true;
 pending=ctx.captureDispatchStartDistance(shift,shift.draft,true);
 const oldRead=resolveRead;
 const latest=ctx.captureDispatchStartDistance(shift,shift.draft,true);
 oldRead({tripKm:16,runId:'native'});
 await pending;
 assert.equal(shift.draft.meta.dispatchStartKm,'30.5');
 resolveRead({tripKm:17,runId:'native'});
 await latest;
 assert.equal(input.value,'32.0','GPS button can refresh an existing value with auto-fill off');
 assert.equal(shift.draft.raw.F,'42.0');
 pending=ctx.captureDispatchStartDistance(shift,shift.draft,true);
 vm.runInContext('dispatchStartGpsRequests.delete(getShift().draft)',ctx);
 resolveRead({tripKm:18,runId:'native'});
 await pending;
 assert.equal(shift.draft.meta.dispatchStartKm,'32.0','manual edit cancels a GPS request even when the field is unchanged');
 shift.externalGpsManualPending=true;
 ctx.captureDispatchStartDistance(shift,shift.draft,true);
 assert.equal(notices.at(-1)[1],true);
 assert.equal(shift.draft.meta.dispatchStartKm,'32.0');
}
verifyDispatchCapture().then(()=>console.log('PASS: GPS distance wiring, dispatch start capture and manual-entry safety')).catch(error=>{
 console.error(error);
 process.exitCode=1;
});
