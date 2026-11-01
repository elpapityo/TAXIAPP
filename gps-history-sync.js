/* TAXIAPP GPS-only history cloud upload. Never touches privateDuties. */
(function(root){
'use strict';
const {FORMAT,MAX_BYTES,SHIFT,prepare,retentionDeadlineMs}=root.TAXIAPP_GPS_HISTORY_VALIDATION||require('./functions/gps-history-validation');
const encoder=new TextEncoder();
async function sha256(payload,subtle){
 if(!subtle||typeof subtle.digest!=='function')throw Error('SHA-256を利用できません');
 const buffer=await subtle.digest('SHA-256',encoder.encode(JSON.stringify(payload)));
 return [...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function create({auth,db,f,store,subtle,upload,remote}){
 if(!auth||!store||!remote&&(!db||!f))throw Error('履歴同期の初期化情報がありません');
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
 async function readCloud(uid,id){
  if(!remote)return f.getDocFromServer(docFor(uid,id));
  const row=await remote.get(uid,id);return {exists:()=>row!==null,data:()=>row};
 }
 async function readTomb(uid,id){
  if(!remote)return f.getDocFromServer(tombFor(uid,id));
  const deleted=await remote.tomb(uid,id);return {exists:()=>deleted};
 }
 async function send(uid,shiftId){
  verifyOwner(uid);
  const row=await store.fetchOne(uid,shiftId);
  verifyOwner(uid);
  if(row&&(row.uid!==uid||row.shiftId!==shiftId))throw Error('端末履歴の所有者または乗務IDが一致しません');
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
   const tomb=await readTomb(uid,shiftId);
   verifyOwner(uid);
   if(tomb.exists()){
    await store.setSyncState(uid,shiftId,'削除済み');
    return {status:'deleted'};
   }
   const ref=remote?null:docFor(uid,shiftId);
   const old=await readCloud(uid,shiftId);
   verifyOwner(uid);
   if(old.exists()&&old.data().contentHash!==hash)
    throw Error('サーバーの乗務履歴が異なります。上書きせず端末履歴を保持しました');
   if(!old.exists()){
    // Create-only rule prevents replacing a confirmed server original.
    if(remote)await remote.save(uid,payload,hash);
    else if(upload)await upload({actorUid:uid,payload,contentHash:hash});
    else await f.setDoc(ref,{...payload,uid,contentHash:hash,
      expiresAt:f.Timestamp.fromMillis(retentionDeadlineMs(payload.endedAtMs)),
      uploadedAt:f.serverTimestamp()});
   }
   verifyOwner(uid);
   const saved=await readCloud(uid,shiftId);
   verifyOwner(uid);
   if(!saved.exists()||saved.data().uid!==uid||saved.data().contentHash!==hash||
      await sha256(prepare({...saved.data(),uid}),cryptoSource)!==hash)
    throw Error('GPS履歴のサーバー読戻し照合が一致しません');
   verifyOwner(uid);
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
   const result=await one(uid,row.shiftId);results.push({shiftId:row.shiftId,...result});
   if(result.status==='error')break; // 通信/資格の失敗後に残りを連続送信しない。
  }
  return results;
 }

 async function readRemote(uid,shiftId){
  verifyOwner(uid);
  if(!SHIFT.test(shiftId))throw Error('乗務IDが不正です');
  const result=await readCloud(uid,shiftId);
  verifyOwner(uid);
  if(!result.exists())return null;
  const row=result.data();
  if(row.uid!==uid||row.format!==FORMAT||row.shiftId!==shiftId||
     !Array.isArray(row.points))throw Error('サーバーGPS履歴の形式が不正');
  const expiry=Number.isSafeInteger(row.expiresAt)?row.expiresAt:row.expiresAt?.toMillis?.()??Number(row.expiresAt?.millis);
  if(!Number.isFinite(expiry)||Date.now()>=expiry)return null;
  if(await sha256(prepare({...row,uid}),cryptoSource)!==row.contentHash)throw Error('サーバーGPS履歴の内容が一致しません');
  verifyOwner(uid);
  return {uid,cloudUid:row.cloudUid,shiftId,startedAtMs:row.startedAtMs,endedAtMs:row.endedAtMs,
   points:row.points,serverStatus:'保存済み',source:'cloud',
   contentHash:row.contentHash};
 }
 async function listRemote(uid){
  verifyOwner(uid);
  if(remote){const rows=await remote.list(uid);verifyOwner(uid);return rows;}
  // User-initiated query only; no startup full-record downloads.
  const q=f.query(f.collection(db,'gpsHistory',uid,'shifts'),
   f.where('expiresAt','>',f.Timestamp.fromMillis(Date.now())),
   f.orderBy('expiresAt','desc'),f.limit(40));
  const snap=await f.getDocsFromServer(q);
  verifyOwner(uid);
  const rows=[];
  snap.forEach(item=>{
   const row=item.data();
   if(row.uid!==uid||row.format!==FORMAT||!SHIFT.test(String(row.shiftId||''))||
      !Array.isArray(row.points))return;
   const expiry=Number.isSafeInteger(row.expiresAt)?row.expiresAt:row.expiresAt?.toMillis?.()??Number(row.expiresAt?.millis);
   if(!Number.isFinite(expiry)||Date.now()>=expiry)return;
   rows.push({uid,shiftId:row.shiftId,startedAtMs:row.startedAtMs,
    endedAtMs:row.endedAtMs,points:row.points,serverStatus:'保存済み',
    source:'cloud',contentHash:row.contentHash});
  });
  return rows;
 }
 function dispose(){disposed=true;}
 return Object.freeze({one,all,readRemote,listRemote,dispose});
}
function createGas({diaryAuth,gpsAuth,client,store,subtle}){
 const adapter=root.TAXIAPP_GPS_HISTORY_GAS_ADAPTER||require('./gps-history-gas-adapter');
 const remote=adapter.create({diaryAuth,gpsAuth,client,subtle});
 const session=create({auth:diaryAuth,store,subtle,remote});
 return Object.freeze({...session,backend:'gas',localUid:remote.localUid,cloudUid:remote.gpsUid,
  removeRemote:remote.remove,recordCsvAudit:remote.csv,admin:remote.admin,
  dispose(){session.dispose();remote.dispose();}});
}
const api=Object.freeze({FORMAT,MAX_BYTES,SHIFT,retentionDeadlineMs,prepare,sha256,create,createGas});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.TAXIAPP_GPS_HISTORY_SYNC=api;
})(typeof window!=='undefined'?window:globalThis);
