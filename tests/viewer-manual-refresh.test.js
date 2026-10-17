'use strict';
const assert=require('node:assert/strict');
require('../bidirectional-sync.js');
require('../cloud-sync-ui.js');
require('../cross-device-state.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const id='shift-1792217340000';
const duty={id,date:'2026-10-17',startedAt:'21:00',startingOdo:'18.2',
 startedIso:'2026-10-17T12:00:00Z',endedAt:'',endedIso:'',settings:{},records:[]};
let revision=1,serverDuty=clone(duty),viewer=true,requestCount=0,writeCount=0,shown=null,localWrites=0;
const saved={version:1,activeId:null,prefs:{syncMode:'on'},shifts:[{id:'shift-1',records:[]}]};
const snapshot=JSON.stringify(saved);
const timers=new Map();let timerId=0;
global.setTimeout=fn=>{const id=++timerId;timers.set(id,fn);return id;};
global.clearTimeout=id=>timers.delete(id);
global.document={visibilityState:'visible'};
global.localStorage={getItem:()=>null,setItem:()=>{localWrites++;}};
const root={querySelector:()=>null};
const messages=[];
const controller=globalThis.TAXIAPP_SYNC_UI({
 getModel:()=>saved,getPacket:s=>({kind:'TAXIAPP_SHIFT_V1',shift:s}),
 endpoint:()=>'/test-google',configured:()=>true,
 prefs:()=>({syncMode:'on'}),
 canSync:()=>false,canView:()=>viewer,
 request:async(action,fields)=>{
  requestCount++;
  if(action==='syncList')return {shifts:[{id,revision}]};
  if(action==='syncGet')return {id,revision,shift:clone(serverDuty)};
  if(action==='syncPut'){writeCount++;throw Error('viewer must not write');}
  throw Error('unexpected request: '+action);
 },
 replace:async()=>{localWrites++;throw Error('viewer must not import to IndexedDB');},
 onViewerSnapshot:async shifts=>{shown=globalThis.TAXIAPP_SHIFT_MIRROR.viewerProjection(saved,shifts).model;},
 onViewerStatus:message=>messages.push(message),
 root,setStatus:()=>{},toast:()=>{},escape:v=>v,download:()=>{},dateStamp:()=>'2026-10-17'
});
(async()=>{
 assert.equal(timers.size,0,'no background poll at startup');
 controller.viewSchedule(); // exactly one login-time refresh
 assert.equal(timers.size,1);
 const task=[...timers.values()][0];timers.clear();await task();
 assert.equal(requestCount,2,'one list and one get on initial viewer login');
 assert.equal(shown.activeId,id);
 assert.equal(shown.shifts[0].startingOdo,'18.2');
 assert.equal(timers.size,0,'viewer must not schedule another poll');
 assert.equal(JSON.stringify(saved),snapshot);
 assert.equal(localWrites,0);
 serverDuty.endedAt='22:10';serverDuty.endedIso='2026-10-17T13:10:00Z';
 serverDuty.endingOdo='44.9';revision++;
 assert.equal(shown.activeId,id,'viewer holds prior view until manual reload');
 assert.equal(requestCount,2,'there is no background polling');
 assert.equal(await controller.viewNow(true),true,'manual reload succeeds');
 assert.equal(requestCount,4);
 assert.equal(shown.activeId,null,'viewer sees the completed return');
 assert.equal(shown.shifts[0].endingOdo,'44.9');
 assert.equal(timers.size,0);
 viewer=false;
 assert.equal(await controller.viewNow(true),false,'formerly-viewing device cannot fetch after handover');
 assert.equal(requestCount,4);
 assert.equal(JSON.stringify(saved),snapshot,'viewer must never touch local duties');
 assert.equal(writeCount,0);
 console.log('Viewer refresh simulation passed: initial single fetch, no polling, manual latest data, no local/server writes, role protection.');
})().catch(e=>{console.error(e);process.exitCode=1;});
