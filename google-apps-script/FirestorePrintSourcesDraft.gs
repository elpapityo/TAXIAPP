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
// Google Sheets may turn a yyyy-MM-dd HH:mm:ss cell into a native Date.
// Only accept the exact equivalent Japan-local timestamp, never a loose cast.
function firestorePrintSameCellDraft_(actual,expected){
 if(Object.prototype.toString.call(actual)==='[object Date]' &&
    typeof expected==='string' && Number.isFinite(actual.getTime())){
  if(/^\d{4}-\d{2}-\d{2}$/.test(expected))
   return Utilities.formatDate(actual,'Asia/Tokyo','yyyy-MM-dd')===expected;
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(expected))
   return Utilities.formatDate(actual,'Asia/Tokyo','yyyy-MM-dd HH:mm:ss')===expected;
 }
 return JSON.stringify(actual)===JSON.stringify(expected);
}
function firestorePrintSameRowsDraft_(actual,expected){
 return actual.length===expected.length&&actual.every(function(row,i){
  return row.length===expected[i].length&&row.every(function(cell,j){
   return firestorePrintSameCellDraft_(cell,expected[i][j]);
  });
 });
}
/**
 * Before the PC confirms its selected Firestore duty, compare ALL existing
 * calculated print-source cells with that exact confirmed duty. This remains
 * read-only, including for same-second edits with identical totals. Formulas
 * within the 4 source ranges are never silently treated as ordinary values.
 */
function firestorePrintVerifyRowsDraft_(ss,shiftId,batches){
 if(!ss||typeof ss.getSheetByName!=='function'||
    !/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(shiftId)||
    !Array.isArray(batches)||batches.length!==4)
  throw Error('Firestore印刷元の照合情報が不正です');
 var order=['TAXIAPP_印刷データ','TAXIAPP_決済内訳','TAXIAPP_集計','TAXIAPP_乗務一覧'];
 batches.forEach(function(batch,index){
  var name=batch.name,headers=TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS[name];
  if(name!==order[index]||!headers||batch.width!==headers.length||
     !Array.isArray(batch.rows)||batch.rows.some(function(row){
      return !Array.isArray(row)||row.length!==headers.length||row[0]!==shiftId;
     }))throw Error('印刷元の照合行形式が不正です：'+name);
  var sheet=ss.getSheetByName(name);
  if(!sheet||sheet.getMaxColumns()<headers.length||sheet.getMaxRows()<2)
   throw Error('既存印刷元の構造を確認できません：'+name);
  if(JSON.stringify(sheet.getRange(1,1,1,headers.length).getValues()[0])!==
     JSON.stringify(headers))
   throw Error('既存印刷元の見出しが異なります：'+name);
  var area=sheet.getRange(2,1,sheet.getMaxRows()-1,headers.length);
  var all=area.getValues(),formulas=area.getFormulas(),matching=[];
  all.forEach(function(row,i){
   if(String(row[0])!==shiftId)return;
   if(formulas[i].some(Boolean))
    throw Error('印刷元の営業行に数式が存在します。変更せず確認を停止しました：'+name);
   matching.push(row);
  });
  var prepared=batch.rows.map(function(row){return row.map(safeCell_);});
  if(!firestorePrintSameRowsDraft_(matching,prepared))
   throw Error('Firestore原本と印刷元の明細が一致しません。同一乗務IDの改版再印刷は未完成です。自動上書きせず確認してください：'+name);
 });
 return {id:shiftId,verifiedSheets:order.slice(),readOnly:true};
}

/**
 * The four existing source sheets have no cross-sheet transaction. A private
 * ScriptProperties revision journal ties a previously verified row footprint
 * to the Firestore revision. Unknown/partially transferred data stop instead
 * of being silently rewritten. Only the already existing print-source cells
 * are edited; legacy original, selectors and two paper forms remain untouched.
 */
function firestorePrintJournalDraft_(uid,id){
 if(typeof PropertiesService==='undefined'||
    typeof PropertiesService.getScriptProperties!=='function')
  throw Error('Firestore再印刷の版管理が利用できません');
 var p=PropertiesService.getScriptProperties();
 if(typeof p.getProperty!=='function'||typeof p.setProperty!=='function'||
    typeof p.deleteProperty!=='function')
  throw Error('Firestore再印刷の版管理が利用できません');
 var key='TAXIAPP_FS_PRINT_REV1_'+uid+'_'+id;
 var raw=p.getProperty(key),row=null;
 if(raw){
  try{row=JSON.parse(raw);}catch(e){throw Error('印刷元の版管理記録が不正です。自動更新しません');}
  if(!row||row.uid!==uid||row.id!==id||
     !Number.isSafeInteger(row.revision)||row.revision<1||
     !['ready','writing'].includes(row.state)||typeof row.digest!=='string')
   throw Error('印刷元の版管理記録が不正です。自動更新しません');
  if(row.state!=='ready')throw Error('印刷元の更新が中断されています。内容を手動で照合してください');
 }
 return {properties:p,key:key,record:row};
}
function firestorePrintDigestDraft_(batches){
 if(typeof Utilities==='undefined'||typeof Utilities.computeDigest!=='function'||
    typeof Utilities.base64EncodeWebSafe!=='function')
  throw Error('Firestore印刷元の厳密な照合機能が利用できません');
 var plain=JSON.stringify(batches.map(function(batch){
  return [batch.name,batch.rows];
 }));
 var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,plain,
  Utilities.Charset.UTF_8);
 return Utilities.base64EncodeWebSafe(bytes);
}
function firestorePrintSnapshotDraft_(ss,shiftId,batches){
 var results=[];
 batches.forEach(function(batch){
  var name=batch.name,headers=TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS[name];
  if(!headers||!ss.getSheetByName(name)||
     !Array.isArray(batch.rows)||batch.width!==headers.length)
   throw Error('印刷元の版管理対象が不正です：'+name);
  var sheet=ss.getSheetByName(name),width=headers.length;
  if(sheet.getMaxRows()<2||sheet.getMaxColumns()<width||
     JSON.stringify(sheet.getRange(1,1,1,width).getValues()[0])!==JSON.stringify(headers))
   throw Error('印刷元の構造が変わっています：'+name);
  var n=sheet.getMaxRows()-1,area=sheet.getRange(2,1,n,width);
  var values=area.getValues(),forms=area.getFormulas();
  var matches=[],first=-1,last=-1,lastOccupied=-1;
  values.forEach(function(row,i){
   if(row.some(function(cell,j){return (cell!==''&&cell!==null)||Boolean(forms[i][j]);}))
    lastOccupied=i;
   if(String(row[0])!==shiftId)return;
   if(forms[i].some(Boolean))
    throw Error('印刷元の本人乗務行に数式があります。変更しません：'+name);
   if(first===-1)first=i;
   last=i;matches.push(row);
  });
  if(matches.length&&last-first+1!==matches.length)
   throw Error('同じ乗務IDの行が離れています。自動更新しません：'+name);
  results.push({name:name,rows:matches,width:width,start:first<0?0:first+2,
   lastOccupied:lastOccupied+2,sheet:sheet,hasRows:matches.length>0});
 });
 return results;
}
function firestorePrintJournalRowsDraft_(snapshot){
 return snapshot.map(function(p){return {name:p.name,rows:p.rows};});
}
function firestorePrintPublishVersionedDraft_(ss,id,batches,revision,uid,verifyBeforeIndex){
 if(!Number.isSafeInteger(revision)||revision<1||!uid||
    !Array.isArray(batches)||batches.length!==4)
  throw Error('Firestore再印刷のUID・更新番号が不正です');
 var order=['TAXIAPP_印刷データ','TAXIAPP_決済内訳','TAXIAPP_集計','TAXIAPP_乗務一覧'];
 if(batches.some(function(b,i){return b.name!==order[i]||
    b.rows.some(function(r){return r[0]!==id;});}))
  throw Error('Firestore再印刷の明細行が不正です');
 var journal=firestorePrintJournalDraft_(uid,id);
 var previous=firestorePrintSnapshotDraft_(ss,id,batches);
 var existingDigest=firestorePrintDigestDraft_(firestorePrintJournalRowsDraft_(previous));
 var planned=batches.map(function(b){return {name:b.name,rows:b.rows.map(function(row){
   return row.map(safeCell_);
  })};});
 var recorded=journal.record;
 if(recorded&&recorded.digest!==existingDigest)
  throw Error('前回の確認後に印刷元が変更されています。自動上書きせず手動照合してください');
 if(recorded&&revision<recorded.revision)
  throw Error('Firestoreの更新番号が前回印刷した原本より古いため停止しました');
 var unchanged=previous.every(function(old,i){
  return firestorePrintSameRowsDraft_(old.rows,planned[i].rows);
 });
 if(unchanged){
  // Even an unchanged print projection must be compared with the current
  // Firestore original before recording this revision as verified.
  // A concurrently changed duty cannot be silently marked as printed.
  if(typeof verifyBeforeIndex==='function')verifyBeforeIndex();
  if(!recorded||revision>recorded.revision){
   journal.properties.setProperty(journal.key,JSON.stringify({
    uid:uid,id:id,revision:revision,digest:existingDigest,state:'ready'
   }));
  }
  return {id:id,changedSheets:[],oldOriginalUnchanged:true,paperFormsUnchanged:true};
 }
 if(!recorded){
  if(previous.some(function(x){return x.rows.length;}))
   throw Error('同一乗務IDの旧印刷元に確認済み更新番号がありません。初回の原本と照合し、手動復旧してください');
  // First transfer uses the existing append + safe rollback implementation.
  var first=firestorePrintPublishRowsDraft_(ss,id,batches,verifyBeforeIndex);
  var published=firestorePrintSnapshotDraft_(ss,id,batches);
  if(!published.every(function(x,i){
   return firestorePrintSameRowsDraft_(x.rows,planned[i].rows);
  }))throw Error('Firestore初回の4印刷元に不一致があります。確認が必要です');
  journal.properties.setProperty(journal.key,JSON.stringify({
   uid:uid,id:id,revision:revision,
   digest:firestorePrintDigestDraft_(firestorePrintJournalRowsDraft_(published)),
   state:'ready'
  }));
  return first;
 }
 if(revision===recorded.revision)
  throw Error('同じ更新番号で印刷明細が変わっています。自動上書きしません');
 // A growing block is safe only when it is the last occupied block. No
 // row insertion or shifting of another duty is ever attempted.
 var plans=previous.map(function(old,i){
  var next=planned[i].rows,len=Math.max(old.rows.length,next.length),start=old.start;
  if(!old.rows.length)start=old.lastOccupied+1;
  if(next.length>old.rows.length&&old.rows.length&&
     old.start+old.rows.length-1!==old.lastOccupied)
   throw Error('別の乗務の後ろにある明細は行を増やせません。手動調整せず更新を保留：'+old.name);
  if(start<2||start+len-1>old.sheet.getMaxRows()||start+len-1>1200)
   throw Error('既存印刷元の空き行が不足しています：'+old.name);
  var range=len?old.sheet.getRange(start,1,len,old.width):null;
  var before=len?range.getValues():[],formulas=len?range.getFormulas():[];
  if(formulas.some(function(row){return row.some(Boolean);}))
   throw Error('再印刷の更新先に数式があります。変更しません：'+old.name);
  if(!firestorePrintSameRowsDraft_(before.slice(0,old.rows.length),old.rows)||
     before.slice(old.rows.length).some(function(row){
      return row.some(function(cell){return cell!==''&&cell!==null;});
     }))
   throw Error('再印刷の更新先が前回の確認内容と異なります：'+old.name);
  var rows=next.map(function(row){return row.slice();});
  while(rows.length<len)rows.push(Array(old.width).fill(''));
  return {name:old.name,sheet:old.sheet,range:range,before:before,rows:rows,
   changed:!firestorePrintSameRowsDraft_(old.rows,next),width:old.width};
 });
 journal.properties.setProperty(journal.key,JSON.stringify({
  uid:uid,id:id,revision:recorded.revision,digest:existingDigest,state:'writing'
 }));
 var attempted=[];
 try{
  plans.forEach(function(plan){
   if(plan.name==='TAXIAPP_乗務一覧'&&typeof verifyBeforeIndex==='function')
    verifyBeforeIndex();
   if(!plan.rows.length||!plan.changed)return;
   // An operator can edit a sheet after our first snapshot. Check again
   // immediately before writing; never overwrite values or formulas that
   // are no longer the verified previous print-source version.
   if(plan.range.getFormulas().some(function(row){return row.some(Boolean);})||
      !firestorePrintSameRowsDraft_(plan.range.getValues(),plan.before))
    throw Error('印刷元が転送中に変更されました：'+plan.name);
   attempted.push(plan);
   plan.range.setValues(plan.rows);
   if(!firestorePrintSameRowsDraft_(plan.range.getValues(),plan.rows))
    throw Error('更新した印刷明細を読み戻せません：'+plan.name);
  });
  var checked=firestorePrintSnapshotDraft_(ss,id,batches);
  if(!checked.every(function(old,i){
   return firestorePrintSameRowsDraft_(old.rows,planned[i].rows);
  }))throw Error('4印刷元の更新結果が不一致です');
  journal.properties.setProperty(journal.key,JSON.stringify({
   uid:uid,id:id,revision:revision,
   digest:firestorePrintDigestDraft_(firestorePrintJournalRowsDraft_(checked)),
   state:'ready'
  }));
 }catch(error){
  var needsManual=[];
  attempted.reverse().forEach(function(plan){
   try{
    // Formulas or outside edits can appear during a failed write. Never
    // delete them; leave the pending journal to block unsafe retries.
    if(plan.range.getFormulas().some(function(row){return row.some(Boolean);}))
     throw Error('数式あり');
    var now=plan.range.getValues();
    if(!now.every(function(row,i){
      return row.every(function(cell,j){
       return cell===''||cell===null||
        firestorePrintSameCellDraft_(cell,plan.rows[i][j])||
        firestorePrintSameCellDraft_(cell,plan.before[i][j]);
      });
    }))throw Error('他者の変更あり');
    plan.range.setValues(plan.before);
    if(!firestorePrintSameRowsDraft_(plan.range.getValues(),plan.before))
     throw Error('復元後の値が違います');
   }catch(e){needsManual.push(plan.name);}
  });
  try{
   var restored=firestorePrintSnapshotDraft_(ss,id,batches);
   if(firestorePrintDigestDraft_(firestorePrintJournalRowsDraft_(restored))!==existingDigest)
    needsManual.push('版管理の再照合');
  }catch(e){needsManual.push('版管理の再照合');}
  if(!needsManual.length){
   journal.properties.setProperty(journal.key,JSON.stringify(recorded));
   throw Error('Firestore再印刷の更新を中止し、旧印刷元に戻しました：'+String(error.message||error));
  }
  throw Error('Firestore再印刷が中断され、印刷元の一部に復旧が必要です。自動再送しません：'+needsManual.join('、'));
 }
 return {id:id,changedSheets:plans.filter(function(p){return p.changed&&p.rows.length;})
  .map(function(p){return p.name;}),oldOriginalUnchanged:true,paperFormsUnchanged:true};
}

function firestorePrintPublishRowsDraft_(ss,shiftId,batches,verifyBeforeIndex){
 if(!ss||typeof ss.getSheetByName!=='function'||
    !/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(shiftId)||
    !Array.isArray(batches)||batches.length!==4)
  throw Error('印刷元4シートの転送情報が不正です');
 var names={},plans=[];
 var order=['TAXIAPP_印刷データ','TAXIAPP_決済内訳','TAXIAPP_集計','TAXIAPP_乗務一覧'];
 batches.forEach(function(batch,position){
  var name=batch.name,headers=TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS[name];
  if(name!==order[position]||!headers||names[name]||batch.width!==headers.length||
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
      !firestorePrintSameRowsDraft_(matching,prepared))
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
 // A prior partially written transfer requires manual reconciliation.
 var active=plans.filter(function(x){return x.rows.length>0||x.mode==='unchanged';});
 var unchanged=active.filter(function(x){return x.mode==='unchanged';}).length;
 if(unchanged>0&&unchanged<active.length)
  throw Error('同じ乗務IDの印刷元が一部だけ残っています。自動追記せず手作業で確認してください');
 // Complete printable detail/payment/aggregate FIRST, index LAST.
 // When a new duty fails mid-append, remove ONLY cells written by this
 // attempt. Google Sheets has no multi-sheet transaction: a competing manual
 // edit must halt rollback rather than be silently erased.
 var attempted=[];
 try{
  plans.forEach(function(plan){
   // Recheck Firestore after detail writes but before index publication.
   if(plan.name==='TAXIAPP_乗務一覧'&&typeof verifyBeforeIndex==='function')
    verifyBeforeIndex();
   if(!plan.rows.length)return;
   var range=plan.sheet.getRange(plan.start,1,plan.rows.length,plan.width);
   attempted.push(plan);
   range.setValues(plan.rows);
   var actual=range.getValues();
   if(!firestorePrintSameRowsDraft_(actual,plan.rows))
    throw Error('印刷元の転送確認に失敗しました：'+plan.name);
  });
 }catch(writeError){
  var recovery=[],rollbackErrors=[];
  attempted.reverse().forEach(function(plan){
   try{
    var range=plan.sheet.getRange(plan.start,1,plan.rows.length,plan.width);
    var actual=range.getValues(),formulas=range.getFormulas();
    // A competing formula can evaluate to the exact intended value.
    // Never erase it during a failed-transfer rollback.
    var safe=actual.length===plan.rows.length&&
     formulas.length===plan.rows.length&&actual.every(function(row,i){
     return row.length===plan.width&&formulas[i].length===plan.width&&
      row.every(function(cell,j){
       return !formulas[i][j]&&(cell===''||cell===null||
        firestorePrintSameCellDraft_(cell,plan.rows[i][j]));
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
