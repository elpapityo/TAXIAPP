/* TAXIAPP: private per-account duty originals in Firestore.
 * Legacy owner/administrator keeps the existing Google Sheets workflow.
 * Ordinary drivers never receive the legacy Sheets endpoint or access key.
 * No implicit adoption of another account's local data.
 */
(function(root){
'use strict';
const MAX_SHIFT_BYTES=850000, ID=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
function create(){
 let current=null,revisionEpoch=0;
 const kind=()=>current?.kind||'pending';
 function bind(user,options={}){
  revisionEpoch++;
  if(!user){current=null;return;}
  if(!user.uid||!options.f||!options.db||!options.auth)throw Error('アカウント認証が未完了です');
  current={uid:user.uid,kind:options.admin?'legacy':'member',
   f:options.f,db:options.db,auth:options.auth,session:options.session};
 }
 function ready(){
  return kind()==='member'&&current.auth?.currentUser?.uid===current.uid;
 }
 function scope(){
  return {kind:kind(),uid:current?.uid||'',epoch:revisionEpoch};
 }
 function endpoint(){
  return ready()?'firestore-duties://'+current.uid:'';
 }
 function checked(){
  if(!ready())throw Error('この利用者の営業データを取得できません。ログインを確認してください');
  return current;
 }
 function collectionRef(c){
  return c.f.collection(c.db,'privateDuties',c.uid,'shifts');
 }
 function docRef(c,id){
  if(!ID.test(String(id||'')))throw Error('乗務IDが不正です');
  return c.f.doc(c.db,'privateDuties',c.uid,'shifts',id);
 }
 function ownerCheck(c){
  if(current!==c||c.auth.currentUser?.uid!==c.uid)throw Error('ログイン利用者が変更されました。処理を停止しました');
 }
 function validate(shift,id){
  if(!shift||typeof shift!=='object'||shift.id!==id||
     !Array.isArray(shift.records)||shift.records.length>60||
     !shift.settings||typeof shift.settings!=='object')
   throw Error('保存する乗務の形式が不正です');
  const bytes=new TextEncoder().encode(JSON.stringify(shift)).length;
  if(bytes>MAX_SHIFT_BYTES)throw Error('乗務データが大きすぎます。GPS履歴等の保存形式を確認してください');
  return JSON.parse(JSON.stringify(shift));
 }
 async function request(action,fields={}){
  const c=checked();
  if(action==='syncList'){
   // Server read, not stale Firestore offline cache.
   const snapshot=await c.f.getDocsFromServer(collectionRef(c));
   ownerCheck(c);
   return {shifts:snapshot.docs.map(row=>{
    const data=row.data(),id=row.id,revision=Number(data?.revision);
    if(!ID.test(id)||!Number.isSafeInteger(revision)||revision<1)
     throw Error('保存されている乗務一覧が不正です');
    return {id,revision};
   })};
  }
  if(action==='syncGet'){
   const id=String(fields.shiftId||'');
   const snapshot=await c.f.getDocFromServer(docRef(c,id));
   ownerCheck(c);
   if(!snapshot.exists())throw Error('指定された乗務がGoogle側にありません');
   const row=snapshot.data(),revision=Number(row.revision);
   return {id,revision,shift:validate(row.shift,id)};
  }
  if(action==='syncPut'){
   const parsed=JSON.parse(String(fields.payload||'null'));
   if(parsed?.kind!=='TAXIAPP_SHIFT_V1')throw Error('乗務データの種類が不正です');
   const id=String(parsed?.shift?.id||''),shift=validate(parsed.shift,id);
   const baseRevision=Number(fields.baseRevision);
   if(!Number.isSafeInteger(baseRevision)||baseRevision<0)throw Error('同期の基準番号が不正です');
   const sessionId=c.session?.sessionId?.();
   if(typeof sessionId!=='string'||sessionId.length<32)
    throw Error('この端末に編集権がありません');
   const ref=docRef(c,id);
   const result=await c.f.runTransaction(c.db,async tx=>{
    const existing=await tx.get(ref);
    const revision=existing.exists()?Number(existing.data().revision):0;
    if(revision!==baseRevision)throw Error('SYNC_CONFLICT:'+revision);
    // The Firestore rules additionally validate the active server session.
    tx.set(ref,{
     format:'TAXIAPP_PRIVATE_SHIFT_V1',revision:revision+1,
     shift,writerSessionId:sessionId,updatedAt:c.f.serverTimestamp()
    });
    return {id,revision:revision+1};
   });
   ownerCheck(c);
   return result;
  }
  throw Error('未対応の個人用日報操作です');
 }
 return Object.freeze({bind,kind,scope,ready,endpoint,request});
}
root.TAXIAPP_ACCOUNT_DIARY=Object.freeze({create,MAX_SHIFT_BYTES});
})(typeof window!=='undefined'?window:globalThis);
