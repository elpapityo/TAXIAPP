'use strict';
// IMPORTANT: Must run with a real Firestore Emulator.
// Not included in tests/*.test.js; unit mocks and static checks cannot
// prove cross-document getAfter() authorization or access-call budgets.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,collection,getDoc,getDocs,setDoc,deleteDoc,runTransaction,
 Timestamp,serverTimestamp}=require('firebase/firestore');
const PROJECT='demo-taxiapp-trash',UID='driver-A',OTHER='driver-B';
const ID='shift-100-a',DAY_MS=86400000,SESSION_A='a'.repeat(36),SESSION_B='b'.repeat(36);
const duty={id:ID,date:'2026-10-21',records:[],settings:{},startedAt:'08:00',endedAt:'17:00'};
let env;
function refs(db,uid=UID){
 return {
  shift:doc(db,'privateDuties',uid,'shifts',ID),
  trash:doc(db,'privateDuties',uid,'trash',ID),
  tomb:doc(db,'privateDuties',uid,'tombstones',ID),
  trashCollection:collection(db,'privateDuties',uid,'trash')
 };
}
async function seed(){
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),r=refs(db);
  await setDoc(doc(db,'users',UID),{status:'active'});
  await setDoc(doc(db,'users',OTHER),{status:'active'});
  await setDoc(doc(db,'deviceSessions',UID),{sessionId:SESSION_A,updatedAt:Timestamp.now()});
  await setDoc(doc(db,'deviceSessions',OTHER),{sessionId:SESSION_B,updatedAt:Timestamp.now()});
  await setDoc(r.shift,{format:'TAXIAPP_PRIVATE_SHIFT_V1',revision:1,
   shift:duty,writerSessionId:SESSION_A,updatedAt:Timestamp.now()});
 });
}
async function move(db,session=SESSION_A){
 const r=refs(db);
 return runTransaction(db,async tx=>{
  const [a,b,c]=await Promise.all([tx.get(r.shift),tx.get(r.trash),tx.get(r.tomb)]);
  if(!a.exists()||b.exists()||c.exists())throw Error('fixture not fresh');
  tx.set(r.trash,{format:'TAXIAPP_DUTY_TRASH_V1',
   shift:duty,sourceRevision:1,generation:1,writerSessionId:session,
   deletedAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+30*DAY_MS)});
  tx.set(r.tomb,{format:'TAXIAPP_DUTY_TOMBSTONE_V1',
   state:'deleted',revision:1,generation:1,writerSessionId:session,
   updatedAt:serverTimestamp()});
  tx.delete(r.shift);
 });
}
async function restore(db,session=SESSION_A){
 const r=refs(db);
 return runTransaction(db,async tx=>{
  const [a,b,c]=await Promise.all([tx.get(r.shift),tx.get(r.trash),tx.get(r.tomb)]);
  if(a.exists()||!b.exists()||!c.exists())throw Error('invalid restore fixture');
  tx.set(r.shift,{format:'TAXIAPP_PRIVATE_SHIFT_V1',revision:2,
   shift:duty,writerSessionId:session,updatedAt:serverTimestamp()});
  tx.set(r.tomb,{format:'TAXIAPP_DUTY_TOMBSTONE_V1',
   state:'active',revision:2,generation:1,writerSessionId:session,
   updatedAt:serverTimestamp()});
  tx.delete(r.trash);
 });
}
async function purge(db,session=SESSION_A){
 const r=refs(db);
 return runTransaction(db,async tx=>{
  const [a,b,c]=await Promise.all([tx.get(r.shift),tx.get(r.trash),tx.get(r.tomb)]);
  if(a.exists()||!b.exists()||!c.exists())throw Error('invalid purge fixture');
  tx.set(r.tomb,{format:'TAXIAPP_DUTY_TOMBSTONE_V1',
   state:'deleted',revision:1,generation:1,writerSessionId:session,
   updatedAt:serverTimestamp()});
  tx.delete(r.trash);
 });
}
async function main(){
 env=await initializeTestEnvironment({
  projectId:PROJECT,
  firestore:{rules:fs.readFileSync(path.join(__dirname,'..','rules-drafts','firestore-trash.rules'),'utf8')}
 });
 const owner=env.authenticatedContext(UID).firestore();
 const other=env.authenticatedContext(OTHER).firestore();
 try{
  await seed();
  // Deny direct original deletion. Only a coherent three-document move
  // is allowed. Readers cannot access another UID's original.
  await assertFails(deleteDoc(refs(owner).shift));
  await assertFails(getDoc(refs(other).shift));
  await assertSucceeds(getDoc(refs(owner).shift));
  await assertSucceeds(move(owner));
  assert.equal((await getDoc(refs(owner).shift)).exists(),false);
  assert.equal((await getDoc(refs(owner).trash)).exists(),true);
  await assertFails(getDoc(refs(other).trash));
  await assertSucceeds(getDocs(refs(owner).trashCollection));
  // Old apps try revision=1 after the duty was removed. The server must
  // deny resurrection even if that client does not read tombstones.
  await assertFails(setDoc(refs(owner).shift,{
   format:'TAXIAPP_PRIVATE_SHIFT_V1',revision:1,
   shift:duty,writerSessionId:SESSION_A,updatedAt:serverTimestamp()
  }));
  // Current writer can restore within 30 days; no unrelated ID overwrite.
  await assertSucceeds(restore(owner));
  assert.equal((await getDoc(refs(owner).shift)).data().revision,2);
  await seed();
  await assertSucceeds(move(owner));
  // A premature purge, even from the owner, is NOT permitted.
  await assertFails(purge(owner));
  assert.equal((await getDoc(refs(owner).trash)).exists(),true);
  // Seed an expired archive and a newly assigned editor.
  await env.withSecurityRulesDisabled(async ctx=>{
   const db=ctx.firestore();
   await setDoc(refs(db).trash,{
    ...(await getDoc(refs(db).trash)).data(),
    expiresAt:Timestamp.fromMillis(Date.now()-100000)});
   await setDoc(doc(db,'deviceSessions',UID),
    {sessionId:SESSION_B,updatedAt:Timestamp.now()});
  });
  await assertFails(purge(owner,SESSION_A));
  await assertSucceeds(purge(owner,SESSION_B));
  assert.equal((await getDoc(refs(owner).trash)).exists(),false);
  assert.equal((await getDoc(refs(owner).tomb)).data().state,'deleted');
  // Expired data is gone but older clients are STILL denied.
  await assertFails(setDoc(refs(owner).shift,{
   format:'TAXIAPP_PRIVATE_SHIFT_V1',revision:1,
   shift:duty,writerSessionId:SESSION_B,updatedAt:serverTimestamp()
  }));
  await assertFails(deleteDoc(refs(owner).tomb));
  console.log('REAL Firestore Emulator: owner isolation, atomic move/restore, expiry and old-client rejection passed');
 }finally{
  await env.cleanup();
 }
}
main().catch(e=>{console.error('REAL Firestore Emulator test FAILED or unavailable:',e);process.exitCode=1;});
