/* TAXIAPP Firestore duty trash - EXPERIMENTAL, NOT WIRED TO PRODUCTION UI.
 * Reversible 30-day trash lives in privateDuties/{uid}/trash.
 * A minimal permanent marker lives in privateDuties/{uid}/tombstones.
 * Markers prevent an older client from recreating a deleted shift ID.
 * REQUIRES rigorously tested Firestore rules before deployment. The current
 * production rules reject deletion; DO NOT bypass them or auto-switch backends.
 */
(function(root){
'use strict';
const ID=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
const DAY_MS=86400000,RETENTION_DAYS=30;
const clone=x=>JSON.parse(JSON.stringify(x));
// The local model must never be silently republished after a server delete.
// This read-only decision helper deliberately NEVER authorizes an upload.
// Server-side tombstone Rules remain mandatory for old clients.
function planReconciliation({uid,serverUid,localShifts,serverShifts,markerStates,markersComplete}={}){
 if(typeof uid!=='string'||!uid||serverUid!==uid)
  throw Error('本人UIDの照合が不一致です');
 if(markersComplete!==true)
  throw Error('削除マーカーの全件確認ができていません');
 if(!Array.isArray(localShifts)||!Array.isArray(serverShifts)||
    !Array.isArray(markerStates))
  throw Error('日報と削除マーカーの一覧が不正です');
 const toMap=(items,label)=>{
  const seen=new Map();
  for(const item of items){
   if(!item||!ID.test(String(item.id||''))||seen.has(item.id))
    throw Error(label+'の乗務IDが不正または重複しています');
   seen.set(item.id,item);
  }
  return seen;
 };
 const local=toMap(localShifts,'端末'),remote=toMap(serverShifts,'Firebase');
 const markers=toMap(markerStates,'削除マーカー');
 for(const item of markerStates){
  if(!['none','active','deleted'].includes(item.state))
   throw Error('削除マーカーの状態が不正です');
 }
 // Marker reads must cover ALL local IDs. A missing result is NOT absence.
 for(const id of local.keys())if(!markers.has(id))
  throw Error('端末日報の削除マーカー照合が不足しています');
 const result=[];
 for(const [id,shift] of local){
  const marker=markers.get(id),server=remote.get(id);
  let action,reason;
  if(marker.state==='deleted'){
   action='protect-local-copy';reason='サーバーで削除済み。旧端末から再登録しない';
   if(server)throw Error('削除マーカーとクラウド原本が矛盾しています：'+id);
  }else if(server){
   action=JSON.stringify(shift)===JSON.stringify(server)?'same':'review-difference';
   reason=action==='same'?'原本が一致':'内容の差があるため個別確認が必要';
  }else if(marker.state==='active'){
   action='review-missing-cloud';reason='復元履歴があるのにクラウド原本がありません';
  }else{
   action='candidate-new';reason='サーバー原本も削除マーカーもありません（移行確認は別途必要）';
  }
  result.push({id,action,reason,uploadAuthorized:false});
 }
 for(const [id] of remote)if(!local.has(id))
  result.push({id,action:'server-only',reason:'クラウドにだけ存在する原本',uploadAuthorized:false});
 return {uid,complete:true,entries:result,uploadAuthorized:false};
}
function create(){
 let context=null,epoch=0;
 function bind(user,options={}){
  epoch++;
  if(!user){context=null;return;}
  if(!user.uid||!options.f||!options.db||!options.auth)
   throw Error('本人のFirebase認証が必要です');
  if(options.readOnly===true)throw Error('読み取り専用接続ではゴミ箱を操作できません');
  context={uid:user.uid,f:options.f,db:options.db,auth:options.auth,
   session:options.session,epoch};
 }
 function checked(){
  const c=context;
  if(!c||c.auth.currentUser?.uid!==c.uid)
   throw Error('認証UIDが一致しないためゴミ箱を操作できません');
  return c;
 }
 function guard(c){
  if(context!==c||epoch!==c.epoch||c.auth.currentUser?.uid!==c.uid)
   throw Error('アカウントが切り替わりました。変更を停止しました');
 }
 function sessionId(c){
  const id=c.session?.sessionId?.();
  if(typeof id!=='string'||id.length<32||id.length>128)
   throw Error('有効な編集端末セッションがありません');
  return id;
 }
 function ref(c,section,id){
  if(!ID.test(String(id||'')))throw Error('乗務IDが不正です');
  return c.f.doc(c.db,'privateDuties',c.uid,section,id);
 }
 function revisionOf(data){
  const rev=data?.revision;
  if(!Number.isSafeInteger(rev)||rev<1)
   throw Error('原本の更新番号が不正です');
  return rev;
 }
 function getShift(row,id){
  const s=row?.shift;
  if(!s||s.id!==id||!Array.isArray(s.records)||s.records.length>60||
      !s.settings||typeof s.settings!=='object')
   throw Error('原本の形式を検証できません');
  return clone(s);
 }
 // A user explicitly selects ONE shift and confirms its ID and revision.
 // "deleted" marker and full encrypted-at-rest trash copy are created
 // transactionally with deleting the visible original.
 async function move({shiftId,expectedRevision,confirmed}={}){
  if(confirmed!==true)throw Error('削除対象の本人確認が必要です');
  const c=checked(),writerSessionId=sessionId(c),id=String(shiftId||'');
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
   throw Error('削除する原本の更新番号を照合できません');
  const originalRef=ref(c,'shifts',id),trashRef=ref(c,'trash',id),
    markerRef=ref(c,'tombstones',id);
  const result=await c.f.runTransaction(c.db,async tx=>{
   const [original,trash,marker]=await Promise.all([
    tx.get(originalRef),tx.get(trashRef),tx.get(markerRef)]);
   guard(c);
   if(sessionId(c)!==writerSessionId)throw Error('編集中の端末が変わりました');
   if(!original.exists())throw Error('指定された日報はクラウド上にありません');
   if(trash.exists())throw Error('同じIDの日報がすでにゴミ箱にあります');
   const row=original.data(),revision=revisionOf(row);
   if(row?.format!=='TAXIAPP_PRIVATE_SHIFT_V1')
    throw Error('原本の保存形式を確認できません');
   if(revision!==expectedRevision)
    throw Error('SYNC_CONFLICT:'+revision+':日報の版が変更されています');
   const shift=getShift(row,id);
   // This prototype refuses to trash a currently open duty. Its GPS,
   // pending ride and final settlement could otherwise be orphaned.
   if(!shift.endedAt&&!shift.endedIso)
    throw Error('未入庫の日報はゴミ箱に移せません。入庫・精算を先に確認してください');
   const prior=marker.exists()?marker.data():null;
   if(prior&&(prior.format!=='TAXIAPP_DUTY_TOMBSTONE_V1'||
      prior.state!=='active'||
      !Number.isSafeInteger(prior.generation)||prior.generation<1))

    throw Error('削除マーカーの更新番号が一致しません');
   const generation=prior?prior.generation+1:1;
   if(!Number.isSafeInteger(generation)||generation<1)
    throw Error('削除履歴が不正です');
   // Date is for proposed TTL / read-only UI. Security must rely on rules.
   const deletedAt=new Date(),expiresAt=new Date(deletedAt.getTime()+RETENTION_DAYS*DAY_MS);
   tx.set(trashRef,{
    format:'TAXIAPP_DUTY_TRASH_V1',shift,sourceRevision:revision,
    generation,writerSessionId,deletedAt:c.f.serverTimestamp(),expiresAt
   });
   tx.set(markerRef,{
    format:'TAXIAPP_DUTY_TOMBSTONE_V1',state:'deleted',
    generation,revision,writerSessionId,updatedAt:c.f.serverTimestamp()
   });
   tx.delete(originalRef);
   return {id,revision,generation,expiresAt:expiresAt.toISOString()};
  });
  guard(c);
  return result;
 }
 // Read the tombstone for EVERY requested local shift, including absent
 // tombstones; network/auth errors must abort the entire inspection.
 async function readDeletionMarkers(shiftIds){
  const c=checked();
  if(!Array.isArray(shiftIds)||shiftIds.length>60||
     new Set(shiftIds).size!==shiftIds.length)
   throw Error('照合する日報IDが不正です');
  const states=[];
  for(const id of shiftIds){
   const snap=await c.f.getDocFromServer(ref(c,'tombstones',id));
   guard(c);
   if(!snap.exists()){states.push({id,state:'none'});continue;}
   const marker=snap.data();
   if(marker?.format!=='TAXIAPP_DUTY_TOMBSTONE_V1'||
      !['active','deleted'].includes(marker.state)||
      !Number.isSafeInteger(marker.generation)||marker.generation<1)
    throw Error('サーバーの削除マーカーが不正です：'+id);
   states.push({id,state:marker.state,generation:marker.generation});
  }
  guard(c);
  return {uid:c.uid,markersComplete:true,markerStates:states};
 }
 async function list(){
  const c=checked();
  const snapshot=await c.f.getDocsFromServer(
   c.f.collection(c.db,'privateDuties',c.uid,'trash'));
  guard(c);
  return snapshot.docs.map(doc=>{
   const row=doc.data();
   if(row?.format!=='TAXIAPP_DUTY_TRASH_V1'||!ID.test(doc.id)||
      row?.shift?.id!==doc.id||!Number.isSafeInteger(row?.sourceRevision)||
      row.sourceRevision<1)
    throw Error('ゴミ箱のデータが不正です');
   return {id:doc.id,date:String(row.shift.date||''),
    recordCount:Array.isArray(row.shift.records)?row.shift.records.length:0,
    expiresAt:row.expiresAt?.toDate?.()?.toISOString?.()||
     (row.expiresAt instanceof Date?row.expiresAt.toISOString():String(row.expiresAt||'')),
    generation:row.generation};
  });
 }
 // Free-tier-first alternative to managed Firestore TTL: after expiry,
 // the authenticated current writer can initiate cleanup at next app visit.
 // NOT a guaranteed clock-time job. No background invocation is wired up.
 async function purgeExpired({max=20}={}){
  const c=checked(),writerSessionId=sessionId(c);
  if(!Number.isSafeInteger(max)||max<1||max>20)
   throw Error('一度に整理する件数が不正です');
  const listing=await c.f.getDocsFromServer(
   c.f.collection(c.db,'privateDuties',c.uid,'trash'));
  guard(c);
  const docs=listing.docs||[];
  if(!Array.isArray(docs)||docs.length>500)
   throw Error('ゴミ箱の件数が多いため、安全確認が必要です');
  let count=0;
  const purged=[];
  for(const doc of docs){
   guard(c);
   if(count>=max)break;
   const id=String(doc.id||'');
   const row=doc.data();
   if(row?.format!=='TAXIAPP_DUTY_TRASH_V1'||
      row.shift?.id!==id)throw Error('ゴミ箱に不正な原本があります');
   const due=row.expiresAt?.toDate?.()||
    (row.expiresAt instanceof Date?row.expiresAt:
     typeof row.expiresAt==='string'?new Date(row.expiresAt):null);
   if(!(due instanceof Date)||!Number.isFinite(due.getTime()))
    throw Error('ゴミ箱の保存期限が不正です');
   if(due>new Date())continue;
   const originalRef=ref(c,'shifts',id),trashRef=ref(c,'trash',id),
    markerRef=ref(c,'tombstones',id);
   const done=await c.f.runTransaction(c.db,async tx=>{
    const [original,trash,marker]=await Promise.all([
     tx.get(originalRef),tx.get(trashRef),tx.get(markerRef)]);
    guard(c);
    if(sessionId(c)!==writerSessionId)
     throw Error('編集中の端末が変わりました');
    if(original.exists())throw Error('日報が通常一覧に復活しているため整理を中止しました');
    if(!trash.exists()||!marker.exists())return false;
    const t=trash.data(),m=marker.data();
    if(t.format!=='TAXIAPP_DUTY_TRASH_V1'||
       m.format!=='TAXIAPP_DUTY_TOMBSTONE_V1'||
       m.state!=='deleted'||m.generation!==t.generation||
       m.revision!==t.sourceRevision||t.shift?.id!==id)
     throw Error('サーバーの削除履歴が一致しません');
    const expiry=t.expiresAt?.toDate?.()||
     (t.expiresAt instanceof Date?t.expiresAt:
      typeof t.expiresAt==='string'?new Date(t.expiresAt):null);
    if(!(expiry instanceof Date)||!Number.isFinite(expiry.getTime())||
       expiry>new Date())throw Error('まだ保管期間内の日報です');
    // Keep ONLY the tiny marker to prevent an offline old client from
    // resurrecting a discarded original. The full duty is deleted.
    tx.delete(trashRef);
    return true;
   });
   guard(c);
   if(done){count++;purged.push(id);}
  }
  return {purged,remainingNotChecked:Math.max(0,docs.length-purged.length-max)};
 }
 async function restore({shiftId,confirmed}={}){
  if(confirmed!==true)throw Error('復元対象の本人確認が必要です');
  const c=checked(),writerSessionId=sessionId(c),id=String(shiftId||'');
  const originalRef=ref(c,'shifts',id),trashRef=ref(c,'trash',id),
    markerRef=ref(c,'tombstones',id);
  const result=await c.f.runTransaction(c.db,async tx=>{
   const [original,trash,marker]=await Promise.all([
    tx.get(originalRef),tx.get(trashRef),tx.get(markerRef)]);
   guard(c);
   if(sessionId(c)!==writerSessionId)throw Error('編集中の端末が変わりました');
   if(original.exists())throw Error('同じIDの日報が存在します。上書きできません');
   if(!trash.exists()||!marker.exists())
    throw Error('ゴミ箱と削除履歴がそろっていません');
   const t=trash.data(),m=marker.data();
   if(t?.format!=='TAXIAPP_DUTY_TRASH_V1'||
      m?.format!=='TAXIAPP_DUTY_TOMBSTONE_V1'||
      m.state!=='deleted'||!Number.isSafeInteger(m.generation)||
      m.generation<1||
      t.generation!==m.generation||t.sourceRevision!==m.revision)
    throw Error('ゴミ箱の更新世代が一致しません');
   const shift=getShift(t,id);
   const due=t.expiresAt?.toDate?.()||
    (t.expiresAt instanceof Date?t.expiresAt:
     typeof t.expiresAt==='string'?new Date(t.expiresAt):null);
   if(!(due instanceof Date)||!Number.isFinite(due.getTime())||due<=new Date())
    throw Error('保管期限が終了しているため復元できません');
   const revision=m.revision+1;
   if(!Number.isSafeInteger(revision))
    throw Error('復元番号が上限を超えました');
   tx.set(originalRef,{
    format:'TAXIAPP_PRIVATE_SHIFT_V1',revision,shift,
    writerSessionId,updatedAt:c.f.serverTimestamp()
   });
   tx.set(markerRef,{
    format:'TAXIAPP_DUTY_TOMBSTONE_V1',state:'active',
    generation:m.generation,revision,writerSessionId,
    updatedAt:c.f.serverTimestamp()
   });
   tx.delete(trashRef);
   return {id,revision,generation:m.generation};
  });
  guard(c);
  return result;
 }
 return Object.freeze({bind,move,restore,list,readDeletionMarkers,purgeExpired});
}
root.TAXIAPP_DUTY_TRASH=Object.freeze({create,planReconciliation,RETENTION_DAYS});
})(typeof window!=='undefined'?window:globalThis);
