'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
function extract(before,after,context){
 const begin=html.indexOf(before),end=html.indexOf(after,begin);
 assert.ok(begin>=0 && end>begin,'missing callback: '+before);
 const source=html.slice(begin+before.indexOf(':')+1,end).trim().replace(/,\s*$/,'');
 return vm.runInNewContext('('+source+')',context);
}
function harness(member=true){
 const original={id:'shift-1234-a',records:[],settings:{},startedIso:'2026-10-20T10:00'};
 const ctx={
  deviceMode:'writer',writerLoadGate:true,writerLoadEpoch:7,MAX_RECORDS:60,
  model:{version:1,shifts:[clone(original)],activeId:original.id,prefs:{}},
  accountScope:{uid:'user-A'},accountScopeGeneration:1,memberDiary:()=>member,
  trashEnabled:()=>false,
  deepCopy:clone,Date,Math,JSON,
  canonicalDutyJson:x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v),
  pendingMemberRecovery:null,memberRecoveryBusy:false,
  localStorage:null,scopedStorageKey:()=>member?'taxiapp-account-state-v1-user-A':'taxiapp-v1',
  db:{},writes:[],disk:new Map(),backups:new Map(),backupFailure:false,
  render:()=>{},keypadActive:false,appEl:{querySelector:()=>null}
 };
 ctx.localStorage={
  getItem(key){return ctx.backups.has(key)?ctx.backups.get(key):null;},
  setItem(key,value){
   if(ctx.backupFailure && key.startsWith('taxiapp-pre-cloud-recovery-v1-'))throw Error('quota exceeded');
   ctx.backups.set(key,value);
  }
 };
 ctx.idbPut=async(_db,state,key)=>{ctx.writes.push(key);ctx.disk.set(key,clone(state));};
 ctx.idbGet=async(_db,key)=>clone(ctx.disk.get(key)||null);
 ctx.canEditNow=()=>true;
 ctx.save=async()=>{await ctx.idbPut(ctx.db,ctx.model,ctx.scopedStorageKey());};
 return {ctx,original};
}
const snapshot=(ctx)=>extract('onWriterSnapshot:async shifts=>{','onWriterBootstrapReady:',ctx);
const replace=(ctx)=>extract('replace:async(id,incoming,existing)=>{','root:appEl',ctx);
(async()=>{
 // Never replace unpublished duty records with an empty cloud snapshot.
 {
  const {ctx,original}=harness(true),before=JSON.stringify(ctx.model);
  await assert.rejects(snapshot(ctx)([]),/未同期の乗務/);
  assert.equal(JSON.stringify(ctx.model),before);
  assert.equal(ctx.writes.length,0,'local record must not be overwritten');
  assert.equal(ctx.backups.size,0,'do not attempt adoption of unmatched duties');
 }
 // Even a same-ID but changed local shift must not be silently accepted.
 {
  const {ctx,original}=harness(true);
  await assert.rejects(snapshot(ctx)([{...original,startedIso:'2026-10-21T10:00'}]),/未同期の乗務/);
  assert.equal(ctx.writes.length,0);
 }
 // A failed recovery copy MUST abort the operation before any persistent write.
 {
  const {ctx,original}=harness(false);
  ctx.backupFailure=true;
  await assert.rejects(snapshot(ctx)([{...original,startedIso:'2026-10-21T10:00'}]),/復旧コピーを保存できない/);
  assert.equal(ctx.writes.length,0);
  assert.equal(ctx.model.shifts[0].startedIso,original.startedIso);
 }
 // A verified recovery allows unchanged account data to be adopted.
 {
  const {ctx,original}=harness(true);
  const ok=await snapshot(ctx)([clone(original)]);
  assert.equal(ok,true);
  assert.deepEqual(ctx.writes,['taxiapp-account-state-v1-user-A']);
  assert.ok(ctx.backups.has('taxiapp-pre-cloud-recovery-v1-user-A'));
 }
 // Previous recovery copies should not be overwritten by a new snapshot.
 {
  const {ctx,original}=harness(false);
  const old='existing recovery';
  ctx.backups.set('taxiapp-pre-cloud-recovery-v1-user-A',old);
  await snapshot(ctx)([{...original,startedIso:'2026-10-21T10:00'}]);
  assert.equal(ctx.backups.get('taxiapp-pre-cloud-recovery-v1-user-A'),old);
  assert.ok([...ctx.backups.keys()].some(k=>k.startsWith('taxiapp-pre-cloud-recovery-v1-user-A-')));
 }
 // Remote duty replacement must verify the SAME account-scoped storage key.
 {
  const {ctx,original}=harness(true);
  const newShift={...original,startedIso:'2026-10-22T10:00'};
  await replace(ctx)(original.id,newShift,original);
  assert.equal(ctx.disk.get('taxiapp-account-state-v1-user-A').shifts[0].startedIso,newShift.startedIso);
  assert.deepEqual(ctx.writes,['taxiapp-account-state-v1-user-A']);
 }
 console.log('Cloud-first local duty protection: 6 cases passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
