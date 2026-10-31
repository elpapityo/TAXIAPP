/* TAXIAPP GPS-only history cloud upload. Never touches privateDuties. */
(function(root){
'use strict';
const FORMAT='TAXIAPP_GPS_HISTORY_V1';
const MAX_BYTES=780000;
const SHIFT=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
const encoder=new TextEncoder();
function retentionDeadlineMs(endedAtMs){
 if(!Number.isFinite(endedAtMs)||endedAtMs<=0)throw Error('入庫日時が未確認です');
 const d=new Date(endedAtMs+9*3600000);
 const y=d.getUTCFullYear(),m=d.getUTCMonth()+1,day=d.getUTCDate();
 const lastDay=new Date(Date.UTC(y,m+1,0)).getUTCDate();
 // Same day in following month, or last valid day, through 23:59:59 JST.
 return Date.UTC(y,m,Math.min(day,lastDay)+1)-9*3600000-1;
}
function prepare(row){
 if(!row||!row.uid||!SHIFT.test(String(row.shiftId||''))||
    !Number.isFinite(row.startedAtMs)||!Number.isFinite(row.endedAtMs)||
    row.endedAtMs<row.startedAtMs||!Array.isArray(row.points)||!row.points.length)
   throw Error('入庫済みのGPS走行履歴ではありません');
 const points=row.points.map(p=>{
  if(!Number.isFinite(p.capturedAtMs)||!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||
     Math.abs(p.lat)>90||Math.abs(p.lon)>180||!Number.isFinite(p.accuracy)||
     !Number.isInteger(p.segmentNo)||p.segmentNo<1)
    throw Error('不正なGPS測位点が含まれています');
  return {
   capturedAtMs:p.capturedAtMs,lat:p.lat,lon:p.lon,accuracy:p.accuracy,
   speed:p.speed==null?null:p.speed,heading:p.heading==null?null:p.heading,
   suspectedJump:p.suspectedJump===true,segmentNo:p.segmentNo
  };
 });
 const payload={format:FORMAT,shiftId:row.shiftId,startedAtMs:row.startedAtMs,
  endedAtMs:row.endedAtMs,points};
 if(encoder.encode(JSON.stringify(payload)).length>MAX_BYTES)
  throw Error('GPS履歴がクラウド保存上限を超えています。端末履歴を保持します');
 return payload;
}
async function sha256(payload,subtle){
 if(!subtle||typeof subtle.digest!=='function')throw Error('SHA-256を利用できません');
 const buffer=await subtle.digest('SHA-256',encoder.encode(JSON.stringify(payload)));
 return [...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function create({auth,db,f,store,subtle}){
 if(!auth||!db||!f||!store)throw Error('履歴同期の初期化情報がありません');
 const cryptoSource=subtle||root.crypto?.subtle;
 let ongoing=Promise.resolve(),disposed=false;
 function verifyOwner(uid){
  if(disposed||!auth.currentUser||auth.currentUser.uid!==uid)throw Error('別のログイン利用者に切り替わりました');
 }
 function docFor(uid,shiftId){
  return f.doc(db,'gpsHistory',uid,'shifts',shiftId);
 }
 function tombFor(uid,shiftId){
  return f.doc(db,'gpsHistoryTombstones',uid,'shifts',shiftId);
 }
 async function send(uid,shiftId){
  verifyOwner(uid);
  const row=await store.fetchOne(uid,shiftId);
  verifyOwner(uid);
  if(!row||row.serverStatus==='保存済み'||row.serverStatus==='削除済み')return {status:'skip'};
  if(!Number.isFinite(row.endedAtMs))return {status:'not-ended'};
  let payload,hash;
  try{
   payload=prepare(row);
   hash=await sha256(payload,cryptoSource);
  }catch(error){
   await store.setSyncState(uid,shiftId,'エラー',{error:error.message});
   return {status:'error',message:error.message};
  }
  await store.setSyncState(uid,shiftId,'送信中');
  try{
   verifyOwner(uid);
   // Check a persistent tombstone before any upload; a previously deleted
   // history is never silently resurrected by another offline device.
   const tomb=await f.getDocFromServer(tombFor(uid,shiftId));
   verifyOwner(uid);
   if(tomb.exists()){
    await store.setSyncState(uid,shiftId,'削除済み');
    return {status:'deleted'};
   }
   const ref=docFor(uid,shiftId);
   const old=await f.getDocFromServer(ref);
   verifyOwner(uid);
   if(old.exists()&&old.data().contentHash!==hash)
    throw Error('サーバーの乗務履歴が異なります。上書きせず端末履歴を保持しました');
   if(!old.exists()){
    // Create-only rule prevents replacing a confirmed server original.
    await f.setDoc(ref,{...payload,uid,contentHash:hash,
      expiresAt:f.Timestamp.fromMillis(retentionDeadlineMs(payload.endedAtMs)),
      uploadedAt:f.serverTimestamp()});
   }
   verifyOwner(uid);
   const saved=await f.getDocFromServer(ref);
   verifyOwner(uid);
   if(!saved.exists()||saved.data().contentHash!==hash||
      saved.data().points?.length!==payload.points.length)
    throw Error('GPS履歴のサーバー読戻し照合が一致しません');
   const sentAt=Date.now();
   await store.setSyncState(uid,shiftId,'保存済み',{savedAtMs:sentAt,serverHash:hash});
   return {status:'saved',pointCount:payload.points.length};
  }catch(error){
   // Keep all local points when permission, communication or conflict fails.
   await store.setSyncState(uid,shiftId,'エラー',{error:error.message||String(error)});
   return {status:'error',message:error.message||String(error)};
  }
 }
 function one(uid,shiftId){
  const run=ongoing.then(()=>send(uid,shiftId));
  ongoing=run.then(()=>undefined,()=>undefined);
  return run;
 }
 async function all(uid){
  verifyOwner(uid);
  const rows=await store.list(uid);
  const results=[];
  for(const row of rows){
   verifyOwner(uid);
   if(row.serverStatus==='保存済み'||row.serverStatus==='削除済み'||
      !Number.isFinite(row.endedAtMs))continue;
   results.push({shiftId:row.shiftId,...await one(uid,row.shiftId)});
  }
  return results;
 }

 async function readRemote(uid,shiftId){
  verifyOwner(uid);
  if(!SHIFT.test(shiftId))throw Error('乗務IDが不正です');
  const result=await f.getDocFromServer(docFor(uid,shiftId));
  verifyOwner(uid);
  if(!result.exists())return null;
  const row=result.data();
  if(row.format!==FORMAT||row.shiftId!==shiftId||
     !Array.isArray(row.points))throw Error('サーバーGPS履歴の形式が不正');
  const expiry=row.expiresAt?.toMillis?.()??Number(row.expiresAt?.millis);
  if(Number.isFinite(expiry)&&Date.now()>expiry)return null;
  return {uid,shiftId,startedAtMs:row.startedAtMs,endedAtMs:row.endedAtMs,
   points:row.points,serverStatus:'保存済み',source:'cloud',
   contentHash:row.contentHash};
 }
 async function listRemote(uid){
  verifyOwner(uid);
  // User-initiated query only; no startup full-record downloads.
  const q=f.query(f.collection(db,'gpsHistory',uid,'shifts'),
   f.orderBy('endedAtMs','desc'),f.limit(40));
  const snap=await f.getDocsFromServer(q);
  verifyOwner(uid);
  const rows=[];
  snap.forEach(item=>{
   const row=item.data();
   if(row.format!==FORMAT||!SHIFT.test(String(row.shiftId||''))||
      !Array.isArray(row.points))return;
   const expiry=row.expiresAt?.toMillis?.()??Number(row.expiresAt?.millis);
   if(Number.isFinite(expiry)&&Date.now()>expiry)return;
   rows.push({uid,shiftId:row.shiftId,startedAtMs:row.startedAtMs,
    endedAtMs:row.endedAtMs,points:row.points,serverStatus:'保存済み',
    source:'cloud',contentHash:row.contentHash});
  });
  return rows;
 }
 function dispose(){disposed=true;}
 return Object.freeze({one,all,readRemote,listRemote,dispose});
}
const api=Object.freeze({FORMAT,MAX_BYTES,retentionDeadlineMs,prepare,sha256,create});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.TAXIAPP_GPS_HISTORY_SYNC=api;
})(typeof window!=='undefined'?window:globalThis);
