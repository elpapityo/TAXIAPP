/* TAXIAPP location-history IndexedDB (separate from duty originals). */
(function(root){
'use strict';
const DB_NAME='taxiapp-gps-history-v1', DB_VERSION=1, STORE='shifts';
function keyFor(uid,shiftId){return String(uid)+':'+String(shiftId);}
function openDb(){
 return new Promise((resolve,reject)=>{
  if(!root.indexedDB)return reject(Error('IndexedDBを利用できません'));
  const req=indexedDB.open(DB_NAME,DB_VERSION);
  req.onupgradeneeded=()=>{
   const db=req.result;
   if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'key'});
  };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error('GPS履歴保存領域を開けません'));
  req.onblocked=()=>reject(Error('GPS履歴の保存領域が他の画面で使用中です'));
 });
}
async function transaction(method,mode,mutation){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  let tx,request;
  try{
   tx=db.transaction(STORE,mode);
   request=mutation(tx.objectStore(STORE));
  }catch(error){db.close();return reject(error);}
  let result;
  request.onsuccess=()=>{result=request.result;};
  request.onerror=()=>{try{tx.abort();}catch{}};
  tx.oncomplete=()=>{db.close();resolve(result);};
  tx.onerror=()=>{db.close();reject(tx.error||Error('GPS履歴の読み書きに失敗'));};
  tx.onabort=()=>{db.close();reject(tx.error||Error('GPS履歴の保存が中断'));};
 });
}
const fetchOne=async(uid,shiftId)=>transaction('get','readonly',s=>s.get(keyFor(uid,shiftId)));
const readAll=async()=>transaction('all','readonly',s=>s.getAll());
async function list(uid){
 const rows=await readAll();
 return rows.filter(row=>row.uid===uid).sort((a,b)=>(b.startedAtMs||0)-(a.startedAtMs||0));
}
function pointFor(fix,suspectedJump,segmentNo){
 return {
  capturedAtMs:fix.capturedAtMs,lat:fix.lat,lon:fix.lon,
  accuracy:fix.accuracy,speed:fix.speed,heading:fix.heading,
  suspectedJump:Boolean(suspectedJump),segmentNo
 };
}
function nextPoint(row,fix,suspectedJump=false){
 if(!fix||!Number.isFinite(fix.capturedAtMs))return {changed:false,row};
 const points=row.points||[];
 const prior=points[points.length-1]||null;
 if(prior&&fix.capturedAtMs<=prior.capturedAtMs)return {changed:false,row};
 if(prior&&fix.capturedAtMs-prior.capturedAtMs<30000)return {changed:false,row};
 let segmentNo=prior?prior.segmentNo:1;
 if(prior&&(fix.capturedAtMs-prior.capturedAtMs>=120000||row.breakBeforeNext===true))
  segmentNo+=1;
 const point=pointFor(fix,suspectedJump,segmentNo);
 return {changed:true,row:{...row,points:[...points,point],breakBeforeNext:false,
  lastCapturedAtMs:fix.capturedAtMs,updatedAtMs:Date.now(),serverStatus:'未送信'}};
}
async function record(uid,shiftId,startedAtMs,fix,suspectedJump=false){
 if(!uid||!/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(shiftId))throw Error('GPS履歴の乗務情報が不正');
 const existing=await fetchOne(uid,shiftId);
 const row=existing||{key:keyFor(uid,shiftId),uid,shiftId,startedAtMs,
  points:[],breakBeforeNext:false,createdAtMs:Date.now(),serverStatus:'未送信'};
 const result=nextPoint(row,fix,suspectedJump);
 if(!result.changed)return false;
 await transaction('put','readwrite',store=>store.put(result.row));
 return true;
}
async function markGap(uid,shiftId){
 if(!uid||!shiftId)return;
 const row=await fetchOne(uid,shiftId);
 if(row){await transaction('put','readwrite',store=>store.put({...row,breakBeforeNext:true}));}
}
async function finish(uid,shiftId,endedAtMs){
 if(!uid||!shiftId)return;
 const row=await fetchOne(uid,shiftId);
 if(row){await transaction('put','readwrite',s=>s.put({...row,endedAtMs,updatedAtMs:Date.now()}));}
}
async function remove(uid,shiftId){
 const row=await fetchOne(uid,shiftId);
 if(!row)return false;
 await transaction('delete','readwrite',s=>s.delete(keyFor(uid,shiftId)));
 return true;
}

async function setSyncState(uid,shiftId,serverStatus,details={}){
 const allowed=['未送信','送信中','保存済み','エラー','削除済み'];
 if(!allowed.includes(serverStatus))throw Error('GPS履歴の送信状態が不正');
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  let updated=null;
  const tx=db.transaction(STORE,'readwrite'),st=tx.objectStore(STORE);
  const req=st.get(keyFor(uid,shiftId));
  req.onsuccess=()=>{
   const row=req.result;
   if(!row){return;}
   // Never allow an old async upload callback to resurrect a deleted record.
   const safe={...row,serverStatus};
   if(serverStatus==='保存済み'){
     safe.savedAtMs=Number(details.savedAtMs)||Date.now();
     safe.serverHash=String(details.serverHash||'');
     safe.lastSyncError='';
   }else if(serverStatus==='エラー'){
     safe.lastSyncError=String(details.error||'送信できませんでした').slice(0,180);
   }
   updated=safe;st.put(safe);
  };
  tx.oncomplete=()=>{db.close();resolve(updated);};
  tx.onerror=()=>{db.close();reject(tx.error||Error('履歴の送信状態を保存できません'));};
  tx.onabort=()=>{db.close();reject(tx.error||Error('履歴の送信状態保存が中断'));};
 });
}
async function cleanupConfirmed(uid,now=Date.now()){
 const days=7*24*60*60*1000,db=await openDb();
 return new Promise((resolve,reject)=>{
  let count=0;
  const tx=db.transaction(STORE,'readwrite'),st=tx.objectStore(STORE);
  const req=st.openCursor();
  req.onsuccess=()=>{
   const cursor=req.result;if(!cursor)return;
   const row=cursor.value;
   if(row.uid===uid&&row.serverStatus==='保存済み'&&
      Number.isFinite(row.savedAtMs)&&now-row.savedAtMs>=days){
     cursor.delete();count++;
   }
   cursor.continue();
  };
  tx.oncomplete=()=>{db.close();resolve(count);};
  tx.onerror=()=>{db.close();reject(tx.error||Error('GPS端末保存の整理に失敗'));};
  tx.onabort=()=>{db.close();reject(tx.error||Error('GPS端末保存の整理が中断'));};
 });
}

const api=Object.freeze({DB_NAME,keyFor,list,fetchOne,nextPoint,record,markGap,finish,remove,setSyncState,cleanupConfirmed});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.TAXIAPP_GPS_HISTORY_STORE=api;
})(typeof window!=='undefined'?window:globalThis);