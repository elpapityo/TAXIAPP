/** 管理者画面用の利用者メタデータ。位置/メール/日報UID/資格対応表は返さない。 */
function gpsHistoryAdminUsers_(auth){
 gpsHistoryAdmin_(auth);
 var cursor=(auth.request.data||{}).afterUid;
 if(cursor!==undefined&&(typeof cursor!=='string'||!GPS_BRIDGE_UID_.test(cursor)))gpsBridgeFail_('invalid-argument');
 var prefix='projects/'+GPS_BRIDGE_GPS_+'/databases/(default)/documents/users/';
 var query={from:[{collectionId:'users'}],select:{fields:[{fieldPath:'openChatName'},{fieldPath:'status'}]},
  orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:41};
 if(cursor)query.startAt={values:[{referenceValue:prefix+cursor}],before:false};
 var rows=gpsBridgeRequest_(gpsHistoryBase_()+':runQuery','post',auth.ownerToken,{structuredQuery:query});
 if(!Array.isArray(rows))gpsBridgeFail_('unavailable');
 var docs=rows.filter(function(r){return !!r.document;}).map(function(r){return r.document;});
 var users=docs.slice(0,40).map(function(doc){
  if(typeof doc.name!=='string'||doc.name.indexOf(prefix)!==0||!GPS_BRIDGE_UID_.test(doc.name.slice(prefix.length)))gpsBridgeFail_('readback-mismatch');
  var value=gpsHistoryData_(doc);
  return {uid:doc.name.slice(prefix.length),name:String(value.openChatName||'登録利用者').slice(0,80),status:value.status==='active'?'active':'inactive'};
 });
 return {users:users,nextAfterUid:docs.length>40?users[users.length-1].uid:null};
}
