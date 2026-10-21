'use strict';
const assert=require('node:assert/strict');
require('../account-diary-store.js');
const maker=globalThis.TAXIAPP_ACCOUNT_DIARY;
const clone=v=>JSON.parse(JSON.stringify(v));
const id='shift-123-a',shift={id,date:'2026-10-21',records:[],settings:{},startedAt:'08:00',endedAt:'17:00'};
const packet=JSON.stringify({kind:'TAXIAPP_SHIFT_V1',shift});
function rig({protectDeletedIds=false,uid='user-A'}={}){
 const rows=new Map(),reads=[],writes=[],auth={currentUser:{uid}},session={sessionId:()=> 's'.repeat(36)};
 let afterGet=null;
 const key=r=>r.uid+'/'+r.section+'/'+r.id;
 const f={
  doc(_db,folder,owner,section,refId){
   assert.equal(folder,'privateDuties');return {uid:owner,section,id:refId};
  },
  serverTimestamp:()=> 123,
  async runTransaction(_db,operation){
   const scheduled=[];const tx={
    async get(ref){
     reads.push(key(ref));
     const item=rows.get(key(ref));
     if(afterGet){const hook=afterGet;afterGet=null;hook();}
     return {exists:()=>item!==undefined,data:()=>clone(item)};
    },
    set(ref,data){scheduled.push([key(ref),clone(data)]);}
   };
   const result=await operation(tx);
   for(const [k,v] of scheduled){rows.set(k,v);writes.push(k);}
   return result;
  }
 };
 const api=maker.create();
 const bind=(more={})=>api.bind({uid},{f,db:{},auth,session,admin:false,protectDeletedIds,...more});
 bind();
 return {api,bind,rows,reads,writes,auth,setHook:fn=>afterGet=fn,
  dutyKey:()=>uid+'/shifts/'+id,markerKey:()=>uid+'/tombstones/'+id};
}
const marker=(state='deleted')=>({
 format:'TAXIAPP_DUTY_TOMBSTONE_V1',state,generation:1,revision:1,writerSessionId:'s'.repeat(36)
});
(async()=>{
 // Default OFF is essential: existing users do not have permission to read
 // tombstones until Rules are separately reviewed and deployed.
 {
  const r=rig();
  const ans=await r.api.request('syncPut',{baseRevision:0,payload:packet});
  assert.equal(ans.revision,1);
  assert.equal(r.reads.filter(x=>x.includes('/tombstones/')).length,0);
  assert.equal(r.writes.length,1);
 }
 // A deleted marker prevents even a baseRevision 0 create in opted-in clients.
 {
  const r=rig({protectDeletedIds:true});
  r.rows.set(r.markerKey(),marker());
  await assert.rejects(r.api.request('syncPut',{baseRevision:0,payload:packet}),/TRASH_DELETED/);
  assert.equal(r.rows.has(r.dutyKey()),false);
  assert.equal(r.writes.length,0);
  assert.ok(r.reads.includes(r.markerKey()));
 }
 // Restore is handled by the separate 3-document CAS, not by syncPut.
 {
  const r=rig({protectDeletedIds:true});
  r.rows.set(r.markerKey(),marker('active'));
  await assert.rejects(r.api.request('syncPut',{baseRevision:0,payload:packet}),/復元済み/);
  assert.equal(r.writes.length,0);
 }
 // Normal opted-in creation and later edits remain possible without markers.
 {
  const r=rig({protectDeletedIds:true});
  assert.equal((await r.api.request('syncPut',{baseRevision:0,payload:packet})).revision,1);
  assert.equal((await r.api.request('syncPut',{baseRevision:1,payload:packet})).revision,2);
  r.rows.set(r.markerKey(),marker('active'));
  assert.equal((await r.api.request('syncPut',{baseRevision:2,payload:packet})).revision,3);
  assert.equal(r.rows.get(r.dutyKey()).revision,3);
 }
 // Corrupt history is a hard error, not permission to upload.
 {
  const r=rig({protectDeletedIds:true});
  r.rows.set(r.markerKey(),{state:'something-else'});
  await assert.rejects(r.api.request('syncPut',{baseRevision:0,payload:packet}),/形式/);
  assert.equal(r.writes.length,0);
 }
 // UID has to remain the same after the marker read.
 {
  const r=rig({protectDeletedIds:true});
  r.setHook(()=>r.auth.currentUser={uid:'user-B'});
  await assert.rejects(r.api.request('syncPut',{baseRevision:0,payload:packet}),/ログイン利用者/);
  assert.equal(r.writes.length,0);
 }
 {
  const r=rig({protectDeletedIds:true});
  r.setHook(()=>r.api.bind(null));
  await assert.rejects(r.api.request('syncPut',{baseRevision:0,payload:packet}),/ログイン利用者/);
  assert.equal(r.writes.length,0);
 }
 // Read-only and other UID do not circumvent protections.
 {
  const r=rig({protectDeletedIds:true});
  r.bind({readOnly:true});
  await assert.rejects(r.api.request('syncPut',{baseRevision:0,payload:packet}),/読み取り専用/);
  r.bind();
  r.auth.currentUser={uid:'user-B'};
  await assert.rejects(r.api.request('syncPut',{baseRevision:0,payload:packet}),/ログイン/);
 }
 console.log('Opt-in tombstone syncPut guard: existing legacy unaffected; 8 safeguards passed');
})().catch(e=>{console.error(e);process.exitCode=1});
