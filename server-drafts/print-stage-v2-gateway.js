'use strict';
/**
 * Stage 8 V2 bridge prototype. NO HTTP server / Firebase Admin credentials /
 * Google API connector / production actions exist here.
 *
 * It reuses Stage7's strict injected token+admin+Firestore read gate, but
 * converts the validated original into the full V2 four-source projection.
 * All data come from trusted server reads, not a browser-supplied packet.
 */
const {createPrintStageBoundary}=require('./print-stage-secure-boundary.js');
const {projectTrustedPacket}=require('./print-stage-legacy-rows.js');
const {prepareV2,decodeV2}=require('./print-stage-v2.js');
const error=s=>{throw Error(s);};
function createStageV2Gateway(deps){
 if(!deps||typeof deps.appendV2!=='function'||typeof deps.readV2!=='function')
  error('印刷V2の信頼済み読み書きアダプターがありません');
 const boundary=createPrintStageBoundary({
  ...deps,
  // Stage 7's type-level required hooks are deliberately not allowed to
  // stage legacy V1 from this gateway.
  appendPrintStage:()=>error('旧印刷V1への直接保存は禁止です'),
  readLatestPrintStage:()=>error('旧印刷V1からの読戻しは禁止です'),
  preparePrintStage:async({sourceUid,sourceRevision,expectedStageRevision,packet})=>{
   const virtual=projectTrustedPacket({packet,sourceRevision});
   const v2=prepareV2({sourceUid,sourceRevision,
    expectedCommittedRevision:expectedStageRevision,virtual});
   return {...v2,expectedStageRevision};
  }
 });
 async function stage(request){
  const initial=await boundary.verifyAndPrepare(request);
  const {uid,prepared,shiftId,sourceRevision}=initial;
  // Validate typed schema and SHA locally BEFORE invoking trusted adapter.
  decodeV2(prepared,uid);
  const saved=await deps.appendV2(prepared,uid);
  if(!saved||!['staged','already-staged'].includes(saved.state)||
     saved.id!==shiftId||saved.revision!==sourceRevision||
     saved.printAuthorized===true)
   error('V2ステージ保存確認が不正です');
  const checked=await deps.readV2(shiftId,uid);
  if(!checked||checked.id!==shiftId||checked.revision!==sourceRevision||
     checked.transferId!==prepared.transferId||
     checked.digest!==prepared.digest||
     !checked.projection||
     JSON.stringify(checked.projection)!==prepared.chunks.join(''))
   error('V2確定版の読み戻し・SHA256が要求と一致しません');
  // Re-verify token, admin rights, source revision AND the content; a
  // changed/trashed duty after append must never become printable.
  const after=await boundary.verifyAndPrepare(request);
  if(after.uid!==uid||after.sourceRevision!==sourceRevision||
     after.prepared.digest!==prepared.digest||
     after.prepared.transferId!==prepared.transferId)
   error('V2確認中に管理者・日報原本が変更されました');
  return Object.freeze({state:'staged-needs-print-review',
   shiftId,sourceRevision,printAuthorized:false,
   cutoverAuthorized:false,legacySheetsTouched:false});
 }
 return Object.freeze({stage});
}
module.exports=Object.freeze({createStageV2Gateway});
