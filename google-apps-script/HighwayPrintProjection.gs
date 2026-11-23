var TAXIAPP_HIGHWAY_PRINT_SHEET='TAXIAPP_高速印刷データ';
var TAXIAPP_HIGHWAY_PRINT_HEADERS=['乗務ID','行区分','日報№','走行区分','高速道路名','入口IC','出口IC',
 '区間距離km','除外距離km','料金円','総走行距離km','距離未確定件数'];

// Runs inside the existing transfer lock. Only rows for this duty are touched.
// The visible sheet requires a published summary row before showing any details.
function stageHighwayPrint_(ss,shift){
 var sheet=ss.getSheetByName(TAXIAPP_HIGHWAY_PRINT_SHEET);
 if(!sheet)return null;
 var width=TAXIAPP_HIGHWAY_PRINT_HEADERS.length,lastRow=sheet.getLastRow();
 if(sheet.getMaxColumns()<width||sheet.getMaxRows()<2||
    JSON.stringify(sheet.getRange(1,1,1,width).getValues()[0])!==JSON.stringify(TAXIAPP_HIGHWAY_PRINT_HEADERS))
  throw Error('高速明細の転送元シートの見出しを確認してください');
 var id=shift.id,existing=[];
 if(lastRow>1){
  var used=sheet.getRange(2,1,lastRow-1,width);
  var forms=used.getFormulas();
  used.getValues().forEach(function(row,index){
   if(row[0]!==id)return;
   if(forms[index].some(Boolean))throw Error('選択した乗務の高速明細に数式があり、転送を停止しました');
   existing.push({row:index+2,summary:row[1]==='乗務'});
  });
 }
 var finished=Boolean(shift.endedAt||shift.endedIso);
 if(!finished&&!existing.length)return null;
 var report=finished?globalThis.TAXIAPP_HIGHWAY_REPORT.collect(shift):null;
 var rows=report?[[id,'転送中','','','','','','','','',
  globalThis.TAXIAPP_HIGHWAY_REPORT.closedDutyDistance(shift),report.unknownDistances]]
  .concat(report.entries.map(function(entry){
   return [id,'区間',entry.no,entry.mode==='実'?'実車':'空車',entry.roadName,entry.entryIC,
    entry.exitIC,entry.sectionKm,entry.exemptKm,entry.chargeYen,'',''];
  })):[];
 var start=existing.length&&existing.every(function(item,index){return item.row===existing[0].row+index;})&&
  (rows.length<=existing.length||existing[existing.length-1].row===lastRow)?
  existing[0].row:lastRow+1;
 var lastNeeded=start+rows.length-1;
 if(lastNeeded>sheet.getMaxRows())
  sheet.insertRowsAfter(sheet.getMaxRows(),lastNeeded-sheet.getMaxRows());
 // Invalidate only published summaries for this ID before changing any spans.
 existing.filter(function(item){return item.summary;}).forEach(function(item){
  sheet.getRange(item.row,2).setValue('転送中');
 });
 existing.filter(function(item){return item.row<start||item.row>lastNeeded;}).forEach(function(item){
  sheet.getRange(item.row,1,1,width).clearContent();
 });
 if(!rows.length)return null;
 var range=sheet.getRange(start,1,rows.length,width);
 var expected=rows.map(function(row){return row.map(function(value){return value??'';});});
 var sheetText=function(value){return typeof value==='string'&&value.charAt(0)==="'"?"'"+value:safeCell_(value);};
 sheet.getRange(start,3,rows.length,5).setNumberFormat('@');
 range.setValues(expected.map(function(row){return row.map(sheetText);}));
 var actual=range.getValues(),formulas=range.getFormulas();
 if(actual.some(function(row,index){
  return formulas[index].some(Boolean)||row.some(function(value,col){
   var original=expected[index][col];
   // A leading apostrophe used by safeCell_ may be stripped on reading.
   return value!==original&&value!==sheetText(original);
  });
 }))throw Error('転送した高速明細の読戻しが一致しません。明細は転送中のままです');
 return function(){
  var status=sheet.getRange(start,2);
  if(status.getValue()!=='転送中')throw Error('高速明細の状態が転送中に変更されました');
  status.setValue('乗務');
  if(status.getValue()!=='乗務')throw Error('高速明細の公開を確認できません');
 };
}
