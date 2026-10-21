'use strict';
// Synthetic end-to-end UI test: a locally deleted duty is remotely trashed
// after a new writer session, even though the in-memory edit queue is empty.
const assert=require('node:assert/strict');
require('../bidirectional-sync.js');
require('../cloud-sync-ui.js');
const id='shift-1792600000000-reconnect';
const original={id,date:'2026-10-21',records:[],settings:{},startedAt:'07:00'};
const copy=value=>JSON.parse(JSON.stringify(value));
const storage=new Map();
globalThis.localStorage={
 getItem:key=>storage.get(key)??null,
 setItem:(key,value)=>storage.set(key,String(value))
};
let gate=false;
let revision=1,deleted=false;
const actions=[];
const model={shifts:[copy(original)]};
async function request(action,fields={}){
 actions.push(action);
 if(action==='syncList')return {shifts:[{id,revision,deleted}]};
 if(action==='syncGet'){
  if(deleted)throw Error('gone');
  return {id,revision,shift:copy(original)};
 }
 if(action==='syncTrash'){
  assert.equal(fields.shiftId,id);
  assert.equal(Number(fields.baseRevision),revision);
  revision++;deleted=true;
  return {id,revision,deleted:true};
 }
 throw Error('unexpected action: '+action);
}
function adapter(){
 return globalThis.TAXIAPP_SYNC_UI({
  getModel:()=>model,
  getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift:copy(shift)}),
  replace:async(_id,shift)=>{model.shifts.push(copy(shift));},
  request,endpoint:()=>'/synthetic-owner',
  scopeKey:()=> 'uid-synthetic',
  prefs:()=>({syncMode:'on'}),configured:()=>true,
  canSync:()=>!gate,canView:()=>false,
  writerBootstrapAllowed:()=>gate,
  onWriterSnapshot:async shifts=>{
   assert.equal(shifts.length,0,'a deleted duty stays hidden on login');
   return true;
  },
  onWriterBootstrapReady:()=>{gate=false;},
  root:{querySelector:()=>null},
  isSettings:()=>true,
  setStatus:()=>{},toast:()=>{},escape:x=>String(x),
  download:()=>{},dateStamp:()=> '20261021'
 });
}
(async()=>{
 const before=adapter();
 assert.equal(before.markLocalRemoval(id,original),true);
 model.shifts=[];
 // The process restarts: UI queue is empty, marker is durable in localStorage.
 gate=true;
 const restarted=adapter();
 assert.equal(await restarted.bootstrapWriter(),true);
 await new Promise(resolve=>setTimeout(resolve,750));
 assert.equal(deleted,true,'pending delete must reach cloud on reconnect');
 assert.equal(revision,2);
 assert.equal(actions.filter(x=>x==='syncTrash').length,1);
 assert.equal(actions.filter(x=>x==='syncPut').length,0);
 assert.deepEqual(model.shifts,[],'must not reimport the deleted duty');
 console.log('再ログイン後の削除同期：端末キューが空でも原本を保持してゴミ箱へ移動');
})().catch(error=>{console.error(error);process.exitCode=1;});
