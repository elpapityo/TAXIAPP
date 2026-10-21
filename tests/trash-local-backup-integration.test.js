'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('function trashAccountCheck(uid,generation){');
const end=html.indexOf('const trashActions=window.TAXIAPP_TRASH_ACTIONS.create(',start);
assert.ok(start>0&&end>start,'live trash backup/switch code not found');
const uid='driver-A',id='shift-551-a';
const duty={id,date:'2026-10-20',startedAt:'08:00',endedAt:'17:00',records:[{kind:'ride',raw:{K:1500}}],settings:{}};
const other={...duty,id:'shift-552-a'};
const clone=x=>JSON.parse(JSON.stringify(x));
function rig(){
 const disk=new Map(),storage=new Map(),messages=[];
 const ctx={
  Date,Math,JSON,
  accountScope:{uid},accountScopeGeneration:8,
  memberDiary:()=>true,canEditNow:()=>true,
  memberTrashConnection:{auth:{currentUser:{uid}}},
  model:{version:1,shifts:[clone(duty),clone(other)],activeId:null,prefs:{}},
  db:{},memberTrashLatestBackup:null,memberTrashPreview:{dummy:true},memberTrashSelection:id,
  deepCopy:clone,scopedStorageKey:()=> 'taxiapp-account-state-v1-'+uid,
  idbPut:async(_db,value,key)=>disk.set(key,clone(value)),
  idbGet:async(_db,key)=>clone(disk.get(key)||null),
  localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)??null},
  render:()=>messages.push('render')
 };
 vm.createContext(ctx);
 vm.runInContext(html.slice(start,end),ctx);
 const invoke=(name,argument)=>vm.runInContext(name,ctx)(argument);
 return {ctx,invoke,disk,storage,messages};
}
(async()=>{
 // Durable UID-scoped archive precedes any local removal.
 {
  const h=rig(),before=JSON.stringify(h.ctx.model);
  const saved=await h.invoke('verifiedTrashBackup',{uid,shiftId:id,revision:4,shift:clone(duty)});
  assert.equal(saved.verified,true);
  assert.equal(JSON.stringify(h.ctx.model),before);
  const index=JSON.parse(h.storage.get('taxiapp-trash-backup-index-v1-'+uid));
  assert.equal(index.length,1);
  assert.equal(h.disk.get(index[0]).shift.records[0].raw.K,1500);
  await h.invoke('afterTrashChange',{uid,shiftId:id,action:'moved'});
  assert.deepEqual(h.ctx.model.shifts.map(x=>x.id),[other.id]);
  assert.equal(h.disk.get('taxiapp-account-state-v1-'+uid).shifts.length,1);
  assert.equal(h.ctx.memberTrashSelection,'');
 }
 // Unsynced local edits must NOT be silently deleted.
 {
  const h=rig();
  h.ctx.model.shifts[0].records[0].raw.K=3333;
  await assert.rejects(h.invoke('verifiedTrashBackup',{uid,shiftId:id,revision:4,shift:clone(duty)}),/未同期/);
  assert.equal(h.disk.size,0);
  assert.equal(h.ctx.model.shifts.length,2);
 }
 // Backup read-after-write failure leaves original duty untouched.
 {
  const h=rig();h.ctx.idbGet=async()=>null;
  await assert.rejects(h.invoke('verifiedTrashBackup',{uid,shiftId:id,revision:4,shift:clone(duty)}),/読み戻せません/);
  assert.equal(h.ctx.model.shifts.length,2);
 }
 // A change made after backup but before server confirmation is protected.
 {
  const h=rig();
  await h.invoke('verifiedTrashBackup',{uid,shiftId:id,revision:4,shift:clone(duty)});
  h.ctx.model.shifts[0].records[0].raw.K=4500;
  await assert.rejects(h.invoke('afterTrashChange',{uid,shiftId:id,action:'moved'}),/更新されました/);
  assert.equal(h.ctx.model.shifts.length,2);
 }
 // Account switch invalidates any staged mutation or restoration UI.
 {
  const h=rig();
  await h.invoke('verifiedTrashBackup',{uid,shiftId:id,revision:4,shift:clone(duty)});
  h.ctx.accountScope={uid:'driver-B'};
  h.ctx.accountScopeGeneration++;
  await assert.rejects(h.invoke('afterTrashChange',{uid,shiftId:id,action:'moved'}),/本人アカウント/);
  assert.equal(h.ctx.model.shifts.length,2);
 }
 console.log('Live staged trash safety: UID-scoped durable copy, readback, unsynced protection, changed writer and local preservation');
})().catch(error=>{console.error(error);process.exitCode=1;});
