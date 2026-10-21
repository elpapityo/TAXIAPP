/**
 * TAXIAPP stage 10 - UNDEPLOYED EXISTING-SHEET PRINT ADAPTER DRAFT.
 * Not referenced by the live Code.gs/doPost or the browser app.
 *
 * Intended destination is the FOUR EXISTING print-source sheets, retaining
 * their layout/formulas and B15/B17/C17. NEVER writes TAXIAPP_同期原本,
 * TAXIAPP_印刷操作 or either 補助簿 sheet.
 *
 * SECURITY: verifiedAdminUid and verifyActive are TRUSTED SERVER inputs,
 * never parameters from the public GAS doPost/shared key. Deployment of this
 * prototype without a backend validating Firebase signature+admin ACL+source
 * revision is prohibited. Existing Google-saved IDs cannot be converted here.
 */
var TAXIAPP_PRINT_EXISTING_V2_HEADERS={
 'TAXIAPP_印刷データ':['乗務ID','営業番号','配車区分','支払表示','表示金額','乗車時刻','降車時刻','乗車地','降車地','GO手数料確認','実車高速','空車高速','障がい者割引','精算完了日時'],
 'TAXIAPP_決済内訳':['乗務ID','営業番号','決済内訳番号','支払金種','支払金額','アプリ決済額','現金受取','高速料金','割引額','手数料','備考'],
 'TAXIAPP_集計':['乗務ID','種類','金額','計算根拠','更新日時'],
 'TAXIAPP_乗務一覧':['乗務ID','乗務日','出庫日時','入庫日時','運転者','社員番号','車両番号','営業件数','メーター売上','障がい者割引','GO手数料','Uber配車手数料','現金納金','ETC','総入金額','更新日時','転送状態','出庫km','入庫km']
};
var TAXIAPP_PRINT_EXISTING_V2_NAMES=[
 'TAXIAPP_印刷データ','TAXIAPP_決済内訳','TAXIAPP_集計','TAXIAPP_乗務一覧'
];
function printV2ExistingDecodeCell_(v){
 if(v&&typeof v==='object'&&!Array.isArray(v)&&
    Object.keys(v).length===1&&typeof v.__taxiappPrintDateUtc==='string'){
  var date=new Date(v.__taxiappPrintDateUtc);
  if(!Number.isFinite(date.getTime())||
     date.toISOString()!==v.__taxiappPrintDateUtc)throw Error('帳票日時の形式が不正です');
  return date;
 }
 if(typeof v==='string'){
  if(v.length>1000||/^[=+@]/.test(v))throw Error('印刷セルの文字列が不正です');
  return v;
 }
 if(typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean')return v;
 throw Error('印刷セルの型が不正です');
}
function printV2ExistingEqual_(a,b){
 if(Object.prototype.toString.call(a)==='[object Date]'||
    Object.prototype.toString.call(b)==='[object Date]'){
  return Object.prototype.toString.call(a)==='[object Date]'&&
   Object.prototype.toString.call(b)==='[object Date]'&&
   a.getTime()===b.getTime();
 }
 return a===b;
}
function printV2ExistingEqualRow_(a,b){
 return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&
  a.every(function(v,j){return printV2ExistingEqual_(v,b[j]);});
}
function printV2ExistingPlan_(ss,stageSheet,shiftId,verifiedAdminUid){
 if(!ss||typeof ss.getSheetByName!=='function'||!stageSheet||
    !TAXIAPP_PRINT_V2_ID.test(String(shiftId||''))||
    typeof verifiedAdminUid!=='string'||!verifiedAdminUid)
  throw Error('印刷元・管理者UID・乗務IDの確認に失敗しました');
 var staged=printV2ReadLatestDraft_(stageSheet,shiftId,verifiedAdminUid);
 if(!staged||staged.id!==shiftId||!staged.projection||
    staged.projection.format!=='TAXIAPP_PRINT_STAGE_V2')
  throw Error('確定済みV2印刷原本がありません');
 // Strict legacy original protection; no cross-generation same-ID rewrites.
 var originals=ss.getSheetByName('TAXIAPP_同期原本');
 if(!originals)throw Error('旧Google原本保護の確認ができません');
 var originalCount=Math.max(0,originals.getLastRow()-1);
 if(originalCount){
  var saved=originals.getRange(2,1,originalCount,1).getValues();
  if(saved.some(function(r){return String(r[0])===shiftId;}))
   throw Error('旧Google原本に同じ乗務IDが存在するため印刷専用の更新を拒否しました');
 }
 // Guard that the existing operation and paper-print sheets are PRESENT,
 // but never touch their values, formulas, layout, widths or merge ranges.
 ['TAXIAPP_印刷操作','補助簿印刷用','補助簿印刷用_2頁'].forEach(function(name){
  if(!ss.getSheetByName(name))throw Error('既存の印刷シートがありません：'+name);
 });
 var projection=staged.projection,output=[],needsWrite=0;
 if(!projection.rows||Object.keys(projection.rows).length!==4)
  throw Error('印刷の4シート分のデータがそろっていません');
 TAXIAPP_PRINT_EXISTING_V2_NAMES.forEach(function(name){
  var sheet=ss.getSheetByName(name),columns=TAXIAPP_PRINT_EXISTING_V2_HEADERS[name];
  if(!sheet||sheet.getMaxColumns()<columns.length)
   throw Error('既存の印刷元シートの列が不足しています：'+name);
  var header=sheet.getRange(1,1,1,columns.length).getValues()[0];
  if(JSON.stringify(header)!==JSON.stringify(columns)||
     JSON.stringify(projection.headers?.[name])!==JSON.stringify(columns))
   throw Error('印刷元シートの列構造が異なります：'+name);
  var input=projection.rows[name];
  if(!Array.isArray(input)||
     (name==='TAXIAPP_乗務一覧'&&input.length!==1)||
     (name==='TAXIAPP_印刷データ'&&input.length>60)||
     (name==='TAXIAPP_決済内訳'&&input.length>1200)||
     (name==='TAXIAPP_集計'&&input.length!==14))
   throw Error('印刷行数が不正です：'+name);
  var wanted=input.map(function(row){
   if(!Array.isArray(row)||row.length!==columns.length||row[0]!==shiftId)
    throw Error('印刷の列数または乗務IDが違います：'+name);
   return row.map(printV2ExistingDecodeCell_);
  });
  var scan=Math.max(0,sheet.getLastRow()-1);
  var existing=scan?sheet.getRange(2,1,scan,columns.length).getValues():[];
  var matching=existing.filter(function(r){return String(r[0])===shiftId;});
  var targetPosition=existing.reduce(function(last,row,i){
   // Never reuse an occupied/unidentified row.
   return row.some(function(v){return v!==''&&v!==null;})?i+1:last;
  },0);
  if(matching.length>0){
   if(matching.length!==wanted.length||
      !matching.every(function(r,i){return printV2ExistingEqualRow_(r,wanted[i]);}))
    throw Error('同じ乗務IDの印刷元データが存在し、版または内容が異なります：'+name);
   output.push({name:name,mode:'already',count:wanted.length,position:null,rows:[]});
   return;
  }
  // No append is needed for a legitimate zero-payment sheet.
  if(!wanted.length){
   output.push({name:name,mode:'already',count:0,position:null,rows:[]});return;
  }
  var next=targetPosition+2,lastNeeded=next+wanted.length-1;
  if(lastNeeded>sheet.getMaxRows()||lastNeeded>1200)
   throw Error('印刷元シートに空き行がありません：'+name);
  var blank=sheet.getRange(next,1,wanted.length,columns.length);
  var old=blank.getValues();
  var formulas=blank.getFormulas();
  if(old.some(function(row){return row.some(function(v){return v!==''&&v!==null;});})||
     formulas.some(function(row){return row.some(function(f){return Boolean(f);});}))
   throw Error('印刷元シートの転送先が空白ではありません：'+name);
  output.push({name:name,mode:'append',position:next,count:wanted.length,rows:wanted});
  needsWrite++;
 });
 return {id:shiftId,revision:staged.revision,digest:staged.digest,
  transferId:staged.transferId,actions:output,needsWrite:needsWrite,
  sourceOriginalUnchanged:true,selectorUnchanged:true,paperPrintSheetsUnchanged:true,
  writeAuthorized:false,printAuthorized:false};
}
/**
 * Trusted-only internal draft. Must be invoked with verifyActive, which
 * checks authenticated ownership, admin rights and Firestore revision
 * both BEFORE and AFTER the dedicated Sheets updates. Never wire this to
 * the old shared-key-only doPost.
 */
function printV2ExistingPublishDraft_(ss,stageSheet,id,verifiedAdminUid,verifyActive){
 if(typeof verifyActive!=='function')
  throw Error('本人Firestore原本の最新状態を検証できません');
 if(typeof LockService==='undefined'||!LockService.getScriptLock)
  throw Error('印刷専用転送の排他ロックがありません');
 var lock=LockService.getScriptLock();
 if(!lock.tryLock(25000))throw Error('印刷専用転送の排他ロック取得に失敗しました');
 try{
  var plan=printV2ExistingPlan_(ss,stageSheet,id,verifiedAdminUid);
  // Auth and Firestore source are verified by a TRUSTED callback, not
  // by trusting the UID supplied by the browser.
  var verified=verifyActive({uid:verifiedAdminUid,id:id,revision:plan.revision,
   digest:plan.digest,transferId:plan.transferId});
  if(verified!==true)throw Error('本人Firestore原本の更新番号の確認に失敗しました');
  // Complete detail/payment/aggregate before making the shift selectable.
  var pendingIndex=null;
  plan.actions.forEach(function(action){
   if(action.mode!=='append')return;
   if(action.name==='TAXIAPP_乗務一覧'){
    if(verifyActive({uid:verifiedAdminUid,id:id,revision:plan.revision,
       digest:plan.digest,transferId:plan.transferId})!==true)
     throw Error('一覧へ公開する前にFirestore原本が更新されました');
   }
   var target=ss.getSheetByName(action.name).getRange(
    action.position,1,action.count,TAXIAPP_PRINT_EXISTING_V2_HEADERS[action.name].length);
   target.setValues(action.rows);
   if(action.name==='TAXIAPP_乗務一覧')pendingIndex=target;
   var actual=target.getValues();
   if(!actual.every(function(r,i){return printV2ExistingEqualRow_(r,action.rows[i]);}))
    throw Error('印刷元シートの書込照合に失敗しました：'+action.name);
  });
  // If the Firestore source changes immediately after the index update,
  // unpublish ONLY the newly inserted A:S index cells, never any legacy row.
  try{
   if(verifyActive({uid:verifiedAdminUid,id:id,revision:plan.revision,
      digest:plan.digest,transferId:plan.transferId})!==true)
    throw Error('印刷データ転送中に本人Firestore原本が更新されました');
  }catch(checkFailure){
   if(pendingIndex){
    try{
     pendingIndex.clearContent();
     if(pendingIndex.getValues().some(function(row){
      return row.some(function(value){return value!==''&&value!==null;});
     }))throw Error('差し戻し後の乗務一覧にデータが残っています');
    }catch(restoreError){
     throw Error('ROLLBACK_REQUIRED:印刷一覧の差し戻しに失敗しました。'+
      String(restoreError&&restoreError.message||restoreError));
    }
   }
   throw checkFailure;
  }
  return {state:'print-source-staged-review-required',id:id,revision:plan.revision,
   changedSheets:plan.actions.filter(function(a){return a.mode==='append';}).map(function(a){return a.name;}),
   printAuthorized:false,cutoverAuthorized:false};
 }finally{lock.releaseLock();}
}
