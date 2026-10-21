'use strict';
const assert=require('node:assert/strict');
require('../firebase-trash-actions.js');
const factory=globalThis.TAXIAPP_TRASH_ACTIONS;
const id='shift-100-a',uid='user-A';
const duty={id,date:'2026-10-21',startedAt:'08:00',endedAt:'17:00',
 records:[{kind:'ride',raw:{K:2500}}],settings:{}};
function rig({onBackup,allow=true,ask=true}={}){
 let current=true,raw=structuredClone(duty),rev=1,
  trashed=false,saves=[],calls=[],notices=[];
 const client={
  async move(opts){
   calls.push(['move',opts]);
   if(opts.expectedRevision!==rev)throw Error('SYNC_CONFLICT');
   if(trashed)throw Error('already trashed');
   trashed=true;return {id,expiresAt:'2026-11-20'};
  },
  async list(){calls.push(['list']);return trashed?
   [{id,date:raw.date,recordCount:raw.records.length,expiresAt:'2026-11-20'}]:[];},
  async restore(opts){
   calls.push(['restore',opts]);
   if(!trashed)throw Error('not in bin');
   trashed=false;rev++;return {id,revision:rev};
  }
 };
 const diary={async request(action,fields){
  calls.push(['request',action,fields]);
  if(action!=='syncGet'||fields.shiftId!==id||trashed)
   throw Error('not available');
  return {id,revision:rev,shift:structuredClone(raw)};
 }};
 const control=factory.create({trash:client,diary,
  enabled:()=>allow,isCurrentEditor:()=>current,
  verifiedBackup:onBackup|| (async x=>{
   saves.push(x);return {verified:true,uid:x.uid,shiftId:x.shiftId,revision:x.revision};
  }),
  confirmAction:()=>ask,afterChange:x=>notices.push(x)});
 control.switchAccount(uid);
 return {control,client,diary,calls,saves,notices,deny:()=>current=false,
  setRev:x=>rev=x,setEnded:x=>raw.endedAt=x,trashed:()=>trashed};
}
(async()=>{
 // Disabled must never read the server, store backup or ask confirmation.
 {
  const r=rig({allow:false});
  assert.equal((await r.control.moveSelected(id)).status,'disabled');
  assert.equal(r.calls.length,0);
 }
 // Confirmation NO: backups can exist, but no server mutation happens.
 {
  const r=rig({ask:false});
  assert.equal((await r.control.moveSelected(id)).status,'cancelled');
  assert.equal(r.saves.length,1);
  assert.equal(r.calls.filter(c=>c[0]==='move').length,0);
 }
 // Failed durable backup stops before server mutation.
 {
  const r=rig({onBackup:async()=>({verified:false})});
  const res=await r.control.moveSelected(id);
  assert.equal(res.status,'deferred');
  assert.match(res.error,/保存と読み戻し/);
  assert.equal(r.calls.filter(c=>c[0]==='move').length,0);
 }
 // Success: specific duty, revised cloud copy, verified backup, confirmation.
 {
  const r=rig();
  const res=await r.control.moveSelected(id);
  assert.equal(res.status,'moved');
  assert.equal(res.shiftId,id);
  assert.equal(r.saves.length,1);
  assert.equal(r.calls.filter(c=>c[0]==='move')[0][1].expectedRevision,1);
  assert.equal(r.notices[0].action,'moved');
  assert.equal(r.trashed(),true);
  assert.equal((await r.control.restoreSelected(id)).status,'restored');
  assert.equal(r.notices[1].action,'restored');
  assert.equal(r.trashed(),false);
 }
 // An unfinished shift is never offered for server trash.
 {
  const r=rig();r.setEnded('');
  const result=await r.control.moveSelected(id);
  assert.equal(result.status,'deferred');
  assert.match(result.error,/未入庫/);
  assert.equal(r.saves.length,0);
 }
 // Another editor changing the server version invalidates the approval.
 {
  const r=rig({onBackup:async x=>{
   r.setRev(2);return {verified:true,uid:x.uid,shiftId:x.shiftId,revision:x.revision};
  }});
  const result=await r.control.moveSelected(id);
  assert.equal(result.status,'deferred');
  assert.match(result.error,/SYNC_CONFLICT/);
  assert.equal(r.trashed(),false);
 }
 // Account switch while waiting for archive readback cannot delete.
 {
  let release;const r=rig({onBackup:async x=>
   new Promise(resolve=>release=()=>resolve({verified:true,uid:x.uid,shiftId:x.shiftId,revision:x.revision}))});
  const job=r.control.moveSelected(id);
  // request() awaits before backup starts. One microtask to enter backup.
  await Promise.resolve();await Promise.resolve();
  r.control.switchAccount('user-B');
  if(typeof release==='function')release();
  const outcome=await job;
  assert.equal(outcome.status,'deferred');
  assert.equal(r.calls.filter(c=>c[0]==='move').length,0);
 }
 // Read-only editor permission lost after backup blocks write.
 {
  const r=rig({onBackup:async x=>{
   r.deny();return {verified:true,uid:x.uid,shiftId:x.shiftId,revision:x.revision};
  }});
  assert.equal((await r.control.moveSelected(id)).status,'deferred');
  assert.equal(r.calls.filter(c=>c[0]==='move').length,0);
 }
 console.log('Trash actions staged UI controller: per-duty approval, backup verification, CAS and account switch safeguards passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
