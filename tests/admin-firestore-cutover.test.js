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
// Local-only previews never claim a cloud comparison happened.
const preview=p.previewLocal({uid:'my-uid',legacyShifts:[a,b,extra1,extra2,extra3],selectedIds:[a.id,b.id]});
assert.equal(preview.selectedCount,2);
assert.equal(preview.excludedCount,3);
assert.equal(preview.cloudVerified,false);
assert.equal(preview.migrationAuthorized,false);
assert.equal(preview.entries[0].overlapsExcluded.length,3);
assert.equal(preview.entries[0].overlapsSelected.length,0);
assert.equal(preview.requiresReview,true);
const overlapPreview=p.previewLocal({uid:'my-uid',legacyShifts:[a,extra1],selectedIds:[a.id,extra1.id]});
assert.equal(overlapPreview.entries[0].overlapsSelected.length,1);
assert.equal(p.previewLocal({uid:'my-uid',legacyShifts:[a],selectedIds:[]}).selectedCount,0);
assert.throws(()=>p.previewLocal({uid:'',legacyShifts:[a],selectedIds:[a.id]}),/UID/);
assert.throws(()=>p.previewLocal({uid:'my-uid',legacyShifts:[a],selectedIds:[a.id,'shift-999-a']}),/ありません/);
assert.throws(()=>p.previewLocal({uid:'my-uid',legacyShifts:[a],selectedIds:[a.id,a.id]}),/重複なく/);
// Only the configured legacy Google sync originals are compared. No Firebase
// ownership proof or write/delete authorization can be inferred from this.
const sheetA={...a,records:[{kind:'ride',raw:{K:1200}}]};
const sheetOnly=duty('shift-999-a','2026-10-20T14:00:00+09:00','2026-10-20T22:00:00+09:00');
const compare=p.compareLegacySheet({
 uid:'my-uid',localShifts:[a,b,extra1],sheetShifts:[sheetA,b,sheetOnly],
 selectedIds:[a.id,b.id]
});
assert.equal(compare.sheetSource,'TAXIAPP_同期原本');
assert.equal(compare.firebaseVerified,false);
assert.equal(compare.migrationAuthorized,false);
assert.equal(compare.deleteAuthorized,false);
assert.equal(compare.localCount,3);
assert.equal(compare.sheetCount,3);
assert.equal(compare.changedCount,1);
assert.equal(compare.matchingCount,1);
assert.equal(compare.deviceOnlyCount,1);
assert.equal(compare.sheetOnlyCount,1);
assert.equal(compare.selectedCount,2);
assert.equal(compare.selected[0].sheetStatus,'same-id-different');
assert.equal(compare.selected[1].sheetStatus,'same-id-identical');
assert.deepEqual(compare.sheetOnly.map(x=>x.id),[sheetOnly.id]);
assert.ok(compare.selected[0].overlapsSheet.includes(sheetOnly.id));
assert.ok(compare.sheetOnly[0].overlapsLocal.includes(a.id));
assert.equal(p.compareLegacySheet({
 uid:'my-uid',localShifts:[a],sheetShifts:[],selectedIds:[a.id]
}).selected[0].sheetStatus,'device-only');
assert.throws(()=>p.compareLegacySheet({
 uid:'my-uid',localShifts:[a],sheetShifts:[sheetA,sheetA],selectedIds:[a.id]
}),/重複する/);
assert.throws(()=>p.compareLegacySheet({
 uid:'',localShifts:[a],sheetShifts:[],selectedIds:[a.id]
}),/UID/);
assert.throws(()=>p.compareLegacySheet({
 uid:'my-uid',localShifts:[a],sheetShifts:[],selectedIds:['shift-404-a']
}),/見つかりません/);
console.log('Administrator Firestore cutover preflight passed: selection, overlaps, UID isolation, no implicit migration');
