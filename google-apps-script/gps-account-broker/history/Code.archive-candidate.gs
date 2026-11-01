/** GPS専用・別Apps Scriptプロジェクト。公開版の更新候補（本変更は未配置）。
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
var GPS_BRIDGE_LEASE_MS_=300000;
var GPS_BRIDGE_UID_=/^[a-zA-Z0-9_-]{1,128}$/;
function gpsBridgeFail_(code){var e=new Error(code);e.gpsCode=code;throw e;}
function gpsBridgeJson_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function doGet(){return gpsBridgeJson_({ok:true,service:'TAXIAPP_GPS_IDENTITY_V1',revision:'history-v4-archive',actions:['link'].concat(GPS_HISTORY_ACTIONS_),historyTrialOnly:GPS_HISTORY_TRIAL_ONLY_});}
function doPost(event){
 try{
  var raw=event&&event.postData&&event.postData.contents;
  if(typeof raw!=='string'||raw.length>850000||Utilities.newBlob(raw).getBytes().length>850000)gpsBridgeFail_('invalid-argument');
  var data;try{data=JSON.parse(raw);}catch(e){gpsBridgeFail_('invalid-argument');}
  if(!data||typeof data.action!=='string')gpsBridgeFail_('invalid-argument');
  if(data.action==='link'&&raw.length>24000)gpsBridgeFail_('invalid-argument');
  return gpsBridgeJson_({ok:true,data:data.action==='link'?gpsBridgeLink_(data):gpsHistoryDispatch_(data)});
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
function gpsBridgeWrite_(path,fields,prior,timestamps){
 var encoded={};Object.keys(fields).forEach(function(key){
  var value=fields[key];encoded[key]=typeof value==='boolean'?{booleanValue:value}:{stringValue:String(value)};
 });
 Object.keys(timestamps||{}).forEach(function(key){encoded[key]={timestampValue:new Date(timestamps[key]).toISOString()};});
 return {update:{name:gpsBridgeName_(GPS_BRIDGE_GPS_,path),fields:encoded},
  currentDocument:prior?{updateTime:prior.updateTime}:{exists:false},
  updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]};
}
// 本人tokenで毎回日報の現在資格を確認。通信/読取失敗を有効扱いしない。
function gpsBridgeSource_(source,request,writer){
 var profile=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_DIARY_,'users/'+source.uid,request.diaryIdToken));
 var admin=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_DIARY_,'admins/'+source.uid,request.diaryIdToken));
 var isAdmin=!!(admin&&admin.enabled===true);
 var eligible=!!(profile&&profile.status==='active')||isAdmin;
 var editor=false;
 if(eligible&&writer!==null){
  var session=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_DIARY_,'deviceSessions/'+source.uid,request.diaryIdToken));
  editor=!!(session&&session.sessionId===writer);
 }
 return {eligible:eligible,isAdmin:isAdmin,editor:editor,name:String(profile&&profile.openChatName||'登録利用者').slice(0,80)};
}
function gpsBridgeCommit_(ownerToken,writes){
 gpsBridgeRequest_('https://firestore.googleapis.com/v1/projects/'+GPS_BRIDGE_GPS_+'/databases/(default)/documents:commit',
  'post',ownerToken,{writes:writes});
}
// 対応済み本人だけを失効。新規の拒否要求で資格文書を作らない。
function gpsBridgeRevoke_(source,target,ownerToken){
 var prior=gpsBridgeRead_(GPS_BRIDGE_GPS_,'users/'+target.uid,ownerToken),user=gpsBridgeFields_(prior);
 if(!user)return;
 if(user.diaryUid!==source.uid||user.googleSubject!==source.subject)gpsBridgeFail_('link-conflict');
 var admin=gpsBridgeRead_(GPS_BRIDGE_GPS_,'admins/'+target.uid,ownerToken);
 gpsBridgeCommit_(ownerToken,[
  gpsBridgeWrite_('users/'+target.uid,{status:'suspended',openChatName:user.openChatName||'登録利用者',
   diaryUid:source.uid,googleSubject:source.subject,isAdmin:false},prior,{accessExpiresAt:0}),
  gpsBridgeWrite_('admins/'+target.uid,{enabled:false,diaryUid:source.uid},admin,{accessExpiresAt:0})]);
}
function gpsBridgeRevokeWriter_(source,target,writer,ownerToken){
 var user=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_GPS_,'users/'+target.uid,ownerToken));
 if(!user)return;
 if(user.diaryUid!==source.uid||user.googleSubject!==source.subject)gpsBridgeFail_('link-conflict');
 var prior=gpsBridgeRead_(GPS_BRIDGE_GPS_,'deviceSessions/'+target.uid,ownerToken),session=gpsBridgeFields_(prior);
 // 古い端末の失敗で、新しい端末のセッションを失効させない。
 if(session&&session.sessionId===writer){
  gpsBridgeCommit_(ownerToken,[gpsBridgeWrite_('deviceSessions/'+target.uid,
   {sessionId:writer,diaryUid:source.uid},prior,{accessExpiresAt:0})]);
 }
}
function gpsBridgeLink_(request){
 var source=gpsBridgeVerified_(GPS_BRIDGE_DIARY_,request.diaryIdToken);
 var target=gpsBridgeVerified_(GPS_BRIDGE_GPS_,request.gpsIdToken);
 if(source.subject!==target.subject||source.email!==target.email)gpsBridgeFail_('account-mismatch');
 var writer=request.writerSessionId===undefined?null:request.writerSessionId;
 if(writer!==null&&(typeof writer!=='string'||writer.length<32||writer.length>128||!/^[a-zA-Z0-9_-]+$/.test(writer)))
  gpsBridgeFail_('invalid-argument');
 var lock=LockService.getScriptLock();if(!lock.tryLock(5000))gpsBridgeFail_('busy');
 try{
  // ロック待機前の資格スナップショットを使わない。
  var checkedAt=Date.now(),eligibility=gpsBridgeSource_(source,request,writer);
  var ownerToken=ScriptApp.getOAuthToken();
  if(!eligibility.eligible){gpsBridgeRevoke_(source,target,ownerToken);gpsBridgeFail_('permission-denied');}
  if(writer!==null&&!eligibility.editor){gpsBridgeRevokeWriter_(source,target,writer,ownerToken);gpsBridgeFail_('not-editor');}
  var expires=checkedAt+GPS_BRIDGE_LEASE_MS_;
  // このOAuthトークンを日報プロジェクトに送るコードは禁止。
  var priorUser=gpsBridgeRead_(GPS_BRIDGE_GPS_,'users/'+target.uid,ownerToken);
  var priorLink=gpsBridgeRead_(GPS_BRIDGE_GPS_,'gpsAccountLinks/'+source.uid,ownerToken);
  var priorAdmin=gpsBridgeRead_(GPS_BRIDGE_GPS_,'admins/'+target.uid,ownerToken);
  var user=gpsBridgeFields_(priorUser),link=gpsBridgeFields_(priorLink);
  if(user&&(user.diaryUid!==source.uid||user.googleSubject!==source.subject)||
     link&&(link.gpsUid!==target.uid||link.googleSubject!==source.subject))gpsBridgeFail_('link-conflict');
  // accessExpiresAtはサーバーが決める絶対期限。クライアントの期限/資格は採用しない。
  var writes=[gpsBridgeWrite_('users/'+target.uid,{status:'active',openChatName:eligibility.name,
    diaryUid:source.uid,googleSubject:source.subject,isAdmin:eligibility.isAdmin},priorUser,{accessExpiresAt:expires}),
   gpsBridgeWrite_('gpsAccountLinks/'+source.uid,{gpsUid:target.uid,googleSubject:source.subject},priorLink),
   gpsBridgeWrite_('admins/'+target.uid,{enabled:eligibility.isAdmin,diaryUid:source.uid},priorAdmin,{accessExpiresAt:expires})];
  if(writer!==null){
   var priorSession=gpsBridgeRead_(GPS_BRIDGE_GPS_,'deviceSessions/'+target.uid,ownerToken);
   writes.push(gpsBridgeWrite_('deviceSessions/'+target.uid,{sessionId:writer,diaryUid:source.uid},priorSession,{accessExpiresAt:expires}));
  }
  if(expires<=Date.now())gpsBridgeFail_('permission-denied');
  gpsBridgeCommit_(ownerToken,writes);
  var saved=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_GPS_,'users/'+target.uid,ownerToken));
  var savedLink=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_GPS_,'gpsAccountLinks/'+source.uid,ownerToken));
  var savedAdmin=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_GPS_,'admins/'+target.uid,ownerToken));
  var savedSession=writer===null?null:gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_GPS_,'deviceSessions/'+target.uid,ownerToken));
  if(!saved||saved.status!=='active'||saved.diaryUid!==source.uid||saved.googleSubject!==source.subject||
     saved.isAdmin!==eligibility.isAdmin||saved.accessExpiresAt!==expires||
     !savedLink||savedLink.gpsUid!==target.uid||savedLink.googleSubject!==source.subject||
     !savedAdmin||savedAdmin.enabled!==eligibility.isAdmin||savedAdmin.diaryUid!==source.uid||savedAdmin.accessExpiresAt!==expires||
     writer!==null&&(!savedSession||savedSession.sessionId!==writer||savedSession.diaryUid!==source.uid||savedSession.accessExpiresAt!==expires))
   gpsBridgeFail_('readback-mismatch');
  // 保存/読戻し中に資格/操作端末が変化した場合も成功を返さない。
  var latest=gpsBridgeSource_(source,request,writer);
  if(!latest.eligible||latest.isAdmin!==eligibility.isAdmin){
   gpsBridgeRevoke_(source,target,ownerToken);gpsBridgeFail_('permission-denied');
  }
  if(writer!==null&&!latest.editor){gpsBridgeRevokeWriter_(source,target,writer,ownerToken);gpsBridgeFail_('not-editor');}
  if(expires<=Date.now())gpsBridgeFail_('permission-denied');
  // 停止側から更新要求が来ない場合も、ルール側がこの期限で新規アクセスを拒否する。
  // 別プロジェクトの変更通知ではないため、日報側変更の即時失効は保証しない。
  return {diaryUid:source.uid,gpsUid:target.uid,writerSessionId:writer,validUntilMs:expires};
 }finally{lock.releaseLock();}
}

// 同じ共有検証ソースを埋込み。Apps ScriptではUTF-8容量検査だけを補う。
var gpsHistoryValidationCache_;
function gpsHistoryValidation_(){
if(gpsHistoryValidationCache_)return gpsHistoryValidationCache_;
var module={exports:{}};
var TextEncoder=function(){};TextEncoder.prototype.encode=function(s){return Utilities.newBlob(s).getBytes();};
/* GPS履歴の端末・サーバー共通検証。営業距離・料金計算には使用しない。 */
(function(root){'use strict';
const FORMAT='TAXIAPP_GPS_HISTORY_V1';
const MAX_BYTES=780000;
const SHIFT=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
const encoder=new TextEncoder();
function retentionDeadlineMs(endedAtMs){
 if(!Number.isFinite(endedAtMs)||endedAtMs<=0)throw Error('入庫日時が未確認です');
 const d=new Date(endedAtMs+9*3600000);
 const y=d.getUTCFullYear(),m=d.getUTCMonth()+1,day=d.getUTCDate();
 const lastDay=new Date(Date.UTC(y,m+1,0)).getUTCDate();
 // Same day in following month, or last valid day, through 23:59:59 JST.
 return Date.UTC(y,m,Math.min(day,lastDay)+1)-9*3600000-1;
}
function prepare(row){
 if(!row||!row.uid||!SHIFT.test(String(row.shiftId||''))||
    !Number.isSafeInteger(row.startedAtMs)||row.startedAtMs<=0||!Number.isSafeInteger(row.endedAtMs)||
    row.endedAtMs<row.startedAtMs||!Array.isArray(row.points)||!row.points.length||row.points.length>2500)
   throw Error('入庫済みのGPS走行履歴ではありません');
 let priorTime=row.startedAtMs-1,priorSegment=1;
 const points=row.points.map(p=>{
  if(!Number.isSafeInteger(p.capturedAtMs)||p.capturedAtMs<row.startedAtMs||
     p.capturedAtMs>row.endedAtMs||p.capturedAtMs<=priorTime||!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||
     Math.abs(p.lat)>90||Math.abs(p.lon)>180||!Number.isFinite(p.accuracy)||
     p.accuracy<0||
     (p.speed!=null&&(!Number.isFinite(p.speed)||p.speed<0))||
     (p.heading!=null&&(!Number.isFinite(p.heading)||p.heading<0||p.heading>=360))||
     !Number.isInteger(p.segmentNo)||p.segmentNo<priorSegment)
    throw Error('不正なGPS測位点が含まれています');
  priorTime=p.capturedAtMs;priorSegment=p.segmentNo;
  return {
   capturedAtMs:p.capturedAtMs,lat:p.lat,lon:p.lon,accuracy:p.accuracy,
   speed:p.speed==null?null:p.speed,heading:p.heading==null?null:p.heading,
   suspectedJump:p.suspectedJump===true,segmentNo:p.segmentNo
  };
 });
 const payload={format:FORMAT,shiftId:row.shiftId,startedAtMs:row.startedAtMs,
  endedAtMs:row.endedAtMs,points};
 if(encoder.encode(JSON.stringify(payload)).length>MAX_BYTES)
  throw Error('GPS履歴がクラウド保存上限を超えています。端末履歴を保持します');
 return payload;
}
const api=Object.freeze({FORMAT,MAX_BYTES,SHIFT,prepare,retentionDeadlineMs});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.TAXIAPP_GPS_HISTORY_VALIDATION=api;
})(typeof window!=='undefined'?window:globalThis);

return gpsHistoryValidationCache_=module.exports;
}

/** 無料GPS履歴バックエンドの更新候補。本番未配置。日報原本にはアクセスしない。 */
var GPS_HISTORY_ACTIONS_=['saveOwnGpsHistory','getOwnGpsHistory','listOwnGpsHistory','getOwnGpsHistoryTombstone',
 'adminViewGpsHistory','adminExportGpsHistory','adminListGpsHistory','adminListGpsHistoryAudit','deleteGpsHistory','recordOwnGpsCsvAudit'];
var GPS_HISTORY_TRIAL_ONLY_=false; // 保存済み履歴の手動操作用。測位/位置共有は開始しない。
function gpsHistoryTrialId_(id){return typeof id==='string'&&/^shift-[0-9]+-gastrial[a-f0-9]{32}$/.test(id);}
function gpsHistoryTrialPayload_(payload){return payload&&gpsHistoryTrialId_(payload.shiftId)&&Array.isArray(payload.points)&&payload.points.length===1&&payload.points[0].lat===0&&payload.points[0].lon===0&&payload.points[0].accuracy===1&&payload.points[0].speed==null&&payload.points[0].heading==null&&payload.points[0].segmentNo===1;}
var GPS_HISTORY_RETENTION_=90*86400000;
function gpsHistoryName_(path){
 if(!/^(gpsHistory|gpsHistoryTombstones)\/[a-zA-Z0-9_-]{1,128}\/shifts\/shift-[0-9]+(-[a-zA-Z0-9]+)?$/.test(path)&&
    !/^gpsHistoryAudit\/[a-zA-Z0-9_-]{1,200}$/.test(path))gpsBridgeFail_('invalid-argument');
 return 'projects/'+GPS_BRIDGE_GPS_+'/databases/(default)/documents/'+path;
}
function gpsHistoryBase_(){return 'https://firestore.googleapis.com/v1/projects/'+GPS_BRIDGE_GPS_+'/databases/(default)/documents';}
function gpsHistoryEncode_(value){
 if(value===null)return {nullValue:null};
 if(typeof value==='boolean')return {booleanValue:value};
 if(typeof value==='string')return {stringValue:value};
 if(typeof value==='number'&&Number.isFinite(value))return Number.isSafeInteger(value)?{integerValue:String(value)}:{doubleValue:value};
 if(Array.isArray(value))return {arrayValue:{values:value.map(gpsHistoryEncode_)}};
 if(value&&typeof value==='object'){
  var fields={};Object.keys(value).forEach(function(k){fields[k]=gpsHistoryEncode_(value[k]);});return {mapValue:{fields:fields}};
 }
 gpsBridgeFail_('invalid-argument');
}
function gpsHistoryDecode_(value){
 if('timestampValue' in value)return Date.parse(value.timestampValue);
 if('nullValue' in value)return null;
 if('booleanValue' in value)return value.booleanValue;
 if('stringValue' in value)return value.stringValue;
 if('integerValue' in value)return Number(value.integerValue);
 if('doubleValue' in value)return value.doubleValue;
 if('arrayValue' in value)return (value.arrayValue.values||[]).map(gpsHistoryDecode_);
 if('mapValue' in value){var out={};Object.keys(value.mapValue.fields||{}).forEach(function(k){out[k]=gpsHistoryDecode_(value.mapValue.fields[k]);});return out;}
 gpsBridgeFail_('failed-precondition');
}
function gpsHistoryData_(doc){return doc?gpsHistoryDecode_({mapValue:{fields:doc.fields||{}}}):null;}
function gpsHistoryRead_(path,auth,transaction){
 var name=gpsHistoryName_(path);
 if(transaction){
  var rows=gpsBridgeRequest_(gpsHistoryBase_()+':batchGet','post',auth.ownerToken,{documents:[name],transaction:transaction});
  if(!Array.isArray(rows)||rows.length!==1)gpsBridgeFail_('unavailable');
  if(rows[0].found&&rows[0].found.name===name)return rows[0].found;
  if(rows[0].missing===name)return null;
  gpsBridgeFail_('readback-mismatch');
 }
 return gpsBridgeRequest_('https://firestore.googleapis.com/v1/'+name,'get',auth.ownerToken,undefined,true);
}
function gpsHistoryWrite_(path,value,prior,times,serverTimeFields){
 var fields=gpsHistoryEncode_(value).mapValue.fields;
 Object.keys(times||{}).forEach(function(k){fields[k]={timestampValue:new Date(times[k]).toISOString()};});
 var result={update:{name:gpsHistoryName_(path),fields:fields},currentDocument:prior?{updateTime:prior.updateTime}:{exists:false}};
 if(serverTimeFields&&serverTimeFields.length)result.updateTransforms=serverTimeFields.map(function(k){return {fieldPath:k,setToServerValue:'REQUEST_TIME'};});
 return result;
}
function gpsHistoryAuthorize_(request){
 var source=gpsBridgeVerified_(GPS_BRIDGE_DIARY_,request.diaryIdToken),target=gpsBridgeVerified_(GPS_BRIDGE_GPS_,request.gpsIdToken);
 if(source.subject!==target.subject||source.email!==target.email)gpsBridgeFail_('account-mismatch');
 if(request.actorUid!==target.uid)gpsBridgeFail_('failed-precondition');
 var eligibility=gpsBridgeSource_(source,request,null),ownerToken=ScriptApp.getOAuthToken();
 if(!eligibility.eligible)gpsBridgeFail_('permission-denied');
 var user=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_GPS_,'users/'+target.uid,ownerToken));
 if(!user||user.diaryUid!==source.uid||user.googleSubject!==source.subject||user.status!=='active'||
    !Number.isSafeInteger(user.accessExpiresAt)||user.accessExpiresAt<=Date.now())gpsBridgeFail_('permission-denied');
 return {source:source,target:target,request:request,ownerToken:ownerToken,isAdmin:eligibility.isAdmin,expires:user.accessExpiresAt,adminRequired:false};
}
function gpsHistoryRecheck_(auth){
 if(auth.expires<=Date.now())gpsBridgeFail_('permission-denied');
 var current=gpsBridgeSource_(auth.source,auth.request,null);
 if(!current.eligible||auth.adminRequired&&!current.isAdmin)gpsBridgeFail_('permission-denied');
}
function gpsHistoryAdmin_(auth){if(!auth.isAdmin)gpsBridgeFail_('permission-denied');auth.adminRequired=true;}
function gpsHistoryArgs_(auth,requireShift){
 var data=auth.request.data||{},uid=data.targetUid===undefined?auth.target.uid:data.targetUid,shift=data.shiftId;
 if(typeof uid!=='string'||!GPS_BRIDGE_UID_.test(uid)||requireShift&&(typeof shift!=='string'||!/^shift-[0-9]+(-[a-zA-Z0-9]+)?$/.test(shift)))gpsBridgeFail_('invalid-argument');
 return {uid:uid,shift:shift};
}
function gpsHistoryOwn_(auth,args){if(args.uid!==auth.target.uid)gpsBridgeFail_('permission-denied');}
function gpsHistoryHash_(value){
 return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(value),Utilities.Charset.UTF_8)
  .map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
}
function gpsHistoryValidate_(doc,uid,shift){
 var value=gpsHistoryData_(doc);
 if(!value||value.uid!==uid||value.format!=='TAXIAPP_GPS_HISTORY_V1'||value.shiftId!==shift||
    !Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now())gpsBridgeFail_('not-found');
 var prepared;try{prepared=gpsHistoryValidation_().prepare(value);}catch(e){gpsBridgeFail_('failed-precondition');}
 if(GPS_HISTORY_TRIAL_ONLY_&&!gpsHistoryTrialPayload_(prepared))gpsBridgeFail_('failed-precondition');
 if(gpsHistoryHash_(prepared)!==value.contentHash)gpsBridgeFail_('readback-mismatch');
 return value;
}
function gpsHistoryTx_(auth,operation){
 var transaction=gpsBridgeRequest_(gpsHistoryBase_()+':beginTransaction','post',auth.ownerToken,{}).transaction;
 if(typeof transaction!=='string'||!transaction)gpsBridgeFail_('unavailable');
 var committed=false;
 try{
  var result=operation(transaction);
  gpsHistoryRecheck_(auth);
  var response=gpsBridgeRequest_(gpsHistoryBase_()+':commit','post',auth.ownerToken,{transaction:transaction,writes:result.writes});
  committed=true;
  if(!Array.isArray(response.writeResults||[])||(response.writeResults||[]).length!==result.writes.length)gpsBridgeFail_('readback-mismatch');
  return result;
 }finally{
  if(!committed){try{gpsBridgeRequest_(gpsHistoryBase_()+':rollback','post',auth.ownerToken,{transaction:transaction});}catch(ignore){}}
 }
}
function gpsHistoryAudit_(actor,uid,shift,action){
 return {actorUid:actor,targetUid:uid,shiftId:shift,action:action};
}
function gpsHistorySave_(auth){
 var data=auth.request.data||{},payload,validation=gpsHistoryValidation_();
 try{payload=validation.prepare(Object.assign({},data.payload,{uid:auth.target.uid}));}catch(e){gpsBridgeFail_('invalid-argument');}
 var expires=validation.retentionDeadlineMs(payload.endedAtMs),hash=gpsHistoryHash_(payload);
 if(payload.endedAtMs>Date.now()||expires<=Date.now())gpsBridgeFail_('failed-precondition');
 if(hash!==data.contentHash)gpsBridgeFail_('invalid-argument');
 var uid=auth.target.uid,path='gpsHistory/'+uid+'/shifts/'+payload.shiftId,tomb='gpsHistoryTombstones/'+uid+'/shifts/'+payload.shiftId;
 gpsHistoryTx_(auth,function(tx){
  var old=gpsHistoryRead_(path,auth,tx),deleted=gpsHistoryRead_(tomb,auth,tx);
  if(deleted)gpsBridgeFail_('failed-precondition');
  if(old){var value=gpsHistoryValidate_(old,uid,payload.shiftId);if(value.contentHash!==hash)gpsBridgeFail_('already-exists');return {writes:[]};}
  var value=Object.assign({},payload,{uid:uid,contentHash:hash});
  return {writes:[gpsHistoryWrite_(path,value,null,{expiresAt:expires},['uploadedAt'])]};
 });
 var saved=gpsHistoryValidate_(gpsHistoryRead_(path,auth),uid,payload.shiftId);
 if(saved.contentHash!==hash)gpsBridgeFail_('readback-mismatch');
 return {shiftId:payload.shiftId,contentHash:hash,status:'saved',history:saved};
}
function gpsHistoryGet_(auth,adminAction){
 var args=gpsHistoryArgs_(auth,true),path='gpsHistory/'+args.uid+'/shifts/'+args.shift;
 if(!adminAction){gpsHistoryOwn_(auth,args);return {targetUid:args.uid,history:gpsHistoryValidate_(gpsHistoryRead_(path,auth),args.uid,args.shift)};}
 gpsHistoryAdmin_(auth);
 if(adminAction==='csv_export'&&auth.request.data.confirmedExport!==true)gpsBridgeFail_('failed-precondition');
 var auditPath='gpsHistoryAudit/'+Utilities.getUuid(),row=gpsHistoryAudit_(auth.target.uid,args.uid,args.shift,adminAction),value;
 gpsHistoryTx_(auth,function(tx){
  value=gpsHistoryValidate_(gpsHistoryRead_(path,auth,tx),args.uid,args.shift);
  return {writes:[gpsHistoryWrite_(auditPath,row,null,{expiresAt:Date.now()+GPS_HISTORY_RETENTION_},['at'])]};
 });
 var saved=gpsHistoryData_(gpsHistoryRead_(auditPath,auth));
 if(!saved||saved.actorUid!==row.actorUid||saved.targetUid!==args.uid||saved.shiftId!==args.shift||saved.action!==adminAction||!Number.isFinite(saved.at))gpsBridgeFail_('readback-mismatch');
 // 監査のcommitと読戻しが成功するまで座標を返さない。
 return {targetUid:args.uid,shiftId:args.shift,startedAtMs:value.startedAtMs,endedAtMs:value.endedAtMs,
  points:value.points,contentHash:value.contentHash,source:'admin_server_audited'};
}
function gpsHistoryQuery_(auth,parent,collection,query){
 if(parent&&!/^gpsHistory\/[a-zA-Z0-9_-]{1,128}$/.test(parent))gpsBridgeFail_('invalid-argument');
 if(collection!=='shifts'&&collection!=='gpsHistoryAudit')gpsBridgeFail_('invalid-argument');
 var rows=gpsBridgeRequest_(gpsHistoryBase_()+(parent?'/'+parent:'')+':runQuery','post',auth.ownerToken,
  {structuredQuery:Object.assign({from:[{collectionId:collection}]},query)});
 if(!Array.isArray(rows))gpsBridgeFail_('unavailable');
 return rows.filter(function(r){return !!r.document;}).map(function(r){return r.document;});
}
function gpsHistoryList_(auth,admin){
 var args=gpsHistoryArgs_(auth,false);if(admin)gpsHistoryAdmin_(auth);else gpsHistoryOwn_(auth,args);
 var fields=['format','shiftId','startedAtMs','endedAtMs','expiresAt'];
 var docs=gpsHistoryQuery_(auth,'gpsHistory/'+args.uid,'shifts',{
  select:{fields:fields.map(function(k){return {fieldPath:k};})},orderBy:[{field:{fieldPath:'endedAtMs'},direction:'DESCENDING'}],limit:40});
 return {targetUid:args.uid,shifts:docs.map(gpsHistoryData_).filter(function(d){return d.format==='TAXIAPP_GPS_HISTORY_V1'&&d.expiresAt>Date.now()&&(!GPS_HISTORY_TRIAL_ONLY_||gpsHistoryTrialId_(d.shiftId));})
  .map(function(d){return {shiftId:d.shiftId,startedAtMs:d.startedAtMs,endedAtMs:d.endedAtMs};})};
}
function gpsHistoryAuditList_(auth){
 gpsHistoryAdmin_(auth);
 var docs=gpsHistoryQuery_(auth,'','gpsHistoryAudit',{orderBy:[{field:{fieldPath:'at'},direction:'DESCENDING'}],limit:100});
 return {entries:docs.map(gpsHistoryData_).filter(function(d){return d.expiresAt>Date.now()&&(!GPS_HISTORY_TRIAL_ONLY_||gpsHistoryTrialId_(d.shiftId));}).map(function(d){
  return {actorUid:String(d.actorUid||''),targetUid:String(d.targetUid||''),shiftId:String(d.shiftId||''),action:String(d.action||''),atMs:d.at||null};})};
}
function gpsHistoryDelete_(auth){
 var args=gpsHistoryArgs_(auth,true),data=auth.request.data||{};
 if(data.confirmationShiftId!==args.shift)gpsBridgeFail_('failed-precondition');
 if(args.uid!==auth.target.uid)gpsHistoryAdmin_(auth);
 var path='gpsHistory/'+args.uid+'/shifts/'+args.shift,tomb='gpsHistoryTombstones/'+args.uid+'/shifts/'+args.shift;
 var auditPath='gpsHistoryAudit/'+Utilities.getUuid();
 var result=gpsHistoryTx_(auth,function(tx){
  var old=gpsHistoryRead_(path,auth,tx),deleted=gpsHistoryRead_(tomb,auth,tx);
  if(deleted)return {writes:[],status:'already-deleted'};
  if(!old)gpsBridgeFail_('not-found');
  return {status:'deleted',writes:[
   gpsHistoryWrite_(tomb,{targetUid:args.uid,shiftId:args.shift,deletedBy:auth.target.uid},null,{},['deletedAt']),
   gpsHistoryWrite_(auditPath,gpsHistoryAudit_(auth.target.uid,args.uid,args.shift,'delete'),null,{expiresAt:Date.now()+GPS_HISTORY_RETENTION_},['at']),
   {delete:gpsHistoryName_(path),currentDocument:{updateTime:old.updateTime}}]};
 });
 var mark=gpsHistoryData_(gpsHistoryRead_(tomb,auth));
 if(!mark||mark.targetUid!==args.uid||mark.shiftId!==args.shift||gpsHistoryRead_(path,auth))gpsBridgeFail_('readback-mismatch');
 return {targetUid:args.uid,shiftId:args.shift,status:result.status};
}
function gpsHistoryCsv_(auth){
 var d=auth.request.data||{};
 if(typeof d.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(d.operationId)||typeof d.shiftId!=='string'||
    !/^shift-[0-9]+(-[a-zA-Z0-9]+)?$/.test(d.shiftId)||!Number.isSafeInteger(d.atMs)||d.atMs<=0||d.atMs>Date.now()+60000)gpsBridgeFail_('invalid-argument');
 var path='gpsHistoryAudit/'+auth.target.uid+'_'+d.operationId;
 gpsHistoryTx_(auth,function(tx){
  var prior=gpsHistoryRead_(path,auth,tx),old=gpsHistoryData_(prior);
  if(old){if(old.actorUid!==auth.target.uid||old.targetUid!==auth.target.uid||old.shiftId!==d.shiftId||old.atMs!==d.atMs||old.action!=='csv_export')gpsBridgeFail_('already-exists');return {writes:[]};}
  var row=gpsHistoryAudit_(auth.target.uid,auth.target.uid,d.shiftId,'csv_export');row.atMs=d.atMs;
  return {writes:[gpsHistoryWrite_(path,row,null,{at:d.atMs,expiresAt:d.atMs+GPS_HISTORY_RETENTION_},['receivedAt'])]};
 });
 var saved=gpsHistoryData_(gpsHistoryRead_(path,auth));
 if(!saved||saved.actorUid!==auth.target.uid||saved.targetUid!==auth.target.uid||saved.shiftId!==d.shiftId||saved.atMs!==d.atMs)gpsBridgeFail_('readback-mismatch');
 return {operationId:d.operationId,status:'saved'};
}
function gpsHistoryDispatch_(request){
 if(GPS_HISTORY_ACTIONS_.indexOf(request.action)<0)gpsBridgeFail_('invalid-argument');
 if(GPS_HISTORY_TRIAL_ONLY_){
  var data=request.data||{};
  if(request.action==='saveOwnGpsHistory'){
   if(!gpsHistoryTrialPayload_(data.payload))gpsBridgeFail_('failed-precondition');
  }else if(['listOwnGpsHistory','adminListGpsHistory','adminListGpsHistoryAudit'].indexOf(request.action)<0&&!gpsHistoryTrialId_(data.shiftId))gpsBridgeFail_('failed-precondition');
 }
 var auth=gpsHistoryAuthorize_(request),lock=LockService.getScriptLock();if(!lock.tryLock(5000))gpsBridgeFail_('busy');
 try{
  gpsHistoryRecheck_(auth);var result;
  switch(request.action){
   case 'saveOwnGpsHistory':result=gpsHistorySave_(auth);break;
   case 'getOwnGpsHistory':result=gpsHistoryGet_(auth,null);break;
   case 'listOwnGpsHistory':result=gpsHistoryList_(auth,false);break;
   case 'adminViewGpsHistory':result=gpsHistoryGet_(auth,'view');break;
   case 'adminExportGpsHistory':result=gpsHistoryGet_(auth,'csv_export');break;
   case 'adminListGpsHistory':result=gpsHistoryList_(auth,true);break;
   case 'adminListGpsHistoryAudit':result=gpsHistoryAuditList_(auth);break;
   case 'deleteGpsHistory':result=gpsHistoryDelete_(auth);break;
   case 'recordOwnGpsCsvAudit':result=gpsHistoryCsv_(auth);break;
   case 'getOwnGpsHistoryTombstone':
    var args=gpsHistoryArgs_(auth,true);gpsHistoryOwn_(auth,args);
    result={deleted:!!gpsHistoryRead_('gpsHistoryTombstones/'+args.uid+'/shifts/'+args.shift,auth)};break;
  }
  gpsHistoryRecheck_(auth);return result;
 }finally{lock.releaseLock();}
}
// 所有者が実行する整理処理。Webのactionには含めない。トリガーの作成もしない。
function cleanupGpsHistoryAndAudit(){
 gpsBridgeFail_('failed-precondition'); // 整理は今回も未承認のため常時拒否。
 var lock=LockService.getScriptLock();if(!lock.tryLock(5000))gpsBridgeFail_('busy');
 try{
  var auth={ownerToken:ScriptApp.getOAuthToken()},now=Date.now(),stop=now+240000,expired=0,logs=0,page='';
  var filter={fieldFilter:{field:{fieldPath:'expiresAt'},op:'LESS_THAN_OR_EQUAL',value:{timestampValue:new Date(now).toISOString()}}};
  do{
   var owners=gpsBridgeRequest_(gpsHistoryBase_()+'/gpsHistory?showMissing=true&pageSize=50'+(page?'&pageToken='+encodeURIComponent(page):''),'get',auth.ownerToken);
   for(var i=0;i<(owners.documents||[]).length;i++){
    var prefix='projects/'+GPS_BRIDGE_GPS_+'/databases/(default)/documents/gpsHistory/';
    var name=owners.documents[i].name;
    if(typeof name!=='string'||name.indexOf(prefix)!==0||!GPS_BRIDGE_UID_.test(name.slice(prefix.length)))gpsBridgeFail_('invalid-argument');
    while(Date.now()<stop){
     var docs=gpsHistoryQuery_(auth,'gpsHistory/'+name.slice(prefix.length),'shifts',{where:filter,limit:100});
     if(!docs.length)break;
     var writes=docs.map(function(d){
      var relative=d.name.slice(('projects/'+GPS_BRIDGE_GPS_+'/databases/(default)/documents/').length);
      if(gpsHistoryName_(relative)!==d.name)gpsBridgeFail_('invalid-argument');
      return {delete:d.name,currentDocument:{updateTime:d.updateTime}};
     });
     gpsBridgeRequest_(gpsHistoryBase_()+':commit','post',auth.ownerToken,{writes:writes});expired+=writes.length;
    }
    if(Date.now()>=stop)return {expired:expired,logs:logs,complete:false};
   }
   page=owners.nextPageToken||'';
  }while(page&&Date.now()<stop);
  while(Date.now()<stop){
   var docs=gpsHistoryQuery_(auth,'','gpsHistoryAudit',{where:filter,limit:100});
   if(!docs.length)return {expired:expired,logs:logs,complete:!page};
   var writes=docs.map(function(d){
    var relative=d.name.slice(('projects/'+GPS_BRIDGE_GPS_+'/databases/(default)/documents/').length);
    if(gpsHistoryName_(relative)!==d.name||relative.indexOf('gpsHistoryAudit/')!==0)gpsBridgeFail_('invalid-argument');
    return {delete:d.name,currentDocument:{updateTime:d.updateTime}};
   });
   gpsBridgeRequest_(gpsHistoryBase_()+':commit','post',auth.ownerToken,{writes:writes});logs+=writes.length;
  }
  return {expired:expired,logs:logs,complete:false};
 }finally{lock.releaseLock();}
}
