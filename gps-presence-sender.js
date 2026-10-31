/* GPS送信元の排他制御。既存deviceSessionsを読取参照し、自動取得/切替しない。 */
(function(root){'use strict';
const LEASE_MS=120000,RENEW_MS=90000;
// 同じタブの再読込では送信元IDを保持。複製タブではブラウザロックで別IDに分離。
async function acquireIdentity({uid,storage,locks,random=()=>root.crypto.randomUUID()}){
 if(!locks?.request)return {senderId:random(),release(){}};
 const key='taxiapp-gps-sender-v1-'+uid;
 let candidate;try{candidate=storage.getItem(key);}catch{}
 if(typeof candidate!=='string'||candidate.length!==36)candidate=random();
 for(let attempt=0;attempt<2;attempt++){
  const id=candidate;
  const identity=await new Promise(resolve=>{
   let release;const finished=new Promise(r=>release=r);
   locks.request('taxiapp-gps-sender:'+uid+':'+id,{ifAvailable:true},async lock=>{
    if(!lock){resolve(null);return;}
    resolve({senderId:id,release});await finished;
   }).catch(()=>resolve(null));
  });
  if(identity){try{storage.setItem(key,id);}catch{}return identity;}
  candidate=random();
 }
 // Web Locksが使えない場合も同一IDを複製せず、安全側の新しいIDにする。
 return {senderId:random(),release(){}};
}
function create({auth,db,f,session,uid,senderId,onChange=()=>{},now=()=>Date.now()}){
 let disposed=false,held=false,leaseAt=0,retryAt=0,leaseDirty=false,tail=Promise.resolve(),generation=0;
 const lease=f.doc(db,'gpsSenderSessions',uid),presence=f.doc(db,'gpsPresence',uid);
 const current=()=>!disposed&&auth.currentUser?.uid===uid&&session.canWrite()&&Boolean(session.sessionId());
 function report(message){onChange({held:held&&current(),message});}
 function clear(message){held=false;leaseAt=0;retryAt=0;generation++;report(message);}
 function owned(row,writer){return row?.senderId===senderId&&row?.writerSessionId===writer;}
 function time(row){return row?.updatedAt?.toMillis?.()??NaN;}
 function enqueue(operation){const p=tail.then(operation);tail=p.catch(()=>{});return p;}
 function valid(){return current()&&held&&Number.isFinite(leaseAt)&&now()<leaseAt+LEASE_MS;}
 async function maintain(){
  if(!current()){clear('閲覧専用／操作権確認中：位置送信停止');return false;}
  if(valid()&&now()<leaseAt+RENEW_MS)return true;
  if(now()<retryAt)return false;
  const writer=session.sessionId(),epoch=generation;
  const result=await f.runTransaction(db,async tx=>{
   const snap=await tx.get(lease),row=snap.exists()?snap.data():null;
   if(!current()||writer!==session.sessionId()||epoch!==generation)return {status:'cancelled'};
   const updated=time(row);
   if(row&&!owned(row,writer)&&row.writerSessionId===writer&&Number.isFinite(updated)&&now()<updated+LEASE_MS)
    return {status:'standby',until:updated+LEASE_MS};
   leaseDirty=true;tx.set(lease,{senderId,writerSessionId:writer,updatedAt:f.serverTimestamp()});
   return {status:'claimed'};
  });
  if(!current()||writer!==session.sessionId()||epoch!==generation)return false;
  if(result.status!=='claimed'){
   held=false;retryAt=Math.max(now()+5000,result.until||0);
   report('別の位置共有画面が送信中：この画面は閲覧のみ');return false;
  }
  // serverTimestampを実読戻ししてからGPS/履歴記録を開始する。
  const snap=await f.getDocFromServer(lease);
  if(!current()||writer!==session.sessionId()||epoch!==generation)return false;
  const row=snap.exists()?snap.data():null;
  held=owned(row,writer);leaseAt=time(row);
  if(!valid()){held=false;report('位置送信元のサーバー確認待ち');return false;}
  retryAt=0;report('この画面から位置送信');return true;
 }
 function ensure(){return enqueue(async()=>{
  try{return await maintain();}catch(e){held=false;retryAt=now()+5000;report('位置送信元の確認失敗：'+e.message);throw e;}
 });}
 function send(payload){return enqueue(async()=>{
  if(!valid())return {status:'not-sender'};
  const writer=session.sessionId(),epoch=generation;
  const result=await f.runTransaction(db,async tx=>{
   const snap=await tx.get(lease),row=snap.exists()?snap.data():null;
   if(!current()||epoch!==generation||writer!==session.sessionId()||!owned(row,writer)||!(now()<time(row)+LEASE_MS))return false;
   tx.set(presence,{...payload,senderId,writerSessionId:writer,updatedAt:f.serverTimestamp()});
   return true;
  });
  if(!result){clear('位置送信元が切り替わったため停止');return {status:'not-sender'};}
  return current()&&writer===session.sessionId()&&epoch===generation?{status:'sent'}:{status:'cancelled'};
 }).catch(error=>{clear('位置送信失敗：操作権を再確認します');throw error;});}
 function stop(closed){
  const writer=session.sessionId(),needed=held||leaseDirty;generation++;held=false;retryAt=0;
  if(!needed)return Promise.resolve(false);
  report('位置送信停止');
  return enqueue(async()=>{
   if(disposed||auth.currentUser?.uid!==uid||!writer||!session.canWrite()||session.sessionId()!==writer)return false;
   return f.runTransaction(db,async tx=>{
    const snap=await tx.get(lease),row=snap.exists()?snap.data():null;
    if(disposed||auth.currentUser?.uid!==uid||session.sessionId()!==writer||!session.canWrite()||!owned(row,writer))return false;
    tx.set(presence,{...closed,senderId,writerSessionId:writer,updatedAt:f.serverTimestamp()});
    tx.delete(lease);return true;
   }).finally(()=>{leaseDirty=false;});
  });
 }
 function observe(snap){
  if(disposed||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)return;
  const row=snap.exists()?snap.data():null,writer=session.sessionId();
  if(held&&!owned(row,writer)){held=false;generation++;report('別の画面へ位置送信元が切り替わりました');}
  if(!row||row.writerSessionId!==writer)retryAt=0;
 }
 return Object.freeze({ensure,send,stop,observe,canTrack:valid,
  invalidate(){clear('操作権・通信の確認待ち：位置送信停止');},
  dispose(){disposed=true;held=false;generation++;}});
}
const api=Object.freeze({create,acquireIdentity,LEASE_MS,RENEW_MS});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.TAXIAPP_GPS_PRESENCE_SENDER=api;
})(typeof window!=='undefined'?window:globalThis);
