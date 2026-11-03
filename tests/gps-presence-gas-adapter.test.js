const {test}=require('node:test'),assert=require('node:assert/strict');
const adapter=require('../gps-presence-gas-adapter'),preferences=require('../gps-sharing-preferences');
const cloudBudget=require('../gps-cloud-budget');
function fixture({writable=true}={}){
 const user=uid=>({uid,emailVerified:true,providerData:[{providerId:'google.com',uid:'same-subject'}]});
 const diaryAuth={app:{options:{projectId:'taxiapp-2b6bd'}},currentUser:user('diary-id')},gpsAuth={app:{options:{projectId:'taxigps-9f82e'}},currentUser:user('gps-id')};
 const senderId='00000000-0000-4000-8000-000000000001',calls=[],state={now:1000000,writer:'w'.repeat(32),preference:null,wrongClaim:false,badSend:false};
 const session={canWrite:()=>writable,sessionId:()=>state.writer};
 const client={async call(action,data){calls.push({action,data});
  if(action==='getOwnGpsSharePrefs')return {preference:state.preference};
  if(action==='setOwnGpsSharePrefs'){state.preference={public:data.public,revision:data.baseRevision+1,operationId:data.operationId};return {preference:state.preference};}
  if(action==='acquireGpsSender')return {status:'claimed',senderId:state.wrongClaim?'wrong':data.senderId,writerSessionId:data.writerSessionId,updatedAtMs:state.now,validUntilMs:state.now+120000};
  if(action==='sendGpsPresence')return {status:'sent',updatedAtMs:state.badSend?1:state.now};
  if(action==='stopGpsPresence')return {stopped:true};
  if(action==='listGpsPresence')return {vehicles:[{uid:'gps-peer',name:'合成利用者',public:true,onDuty:true,status:'空車',lat:34,lon:135,accuracy:5,updatedAt:state.now,diaryUid:'返してはいけない'}],truncated:false};
  throw Error('未定義の操作');
 }};
 // 合成の予算と消費量。GAS/Cloudflareの実測値として扱わない。
 const budget=cloudBudget.create({now:()=>state.now,resources:{requests:{limit:10000,reserve:5000}},
  costs:Object.fromEntries(['claim','send','list','readPreference','writePreference'].map(op=>[op,{requests:1}]))});
 budget.update({scope:'account-and-project',observedAtMs:state.now,windows:{requests:{used:0,resetAtMs:state.now+86400000}}});
 const options={diaryAuth,gpsAuth,client,session,senderId,budget,now:()=>state.now};
 return {diaryAuth,gpsAuth,client,session,senderId,calls,state,options,budget};
}
test('GAS現在地：初期化と閲覧専用では送信元を取得せず、日報/GPSの本人切替で即座にcanTrack=false',async()=>{
 const viewer=fixture({writable:false}),v=adapter.createSender(viewer.options);assert.equal(await v.ensure(),false);assert.equal(viewer.calls.length,0);
 const f=fixture(),sender=adapter.createSender(f.options);assert.equal(f.calls.length,0);assert.equal(await sender.ensure(),true);assert.equal(sender.canTrack(),true);
 f.gpsAuth.currentUser={...f.gpsAuth.currentUser};assert.equal(sender.canTrack(),false);assert.equal((await sender.send({})).status,'not-sender');assert.equal(f.calls.length,1);
});
test('GAS現在地：既存公開設定CAS→既存送信元→送信→停止をGASだけで処理し、日報UIDをクラウド所有者に混ぜない',async()=>{
 const f=fixture(),sender=adapter.createSender(f.options),map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const pref=preferences.create({uid:'diary-id',storage,read:sender.readPreference,write:(v,op)=>sender.writePreference(v,op,f.state.writer)});
 await pref.sync();assert.equal(pref.state().confirmed,true);assert.equal(f.state.preference.public,true);
 assert.equal(await sender.ensure(),true);
 assert.equal((await sender.send({public:true,onDuty:true,status:'空車',shiftId:'shift-1',capturedAtMs:f.state.now,lat:34,lon:135,accuracy:5,uid:'diary-id',name:'任意の名前',updatedAt:{sentinel:true}})).status,'sent');
 const sent=f.calls.find(c=>c.action==='sendGpsPresence');assert.equal(sent.data.payload.uid,undefined);assert.equal(sent.data.payload.name,undefined);assert.equal(sent.data.payload.updatedAt,undefined);
 assert.equal(sent.data.writerSessionId,f.state.writer);assert.equal(sent.data.senderId,f.senderId);
 assert.equal(await sender.stop({public:false}),true);assert.equal(sender.canTrack(),false);assert.equal(f.calls.at(-1).action,'stopGpsPresence');
});
test('GAS現在地：誤送信元の応答・不正保存時刻では送信許可を残さない',async()=>{
 const f=fixture();f.state.wrongClaim=true;const sender=adapter.createSender(f.options);await assert.rejects(sender.ensure(),/保存確認/);assert.equal(sender.canTrack(),false);
 f.state.wrongClaim=false;f.state.now+=6000;await sender.ensure();f.state.badSend=true;
 await assert.rejects(sender.send({public:true}),/保存確認/);assert.equal(sender.canTrack(),false);
});
test('GAS現在地：一覧は表示項目だけ返し、5分経過・本人切替・操作端末切替・破棄を拒否',async()=>{
 const f=fixture(),remote=adapter.create(f.options),sender=adapter.createSender(f.options);
 const result=await remote.list();assert.equal(result.vehicles.length,1);assert.equal(result.vehicles[0].diaryUid,undefined);
 f.state.now+=60000;f.client.call=async()=>({vehicles:[{...result.vehicles[0],updatedAt:f.state.now-300000}],truncated:false});assert.equal((await remote.list()).vehicles.length,0);
 f.client.call=async(action,data)=>({status:'claimed',senderId:data.senderId,writerSessionId:data.writerSessionId,updatedAtMs:f.state.now,validUntilMs:f.state.now+120000});
 await sender.ensure();f.state.writer='n'.repeat(32);assert.equal(sender.canTrack(),false);
 remote.dispose();await assert.rejects(remote.list(),/切り替わり/);
});
test('GAS現在地：予算不明時は定期通信ゼロ、非公開CASと停止は通し、本人切替は依然拒否',async()=>{
 const f=fixture(),remote=adapter.create({...f.options,budget:undefined});
 assert.equal((await remote.claim(f.state.writer,f.senderId)).status,'deferred');
 assert.equal((await remote.send(f.state.writer,f.senderId,{speed:10})).status,'deferred');
 await assert.rejects(remote.list(),e=>e.code==='GPS_BUDGET_DEFERRED');
 await assert.rejects(remote.writePreference(true,{id:f.senderId,baseRevision:0},f.state.writer),e=>e.code==='GPS_BUDGET_DEFERRED');
 assert.equal(f.calls.length,0);
 await remote.writePreference(false,{id:f.senderId,baseRevision:0},f.state.writer);
 assert.equal((await remote.stop(f.state.writer,f.senderId)).stopped,true);
 assert.deepEqual(f.calls.map(c=>c.action),['setOwnGpsSharePrefs','stopGpsPresence']);
 f.gpsAuth.currentUser=null;await assert.rejects(remote.stop(f.state.writer,f.senderId),/切り替わり/);
});
test('GAS現在地：予算で延長した間隔はHTTP前に適用し、送信元資格を無駄に取り直さない',async()=>{
 const f=fixture(),s=adapter.createSender(f.options);await s.ensure();
 assert.equal((await s.send({speed:10})).status,'sent');
 f.state.now++;
 f.budget.update({scope:'account-and-project',observedAtMs:f.state.now,windows:{requests:{used:4000,resetAtMs:1000000+86400000}}});
 const count=f.calls.length;assert.equal((await s.send({speed:10})).status,'deferred');
 assert.equal(s.canTrack(),true);assert.equal(f.calls.length,count);
 f.state.now+=90000;assert.equal(await s.ensure(),true);
 assert.equal((await s.send({speed:10})).status,'deferred');
 f.state.now+=90000;await s.ensure();assert.equal((await s.send({speed:10})).status,'sent');
});
