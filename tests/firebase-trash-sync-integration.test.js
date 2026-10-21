'use strict';
const assert=require('node:assert/strict');
require('../firebase-duty-trash.js');
require('../account-diary-store.js');
const trashMaker=globalThis.TAXIAPP_DUTY_TRASH;
const diaryMaker=globalThis.TAXIAPP_ACCOUNT_DIARY;
const clone=v=>JSON.parse(JSON.stringify(v));
const uid='driver-A',id='shift-777-a';
const shift={id,date:'2026-10-21',startedAt:'08:00',endedAt:'17:00',
 records:[{kind:'ride',raw:{K:2500}}],settings:{}};
function rig(){
 const data=new Map(),written=[],auth={currentUser:{uid}},
 session={sessionId:()=> 'q'.repeat(36)},p=ref=>ref.uid+'/'+ref.section+'/'+ref.id;
 const f={
  doc(_db,parent,u,section,shiftId){assert.equal(parent,'privateDuties');return {uid:u,section,id:shiftId};},
  collection(_db,parent,u,section){assert.equal(parent,'privateDuties');return {uid:u,section};},
  serverTimestamp:()=> 123,
  async getDocFromServer(ref){const row=data.get(p(ref));return {exists:()=>row!==undefined,data:()=>clone(row)};},
  async getDocsFromServer(ref){return {docs:[...data].filter(([k])=>k.startsWith(ref.uid+'/'+ref.section+'/')).map(([k,v])=>({id:k.split('/')[2],data:()=>clone(v)}))};},
  async runTransaction(_db,fn){
   const changes=[],tx={
    async get(ref){const row=data.get(p(ref));return {exists:()=>row!==undefined,data:()=>clone(row)};},
    set(ref,value){changes.push(['set',p(ref),clone(value)]);},
    delete(ref){changes.push(['delete',p(ref)]);}
   };
   const response=await fn(tx);
   for(const [op,key,val] of changes){
    if(op==='delete')data.delete(key);else data.set(key,val);
    written.push([op,key]);
   }
   return response;
  }
 };
 data.set(uid+'/shifts/'+id,{format:'TAXIAPP_PRIVATE_SHIFT_V1',
  revision:1,shift:clone(shift),writerSessionId:'q'.repeat(36),updatedAt:123});
 const trash=trashMaker.create();
 trash.bind({uid},{f,db:{},auth,session});
 const diary=diaryMaker.create();
 diary.bind({uid},{f,db:{},auth,session,admin:false,protectDeletedIds:true});
 const packet=JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift});
 return {trash,diary,data,written,packet,auth,f,session};
}
(async()=>{
 const r=rig();
 assert.equal((await r.trash.move({shiftId:id,expectedRevision:1,confirmed:true})).generation,1);
 assert.equal(r.data.has(uid+'/shifts/'+id),false);
 assert.equal(r.data.get(uid+'/tombstones/'+id).state,'deleted');
 let writes=r.written.length;
 await assert.rejects(r.diary.request('syncPut',{baseRevision:0,payload:r.packet}),/TRASH_DELETED/);
 assert.equal(r.written.length,writes,'old cached duty must not be republished');
 // Even after the 30-day *body* is erased, the tiny tombstone persists.
 r.data.get(uid+'/trash/'+id).expiresAt='2020-01-01T00:00:00Z';
 const expiry=await r.trash.purgeExpired({max:20});
 assert.deepEqual(expiry.purged,[id]);
 assert.equal(r.data.has(uid+'/trash/'+id),false);
 assert.equal(r.data.has(uid+'/tombstones/'+id),true);
 writes=r.written.length;
 await assert.rejects(r.diary.request('syncPut',{baseRevision:0,payload:r.packet}),/TRASH_DELETED/);
 assert.equal(r.written.length,writes);
 // This is why server Rules are MANDATORY: an old client that does not
 // opt in to the marker guard can still recreate an original in the mock.
 const legacy=diaryMaker.create();
 legacy.bind({uid},{f:r.f,db:{},auth:r.auth,session:r.session,admin:false});
 const reproduced=await legacy.request('syncPut',{baseRevision:0,payload:r.packet});
 assert.equal(reproduced.revision,1);
 assert.ok(r.data.has(uid+'/shifts/'+id),'emulator Rules must reject this in production');
 // The proposed security rules must block this before any release.
 console.log('Firestore trash + syncPut integration: opted-in resend blocked after expiry; legacy gap explicitly reproduced');
})().catch(e=>{console.error(e);process.exitCode=1;});
