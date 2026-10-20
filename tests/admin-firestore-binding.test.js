'use strict';
const assert=require('node:assert/strict');
require('../account-diary-store.js');
const factory=globalThis.TAXIAPP_ACCOUNT_DIARY;
const shifts=new Map();
const clone=x=>JSON.parse(JSON.stringify(x));
const f={
 collection(_db,_folder,uid){return {uid};},
 doc(_db,_folder,uid,_leaf,id){return {uid,id};},
 async getDocsFromServer(ref){return {docs:[...shifts].filter(([k])=>k.startsWith(ref.uid+'/')).map(([k,v])=>({
  id:k.slice(ref.uid.length+1),data:()=>clone(v)
 }))};},
 async getDocFromServer(ref){const r=shifts.get(ref.uid+'/'+ref.id);
  return {exists:()=>!!r,data:()=>clone(r)};},
 async runTransaction(_db,fn){
  const pending=[];const tx={
   async get(ref){const r=shifts.get(ref.uid+'/'+ref.id);return {exists:()=>!!r,data:()=>clone(r)};},
   set(ref,record){pending.push([ref.uid+'/'+ref.id,clone({...record,updatedAt:12345})]);}
  };const v=await fn(tx);pending.forEach(([id,r])=>shifts.set(id,r));return v;
 },
 serverTimestamp:()=>12345
};
const auth={currentUser:{uid:'admin-A'}};
const opts={f,db:{},auth,session:{sessionId:()=> 's'.repeat(36)},admin:true};
const admin=factory.create();
const id='shift-123456-a',shift={id,records:[],settings:{},date:'2026-10-21',startedAt:'08:00'};
(async()=>{
 admin.bind({uid:'admin-A'},opts);
 assert.equal(admin.kind(),'legacy','existing administrator remains legacy by default');
 assert.equal(admin.endpoint(),'','legacy mode must not point to Firestore');
 await assert.rejects(()=>admin.request('syncList'),/ログイン/);
 assert.equal(shifts.size,0,'legacy mode must never write Firestore');
 admin.bind({uid:'admin-A'},{...opts,storageBackend:'firestore'});
 assert.equal(admin.kind(),'member');
 assert.equal(admin.endpoint(),'firestore-duties://admin-A');
 assert.deepEqual(await admin.request('syncList'),{shifts:[]});
 assert.equal((await admin.request('syncPut',{baseRevision:0,payload:JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift})})).revision,1);
 assert.equal((await admin.request('syncGet',{shiftId:id})).shift.date,'2026-10-21');
 assert.equal(shifts.size,1,'only explicitly opted-in admin can use this namespace');
 assert.equal((await admin.request('syncList')).shifts[0].id,id);
 const other=factory.create(),otherAuth={currentUser:{uid:'driver-B'}};
 other.bind({uid:'driver-B'},{f,db:{},auth:otherAuth,admin:false,session:opts.session});
 assert.deepEqual((await other.request('syncList')).shifts,[],'different UID cannot read administrator duties');
 await assert.rejects(()=>other.request('syncGet',{shiftId:id}),/クラウドにありません/);
 assert.throws(()=>other.bind({uid:'driver-B'},{f,db:{},auth:otherAuth,admin:false,session:opts.session,storageBackend:'legacy'}),/使用できません/);
 // A bad explicit backend must be rejected instead of silently falling back.
 assert.throws(()=>admin.bind({uid:'admin-A'},{...opts,storageBackend:'unknown'}),/不正/);
 admin.bind({uid:'admin-A'},opts);
 assert.equal(admin.endpoint(),'','reverting the opt-in must restore legacy routing');
 console.log('Admin Firestore opt-in passed: default legacy, explicit owner UID, no cross-account read');
})().catch(e=>{console.error(e);process.exitCode=1;});
