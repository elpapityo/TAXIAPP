'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)
 ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const start=html.indexOf('async function resolveMemberConflict(');
const end=html.indexOf('async function downloadMemberConflictArchive(',start);
assert.ok(start>0&&end>start,'must find actual conflict handler in index.html');
const resolverSource=html.slice(start,end);
function setup({consent=true, failBackup=false, failIndex=false, mutateCloud=false}={}){
 const id='shift-1740000-a';
 const local={id,startedIso:'2026-10-21T10:00',date:'2026-10-21',records:[],settings:{},value:'LOCAL'};
 const remote={...local,value:'CLOUD'};
 const disk=new Map(),store=new Map(),messages=[],written=[];
 let revision=1,cloud=clone(remote),readCount=0,synced=0;
 const pending={uid:'user-A',epoch:7,conflictIds:[id],conflictCount:1,missingIds:[]};
 const ctx={
  memberRecoveryBusy:false,pendingMemberRecovery:pending,
  accountScope:{uid:'user-A'},accountScopeGeneration:2,
  deviceMode:'writer',writerLoadGate:true,writerLoadEpoch:7,
  model:{version:1,shifts:[clone(local)],activeId:id,prefs:{}},
  memberDiary:()=>true,render(){},toast:(...args)=>messages.push(args),
  confirm:()=>consent,Date,Math,JSON,deepCopy:clone,canonicalDutyJson:canonical,
  totals:()=>({meter:1000}),money:n=>'¥'+n,db:{},
  localStorage:{
   getItem:k=>store.has(k)?store.get(k):null,
   setItem(k,v){if(failIndex&&k.startsWith('taxiapp-account-conflict-index-v1-'))throw Error('index failed');store.set(k,v);}
  },
  idbPut:async(_db,v,k)=>{if(failBackup&&k.startsWith('taxiapp-account-conflict-copy-v1'))throw Error('disk full');disk.set(k,clone(v));},
  idbGet:async(_db,k)=>clone(disk.get(k)||null),
  scopedStorageKey:()=> 'taxiapp-account-state-v1-user-A',
  accountDiary:{async request(action,fields){
   if(action==='syncGet'){
    readCount++;
    if(mutateCloud&&readCount===2){revision=2;cloud={...cloud,value:'OTHER EDIT'};}
    return {id,revision,shift:clone(cloud)};
   }
   if(action==='syncPut'){
    written.push(fields);
    assert.equal(fields.baseRevision,revision);
    const saved=JSON.parse(fields.payload).shift;
    cloud=clone(saved);revision++;
    return {id,revision};
   }
   throw Error('unexpected request '+action);
  }},
  syncUI:{async bootstrapWriter(){synced++;}},
  download(){},dateStamp:()=>'20261021'
 };
 vm.createContext(ctx);
 vm.runInContext(resolverSource,ctx);
 const perform=(useLocal)=>vm.runInContext('resolveMemberConflict',ctx)(id,useLocal);
 return {ctx,id,local,remote,store,disk,messages,written,perform,cloud:()=>cloud,synced:()=>synced};
}
(async()=>{
 // Refusing approval must not write, backup, or override anything.
 {
  const h=setup({consent:false});await h.perform(true);
  assert.equal(h.written.length,0);assert.equal(h.disk.size,0);
  assert.equal(h.ctx.model.shifts[0].value,'LOCAL');
 }
 // Approve local version: save both originals, CAS update and readback.
 {
  const h=setup();await h.perform(true);
  assert.equal(h.written.length,1);
  assert.equal(h.written[0].baseRevision,1);
  assert.equal(h.cloud().value,'LOCAL');
  const backup=[...h.disk.values()].find(v=>v.format==='TAXIAPP_CONFLICT_BACKUP_V1');
  assert.ok(backup);
  assert.equal(backup.local.value,'LOCAL');assert.equal(backup.cloud.value,'CLOUD');
  assert.equal(h.synced(),1);
 }
 // Approve cloud version: preserve both, replace only scoped IndexedDB state.
 {
  const h=setup();await h.perform(false);
  assert.equal(h.written.length,0);
  assert.equal(h.cloud().value,'CLOUD');
  assert.equal(h.ctx.model.shifts[0].value,'CLOUD');
  assert.equal(h.disk.get('taxiapp-account-state-v1-user-A').shifts[0].value,'CLOUD');
  assert.equal(h.synced(),1);
 }
 // On new server revision the prior approval is invalidated.
 {
  const h=setup({mutateCloud:true});await h.perform(true);
  assert.equal(h.written.length,0);assert.equal(h.ctx.model.shifts[0].value,'LOCAL');
  assert.equal(h.synced(),0);
  assert.ok(h.messages.some(x=>String(x[0]).includes('再確認')));
 }
 // No backup, no overwrite.
 {
  const h=setup({failBackup:true});await h.perform(false);
  assert.equal(h.written.length,0);assert.equal(h.ctx.model.shifts[0].value,'LOCAL');
  assert.equal(h.disk.size,0);
 }
 // No discoverable backup index, no overwrite.
 {
  const h=setup({failIndex:true});await h.perform(true);
  assert.equal(h.written.length,0);
  assert.equal(h.cloud().value,'CLOUD');
 }
 // Auth changes while awaiting server: no side effects.
 {
  const h=setup();const request=h.ctx.accountDiary.request;
  h.ctx.accountDiary.request=async(a,f)=>{const x=await request(a,f);h.ctx.accountScope.uid='user-B';return x;};
  await h.perform(true);
  assert.equal(h.written.length,0);assert.equal(h.disk.size,0);
 }
 assert.match(html,/data-action="takeLocalConflict"/);
 assert.match(html,/data-action="takeCloudConflict"/);
 assert.match(html,/downloadMemberConflictArchive/);
 console.log('Member diary overwrite consent: 7 guarded scenarios passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
