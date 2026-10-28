'use strict';
const assert=require('node:assert/strict');
require('../cloud-sync-ui.js');
const p=globalThis.TAXIAPP_SYNC_EVENT_POLICY;
assert.ok(p&&typeof p.dutyState==='function');
const copy=value=>JSON.parse(JSON.stringify(value));
const initial={
 id:'shift-20261020-a',startedIso:'2026-10-20T06:00:00Z',endedIso:'',
 waiting:null,waitSegments:[],breakActive:null,breakSessions:[],
 draft:{id:'draft-1',kind:'ride',status:'draft',raw:{E:'乗',G:'12:00',I:1,J:1,D:'伊丹',H:'神戸',N:'現',K:''},meta:{}},
 records:[]
};
const baseline=p.dutyState(initial);
const ignored=copy(initial);
ignored.draft.raw.I=3;ignored.draft.raw.J=2;
ignored.draft.raw.D='大阪';ignored.draft.raw.H='明石';
ignored.draft.raw.AL='乗車地';ignored.draft.raw.AM='降車地';
ignored.draft.raw.N='ク';
ignored.draft.meta.pickupGeo={lat:35,lon:135};
ignored.draft.meta.splitPayment={second:'U',manualSlot:1,manualAmount:''};
ignored.gpsTrip={tripKm:103.38,lastSeenMs:Date.now()};
assert.equal(p.dutyState(ignored),baseline,
 'passenger counts, locations, payment choice and GPS must not trigger duty upload');
function mustChange(message,mutate){const changed=copy(initial);mutate(changed);assert.notEqual(p.dutyState(changed),baseline,message);}
mustChange('meter amount',x=>{x.draft.raw.K='12900';});
mustChange('fare edited to zero',x=>{x.draft.raw.K='0';});
mustChange('toll amount',x=>{x.draft.raw.W='1200';});
mustChange('cash received',x=>{x.draft.raw.AO='5000';});
mustChange('split payment amount',x=>{x.draft.meta.splitPayment={second:'ク',manualAmount:'2400'};});
mustChange('Uber tip amount',x=>{x.draft.meta.uberTip='200';});
mustChange('status alighted',x=>{x.draft.status='alighted';});
mustChange('dispatch/ride status',x=>{x.draft.kind='dispatch';x.draft.raw.E='G';});
mustChange('start break',x=>{x.breakActive={id:'break-1',startedIso:'2026-10-20T12:00:00Z'};});
mustChange('end break',x=>{x.breakSessions=[{id:'break-1',endedIso:'2026-10-20T12:20:00Z'}];});
mustChange('start waiting',x=>{x.waiting={id:'wait-1',startedIso:'2026-10-20T12:00:00Z'};});
mustChange('completed ride',x=>{x.records=[{id:'ride-1',kind:'ride',status:'complete',raw:{K:'1200'}}];x.draft=null;});
mustChange('finish shift',x=>{x.endedIso='2026-10-20T18:00:00Z';});
const blankToll=copy(initial);blankToll.draft.meta.highwaySections=[{entryIC:'西宮',fee:''}];
assert.equal(p.dutyState(blankToll),baseline,'unpriced toll route alone is deferred');
blankToll.draft.meta.highwaySections[0].fee='530';
assert.notEqual(p.dutyState(blankToll),baseline,'entered toll fee triggers sync');

// 本人Firestoreの実働配線：通常入力・GPSの端末保存では通信せず、決定済みイベントだけを送る。
const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
const scheduleBegin=source.indexOf('function scheduleGoogleSync(){');
const scheduleEnd=source.indexOf('// Vehicle status changes are Firestore sync events',scheduleBegin);
assert.ok(scheduleBegin>0&&scheduleEnd>scheduleBegin);
let scheduled=0;
const scheduleCtx={canEditNow:()=>true,memberDiary:()=>true,
 syncUI:{schedule:()=>{scheduled++;}},sheetTargetPrefs:()=>({syncMode:'on'})};
vm.createContext(scheduleCtx);
vm.runInContext(source.slice(scheduleBegin,scheduleEnd),scheduleCtx);
vm.runInContext('scheduleGoogleSync()',scheduleCtx);
assert.equal(scheduled,0,'文字入力・GPS保存から本人Firestoreの日報を送信しない');
const eventBegin=source.indexOf('function saveOperationalEvent(shift){');
const eventEnd=source.indexOf('async function googleSendAllShifts()',eventBegin);
assert.ok(eventBegin>scheduleEnd&&eventEnd>eventBegin);
const transmitted=[];
const eventCtx={
 accountScope:{uid:'uid-confirmed'},accountScopeGeneration:2,
 canEditNow:()=>true,memberDiary:()=>true,save:async()=>true,
 syncUI:{run:async(manual,ids)=>{transmitted.push({manual,ids:[...ids]});return true;}},
 console
};
vm.createContext(eventCtx);
vm.runInContext(source.slice(eventBegin,eventEnd),eventCtx);
(async()=>{
 await vm.runInContext('saveOperationalEvent({id:"shift-200-a"})',eventCtx);
 assert.equal(transmitted.length,1,'操作状態変更時に対象乗務1件を同期する');
 assert.equal(transmitted[0].manual,false);
 assert.deepEqual(transmitted[0].ids,['shift-200-a']);
})().catch(e=>{console.error(e);process.exitCode=1;});
for(const pattern of [
 /if\(action==='undoEndShift'\)[\s\S]*?saveOperationalEvent\(target\)/,
 /if\(action==='discardDraft'\)[^\n]*saveOperationalEvent\(shift\)/,
 /if\(action==='deleteRecord'\)[^\n]*saveOperationalEvent\(shift\)/
])assert.match(source,pattern,'入庫取消・編集中止・支払記録削除を状態変更として同期');

console.log('Status and money sync policy passed (irrelevant fields deferred).');
