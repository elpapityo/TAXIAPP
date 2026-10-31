const test = require('node:test');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const syncApi = require('../gps-history-sync.js');

function fixture(){
 const uid='uid-1', shiftId='shift-100';
 const start=Date.parse('2026-10-31T01:00:00Z');
 const end=Date.parse('2026-10-31T05:00:00Z');
 const row={uid,shiftId,startedAtMs:start,endedAtMs:end,serverStatus:'未送信',points:[
  {capturedAtMs:start+30000,lat:34.7,lon:135.4,accuracy:8,speed:0,heading:0,segmentNo:1,suspectedJump:false}
 ]};
 const local=new Map([[shiftId,row]]),cloud=new Map();
 const store={
  async fetchOne(who,id){return who===uid?local.get(id):null;},
  async list(who){return who===uid?[...local.values()]:[];},
  async setSyncState(who,id,status,more={}){
   const saved=local.get(id);if(!saved||who!==uid)return null;
   const next={...saved,serverStatus:status,...more};local.set(id,next);return next;
  }
 };
 let writes=0, offline=false;
 const f={
  doc(_db,...parts){return parts.join('/');},
  async getDocFromServer(path){
   if(offline)throw Error('offline');
   const data=cloud.get(path);
   return {exists:()=>!!data,data:()=>data};
  },
  async setDoc(path,data){
   if(offline)throw Error('offline');
   if(cloud.has(path))throw Error('already exists');
   cloud.set(path,data);writes++;
  },
  serverTimestamp(){return {server:true};},
  query(...args){return args;},
  collection(_db,...args){return args.join('/');},
  where(...args){return args;},
  orderBy(key,dir){return {key,dir};},
  limit(n){return n;},
  async getDocsFromServer(){
   const docs=[...cloud.entries()].filter(([name])=>name.startsWith('gpsHistory/'+uid+'/shifts/'));
   return {forEach(callback){for(const [,data] of docs)callback({data:()=>data});}};
  },
  Timestamp:{fromMillis(value){return {millis:value,toMillis(){return value;}};}}
 };
 const auth={currentUser:{uid}},client=syncApi.create({
  auth,db:{},f,store,subtle:webcrypto.subtle
 });
 return {uid,shiftId,row,local,cloud,auth,client,get writes(){return writes;},
   setOffline(value){offline=value;}};
}

test('翌月同日と翌月末日の23:59までを計算',()=>{
 const at=s=>Date.parse(s);
 assert.equal(new Date(syncApi.retentionDeadlineMs(at('2026-10-15T00:00:00+09:00'))+1).toISOString(),'2026-11-15T15:00:00.000Z');
 assert.equal(new Date(syncApi.retentionDeadlineMs(at('2026-10-31T00:00:00+09:00'))+1).toISOString(),'2026-11-30T15:00:00.000Z');
});
test('入庫前と測位点0件は送信できない',()=>{
 const f=fixture();
 assert.throws(()=>syncApi.prepare({...f.row,endedAtMs:undefined}),/入庫済み/);
});
test('保存後のサーバー読戻し照合と二重送信防止',async()=>{
 const f=fixture();
 assert.equal((await f.client.one(f.uid,f.shiftId)).status,'saved');
 assert.equal(f.writes,1);
 assert.equal(f.local.get(f.shiftId).serverStatus,'保存済み');
 assert.equal((await f.client.one(f.uid,f.shiftId)).status,'skip');
 assert.equal(f.writes,1);
 f.local.set(f.shiftId,{...f.row,serverStatus:'未送信'});
 assert.equal((await f.client.one(f.uid,f.shiftId)).status,'saved');
 assert.equal(f.writes,1);
});
test('通信切断後は端末の履歴を保持し再送できる',async()=>{
 const f=fixture();f.setOffline(true);
 assert.equal((await f.client.one(f.uid,f.shiftId)).status,'error');
 assert.equal(f.local.get(f.shiftId).points.length,1);
 f.setOffline(false);
 assert.equal((await f.client.one(f.uid,f.shiftId)).status,'saved');
});
test('違う内容のサーバー履歴は無断上書きしない',async()=>{
 const f=fixture();await f.client.one(f.uid,f.shiftId);
 f.local.set(f.shiftId,{...f.row,serverStatus:'未送信',
  points:[{...f.row.points[0],lat:34.8}]});
 assert.equal((await f.client.one(f.uid,f.shiftId)).status,'error');
 assert.equal(f.writes,1);
});
test('削除済み乗務を他端末が再送しない',async()=>{
 const f=fixture();f.cloud.set('gpsHistoryTombstones/'+f.uid+'/shifts/'+f.shiftId,{deleted:true});
 assert.equal((await f.client.one(f.uid,f.shiftId)).status,'deleted');
 assert.equal(f.local.get(f.shiftId).serverStatus,'削除済み');
 assert.equal(f.writes,0);
});
test('他UIDへの切替後は送信不可',async()=>{
 const f=fixture();f.auth.currentUser.uid='other';
 await assert.rejects(f.client.one(f.uid,f.shiftId),/別のログイン利用者/);
});

test('7日後の端末コピー整理後もクラウド履歴の取得を想定',async()=>{
 const f=fixture();
 assert.equal((await f.client.one(f.uid,f.shiftId)).status,'saved');
 const rows=await f.client.listRemote(f.uid);
 assert.equal(rows.length,1);
 assert.equal(rows[0].points.length,1);
 const entry=await f.client.readRemote(f.uid,f.shiftId);
 assert.equal(entry.shiftId,f.shiftId);
 assert.equal(entry.serverStatus,'保存済み');
});
test('同じハッシュ・点数でも読戻しの実データが違えば保存済みにしない',async()=>{
 const f=fixture();await f.client.one(f.uid,f.shiftId);
 const path='gpsHistory/'+f.uid+'/shifts/'+f.shiftId;
 const doc=f.cloud.get(path);doc.points[0].lat=1;
 f.local.set(f.shiftId,{...f.row,points:[{...f.row.points[0],lat:34.7}],serverStatus:'未送信'});
 assert.equal((await f.client.one(f.uid,f.shiftId)).status,'error');
 assert.equal(f.local.get(f.shiftId).serverStatus,'エラー');
});
