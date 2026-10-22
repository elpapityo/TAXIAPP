'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root={};
vm.runInNewContext(fs.readFileSync('bidirectional-sync.js','utf8'),{window:root,globalThis:root,Date,Math,JSON});
const id='shift-1792690000000-a';
async function runCase(rows){
 let actions=[],model={shifts:[]};const storage=new Map();
 const engine=root.TAXIAPP_BIDIRECTIONAL_SYNC.create({
  getModel:()=>model,getPacket:shift=>({shift}),
  getEndpoint:()=>'/synthetic',getScopeKey:()=> 'synthetic-user',
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,val)=>storage.set(key,val)},
  request:async(action)=>{actions.push(action);if(action==='syncList')return {shifts:rows};throw Error('クラウド一覧の検査より先に処理を進めた');},
  replaceRemoteShift:async()=>{throw Error('端末変更は禁止');}
 });
 assert.equal(await engine.run(),false);
 assert.deepEqual(actions,['syncList']);
 assert.equal(model.shifts.length,0);
 assert.match(engine.status().lastError,/不正または重複/);
}
(async()=>{
 await runCase([{id,revision:1},{id,revision:2}]);
 await runCase([{id,revision:0}]);
 await runCase([{id:'invalid',revision:1}]);
 await runCase([{id,revision:1.5}]);
 console.log('重複ID・不正ID・不正更新番号は端末変更前に停止');
})().catch(e=>{console.error(e);process.exitCode=1;});
