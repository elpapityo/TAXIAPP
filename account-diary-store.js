/* TAXIAPP: private per-account duty originals in Firestore.
 * Administrator retains the legacy Sheets workflow until explicit cutover.
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
  // Administrators remain on their legacy backend unless a future,
  // separately approved cutover explicitly requests Firestore originals.
  // No UI caller currently passes storageBackend, so production is unchanged.
  if(options.storageBackend!==undefined&&
     !['legacy','firestore'].includes(options.storageBackend))
   throw Error('日報の保存先指定が不正です');
  if(!options.admin&&options.storageBackend==='legacy')
   throw Error('一般利用者は旧Google Sheetsの日報保存先を使用できません');
  const backend=options.admin&&options.storageBackend!=='firestore'?'legacy':'firestore';
  current={uid:user.uid,kind:backend==='firestore'?'member':'legacy',
   admin:options.admin===true,storageBackend:backend,
   readOnly:options.readOnly===true,
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
   // Event sync: fetch only the touched duty. Login and manual sync still
   // enumerate all of this user's own shifts.
   const ids=fields.shiftIds;
   let docs;
   if(Array.isArray(ids)){
    if(ids.length>60)throw Error('一度に照合する乗務が多すぎます');
    const unique=[...new Set(ids.map(String))];
    docs=await Promise.all(unique.map(async id=>{
     const row=await c.f.getDocFromServer(docRef(c,id));
     return row.exists()?{id,data:()=>row.data()}:null;
    }));
    docs=docs.filter(Boolean);
   }else{
    const snapshot=await c.f.getDocsFromServer(collectionRef(c));
    docs=snapshot.docs;
   }
   ownerCheck(c);
   const seen=new Set();
   return {shifts:docs.map(row=>{
    const data=row.data(),id=String(row.id||''),revision=Number(data?.revision);
    if(!ID.test(id)||seen.has(id)||data?.format!=='TAXIAPP_PRIVATE_SHIFT_V1'||
       !Number.isSafeInteger(revision)||revision<1||
       data?.shift?.id!==id)
     throw Error('保存されている乗務一覧が不正です（形式・ID・更新番号）。同期を停止しました');
    seen.add(id);
    return {id,revision,deleted:data?.trashed===true};
   })};
  }
  if(action==='syncGet'){
   const id=String(fields.shiftId||'');
   const snapshot=await c.f.getDocFromServer(docRef(c,id));
   ownerCheck(c);
   if(!snapshot.exists())throw Error('指定された乗務がクラウドにありません');
   const row=snapshot.data(),revision=Number(row?.revision);
   if(row?.format!=='TAXIAPP_PRIVATE_SHIFT_V1'||
      !Number.isSafeInteger(revision)||revision<1)
    throw Error('Firestore日報原本の形式または更新番号が不正です。受信を停止しました');
   if(row.trashed===true)throw Error('ゴミ箱内の日報です。復元してください');
   return {id,revision,shift:validate(row.shift,id)};
  }
  if(action==='syncPut'){
   if(c.readOnly)throw Error('照合用Firestore接続は読み取り専用のため日報を書き込めません');
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
    // The account may have changed while the server read was pending.
    ownerCheck(c);
    const revision=existing.exists()?Number(existing.data().revision):0;
    if(revision!==baseRevision)throw Error('SYNC_CONFLICT:'+revision);
    if(existing.exists()&&existing.data().trashed===true)throw Error('削除済み日報を上書きできません');
    // The Firestore rules additionally validate the active server session.
    tx.set(ref,{
     format:'TAXIAPP_PRIVATE_SHIFT_V1',revision:revision+1,
     shift,writerSessionId:sessionId,updatedAt:c.f.serverTimestamp()
    });
    return {id,revision:revision+1};
   });
   ownerCheck(c);
   // A successful transaction alone is not proof that the remote original
   // can be reopened. Keep the local working copy until server read-back.
   const confirmed=await c.f.getDocFromServer(ref);
   ownerCheck(c);
   if(!confirmed.exists())throw Error('Firestore保存後の原本を読み戻せません。端末の記録を保持してください');
   const saved=confirmed.data();
   if(saved?.format!=='TAXIAPP_PRIVATE_SHIFT_V1'||
      saved?.trashed===true||saved?.revision!==result.revision||
      JSON.stringify(saved?.shift)!==JSON.stringify(shift))
    throw Error('Firestore保存後の原本に差異があります。端末の記録を保持し、競合を確認してください');
   return {...result,confirmed:true};
  }
  if(action==='syncTrash'||action==='syncRestore'){
   if(c.readOnly)throw Error('閲覧端末では日報の削除状態を変更できません');
   const id=String(fields.shiftId||''),base=Number(fields.baseRevision);
   if(!Number.isSafeInteger(base)||base<1)throw Error('削除の基準版が不正です');
   const sessionId=c.session?.sessionId?.();
   if(typeof sessionId!=='string'||sessionId.length<32)
    throw Error('この端末に編集権がありません');
   const ref=docRef(c,id),trashed=action==='syncTrash';
   const result=await c.f.runTransaction(c.db,async tx=>{
    const previous=await tx.get(ref);
    ownerCheck(c);
    if(!previous.exists())throw Error('保存済み日報が見つかりません');
    const data=previous.data(),revision=Number(data.revision);
    if(revision!==base)throw Error('SYNC_CONFLICT:'+revision);
    if(Boolean(data.trashed)===trashed)return {id,revision,deleted:trashed};
    tx.set(ref,{...data,revision:revision+1,trashed,
      writerSessionId:sessionId,updatedAt:c.f.serverTimestamp()});
    return {id,revision:revision+1,deleted:trashed};
   });
   ownerCheck(c);return result;
  }
  throw Error('未対応の個人用日報操作です');
 }
 return Object.freeze({bind,kind,scope,ready,endpoint,request});
}
root.TAXIAPP_ACCOUNT_DIARY=Object.freeze({create,MAX_SHIFT_BYTES});
})(typeof window!=='undefined'?window:globalThis);
