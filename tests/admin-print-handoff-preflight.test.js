'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
require('../admin-print-handoff-preflight.js');
require('../admin-firestore-cutover.js');
const checker=globalThis.TAXIAPP_ADMIN_PRINT_PREFLIGHT;
const cutover=globalThis.TAXIAPP_ADMIN_CUTOVER;
const id='shift-330-a',uid='driver-owner';
const clone=x=>JSON.parse(JSON.stringify(x));
const ride={kind:'ride',status:'complete',raw:{K:1200,N:'現',A:1,E:'G'},meta:{}};
const duty={id,date:'2026-10-21',startedAt:'08:00',endedAt:'16:00',
 startedIso:'2026-10-21T08:00:00+09:00',endedIso:'2026-10-21T16:00:00+09:00',
 records:[ride,{kind:'cancel',status:'complete',raw:{K:700,C:'13:00'},meta:{}}],
 settings:{}};
let invoked=0,mutated=false;
const printFactory=row=>{
 invoked++;
 if(mutated)row.records[0].raw.K=9999;
 return {kind:'TAXIAPP_SHIFT_V1',shift:row,
  summary:{meter:row.records[0].raw.K,goFee:0,uberSurcharge:0,discount:0,
   cashRemittance:1200,etcRemittance:0,totalRemittance:1200,cancellation:0}};
};
const input=(over={})=>({
 uid,cloudUid:uid,localShifts:[clone(duty)],cloudShifts:[clone(duty)],
 googleShifts:[clone(duty)],cloudRevisions:{[id]:4},
 selectedIds:[id],packetFactory:printFactory,cutover,...over
});
const pass=checker.inspect(input());
assert.equal(pass.state,'format-checked');
assert.equal(pass.id,id);
assert.equal(pass.summary.meter,1200);
assert.equal(pass.summary.cancellation,0);
assert.equal(pass.sourceRevision,4);
assert.equal(pass.printSheetLiveVerified,false);
assert.equal(pass.legacySheetsWriteWouldChangeOriginals,true);
for(const key of ['writeAuthorized','printAuthorized','cutoverAuthorized'])assert.equal(pass[key],false);
assert.equal(JSON.stringify(pass).includes('startedIso'),false,'do not leak full diary');
assert.deepEqual(pass.reasons,[]);
assert.equal(checker.inspect(input({selectedIds:[]})).state,'select-one');
assert.equal(checker.inspect(input({selectedIds:[id,'shift-220-a']})).state,'select-one');
assert.throws(()=>checker.inspect(input({cloudUid:'other'})),/UID/);
assert.throws(()=>checker.inspect(input({localShifts:[clone(duty),clone(duty)]})),/重複|不正/);
assert.throws(()=>checker.inspect(input({selectedIds:['shift-404-a']})),/ありません/);
const unknown=checker.inspect(input({googleShifts:null,cloudShifts:null}));
assert.equal(unknown.state,'review');
assert.ok(unknown.reasons.some(x=>x.includes('未照合')));
const noGoogle=checker.inspect(input({googleShifts:[]}));
assert.ok(noGoogle.reasons.some(x=>x.includes('Google同期原本に')));
const divergent=checker.inspect(input({googleShifts:[{...clone(duty),records:[]}]}));
assert.ok(divergent.reasons.some(x=>x.includes('一致しません')));
const unverifiedRev=checker.inspect(input({cloudRevisions:null}));
assert.ok(unverifiedRev.reasons.some(x=>x.includes('更新番号')));
assert.equal(checker.inspect(input({cloudShifts:[]})).state,'review');
const unfinished=checker.inspect(input({cloudShifts:[{...clone(duty),endedAt:'',endedIso:''}]}));
assert.ok(unfinished.reasons.some(x=>x.includes('未入庫')));
const draft=checker.inspect(input({cloudShifts:[{...clone(duty),records:[{...ride,status:'draft'}]}]}));
assert.ok(draft.reasons.some(x=>x.includes('未精算')));
const tooMany=checker.inspect(input({cloudShifts:[{...clone(duty),records:Array.from({length:61},()=>clone(ride))}]}));
assert.ok(tooMany.reasons.some(x=>x.includes('60件')));
const second={...clone(duty),id:'shift-331-a',startedAt:'11:00',endedAt:'17:00',
 startedIso:'2026-10-21T11:00:00+09:00',endedIso:'2026-10-21T17:00:00+09:00'};
const overlapped=checker.inspect(input({cloudShifts:[clone(duty),second]}));
assert.ok(overlapped.reasons.some(x=>x.includes('重複')));
mutated=true;
const tamper=checker.inspect(input());
assert.ok(tamper.reasons.some(x=>x.includes('変更')||x.includes('一致しません')));
mutated=false;
const invalidTotals=checker.inspect(input({packetFactory:row=>({
 kind:'TAXIAPP_SHIFT_V1',shift:row,
 summary:{meter:1200,goFee:0,uberSurcharge:0,discount:0,cashRemittance:1200,
  etcRemittance:0,totalRemittance:1201,cancellation:0}
})}));
assert.ok(invalidTotals.reasons.some(x=>x.includes('合計が一致しません')));
const invalidCancel=checker.inspect(input({packetFactory:row=>({
 kind:'TAXIAPP_SHIFT_V1',shift:row,
 summary:{meter:1200,goFee:0,uberSurcharge:0,discount:0,cashRemittance:1200,
  etcRemittance:0,totalRemittance:1200,cancellation:700}
})}));
assert.ok(invalidCancel.reasons.some(x=>x.includes('キャンセル料')));
const missingRideFare=checker.inspect(input({packetFactory:row=>{
 delete row.records[0].raw.K;
 return {kind:'TAXIAPP_SHIFT_V1',shift:row,
  summary:{meter:1200,goFee:0,uberSurcharge:0,discount:0,cashRemittance:1200,
   etcRemittance:0,totalRemittance:1200,cancellation:0}};
}}));
assert.ok(missingRideFare.reasons.length>0);
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
assert.match(html,/<script src="\.\/admin-print-handoff-preflight\.js\?v=/);
assert.match(html,/function adminPrintHandoffHtml\(\)/);
assert.match(html,/data-admin-print-handoff/);
assert.match(html,/cloudRevisions:Object\.fromEntries/);
const from=html.indexOf('function adminPrintHandoffHtml(){'),to=html.indexOf('function adminCutoverFirebaseHtml(){',from);
const isolated=html.slice(from,to);
assert.ok(from>0&&to>from);
for(const forbidden of ['googlePostRequest(','accountDiary.request(','save(','syncPut','trashClient.move(']){
 // syncPut only appears in explanatory warning text, but cannot be invoked.
 if(forbidden==='syncPut')assert.doesNotMatch(isolated,/googlePostRequest\('syncPut'|\.request\('syncPut'/);
 else assert.equal(isolated.includes(forbidden),false,'preview cannot invoke '+forbidden);
}
assert.match(html,/<title>TAXIAPP v0\.3\.118 — 乗務日報<\/title>/);
console.log('Admin print handoff dry-run: 17 validation/read-only cases and UI guard passed');
