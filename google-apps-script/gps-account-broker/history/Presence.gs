/** 現在地共有の無料GAS候補。既存日報へは利用資格/操作端末の読取だけ。未公開。 */
var GPS_PRESENCE_ACTIONS_=['acquireGpsSender','sendGpsPresence','stopGpsPresence','getOwnGpsSharePrefs','setOwnGpsSharePrefs','listGpsPresence'];
var GPS_PRESENCE_LEASE_MS_=120000;
function gpsPresenceName_(path){
 if(!/^(gpsPresence|gpsSenderSessions|gpsSharePrefs)\/[a-zA-Z0-9_-]{1,128}$/.test(path))gpsBridgeFail_('invalid-argument');
 return 'projects/'+GPS_BRIDGE_GPS_+'/databases/(default)/documents/'+path;
}
function gpsPresenceRead_(path,auth,tx){
 var name=gpsPresenceName_(path);
 if(!tx)return gpsBridgeRequest_('https://firestore.googleapis.com/v1/'+name,'get',auth.ownerToken,undefined,true);
 var rows=gpsBridgeRequest_(gpsHistoryBase_()+':batchGet','post',auth.ownerToken,{documents:[name],transaction:tx});
 if(!Array.isArray(rows)||rows.length!==1)gpsBridgeFail_('unavailable');
 if(rows[0].found&&rows[0].found.name===name)return rows[0].found;
 if(rows[0].missing===name)return null;gpsBridgeFail_('readback-mismatch');
}
function gpsPresenceWrite_(path,data,prior){
 return {update:{name:gpsPresenceName_(path),fields:gpsHistoryEncode_(data).mapValue.fields},
  currentDocument:prior?{updateTime:prior.updateTime}:{exists:false},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]};
}
// 現在地だけは公開済み本人連携の5分資格を利用。履歴/管理者の再確認方式は変えない。
function gpsPresenceLease_(auth){
 var member=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_GPS_,'users/'+auth.target.uid,auth.ownerToken)),now=Date.now();
 if(!member||member.status!=='active'||member.diaryUid!==auth.source.uid||member.googleSubject!==auth.source.subject||
  !Number.isSafeInteger(member.accessExpiresAt)||member.accessExpiresAt<=now||member.accessExpiresAt>now+GPS_BRIDGE_LEASE_MS_)gpsBridgeFail_('permission-denied');
 if(auth.expires===undefined)auth.expires=member.accessExpiresAt;
 auth.expires=Math.min(auth.expires,member.accessExpiresAt);
 if(auth.expires<=now)gpsBridgeFail_('permission-denied');
 auth.displayName=String(member.openChatName||'登録利用者').slice(0,80);
}
function gpsPresenceAuthorize_(request){
 // Googleは毎回オンライン検証。資格の5分保持と、token失効の検証を混同しない。
 var source=gpsBridgeVerified_(GPS_BRIDGE_DIARY_,request.diaryIdToken),target=gpsBridgeVerified_(GPS_BRIDGE_GPS_,request.gpsIdToken);
 if(source.subject!==target.subject||source.email!==target.email)gpsBridgeFail_('account-mismatch');
 if(request.actorUid!==target.uid)gpsBridgeFail_('failed-precondition');
 var auth={source:source,target:target,request:request,ownerToken:ScriptApp.getOAuthToken()};
 gpsPresenceLease_(auth);return auth;
}
function gpsPresenceRecheck_(auth){gpsPresenceLease_(auth);}
function gpsPresenceCheckWriter_(auth){
 if(!auth.writer)return;
 // commit直前に日報の現行操作端末だけを1回読む。操作権を作成/取得しない。
 var session=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_DIARY_,'deviceSessions/'+auth.source.uid,auth.request.diaryIdToken));
 if(!session||session.sessionId!==auth.writer)gpsBridgeFail_('permission-denied');
}
function gpsPresenceTx_(auth,operation){
 var tx=gpsBridgeRequest_(gpsHistoryBase_()+':beginTransaction','post',auth.ownerToken,{}).transaction;
 if(typeof tx!=='string'||!tx)gpsBridgeFail_('unavailable');var done=false;
 try{
  var result=operation(tx);gpsPresenceRecheck_(auth);gpsPresenceCheckWriter_(auth);
  var committed=gpsBridgeRequest_(gpsHistoryBase_()+':commit','post',auth.ownerToken,{transaction:tx,writes:result.writes});done=true;
  if(!Array.isArray(committed.writeResults||[])||(committed.writeResults||[]).length!==result.writes.length)gpsBridgeFail_('readback-mismatch');
  return result;
 }finally{if(!done){try{gpsBridgeRequest_(gpsHistoryBase_()+':rollback','post',auth.ownerToken,{transaction:tx});}catch(ignore){}}}
}
function gpsPresenceIds_(auth){
 var d=auth.request.data||{};
 if(typeof d.senderId!=='string'||!/^[a-fA-F0-9-]{36}$/.test(d.senderId))gpsBridgeFail_('invalid-argument');
 return {senderId:d.senderId,writerSessionId:auth.writer};
}
function gpsPresenceOwned_(row,ids){return !!row&&row.senderId===ids.senderId&&row.writerSessionId===ids.writerSessionId;}
function gpsPresenceClosed_(){return {public:false,onDuty:false,status:'',name:'',lat:null,lon:null,accuracy:null,speed:null,heading:null,shiftId:'',capturedAtMs:null,senderId:'',writerSessionId:''};}
function gpsPresenceClaim_(auth){
 var ids=gpsPresenceIds_(auth),path='gpsSenderSessions/'+auth.target.uid;
 var result=gpsPresenceTx_(auth,function(tx){
  var prior=gpsPresenceRead_(path,auth,tx),row=gpsHistoryData_(prior);
  if(row&&!gpsPresenceOwned_(row,ids)&&row.writerSessionId===auth.writer&&Number.isFinite(row.updatedAt)&&row.updatedAt+GPS_PRESENCE_LEASE_MS_>Date.now())return {writes:[],status:'standby',retryAtMs:row.updatedAt+GPS_PRESENCE_LEASE_MS_};
  return {writes:[gpsPresenceWrite_(path,ids,prior)],status:'claimed'};
 });
 if(result.status==='standby')return {status:'standby',retryAtMs:result.retryAtMs};
 var saved=gpsHistoryData_(gpsPresenceRead_(path,auth));
 if(!gpsPresenceOwned_(saved,ids)||!Number.isSafeInteger(saved.updatedAt)||saved.updatedAt+GPS_PRESENCE_LEASE_MS_<=Date.now())gpsBridgeFail_('readback-mismatch');
 return {status:'claimed',senderId:ids.senderId,writerSessionId:auth.writer,updatedAtMs:saved.updatedAt,validUntilMs:saved.updatedAt+GPS_PRESENCE_LEASE_MS_};
}
function gpsPresencePoint_(data){
 var p=data.payload;
 if(!p||p.public!==true||p.onDuty!==true||['空車','迎車','実車','支払い','待機'].indexOf(p.status)<0||
  typeof p.shiftId!=='string'||!/^shift-[0-9]+(-[a-zA-Z0-9]+)?$/.test(p.shiftId)||
  !Number.isSafeInteger(p.capturedAtMs)||p.capturedAtMs<Date.now()-120000||p.capturedAtMs>Date.now()+30000||
  !Number.isFinite(p.lat)||Math.abs(p.lat)>90||!Number.isFinite(p.lon)||Math.abs(p.lon)>180||
  !Number.isFinite(p.accuracy)||p.accuracy<0||
  p.speed!=null&&(!Number.isFinite(p.speed)||p.speed<0)||p.heading!=null&&(!Number.isFinite(p.heading)||p.heading<0||p.heading>=360))gpsBridgeFail_('invalid-argument');
 return {public:true,onDuty:true,status:p.status,shiftId:p.shiftId,capturedAtMs:p.capturedAtMs,lat:p.lat,lon:p.lon,accuracy:p.accuracy,speed:p.speed==null?null:p.speed,heading:p.heading==null?null:p.heading};
}
function gpsPresenceSend_(auth){
 var ids=gpsPresenceIds_(auth),p=gpsPresencePoint_(auth.request.data),uid=auth.target.uid,path='gpsPresence/'+uid;
 var result=gpsPresenceTx_(auth,function(tx){
  var lease=gpsHistoryData_(gpsPresenceRead_('gpsSenderSessions/'+uid,auth,tx));
  var pref=gpsHistoryData_(gpsPresenceRead_('gpsSharePrefs/'+uid,auth,tx)),prior=gpsPresenceRead_(path,auth,tx);
  if(!gpsPresenceOwned_(lease,ids)||!Number.isFinite(lease.updatedAt)||lease.updatedAt+GPS_PRESENCE_LEASE_MS_<=Date.now())return {writes:[],status:'not-sender'};
  if(!pref||pref.public!==true)gpsBridgeFail_('failed-precondition');
  var value=Object.assign({},p,ids,{name:auth.displayName});
  return {writes:[gpsPresenceWrite_(path,value,prior)],status:'sent'};
 });
 if(result.status!=='sent')return {status:result.status};
 var saved=gpsHistoryData_(gpsPresenceRead_(path,auth));
 if(!gpsPresenceOwned_(saved,ids)||!Number.isSafeInteger(saved.updatedAt)||Object.keys(p).some(function(k){return saved[k]!==p[k];}))gpsBridgeFail_('readback-mismatch');
 return {status:'sent',updatedAtMs:saved.updatedAt};
}
function gpsPresenceStop_(auth){
 var ids=gpsPresenceIds_(auth),uid=auth.target.uid,leasePath='gpsSenderSessions/'+uid,path='gpsPresence/'+uid;
 var result=gpsPresenceTx_(auth,function(tx){
  var lease=gpsPresenceRead_(leasePath,auth,tx),row=gpsHistoryData_(lease),prior=gpsPresenceRead_(path,auth,tx);
  if(!gpsPresenceOwned_(row,ids))return {writes:[],stopped:false};
  return {writes:[gpsPresenceWrite_(path,gpsPresenceClosed_(),prior),{delete:gpsPresenceName_(leasePath),currentDocument:{updateTime:lease.updateTime}}],stopped:true};
 });
 if(result.stopped){var saved=gpsHistoryData_(gpsPresenceRead_(path,auth));if(!saved||saved.public!==false||saved.lat!==null||saved.lon!==null||gpsPresenceRead_(leasePath,auth))gpsBridgeFail_('readback-mismatch');}
 return {stopped:result.stopped};
}
function gpsPresencePrefs_(auth){
 var value=gpsHistoryData_(gpsPresenceRead_('gpsSharePrefs/'+auth.target.uid,auth));
 if(!value)return {preference:null};
 if(typeof value.public!=='boolean'||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.operationId!=='string')gpsBridgeFail_('failed-precondition');
 return {preference:{public:value.public,revision:value.revision,operationId:value.operationId}};
}
function gpsPresenceSetPrefs_(auth){
 var d=auth.request.data||{},path='gpsSharePrefs/'+auth.target.uid;
 if(typeof d.public!=='boolean'||typeof d.operationId!=='string'||!/^[a-fA-F0-9-]{36}$/.test(d.operationId)||!Number.isSafeInteger(d.baseRevision)||d.baseRevision<0)gpsBridgeFail_('invalid-argument');
 gpsPresenceTx_(auth,function(tx){
  var prior=gpsPresenceRead_(path,auth,tx),row=gpsHistoryData_(prior);
  if(row&&row.operationId===d.operationId){if(row.public!==d.public)gpsBridgeFail_('already-exists');return {writes:[]};}
  if((row?row.revision:0)!==d.baseRevision)gpsBridgeFail_('already-exists');
  var writes=[gpsPresenceWrite_(path,{public:d.public,revision:d.baseRevision+1,operationId:d.operationId,writerSessionId:auth.writer},prior)];
  if(!d.public){
   var presencePath='gpsPresence/'+auth.target.uid,leasePath='gpsSenderSessions/'+auth.target.uid;
   var old=gpsPresenceRead_(presencePath,auth,tx),lease=gpsPresenceRead_(leasePath,auth,tx);
   writes.push(gpsPresenceWrite_(presencePath,gpsPresenceClosed_(),old));
   if(lease)writes.push({delete:gpsPresenceName_(leasePath),currentDocument:{updateTime:lease.updateTime}});
  }
  return {writes:writes};
 });
 var result=gpsPresencePrefs_(auth),actual=result.preference;
 if(!actual||actual.public!==d.public||actual.operationId!==d.operationId||actual.revision!==d.baseRevision+1)gpsBridgeFail_('readback-mismatch');
 if(!d.public){var hidden=gpsHistoryData_(gpsPresenceRead_('gpsPresence/'+auth.target.uid,auth));if(!hidden||hidden.public!==false||hidden.lat!==null||hidden.lon!==null)gpsBridgeFail_('readback-mismatch');}
 return result;
}
function gpsPresenceList_(auth){
 var now=Date.now(),rows=gpsBridgeRequest_(gpsHistoryBase_()+':runQuery','post',auth.ownerToken,{structuredQuery:{
  from:[{collectionId:'gpsPresence'}],where:{fieldFilter:{field:{fieldPath:'updatedAt'},op:'GREATER_THAN_OR_EQUAL',value:{timestampValue:new Date(now-300000).toISOString()}}},
  orderBy:[{field:{fieldPath:'updatedAt'},direction:'DESCENDING'}],limit:101}});
 if(!Array.isArray(rows))gpsBridgeFail_('unavailable');
 var docs=rows.filter(function(r){return !!r.document;}).map(function(r){return r.document;}),vehicles=[];
 docs.slice(0,100).forEach(function(doc){
  var prefix='projects/'+GPS_BRIDGE_GPS_+'/databases/(default)/documents/gpsPresence/';
  if(typeof doc.name!=='string'||doc.name.indexOf(prefix)!==0||!GPS_BRIDGE_UID_.test(doc.name.slice(prefix.length)))gpsBridgeFail_('readback-mismatch');
  var uid=doc.name.slice(prefix.length),p=gpsHistoryData_(doc);
  if(p.public!==true||p.onDuty!==true||!Number.isSafeInteger(p.updatedAt)||p.updatedAt<=Date.now()-300000||p.updatedAt>Date.now()+30000)return;
  // 停止済み利用者/公開取消/送信元切替を応答に含めない。日報の他人の原本は読まない。
  var member=gpsBridgeFields_(gpsBridgeRead_(GPS_BRIDGE_GPS_,'users/'+uid,auth.ownerToken));
  var pref=gpsHistoryData_(gpsPresenceRead_('gpsSharePrefs/'+uid,auth)),lease=gpsHistoryData_(gpsPresenceRead_('gpsSenderSessions/'+uid,auth));
  if(!member||member.status!=='active'||!Number.isSafeInteger(member.accessExpiresAt)||member.accessExpiresAt<=Date.now()||!pref||pref.public!==true||!gpsPresenceOwned_(lease,p))return;
  // 古いが5分以内の位置はstaleとして表示可能。期限外/不正点は返さない。
  if(!Number.isFinite(p.lat)||Math.abs(p.lat)>90||!Number.isFinite(p.lon)||Math.abs(p.lon)>180||!Number.isFinite(p.accuracy)||p.accuracy<0||['空車','迎車','実車','支払い','待機'].indexOf(p.status)<0)return;
  vehicles.push({uid:uid,name:String(member.openChatName||'登録利用者').slice(0,80),public:true,onDuty:true,status:p.status,lat:p.lat,lon:p.lon,accuracy:p.accuracy,updatedAt:p.updatedAt});
 });
 return {vehicles:vehicles,truncated:docs.length>100};
}
function gpsPresenceDispatch_(request){
 if(GPS_PRESENCE_ACTIONS_.indexOf(request.action)<0)gpsBridgeFail_('invalid-argument');
 var auth=gpsPresenceAuthorize_(request),writerActions=['acquireGpsSender','sendGpsPresence','stopGpsPresence','setOwnGpsSharePrefs'];
 if(writerActions.indexOf(request.action)>=0){
  var writer=(request.data||{}).writerSessionId;
  if(typeof writer!=='string'||writer.length<32||writer.length>128)gpsBridgeFail_('invalid-argument');auth.writer=writer;
 }
 var lock=LockService.getScriptLock();if(!lock.tryLock(5000))gpsBridgeFail_('busy');
 try{
  gpsPresenceRecheck_(auth);var result;
  switch(request.action){
   case 'acquireGpsSender':result=gpsPresenceClaim_(auth);break;
   case 'sendGpsPresence':result=gpsPresenceSend_(auth);break;
   case 'stopGpsPresence':result=gpsPresenceStop_(auth);break;
   case 'getOwnGpsSharePrefs':result=gpsPresencePrefs_(auth);break;
   case 'setOwnGpsSharePrefs':result=gpsPresenceSetPrefs_(auth);break;
   case 'listGpsPresence':result=gpsPresenceList_(auth);break;
  }
  gpsPresenceRecheck_(auth);return result;
 }finally{lock.releaseLock();}
}
