/**
 * TAXIAPP stage 6: ISOLATED print-only handoff draft. NOT DEPLOYED.
 *
 * This file is deliberately NOT referenced by Code.gs/doPost, index.html,
 * or any production deployment. It only appends a PRINT PROJECTION to the
 * explicit staging tab 'TAXIAPP_印刷ステージ_V1' in an isolated test workbook.
 *
 * Security is not established by sourceUid alone: a trusted future bridge
 * MUST validate Firebase ID token, administrator allow-list, source revision
 * and consent, then call these private functions under the same lock.
 * Do not add an externally callable endpoint without that security review.
 */
var TAXIAPP_PRINT_STAGE_TAB_V1 = 'TAXIAPP_印刷ステージ_V1';
var TAXIAPP_PRINT_STAGE_COLUMNS_V1 =
 ['乗務ID','Firestore更新番号','転送ID','派生データSHA256','印刷派生JSON','確認時刻'];
var TAXIAPP_PRINT_STAGE_ID_V1 = /^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;

function printStageIntegerV1_(value,label) {
 if(typeof value!=='number'||!isFinite(value)||Math.floor(value)!==value||value<0)
  throw Error(label+'が不正です');
 return value;
}
function printStageSafeTextV1_(value,label,max) {
 if(value===null||value===undefined)return '';
 if(typeof value!=='string'&&typeof value!=='number')throw Error(label+'の形式が不正です');
 var text=String(value);
 if(text.length>(max||500))throw Error(label+'が長すぎます');
 return text;
}
function printStagePriceV1_(value,label){
 var n=typeof value==='number'?value:
  (typeof value==='string'&&/^\d+$/.test(value)?Number(value):NaN);
 if(!Number.isSafeInteger(n)||n<0)throw Error(label+'が不正です');
 return n;
}
function printStageHashV1_(value) {
 if(typeof Utilities==='undefined'||!Utilities.computeDigest)
  throw Error('Apps Script SHA256が利用できません');
 var data=Utilities.computeDigest(
  Utilities.DigestAlgorithm.SHA_256,String(value),Utilities.Charset.UTF_8);
 return data.map(function(n){return ('0'+(n&255).toString(16)).slice(-2);}).join('');
}
/**
 * Build a print-only projection. No raw diary snapshots, GPS traces,
 * passengers' personal settings, or credentials are transferred.
 * The detailed rows use the SAME 14-column order as Code.gs savePacket_().
 */
function printStagePrepareV1_(request) {
 var uid=request&&request.sourceUid;
 if(typeof uid!=='string'||!uid.trim()||uid.length>128)
  throw Error('本人認証UIDが不正です');
 var revision=printStageIntegerV1_(request.sourceRevision,'Firestore更新番号');
 if(revision<1)throw Error('Firestore更新番号が不正です');
 var packet=request.packet,shift=packet&&packet.shift;
 if(!packet||packet.kind!=='TAXIAPP_SHIFT_V1'||!shift||
    typeof shift.id!=='string'||!TAXIAPP_PRINT_STAGE_ID_V1.test(shift.id))
  throw Error('乗務パケットの形式またはIDが不正です');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(shift.date||''))||
    (!shift.endedAt&&!shift.endedIso))
  throw Error('日付または入庫時刻が不正です');
 if(!Array.isArray(shift.records)||shift.records.length>60)
  throw Error('印刷可能な営業件数を超えています');
 var sum=packet.summary;
 if(!sum||typeof sum!=='object')throw Error('精算集計がありません');
 var keys=['meter','discount','goFee','uberSurcharge','cashRemittance',
  'etcRemittance','totalRemittance','cancellation','realToll','emptyToll'];
 var amounts={};
 keys.forEach(function(key){amounts[key]=printStageIntegerV1_(sum[key],key);});
 if(amounts.cancellation!==0)throw Error('キャンセル料は0円である必要があります');
 if(amounts.totalRemittance!==amounts.cashRemittance+amounts.etcRemittance)
  throw Error('納金金額が一致しません');
 var computedMeter=0,details=[];
 shift.records.forEach(function(record,index){
  if(!record||!record.raw||typeof record.raw!=='object'||
     record.status!=='complete'||['ride','cancel','empty'].indexOf(record.kind)<0)
   throw Error('未確定または不正な営業レコードがあります：'+(index+1));
  var raw=record.raw,meta=record.meta||{};
  var cancel=record.kind==='cancel';
  if(record.kind==='ride')computedMeter+=printStagePriceV1_(raw.K,'メーター金額');
  details.push([
   printStageSafeTextV1_(raw.A,'営業番号',60),
   printStageSafeTextV1_(raw.E,'配車区分',80),
   cancel?'キャンセル':printStageSafeTextV1_(raw.N,'支払表示',80),
   cancel?0:printStageSafeTextV1_(raw.K,'表示金額',80),
   cancel?printStageSafeTextV1_(meta.dispatchAt||raw.C,'発生時刻',120):
    printStageSafeTextV1_(raw.G,'乗車時刻',120),
   cancel?printStageSafeTextV1_(meta.cancelAt,'キャンセル時刻',120):
    printStageSafeTextV1_(raw.M,'降車時刻',120),
   printStageSafeTextV1_(raw.AL,'乗車地',500),
   printStageSafeTextV1_(raw.AM,'降車地',500),
   printStageSafeTextV1_(raw.AQ,'GO手数料',60),
   printStageSafeTextV1_(raw.W,'実車高速',60),
   printStageSafeTextV1_(raw.AI,'空車高速',60),
   printStageSafeTextV1_(raw.AR,'障がい者割引',60),
   printStageSafeTextV1_(meta.settledIso,'精算完了日時',120)
  ]);
 });
 if(computedMeter!==amounts.meter)
  throw Error('営業明細とメーター売上が一致しません');
 var projection={
  format:'TAXIAPP_PRINT_PROJECTION_V1',
  id:shift.id,sourceRevision:revision,date:shift.date,
  startedAt:printStageSafeTextV1_(shift.startedAt,'出庫時刻',120),
  endedAt:printStageSafeTextV1_(shift.endedAt,'入庫時刻',120),
  startedIso:printStageSafeTextV1_(shift.startedIso,'出庫ISO',120),
  endedIso:printStageSafeTextV1_(shift.endedIso,'入庫ISO',120),
  driver:printStageSafeTextV1_(shift.driver,'運転者',120),
  driverNo:printStageSafeTextV1_(shift.driverNo,'社員番号',80),
  vehicle:printStageSafeTextV1_(shift.vehicle,'車両',80),
  startingOdo:printStageSafeTextV1_(shift.startingOdo,'出庫km',80),
  endingOdo:printStageSafeTextV1_(shift.endingOdo,'入庫km',80),
  recordCount:details.length,amounts:amounts,printRows:details
 };
 var json=JSON.stringify(projection);
 // A single cell is written to keep each version append-only/atomic.
 // 30k is intentionally lower than the Google Sheets cell character limit.
 if(json.length>30000)throw Error('印刷用派生データのサイズが上限を超えています');
 var digest=printStageHashV1_(json);
 // UID stays off the print sheet; this does NOT authenticate a request.
 var transferId=printStageHashV1_([uid,shift.id,revision,digest].join('|'));
 return {id:shift.id,sourceUid:uid,revision:revision,transferId:transferId,
  digest:digest,projectionJson:json};
}
/**
 * Internal draft write target. A caller may supply ONLY a dedicated staging
 * tab object, and MUST pass a separately verified admin UID. No caller is
 * wired in the production Code.gs. Appends only one row per new revision.
 *
 * Note: ScriptLock must cover all calls. A failed append/readback is UNKNOWN,
 * never success; retry compares the deterministic transferId.
 */
function printStageAppendV1_(sheet,prepared,verifiedAdminUid) {
 if(!sheet||typeof sheet.getName!=='function'||
    sheet.getName()!==TAXIAPP_PRINT_STAGE_TAB_V1)
  throw Error('印刷専用ステージ以外には書き込めません');
 if(!prepared||typeof verifiedAdminUid!=='string'||
    !verifiedAdminUid||prepared.sourceUid!==verifiedAdminUid)
  throw Error('本人認証された管理者UIDと一致しません');
 if(typeof LockService==='undefined'||!LockService.getScriptLock)
  throw Error('排他ロックが利用できません');
 var lock=LockService.getScriptLock();
 if(!lock.tryLock(25000))throw Error('印刷ステージの排他ロックを取得できません');
 try{
  var width=TAXIAPP_PRINT_STAGE_COLUMNS_V1.length,last=sheet.getLastRow();
  if(last<1)throw Error('印刷ステージに見出しがありません');
  var header=sheet.getRange(1,1,1,width).getValues()[0];
  if(JSON.stringify(header)!==JSON.stringify(TAXIAPP_PRINT_STAGE_COLUMNS_V1))
   throw Error('印刷ステージの見出しが異なります');
  var rows=last>1?sheet.getRange(2,1,last-1,width).getValues():[];
  var sameId=rows.filter(function(row){return String(row[0])===prepared.id;});
  var identical=sameId.filter(function(row){return Number(row[1])===prepared.revision;});
  if(identical.length>1)throw Error('同一更新番号が重複しています');
  if(identical.length===1){
   if(identical[0][2]!==prepared.transferId||
      identical[0][3]!==prepared.digest||
      identical[0][4]!==prepared.projectionJson)
    throw Error('同じ更新番号に異なる印刷データが存在します');
   return {state:'already-staged',id:prepared.id,revision:prepared.revision};
  }
  var latest=sameId.reduce(function(max,row){
   var rev=Number(row[1]);
   if(!Number.isSafeInteger(rev)||rev<1)throw Error('過去の印刷版番号が不正です');
   return Math.max(max,rev);
  },0);
  if(latest>=prepared.revision)
   throw Error('古い更新番号を印刷ステージへ反映できません');
  var stamped=(typeof Utilities!=='undefined'&&Utilities.formatDate)?
   Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd HH:mm:ss'):
   new Date().toISOString();
  sheet.appendRow([prepared.id,prepared.revision,prepared.transferId,
   prepared.digest,prepared.projectionJson,stamped]);
  // Read back the written row; never claim success on a partial write.
  var wrote=sheet.getRange(last+1,1,1,width).getValues()[0];
  if(wrote[0]!==prepared.id||Number(wrote[1])!==prepared.revision||
     wrote[2]!==prepared.transferId||wrote[3]!==prepared.digest||
     wrote[4]!==prepared.projectionJson)
   throw Error('印刷ステージへ書いたデータを確認できません');
  return {state:'staged',id:prepared.id,revision:prepared.revision};
 }finally{lock.releaseLock();}
}
