'use strict';
// 同じIDを持つ端末・クラウド日報の初回照合時、一覧と個別取得の更新番号が異なるケース。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root={};vm.runInNewContext(fs.readFileSync('bidirectional-sync.js','utf8'),{window:root,globalThis:root,Date,Math,JSON});
const id='shift-1792690000000-a',shift={id,startedAt:'08:00',records:[],settings:{}};
const model={shifts:[structuredClone(shift)]};let changes=0;const storage=new Map();
const engine=root.TAXIAPP_BIDIRECTIONAL_SYNC.create({
 getModel:()=>model,getPacket:x=>({shift:x}),
 getEndpoint:()=>'/test-owner',getScopeKey:()=> 'test-owner-uid',
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))},
 request:async(action,data)=>{
  if(action==='syncList')return {shifts:[{id,revision:1}]};
  if(action==='syncGet')return {id,revision:2,shift:structuredClone(shift)};
  throw Error('不正な同期書込: '+action);
 },
 replaceRemoteShift:async()=>{changes++;}
});
(async()=>{
 assert.equal(await engine.run(),false);
 assert.match(engine.status().lastError,/更新番号/);
 assert.equal(model.shifts[0].startedAt,'08:00');
 assert.equal(changes,0);
 console.log('初回の同一ID照合中にクラウド版が変われば安全停止');
})().catch(e=>{console.error(e);process.exitCode=1;});
