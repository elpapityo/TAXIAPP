'use strict';
const assert=require('node:assert/strict');
require('../firebase-duty-trash.js');
const factory=globalThis.TAXIAPP_DUTY_TRASH;
assert.equal(factory.RETENTION_DAYS,30);
const clone=x=>JSON.parse(JSON.stringify(x));
const id='shift-100-a';
const originalShift={id,date:'2026-10-21',records:[{kind:'ride',raw:{K:2000}}],settings:{},startedAt:'08:00'};
function harness(){
 const store=new Map(),calls=[],auth={currentUser:{uid:'user-A'}};
 const key=ref=>ref.uid+'/'+ref.section+'/'+ref.id;
 const fire={
  doc(_db,root,uid,section,id){assert.equal(root,'privateDuties');return {uid,section,id};},
  collection(_db,root,uid,section){assert.equal(root,'privateDuties');return {uid,section};},
  serverTimestamp:()=> 'server time',
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
 console.log('Firestore trash staging passed: CAS, UID isolation, 30-day expiry, move/restore and preservation');
})().catch(error=>{console.error(error);process.exitCode=1;});
