/**
 * TAXIAPP Firebase -> Existing Google paper forms. DEVELOPMENT ONLY.
 * Add to existing Apps Script only after explicit production authorization.
 * The existing doPost and legacy savePacket_ are unchanged for legacy calls.
 *
 * The logged-in OWNER sends a short-lived Firebase Authentication ID token
 * from the PC TAXIAPP. Firestore Security Rules enforce request.auth.uid.
 * No Google IAM Firestore read role, service account or ScriptApp OAuth token.
 * Existing GAS write key alone NEVER authorizes a Firestore read.
 *
 * Required Script Properties (never hardcode or print values):
 *  TAXIAPP_FIRESTORE_PROJECT_ID : Firebase project ID
 *  TAXIAPP_FIRESTORE_OWNER_UID  : authenticated owner's UID, pinned once
 *
 * The existing GAS project must allow UrlFetchApp to call Firestore REST.
 * Deployment, Script Properties and print-source writes await owner approval.
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
function firestorePrintRestDraft_(cfg,subpath,idToken){
 // Never fall back to Google OAuth/IAM: it can read another person's duty.
 // A Firebase ID token must be supplied for EVERY Firestore request.
 if(typeof UrlFetchApp==='undefined'||typeof idToken!=='string'||
    idToken.length<100||idToken.length>8192||idToken.split('.').length!==3)
  throw Error('本人のFirebase認証がありません。PCのTAXIAPPから再取込してください');
 var token=idToken;
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
function firestorePrintDocDraft_(cfg,id,idToken){
 if(!/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(String(id||'')))
  throw Error('印刷する乗務IDが不正です');
 var path='privateDuties/'+encodeURIComponent(cfg.uid)+'/shifts/'+encodeURIComponent(id);
 var doc=firestorePrintRestDraft_(cfg,path,idToken);
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
/**
 * PC preflight: always get a fresh owner-authenticated Firestore original.
 * Verify the four destinations and legacy-ID collision without writing any
 * Google cells, script property, Firestore document or printer output.
 */
function firestorePrintProbeDraft_(id,expectedDate,idToken){
 var cfg=firestorePrintConfigDraft_();
 var original=firestorePrintDocDraft_(cfg,id,idToken);
 var duty=original.packet.shift;
 if(expectedDate&&duty.date!==expectedDate)
  throw Error('指定した乗務日とFirestore原本が一致しません');
 var ss=SpreadsheetApp.openById(TAXIAPP_SHEET_ID);
 ['TAXIAPP_乗務一覧','TAXIAPP_印刷データ',
  'TAXIAPP_決済内訳','TAXIAPP_集計',
  'TAXIAPP_印刷操作','補助簿印刷用','補助簿印刷用_2頁']
  .forEach(function(name){
   if(!ss.getSheetByName(name))throw Error('既存の印刷先が見つかりません：'+name);
  });
 var prior=ss.getSheetByName('TAXIAPP_同期原本');
 if(!prior)throw Error('旧Google原本の保存先を確認できません');
 var n=Math.max(0,prior.getLastRow()-1),collision=false;
 if(n)collision=prior.getRange(2,1,n,1).getValues()
  .some(function(row){return String(row[0])===id;});
 return {id:id,date:duty.date,revision:original.revision,
  records:duty.records.length,ready:!collision,
  reason:collision?'旧Google原本に同一IDが存在します。安全のため自動取込できません':'',
  readOnly:true};
}

/** Manual PC operation only. Never registered in public doPost. */
function firestorePrintSelectedDutyDraft_(id,expectedDate,idToken){
 var cfg=firestorePrintConfigDraft_();
 // Fetch only this explicitly selected duty. If a newer Firestore version
 // appears during comparison, download its full content before printing.
 // Never replace phone originals, unrelated shifts or legacy Google originals.
 var previous=firestorePrintDocDraft_(cfg,id,idToken);
 if(expectedDate&&previous.packet.shift.date!==expectedDate)
  throw Error('日付指定した乗務と取得したFirestore原本の日付が一致しません');
 var lock=LockService.getScriptLock();
 if(!lock.tryLock(25000))throw Error('別の印刷転送が実行中です');
 try{
  var current=previous,stable=false;
  // A normal event sync may update Firestore between two server reads.
  // Only print when two complete consecutive reads match ID, revision,
  // content and print timestamp; never accept a stale first snapshot.
  for(var attempt=0;attempt<4;attempt++){
   var fetched=firestorePrintDocDraft_(cfg,id,idToken);
   if(expectedDate&&fetched.packet.shift.date!==expectedDate)
    throw Error('Firestore原本の乗務日が変わりました。自動印刷せず確認してください');
   if(fetched.revision<current.revision)
    throw Error('Firestore原本の更新番号が逆行しました。印刷元を変更しません');
   if(fetched.revision===current.revision&&
      JSON.stringify(fetched.packet)===JSON.stringify(current.packet)){
    stable=true;current=fetched;break;
   }
   if(fetched.revision===current.revision)
    throw Error('同一更新番号でFirestore原本の内容が異なります。印刷元を変更しません');
   current=fetched;
  }
  if(!stable)throw Error('Firestore原本が連続更新中のため照合できません。印刷元を変更しません');
  // The original Google sync storage and existing 2-page print forms
  // are NOT changed. Only the four existing print-source sheets receive rows.
  return savePacket_(current.packet,{firestorePrintOnly:true,
   firestoreRevision:current.revision,firestoreOwnerUid:cfg.uid,
   verifyCurrentSource:function(){
    var beforeIndex=firestorePrintDocDraft_(cfg,id,idToken);
    if(beforeIndex.revision!==current.revision||
       JSON.stringify(beforeIndex.packet)!==JSON.stringify(current.packet))
     throw Error('印刷元の公開直前にFirestore原本が更新されました。転送を停止します');
   }});
 }finally{lock.releaseLock();}
}
/** PC-only listing of this authenticated owner's completed Firestore duties.
 * No sheet reads/writes and no changes to B15/B17/C17. Date filtering is only
 * for the explicit PC menu, never for app startup or phone synchronization.
 */
function firestorePrintCandidatesDraft_(idToken){
 var cfg=firestorePrintConfigDraft_();
 var path='privateDuties/'+encodeURIComponent(cfg.uid)+'/shifts';
 var token='',seen={},candidates=[];
 for(var page=0;page<10;page++){
  var response=firestorePrintRestDraft_(cfg,path+'?pageSize=100'+(token?'&pageToken='+encodeURIComponent(token):''),idToken);
  (response.documents||[]).forEach(function(doc){
   var prefix='projects/'+cfg.project+'/databases/(default)/documents/privateDuties/'+cfg.uid+'/shifts/';
   var name=String(doc.name||'');
   if(name.indexOf(prefix)!==0)throw Error('印刷候補に本人以外のFirestore原本が含まれています');
   var id=name.slice(prefix.length);
   if(!/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(id)||seen[id])
    throw Error('Firestoreの印刷一覧に不正な乗務IDがあります');
   seen[id]=true;
   var data=firestorePrintDecodeDraft_({mapValue:{fields:doc.fields||{}}},0),shift=data.shift;
   if(data.trashed!==true&&data.format==='TAXIAPP_PRIVATE_SHIFT_V1'&&
      Number.isSafeInteger(data.revision)&&data.revision>=1&&
      shift&&shift.id===id&&(shift.endedAt||shift.endedIso)&&
      shift.__taxiPrintSummary&&Array.isArray(shift.records)&&
      shift.records.length<=60&&
      typeof shift.__taxiPrintSummary.meter==='number'&&
      Number.isFinite(shift.__taxiPrintSummary.meter)&&
      /^\d{4}-\d{2}-\d{2}$/.test(String(shift.date||''))){
    candidates.push({id:id,date:String(shift.date),
     startedAt:String(shift.startedAt||''),startedIso:String(shift.startedIso||''),
     records:shift.records.length,meter:shift.__taxiPrintSummary.meter,
     driver:String(shift.driver||'')});
   }
  });
  token=String(response.nextPageToken||'');
  if(!token)break;
  if(page===9)throw Error('Firestoreの件数が多く、未確認の乗務があります');
 }
 candidates.sort(function(a,b){
  return b.startedIso.localeCompare(a.startedIso)||b.id.localeCompare(a.id);
 });
 return candidates;
}
/** Convenience for new duties not yet present in the print dropdown. */
function firestorePrintLatestDutyDraft_(){
 var latest=firestorePrintCandidatesDraft_()[0];
 if(!latest)throw Error('Firestoreに印刷可能な入庫済み乗務が見つかりません');
 return firestorePrintSelectedDutyDraft_(latest.id);
}
/** Take a specific date and selected candidate instead of guessing "latest".
 * A new Firestore duty is NOT in B17's list until it is imported once.
 */
function firestorePrintDateChoicesDraft_(date){
 var input=String(date||'').trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input)||
    new Date(input+'T12:00:00Z').toISOString().slice(0,10)!==input)
  throw Error('乗務日はYYYY-MM-DD形式の正しい日付を入力してください');
 var items=firestorePrintCandidatesDraft_().filter(function(x){return x.date===input;});
 if(!items.length)throw Error('指定日に入庫済みのFirestore日報はありません');
 return items;
}
function firestorePrintDateMenuDraft_(){
 throw Error('安全のためGoogleシート単独からのFirestore読取を廃止しました。PCのTAXIAPPで本人ログインし、営業履歴から取込してください');
 var ui=SpreadsheetApp.getUi();
 var entry=ui.prompt('Firestore印刷用の乗務日','YYYY-MM-DD形式で入力してください。例：2026-10-22',ui.ButtonSet.OK_CANCEL);
 if(entry.getSelectedButton()!==ui.Button.OK)return;
 var date=String(entry.getResponseText()||'').trim();
 var options=firestorePrintDateChoicesDraft_(date);
 var lines=options.map(function(c,i){
  return (i+1)+'：出庫 '+(c.startedAt||'時刻不明')+
   '／'+c.records+'件／メーター '+c.meter.toLocaleString('ja-JP')+'円'+
   (c.driver?'／'+c.driver:'')+'／乗務ID '+c.id;
 });
 var selection=ui.prompt('Firestoreから印刷用に取り込む乗務を選択',
  date+' の入庫済み乗務：\n'+lines.join('\n')+
  '\n取り込む番号（1〜'+options.length+'）を入力してください。既存B15/B17/C17は変更しません。',
  ui.ButtonSet.OK_CANCEL);
 if(selection.getSelectedButton()!==ui.Button.OK)return;
 var picked=String(selection.getResponseText()||'').trim();
 if(!/^[1-9][0-9]*$/.test(picked)||Number(picked)>options.length)
  throw Error('乗務の選択番号が不正です。既存印刷元は変更していません');
 var chosen=options[Number(picked)-1];
 var result=firestorePrintSelectedDutyDraft_(chosen.id,date);
 SpreadsheetApp.openById(TAXIAPP_SHEET_ID).toast(result,'Firestore印刷取込',8);
 return result;
}

/** Separate PC menu; does NOT override or replace existing onOpen macros. */
function firestorePrintMenuDraft_(){
 SpreadsheetApp.getUi().createMenu('TAXIAPP Firebase取込')
  .addItem('取込手順：PCのTAXIAPPから行う','firestorePrintInstructionsDraft_')
  .addToUi();
}
function firestorePrintInstructionsDraft_(){
 SpreadsheetApp.getUi().alert('本人Firestore印刷取込',
  'PCでTAXIAPPに本人ログイン → 営業履歴 → 日付を指定してFirestoreから取得 → 対象乗務の「Google補助簿へ転送」を実行してください。取込後はこのシートのB15/B17で乗務を選びます。GoogleのIAMで全利用者の日報を読む権限は使いません。',
  SpreadsheetApp.getUi().ButtonSet.OK);
}
function firestorePrintLatestMenuDraft_(){
 throw Error('Google IAMで原本を取得しません。PCのTAXIAPPで本人ログインして取込してください');
 var result=firestorePrintLatestDutyDraft_();
 SpreadsheetApp.openById(TAXIAPP_SHEET_ID).toast(result,'Firebase印刷取込',8);
}
function firestorePrintChosenMenuDraft_(){
 throw Error('Google IAMで原本を取得しません。PCのTAXIAPPで本人ログインして取込してください');
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
