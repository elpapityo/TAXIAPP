/**
 * Stage 11 — READ-ONLY edited-duty reprint safety plan for EXISTING sheets.
 * Requires V2 stage history and a previously published print-only version.
 * No setValues(), clearContent(), appendRow(), sheet inserts, triggers or
 * paper printing are called. No production Code.gs/doPost integration.
 *
 * Crucial: existing sheet SUMIF/SUMIFS formulas aggregate ALL rows by shift
 * ID. Appending newer rows with the SAME ID would double-count sales.
 * A safe real update needs a separately approved backup/restore and pause of
 * printing. This preflight NEVER authorizes such an overwrite.
 */
function printV2ExistingReprintPlan_(ss,stageSheet,shiftId,verifiedUid,printedRevision){
 if(!Number.isSafeInteger(printedRevision)||printedRevision<1||
    typeof verifiedUid!=='string'||!verifiedUid||
    !TAXIAPP_PRINT_V2_ID.test(String(shiftId||'')))
  throw Error('再印刷する旧版番号・本人UID・乗務IDが不正です');
 if(!ss||typeof ss.getSheetByName!=='function')
  throw Error('既存の印刷用シートを確認できません');
 var legacy=ss.getSheetByName('TAXIAPP_同期原本');
 if(!legacy)throw Error('Google旧原本保護を確認できません');
 var count=Math.max(0,legacy.getLastRow()-1);
 if(count&&legacy.getRange(2,1,count,1).getValues().some(function(r){
  return String(r[0])===shiftId;
 }))throw Error('旧Google同期原本に同じIDがあり、再印刷による混在を禁止します');
 ['TAXIAPP_印刷操作','補助簿印刷用','補助簿印刷用_2頁'].forEach(function(name){
  if(!ss.getSheetByName(name))throw Error('既存の印刷用シートがありません：'+name);
 });
 var stageRows=printV2Rows_(stageSheet);
 var earlier=printV2ReadOne_(stageRows,shiftId,printedRevision,verifiedUid);
 var latest=printV2ReadLatestDraft_(stageSheet,shiftId,verifiedUid);
 if(!latest||latest.revision<printedRevision)
  throw Error('印刷V2の更新番号が旧版より前です');
 // Only explicitly versioned, immutable V2 stage history can anchor a
 // before-image; a guessed Google row set is never enough to overwrite.
 var old=earlier.projection,newest=latest.projection,actions=[];
 var hasAnyChange=false,requiresRowMove=false;
 TAXIAPP_PRINT_EXISTING_V2_NAMES.forEach(function(name){
  var sh=ss.getSheetByName(name),head=TAXIAPP_PRINT_EXISTING_V2_HEADERS[name];
  if(!sh||sh.getMaxColumns()<head.length||
     JSON.stringify(sh.getRange(1,1,1,head.length).getValues()[0])!==JSON.stringify(head)||
     JSON.stringify(old.headers?.[name])!==JSON.stringify(head)||
     JSON.stringify(newest.headers?.[name])!==JSON.stringify(head))
   throw Error('再印刷の元シート列構造が一致しません：'+name);
  var oldRows=old.rows?.[name],newRows=newest.rows?.[name];
  if(!Array.isArray(oldRows)||!Array.isArray(newRows))
   throw Error('印刷V2の過去版と最新版の両方に4シート分の行が必要です');
  var before=oldRows.map(function(row){
   if(!Array.isArray(row)||row.length!==head.length||row[0]!==shiftId)
    throw Error('印刷V2旧版の行データが不正です：'+name);
   return row.map(printV2ExistingDecodeCell_);
  });
  var after=newRows.map(function(row){
   if(!Array.isArray(row)||row.length!==head.length||row[0]!==shiftId)
    throw Error('印刷V2新版の行データが不正です：'+name);
   return row.map(printV2ExistingDecodeCell_);
  });
  var scan=Math.max(0,sh.getLastRow()-1);
  var live=scan?sh.getRange(2,1,scan,head.length).getValues():[];
  var positions=[];
  live.forEach(function(row,i){if(String(row[0])===shiftId)positions.push(i+2);});
  if(positions.length!==before.length||
     positions.some(function(rowNumber,j){
      return !printV2ExistingEqualRow_(live[rowNumber-2],before[j]);
     }))
   throw Error('印刷元データが確定済み旧版から変更されています：'+name);
  if(positions.length&&positions.some(function(n,i){
   return i&&n!==positions[0]+i;
  }))throw Error('印刷用行が連続していません：'+name);
  var formulas=positions.length?
   sh.getRange(positions[0],1,positions.length,head.length).getFormulas():[];
  if(formulas.some(function(r){return r.some(function(f){return Boolean(f);});}))
   throw Error('再印刷対象には既存数式が含まれるため更新できません：'+name);
  var changed=before.length!==after.length||
   before.some(function(r,i){return !printV2ExistingEqualRow_(r,after[i]);});
  var rowMove=before.length!==after.length;
  hasAnyChange=hasAnyChange||changed;requiresRowMove=requiresRowMove||rowMove;
  actions.push({name:name,start:positions.length?positions[0]:null,
   beforeCount:before.length,afterCount:after.length,changed,
   requiresRowMove:rowMove,
   // These snapshot rows MUST stay internal to the trusted server and must
   // never be logged or returned to a client/mobile app.
   beforeRows:before,afterRows:after});
 });
 return {id:shiftId,previousRevision:printedRevision,
  latestRevision:latest.revision,latestDigest:latest.digest,
  expectedPreviousDigest:earlier.digest,
  sheetActions:actions,hasAnyChange,requiresRowMove,
  status:latest.revision===printedRevision?'same-revision-checked':
   requiresRowMove?'needs-row-reallocation-review':
   'needs-maintenance-window-and-rollback',
  legacyOriginalUnchanged:true,selectorUnchanged:true,
  paperSheetsUnchanged:true,writeAuthorized:false,
  printAuthorized:false,cutoverAuthorized:false};
}
