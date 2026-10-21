/**
 * TAXIAPP Firestore -> EXISTING print source sheets only.
 * DEVELOPMENT / isolated clone only until a verified print pause and
 * rollback plan are approved. No data migration or legacy original edits.
 * Maps previously calculated values; does not calculate fares.
 */
var TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS={
 'TAXIAPP_乗務一覧':['乗務ID','乗務日','出庫日時','入庫日時','運転者','社員番号',
  '車両番号','営業件数','メーター売上','障がい者割引','GO手数料','Uber配車手数料',
  '現金納金','ETC','総入金額','更新日時','転送状態','出庫km','入庫km'],
 'TAXIAPP_印刷データ':['乗務ID','営業番号','配車区分','支払表示','表示金額',
  '乗車時刻','降車時刻','乗車地','降車地','GO手数料確認','実車高速',
  '空車高速','障がい者割引','精算完了日時'],
 'TAXIAPP_決済内訳':['乗務ID','営業番号','決済内訳番号','支払金種',
  '支払金額','アプリ決済額','現金受取','高速料金','割引額','手数料','備考'],
 'TAXIAPP_集計':['乗務ID','種類','金額','計算根拠','更新日時']
};
function firestorePrintPublishRowsDraft_(ss,shiftId,batches){
 if(!ss||typeof ss.getSheetByName!=='function'||
    !/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(shiftId)||
    !Array.isArray(batches)||batches.length!==4)
  throw Error('印刷元4シートの転送情報が不正です');
 var names={},plans=[];
 batches.forEach(function(batch){
  var name=batch.name,headers=TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS[name];
  if(!headers||names[name]||batch.width!==headers.length||
     !Array.isArray(batch.rows)||batch.rows.some(function(row){
      return !Array.isArray(row)||row.length!==headers.length||row[0]!==shiftId;
     }))throw Error('印刷元の行形式が不正です：'+name);
  names[name]=true;
  var sheet=ss.getSheetByName(name);
  if(!sheet||sheet.getMaxColumns()<headers.length||sheet.getMaxRows()<2)
   throw Error('既存印刷元の構造を確認できません：'+name);
  var existingHeaders=sheet.getRange(1,1,1,headers.length).getValues()[0];
  if(JSON.stringify(headers)!==JSON.stringify(existingHeaders))
   throw Error('既存印刷元の見出しが異なります：'+name);
  // Column T/U of TAXIAPP_乗務一覧 hold selector formulas; exclude them.
  var height=sheet.getMaxRows()-1;
  var scanned=sheet.getRange(2,1,height,headers.length).getValues();
  var last=0,matching=[];
  scanned.forEach(function(row,index){
   if(String(row[0])===shiftId)matching.push(row);
   if(row.some(function(cell){return cell!==''&&cell!==null;})){
    if(!String(row[0]))throw Error('所属不明の印刷元行を検出しました');
    last=index+1;
   }
  });
  var prepared=batch.rows.map(function(row){return row.map(safeCell_);});
  if(matching.length){
   if(matching.length!==prepared.length||
      matching.some(function(row,i){return JSON.stringify(row)!==JSON.stringify(prepared[i]);}))
    throw Error('同じ乗務IDの印刷元とFirestore原本が異なります。自動上書きを停止しました：'+name);
   plans.push({name:name,sheet:sheet,start:0,rows:[],width:headers.length,mode:'unchanged'});
   return;
  }
  if(last+batch.rows.length>height||last+batch.rows.length+1>1200)
   throw Error('印刷元の行数上限を超えています：'+name);
  if(prepared.length){
   var range=sheet.getRange(last+2,1,prepared.length,headers.length);
   var previous=range.getValues(),formulas=range.getFormulas();
   if(previous.some(function(row){return row.some(function(v){return v!==''&&v!==null;});})||
      formulas.some(function(row){return row.some(Boolean);}))
    throw Error('印刷元の追加先が空白ではありません：'+name);
  }
  plans.push({name:name,sheet:sheet,start:last+2,rows:prepared,width:headers.length});
 });
 // Complete printable detail/payment/aggregate FIRST, index LAST.
 // When a new duty fails mid-append, remove ONLY cells written by this
 // attempt. Google Sheets has no multi-sheet transaction: a competing manual
 // edit must halt rollback rather than be silently erased.
 var attempted=[];
 try{
  plans.forEach(function(plan){
   if(!plan.rows.length)return;
   var range=plan.sheet.getRange(plan.start,1,plan.rows.length,plan.width);
   attempted.push(plan);
   range.setValues(plan.rows);
   var actual=range.getValues();
   if(JSON.stringify(actual)!==JSON.stringify(plan.rows))
    throw Error('印刷元の転送確認に失敗しました：'+plan.name);
  });
 }catch(writeError){
  var recovery=[],rollbackErrors=[];
  attempted.reverse().forEach(function(plan){
   try{
    var range=plan.sheet.getRange(plan.start,1,plan.rows.length,plan.width);
    var actual=range.getValues();
    // A failed setValues can nevertheless have partially written cells.
    // Every cell must be either the intended new value or the original blank.
    var safe=actual.length===plan.rows.length&&actual.every(function(row,i){
     return row.length===plan.width&&row.every(function(cell,j){
      return cell===''||cell===null||
       JSON.stringify(cell)===JSON.stringify(plan.rows[i][j]);
     });
    });
    if(!safe){recovery.push(plan.name);return;}
    range.clearContent();
    if(range.getValues().some(function(row){
      return row.some(function(cell){return cell!==''&&cell!==null;});
    }))recovery.push(plan.name);
   }catch(e){rollbackErrors.push(plan.name);}
  });
  if(recovery.length||rollbackErrors.length)
   throw Error('印刷元の更新が中断され、一部の内容を安全に復旧できません。手作業で確認してください：'+
     [...recovery,...rollbackErrors].join('、')+'／原因：'+String(writeError.message||writeError));
  throw Error('印刷元の更新に失敗したため、追記内容を検証用の空白へ戻しました：'+
   String(writeError.message||writeError));
 }
 return {id:shiftId,changedSheets:plans.filter(function(p){return p.rows.length;})
  .map(function(p){return p.name;}),oldOriginalUnchanged:true,paperFormsUnchanged:true};
}
