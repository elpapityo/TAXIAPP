'use strict';
// Synthetic but runs the actual login UI adapter and synchronization engine.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const clone=x=>JSON.parse(JSON.stringify(x));
const id='shift-1792691000000-changed';
const start={id,date:'2026-10-22',startedAt:'09:00',records:[],settings:{}};
const store=new Map(),remote=new Map(),calls=[];
const root={
 localStorage:{
  getItem:key=>store.get(key)??null,
  setItem:(key,value)=>store.set(key,String(value))
 }
};
for(const f of ['bidirectional-sync.js','cloud-sync-ui.js'])
 vm.runInNewContext(fs.readFileSync(f,'utf8'),
  {window:root,globalThis:root,JSON,Date,Math,console,setTimeout,clearTimeout});
const model={shifts:[clone(start)]};
let unlocked=false,readyToBootstrap=true;
async function request(action,fields={}){
 calls.push(action);
 if(action==='syncList')return {shifts:[...remote].map(([id,r])=>({id,revision:r.revision}))};
 if(action==='syncGet'){
  const r=remote.get(fields.shiftId);
  if(!r)throw Error('missing original');
  return {id:fields.shiftId,revision:r.revision,shift:clone(r.shift)};
 }
 if(action==='syncPut'){
  const duty=JSON.parse(fields.payload).shift;
  const current=remote.get(duty.id);
  if(Number(fields.baseRevision)!==(current?.revision||0))throw Error('SYNC_CONFLICT');
  remote.set(duty.id,{shift:clone(duty),revision:(current?.revision||0)+1});
  return {id:duty.id,revision:remote.get(duty.id).revision};
 }
 throw Error('unexpected '+action);
}
const dependencies={
 getModel:()=>model,getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:clone(shift)}),
 getEndpoint:()=>'/owner-last-login',getScopeKey:()=> 'owner-uid',
 localStorage:root.localStorage,request,replaceRemoteShift:async()=>{}
};
(async()=>{
 // A previous successful session establishes the common ancestor.
 const prior=root.TAXIAPP_BIDIRECTIONAL_SYNC.create(dependencies);
 assert.equal(await prior.run(),true);
 assert.equal(remote.get(id).revision,1);
 model.shifts[0].startedAt='11:00'; // saved locally, not uploaded yet
 const adapter=root.TAXIAPP_SYNC_UI({
  ...dependencies,endpoint:dependencies.getEndpoint,scopeKey:dependencies.getScopeKey,
  prefs:()=>({syncMode:'on'}),configured:()=>true,
  canSync:()=>unlocked,canView:()=>false,
  writerBootstrapAllowed:()=>readyToBootstrap,
  onWriterSnapshot:async incoming=>{model.shifts=clone(incoming);return true;},
  onWriterBootstrapReady:()=>{unlocked=true;readyToBootstrap=false;},
  onWriterSynced:async()=>{},
  root:{querySelector:()=>null},setStatus:()=>{},
  toast:()=>{},escape:x=>String(x),isSettings:()=>true,
  dateStamp:()=> '20261022'
 });
 assert.equal(await adapter.bootstrapWriter(),true,
  'a local-only edit does not block the next writer session');
 assert.equal(model.shifts[0].startedAt,'11:00',
  'the confirmed cloud original must not overwrite local edits');
 assert.equal(remote.get(id).shift.startedAt,'09:00',
  'the online write is deferred until the writer session is unlocked');
 await new Promise(resolve=>setTimeout(resolve,950));
 assert.equal(remote.get(id).shift.startedAt,'11:00',
  'the pending local change reaches the same owner cloud');
 assert.equal(remote.get(id).revision,2);
 assert.equal(calls.filter(x=>x==='syncPut').length,2,
  'one initial save and exactly one edit after login');
 console.log('操作端末再ログイン：端末で編集した乗務を保持して本人クラウドへ1件だけ同期');
})().catch(e=>{console.error(e);process.exitCode=1;});
