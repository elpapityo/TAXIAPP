/**
 * TAXIAPP Firebase -> Existing Google paper forms. DEVELOPMENT ONLY.
 * Add to existing Apps Script only after explicit production authorization.
 * The existing doPost and legacy savePacket_ are unchanged for legacy calls.
 *
 * The running Google identity must already have strictly controlled Firestore
 * read IAM rights. ScriptApp OAuth token is used; NO exported service key and
 * NO anonymous Web App / shared-key Firestore proxy.
 *
 * Required Script Properties (never hardcode or print values):
 *  TAXIAPP_FIRESTORE_PROJECT_ID : Firebase project ID
 *  TAXIAPP_FIRESTORE_OWNER_UID  : authenticated owner's UID, pinned once
 *
 * OAuth scope datastore is required; configuration, app redeploy, grants,
 * original migration and real-print write all await owner approval.
 */
var TAXIAPP_FIRESTORE_PRINT_URI='https://firestore.googleapis.com/v1/';
function firestorePrintConfigDraft_(){
 if(typeof PropertiesService==='undefined')throw Error('Googleスクリプトの設定情報がありません');
 var p=PropertiesService.getScriptProperties();
 var project=String(p.getProperty('TAXIAPP_FIRESTORE_PROJECT_ID')||'');
 var uid=String(p.getProperty('TAXIAPP_FIRESTORE_OWNER_UID')||'');
 if(!/^[a-z][a-z0-9-]{4,63}$/.test(project)||
    !/^[a-zA-Z0-9_-]{5,128}$/.test(uid))
  throw Error('Firestoreのプロジェクトと本人UIDが未設定です');
 return {project:project,uid:uid};
}
function firestorePrintRestDraft_(cfg,subpath){
 if(typeof ScriptApp==='undefined'||typeof UrlFetchApp==='undefined')
  throw Error('Google OAuthまたはFirestore読取権限がありません');
 var token=ScriptApp.getOAuthToken();
 if(!token)throw Error('Google認証トークンがありません');
 var base='projects/'+encodeURIComponent(cfg.project)+'/databases/(default)/documents/';
 var res=UrlFetchApp.fetch(TAXIAPP_FIRESTORE_PRINT_URI+base+subpath,{
  method:'get',headers:{Authorization:'Bearer '+token},muteHttpExceptions:true
 });
 var status=res.getResponseCode();
 if(status!==200)throw Error('Firestoreの原本を取得できません（HTTP '+status+'）。Googleアカウントと読取権限を確認してください');
 var json=JSON.parse(res.getContentText());
 if(!json||typeof json!=='object')throw Error('Firestore応答の形式が不正です');
 return json;
}
function firestorePrintDecodeDraft_(v,depth){
 var d=depth||0;
 if(d>35||!v||typeof v!=='object')throw Error('Firestoreの値が不正です');
 if(v.stringValue!==undefined)return String(v.stringValue);
 if(v.booleanValue!==undefined)return v.booleanValue===true;
 if(v.integerValue!==undefined){
  var n=Number(v.integerValue);
  if(!Number.isSafeInteger(n))throw Error('Firestore金額が整数範囲を超えています');return n;
 }
 if(v.doubleValue!==undefined){
  var num=Number(v.doubleValue);
  if(!Number.isFinite(num))throw Error('Firestore数値が不正です');return num;
 }
 if(v.nullValue!==undefined)return null;
 if(v.timestampValue!==undefined)return String(v.timestampValue);
 if(v.mapValue!==undefined){
  var out={},fields=v.mapValue.fields||{};
  Object.keys(fields).forEach(function(k){out[k]=firestorePrintDecodeDraft_(fields[k],d+1);});
  return out;
 }
 if(v.arrayValue!==undefined){
  return (v.arrayValue.values||[]).map(function(x){return firestorePrintDecodeDraft_(x,d+1);});
 }
 throw Error('Firestoreの未対応データ型です');
}
function firestorePrintDocDraft_(cfg,id){
 if(!/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(String(id||'')))
  throw Error('印刷する乗務IDが不正です');
 var path='privateDuties/'+encodeURIComponent(cfg.uid)+'/shifts/'+encodeURIComponent(id);
 var doc=firestorePrintRestDraft_(cfg,path);
 var expectedName='projects/'+cfg.project+'/databases/(default)/documents/'+path;
 if(String(doc.name||'')!==expectedName)
  throw Error('Firestoreの本人UID・乗務ID・プロジェクトが取得先と一致しません');
 var data=firestorePrintDecodeDraft_({mapValue:{fields:doc.fields||{}}},0);
 if(data.trashed===true)throw Error('ゴミ箱に移した乗務は印刷元に取り込めません');
 if(data.format!=='TAXIAPP_PRIVATE_SHIFT_V1'||
    !Number.isSafeInteger(data.revision)||data.revision<1||
    data.shift?.id!==id||!Array.isArray(data.shift?.records)||
    data.shift.records.length>60||
    (!data.shift.endedAt&&!data.shift.endedIso))
  throw Error('Firestore原本の本人・更新番号・入庫が未確認です');
 if(data.shift?.__taxiPrintSummary===undefined||!Array.isArray(data.shift.records))
  throw Error('Firestoreに既存アプリの計算済み印刷情報がありません');
 // Never recompute fares: raw, amounts, tender splits and summary were
 // created by googleShiftPacket() on the authenticated writer device.
 var date=new Date(String(data.updatedAt||''));
 if(!Number.isFinite(date.getTime()))
  throw Error('Firestore原本の保存時刻を確認できません');
 var packet={kind:'TAXIAPP_SHIFT_V1',shift:data.shift,
  summary:data.shift.__taxiPrintSummary,printRecordedAt:date.toISOString()};
 validatePacket_(packet);
 return {revision:data.revision,id:id,packet:packet};
}
/** Manual PC operation only. Never registered in public doPost. */
function firestorePrintSelectedDutyDraft_(id){
 var cfg=firestorePrintConfigDraft_();
 var first=firestorePrintDocDraft_(cfg,id);
 var lock=LockService.getScriptLock();
 if(!lock.tryLock(25000))throw Error('別の印刷転送が実行中です');
 try{
  var current=firestorePrintDocDraft_(cfg,id);
  if(current.revision!==first.revision||
     JSON.stringify(first.packet)!==JSON.stringify(current.packet))
   throw Error('印刷転送中にFirestore原本が更新されました');
  // The original Google sync storage and existing 2-page print forms
  // are NOT changed. Only the four existing print-source sheets receive rows.
  return savePacket_(current.packet,{firestorePrintOnly:true,
   verifyCurrentSource:function(){
    var beforeIndex=firestorePrintDocDraft_(cfg,id);
    if(beforeIndex.revision!==current.revision||
       JSON.stringify(beforeIndex.packet)!==JSON.stringify(current.packet))
     throw Error('印刷元の公開直前にFirestore原本が更新されました。転送を停止します');
   }});
 }finally{lock.releaseLock();}
}
/** Convenience for new duties not yet present in the print dropdown. */
function firestorePrintLatestDutyDraft_(){
 var cfg=firestorePrintConfigDraft_();
 var path='privateDuties/'+encodeURIComponent(cfg.uid)+'/shifts';
 var token='',seen={},latest='',latestStamp='';
 for(var page=0;page<10;page++){
  var response=firestorePrintRestDraft_(cfg,path+'?pageSize=100'+(token?'&pageToken='+encodeURIComponent(token):''));
  (response.documents||[]).forEach(function(doc){
   var prefix='projects/'+cfg.project+'/databases/(default)/documents/privateDuties/'+cfg.uid+'/shifts/';
   var name=String(doc.name||'');
   if(name.indexOf(prefix)!==0)throw Error('印刷候補に本人以外のFirestore原本が含まれています');
   var id=name.slice(prefix.length);
   if(!/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(id)||seen[id])
    throw Error('Firestoreの印刷一覧に不正な乗務IDがあります');
   seen[id]=true;
   var data=firestorePrintDecodeDraft_({mapValue:{fields:doc.fields||{}}},0),shift=data.shift;
   if(data.trashed!==true&&shift&&shift.id===id&&(shift.endedAt||shift.endedIso)&&
      shift.__taxiPrintSummary&&String(shift.startedIso||'')>latestStamp){
    latestStamp=String(shift.startedIso||'');latest=id;
   }
  });
  token=String(response.nextPageToken||'');
  if(!token)break;
  if(page===9)throw Error('Firestoreの件数が多く、未確認の乗務があります');
 }
 if(!latest)throw Error('Firestoreに印刷可能な入庫済み乗務が見つかりません');
 return firestorePrintSelectedDutyDraft_(latest);
}

/** Separate PC menu; does NOT override or replace existing onOpen macros. */
function firestorePrintMenuDraft_(){
 SpreadsheetApp.getUi().createMenu('TAXIAPP Firebase取込')
  .addItem('Firestoreの最新乗務を取込','firestorePrintLatestMenuDraft_')
  .addItem('選択済み乗務を照合（同じ版のみ）','firestorePrintChosenMenuDraft_')
  .addToUi();
}
function firestorePrintLatestMenuDraft_(){
 var result=firestorePrintLatestDutyDraft_();
 SpreadsheetApp.openById(TAXIAPP_SHEET_ID).toast(result,'Firebase印刷取込',8);
}
function firestorePrintChosenMenuDraft_(){
 var ss=SpreadsheetApp.openById(TAXIAPP_SHEET_ID);
 var operation=ss.getSheetByName('TAXIAPP_印刷操作');
 if(!operation)throw Error('既存の印刷操作シートがありません');
 var id=String(operation.getRange('C17').getDisplayValue()||'').trim();
 // C17 is a formula-derived ID; B15/B17 select the actual PC print duty.
 // Never import an earlier duty when the formula has not caught up.
 var selected=resolvePrintShiftId_(ss,operation);
 if(!selected||selected!==id)
  throw Error('PCで選択した乗務とC17の乗務IDが一致しません。B15/B17を確認してから再実行してください');
 var result=firestorePrintSelectedDutyDraft_(id);
 ss.toast(result,'Firebase印刷取込',8);
}
/** Optional installation; run only after the user approves the GAS changes. */
function setupFirestorePrintMenuDraft_(){
 var ss=SpreadsheetApp.openById(TAXIAPP_SHEET_ID);
 var present=ScriptApp.getProjectTriggers().some(function(t){
  return t.getHandlerFunction()==='firestorePrintMenuDraft_';
 });
 if(!present)ScriptApp.newTrigger('firestorePrintMenuDraft_')
  .forSpreadsheet(ss).onOpen().create();
 firestorePrintMenuDraft_();
}
