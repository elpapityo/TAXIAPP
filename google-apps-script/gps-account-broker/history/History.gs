/** 無料GPS履歴バックエンドの更新候補。本番未配置。日報原本にはアクセスしない。 */
var GPS_HISTORY_ACTIONS_=['saveOwnGpsHistory','getOwnGpsHistory','listOwnGpsHistory','getOwnGpsHistoryTombstone',
 'adminViewGpsHistory','adminExportGpsHistory','adminListGpsHistory','adminListGpsHistoryAudit','deleteGpsHistory','recordOwnGpsCsvAudit'];
var GPS_HISTORY_TRIAL_ONLY_=true; // 公開候補は固定1地点の合成試験だけ。実履歴は拒否。
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
 if(GPS_HISTORY_TRIAL_ONLY_)gpsBridgeFail_('failed-precondition');
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
