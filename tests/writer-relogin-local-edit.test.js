'use strict';
// 実際の双方向同期エンジンを使う。合成データのみ。
const assert=require('node:assert/strict');
const clone=value=>JSON.parse(JSON.stringify(value));
const id='shift-1792690000000-edited';
const baseShift={id,date:'2026-10-22',startedAt:'08:00',records:[],settings:{}};
function createScenario(){
 const server=new Map(),backing=new Map(),shifts=[clone(baseShift)];
 const storage={
  getItem:key=>backing.get(key)||null,
  setItem:(key,value)=>backing.set(key,String(value))
 };
 const root={};
 const vm=require('node:vm'),fs=require('node:fs');
 vm.runInNewContext(fs.readFileSync('bidirectional-sync.js','utf8'),
  {window:root,globalThis:root,Date,Math,JSON,console});
 const model={shifts};
 const actions=[];
 async function request(action,data={}){
  actions.push(action);
  if(action==='syncList')
   return {shifts:[...server].map(([id,row])=>({id,revision:row.revision}))};
  if(action==='syncGet'){
   const row=server.get(data.shiftId);
   if(!row)throw Error('missing duty');
   return {id:data.shiftId,revision:row.revision,shift:clone(row.shift)};
  }
  if(action==='syncPut'){
   const shift=JSON.parse(data.payload).shift;
   const row=server.get(shift.id),rev=row?.revision||0;
   if(rev!==Number(data.baseRevision))throw Error('SYNC_CONFLICT:'+rev);
   server.set(shift.id,{revision:rev+1,shift:clone(shift)});
   return {id:shift.id,revision:rev+1};
  }
  throw Error('unexpected action '+action);
 }
 const engine=root.TAXIAPP_BIDIRECTIONAL_SYNC.create({
  getModel:()=>model,
  getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:clone(shift)}),
  getEndpoint:()=>'/real-sync-owner',getScopeKey:()=> 'owner-uid',
  localStorage:storage,request,
  replaceRemoteShift:async(id,shift)=>{
   const n=model.shifts.findIndex(row=>row.id===id);
   if(n>=0)model.shifts[n]=clone(shift);else model.shifts.push(clone(shift));
  }
 });
 return {engine,server,model,actions};
}
(async()=>{
 const localOnly=createScenario();
 assert.equal(await localOnly.engine.run(),true);
 assert.equal(localOnly.server.get(id).revision,1);
 localOnly.model.shifts[0].startedAt='09:00';
 const fromServer=await localOnly.engine.readOnly();
 assert.equal(fromServer[0].startedAt,'08:00');
 const plan=localOnly.engine.planSafeWriterSnapshot(fromServer);
 assert.equal(plan.shifts[0].startedAt,'09:00','local edit must remain on the device');
 assert.deepEqual([...plan.pendingIds],[id]);
 assert.equal(localOnly.engine.adoptViewerBaseline(),true);
 localOnly.model.shifts=clone(plan.shifts);
 assert.equal(await localOnly.engine.run([id]),true);
 assert.equal(localOnly.server.get(id).revision,2);
 assert.equal(localOnly.server.get(id).shift.startedAt,'09:00','local edit uploads after login');
 const remoteOnly=createScenario();
 assert.equal(await remoteOnly.engine.run(),true);
 remoteOnly.server.set(id,{revision:2,shift:{...clone(baseShift),startedAt:'10:00'}});
 const newer=await remoteOnly.engine.readOnly();
 const p2=remoteOnly.engine.planSafeWriterSnapshot(newer);
 assert.equal(p2.shifts[0].startedAt,'10:00');
 assert.equal(p2.pendingIds.length,0,'remote-only edit must not be reuploaded');
 const both=createScenario();
 assert.equal(await both.engine.run(),true);
 both.model.shifts[0].startedAt='09:00';
 both.server.set(id,{revision:2,shift:{...clone(baseShift),startedAt:'10:00'}});
 const incoming=await both.engine.readOnly();
 assert.throws(()=>both.engine.planSafeWriterSnapshot(incoming),/競合/,
  'both edits require explicit resolution instead of overwriting either');
 assert.equal(both.model.shifts[0].startedAt,'09:00');
 assert.equal(both.server.get(id).shift.startedAt,'10:00');
 const stale=createScenario();
 assert.equal(await stale.engine.run(),true);
 stale.model.shifts[0].startedAt='09:00';
 stale.server.set(id,{revision:2,shift:clone(baseShift)});
 const staleIncoming=await stale.engine.readOnly();
 assert.throws(()=>stale.engine.planSafeWriterSnapshot(staleIncoming),/競合/,
  'a newer revision is not safe even if the server content was restored');
 console.log('再ログイン同期：端末のみ編集→保持して送信、クラウドのみ変更→受信、両方編集→停止');
})().catch(error=>{console.error(error);process.exitCode=1;});
