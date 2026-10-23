/**
 * TAXIAPP 本人Firestore → 既存Google補助簿
 * スプレッドシート上から選ぶ操作。既存の GAS v3 / 2ページ帳票は置換しない。
 *
 * Google IAM でDB全体を読まない。Google利用者の短期OAuth認証を
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
 var googleToken=ScriptApp.getOAuthToken();
 if(!googleToken)throw Error('本人のGoogleログイントークンを取得できません');
 var url='https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key='+
  encodeURIComponent(owner.apiKey);
 var body={requestUri:'https://elpapityo.github.io/TAXIAPP/',
  postBody:'access_token='+encodeURIComponent(googleToken)+'&providerId=google.com',
  returnSecureToken:true};
 var response=UrlFetchApp.fetch(url,{
  method:'post',contentType:'application/json',
  payload:JSON.stringify(body),muteHttpExceptions:true
 });
 // Do not include Google/Firebase tokens, response contents or personal data in errors.
 if(response.getResponseCode()!==200)
  throw Error('GoogleアカウントとFirebase本人UIDを連携できません。未転送のまま停止しました（HTTP '+
   response.getResponseCode()+'）。PCのTAXIAPP本人ログイン方式をご利用ください');
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
 // Existing implementation verifies full original before lock, inside lock
 // and before publication, and uses only the existing computed packet.
 var verified=firestorePrintDocDraft_(firestorePrintConfigDraft_(),picked.id,token);
 if(verified.revision!==picked.revision||verified.packet.shift.date!==date)
  throw Error('原本の更新番号が変わりました。再取得してください');
 var result=firestorePrintSelectedDutyDraft_(picked.id,date,token);
 var ss=SpreadsheetApp.openById(TAXIAPP_SHEET_ID);
 ss.toast('Firestore印刷元の転送が完了しました。B15/B17で対象乗務を選択してください','TAXIAPP',8);
 return {id:picked.id,date:date,revision:picked.revision,result:result};
}

function firestoreSheetImportMenu_(){
 try{return firestoreSheetDirectImport_();}
 catch(error){
  SpreadsheetApp.getActiveSpreadsheet().toast(
   'Firestore取込停止：'+String(error.message||error).slice(0,180),'TAXIAPP',10);
  throw error;
 }
}
/** Does not replace existing onOpen, onEdit or legacy macros. */
function firestoreSheetImportMenuCreate_(){
 SpreadsheetApp.getUi().createMenu('TAXIAPP Fire取得')
  .addItem('Firestoreから日報を取得・印刷元に反映','firestoreSheetImportMenu_')
  .addToUi();
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
 var email=String(e.user?.getEmail?.()||'');
 try{
  if(!email)throw Error('操作したGoogle利用者を識別できません。メニューから実行してください');
  return firestoreSheetDirectImport_(email);
 }catch(error){
  SpreadsheetApp.getActiveSpreadsheet().toast(
   'Firestore取込未実行：'+String(error.message||error).slice(0,180),'TAXIAPP',10);
  throw error;
 }
}
/**
 * Owner runs this only after installing/reviewing the GAS files and setting
 * the two new Script Properties; duplicates are not added on repeated setup.
 */
function setupFirestoreSheetImportButton_(){
 firestoreSheetOwner_();
 var ss=SpreadsheetApp.openById(TAXIAPP_SHEET_ID);
 var page=ss.getSheetByName(TAXIAPP_FIRESTORE_BUTTON_SHEET_);
 if(!page)throw Error('印刷操作シートがありません');
 if(typeof firestorePrintSelectedDutyDraft_!=='function'||
    typeof firestorePrintDocDraft_!=='function')
  throw Error('Firestore印刷連携3ファイルが未導入です');
 var handlers=ScriptApp.getProjectTriggers().map(function(t){return t.getHandlerFunction();});
 if(handlers.indexOf('firestoreSheetImportCheckboxEdit_')<0)
  ScriptApp.newTrigger('firestoreSheetImportCheckboxEdit_').forSpreadsheet(ss).onEdit().create();
 if(handlers.indexOf('firestoreSheetImportMenuCreate_')<0)
  ScriptApp.newTrigger('firestoreSheetImportMenuCreate_').forSpreadsheet(ss).onOpen().create();
 var range=page.getRange(TAXIAPP_FIRESTORE_BUTTON_CELL_);
 range.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
 range.setValue(false);
 range.setNote('チェック後に本人Google/Firebase認証で日付・乗務を選択して取得。未導入のGASでは実行されません。');
 page.getRange('A20').setValue('Firestore取得 ▶');
 firestoreSheetImportMenuCreate_();
 ss.toast('Firestore取得ボタンを設定しました。取込前に本人Google認証を確認します','TAXIAPP',7);
}
