'use strict';
// クラウド一覧取得と個別取得の間に更新された原本を端末へ取り込まない。
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('bidirectional-sync.js','utf8');
const duty=id=>({id,records:[],settings:{},startedAt:'08:00'});
const a=duty('shift-1792690000000-a'),b=duty('shift-1792690000001-b');
async function scenario(cloudOnly){
 const root={};vm.runInNewContext(code,{window:root,globalThis:root,Date,Math,JSON});
 const model={shifts:cloudOnly?[]:[structuredClone(a)]};
 const saved=new Map();let replacements=0,reads=0;
 const engine=root.TAXIAPP_BIDIRECTIONAL_SYNC.create({
  getModel:()=>model,getPacket:shift=>({shift}),
  getEndpoint:()=>'/synthetic-owner',getScopeKey:()=> 'synthetic-uid',
  localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,val)=>saved.set(key,val)},
  request:async(action,data)=>{
   if(action==='syncList')return {shifts:[{id:a.id,revision:1},{id:b.id,revision:1}]};
   if(action==='syncGet'){
    reads++;
    const original=data.shiftId===a.id?a:b;
    return {id:data.shiftId,revision:2,shift:structuredClone(original)};
   }
   throw Error('unexpected request '+action);
  },
  replaceRemoteShift:async()=>{replacements++;}
 });
 if(!cloudOnly){
  // クラウドのみの更新を再取得する経路へ進ませるため先に保存済の基準を作る。
  const initial={};
  const fingerprint=root.TAXIAPP_BIDIRECTIONAL_SYNC.digest(JSON.stringify(a));
  // パケット整形はこのテストでは同一JSONなのでこのハッシュを使用。
  initial[a.id]={revision:1,hash:fingerprint};
  // 保存管理キーはエンジン内部で作成されるため、初回送信からの再現は別シナリオで扱う。
  return;
 }
 assert.equal(await engine.run(),false);
 assert.equal(replacements,0,'一覧より新しい乗務を受信しない');
 assert.equal(model.shifts.length,0,'端末の日報を変更しない');
 assert.equal(reads,1);
 assert.match(engine.status().lastError,/更新番号/);
}
scenario(true).then(()=>console.log('一覧と個別取得の版違いを安全停止')).catch(e=>{console.error(e);process.exitCode=1;});
