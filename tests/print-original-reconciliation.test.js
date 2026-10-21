'use strict';
const assert=require('node:assert/strict');
const {inspect}=require('../server-drafts/print-original-reconciliation.js');
const uid='synthetic-admin-owner';
const make=(id,location='synthetic')=>({
 id,date:'2026-10-21',startedAt:'08:00',endedAt:'17:00',
 records:[{kind:'ride',status:'complete',raw:{A:1,K:1200,AL:location}}],
 settings:{unit:'km'}
});
const clone=x=>JSON.parse(JSON.stringify(x));
const old=make('shift-14001-a');
const identical=clone(old);
const edited=make('shift-14002-a','new-place');
const oldEdited=make('shift-14002-a','old-place');
const cloudOnly=make('shift-14003-a');
const newR=make('shift-14004-a');
const staged=make('shift-14005-a');
const legacyOnly=make('shift-14006-a');
const unknown=make('shift-14007-a');
const future=make('shift-14008-a');
const m=(revision)=>({format:'TAXIAPP_DUTY_TOMBSTONE_V1',
 state:'active',revision,generation:1});
const ids=[old.id,edited.id,cloudOnly.id,newR.id,staged.id,
 legacyOnly.id,unknown.id,future.id,'shift-14009-a'];
const cfg={uid,cloudUid:uid,
 legacyShifts:[old,oldEdited,legacyOnly],
 cloudShifts:[identical,edited,cloudOnly,newR,staged,unknown,future],
 selectedIds:ids,
 cloudRevisions:{
  [old.id]:2,[edited.id]:3,[cloudOnly.id]:4,[newR.id]:6,
  [staged.id]:7,[unknown.id]:2,[future.id]:1
 },
 tombstones:{
  [old.id]:m(2),[edited.id]:m(3),[cloudOnly.id]:m(4),
  [newR.id]:m(6),[staged.id]:m(7),[future.id]:m(1)
 },
 stageRevisions:{[cloudOnly.id]:4,[newR.id]:5,[staged.id]:7,[future.id]:2}
};
const result=inspect(cfg);
assert.equal(result.legacyCount,3);
assert.equal(result.firestoreCount,7);
assert.equal(result.selectedCount,9);
const get=id=>result.results.find(x=>x.id===id);
assert.equal(get(old.id).state,'same-id-identical');
assert.equal(get(old.id).possiblePrintSource,'legacy',
 'identical copies do not require rewriting the original Google printed source');
assert.equal(get(edited.id).state,'same-id-conflict');
assert.equal(get(edited.id).possiblePrintSource,'none');
assert.equal(get(cloudOnly.id).state,'stage-recheck');
assert.equal(get(newR.id).state,'reprint-preflight');
assert.equal(get(newR.id).needsReprintPlan,true);
assert.equal(get(staged.id).state,'stage-recheck');
assert.equal(get(legacyOnly.id).state,'legacy-only');
assert.equal(get(legacyOnly.id).possiblePrintSource,'legacy');
assert.equal(get(unknown.id).state,'cloud-unverified');
assert.equal(get(future.id).state,'stage-revision-conflict');
assert.equal(get('shift-14009-a').state,'not-found');
for(const r of result.results){
 assert.equal(r.writeAuthorized,false);
 assert.equal(r.cutoverAuthorized,false);
 assert.equal(r.printAuthorized,false);
 assert.equal(r.deleteAuthorized,false);
 assert.ok(!JSON.stringify(r).includes('new-place'));
}
assert.equal(result.writeAuthorized,false);
const noVersion=inspect({...cfg,stageRevisions:{}});
assert.equal(noVersion.results.find(x=>x.id===cloudOnly.id).state,'v2-stage-needed');
const deleted=inspect({...cfg,tombstones:{...cfg.tombstones,[old.id]:{
 ...m(2),state:'deleted'}}});
assert.equal(deleted.results[0].state,'cloud-unverified');
const badMarker=inspect({...cfg,tombstones:{...cfg.tombstones,[old.id]:m(1)}});
assert.equal(badMarker.results[0].state,'cloud-unverified');
const badCloud=clone(cfg.cloudShifts);badCloud.push(clone(old));
assert.throws(()=>inspect({...cfg,cloudShifts:badCloud}),/重複/);
assert.throws(()=>inspect({...cfg,cloudUid:'foreign-driver'}),/同一認証UID/);
assert.throws(()=>inspect({...cfg,selectedIds:[old.id,old.id]}),/重複/);
assert.throws(()=>inspect({...cfg,legacyShifts:null}),/原本一覧/);
assert.deepEqual(clone(cfg.legacyShifts),clone([old,oldEdited,legacyOnly]),
 'legacy raw originals must remain completely unchanged');
console.log('Stage11 originals reconciliation PASS: legacy-only, same-ID exact, collision conflict, revised stage and unknown tombstones; read-only');
