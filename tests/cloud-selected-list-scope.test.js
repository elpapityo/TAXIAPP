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
  if(action==='syncGet'&&params.shiftId===selected)return {id:selected,revision:1,shift:{id:selected,records:[],settings:{}}};
  throw Error('他の乗務に対する処理は禁止');
 },
 replaceRemoteShift:async(id)=>{assert.equal(id,selected);}
});
(async()=>{
 assert.equal(await engine.run([selected]),true);
 assert.equal(actions.length,2);
 assert.equal(actions[0].action,'syncList');
 assert.deepEqual([...actions[0].params.shiftIds],[selected]);
 assert.deepEqual(actions.map(x=>x.action),['syncList','syncGet']);
 assert.equal(actions[1].params.shiftId,selected);
 assert.equal(model.shifts.length,0);
 console.log('指定外の乗務が一覧に含まれていても選択IDだけを読み込み');
})().catch(e=>{console.error(e);process.exitCode=1;});
