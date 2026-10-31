const {test}=require('node:test'),assert=require('node:assert/strict');
const {create,LEASE_MS}=require('../gps-presence-sender');
function fixture(){
 let now=100000,currentWriter='s'.repeat(32),reads=0;const docs=new Map(),writes=[];
 const stamp=n=>({toMillis:()=>n});
 const snap=key=>({exists:()=>docs.has(key),data:()=>docs.get(key)});
 const f={doc:(_db,...parts)=>parts.join('/'),serverTimestamp:()=>stamp(now),
  async getDocFromServer(key){reads++;return snap(key);},
  async runTransaction(_db,fn){const tasks=[];const result=await fn({
   get:async key=>{reads++;return snap(key);},set:(key,row)=>tasks.push(()=>{
    if(row.writerSessionId!==currentWriter)throw Error('permission-denied');docs.set(key,row);writes.push(key);
   }),delete:key=>tasks.push(()=>docs.delete(key))});
   tasks.forEach(fn=>fn());return result;}
 };
 const auth={currentUser:{uid:'driver'}};
 const client=(id,writer=currentWriter,canWrite=true)=>create({uid:'driver',auth,db:{},f,
  now:()=>now,senderId:id,session:{canWrite:()=>canWrite,sessionId:()=>writer}});
 return {docs,client,auth,writes,get reads(){return reads;},advance:n=>now+=n,changeWriter:w=>currentWriter=w};
}
test('閲覧専用は操作端末を取得せず、送信元/位置を書き込まない',async()=>{
 const f=fixture(),c=f.client('viewer','',false);
 assert.equal(await c.ensure(),false);assert.equal(c.canTrack(),false);assert.deepEqual(f.writes,[]);
});
test('同一UIDの別画面は待機し、期限後だけ取得して古い送信/停止を遮断',async()=>{
 const f=fixture(),a=f.client('a'),b=f.client('b');
 assert.equal(await a.ensure(),true);assert.equal(await b.ensure(),false);
 const reads=f.reads;assert.equal(await b.ensure(),false);assert.equal(f.reads,reads,'待機中の5秒周期で追加読取をしない');
 assert.equal((await a.send({lat:34})).status,'sent');
 f.advance(LEASE_MS+1);assert.equal(await b.ensure(),true);
 assert.equal((await b.send({lat:35})).status,'sent');
 assert.equal((await a.send({lat:36})).status,'not-sender');
 assert.equal(await a.stop({public:false}),false);
 assert.equal(f.docs.get('gpsPresence/driver').lat,35);
});
test('操作端末切替後の古い送信は拒否し、送信許可を失効させる',async()=>{
 const f=fixture(),a=f.client('a');await a.ensure();f.changeWriter('new-session');
 await assert.rejects(a.send({lat:34}),/permission-denied/);assert.equal(a.canTrack(),false);
 const b=f.client('b','new-session');assert.equal(await b.ensure(),true);
});
test('認証切替と停止後はGPS送信不可、現在の所有者だけが位置消去・解放',async()=>{
 const f=fixture(),a=f.client('a');await a.ensure();assert.equal(await a.stop({public:false}),true);
 assert.equal(f.docs.has('gpsSenderSessions/driver'),false);assert.equal(a.canTrack(),false);
 await a.ensure();f.auth.currentUser={uid:'other'};
 assert.equal((await a.send({lat:34})).status,'not-sender');
});
