/* 現在地共有GAS接続候補。日報の操作権を取得しない。初期化/一覧だけでは測位しない。 */
(function(root){'use strict';
const bridge=root.TAXIAPP_GPS_ACCOUNT_BRIDGE||require('./gps-account-bridge');
const core=root.TAXIAPP_GPS_SHARING_CORE||require('./gps-sharing-core');
const UID=/^[a-zA-Z0-9_-]{1,128}$/;
function create({diaryAuth,gpsAuth,client,now=()=>Date.now()}){
 if(diaryAuth?.app?.options?.projectId!==bridge.DIARY_PROJECT||gpsAuth?.app?.options?.projectId!==bridge.GPS_PROJECT||diaryAuth===gpsAuth||typeof client?.call!=='function')throw Error('現在地共有の認証接続が不正です');
 const d=diaryAuth.currentUser,g=gpsAuth.currentUser,ids=bridge.pair(d,g);let disposed=false;
 function current(){if(disposed||diaryAuth.currentUser!==d||gpsAuth.currentUser!==g)throw Error('現在地共有のログイン本人が切り替わりました');bridge.pair(d,g);}
 async function call(action,data={}){current();const result=await client.call(action,data);current();return result;}
 function checkIds(writerSessionId,senderId){
  current();if(typeof writerSessionId!=='string'||writerSessionId.length<32||writerSessionId.length>128||typeof senderId!=='string'||!/^[a-fA-F0-9-]{36}$/.test(senderId))throw Error('位置送信元の識別情報が不正です');
 }
 function preference(r){
  const p=r?.preference;if(p===null)return null;
  if(!p||typeof p.public!=='boolean'||!Number.isSafeInteger(p.revision)||p.revision<1||typeof p.operationId!=='string')throw Error('公開設定の応答が不正です');
  return {public:p.public,revision:p.revision,operationId:p.operationId};
 }
 return Object.freeze({localUid:ids.diaryUid,gpsUid:ids.gpsUid,isCurrent(){try{current();return true;}catch{return false;}},
  async claim(writerSessionId,senderId){
   checkIds(writerSessionId,senderId);const r=await call('acquireGpsSender',{writerSessionId,senderId});
   if(r?.status==='standby'&&Number.isSafeInteger(r.retryAtMs)&&r.retryAtMs>now()&&r.retryAtMs<=now()+120000)return r;
   if(r?.status!=='claimed'||r.senderId!==senderId||r.writerSessionId!==writerSessionId||!Number.isSafeInteger(r.updatedAtMs)||r.updatedAtMs>now()+30000||r.validUntilMs!==r.updatedAtMs+120000||r.validUntilMs<=now())throw Error('位置送信元の保存確認が一致しません');return r;
  },
  async send(writerSessionId,senderId,payload){
   checkIds(writerSessionId,senderId);
   const clean={};for(const key of ['public','onDuty','status','shiftId','capturedAtMs','lat','lon','accuracy','speed','heading'])if(payload?.[key]!==undefined)clean[key]=payload[key];
   const r=await call('sendGpsPresence',{writerSessionId,senderId,payload:clean});
   if(r?.status==='not-sender')return r;
   if(r?.status!=='sent'||!Number.isSafeInteger(r.updatedAtMs)||r.updatedAtMs>now()+30000||r.updatedAtMs<=now()-120000)throw Error('現在地の保存確認が不正です');return r;
  },
  async stop(writerSessionId,senderId){checkIds(writerSessionId,senderId);const r=await call('stopGpsPresence',{writerSessionId,senderId});if(typeof r?.stopped!=='boolean')throw Error('共有停止の確認が不正です');return r;},
  async readPreference(){return preference(await call('getOwnGpsSharePrefs'));},
  async writePreference(value,operation,writerSessionId){
   if(typeof writerSessionId!=='string'||writerSessionId.length<32||writerSessionId.length>128||typeof value!=='boolean'||typeof operation?.id!=='string'||!/^[a-fA-F0-9-]{36}$/.test(operation.id)||!Number.isSafeInteger(operation.baseRevision)||operation.baseRevision<0)throw Error('公開設定の変更情報が不正です');
   const p=preference(await call('setOwnGpsSharePrefs',{public:value,operationId:operation.id,baseRevision:operation.baseRevision,writerSessionId}));
   if(!p||p.public!==value||p.operationId!==operation.id||p.revision!==operation.baseRevision+1)throw Error('公開設定の保存確認が一致しません');return p;
  },
  async list(){
   const r=await call('listGpsPresence');if(!Array.isArray(r?.vehicles)||r.vehicles.length>100||typeof r.truncated!=='boolean')throw Error('共有車両一覧の形式が不正です');
   const seen=new Set(),vehicles=[];
   for(const p of r.vehicles){
    if(typeof p.uid!=='string'||!UID.test(p.uid)||seen.has(p.uid)||typeof p.name!=='string'||p.name.length>80||!['空車','迎車','実車','支払い','待機'].includes(p.status)||!Number.isFinite(p.accuracy)||p.accuracy<0||!Number.isSafeInteger(p.updatedAt))throw Error('共有車両一覧の内容が不正です');
    seen.add(p.uid);if(core.presenceView(p,now()).show)vehicles.push({uid:p.uid,name:p.name,status:p.status,public:true,onDuty:true,lat:p.lat,lon:p.lon,accuracy:p.accuracy,updatedAt:p.updatedAt});
   }
   return {vehicles,truncated:r.truncated};
  },
  dispose(){disposed=true;}
 });
}
function createSender(options){
 const remote=create(options),senderApi=root.TAXIAPP_GPS_PRESENCE_SENDER||require('./gps-presence-sender');
 const sender=senderApi.create({auth:options.diaryAuth,uid:remote.localUid,session:options.session,senderId:options.senderId,remote,onChange:options.onChange,now:options.now});
 return Object.freeze({...sender,backend:'gas',readPreference:remote.readPreference,writePreference:async(...args)=>{const value=await remote.writePreference(...args);if(!value.public)sender.invalidate();return value;},list:remote.list,dispose(){sender.dispose();remote.dispose();}});
}
const api=Object.freeze({create,createSender});root.TAXIAPP_GPS_PRESENCE_GAS_ADAPTER=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
