/* 履歴の端末所有者は日報UID、GAS/クラウド所有者はGPS UID。移行/削除はしない。 */
(function(root){'use strict';
const bridge=root.TAXIAPP_GPS_ACCOUNT_BRIDGE||require('./gps-account-bridge');
const history=root.TAXIAPP_GPS_HISTORY_SYNC||require('./gps-history-sync');
const UID=/^[a-zA-Z0-9_-]{1,128}$/;
function create({diaryAuth,gpsAuth,client,subtle=root.crypto?.subtle}){
 if(diaryAuth?.app?.options?.projectId!==bridge.DIARY_PROJECT||gpsAuth?.app?.options?.projectId!==bridge.GPS_PROJECT||diaryAuth===gpsAuth||typeof client?.call!=='function')throw Error('GPS履歴の認証接続が不正です');
 const d=diaryAuth.currentUser,g=gpsAuth.currentUser,ids=bridge.pair(d,g);let disposed=false;
 function current(uid=ids.diaryUid){
  if(disposed||diaryAuth.currentUser!==d||gpsAuth.currentUser!==g||uid!==ids.diaryUid||d.uid!==ids.diaryUid||g.uid!==ids.gpsUid)throw Error('履歴のログイン利用者が切り替わりました');
  bridge.pair(d,g);
 }
 function shift(id){if(typeof id!=='string'||!history.SHIFT.test(id))throw Error('乗務IDが不正です');}
 async function call(uid,action,data){current(uid);const result=await client.call(action,data);current(uid);return result;}
 async function validate(row,uid,id){
  if(row?.uid!==uid||row?.shiftId!==id||row?.format!==history.FORMAT||!Number.isSafeInteger(row?.expiresAt)||row.expiresAt<=Date.now())throw Error('クラウド履歴の所有者・形式・期限が一致しません');
  const payload=history.prepare(row);
  if(await history.sha256(payload,subtle)!==row.contentHash)throw Error('クラウド履歴の内容照合が一致しません');
  current();if(row.expiresAt<=Date.now())throw Error('クラウド履歴の保存期限を過ぎています');return row;
 }
 return Object.freeze({localUid:ids.diaryUid,gpsUid:ids.gpsUid,
  async get(uid,id){
   current(uid);shift(id);let result;
   try{result=await call(uid,'getOwnGpsHistory',{shiftId:id});}catch(error){current(uid);if(error.code==='not-found')return null;throw error;}
   const row=await validate(result.history,ids.gpsUid,id);current(uid);
   // クラウドの所有者を検査した後だけ、端末表示用に日報UIDへ対応させる。
   return {...row,uid:ids.diaryUid,cloudUid:ids.gpsUid};
  },
  async tomb(uid,id){shift(id);const r=await call(uid,'getOwnGpsHistoryTombstone',{shiftId:id});if(typeof r?.deleted!=='boolean')throw Error('削除済みの確認が不正です');return r.deleted;},
  async save(uid,payload,contentHash){
   current(uid);shift(payload?.shiftId);
   const r=await call(uid,'saveOwnGpsHistory',{payload,contentHash});
   if(r?.status!=='saved'||r.shiftId!==payload.shiftId||r.contentHash!==contentHash)throw Error('履歴の保存確認が一致しません');return r;
  },
  async list(uid){
   const r=await call(uid,'listOwnGpsHistory',{});
   if(r?.targetUid!==ids.gpsUid||!Array.isArray(r.shifts)||r.shifts.length>40)throw Error('クラウド履歴一覧の所有者が一致しません');
   return r.shifts.map(row=>{
    shift(row?.shiftId);
    if(!Number.isSafeInteger(row.startedAtMs)||row.startedAtMs<=0||!Number.isSafeInteger(row.endedAtMs)||row.endedAtMs<row.startedAtMs)throw Error('履歴一覧の日時が不正です');
    return {uid:ids.diaryUid,cloudUid:ids.gpsUid,shiftId:row.shiftId,startedAtMs:row.startedAtMs,endedAtMs:row.endedAtMs,points:[],metadataOnly:true,serverStatus:'保存済み',source:'cloud'};
   });
  },
  async remove(uid,id,confirmationShiftId){
   shift(id);if(confirmationShiftId!==id)throw Error('削除対象の乗務を確認してください');
   const r=await call(uid,'deleteGpsHistory',{shiftId:id,confirmationShiftId:id});
   if(r?.targetUid!==ids.gpsUid||r.shiftId!==id||!['deleted','already-deleted'].includes(r.status))throw Error('クラウド削除の保存確認が一致しません');return r;
  },
  async csv(uid,row){
   current(uid);if(row?.uid!==uid)throw Error('別の本人のCSV監査は送信できません');
   const r=await call(uid,'recordOwnGpsCsvAudit',{operationId:row.operationId,shiftId:row.shiftId,atMs:row.atMs});
   if(r?.status!=='saved'||r.operationId!==row.operationId)throw Error('CSV監査の保存確認が一致しません');return r;
  },
  async admin(action,data){
   if(!['adminListGpsHistory','adminViewGpsHistory','adminExportGpsHistory','adminListGpsHistoryAudit'].includes(action))throw Error('管理者履歴操作が不正です');
   if(action!=='adminListGpsHistoryAudit'&&(typeof data?.targetUid!=='string'||!UID.test(data.targetUid)))throw Error('GPS側の対象利用者IDが不正です');
   const r=await call(ids.diaryUid,action,data||{});
   if(action==='adminViewGpsHistory'||action==='adminExportGpsHistory'){
    if(r?.targetUid!==data.targetUid||r.shiftId!==data.shiftId||r.source!=='admin_server_audited')throw Error('監査済みの対象履歴が一致しません');
    if(await history.sha256(history.prepare({...r,uid:data.targetUid}),subtle)!==r.contentHash)throw Error('管理者履歴の内容が一致しません');current();
   }
   if(action==='adminListGpsHistory'){
    if(r?.targetUid!==data.targetUid||!Array.isArray(r.shifts)||r.shifts.length>40)throw Error('管理者履歴一覧の対象が一致しません');
    return {targetUid:r.targetUid,shifts:r.shifts.map(row=>{shift(row.shiftId);if(!Number.isSafeInteger(row.startedAtMs)||!Number.isSafeInteger(row.endedAtMs)||row.endedAtMs<row.startedAtMs)throw Error('管理者履歴の日時が不正です');return {shiftId:row.shiftId,startedAtMs:row.startedAtMs,endedAtMs:row.endedAtMs};})};
   }
   if(action==='adminListGpsHistoryAudit'){
    if(!Array.isArray(r?.entries)||r.entries.length>100)throw Error('監査一覧の形式が不正です');
    return {entries:r.entries.map(row=>({actorUid:String(row.actorUid||''),targetUid:String(row.targetUid||''),shiftId:String(row.shiftId||''),action:String(row.action||''),atMs:Number.isSafeInteger(row.atMs)?row.atMs:null}))};
   }
   return r;
  },
  dispose(){disposed=true;}
 });
}
const api=Object.freeze({create});root.TAXIAPP_GPS_HISTORY_GAS_ADAPTER=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
