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
 orderBy(field,direction){return {sortField:field,direction};},
 limit(count){return {count};},
 startAfter(snapshot){return {afterId:snapshot.id};},
 query(collection,...constraints){return {...collection,constraints};},
 async getDocsFromServer(collection){
  const constraints=collection.constraints||[];
  let found=keys(collection);
  for(const item of constraints){
   if(item.field){
    assert.equal(item.op,'==');
    found=found.filter(([,row])=>
     item.field.split('.').reduce((value,key)=>value?.[key],row)===item.value);
   }
  }
  const order=constraints.find(item=>item.sortField);
  if(order){
   const valueOf=([,row])=>order.sortField.split('.').reduce((v,k)=>v?.[k],row);
   found=found.filter(entry=>valueOf(entry)!==undefined);
   found.sort((a,b)=>String(valueOf(a)).localeCompare(String(valueOf(b)))*
    (order.direction==='desc'?-1:1));
  }
  const after=constraints.find(item=>item.afterId);
  if(after){
   const offset=found.findIndex(([key])=>key.split('/')[1]===after.afterId);
   found=offset<0?[]:found.slice(offset+1);
  }
  const max=constraints.find(item=>Number.isInteger(item.count));
  if(max)found=found.slice(0,max.count);
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
 // A fresh phone is allowed to retrieve only one current duty, not all
 // historical documents. An older unfinished duty wins over a newer return.
 const resumeUser={uid:'user-resume'};
 const R=factory.create(),resumeAuth={currentUser:{uid:resumeUser.uid}};
 R.bind(resumeUser,{f:fire,db:{},auth:resumeAuth,session:fakeSession});
 const closedShift={...shift,id:'shift-1792700000001',startedIso:'2026-10-22T11:00:00Z',
  endedAt:'18:00:00',endedIso:'2026-10-22T09:00:00Z'};
 const openShift={...shift,id:'shift-1792690000001',startedIso:'2026-10-21T10:00:00Z',
  endedAt:'',endedIso:''};
 await R.request('syncPut',{baseRevision:0,payload:JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift:closedShift})});
 await R.request('syncPut',{baseRevision:0,payload:JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift:openShift})});
 let selected=await R.request('syncList',{resumeOnly:true});
 assert.deepEqual(selected.shifts.map(x=>x.id),[openShift.id],
  '端末0件では直近の入庫済みより未入庫原本を優先する');
 const secondOpen={...openShift,id:'shift-1792680000001',
  startedIso:'2026-10-20T10:00:00Z'};
 await R.request('syncPut',{baseRevision:0,payload:JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift:secondOpen})});
 await assert.rejects(()=>R.request('syncList',{resumeOnly:true}),/未入庫乗務が複数/,
  '未入庫原本を勝手に1件へ絞らない');
 await R.request('syncTrash',{shiftId:secondOpen.id,baseRevision:1});
 await R.request('syncTrash',{shiftId:openShift.id,baseRevision:1});
 selected=await R.request('syncList',{resumeOnly:true});
 assert.deepEqual(selected.shifts.map(x=>x.id),[closedShift.id],
  '未入庫が全てゴミ箱にある場合は直近の入庫済みだけを返す');
 const newerTrashed={...closedShift,id:'shift-1792790000001',
  startedIso:'2026-10-23T11:00:00Z'};
 await R.request('syncPut',{baseRevision:0,payload:JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift:newerTrashed})});
 await R.request('syncTrash',{shiftId:newerTrashed.id,baseRevision:1});
 selected=await R.request('syncList',{resumeOnly:true});
 assert.deepEqual(selected.shifts.map(x=>x.id),[closedShift.id],
  '直近のゴミ箱原本を除外し以前の入庫済みを選択する');
 assert.deepEqual((await B.request('syncList',{resumeOnly:true})).shifts,[],
  '他UIDの候補を検索しない');
 await assert.rejects(()=>R.request('syncList',{resumeOnly:true,shiftIds:[closedShift.id]}),
  /同時に使えません/);
 const safeWithoutQuery=factory.create();
 safeWithoutQuery.bind(resumeUser,{f:{...fire,orderBy:undefined},db:{},
  auth:resumeAuth,session:fakeSession});
 await assert.rejects(()=>safeWithoutQuery.request('syncList',{resumeOnly:true}),
  /全件の取得は行わず保留/,'インデックス取得が使えなければ全件検索に退避しない');
 console.log('Firestore新端末：未入庫優先、複数停止、ゴミ箱除外、別UID保護、全件取得禁止を確認');
 console.log('本人専用Firestoreゴミ箱：原本保持・CAS復元・他UID分離を合成確認');
 console.log('Private duty store tests passed: UID isolation, CAS, auth changes, owner legacy separation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
