'use strict';
/**
 * TAXIAPP stage 7: trusted, dependency-injected server boundary DRAFT.
 * No HTTP handler, credentials, Firebase Admin connection, or GAS deployment.
 * The injected verifyIdToken implementation MUST cryptographically verify
 * Firebase ID tokens with revocation checking (Firebase Admin SDK or equivalent).
 * Never substitute JWT decoding, client claims, shared GAS key or sourceUid.
 */
const ID=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
const REQ_KEYS=new Set(['idToken','shiftId','sourceRevision','expectedStageRevision']);
function error(message){throw Error(message);}
function integer(value,min,label){
 if(!Number.isSafeInteger(value)||value<min)error(label+'が不正です');
 return value;
}
function signature(x){
 return JSON.stringify(x,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
}
function createPrintStageBoundary(deps){
 if(!deps||typeof deps.projectId!=='string'||!/^[a-z0-9][a-z0-9-]{4,62}$/.test(deps.projectId))
  error('信頼済みFirebaseプロジェクトIDが未設定です');
 for(const key of ['verifyIdToken','isAuthorizedAdmin','readFirestoreDuty',
  'makeLegacyPrintPacket','preparePrintStage','appendPrintStage','readLatestPrintStage']){
  if(typeof deps[key]!=='function')error('必須の検証済みサーバー実装が未接続です：'+key);
 }
 if(typeof deps.nowSeconds!=='function')error('信頼済みサーバー時刻が必要です');
 const issuer='https://securetoken.google.com/'+deps.projectId;
 const checkedClaims=async token=>{
  if(typeof token!=='string'||!token||token.length>10000)error('Firebase IDトークンがありません');
  // verifyIdToken MUST reject invalid signatures and revoked sessions.
  const claim=await deps.verifyIdToken(token,{checkRevoked:true});
  const now=deps.nowSeconds();
  if(!Number.isSafeInteger(now)||now<1000000000||
     !claim||typeof claim!=='object'||
     typeof claim.sub!=='string'||!claim.sub||claim.sub.length>128||
     claim.aud!==deps.projectId||claim.iss!==issuer||
     !Number.isSafeInteger(claim.iat)||claim.iat>now+30||
     !Number.isSafeInteger(claim.exp)||claim.exp<=now||
     !Number.isSafeInteger(claim.auth_time)||claim.auth_time>now+30||
     claim.auth_time>claim.iat||claim.iat>=claim.exp||
     (claim.uid!==undefined&&claim.uid!==claim.sub))
   error('署名検証済みFirebase認証情報のUID・有効期限・発行元が不正です');
  const allowed=await deps.isAuthorizedAdmin(claim.sub);
  if(allowed!==true)error('印刷権限を持つ管理者ではありません');
  return claim.sub;
 };
 const read=async(uid,shiftId,expectedRev)=>{
  const result=await deps.readFirestoreDuty({uid,shiftId});
  if(!result||result.uid!==uid||!result.shift||result.shift.id!==shiftId||
     result.tombstoneState!=='active'||result.deleted===true||
     !Number.isSafeInteger(result.revision)||result.revision<1)
   error('本人Firestore日報の現行原本・削除状態を検証できません');
  if(result.revision!==expectedRev)
   error('Firestoreの更新番号が要求と一致しません');
  return result;
 };
 async function verifyAndPrepare(request){
  if(!request||typeof request!=='object'||Array.isArray(request)||
     Object.keys(request).some(k=>!REQ_KEYS.has(k)))
   error('印刷リクエストに未対応の項目があります');
  if(typeof request.shiftId!=='string'||!ID.test(request.shiftId))
   error('乗務IDが不正です');
  integer(request.sourceRevision,1,'Firestore更新番号');
  integer(request.expectedStageRevision,0,'ステージ期待版');
  const uid=await checkedClaims(request.idToken);
  const original=await read(uid,request.shiftId,request.sourceRevision);
  const before=signature(original.shift);
  // Packet must be built from a trusted Firestore read, not client-supplied
  // summary/ride values. Existing browser googleShiftPacket is NOT a server.
  const packet=await deps.makeLegacyPrintPacket(
   JSON.parse(JSON.stringify(original.shift)));
  if(before!==signature(original.shift))
   error('印刷計算がFirestore原本を変更しました');
  if(!packet||packet.kind!=='TAXIAPP_SHIFT_V1'||
     packet.shift?.id!==request.shiftId)
   error('印刷派生パケットの形式が不正です');
  const prepared=await deps.preparePrintStage({
   sourceUid:uid,sourceRevision:request.sourceRevision,
   expectedStageRevision:request.expectedStageRevision,packet});
  if(!prepared||prepared.id!==request.shiftId||
     prepared.sourceUid!==uid||prepared.revision!==request.sourceRevision||
     prepared.expectedStageRevision!==request.expectedStageRevision)
   error('印刷ステージの識別子と要求内容が一致しません');
  const after=await read(uid,request.shiftId,request.sourceRevision);
  if(signature(after.shift)!==before)
   error('Firestore原本が受け渡し中に変更されました');
  return {uid,prepared,sourceRevision:request.sourceRevision,
   shiftId:request.shiftId};
 }
 async function stage(request){
  const plan=await verifyAndPrepare(request);
  // The append adapter is a TRUSTED internal function. Never make
  // verifiedAdminUid a client-provided argument.
  const saved=await deps.appendPrintStage(plan.prepared,plan.uid);
  if(!saved||!['staged','already-staged'].includes(saved.state)||
     saved.id!==plan.shiftId||saved.revision!==plan.sourceRevision)
   error('印刷専用ステージの保存確認を取得できません');
  const stageRead=await deps.readLatestPrintStage(plan.shiftId,plan.uid);
  if(!stageRead||stageRead.id!==plan.shiftId||
     stageRead.revision!==plan.sourceRevision||
     stageRead.projection?.sourceRevision!==plan.sourceRevision||
     signature(stageRead.projection)!==signature(JSON.parse(plan.prepared.projectionJson)))
   error('印刷ステージの読み戻しが古いか、転送内容と不一致です');
  // A concurrent edit after append invalidates print usability.
  // Keep the immutable staged snapshot as an audit trail; DO NOT print.
  await read(plan.uid,plan.shiftId,plan.sourceRevision);
  return Object.freeze({state:'staged-needs-print-review',
   shiftId:plan.shiftId,sourceRevision:plan.sourceRevision,
   printAuthorized:false,cutoverAuthorized:false});
 }
 return Object.freeze({stage,verifyAndPrepare});
}
module.exports=Object.freeze({createPrintStageBoundary});
