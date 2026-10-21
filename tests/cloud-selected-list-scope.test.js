'use strict';
// 印刷画面から1乗務だけを送る際、サーバーが別乗務を返しても受信・送信しない。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root={};vm.runInNewContext(fs.readFileSync('bidirectional-sync.js','utf8'),{window:root,globalThis:root,Date,Math,JSON});
const selected='shift-1792690000000-a',other='shift-1792690000001-b';
const storage=new Map(),model={shifts:[]},actions=[];
const engine=root.TAXIAPP_BIDIRECTIONAL_SYNC.create({
 getModel:()=>model,getPacket:x=>({shift:x}),getEndpoint:()=>'/test',
 getScopeKey:()=> 'test-uid',
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))},
 request:async(action,params)=>{
  actions.push({action,params});
  if(action==='syncList')return {shifts:[{id:selected,revision:1},{id:other,revision:1}]};
  throw Error('他の乗務に対する処理は禁止');
 },
 replaceRemoteShift:async()=>{throw Error('受信禁止');}
});
(async()=>{
 assert.equal(await engine.run([selected]),false);
 assert.match(engine.status().lastError,/指定した乗務以外/);
 assert.equal(actions.length,1);
 assert.equal(actions[0].action,'syncList');
 assert.deepEqual([...actions[0].params.shiftIds],[selected]);
 assert.equal(model.shifts.length,0);
 console.log('指定外の乗務が同期応答へ混入した場合は無変更で停止');
})().catch(e=>{console.error(e);process.exitCode=1;});
