'use strict';
const assert=require('node:assert/strict');
require('../firebase-duty-trash.js');
const factory=globalThis.TAXIAPP_DUTY_TRASH;
assert.equal(factory.RETENTION_DAYS,30);
const clone=x=>JSON.parse(JSON.stringify(x));
const id='shift-100-a';
const originalShift={id,date:'2026-10-21',records:[{kind:'ride',raw:{K:2000}}],settings:{},startedAt:'08:00',endedAt:'18:00'};
function harness(){
 const store=new Map(),calls=[],auth={currentUser:{uid:'user-A'}};
 const key=ref=>ref.uid+'/'+ref.section+'/'+ref.id;
 const fire={
  doc(_db,root,uid,section,id){assert.equal(root,'privateDuties');return {uid,section,id};},
  collection(_db,root,uid,section){assert.equal(root,'privateDuties');return {uid,section};},
  serverTimestamp:()=> 'server time',
  async getDocFromServer(ref){
   const value=store.get(key(ref));
   return {exists:()=>value!==undefined,data:()=>clone(value)};
  },
  async getDocsFromServer(collection){
   return {docs:[...store].filter(([k])=>k.startsWith(collection.uid+'/'+collection.section+'/')).map(([k,v])=>({
    id:k.split('/').pop(),data:()=>clone(v)
   }))};
  },
  async runTransaction(_db,callback){
   const ops=[],tx={
    async get(ref){const v=store.get(key(ref));return {
     exists:()=>v!==undefined,data:()=>clone(v)
    };},
    set(ref,value){ops.push({action:'set',key:key(ref),value:clone(value)});},
    delete(ref){ops.push({action:'delete',key:key(ref)});}
   };
   const result=await callback(tx);
   // A mock atomic commit, never partially apply rejected transactions.
   for(const op of ops){
    if(op.action==='delete')store.delete(op.key);
    else store.set(op.key,op.value);
   }
   calls.push(ops);
   return result;
  }
 };
 store.set('user-A/shifts/'+id,{
  format:'TAXIAPP_PRIVATE_SHIFT_V1',revision:1,shift:clone(originalShift),
  writerSessionId:'a'.repeat(36),updatedAt:'timestamp'
 });
 const session={sessionId:()=> 'a'.repeat(36)};
 const api=factory.create();
 api.bind({uid:'user-A'},{f:fire,db:{},auth,session});
 return {store,calls,auth,fire,session,api};
}
(async()=>{
 // Never let an incidental button or a stale revision trash real sales.
 {
  const h=harness();
  await assert.rejects(h.api.move({shiftId:id,expectedRevision:1}),/本人確認/);
  await assert.rejects(h.api.move({shiftId:id,confirmed:true,expectedRevision:0}),/更新番号/);
  await assert.rejects(h.api.move({shiftId:id,confirmed:true,expectedRevision:2}),/SYNC_CONFLICT/);
  assert.equal(h.calls.length,0);
  assert.equal(h.store.size,1);
 }
 // A confirmed deletion performs the 3-document atomic transaction.
 {
  const h=harness();
  const moved=await h.api.move({shiftId:id,expectedRevision:1,confirmed:true});
  assert.equal(moved.id,id);
  assert.equal(moved.generation,1);
  assert.equal(h.store.has('user-A/shifts/'+id),false);
  assert.equal(h.store.get('user-A/trash/'+id).shift.records[0].raw.K,2000);
  assert.equal(h.store.get('user-A/tombstones/'+id).state,'deleted');
  assert.deepEqual(h.calls[0].map(op=>op.action).sort(),['delete','set','set']);
  const items=await h.api.list();
  assert.equal(items.length,1);
  assert.equal(items[0].id,id);
  assert.equal(items[0].recordCount,1);
  await assert.rejects(h.api.move({shiftId:id,expectedRevision:1,confirmed:true}),/クラウド上にありません/);
  await assert.rejects(h.api.restore({shiftId:id}),/本人確認/);
  const restored=await h.api.restore({shiftId:id,confirmed:true});
  assert.equal(restored.revision,2,'restored record must not return to stale revision 1');
  assert.equal(h.store.get('user-A/shifts/'+id).revision,2);
  assert.equal(h.store.get('user-A/shifts/'+id).shift.records[0].raw.K,2000);
  assert.equal(h.store.has('user-A/trash/'+id),false);
  assert.equal(h.store.get('user-A/tombstones/'+id).state,'active');
  const again=await h.api.move({shiftId:id,expectedRevision:2,confirmed:true});
  assert.equal(again.generation,2);
  assert.equal(h.store.get('user-A/tombstones/'+id).revision,2);
  assert.equal(h.store.get('user-A/trash/'+id).generation,2);
 }
 // Editing a restored duty bumps the source revision without requiring
 // an ordinary sync client to rewrite the active tombstone after every edit.
 {
  const h=harness();
  await h.api.move({shiftId:id,expectedRevision:1,confirmed:true});
  await h.api.restore({shiftId:id,confirmed:true});
  h.store.get('user-A/shifts/'+id).revision=3;
  h.store.get('user-A/shifts/'+id).shift.records[0].raw.K=2900;
  await h.api.move({shiftId:id,expectedRevision:3,confirmed:true});
  assert.equal(h.store.get('user-A/trash/'+id).sourceRevision,3);
  assert.equal(h.store.get('user-A/trash/'+id).shift.records[0].raw.K,2900);
  assert.equal(h.store.get('user-A/tombstones/'+id).generation,2);
 }
 // A duty still in progress cannot be moved to a trash prototype.
 {
  const h=harness();
  delete h.store.get('user-A/shifts/'+id).shift.endedAt;
  await assert.rejects(h.api.move({shiftId:id,expectedRevision:1,confirmed:true}),/未入庫/);
  assert.equal(h.store.has('user-A/shifts/'+id),true);
  assert.equal(h.store.has('user-A/trash/'+id),false);
 }
 // If the original is duplicated before restore, fail closed.
 {
  const h=harness();
  await h.api.move({shiftId:id,expectedRevision:1,confirmed:true});
  h.store.set('user-A/shifts/'+id,clone(h.store.get('user-A/trash/'+id)));
  await assert.rejects(h.api.restore({shiftId:id,confirmed:true}),/同じID/);
  assert.equal(h.store.has('user-A/trash/'+id),true);
 }
 // Cannot restore a record after its expiry, even if TTL cleanup is delayed.
 {
  const h=harness();
  await h.api.move({shiftId:id,expectedRevision:1,confirmed:true});
  h.store.get('user-A/trash/'+id).expiresAt=new Date('2020-01-01T00:00:00Z').toISOString();
  await assert.rejects(h.api.restore({shiftId:id,confirmed:true}),/保管期限/);
  assert.equal(h.store.has('user-A/shifts/'+id),false);
 }
 // Different UID, signed-out user and old session never mutate the records.
 {
  const h=harness();
  h.auth.currentUser={uid:'user-B'};
  await assert.rejects(h.api.move({shiftId:id,confirmed:true,expectedRevision:1}),/UID/);
  h.auth.currentUser={uid:'user-A'};
  h.api.bind(null);
  await assert.rejects(h.api.move({shiftId:id,confirmed:true,expectedRevision:1}),/認証/);
  assert.equal(h.store.has('user-A/shifts/'+id),true);
 }
 // Read-only audit connections cannot be used for destructive operations.
 {
  const h=harness(),readOnly=factory.create();
  assert.throws(()=>readOnly.bind({uid:'user-A'},{f:h.fire,db:{},auth:h.auth,session:h.session,readOnly:true}),/読み取り専用/);
 }
 // Corrupted archival metadata must not be used as a restore source.
 {
  const h=harness();
  await h.api.move({shiftId:id,expectedRevision:1,confirmed:true});
  h.store.get('user-A/tombstones/'+id).generation=99;
  await assert.rejects(h.api.restore({shiftId:id,confirmed:true}),/更新世代/);
  assert.equal(h.store.has('user-A/shifts/'+id),false);
 }
 // A failed transaction write must not erase the sole original.
 {
  const h=harness(),originalRun=h.fire.runTransaction;
  h.fire.runTransaction=(db,fn)=>originalRun(db,async tx=>fn({
   get:tx.get,
   delete:tx.delete,
   set(ref,value){
    if(ref.section==='tombstones')throw Error('disk unavailable');
    return tx.set(ref,value);
   }
  }));
  await assert.rejects(h.api.move({shiftId:id,expectedRevision:1,confirmed:true}),/disk unavailable/);
  assert.equal(h.store.has('user-A/shifts/'+id),true);
  assert.equal(h.store.has('user-A/trash/'+id),false);
  assert.equal(h.store.has('user-A/tombstones/'+id),false);
 }
 // Logout while the Firestore read is pending must abort with no writes.
 {
  const h=harness(),originalRun=h.fire.runTransaction;
  h.fire.runTransaction=(db,fn)=>originalRun(db,async tx=>fn({
   ...tx,
   async get(ref){
    const result=await tx.get(ref);
    h.auth.currentUser={uid:'user-B'};
    return result;
   }
  }));
  await assert.rejects(h.api.move({shiftId:id,expectedRevision:1,confirmed:true}),/アカウント/);
  assert.equal(h.store.has('user-A/shifts/'+id),true);
  assert.equal(h.store.has('user-A/trash/'+id),false);
 }
 // The reader is always scoped to the active UID.
 {
  const h=harness();
  h.auth.currentUser={uid:'user-B'};
  h.api.bind({uid:'user-B'},{f:h.fire,db:{},auth:h.auth,session:h.session});
  assert.deepEqual(await h.api.list(),[]);
  assert.equal(h.store.has('user-A/shifts/'+id),true);
 }
 // A locally cached duty deleted on the server must NOT be treated as a
 // new upload. The complete tombstone scan is explicitly required.
 {
  const h=harness(),original=clone(originalShift);
  await h.api.move({shiftId:id,expectedRevision:1,confirmed:true});
  const markers=await h.api.readDeletionMarkers([id,'shift-888-a']);
  assert.equal(markers.uid,'user-A');
  assert.equal(markers.markersComplete,true);
  assert.equal(markers.markerStates[0].state,'deleted');
  assert.equal(markers.markerStates[1].state,'none');
  const plan=factory.planReconciliation({
   uid:'user-A',serverUid:'user-A',localShifts:[original],
   serverShifts:[],...markers
  });
  assert.equal(plan.entries[0].action,'protect-local-copy');
  assert.equal(plan.entries[0].uploadAuthorized,false);
  assert.equal(plan.uploadAuthorized,false);
  assert.equal(h.store.has('user-A/shifts/'+id),false);
  await assert.rejects(h.api.readDeletionMarkers([id,id]),/不正/);
  assert.throws(()=>factory.planReconciliation({
   uid:'user-A',serverUid:'user-A',localShifts:[original],
   serverShifts:[],markerStates:[],markersComplete:true
  }),/不足/);
  assert.throws(()=>factory.planReconciliation({
   uid:'user-A',serverUid:'user-A',localShifts:[original],
   serverShifts:[],...markers,markersComplete:false
  }),/全件/);
  assert.throws(()=>factory.planReconciliation({
   uid:'user-A',serverUid:'user-B',localShifts:[original],
   serverShifts:[],...markers
  }),/UID/);
  assert.throws(()=>factory.planReconciliation({
   uid:'user-A',serverUid:'user-A',localShifts:[original],
   serverShifts:[original],...markers
  }),/矛盾/);
 }
 // Candidate new records never imply automatic upload consent.
 {
  const h=harness(),markers=await h.api.readDeletionMarkers(['shift-888-a']);
  const newDuty={...originalShift,id:'shift-888-a'};
  const plan=factory.planReconciliation({
   uid:'user-A',serverUid:'user-A',localShifts:[newDuty],
   serverShifts:[],...markers
  });
  assert.equal(plan.entries[0].action,'candidate-new');
  assert.equal(plan.entries[0].uploadAuthorized,false);
 }
 // Restore records remain readable and a same-id change requires comparison.
 {
  const h=harness();
  await h.api.move({shiftId:id,expectedRevision:1,confirmed:true});
  await h.api.restore({shiftId:id,confirmed:true});
  const markers=await h.api.readDeletionMarkers([id]);
  assert.equal(markers.markerStates[0].state,'active');
  const same=factory.planReconciliation({
   uid:'user-A',serverUid:'user-A',localShifts:[clone(originalShift)],
   serverShifts:[clone(originalShift)],...markers
  });
  assert.equal(same.entries[0].action,'same');
  const changed=factory.planReconciliation({
   uid:'user-A',serverUid:'user-A',localShifts:[{...originalShift,endedAt:'17:00'}],
   serverShifts:[clone(originalShift)],...markers
  });
  assert.equal(changed.entries[0].action,'review-difference');
 }
 // Authentication changing between tombstone reads must invalidate the result.
 {
  const h=harness(),read=h.fire.getDocFromServer;
  h.fire.getDocFromServer=async ref=>{
   const response=await read(ref);
   h.auth.currentUser={uid:'user-B'};
   return response;
  };
  await assert.rejects(h.api.readDeletionMarkers([id]),/アカウント/);
 }
 console.log('Firestore trash staging passed: CAS, UID isolation, 30-day expiry, move/restore and preservation');
})().catch(error=>{console.error(error);process.exitCode=1;});
