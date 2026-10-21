'use strict';
/* 合成データのみ：Google側7乗務・端末2乗務の削除復活と接続先分離 */
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
require('../bidirectional-sync.js');
const factory=globalThis.TAXIAPP_BIDIRECTIONAL_SYNC;
const ids=Array.from({length:7},(_,i)=>'shift-'+(100+i)+'-demo');
const server=new Map(ids.map((id,i)=>[id,{revision:1,shift:{id,date:'2026-10-21',
 endedAt:'19:00',records:[],settings:{},startingOdo:String(i)}}]));
const storageMap=new Map(),storage={
 getItem:key=>storageMap.has(key)?storageMap.get(key):null,
 setItem:(key,value)=>storageMap.set(key,value)
};
const clone=v=>JSON.parse(JSON.stringify(v));
const packet=s=>({kind:'TAXIAPP_SHIFT_V1',shift:clone(s)});
const calls=[];
async function request(action,fields={}){
 calls.push({action,id:fields.shiftId||'',filter:fields.shiftIds||null});
 if(action==='syncList')return {shifts:[...server].filter(([id])=>!fields.shiftIds||fields.shiftIds.includes(id))
   .map(([id,row])=>({id,revision:row.revision}))};
 if(action==='syncGet'){const row=server.get(fields.shiftId);if(!row)throw Error('missing');
  return {id:fields.shiftId,revision:row.revision,shift:clone(row.shift)};}
 if(action==='syncPut')throw Error('Unexpected write during local-delete simulation');
 throw Error('unexpected '+action);
}
const state={shifts:ids.slice(0,2).map(id=>clone(server.get(id).shift))};
let endpoint='https://script.google.com/macros/s/owner/exec';
const mkEngine=()=>factory.create({getModel:()=>state,getPacket:packet,request,
 getEndpoint:()=>endpoint,localStorage:storage,
 replaceRemoteShift:async(id,shift)=>{
  assert.ok(!ids.slice(2).includes(id),'deleted duty must NOT be restored');
  state.shifts.push(clone(shift));
 }});
(async()=>{
 const engine=mkEngine();
 for(const id of ids.slice(2))assert.equal(engine.markLocalRemoval(id),true);
 assert.equal(engine.markLocalRemoval(ids[2]),false,'idempotent deletion intent');
 assert.equal(state.shifts.length,2);
 assert.equal(await engine.run(),true,'2 remaining shifts should sync without resurrecting the 5 removed ones');
 assert.equal(state.shifts.length,2);
 assert.ok(calls.filter(x=>x.action==='syncGet').every(x=>!ids.slice(2).includes(x.id)),
  'hidden duties must never be fetched on automatic sync');
 assert.equal(server.size,7,'Google originals intentionally protected');
 assert.equal((await engine.readOnly()).length,7,'cloud read remains lossless');
 assert.deepEqual(engine.excludeLocalRemovals(await engine.readOnly()).map(x=>x.id),ids.slice(0,2),
  'login should restore only nondeleted shifts on this device');
 assert.equal(engine.adoptViewerBaseline(),true,'new writer login baseline should remain valid');
 assert.equal(await engine.run(),true);
 // New browser session / same endpoint: the explicit deletion still applies.
 const restarted=mkEngine();
 assert.deepEqual(restarted.excludeLocalRemovals(await restarted.readOnly()).map(x=>x.id),ids.slice(0,2));
 // Different user / Sheets endpoint MUST NOT reuse hidden duty IDs.
 endpoint='firestore-duties://another-user';
 const isolated=mkEngine();
 assert.equal(isolated.excludeLocalRemovals(await isolated.readOnly()).length,7,
  'another account/endpoint must see their own 7 duties');
 endpoint='https://script.google.com/macros/s/owner/exec';
 restarted.undoLocalRemoval(ids[2]);
 assert.equal(restarted.excludeLocalRemovals(await restarted.readOnly()).length,3,
  'failed local deletion can restore the old sync visibility');
 // Corrupt deletion list fails closed, never causes an unsafe cloud restore.
 const marker=[...storageMap.keys()].find(k=>k.startsWith('taxiapp-sync-v2-local-removals-'));
 storageMap.set(marker,'{"broken":true}');
 assert.throws(()=>restarted.excludeLocalRemovals([]),/管理情報/);
 assert.equal(await restarted.run(),false);
 // The existing print selection remains independently scoped.
 const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'..','cloud-sync-ui.js'),'utf8');
 assert.match(html,/newlyMarked=syncUI\.markLocalRemoval\(shiftId\)/);
 assert.match(html,/syncUI\.undoLocalRemoval\(shiftId\)/);
 assert.match(html,/Google側の原本と印刷一覧、ほかの端末のデータは残ります/);
 assert.match(ui,/engine\.excludeLocalRemovals\(received\)/);
 assert.match(ui,/同期完了：選択した1乗務を照合/);
 assert.match(html,/tab==='print'&&shift\?\.id\?\[shift\.id\]:null/);
 console.log('合成7件→2件の再同期・ログイン・再起動で削除復活なし。Google原本7件維持、UID接続先分離：成功');
})().catch(error=>{console.error(error);process.exitCode=1;});
