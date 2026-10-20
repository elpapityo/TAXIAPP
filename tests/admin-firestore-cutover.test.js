'use strict';
const assert=require('node:assert/strict');
require('../admin-firestore-cutover.js');
const p=globalThis.TAXIAPP_ADMIN_CUTOVER;
const duty=(id,start='2026-10-20T08:00:00+09:00',end='2026-10-20T16:00:00+09:00',extra={})=>({
 id,date:'2026-10-20',startedAt:'08:00',endedAt:'16:00',
 startedIso:start,endedIso:end,settings:{},records:[],...extra
});
const input=(legacyShifts,cloudShifts,selectedIds)=>({
 uid:'my-uid',cloudUid:'my-uid',legacyShifts,cloudShifts,selectedIds
});
const a=duty('shift-100-a'),b=duty('shift-200-a','2026-10-21T08:00:00+09:00','2026-10-21T16:00:00+09:00');
const extra1=duty('shift-300-a',a.startedIso,a.endedIso);
const extra2=duty('shift-400-a',a.startedIso,a.endedIso);
const extra3=duty('shift-500-a',a.startedIso,a.endedIso);
let planned=p.plan(input([a,b,extra1,extra2,extra3],[],[a.id,b.id]));
assert.equal(planned.sourceCount,5);
assert.equal(planned.selectedCount,2);
assert.equal(planned.skippedCount,3,'unselected test duties must never migrate');
assert.equal(planned.readyCount,2);
assert.equal(planned.entries[0].action,'create-only');
assert.equal(planned.entries[0].overlapsExcluded.length,3,'other old duplicates must be visible');
assert.equal(planned.migrationAuthorized,false);
assert.equal(planned.requiresReview,false);
assert.equal(p.plan(input([a,b],[a], [a.id])).entries[0].action,'already-present');
const altered={...a,records:[{kind:'ride'}]};
assert.equal(p.plan(input([a],[altered],[a.id])).entries[0].action,'conflict');
assert.equal(p.plan(input([a],[duty('shift-999-a','2026-10-20T13:00:00+09:00','2026-10-20T17:00:00+09:00')],[a.id])).entries[0].action,'overlap');
assert.equal(p.plan(input([a,duty('shift-777-a','2026-10-20T15:00:00+09:00','2026-10-20T19:00:00+09:00')],[],[a.id,'shift-777-a'])).requiresReview,true);
assert.equal(p.overlaps(p.interval(a),p.interval(duty('shift-111-a','2026-10-20T16:00:00+09:00','2026-10-20T17:00:00+09:00'))),false,'touching boundary is not overlap');
const overnight=duty('shift-888-a','2026-10-20T23:00:00+09:00','2026-10-21T05:00:00+09:00');
assert.equal(p.overlaps(p.interval(overnight),p.interval(duty('shift-889-a','2026-10-21T02:00:00+09:00','2026-10-21T04:00:00+09:00'))),true);
assert.equal(p.interval(duty('shift-222-a',null,null,{startedIso:'',endedIso:'',endedAt:''})).reason,'未入庫の乗務です');
assert.equal(p.plan(input([duty('shift-112-a','invalid','invalid')],[],['shift-112-a'])).entries[0].action,'review');
assert.throws(()=>p.plan({...input([a],[],[a.id]),cloudUid:'someone-else'}),/同じ認証UID/);
assert.throws(()=>p.plan(input([a],[],[a.id,a.id])),/重複なく/);
assert.throws(()=>p.plan(input([a],[],['shift-999-a'])),/見つかりません/);
assert.throws(()=>p.plan(input([a,a],[],[a.id])),/重複する/);
assert.equal(p.plan(input([a],[],[])).migrationAuthorized,false);
console.log('Administrator Firestore cutover preflight passed: selection, overlaps, UID isolation, no implicit migration');
