'use strict';
// 乗務一覧取得後に原本が更新されても旧版や競合版を取り込まない。
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('bidirectional-sync.js','utf8');
const id='shift-1792690000000-a';
const duty={id,startedAt:'08:00',records:[],settings:{}};
const clone=x=>JSON.parse(JSON.stringify(x));
function setup(initialLocal,initialServer){
 const root={};vm.runInNewContext(code,{window:root,globalThis:root,Date,Math,JSON});
 const model={shifts:initialLocal?[clone(duty)]:[]};
 const storage=new Map(),server=new Map();
 if(initialServer)server.set(id,{revision:1,shift:clone(duty)});
 let race=false,applied=0;
 const engine=root.TAXIAPP_BIDIRECTIONAL_SYNC.create({
  getModel:()=>model,getPacket:shift=>({shift:clone(shift)}),
  getEndpoint:()=>'/test-only',getScopeKey:()=> 'test-uid',
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,val)=>storage.set(key,String(val))},
  request:async(action,data={})=>{
   if(action==='syncList')return {shifts:[...server].map(([key,row])=>({id:key,revision:row.revision}))};
   if(action==='syncGet'){
    const row=server.get(data.shiftId);
    if(race)return {id:data.shiftId,revision:row.revision+1,shift:{...clone(row.shift),startedAt:'10:00'}};
    return {id:data.shiftId,revision:row.revision,shift:clone(row.shift)};
   }
   if(action==='syncPut'){
    const shift=JSON.parse(data.payload).shift,row=server.get(shift.id),prev=row?.revision||0;
    assert.equal(prev,data.baseRevision);
    server.set(shift.id,{revision:prev+1,shift:clone(shift)});
    return {id:shift.id,revision:prev+1};
   }
   throw Error('想定外の通信: '+action);
  },
  replaceRemoteShift:async(key,shift)=>{
   applied++;
   const index=model.shifts.findIndex(x=>x.id===key);
   if(index<0)model.shifts.push(clone(shift));else model.shifts[index]=clone(shift);
  }
 });
 return {model,server,engine,setRace:value=>{race=value;},getApplied:()=>applied};
}
(async()=>{
 const newCloud=setup(false,true);
 newCloud.setRace(true);
 assert.equal(await newCloud.engine.run(),false);
 assert.equal(newCloud.model.shifts.length,0,'新しいクラウド専用乗務を誤受信しない');
 assert.equal(newCloud.getApplied(),0);
 assert.match(newCloud.engine.status().lastError,/更新番号/);

 const existing=setup(true,false);
 assert.equal(await existing.engine.run(),true,'最初の同期基準を確立');
 existing.server.get(id).revision=2;
 existing.server.get(id).shift.startedAt='09:00';
 existing.setRace(true);
 assert.equal(await existing.engine.run(),false);
 assert.equal(existing.model.shifts[0].startedAt,'08:00','更新中の乗務で端末を上書きしない');
 assert.equal(existing.getApplied(),0);
 assert.match(existing.engine.status().lastError,/更新番号/);
 console.log('クラウド初回受信と既存乗務の改版受信で更新番号差異を拒否');
})().catch(e=>{console.error(e);process.exitCode=1;});
