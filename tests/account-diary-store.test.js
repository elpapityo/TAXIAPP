'use strict';
const assert=require('node:assert/strict');
require('../account-diary-store.js');
const factory=globalThis.TAXIAPP_ACCOUNT_DIARY;
const shifts=new Map(),accounts=new Map();
let beforeTransactionRead=null;
const clone=x=>JSON.parse(JSON.stringify(x));
const keys=c=>[...shifts].filter(([key])=>key.startsWith(c.uid+'/'));
const fire={
 collection(_db,_folder,uid,_leaf){return {uid};},
 doc(_db,_folder,uid,_leaf,id){return {uid,id};},
 async getDocsFromServer(collection){
  return {docs:keys(collection).map(([key,row])=>({
   id:key.split('/')[1],data:()=>clone(row)
  }))};
 },
 async getDocFromServer(ref){
  const row=shifts.get(ref.uid+'/'+ref.id);
  return {exists:()=>Boolean(row),data:()=>clone(row)};
 },
 async runTransaction(_db,fn){
  const puts=[];
  const tx={
   async get(ref){
    if(beforeTransactionRead){const hook=beforeTransactionRead;beforeTransactionRead=null;hook();}
    const row=shifts.get(ref.uid+'/'+ref.id);
    return {exists:()=>Boolean(row),data:()=>clone(row)};
   },
   set(ref,record){puts.push([ref.uid+'/'+ref.id,clone({...record,updatedAt:'timestamp'})]);}
  };
  const answer=await fn(tx);
  puts.forEach(([key,row])=>shifts.set(key,row));
  return answer;
 },
 serverTimestamp:()=> 'timestamp'
};
const fakeSession={sessionId:()=> 'a'.repeat(36)};
const authA={currentUser:{uid:'user-A'}},authB={currentUser:{uid:'user-B'}};
const A=factory.create(),B=factory.create();
A.bind({uid:'user-A'},{f:fire,db:{},auth:authA,session:fakeSession,admin:false});
B.bind({uid:'user-B'},{f:fire,db:{},auth:authB,session:fakeSession,admin:false});
const id='shift-1234-abc',shift={id,records:[],settings:{},startedAt:'10:00'};
(async()=>{
 assert.equal(A.kind(),'member');assert.notEqual(A.endpoint(),B.endpoint());
 assert.deepEqual(await A.request('syncList'),{shifts:[]});
 const sent=await A.request('syncPut',{baseRevision:0,payload:JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift})});
 assert.equal(sent.revision,1);
 assert.equal((await A.request('syncList')).shifts.length,1);
 assert.equal((await A.request('syncList',{shiftIds:[id]})).shifts.length,1);
 assert.deepEqual((await B.request('syncList',{shiftIds:[id]})).shifts,[]);
 assert.deepEqual((await A.request('syncList',{shiftIds:['shift-555-missing']})).shifts,[]);
 assert.deepEqual((await B.request('syncList')).shifts,[],'other user must not see A');
 await B.request('syncPut',{baseRevision:0,payload:JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift:{...shift,startedAt:'11:00'}})});
 assert.equal((await B.request('syncGet',{shiftId:id})).shift.startedAt,'11:00');
 assert.equal((await A.request('syncGet',{shiftId:id})).shift.startedAt,'10:00');
 await assert.rejects(()=>A.request('syncPut',{baseRevision:0,payload:JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift})}),/SYNC_CONFLICT/);
 assert.equal((await A.request('syncPut',{baseRevision:1,payload:JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift:{...shift,startedAt:'12:00'}})})).revision,2);
 assert.equal((await B.request('syncGet',{shiftId:id})).shift.startedAt,'11:00','updates must be isolated');
 // A session switch during the async transaction read must prevent any write.
 beforeTransactionRead=()=>A.bind(null);
 await assert.rejects(()=>A.request('syncPut',{baseRevision:2,payload:JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift:{...shift,startedAt:'13:00'}})}),/ログイン利用者が変更/);
 assert.equal(shifts.get('user-A/'+id).revision,2,'stale transaction must not write');
 A.bind({uid:'user-A'},{f:fire,db:{},auth:authA,session:fakeSession,admin:false});
 authA.currentUser={uid:'user-B'};
 await assert.rejects(()=>A.request('syncList'),/ログイン/);
 authA.currentUser={uid:'user-A'};
 A.bind({uid:'user-A'},{f:fire,db:{},auth:authA,session:fakeSession,admin:true});
 assert.equal(A.kind(),'legacy');
 assert.equal(A.endpoint(),'');
 await assert.rejects(()=>A.request('syncList'),/ログイン/);
 A.bind(null);
 assert.equal(A.kind(),'pending');
 await assert.rejects(()=>A.request('syncList'),/ログイン/);
 console.log('Private duty store tests passed: UID isolation, CAS, auth changes, owner legacy separation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
