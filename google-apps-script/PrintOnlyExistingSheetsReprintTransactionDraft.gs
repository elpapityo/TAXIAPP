/**
 * TAXIAPP — UNDEPLOYED stage-12 transactional reprint draft.
 *
 * This never runs from Code.gs/doPost. All real operations require a trusted
 * backend enforcing Firebase ID token + admin UID + active source revision,
 * plus an independently confirmed print maintenance window. A ScriptLock does
 * NOT stop a human printing the existing live Google Sheets during a write.
 *
 * The only writable existing cells are the SAME-COUNT, EXACT-MATCH print
 * sources for one V2-only shift. It never writes Google legacy originals,
 * B15/B17/C17, the two print pages, selectors' T/U formulas, or other IDs.
 * Recovery is based on two immutable staged revisions and an append-only
 * metadata journal. The journal contains no addresses, fares, or raw shifts.
 */
var TAXIAPP_PRINT_REPRINT_JOURNAL='TAXIAPP_印刷更新監査_V1';
var TAXIAPP_PRINT_REPRINT_HEADERS=[
 '乗務ID','元版','新版本','旧SHA256','新SHA256','転送ID','段階','記録時刻','検証符号'
];
function printV2ReprintJournalSheet_(journal){
 if(!journal||typeof journal.getName!=='function'||
    journal.getName()!==TAXIAPP_PRINT_REPRINT_JOURNAL)
  throw Error('再印刷の専用監査シートがありません');
 if(journal.getLastRow()<1||
    JSON.stringify(journal.getRange(1,1,1,9).getValues()[0])!==
    JSON.stringify(TAXIAPP_PRINT_REPRINT_HEADERS))
  throw Error('再印刷監査シートの見出しが一致しません');
}
function printV2ReprintJournalRows_(journal){
 var last=journal.getLastRow();
 return last<2?[]:journal.getRange(2,1,last-1,9).getValues();
}
function printV2ReprintHistory_(journal,id){
 var rows=printV2ReprintJournalRows_(journal).filter(function(row){
  return String(row[0])===id;
 });
 var active=null;
 rows.forEach(function(row){
  var status=String(row[6]||'');
  if(['BEGIN','COMMIT','ROLLED_BACK','RECOVERY_REQUIRED'].indexOf(status)<0)
   throw Error('再印刷監査の状態が不正です');
  if(!Number.isSafeInteger(Number(row[1]))||
     !Number.isSafeInteger(Number(row[2]))||Number(row[2])<=Number(row[1])||
     !/^[a-f0-9]{64}$/.test(String(row[3]))||
     !/^[a-f0-9]{64}$/.test(String(row[4])))
   throw Error('再印刷監査の元版・新版・SHAが不正です');
  var token=String(row[5]||'');
  if(!/^[a-f0-9]{64}$/.test(token))throw Error('再印刷監査の転送IDが不正です');
  var checksum=printV2Hash_([row[0],row[1],row[2],row[3],row[4],
   row[5],row[6]].join('|'));
  if(row[8]!==checksum)throw Error('再印刷監査のSHA256が不正です');
  if(status==='BEGIN'){
   if(active)throw Error('未解決の印刷更新が複数存在します');
   active={id:id,previous:Number(row[1]),next:Number(row[2]),
    previousDigest:String(row[3]),nextDigest:String(row[4]),token:token};
  }else{
   if(!active||active.previous!==Number(row[1])||
      active.next!==Number(row[2])||active.token!==token||
      active.previousDigest!==row[3]||active.nextDigest!==row[4])
    throw Error('再印刷監査履歴の段階が一致しません');
   active=null;
  }
 });
 return {active:active,rows:rows.length};
}
function printV2ReprintJournalAppend_(journal,entry,status){
 var stamp=(typeof Utilities!=='undefined'&&Utilities.formatDate)?
  Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd HH:mm:ss'):
  new Date().toISOString();
 var row=[entry.id,entry.previous,entry.next,entry.previousDigest,
  entry.nextDigest,entry.token,status,stamp,''];
 row[8]=printV2Hash_(row.slice(0,7).join('|'));
 var next=journal.getLastRow()+1;
 journal.appendRow(row);
 var written=journal.getRange(next,1,1,9).getValues()[0];
 if(JSON.stringify(written)!==JSON.stringify(row))
  throw Error('再印刷監査行の書込確認が取れません');
}
function printV2ReprintMakeEntry_(plan){
 if(!plan||!TAXIAPP_PRINT_V2_ID.test(String(plan.id||''))||
    !Number.isSafeInteger(plan.previousRevision)||
    !Number.isSafeInteger(plan.latestRevision)||
    plan.previousRevision<1||plan.latestRevision<=plan.previousRevision||
    !/^[a-f0-9]{64}$/.test(String(plan.expectedPreviousDigest||''))||
    !/^[a-f0-9]{64}$/.test(String(plan.latestDigest||'')))
  throw Error('再印刷の版とSHAが未確認です');
 var token=printV2Hash_([
  'TAXIAPP_REPRINT_TX_V1',plan.id,plan.previousRevision,
  plan.latestRevision,plan.expectedPreviousDigest,plan.latestDigest
 ].join('|'));
 return {id:plan.id,previous:plan.previousRevision,next:plan.latestRevision,
  previousDigest:plan.expectedPreviousDigest,nextDigest:plan.latestDigest,
  token:token};
}
function printV2ReprintVerify_(verifyActive,verifyMaintenance,uid,entry){
 if(typeof verifyActive!=='function'||typeof verifyMaintenance!=='function'||
    typeof uid!=='string'||!uid)
  throw Error('認証された管理者・印刷停止確認が必要です');
 // Trusted verifier checks Firebase active revision, delete marker and
 // source digest; maintenance verifier must ensure no HUMAN is printing.
 if(verifyMaintenance({uid:uid,id:entry.id,token:entry.token})!==true)
  throw Error('既存Google補助簿の印刷停止を保証できません');
 if(verifyActive({uid:uid,id:entry.id,revision:entry.next,
    digest:entry.nextDigest,token:entry.token})!==true)
  throw Error('Firestore原本の本人UID・現行版が一致しません');
}
function printV2ReprintCanWrite_(plan){
 if(plan.requiresRowMove)throw Error('営業・決済行数変更には隔離手順が必要です');
 if(plan.latestRevision<=plan.previousRevision)
  throw Error('更新対象となる新しい日報版がありません');
 if(!plan.hasAnyChange)
  throw Error('印刷対象に反映する変更がありません');
 for(var i=0;i<plan.sheetActions.length;i++){
  var action=plan.sheetActions[i];
  if(action.requiresRowMove||action.beforeCount!==action.afterCount||
     action.changed&&action.beforeCount<1)
   throw Error('行数・空データ変更を伴うため再印刷更新を禁止します');
 }
}
/**
 * Internal draft only. A crash before a COMMIT leaves a BEGIN, which blocks
 * any further publish until printV2ReprintRecoverDraft_ is run.
 */
function printV2ExistingReprintPublishDraft_(ss,stage,journal,
 id,verifiedUid,previousRevision,verifyActive,verifyMaintenance){
 printV2ReprintJournalSheet_(journal);
 if(typeof LockService==='undefined'||!LockService.getScriptLock)
  throw Error('再印刷の排他ロックがありません');
 var lock=LockService.getScriptLock();
 if(!lock.tryLock(25000))throw Error('再印刷排他ロックが取得できません');
 try{
  if(printV2ReprintHistory_(journal,id).active)
   throw Error('未復旧の再印刷があり、新しい操作はできません');
  var plan=printV2ExistingReprintPlan_(
   ss,stage,id,verifiedUid,previousRevision);
  printV2ReprintCanWrite_(plan);
  var entry=printV2ReprintMakeEntry_(plan);
  printV2ReprintVerify_(verifyActive,verifyMaintenance,verifiedUid,entry);
  // Do not allow the source print selector to silently switch to another
  // duty while the revision is being materialized.
  var operation=ss.getSheetByName('TAXIAPP_印刷操作');
  if(!operation)throw Error('印刷操作シートがありません');
  var selection=String(operation.getRange('C17').getDisplayValue()||'').trim();
  // Maintenance lock is human-admin controlled. C17 is checked but never
  // modified; even when this duty is selected, don't claim atomic printing.
  if(selection===id&&verifyMaintenance({uid:verifiedUid,
     id:id,token:entry.token,selected:true})!==true)
   throw Error('表示中の日報を安全に印刷停止できません');
  printV2ReprintJournalAppend_(journal,entry,'BEGIN');
  var mutated=[],writeError=null;
  try{
   for(var i=0;i<plan.sheetActions.length;i++){
    var action=plan.sheetActions[i];
    if(!action.changed)continue;
    printV2ReprintVerify_(verifyActive,verifyMaintenance,verifiedUid,entry);
    var sheet=ss.getSheetByName(action.name);
    var range=sheet.getRange(action.start,1,action.beforeCount,
     TAXIAPP_PRINT_EXISTING_V2_HEADERS[action.name].length);
    // Record intent BEFORE calling Sheets: Sheets can partially write
    // before throwing or timing out.
    mutated.push(action);
    range.setValues(action.afterRows);
    if(!range.getValues().every(function(row,j){
     return printV2ExistingEqualRow_(row,action.afterRows[j]);
    }))throw Error('新版データの書込確認ができません：'+action.name);
   }
   printV2ReprintVerify_(verifyActive,verifyMaintenance,verifiedUid,entry);
   printV2ReprintJournalAppend_(journal,entry,'COMMIT');
  }catch(err){writeError=err;}
  if(writeError){
   var failed=[];
   for(var j=mutated.length-1;j>=0;j--){
    var item=mutated[j],target=ss.getSheetByName(item.name).getRange(
     item.start,1,item.beforeCount,
     TAXIAPP_PRINT_EXISTING_V2_HEADERS[item.name].length);
    try{
     var current=target.getValues(),restore=false;
     for(var k=0;k<current.length;k++){
      if(printV2ExistingEqualRow_(current[k],item.beforeRows[k]))continue;
      if(!printV2ExistingEqualRow_(current[k],item.afterRows[k]))
       throw Error('同時変更された行は上書きできません');
      restore=true;
     }
     if(restore)target.setValues(item.beforeRows);
     if(!target.getValues().every(function(row,k){
      return printV2ExistingEqualRow_(row,item.beforeRows[k]);
     }))throw Error('旧版への復元を確認できません');
    }catch(rollbackError){failed.push(item.name);}
   }
   if(failed.length){
    try{printV2ReprintJournalAppend_(journal,entry,'RECOVERY_REQUIRED');}
    catch(e){}
    throw Error('RECOVERY_REQUIRED:再印刷の復旧が必要です。対象'+failed.join(','));
   }
   printV2ReprintJournalAppend_(journal,entry,'ROLLED_BACK');
   throw writeError;
  }
  return {state:'reprint-source-updated-needs-paper-review',
   id:plan.id,from:plan.previousRevision,to:plan.latestRevision,
   updatedSheets:mutated.map(function(a){return a.name;}),
   printAuthorized:false,cutoverAuthorized:false};
 }finally{lock.releaseLock();}
}
/**
 * Recovery is intentionally separate: an unattended job must NEVER decide
 * to delete/overwrite a customer's edited rows. It accepts only unchanged
 * expected old/new row content and refuses a third-party edit.
 * Requires independent trusted maintenance confirmation.
 */
function printV2ReprintRecoverDraft_(ss,stage,journal,id,uid,
 verifyActive,verifyMaintenance){
 printV2ReprintJournalSheet_(journal);
 if(typeof LockService==='undefined'||!LockService.getScriptLock)
  throw Error('再印刷復旧の排他ロックがありません');
 var lock=LockService.getScriptLock();
 if(!lock.tryLock(25000))throw Error('再印刷復旧の排他ロックを取得できません');
 try{
  var open=printV2ReprintHistory_(journal,id).active;
  if(!open)throw Error('復旧が必要な未確定の印刷更新はありません');
  printV2ReprintVerify_(verifyActive,verifyMaintenance,uid,open);
  var legacy=ss.getSheetByName('TAXIAPP_同期原本');
  if(!legacy)throw Error('旧Google原本保護を確認できません');
  var count=Math.max(0,legacy.getLastRow()-1);
  if(count&&legacy.getRange(2,1,count,1).getValues().some(function(row){
   return String(row[0])===id;
  }))throw Error('旧原本と同じIDがあり復旧操作を停止しました');
  var raw=printV2Rows_(stage);
  var prior=printV2ReadOne_(raw,id,open.previous,uid);
  var next=printV2ReadOne_(raw,id,open.next,uid);
  if(prior.digest!==open.previousDigest||next.digest!==open.nextDigest||
     open.token!==printV2ReprintMakeEntry_({
      id:id,previousRevision:open.previous,latestRevision:open.next,
      expectedPreviousDigest:prior.digest,latestDigest:next.digest
     }).token)throw Error('監査情報と確定V2原本が一致しません');
  var snapshots=[];
  TAXIAPP_PRINT_EXISTING_V2_NAMES.forEach(function(name){
   var sheet=ss.getSheetByName(name),header=TAXIAPP_PRINT_EXISTING_V2_HEADERS[name];
   if(!sheet||JSON.stringify(sheet.getRange(1,1,1,header.length).getValues()[0])!==
      JSON.stringify(header))throw Error('復旧先シートの構成が異なります');
   var a=prior.projection.rows?.[name],b=next.projection.rows?.[name];
   if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)
    throw Error('行数の異なる印刷原本は自動復旧できません');
   var before=a.map(function(row){return row.map(printV2ExistingDecodeCell_);});
   var after=b.map(function(row){return row.map(printV2ExistingDecodeCell_);});
   var last=Math.max(0,sheet.getLastRow()-1);
   var data=last?sheet.getRange(2,1,last,header.length).getValues():[];
   var positions=[];
   data.forEach(function(row,i){if(String(row[0])===id)positions.push(i+2);});
   if(positions.length!==before.length||
      positions.some(function(n,i){return i>0&&n!==positions[0]+i;}))
    throw Error('復旧対象の行数や配置が変更されています：'+name);
   if(positions.length){
    var first=positions[0],range=sheet.getRange(first,1,positions.length,header.length);
    if(range.getFormulas().some(function(row){return row.some(function(f){return !!f;})))
     throw Error('復旧対象に保護すべき数式があります');
    var values=range.getValues();
    for(var n=0;n<values.length;n++){
     if(!printV2ExistingEqualRow_(values[n],before[n])&&
        !printV2ExistingEqualRow_(values[n],after[n]))
      throw Error('印刷元が第三者によって変更されました：'+name);
    }
    snapshots.push({sheet:sheet,range:range,before:before});
   }
  });
  for(var k=0;k<snapshots.length;k++){
   var snap=snapshots[k],current=snap.range.getValues();
   if(!current.every(function(row,i){return printV2ExistingEqualRow_(row,snap.before[i]);})){
    snap.range.setValues(snap.before);
    if(!snap.range.getValues().every(function(row,i){
     return printV2ExistingEqualRow_(row,snap.before[i]);
    }))throw Error('RECOVERY_REQUIRED:復元の照合に失敗しました');
   }
  }
  printV2ReprintJournalAppend_(journal,open,'ROLLED_BACK');
  return {state:'recovered-to-previous-print-version',
   id:id,revision:open.previous,printAuthorized:false};
 }finally{lock.releaseLock();}
}
