/** GPS専用・別Apps Scriptプロジェクト。未配置。
 * 既存の日報/印刷用プロジェクトには追加しない。
 * Google OAuth/IAMを使うのは固定のGPSプロジェクトだけ。
 * 日報側は本人のFirebase ID tokenでusers/admins/deviceSessionsを読むだけ。
 * トークン・メール・位置をログやプロパティへ保存しない。
 * 現在の公開対象はlinkのみ。7履歴関数の代替実装ではない。
 */
var GPS_BRIDGE_DIARY_='taxiapp-2b6bd';
var GPS_BRIDGE_GPS_='taxigps-9f82e';
var GPS_BRIDGE_KEYS_={
 'taxiapp-2b6bd':'AIzaSyAlM4nexubaxLJn02uduKgdVsuPuvSw0Ts',
 'taxigps-9f82e':'AIzaSyAKHiwHrgOFhNLMKeL_Yv_WBUu1J8p5DCY'
};
var GPS_BRIDGE_UID_=/^[a-zA-Z0-9_-]{1,128}$/;
function gpsBridgeFail_(code){var e=new Error(code);e.gpsCode=code;throw e;}
function gpsBridgeJson_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function doGet(){return gpsBridgeJson_({ok:true,service:'TAXIAPP_GPS_IDENTITY_V1',actions:['link']});}
function doPost(event){
 try{
  var raw=event&&event.postData&&event.postData.contents;
  if(typeof raw!=='string'||raw.length>24000)gpsBridgeFail_('invalid-argument');
  var data;try{data=JSON.parse(raw);}catch(e){gpsBridgeFail_('invalid-argument');}
  if(!data||data.action!=='link')gpsBridgeFail_('invalid-argument');
  return gpsBridgeJson_({ok:true,data:gpsBridgeLink_(data)});
 }catch(e){
  // 外部応答や例外本文は、認証情報を含む可能性があるため返さない。
  return gpsBridgeJson_({ok:false,code:e&&e.gpsCode||'unavailable'});
 }
}
function gpsBridgeRequest_(url,method,token,body,allowMissing){
 var options={method:method,muteHttpExceptions:true,followRedirects:false};
 if(token)options.headers={Authorization:'Bearer '+token};
 if(body!==undefined){options.contentType='application/json';options.payload=JSON.stringify(body);}
 var response=UrlFetchApp.fetch(url,options),status=response.getResponseCode();
 if(status===404&&allowMissing)return null;
 if(status!==200)gpsBridgeFail_(status===401||status===403?'permission-denied':'unavailable');
 try{return JSON.parse(response.getContentText());}catch(e){gpsBridgeFail_('unavailable');}
}
function gpsBridgeVerified_(project,token){
 if(typeof token!=='string'||token.length<100||token.length>8192||token.split('.').length!==3)
  gpsBridgeFail_('unauthenticated');
 // JWT decodeは事前拒否と応答照合に使う。これだけを本人確認には使わない。
 var claims;
 try{claims=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(token.split('.')[1])).getDataAsString('UTF-8'));}
 catch(e){gpsBridgeFail_('unauthenticated');}
 var now=Math.floor(Date.now()/1000);
 if(claims.aud!==project||claims.iss!=='https://securetoken.google.com/'+project||
    typeof claims.sub!=='string'||!GPS_BRIDGE_UID_.test(claims.sub)||
    !Number.isSafeInteger(claims.exp)||claims.exp<=now||
    !Number.isSafeInteger(claims.iat)||claims.iat>now||
    !Number.isSafeInteger(claims.auth_time)||claims.auth_time>now||
    claims.firebase&&claims.firebase.tenant||
    !claims.firebase||claims.firebase.sign_in_provider!=='google.com')gpsBridgeFail_('unauthenticated');
 // Googleのaccounts:lookupがトークンを検証。失敗時は日報/位置DBにアクセスしない。
 var result=gpsBridgeRequest_('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+GPS_BRIDGE_KEYS_[project],
  'post',null,{idToken:token});
 if(!result.users||result.users.length!==1)gpsBridgeFail_('unauthenticated');
 var user=result.users[0];
 if(user.localId!==claims.sub||user.disabled===true||user.emailVerified!==true||
    typeof user.email!=='string'||!user.email||claims.email!==user.email||claims.email_verified!==true)
  gpsBridgeFail_('unauthenticated');
 // auth_timeより後に全トークン失効が指定されたアカウントも拒否。
 if(user.validSince!==undefined&&(!Number.isSafeInteger(Number(user.validSince))||Number(user.validSince)>claims.auth_time))
  gpsBridgeFail_('unauthenticated');
 var providers=(user.providerUserInfo||[]).filter(function(p){return p.providerId==='google.com';});
 var subjects=claims.firebase.identities&&claims.firebase.identities['google.com'];
 if(providers.length!==1||typeof providers[0].rawId!=='string'||!providers[0].rawId||
    !Array.isArray(subjects)||subjects.length!==1||subjects[0]!==providers[0].rawId)
  gpsBridgeFail_('unauthenticated');
 return {uid:user.localId,subject:providers[0].rawId,email:user.email};
}
function gpsBridgeFields_(document){
 if(!document)return null;
 var out={};Object.keys(document.fields||{}).forEach(function(key){
  var field=document.fields[key];
  if('stringValue' in field)out[key]=field.stringValue;
  else if('booleanValue' in field)out[key]=field.booleanValue;
  else if('timestampValue' in field)out[key]=Date.parse(field.timestampValue);
 });return out;
}
function gpsBridgeName_(project,path){
 if(project!==GPS_BRIDGE_DIARY_&&project!==GPS_BRIDGE_GPS_)gpsBridgeFail_('invalid-argument');
 if(!/^(users|admins|deviceSessions|gpsAccountLinks)\/[a-zA-Z0-9_-]{1,128}$/.test(path))gpsBridgeFail_('invalid-argument');
 if(project===GPS_BRIDGE_DIARY_&&path.indexOf('gpsAccountLinks/')===0)gpsBridgeFail_('invalid-argument');
 return 'projects/'+project+'/databases/(default)/documents/'+path;
}
function gpsBridgeRead_(project,path,token){
 return gpsBridgeRequest_('https://firestore.googleapis.com/v1/'+gpsBridgeName_(project,path),'get',token,undefined,true);
}
function gpsBridgeWrite_(path,fields,prior){
 var encoded={};Object.keys(fields).forEach(function(key){
  var value=fields[key];encoded[key]=typeof value==='boolean'?{booleanValue:value}:{stringValue:String(value)};
 });
 return {update:{name:gpsBridgeName_(GPS_BRIDGE_GPS_,path),fields:encoded},
  currentDocument:prior?{updateTime:prior.updateTime}:{exists:false},
  updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]};
}
function gpsBridgeLink_(request){
 var source=gpsBridgeVerified_(GPS_BRIDGE_DIARY_,request.diaryIdToken);
 var target=gpsBridgeVerified_(GPS_BRIDGE_GPS_,request.gpsIdToken);
 if(source.subject!==target.subject||source.email!==target.email)gpsBridgeFail_('account-mismatch');
 var writer=request.writerSessionId===undefined?null:request.writerSessionId;
 if(writer!==null&&(typeof writer!=='string'||writer.length<32||writer.length>128||!/^[a-zA-Z0-9_-]+$/.test(writer)))
  gpsBridgeFail_('invalid-argument');
 // 日報原本/売上/設定/Sheetsは読まない。日報には本人トークンだけを使う。
 var profile=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_DIARY_,'users/'+source.uid,request.diaryIdToken));
 var admin=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_DIARY_,'admins/'+source.uid,request.diaryIdToken));
 var isAdmin=!!(admin&&admin.enabled===true);
 if(!(profile&&profile.status==='active')&&!isAdmin)gpsBridgeFail_('permission-denied');
 var session=null;
 if(writer!==null){
  session=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_DIARY_,'deviceSessions/'+source.uid,request.diaryIdToken));
  if(!session||session.sessionId!==writer)gpsBridgeFail_('not-editor');
 }
 var lock=LockService.getScriptLock();if(!lock.tryLock(5000))gpsBridgeFail_('busy');
 try{
  var ownerToken=ScriptApp.getOAuthToken();
  // このOAuthトークンを日報プロジェクトに送るコードは禁止。
  var priorUser=gpsBridgeRead_(GPS_BRIDGE_GPS_,'users/'+target.uid,ownerToken);
  var priorLink=gpsBridgeRead_(GPS_BRIDGE_GPS_,'gpsAccountLinks/'+source.uid,ownerToken);
  var priorAdmin=gpsBridgeRead_(GPS_BRIDGE_GPS_,'admins/'+target.uid,ownerToken);
  var user=gpsBridgeFields_(priorUser),link=gpsBridgeFields_(priorLink);
  if(user&&(user.diaryUid!==source.uid||user.googleSubject!==source.subject)||
     link&&(link.gpsUid!==target.uid||link.googleSubject!==source.subject))gpsBridgeFail_('link-conflict');
  // 最小限の対応表だけ。メール・トークン・日報内容・座標は保存しない。
  var name=String(profile&&profile.openChatName||'登録利用者').slice(0,80);
  var writes=[gpsBridgeWrite_('users/'+target.uid,{status:'active',openChatName:name,diaryUid:source.uid,googleSubject:source.subject},priorUser),
   gpsBridgeWrite_('gpsAccountLinks/'+source.uid,{gpsUid:target.uid,googleSubject:source.subject},priorLink),
   gpsBridgeWrite_('admins/'+target.uid,{enabled:isAdmin,diaryUid:source.uid},priorAdmin)];
  if(writer!==null){
   var priorSession=gpsBridgeRead_(GPS_BRIDGE_GPS_,'deviceSessions/'+target.uid,ownerToken);
   writes.push(gpsBridgeWrite_('deviceSessions/'+target.uid,{sessionId:writer},priorSession));
  }
  gpsBridgeRequest_('https://firestore.googleapis.com/v1/projects/'+GPS_BRIDGE_GPS_+'/databases/(default)/documents:commit',
   'post',ownerToken,{writes:writes});
  var saved=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_GPS_,'users/'+target.uid,ownerToken));
  var savedLink=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_GPS_,'gpsAccountLinks/'+source.uid,ownerToken));
  var savedAdmin=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_GPS_,'admins/'+target.uid,ownerToken));
  var savedSession=writer===null?null:gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_GPS_,'deviceSessions/'+target.uid,ownerToken));
  if(!saved||saved.status!=='active'||saved.diaryUid!==source.uid||saved.googleSubject!==source.subject||
     !savedLink||savedLink.gpsUid!==target.uid||savedLink.googleSubject!==source.subject||
     !savedAdmin||savedAdmin.enabled!==isAdmin||savedAdmin.diaryUid!==source.uid||
     writer!==null&&(!savedSession||savedSession.sessionId!==writer))gpsBridgeFail_('readback-mismatch');
  // 期限はこの応答の再使用可能時間。Firestoreの資格失効を自動処理した意味ではない。
  return {diaryUid:source.uid,gpsUid:target.uid,writerSessionId:writer,validUntilMs:Date.now()+300000};
 }finally{lock.releaseLock();}
}
