'use strict';
// Synthetic login replay through the real adapter and real per-duty sync.
// Local-only duty must survive the first cloud pull and be uploaded once
// writer access is confirmed. Conflicting content must never overwrite.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const root={
 localStorage:(()=>{
  const map=new Map();
  return {getItem:key=>map.get(key)??null,
   setItem:(key,value)=>map.set(key,String(value))};
 })()
};
vm.runInNewContext(fs.readFileSync('bidirectional-sync.js','utf8'),
 {window:root,globalThis:root,Date,Math,JSON,console});
vm.runInNewContext(fs.readFileSync('cloud-sync-ui.js','utf8'),
 {window:root,globalThis:root,Date,Math,JSON,console,setTimeout,clearTimeout});
const clone=o=>JSON.parse(JSON.stringify(o));
const local={id:'shift-1792640000000-unsynced',date:'2026-10-21',records:[],settings:{},startedAt:'09:00'};
const cloud={id:'shift-1792640000001-cloud',date:'2026-10-21',records:[],settings:{},startedAt:'10:00'};
const model={shifts:[clone(local)]},store=new Map([[cloud.id,{revision:1,shift:clone(cloud)}]]);
const actions=[];let writerGate=true;
const request=async(action,fields={})=>{
 actions.push(action+':'+String(fields.shiftId||''));
 if(action==='syncList')return {shifts:[...store.entries()].map(([id,row])=>({id,revision:row.revision}))};
 if(action==='syncGet'){
  const row=store.get(fields.shiftId);
  if(!row)throw Error('missing');
  return {id:fields.shiftId,revision:row.revision,shift:clone(row.shift)};
 }
 if(action==='syncPut'){
  const packet=JSON.parse(fields.payload),id=packet.shift.id;
  const prev=store.get(id);
  if((prev?.revision||0)!==Number(fields.baseRevision))throw Error('SYNC_CONFLICT');
  store.set(id,{revision:(prev?.revision||0)+1,shift:clone(packet.shift)});
  return {id,revision:(prev?.revision||0)+1};
 }
 throw Error('unexpected '+action);
};
const d=root.TAXIAPP_SYNC_UI({
 getModel:()=>model,getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:clone(shift)}),
 endpoint:()=>'/synthetic-uid-merge',scopeKey:()=> 'synthetic-uid-merge',
 request,configured:()=>true,prefs:()=>({syncMode:'on'}),
 canSync:()=>!writerGate,canView:()=>false,
 writerBootstrapAllowed:()=>writerGate,
 onWriterSnapshot:async incoming=>{
  // This callback stands in for the app's durable read-back of IndexedDB.
  model.shifts=clone(incoming);
  return true;
 },
 onWriterBootstrapReady:()=>{writerGate=false;},
 onWriterSynced:async()=>{},
 root:{querySelector:()=>null},setStatus:()=>{},toast:()=>{},escape:x=>String(x),
 isSettings:()=>true,dateStamp:()=> '20261022'
});
(async()=>{
 assert.equal(await d.bootstrapWriter(),true,'local-only duty must not lock the writer out');
 assert.deepEqual(new Set(model.shifts.map(x=>x.id)),new Set([local.id,cloud.id]),
  'neither cloud-only nor local-only duties may be lost in bootstrap');
 assert.equal(store.has(local.id),false,'the local-only duty is not uploaded before editor unlock');
 await new Promise(resolve=>setTimeout(resolve,900));
 assert.equal(store.get(local.id)?.shift?.startedAt,local.startedAt,
  'queued local-only duty reaches owner cloud after unlock');
 assert.equal(store.get(cloud.id)?.shift?.startedAt,cloud.startedAt);
 assert.equal(actions.filter(x=>x.startsWith('syncPut:')).length,1);
 console.log('初回受信：未同期日報を端末に保持してクラウド原本を追加し、操作権確認後に1件送信');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 // A restored local duty whose old server copy is trashed or absent remains
 // editable on login, but must never be resurrected by an automatic upload.
 const local={id:'shift-1792640001000-held',date:'2026-10-21',
  records:[],settings:{},startedAt:'06:00'};
 const scope='isolated-held-local-original';
 const store=new Map([[local.id,{revision:1,shift:JSON.parse(JSON.stringify(local))}]]);
 const saved=new Map();
 const root={localStorage:{
  getItem:k=>saved.get(k)??null,
  setItem:(k,v)=>saved.set(k,String(v))
 }};
 const vm2=require('node:vm');
 const fs2=require('node:fs');
 vm2.runInNewContext(fs2.readFileSync('bidirectional-sync.js','utf8'),
  {window:root,globalThis:root,JSON,Date,Math,console});
 const model={shifts:[JSON.parse(JSON.stringify(local))]};
 const engine=root.TAXIAPP_BIDIRECTIONAL_SYNC.create({
  getModel:()=>model,
  getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:JSON.parse(JSON.stringify(shift))}),
  getEndpoint:()=>scope,
  getScopeKey:()=> 'owner',
  localStorage:root.localStorage,
  request:async(action,params={})=>{
   if(action==='syncList')return {shifts:[...store].map(([id,x])=>({id,revision:x.revision}))};
   if(action==='syncGet'){
    const x=store.get(params.shiftId);
    return {id:params.shiftId,revision:x.revision,shift:x.shift};
   }
   if(action==='syncPut')throw Error('unexpected auto upload');
   throw Error('unexpected '+action);
  },
  replaceRemoteShift:async()=>{}
 });
 assert.equal(await engine.run(),true,'establish original revision baseline');
 store.clear();
 const plan=engine.planSafeWriterSnapshot([]);
 assert.deepEqual([...plan.heldIds],[local.id]);
 assert.equal(plan.pendingIds.length,0);
 assert.equal(plan.shifts.length,1);
 console.log('復元済みの端末日報はサーバー不在でも保持し、自動再アップロードを防ぐ');
})().catch(error=>{console.error(error);process.exitCode=1;});
