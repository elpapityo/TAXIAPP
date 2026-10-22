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
 where(field,op,value){return {field,op,value};},
 query(collection,filter){return {...collection,filter};},
 async getDocsFromServer(collection){
  const found=keys(collection).filter(([,row])=>{
   if(!collection.filter)return true;
   const {field,op,value}=collection.filter;
   return field==='shift.date'&&op==='=='&&row.shift?.date===value;
  });
  return {docs:found.map(([key,row])=>({
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
const id='shift-1234-abc',shift={id,date:'2026-10-22',records:[],settings:{},startedAt:'10:00'};
(async()=>{
 assert.equal(A.kind(),'member');assert.notEqual(A.endpoint(),B.endpoint());
 assert.deepEqual(await A.request('syncList'),{shifts:[]});
 const sent=await A.request('syncPut',{baseRevision:0,payload:JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift})});
 assert.equal(sent.revision,1);
 assert.equal(sent.confirmed,true,'Firestoreは保存後にサーバー原本を読み戻して確認する');
 assert.equal((await A.request('syncList')).shifts.length,1);
 const historyA=await A.request('syncHistoryDate',{date:'2026-10-22'});
 assert.equal(historyA.shifts.length,1,'本人の指定日だけ取得');
 assert.equal(historyA.shifts[0].shift.id,id);
 assert.equal((await B.request('syncHistoryDate',{date:'2026-10-22'})).shifts.length,0,'別UIDは表示しない');
 assert.equal((await A.request('syncHistoryDate',{date:'2026-10-21'})).shifts.length,0);
 await assert.rejects(()=>A.request('syncHistoryDate',{date:'2026-02-30'}),/日付/);
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
 const authC={currentUser:{uid:'user-C'}};
 const C=factory.create();
 C.bind({uid:'user-C'},{f:fire,db:{},auth:authC,session:fakeSession,admin:false});
 const source={...shift,id:'shift-1234-trash'};
 const created=await C.request('syncPut',{baseRevision:0,payload:JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift:source})});
 assert.equal(created.revision,1);
 const trashed=await C.request('syncTrash',{shiftId:source.id,baseRevision:1});
 assert.equal(trashed.deleted,true);
 assert.equal(trashed.revision,2);
 assert.equal((await C.request('syncList')).shifts[0].deleted,true);
 assert.equal(shifts.get('user-C/'+source.id).shift.id,source.id,'soft trash preserves original data');
 await assert.rejects(()=>C.request('syncGet',{shiftId:source.id}),/ゴミ箱/);
 await assert.rejects(()=>C.request('syncPut',{baseRevision:2,payload:JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift:source})}),/削除済み/);
 await assert.rejects(()=>C.request('syncRestore',{shiftId:source.id,baseRevision:1}),/SYNC_CONFLICT/);
 const restored=await C.request('syncRestore',{shiftId:source.id,baseRevision:2});
 assert.equal(restored.revision,3);
 assert.equal(restored.deleted,false);
 assert.equal((await C.request('syncGet',{shiftId:source.id})).shift.id,source.id);
 console.log('本人専用Firestoreゴミ箱：原本保持・CAS復元・他UID分離を合成確認');
 console.log('Private duty store tests passed: UID isolation, CAS, auth changes, owner legacy separation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
