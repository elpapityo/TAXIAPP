'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const from=html.indexOf('async function resolveDeletedLocalShifts(){');
const to=html.indexOf('async function uploadMemberRecovery(){',from);
assert.ok(from>=0&&to>from);
const id='shift-900-a',uid='user-A';
const shift={id,date:'2026-10-20',startedAt:'08:00',endedAt:'16:00',
 records:[{kind:'ride',raw:{K:9999}}],settings:{}};
const obj={version:1,shifts:[shift],prefs:{},activeId:null};
const clone=x=>JSON.parse(JSON.stringify(x));
function runMock(confirmValue){
 const stored=new Map(),disk=new Map(),msgs=[],requests=[];
 const state={
  accountScope:{uid},accountScopeGeneration:1,
  memberDiary:()=>true,deviceMode:'writer',writerLoadGate:true,
  writerLoadEpoch:7,trashEnabled:()=>true,
  pendingMemberRecovery:{uid,epoch:7,deletedIds:[id],missingIds:[],conflictCount:0},
  memberRecoveryBusy:false,model:clone(obj),
  db:{},deepCopy:clone,render(){},confirm:()=>confirmValue,
  toast:(...p)=>msgs.push(p),Date,Math,JSON,
  canonicalDutyJson:JSON.stringify,
  scopedStorageKey:()=> 'taxiapp-account-state-v1-'+uid,
  localStorage:{
   getItem:key=>stored.get(key)??null,
   setItem:(key,value)=>stored.set(key,value)
  },
  idbPut:async(_db,content,key)=>{disk.set(key,clone(content));},
  idbGet:async(_db,key)=>clone(disk.get(key)||null),
  trashClient:{async readDeletionMarkers(ids){
   requests.push([...ids]);
   return {uid,markersComplete:true,markerStates:ids.map(id=>({id,state:'deleted'}))};
  }},
  syncUI:{async bootstrapWriter(){requests.push('bootstrap');}}
 };
 vm.createContext(state);
 vm.runInContext(html.slice(from,to),state);
 return {state,stored,disk,msgs,requests};
}
(async()=>{
 // No consent => no local deletions, no persistent mutation.
 {
  const h=runMock(false);
  await vm.runInContext('resolveDeletedLocalShifts()',h.state);
  assert.equal(h.state.model.shifts.length,1);
  assert.equal(h.disk.size,0);
  assert.equal(h.requests.length,1);
 }
 // Consent -> backup full old local model, read it back, index it by UID,
 // and only then remove the server-deleted row from the live local model.
 {
  const h=runMock(true);
  await vm.runInContext('resolveDeletedLocalShifts()',h.state);
  assert.equal(h.state.model.shifts.length,0);
  const keys=JSON.parse(h.stored.get('taxiapp-deleted-local-index-v1-'+uid));
  assert.equal(keys.length,1);
  assert.equal(h.disk.get(keys[0]).model.shifts[0].records[0].raw.K,9999);
  assert.equal(h.disk.get('taxiapp-account-state-v1-'+uid).shifts.length,0);
  assert.equal(h.requests.at(-1),'bootstrap');
  assert.equal(h.state.memberRecoveryBusy,false);
 }
 // A failed durable archive write/read cannot modify local diary data.
 {
  const h=runMock(true);
  h.state.idbPut=async(_db,content,key)=>{
   if(key.startsWith('taxiapp-deleted-local-archive-v1-'))throw Error('disk full');
   h.disk.set(key,clone(content));
  };
  await vm.runInContext('resolveDeletedLocalShifts()',h.state);
  assert.equal(h.state.model.shifts.length,1);
  assert.equal(h.disk.size,0);
  assert.ok(h.msgs.some(x=>String(x[0]).includes('中止')));
 }
 // Another event may change account settings while IndexedDB persists
 // the filtered duty list. Preserve the latest full model, including that
 // unrelated edit, and abort removal until deletion markers are rechecked.
 {
  const h=runMock(true),targetKey='taxiapp-account-state-v1-'+uid;
  const oldPut=h.state.idbPut;
  let injected=false;
  h.state.idbPut=async(db,value,key)=>{
   await oldPut(db,value,key);
   if(key===targetKey&&!injected){
    injected=true;
    h.state.model.prefs.theme='night';
   }
  };
  await vm.runInContext('resolveDeletedLocalShifts()',h.state);
  assert.equal(h.state.model.shifts.length,1);
  assert.equal(h.state.model.prefs.theme,'night');
  assert.equal(h.disk.get(targetKey).shifts.length,1);
  assert.equal(h.disk.get(targetKey).prefs.theme,'night');
  assert.ok(h.msgs.some(x=>String(x[0]).includes('中止')));
 }
 // Re-read tombstone: if deletion was reversed on the server, do nothing.
 {
  const h=runMock(true);
  h.state.trashClient.readDeletionMarkers=async ids=>({
   uid,markersComplete:true,markerStates:ids.map(id=>({id,state:'active'}))
  });
  await vm.runInContext('resolveDeletedLocalShifts()',h.state);
  assert.equal(h.state.model.shifts.length,1);
  assert.equal(h.disk.size,0);
 }
 console.log('Deleted server duty local quarantine: explicit confirmation, protected copy, UID index, no data loss');
})().catch(e=>{console.error(e);process.exitCode=1;});
