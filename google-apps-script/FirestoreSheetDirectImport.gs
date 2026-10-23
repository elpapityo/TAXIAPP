/**
 * TAXIAPP 本人Firestore → 既存Google補助簿
 * スプレッドシート上から選ぶ操作。既存の GAS v3 / 2ページ帳票は置換しない。
 *
 * Google IAM でDB全体を読まない。Google利用者の短期OpenID認証を
 * Firebase Auth RESTで本人UIDのIDトークンへ交換し、Firestore Rulesで読む。
 * この交換方式は本番Googleログインで未検証。失敗時は何も転送しない。
 *
 * 必須Script Properties（値をコードやGitHubへ書かない）:
 *  TAXIAPP_FIRESTORE_PROJECT_ID, TAXIAPP_FIRESTORE_OWNER_UID （既存）
 *  TAXIAPP_FIREBASE_WEB_API_KEY, TAXIAPP_PRINT_OWNER_EMAIL （追加）
 * OAuth scopes: spreadsheets, script.external_request, script.scriptapp,
 * openid, userinfo.email
 */
var TAXIAPP_FIRESTORE_BUTTON_SHEET_='TAXIAPP_印刷操作';
var TAXIAPP_FIRESTORE_BUTTON_CELL_='B20';
var TAXIAPP_FIRESTORE_DATE_CELL_='B30';
var TAXIAPP_FIRESTORE_ID_CELL_='B31';
var TAXIAPP_FIRESTORE_RESULT_CELL_='B32';

function firestoreSheetOwner_(eventUser){
 var p=PropertiesService.getScriptProperties();
 var owner=String(p.getProperty('TAXIAPP_PRINT_OWNER_EMAIL')||'').trim().toLowerCase();
 var active=String(Session.getActiveUser().getEmail()||'').trim().toLowerCase();
 var effective=String(Session.getEffectiveUser().getEmail()||'').trim().toLowerCase();
 if(!owner||!active||!effective||owner!==active||owner!==effective||
    (eventUser!==undefined&&String(eventUser||'').trim().toLowerCase()!==owner))
  throw Error('本人Googleアカウントでの操作を確認できません。Firestoreへの接続は中止しました');
 var apiKey=String(p.getProperty('TAXIAPP_FIREBASE_WEB_API_KEY')||'');
 if(!/^[A-Za-z0-9_-]{20,80}$/.test(apiKey))throw Error('Firebase Web APIキーが未設定です');
 return {email:owner,apiKey:apiKey};
}

function firestoreSheetFirebaseToken_(eventUser){
 var owner=firestoreSheetOwner_(eventUser),cfg=firestorePrintConfigDraft_();
 // Firebase accepts Google OpenID identity tokens. Apps Script's OAuth
 // access token is scoped for Google API access and is not the same thing.
 // getIdentityToken() requires the "openid" scope in appsscript.json.
 var googleIdToken=ScriptApp.getIdentityToken();
 if(typeof googleIdToken!=='string'||googleIdToken.split('.').length!==3)
  throw Error('Google IDトークンを取得できません。appsscript.json の openid 権限を確認してください');
 var url='https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key='+
  encodeURIComponent(owner.apiKey);
 var body={requestUri:'http://localhost',
  postBody:'id_token='+encodeURIComponent(googleIdToken)+'&providerId=google.com',
  returnSecureToken:true};
 var response=UrlFetchApp.fetch(url,{
  method:'post',contentType:'application/json',
  payload:JSON.stringify(body),muteHttpExceptions:true
 });
 // Expose ONLY a strict allowlisted Firebase error category. Never log
 // arbitrary provider text, OAuth tokens, Firebase ID tokens or identities.
 if(response.getResponseCode()!==200){
  var category='UNKNOWN';
  try{
   var returned=JSON.parse(response.getContentText());
   var rawCode=String(returned&&returned.error&&returned.error.message||'');
   // Firebase may append an explanation after the machine-readable error name.
   // Never show the suffix: it can contain provider identifiers or tokens.
   var prefix=rawCode.match(/^([A-Z][A-Z0-9_]{2,63})(?:\s|:|$)/);
   var code=prefix?prefix[1]:'';
   var allowed=['INVALID_IDP_RESPONSE','INVALID_CREDENTIAL','INVALID_GRANT',
    'OPERATION_NOT_ALLOWED','FEDERATED_USER_ID_ALREADY_LINKED',
    'EMAIL_EXISTS','INVALID_API_KEY','API_KEY_INVALID','PROJECT_NOT_FOUND',
    'INVALID_PROVIDER_ID','MISSING_REQUEST_URI',
    'INVALID_OAUTH_CLIENT_ID','INVALID_OAUTH_RESPONSE','INVALID_PENDING_TOKEN',
    'UNAUTHORIZED_DOMAIN','INVALID_IDENTIFIER',
    'INVALID_PASSWORD','TOO_MANY_ATTEMPTS_TRY_LATER'];
   if(allowed.indexOf(code)>=0)category=code;
   else if(code&&code.indexOf('INVALID_')===0)category=code;
  }catch(ignore){}
  throw Error('Firebase本人認証に失敗：HTTP '+response.getResponseCode()+
   '／理由 '+category+'。原本・印刷先は変更していません。');
 }
 var result=JSON.parse(response.getContentText());
 if(result.localId!==cfg.uid||
    String(result.email||'').toLowerCase()!==owner.email||
    result.emailVerified!==true||
    typeof result.idToken!=='string'||result.idToken.split('.').length!==3)
  throw Error('Googleログインと本人Firestore UIDが一致しません。取込を停止しました');
 return result.idToken; // not stored in sheets, properties, logs, or session cache.
}

function firestoreSheetCandidates_(date,idToken){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))||
    new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)
  throw Error('乗務日をYYYY-MM-DD形式で指定してください');
 var cfg=firestorePrintConfigDraft_();
 var fields=['format','revision','trashed','shift.id','shift.date',
  'shift.startedIso','shift.startedAt','shift.endedAt','shift.endedIso',
  'shift.__taxiPrintSummary.meter','shift.__taxiPrintSummary.records'];
 var url='https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(cfg.project)+
  '/databases/(default)/documents/privateDuties/'+encodeURIComponent(cfg.uid)+':runQuery';
 var body={structuredQuery:{
  from:[{collectionId:'shifts'}],select:{fields:fields.map(function(fieldPath){
   return {fieldPath:fieldPath};
  })},
  where:{fieldFilter:{field:{fieldPath:'shift.date'},op:'EQUAL',
   value:{stringValue:date}}}
 }};
 var response=UrlFetchApp.fetch(url,{
  method:'post',contentType:'application/json',
  payload:JSON.stringify(body),headers:{Authorization:'Bearer '+idToken},
  muteHttpExceptions:true
 });
 if(response.getResponseCode()!==200)
  throw Error('本人Firestore指定日の一覧が取得できません（HTTP '+response.getResponseCode()+'）');
 var rows=JSON.parse(response.getContentText());
 if(!Array.isArray(rows))throw Error('Firestore日報一覧の形式が不正です');
 var seen={},prefix='projects/'+cfg.project+'/databases/(default)/documents/privateDuties/'+cfg.uid+'/shifts/';
 var result=[];
 rows.forEach(function(entry){
  if(!entry.document)return;
  var doc=entry.document,name=String(doc.name||'');
  if(name.indexOf(prefix)!==0)throw Error('本人以外のUIDが取得結果に含まれています');
  var id=name.slice(prefix.length),record=firestorePrintDecodeDraft_(
   {mapValue:{fields:doc.fields||{}}},0),s=record.shift;
  if(!/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(id)||seen[id]||
     record.format!=='TAXIAPP_PRIVATE_SHIFT_V1'||s?.id!==id||
     !Number.isSafeInteger(record.revision)||record.revision<1||
     s?.date!==date)throw Error('FirestoreのID・版・日付が不正です');
  seen[id]=true;
  if(record.trashed||(!s.endedAt&&!s.endedIso))return;
  result.push({id:id,date:date,revision:record.revision,
   startedIso:String(s.startedIso||''),startedAt:String(s.startedAt||''),
   records:Number.isSafeInteger(s.__taxiPrintSummary?.records)?
    s.__taxiPrintSummary.records:null,
   meter:Number.isFinite(s.__taxiPrintSummary?.meter)?s.__taxiPrintSummary.meter:null});
 });
 if(result.length>30)throw Error('指定日に日報が多すぎるため、誤選択防止で停止しました');
 result.sort(function(a,b){return b.startedIso.localeCompare(a.startedIso)||b.id.localeCompare(a.id);});
 return result;
}

/**
 * Shared write path: same CAS, original readback and print-source protections
 * as the existing PC import. Never recompute money or select B17 automatically.
 */
function firestoreSheetCommitSelected_(picked,date,token){
 // The date list is metadata and can become stale before B20 is clicked.
 // Read the *entire* owner-authenticated duty and adopt a newer revision
 // for printing, but never a different ID/date or a revision rollback.
 var checked=firestorePrintDocDraft_(firestorePrintConfigDraft_(),picked.id,token);
 if(checked.packet.shift.date!==date||checked.id!==picked.id||
    checked.revision<picked.revision)
  throw Error('取得したFirestore原本の乗務ID・日付・更新番号が一致しません');
 // The selected-duty import itself re-reads the latest full server version
 // under the print lock and verifies the published rows; no stale overwrite.
 var result=firestorePrintSelectedDutyDraft_(picked.id,date,token);
 var ss=SpreadsheetApp.openById(TAXIAPP_SHEET_ID);
 var published=firestorePrintVerifyPublishedDraft_(ss,picked.id);
 if(published.id!==picked.id||published.date!==date||
    published.revision<checked.revision)
  throw Error('印刷元の読戻し結果がFirestore原本と一致しません');
 // Fresh server version check: do not advertise "complete" if a new event
 // happened after publication. The next operator action can safely recheck.
 var latest=firestorePrintDocDraft_(firestorePrintConfigDraft_(),picked.id,token);
 if(latest.revision!==published.revision||
    latest.packet.shift.date!==date)
  throw Error('転送後にFirestore原本が更新されました。印刷元の最新版照合が必要です');
 ss.toast('Firestoreの最新改版を印刷元へ転送・照合しました','TAXIAPP',8);
 return {id:picked.id,date:date,revision:published.revision,result:result};
}
/**
 * A checkbox edit trigger must not open modal prompts. B30/B31 hold
 * explicit date and optional exact ID. If the date has >1 completed duty,
 * do not guess or silently select the newest.
 */
function firestoreSheetCheckboxImport_(eventUser){
 firestoreSheetOwner_(eventUser);
 var page=SpreadsheetApp.openById(TAXIAPP_SHEET_ID)
  .getSheetByName(TAXIAPP_FIRESTORE_BUTTON_SHEET_);
 if(!page)throw Error('印刷操作シートがありません');
 var input=page.getRange(TAXIAPP_FIRESTORE_DATE_CELL_).getValue();
 var date=Object.prototype.toString.call(input)==='[object Date]'?
   Utilities.formatDate(input,'Asia/Tokyo','yyyy-MM-dd'):String(input||'').trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||
    new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)
  throw Error('B30へ正しい乗務日をYYYY-MM-DDで入力してください');
 var id=String(page.getRange(TAXIAPP_FIRESTORE_ID_CELL_).getDisplayValue()||'').trim();
 if(id&&!/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(id))
  throw Error('B31の乗務IDが不正です');
 var token=firestoreSheetFirebaseToken_(eventUser);
 var list=firestoreSheetCandidates_(date,token);
 if(!list.length)throw Error('指定日に入庫済みの日報はありません');
 var selected;
 if(id){
  selected=list.filter(function(d){return d.id===id;})[0];
  if(!selected)throw Error('B31の乗務IDが指定日にありません');
 }else{
  if(list.length!==1)throw Error('同日に複数の日報があります。B31へ乗務IDを入力してください');
  selected=list[0];
 }
 return firestoreSheetCommitSelected_(selected,date,token);
}

/**
 * Read-only preparation check. Require a successful owner Firebase login
 * before modifying even B20 or creating an installable trigger.
 * Never return, persist or log Google/Firebase authentication tokens.
 */
function firestoreSheetPreflight_(){
 var cfg=firestorePrintConfigDraft_();
 if(!cfg||!cfg.project||!cfg.uid)
  throw Error('本人FirestoreのプロジェクトとUIDを確認できません');
 if(typeof firestorePrintSelectedDutyDraft_!=='function'||
    typeof firestorePrintDocDraft_!=='function'||
    typeof TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS==='undefined')
  throw Error('Firestore印刷連携の本番GASファイルが揃っていません');
 // This exchange is read-only. An OAuth/Firebase failure must abort setup.
 var verifiedToken=firestoreSheetFirebaseToken_();
 if(!verifiedToken||typeof verifiedToken!=='string')
  throw Error('Firebase本人認証を確認できません');
 var ss=SpreadsheetApp.openById(TAXIAPP_SHEET_ID);
 var names=['TAXIAPP_同期原本','TAXIAPP_印刷操作','補助簿印刷用',
  '補助簿印刷用_2頁'];
 names.forEach(function(name){
  if(!ss.getSheetByName(name))
   throw Error('既存の印刷シートを確認できません：'+name);
 });
 Object.keys(TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS).forEach(function(name){
  var sheet=ss.getSheetByName(name);
  if(!sheet)throw Error('Firestore印刷元が見つかりません：'+name);
  var headings=TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS[name];
  var actual=sheet.getRange(1,1,1,headings.length).getValues()[0];
  if(JSON.stringify(actual)!==JSON.stringify(headings))
   throw Error('印刷元の見出しが既存仕様と違います：'+name);
 });
 // Do not include cfg.uid, owner email or token in the return value.
 return {ready:true,readOnly:true,checkedSheets:names.length+
  Object.keys(TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS).length};
}

/** This is the operation the spreadsheet menu/checkbox starts. */
function firestoreSheetDirectImport_(eventUser){
 var ui=SpreadsheetApp.getUi();
 // Verify the Google owner BEFORE prompting or fetching any private data.
 firestoreSheetOwner_(eventUser);
 var ask=ui.prompt('本人Firestoreから日報を取得','乗務日をYYYY-MM-DDで入力してください',ui.ButtonSet.OK_CANCEL);
 if(ask.getSelectedButton()!==ui.Button.OK)return {cancelled:true};
 var date=String(ask.getResponseText()||'').trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('乗務日の形式が不正です');
 var token=firestoreSheetFirebaseToken_(eventUser);
 var candidates=firestoreSheetCandidates_(date,token);
 if(!candidates.length){
  ui.alert('指定日に入庫済みの本人Firestore日報はありません');
  return {cancelled:true};
 }
 var menu=candidates.map(function(c,i){
  return (i+1)+'：'+(c.startedAt||'出庫時刻不明')+' ／ '+
   (c.records===null?'件数未記録':c.records+'件')+' ／ '+
   (c.meter===null?'金額未記録':c.meter.toLocaleString('ja-JP')+'円')+
   ' ／ '+c.id;
 }).join('\n');
 var selected=ui.prompt('Firestore日報を選択',
  date+'の入庫済み日報：\n'+menu+'\n取込番号を入力。補助簿2ページ・旧Google原本・B15/B17/C17は変更しません。',
  ui.ButtonSet.OK_CANCEL);
 if(selected.getSelectedButton()!==ui.Button.OK)return {cancelled:true};
 var raw=String(selected.getResponseText()||'').trim();
 if(!/^[1-9]\d*$/.test(raw)||Number(raw)>candidates.length)
  throw Error('乗務の選択番号が不正です');
 var picked=candidates[Number(raw)-1];
 var ok=ui.alert('選択した乗務の取込確認',
  picked.date+' ／ '+picked.id+'\n本人Firestore原本を読戻し、既存の印刷元4シートを更新します。\n' +
  '従来の補助簿2ページ、旧Google同期原本、選択セルB15/B17/C17は維持します。',
  ui.ButtonSet.OK_CANCEL);
 if(ok!==ui.Button.OK)return {cancelled:true};
 return firestoreSheetCommitSelected_(picked,date,token);
}

function firestoreSheetImportMenu_(){
 try{return firestoreSheetDirectImport_();}
 catch(error){
  SpreadsheetApp.getActiveSpreadsheet().toast(
   'Firestore取込停止：'+String(error.message||error).slice(0,180),'TAXIAPP',10);
  throw error;
 }
}
/**
 * One-time cleanup: remove only the obsolete standalone menu onOpen trigger.
 * Never delete the Firestore checkbox onEdit or any preexisting GAS trigger.
 * Does not read or mutate sales records, print sheets, or credentials.
 */
function cleanupFirestoreSheetMenuTrigger(){
 var removed=0;
 ScriptApp.getProjectTriggers().forEach(function(trigger){
  if(trigger.getHandlerFunction()==='firestoreSheetImportMenuCreate_'){
   ScriptApp.deleteTrigger(trigger);
   removed++;
  }
 });
 Logger.log('Firestoreの不要なメニュートリガー解除：'+removed+'件');
 return removed;
}

/** This GAS project is standalone, so a custom spreadsheet menu cannot be
 * displayed. Keep the obsolete handler as a no-op for existing triggers.
 * The B20 checkbox is the supported UI; legacy scripts stay intact.
 */
function firestoreSheetImportMenuCreate_(){
 // No SpreadsheetApp.getUi() from a standalone script.
}
/**
 * Installable onEdit trigger only (creator runs as owner).
 * e.user must be available and match the same pinned person, or reject.
 * Does not try to infer the latest duty and never auto-select B17.
 */
function firestoreSheetImportCheckboxEdit_(e){
 if(!e||!e.range||e.range.getA1Notation()!==TAXIAPP_FIRESTORE_BUTTON_CELL_||
    e.range.getSheet().getName()!==TAXIAPP_FIRESTORE_BUTTON_SHEET_||
    e.range.getSheet().getParent().getId()!==TAXIAPP_SHEET_ID||
    String(e.value||'')!=='TRUE')return;
 // A checkbox state isn't an acknowledgement of a successful transfer.
 e.range.setValue(false);
 var email=String(e.user?.getEmail?.()||''),page=e.range.getSheet();
 try{
  if(!email)throw Error('操作したGoogle利用者を識別できません。メニューから実行してください');
  page.getRange(TAXIAPP_FIRESTORE_RESULT_CELL_).setValue('取得中：Firestoreと原本を照合中');
  var done=firestoreSheetCheckboxImport_(email);
  page.getRange(TAXIAPP_FIRESTORE_RESULT_CELL_).setValue(
   '転送確認：'+done.date+' ／ '+done.id+' ／ 更新番号 '+done.revision);
  return done;
 }catch(error){
  page.getRange(TAXIAPP_FIRESTORE_RESULT_CELL_).setValue(
   '取込結果未確認・印刷元を確認：'+String(error.message||error).slice(0,105));
  SpreadsheetApp.openById(TAXIAPP_SHEET_ID).toast(
   'Firestore取込停止：'+String(error.message||error).slice(0,170),'TAXIAPP',10);
  throw error;
 }
}
/**
 * Owner runs this only after installing/reviewing the GAS files and setting
 * the two new Script Properties; duplicates are not added on repeated setup.
 */
function setupFirestoreSheetImportButton_(){
 // Validate live authentication and all four print sources before *any*
 // checkbox, label or trigger change. A failed OAuth exchange leaves the
 // existing spreadsheet operations untouched.
 firestoreSheetPreflight_();
 var ss=SpreadsheetApp.openById(TAXIAPP_SHEET_ID);
 var page=ss.getSheetByName(TAXIAPP_FIRESTORE_BUTTON_SHEET_);
 if(!page)throw Error('印刷操作シートがありません');
 if(typeof firestorePrintSelectedDutyDraft_!=='function'||
    typeof firestorePrintDocDraft_!=='function')
  throw Error('Firestore印刷連携3ファイルが未導入です');
 // Idempotent setup. Never overwrite another user's cells or formulas.
 var present=page.getRange('A30').getDisplayValue()==='取得する乗務日（YYYY-MM-DD）'&&
  page.getRange('A31').getDisplayValue()==='乗務ID（同日に複数乗務がある場合）'&&
  page.getRange('A32').getDisplayValue()==='Firestore取得結果';
 if(!present)['A30','B30','A31','B31','A32','B32'].forEach(function(a1){
  var cell=page.getRange(a1);
  if(cell.getValue()!==''||cell.getFormula())
   throw Error('新しいFirestore操作欄に既存値があります：'+a1+'。変更せず中止します');
 });
 var handlers=ScriptApp.getProjectTriggers().map(function(t){return t.getHandlerFunction();});
 if(handlers.indexOf('firestoreSheetImportCheckboxEdit_')<0)
  ScriptApp.newTrigger('firestoreSheetImportCheckboxEdit_').forSpreadsheet(ss).onEdit().create();
 // Do not install an onOpen menu trigger from a standalone project.
 var range=page.getRange(TAXIAPP_FIRESTORE_BUTTON_CELL_);
 range.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
 range.setValue(false);
 range.setNote('B30の日付を指定し、同日に複数乗務がある場合はB31に乗務IDを入力してチェックしてください。');
 page.getRange('A20').setValue('Firestore取得 ▶');
 page.getRange('A30').setValue('取得する乗務日（YYYY-MM-DD）');
 page.getRange('A31').setValue('乗務ID（同日に複数乗務がある場合）');
 page.getRange('A32').setValue('Firestore取得結果');
 if(!present)page.getRange('B32').setValue('未実行：B30の日付入力後にB20をチェック');
 ss.toast('Firestore取得ボタンを設定しました。取込前に本人Google認証を確認します','TAXIAPP',7);
}
