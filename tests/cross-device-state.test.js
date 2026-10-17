'use strict';
const assert=require('node:assert/strict');
require('../bidirectional-sync.js');
require('../cross-device-state.js');
const factory=globalThis.TAXIAPP_BIDIRECTIONAL_SYNC;
const mirror=globalThis.TAXIAPP_SHIFT_MIRROR;
const clone=v=>JSON.parse(JSON.stringify(v));
function server(){
 const cloud=new Map(),commands=[];
 return {cloud,commands,async request(action,params){
  commands.push(action);
  if(action==='syncList')return {shifts:[...cloud].map(([id,x])=>({id,revision:x.rev}))};
  if(action==='syncGet'){
   const value=cloud.get(params.shiftId);
   if(!value)throw Error('missing duty');
   return {id:params.shiftId,revision:value.rev,shift:clone(value.shift)};
  }
  if(action==='syncPut'){
   const shift=JSON.parse(params.payload).shift;
   const previous=cloud.get(shift.id),rev=previous?.rev||0;
   if(rev!==Number(params.baseRevision))throw Error('SYNC_CONFLICT:'+rev);
   cloud.set(shift.id,{rev:rev+1,shift:clone(shift)});
   return {id:shift.id,revision:rev+1};
  }
  throw Error('unexpected method');
 }};
}
function client(name,backend,model){
 const storage=new Map();
 const sync=factory.create({
  getModel:()=>model,getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:clone(shift)}),
  getEndpoint:()=>'/the-same-google-url',request:backend.request,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  replaceRemoteShift:async(id,shift)=>{
   const index=model.shifts.findIndex(x=>x.id===id);
   if(index>=0)model.shifts[index]=clone(shift);else model.shifts.push(clone(shift));
  }
 });
 return {model,sync,storage};
}
function duty(id,odo){
 return {id,date:'2026-10-17',startedAt:'21:00',startedIso:'2026-10-17T12:00:00Z',
  startingOdo:odo,endedAt:'',endedIso:'',settings:{},records:[]};
}
(async()=>{
 const backend=server(),id='shift-1792217340000';
 const phone=client('phone',backend,{version:1,activeId:id,prefs:{driver:'テスト'},shifts:[duty(id,'123.4')]});
 const pc=client('pc',backend,{version:1,activeId:null,prefs:{driver:'ローカル設定'},shifts:[duty('shift-1','999')]});
 // A real departure is a record with time and ODO, not just a status flag.
 assert.equal(await phone.sync.run(),true);
 assert.equal(backend.cloud.get(id).shift.startingOdo,'123.4');
 assert.equal(backend.cloud.get(id).shift.startedAt,'21:00');
 const pcBefore=JSON.stringify(pc.model);
 const received=await pc.sync.readOnly();
 assert.equal(received.length,1);
 assert.equal(JSON.stringify(pc.model),pcBefore,'viewer must never persist changes');
 let view=mirror.viewerProjection(pc.model,received);
 assert.equal(view.model.activeId,id,'viewer must see phone departure');
 assert.equal(view.model.shifts[0].startingOdo,'123.4');
 assert.equal(view.model.shifts[0].startedAt,'21:00');
 assert.equal(view.openCount,1);
 assert.equal(backend.commands.filter(x=>x==='syncPut').length,1,'viewer never uploads stale local data');
 // Departure ODO and trip updates synchronize.
 phone.model.shifts[0].startingOdo='125.3';
 phone.model.shifts[0].records.push({kind:'ride',raw:{},status:'complete'});
 assert.equal(await phone.sync.run(),true);
 view=mirror.viewerProjection(pc.model,await pc.sync.readOnly());
 assert.equal(view.model.shifts[0].startingOdo,'125.3');
 assert.equal(view.model.shifts[0].records.length,1);
 // On return-to-base, viewer must stop showing the phone as on duty.
 phone.model.shifts[0].endedAt='22:10';
 phone.model.shifts[0].endedIso='2026-10-17T13:10:00Z';
 phone.model.shifts[0].endingOdo='149.8';
 phone.model.activeId=null;
 assert.equal(await phone.sync.run(),true);
 view=mirror.viewerProjection(pc.model,await pc.sync.readOnly());
 assert.equal(view.model.activeId,null,'return must be shown on viewer');
 assert.equal(view.model.shifts[0].endingOdo,'149.8');
 assert.equal(view.model.shifts[0].endedAt,'22:10');
 assert.equal(JSON.stringify(pc.model),pcBefore,'read-only must preserve PC private local history');
 // A writer that safely receives a duty can select its active shift.
 phone.model.activeId=id; // stale local selection after receiving remote return
 assert.equal(mirror.selectActive(phone.model.shifts,phone.model.activeId),null);
 assert.equal(mirror.selectActive([duty('shift-2','0')],null),'shift-2');
 assert.equal(mirror.selectActive([duty('shift-2','0'),duty('shift-3','1')],null),null,
  'ambiguous unclosed duties must not be guessed');
 assert.equal(mirror.selectActive([{...duty(id,'0'),endedAt:'22:10'}],id,[id]),id,
  'a locally conflicted active duty must not be automatically cleared');
 // A transport failure must not mutate either the viewer local model or cloud.
 const offline=client('offline',{request:()=>Promise.reject(Error('offline'))},pc.model);
 const cloudBefore=JSON.stringify([...backend.cloud]);
 assert.equal(await offline.sync.readOnly(),null);
 assert.equal(JSON.stringify([...backend.cloud]),cloudBefore);
 assert.equal(JSON.stringify(pc.model),pcBefore);
 // A stale listing racing a newer syncGet must not commit a partial snapshot.
 const broken=client('racy',{request:async action=>{
  if(action==='syncList')return {shifts:[{id,revision:4}]};
  if(action==='syncGet')return {id,revision:5,shift:duty(id,'999')};
 }},pc.model);
 assert.equal(await broken.sync.readOnly(),null);
 assert.equal(broken.sync.viewerStatus().lastSyncAt,0);
 console.log('Cross-device simulation passed: depart/time/ODO, viewer cloud retrieval, return, writer active selection, local safety, offline and racing updates.');
})().catch(e=>{console.error(e);process.exitCode=1;});
