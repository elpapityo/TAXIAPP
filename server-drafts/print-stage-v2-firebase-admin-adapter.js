'use strict';
/**
 * Firebase Admin read-only adapter for the staged V2 gateway.
 * NO admin initializeApp(), HTTP endpoint, secrets, service account or deploy.
 * It accepts an ALREADY INITIALIZED trusted Firebase Admin SDK instance.
 *
 * This is a dependency boundary, not a deployed Firebase authenticator.
 * The production environment must supply approved credentials, authentic
 * Firebase Admin Auth and transactional Firestore access separately.
 */
const {createStageV2Gateway}=require('./print-stage-v2-gateway.js');
const ID=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
function createFirebaseAdminV2ReadOnlyAdapter({
 adminAuth,firestore,projectId,makeLegacyPrintPacket,
 appendV2,readV2,nowSeconds=()=>Math.floor(Date.now()/1000)
}={}){
 if(!adminAuth||typeof adminAuth.verifyIdToken!=='function'||
    !firestore||typeof firestore.collection!=='function'||
    typeof firestore.runTransaction!=='function')
  throw Error('信頼済みFirebase Admin認証とFirestoreトランザクションがありません');
 if(typeof projectId!=='string'||!projectId||
    typeof makeLegacyPrintPacket!=='function'||
    typeof appendV2!=='function'||typeof readV2!=='function')
  throw Error('信頼済みV2接続先または印刷計算が未設定です');
 const isAuthorizedAdmin=async uid=>{
  if(typeof uid!=='string'||!uid||uid.length>128)throw Error('本人UIDが不正です');
  const doc=await firestore.collection('admins').doc(uid).get();
  return Boolean(doc.exists&&doc.data()?.enabled===true);
 };
 const readFirestoreDuty=async({uid,shiftId})=>{
  if(typeof uid!=='string'||!uid||uid.length>128||
     typeof shiftId!=='string'||!ID.test(shiftId))
   throw Error('Firestoreの本人UIDまたは乗務IDが不正です');
  const root=firestore.collection('privateDuties').doc(uid);
  const originalRef=root.collection('shifts').doc(shiftId);
  const tombRef=root.collection('tombstones').doc(shiftId);
  // Single consistent read of the original and authoritative deletion marker.
  // A missing marker is UNKNOWN, never automatically interpreted as active.
  return firestore.runTransaction(async tx=>{
   const source=await tx.get(originalRef);
   const tomb=await tx.get(tombRef);
   if(!source.exists||!tomb.exists)
    throw Error('Firestore原本または削除履歴が未確認です');
   const d=source.data(),marker=tomb.data();
   if(d?.format!=='TAXIAPP_PRIVATE_SHIFT_V1'||
      !Number.isSafeInteger(d.revision)||d.revision<1||
      d.shift?.id!==shiftId||!Array.isArray(d.shift?.records)||
      d.shift.records.length>60||
      !d.shift.settings||typeof d.shift.settings!=='object')
    throw Error('Firestore本人原本の形式が不正です');
   if(marker?.format!=='TAXIAPP_DUTY_TOMBSTONE_V1'||
      marker.state!=='active'||marker.revision!==d.revision||
      !Number.isSafeInteger(marker.generation)||marker.generation<1)
    throw Error('Firestoreの削除履歴は有効な原本を確認できません');
   return {uid,shiftId,revision:d.revision,shift:d.shift,
    deleted:false,tombstoneState:'active'};
  });
 };
 const gate=createStageV2Gateway({
  projectId,nowSeconds,
  verifyIdToken:(token,opts)=>{
   if(!opts?.checkRevoked)
    throw Error('Firebaseの認証失効検証が無効です');
   // Firebase Admin SDK supports checkRevoked as positional boolean.
   return adminAuth.verifyIdToken(token,true);
  },
  isAuthorizedAdmin,readFirestoreDuty,
  // The caller must supply a trusted, previously confirmed packet.
  // Do not add another server-side fare calculation engine here.
  makeLegacyPrintPacket,appendV2,readV2
 });
 return Object.freeze({stage:gate.stage});
}
module.exports=Object.freeze({createFirebaseAdminV2ReadOnlyAdapter});
