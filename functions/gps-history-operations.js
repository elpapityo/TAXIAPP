/* TAXIAPP GPS history-only server operations.
 * Never reads, writes, deletes or migrates privateDuties or existing Google data.
 * Draft code: deployment, IAM/Firestore permission changes require approval.
 */
'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {initializeApp,getApps}=require('firebase-admin/app');
const {getFirestore,FieldValue,Timestamp}=require('firebase-admin/firestore');
if(!getApps().length)initializeApp();
const db=getFirestore();
const opts={region:'asia-northeast1',memory:'256MiB',timeoutSeconds:120,
 maxInstances:1,concurrency:1,minInstances:0};
const SHIFT=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
const UID=/^[a-zA-Z0-9_-]{8,128}$/;
const RETENTION_MS=90*86400000;
const error=(code,message)=>{throw new HttpsError(code,message);};
function identity(req){
 const uid=req.auth?.uid;
 if(!uid)error('unauthenticated','TAXIAPPへのログインが必要です');
 return uid;
}
function argumentsFor(req){
 const targetUid=req.data?.targetUid,shiftId=req.data?.shiftId;
 if(typeof targetUid!=='string'||!UID.test(targetUid)||
    typeof shiftId!=='string'||!SHIFT.test(shiftId))
  error('invalid-argument','履歴の利用者IDまたは乗務IDが不正です');
 return {targetUid,shiftId};
}
async function adminOnly(uid){
 const doc=await db.doc('admins/'+uid).get();
 if(!doc.exists||doc.get('enabled')!==true)
  error('permission-denied','管理者権限がありません');
}
async function activeOrAdmin(uid){
 const [profile,admin]=await Promise.all([
  db.doc('users/'+uid).get(),db.doc('admins/'+uid).get()
 ]);
 if(!(profile.exists&&profile.get('status')==='active')&&
    !(admin.exists&&admin.get('enabled')===true))
  error('permission-denied','現在の利用資格を確認できません');
}
function historyRef(uid,id){return db.doc('gpsHistory/'+uid+'/shifts/'+id);}
function tombRef(uid,id){return db.doc('gpsHistoryTombstones/'+uid+'/shifts/'+id);}
function archiveDeadline(value){
 const ms=value?.toMillis?.();
 return Number.isFinite(ms)?ms:NaN;
}
function auditRow(actor,targetUid,shiftId,action){
 return {actorUid:actor,targetUid,shiftId,action,
  at:FieldValue.serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+RETENTION_MS)};
}
async function requestedHistory(targetUid,shiftId){
 const doc=await historyRef(targetUid,shiftId).get();
 if(!doc.exists)error('not-found','該当するGPS走行履歴がありません');
 const value=doc.data();
 if(value?.format!=='TAXIAPP_GPS_HISTORY_V1'||
    value?.shiftId!==shiftId||!Array.isArray(value.points))
  error('failed-precondition','GPS走行履歴の保存形式を確認できません');
 if(!Number.isFinite(archiveDeadline(value.expiresAt))||
    archiveDeadline(value.expiresAt)<Date.now())
  error('not-found','保存期限を過ぎたGPS履歴です');
 return value;
}
async function auditBeforeReturn(actor,targetUid,shiftId,action){
 const ref=db.collection('gpsHistoryAudit').doc();
 // The read is not returned to the browser until this write is server-acknowledged.
 await ref.create(auditRow(actor,targetUid,shiftId,action));
}
async function adminHistory(req,action){
 const actor=identity(req),{targetUid,shiftId}=argumentsFor(req);
 await adminOnly(actor);
 const value=await requestedHistory(targetUid,shiftId);
 if(action==='csv_export'&&req.data?.confirmedExport!==true)
  error('failed-precondition','他人の履歴を書き出すことを確認してください');
 await auditBeforeReturn(actor,targetUid,shiftId,action);
 return {targetUid,shiftId,startedAtMs:value.startedAtMs,endedAtMs:value.endedAtMs,
  points:value.points,contentHash:value.contentHash,
  source:'admin_server_audited'};
}
exports.adminViewGpsHistory=onCall(opts,request=>adminHistory(request,'view'));
exports.adminExportGpsHistory=onCall(opts,request=>adminHistory(request,'csv_export'));
exports.adminListGpsHistory=onCall(opts,async request=>{
 const actor=identity(request),targetUid=request.data?.targetUid;
 await adminOnly(actor);
 if(typeof targetUid!=='string'||!UID.test(targetUid))
  error('invalid-argument','履歴の対象利用者IDが不正です');
 // Metadata projection avoids downloading coordinates for 40 shifts at once.
 const docs=await db.collection('gpsHistory').doc(targetUid).collection('shifts')
  .orderBy('endedAtMs','desc').limit(40)
  .select('shiftId','startedAtMs','endedAtMs','expiresAt','format').get();
 return {targetUid,shifts:docs.docs.filter(d=>{
  const x=d.data();
  return x.format==='TAXIAPP_GPS_HISTORY_V1'&&
   Number.isFinite(archiveDeadline(x.expiresAt))&&
   archiveDeadline(x.expiresAt)>=Date.now();
 }).map(d=>({shiftId:d.get('shiftId'),startedAtMs:d.get('startedAtMs'),
  endedAtMs:d.get('endedAtMs')}))};
});
exports.adminListGpsHistoryAudit=onCall(opts,async request=>{
 const actor=identity(request);
 await adminOnly(actor);
 const snap=await db.collection('gpsHistoryAudit').orderBy('at','desc').limit(100).get();
 return {entries:snap.docs.map(doc=>{
  const row=doc.data();
  return {actorUid:String(row.actorUid||''),targetUid:String(row.targetUid||''),
   shiftId:String(row.shiftId||''),action:String(row.action||''),
   atMs:row.at?.toMillis?.()??null};
 })};
});
exports.deleteGpsHistory=onCall(opts,async request=>{
 const actor=identity(request),{targetUid,shiftId}=argumentsFor(request);
 if(request.data?.confirmationShiftId!==shiftId)
  error('failed-precondition','削除対象の乗務を確認してください');
 if(targetUid===actor)await activeOrAdmin(actor);
 else await adminOnly(actor);
 const ref=historyRef(targetUid,shiftId),tomb=tombRef(targetUid,shiftId);
 const audit=db.collection('gpsHistoryAudit').doc();
 const result=await db.runTransaction(async tx=>{
  const [existing,deleted]=await Promise.all([tx.get(ref),tx.get(tomb)]);
  if(deleted.exists)return {status:'already-deleted'};
  if(!existing.exists)error('not-found','GPS走行履歴がありません');
  tx.create(tomb,{targetUid,shiftId,deletedAt:FieldValue.serverTimestamp(),
   deletedBy:actor});
  tx.create(audit,auditRow(actor,targetUid,shiftId,'delete'));
  tx.delete(ref);
  return {status:'deleted'};
 });
 return {targetUid,shiftId,...result};
});
// Schedule is not enabled or deployed merely by committing code.
exports.cleanupGpsHistoryAndAudit=onSchedule({
 schedule:'0 3 * * *',timeZone:'Asia/Tokyo',region:'asia-northeast1',
 memory:'256MiB',timeoutSeconds:540,maxInstances:1
},async()=>{
 const now=Timestamp.now();let expired=0,logs=0;
 // Scope is exclusively the new GPS-only collection; never touch privateDuties.
 const owners=await db.collection('gpsHistory').listDocuments();
 for(const owner of owners){
  while(true){
   const snap=await owner.collection('shifts').where('expiresAt','<=',now).limit(400).get();
   if(snap.empty)break;
   const batch=db.batch();
   for(const doc of snap.docs){batch.delete(doc.ref);expired++;}
   await batch.commit();
   if(snap.size<400)break;
  }
 }
 while(true){
  const snap=await db.collection('gpsHistoryAudit').where('expiresAt','<=',now).limit(400).get();
  if(snap.empty)break;
  const batch=db.batch();
  for(const doc of snap.docs){batch.delete(doc.ref);logs++;}
  await batch.commit();
  if(snap.size<400)break;
 }
 console.info('GPS専用保持期限の整理',{expired,logs});
});
