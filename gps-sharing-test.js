/* TAXIAPP 位置共有・独立試験UI。既存営業データとGPSトリップは読み取りのみ。 */
(async function(){
'use strict';
const $=id=>document.getElementById(id);
const core=window.TAXIAPP_GPS_SHARING_CORE;
const history=window.TAXIAPP_GPS_HISTORY_STORE;
const cloudHistory=window.TAXIAPP_GPS_HISTORY_SYNC;
const set=(id,value)=>{const el=$(id);if(el){el.textContent=String(value);el.classList.toggle('error',/失敗|不可|同期待ち|切替待ち/.test(String(value)));}};
// Firebaseのimport・認証・購読・履歴送信・地図初期化より前に止める。
// 設定欠落時も停止。URL/端末設定で解除しない。
if(window.TAXIAPP_GPS_CLOUD_POLICY?.enabled!==true){
 document.querySelectorAll('main button,main input,main select').forEach(el=>{el.disabled=true;});
 set('connection',window.TAXIAPP_GPS_CLOUD_POLICY?.message||'日報優先：GPSクラウド通信は停止しています');
 for(const id of ['privacyState','senderState','gpsState','sendState','historyState','cloudStatus'])set(id,'日報優先のため停止中');
 set('authState',window.TAXIAPP_GPS_ACCOUNT_CONFIG?.enabled===true?'位置送信用の認証・通信は停止中':'GPS認証・通信は開始していません');
 $('adminGpsHistoryLink').hidden=true;
 return;
}
if(!core){set('connection','位置共有の基盤が読み込めません');return;}
const paint={空車:'#171717',迎車:'#e7b900',実車:'#1874d1',支払い:'#d52b38',待機:'#7a8490'};
let app=null,auth=null,db=null,fx=null,user=null,uid='',displayName='',isAdmin=false;
let privacyPublic=true,privacyConfirmed=false,watchId=null,latestFix=null,lastAccepted=null;
let localModel=null,shift=null,shiftId='',currentStatus='',lastPublishedMs=0,lastPublishedFix=null;
let map=null,vehicleLayer=null,selfLayer=null,vehicles=new Map(),unsubscribe=null,intervalId=null;
let userBusy=false,serverBusy=false,pendingHide=false,lastDutyChecked=false;
let preferences=null,privacySyncing=null,unsubscribePreferences=null;
let editorSession=null,sender=null,senderIdentity=null,unsubscribeSender=null,authEpoch=0,hadEditor=false,settingsLoaded=false,dutyQueue=Promise.resolve();
let presenceWriteTail=Promise.resolve();
function enqueuePresence(write){
 const done=presenceWriteTail.then(write,write);
 presenceWriteTail=done.catch(()=>{});
 return done;
}
let historyOn=false,historyQueue=Promise.resolve(),historyMap=null,historyLayer=null,historyRows=[];
let cloudSession=null,cloudRunning=null,lastLocalFinalizationMs=0,remoteHistoryRows=[];
let firebaseFunctions=null,callFirebase=null,auditRunning=null;
const STORE='taxiapp-store-v1', STORE_OBJECT='state';
const dutyKeys=()=>isAdmin?['taxiapp-account-state-v1-'+uid,'taxiapp']:['taxiapp-account-state-v1-'+uid];
const prefKey=()=> 'taxiapp-location-public-v1-'+uid;
const historyPrefKey=()=> 'taxiapp-location-history-enabled-v1-'+uid;
const visible=()=>document.visibilityState==='visible';
const statusText=()=>privacyPublic?(privacyConfirmed?'公開中':'公開設定確認中'):
  (privacyConfirmed?'非公開中':'非公開切替待ち');
const notify=message=>set('connection',message);

function readLegacy(){
 return new Promise(resolve=>{ 
  if(!uid)return resolve(null);
  const owner=uid;
  let finished=false;const timer=setTimeout(()=>finish(null),3000);
  const finish=x=>{if(finished)return;finished=true;clearTimeout(timer);resolve(uid===owner?x:null);};
  const fallback=()=>{for(const key of dutyKeys()){
   try{const value=JSON.parse(localStorage.getItem(key)||'null');
    if(value?.version===1&&Array.isArray(value.shifts)){finish(value);return;}
   }catch{}
  }finish(null);};
  if(!window.indexedDB)return fallback();
  try{
   const req=indexedDB.open(STORE);
   req.onupgradeneeded=()=>{try{req.transaction.abort();}catch{}};
   req.onerror=fallback;
   req.onblocked=()=>finish(null);
   req.onsuccess=()=>{
    const database=req.result;
    if(!database.objectStoreNames.contains(STORE_OBJECT)){database.close();return fallback();}
    const tx=database.transaction(STORE_OBJECT,'readonly');
    tx.onerror=tx.onabort=()=>{database.close();finish(null);};
    const keys=dutyKeys(),results=new Map();let pending=keys.length;
    const done=()=>{if(--pending!==0)return;
     database.close();
     // UID別の正式状態が入庫済みなら、旧管理者キーの営業中状態を採用しない。
     for(const key of keys){const row=results.get(key);
      if(row?.version===1&&Array.isArray(row.shifts)){finish(row);return;}}
     fallback();
    };
    for(const key of keys){
     const request=tx.objectStore(STORE_OBJECT).get(key);
     request.onsuccess=()=>{results.set(key,request.result);done();};
     request.onerror=done;
    }
   };
  }catch{fallback();}
 });
}
function initializeMap(){
 if(!window.L){notify('地図ライブラリが読み込めません。通信を確認してください');return;}
 map=L.map('map',{zoomControl:true}).setView([34.75,135.4],10);
 L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',{
  minZoom:5,maxZoom:18,attribution:'© 国土地理院'
 }).addTo(map);
 map.on('moveend',()=>{if(uid)try{localStorage.setItem('taxiapp-location-map-v1-'+uid,JSON.stringify({lat:map.getCenter().lat,lon:map.getCenter().lng,zoom:map.getZoom()}));}catch{}});
 vehicleLayer=L.layerGroup().addTo(map);
 selfLayer=L.layerGroup().addTo(map);
}
function makeMarker(p,label,status,own=false,accuracy=null,updatedAtMs=null){
 if(!map)return;
 const layer=own?selfLayer:vehicleLayer;
 const marker=L.circleMarker([p.lat,p.lon],{radius:own?10:9,color:'#fff',weight:2,
  fillColor:paint[status]||'#171717',fillOpacity:0.92}).addTo(layer);
 const name=document.createElement('div');
 const title=document.createElement('strong');title.textContent=label;
 name.append(title,document.createElement('br'),document.createTextNode(status));
 if(Number.isFinite(accuracy))name.append(document.createElement('br'),
  document.createTextNode('測位精度 ±'+Math.round(accuracy)+'m'));
 if(Number.isFinite(updatedAtMs))name.append(document.createElement('br'),document.createTextNode('最終更新 '+new Date(updatedAtMs).toLocaleTimeString('ja-JP')));
 if(accuracy>100)name.append(document.createElement('br'),document.createTextNode('位置精度低下中'));
 marker.bindPopup(name);
 if(Number.isFinite(accuracy)&&accuracy>100){
  marker.on('click',()=>{
   L.circle([p.lat,p.lon],{radius:accuracy,color:'#a35b13',weight:1,fillOpacity:.05}).addTo(layer);
  });
 }
 return marker;
}
function draw(){
 if(!map)return;
 vehicleLayer.clearLayers();selfLayer.clearLayers();
 const visiblePeers=[], now=Date.now();
 for(const [id,data] of vehicles){
  if(id===uid)continue;
  const state=core.presenceView(data,now);
  if(!state.show)continue;
  visiblePeers.push({id,...data,view:state});
  makeMarker(data,data.name||'登録利用者',data.status||'空車',false,data.accuracy,now-state.ageMs);
 }
 visiblePeers.sort((a,b)=>{
  if(latestFix){
   return core.distanceMeters(latestFix,a)-core.distanceMeters(latestFix,b);
  }
  return String(a.name||'').localeCompare(String(b.name||''),'ja');
 });
 const list=$('vehicleList');list.replaceChildren();
 const local=document.createElement('button');
 local.type='button';local.textContent='自分'+(shift?'（'+currentStatus+'）':'（入庫済み）')+(!shift||!privacyPublic?'｜共有停止中':'');
 local.addEventListener('click',()=>{if(latestFix)map.setView([latestFix.lat,latestFix.lon],15);});
 list.append(local);
 for(const peer of visiblePeers){
  const button=document.createElement('button');button.type='button';
  let distance='—';
  if(latestFix)distance=core.distanceMeters(latestFix,peer)<1000?
   Math.round(core.distanceMeters(latestFix,peer))+'m':
   (core.distanceMeters(latestFix,peer)/1000).toFixed(1)+'km';
  button.textContent=(peer.name||'登録利用者')+'｜'+peer.status+'｜'+distance+
   '｜最終更新 '+new Date(now-peer.view.ageMs).toLocaleTimeString('ja-JP')+
   (peer.view.stale?'｜通信停止中':'');
  button.addEventListener('click',()=>{map.setView([peer.lat,peer.lon],15);
   const popup=document.createElement('div');popup.textContent=button.textContent;
   L.popup().setLatLng([peer.lat,peer.lon]).setContent(popup).openOn(map);});
  list.append(button);
 }
 if(uid&&latestFix){
  makeMarker(latestFix,'自分',currentStatus||'空車',true,latestFix.accuracy);
 }
 if(map&&!map._taxiInitialCentered&&!map._taxiFallbackFitted&&visiblePeers.length){
  map.fitBounds(L.latLngBounds(visiblePeers.map(p=>[p.lat,p.lon])).pad(.12),{maxZoom:15});map._taxiFallbackFitted=true;
 }
 set('vehicleCount','共有車両 '+visiblePeers.length+'台');
}

function startHistoryWrite(fix,suspectedJump){
 if(!historyOn||!shift||!history||!visible())return;
 const owner=uid,id=shiftId;
 const start=Date.parse(shift.startedIso||'');
 if(!Number.isFinite(start)){
  set('historyState','出庫日時の原データを確認できないため履歴を保存しません');
  return;
 }
 historyQueue=historyQueue.then(async()=>{
  const didWrite=await history.record(owner,id,start,fix,suspectedJump);
  if(didWrite)await refreshHistory();
 }).catch(error=>set('historyState','GPS履歴の端末保存失敗：'+String(error.message||error)));
}
function markHistoryGap(owner=uid,id=shiftId){
 if(!history||!owner||!id)return;
 historyQueue=historyQueue.then(()=>history.markGap(owner,id))
  .catch(error=>set('historyState','GPS履歴の区間区切り失敗：'+String(error.message||error)));
}
async function refreshHistory(){
 if(!history||!uid)return;
 const owner=uid,epoch=authEpoch;
 const localRows=await history.list(owner),audits=await history.pendingAudits(owner);
 if(uid!==owner||authEpoch!==epoch)return;
 const localIds=new Set(localRows.map(row=>row.shiftId));
 const bytes=new TextEncoder().encode(JSON.stringify(localRows)).length;
 set('storageSummary','端末内 '+localRows.length+'乗務／概算 '+(bytes/1024).toFixed(1)+' KB');
 set('auditState','CSV監査の未同期 '+audits.length+'件');
 historyRows=[...localRows,...remoteHistoryRows.filter(row=>!localIds.has(row.shiftId))].filter(row=>row.points?.length&&
  (!Number.isFinite(row.endedAtMs)||cloudHistory.retentionDeadlineMs(row.endedAtMs)>=Date.now()))
  .sort((a,b)=>(b.startedAtMs||0)-(a.startedAtMs||0));
 const select=$('historyShiftSelect'),prior=select.value;
 select.replaceChildren();
 for(const row of historyRows){
  const option=document.createElement('option');option.value=row.shiftId;
  option.textContent=new Date(row.startedAtMs).toLocaleString('ja-JP')+'｜'+row.points.length+
   '点｜'+(Number.isFinite(row.endedAtMs)?new Date(row.endedAtMs).toLocaleString('ja-JP'):'営業中')+'｜'+(row.serverStatus||'未送信');
  select.append(option);
 }
 select.disabled=historyRows.length===0;
 if(prior&&historyRows.some(row=>row.shiftId===prior))select.value=prior;
 const counts=historyRows.reduce((m,row)=>{const s=row.serverStatus||'未送信';m[s]=(m[s]||0)+1;return m;},{});
 set('historyState',(historyOn?'走行履歴：記録ON':'走行履歴：記録OFF')+
 '｜履歴 '+historyRows.length+'乗務｜保存済み '+(counts['保存済み']||0)+
 '／未送信 '+(counts['未送信']||0)+'／エラー '+(counts['エラー']||0));
 if(select.value)await displayHistory(select.value);
}

async function finalizeStoredShifts(model){
 if(!history||!model||!Array.isArray(model.shifts)||!uid)return;
 if(Date.now()-lastLocalFinalizationMs<60000)return;
 lastLocalFinalizationMs=Date.now();
 const owner=uid,epoch=authEpoch;
 const rows=await history.list(owner);
 if(uid!==owner||authEpoch!==epoch)return;
 for(const row of rows){
  if(Number.isFinite(row.endedAtMs)||!row.points?.length)continue;
  const matching=model.shifts.find(s=>s.id===row.shiftId);
  if(!matching?.endedIso)continue;
  const endedAtMs=Date.parse(matching.endedIso);
  if(Number.isFinite(endedAtMs))await history.finish(owner,row.shiftId,endedAtMs);
 }
}
async function attemptCloudSync(singleId){
 if(!cloudSession||!uid||!history||cloudRunning===cloudSession)return;
 if(navigator.onLine===false){set('cloudStatus','オフライン：GPS履歴は端末に保持');return;}
 const session=cloudSession;cloudRunning=session;
 const currentUid=uid;
 set('cloudStatus','GPS履歴を送信・保存照合中');
 try{
  await historyQueue;
  const rows=singleId?[{shiftId:singleId}]:await history.list(currentUid);
  let success=0,errors=0;
  for(const row of rows){
   if(uid!==currentUid||cloudSession!==session)return;
   const result=await session.one(currentUid,row.shiftId);
   if(result.status==='saved')success++;
   if(result.status==='error')errors++;
  }
  if(uid!==currentUid||cloudSession!==session)return;
  set('cloudStatus',errors?
   'GPS履歴：'+errors+'乗務を送信できません。端末に保持':
   'GPS履歴：保存確認 '+success+'乗務');
  await refreshHistory();
 }catch(error){if(uid===currentUid&&cloudSession===session)set('cloudStatus','GPS履歴の同期に失敗：'+String(error.message||error));}
 finally{if(cloudRunning===session)cloudRunning=null;}
}

function historyMapInit(){
 if(historyMap||!window.L)return;
 historyMap=L.map('historyMap',{zoomControl:true}).setView([34.75,135.4],10);
 L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',{
   minZoom:5,maxZoom:18,attribution:'© 国土地理院'}).addTo(historyMap);
 historyLayer=L.layerGroup().addTo(historyMap);
}
async function displayHistory(id){
 const row=historyRows.find(item=>item.shiftId===id);
 if(!row){set('historyDetail','履歴を選択してください');return;}
 historyMapInit();
 const pts=(row.points||[]).filter(p=>!p.suspectedJump);
 set('historyDetail',(row.source==='cloud'?'クラウド保存':'端末保存')+' '+row.points.length+'地点／表示 '+pts.length+
  '地点／'+(row.serverStatus||'未送信'));
 if(!historyMap)return;
 historyLayer.clearLayers();
 const bySegment=new Map();
 for(const p of pts){
  if(!bySegment.has(p.segmentNo))bySegment.set(p.segmentNo,[]);
  bySegment.get(p.segmentNo).push(p);
 }
 for(const segment of bySegment.values()){
  if(segment.length<2)continue;
  const line=L.polyline(segment.map(p=>[p.lat,p.lon]),{color:'#1768b8',weight:4}).addTo(historyLayer);
  line.on('click',event=>{
   let closest=null,best=Infinity;
   for(const p of segment){
    const n=core.distanceMeters({lat:event.latlng.lat,lon:event.latlng.lng},p);
    if(n<best){best=n;closest=p;}
   }
   if(closest)L.popup().setLatLng([closest.lat,closest.lon])
    .setContent('GPS記録：'+new Date(closest.capturedAtMs).toLocaleString('ja-JP')).openOn(historyMap);
  });
 }
 if(pts.length){
  const first=pts[0],last=pts[pts.length-1];
  L.circleMarker([first.lat,first.lon],{radius:7,color:'#087a71'}).bindPopup('記録開始').addTo(historyLayer);
  L.circleMarker([last.lat,last.lon],{radius:7,color:'#c44038'}).bindPopup('記録終了').addTo(historyLayer);
  const bounds=L.latLngBounds(pts.map(p=>[p.lat,p.lon]));
  if(pts.length===1)historyMap.setView([first.lat,first.lon],15);
  else historyMap.fitBounds(bounds.pad(.12),{maxZoom:16});
 }
}
async function syncCsvAudits(){
 if(auditRunning===authEpoch||!uid||!firebaseFunctions||navigator.onLine===false)return;
 const owner=uid,epoch=authEpoch;auditRunning=epoch;
 try{
  for(const row of await history.pendingAudits(owner)){
   if(uid!==owner||authEpoch!==epoch)return;
   const response=await callFirebase(firebaseFunctions,'recordOwnGpsCsvAudit')({
    actorUid:owner,operationId:row.operationId,shiftId:row.shiftId,atMs:row.atMs});
   if(response.data?.operationId!==row.operationId||response.data?.status!=='saved')throw Error('CSV監査の保存応答が一致しません');
   await history.confirmAudit(owner,row.operationId);
  }
  if(uid===owner)set('auditState','CSV監査の未同期 '+(await history.pendingAudits(owner)).length+'件');
 }catch(error){if(uid===owner)set('auditState','CSV監査の同期待ち：'+error.message);}
 finally{if(auditRunning===epoch)auditRunning=null;}
}
async function deleteConfirmedCopies(){
 if(!uid||!history)return;
 const owner=uid,rows=(await history.list(owner)).filter(r=>r.serverStatus==='保存済み'&&Number.isFinite(r.savedAtMs));
 if(!rows.length)return;
 if(!confirm('サーバー保存確認済みの端末GPSコピー '+rows.length+'乗務を削除します。未送信GPS・監査ログ・クラウド履歴は対象外です。削除しますか？'))return;
 await historyQueue;
 if(uid!==owner)return;
 await history.removeConfirmed(owner);if(uid===owner)await refreshHistory();
}
async function historyExport(){
 const select=$('historyShiftSelect');if(!select.value)return;
 const owner=uid,epoch=authEpoch,id=select.value,remote=remoteHistoryRows;
 const row=await history.fetchOne(owner,id) || remote.find(item=>item.shiftId===id);
 if(uid!==owner||epoch!==authEpoch)return;
 if(!row||!row.points.length)return;
 if(Number.isFinite(row.endedAtMs)&&cloudHistory.retentionDeadlineMs(row.endedAtMs)<Date.now())throw Error('GPS履歴の保存期限を過ぎています');
 await history.queueCsvAudit(owner,row.shiftId);
 if(uid!==owner||epoch!==authEpoch)return;
 const csv=core.historyCsv(row.points);
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const jstName=new Date(row.startedAtMs+9*3600000).toISOString().slice(0,19)
  .replace('T','_').replace(/:/g,'-');
 const filename=jstName+'_'+row.shiftId+'_gps.csv';
 const a=document.createElement('a');a.href=url;a.download=filename;
 document.body.append(a);a.click();a.remove();
 set('csvDownloadInfo','CSVファイル名：'+filename+'（保存先はブラウザのダウンロード一覧で確認）');
 set('auditState','CSV監査は端末に記録済み・サーバー同期待ち');syncCsvAudits();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function deleteCloudHistory(){
 if(!uid||!firebaseFunctions||!callFirebase)return;
 const targetUid=uid,id=$('historyShiftSelect').value;
 if(!id)return;
 if(!window.confirm('この乗務のクラウドGPS履歴を削除します。サーバーから復元できなくなります。削除しますか？'))return;
 set('cloudStatus','クラウドGPS履歴の削除を確認中…');
 try{
  const callable=callFirebase(firebaseFunctions,'deleteGpsHistory');
  const response=await callable({actorUid:targetUid,targetUid,shiftId:id,confirmationShiftId:id});
  if(uid!==targetUid)return;
  if(history&&await history.fetchOne(uid,id))await history.setSyncState(uid,id,'削除済み');
  remoteHistoryRows=remoteHistoryRows.filter(row=>row.shiftId!==id);
  await refreshHistory();
  set('cloudStatus',response.data?.status==='deleted'?'クラウドGPS履歴を削除しました':'履歴は既に削除済みです');
 }catch(error){set('cloudStatus','クラウド履歴の削除に失敗：'+String(error.message||error));}
}
async function historyDelete(){
 const owner=uid,epoch=authEpoch,id=$('historyShiftSelect').value;if(!id)return;
 const local=await history.fetchOne(owner,id);
 if(uid!==owner||authEpoch!==epoch)return;
 if(!local){set('historyState','この履歴はクラウド保存のみ。端末内の削除対象はありません');return;}
 if(!confirm('この乗務の端末内GPS履歴を削除します。未送信の履歴は復元できません。削除しますか？'))return;
 await history.remove(owner,id);if(uid===owner&&authEpoch===epoch)await refreshHistory();
 if(historyLayer)historyLayer.clearLayers();
}

function stopGps(){
 if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null;}
}
function shouldTrack(){
 return Boolean(uid&&shift&&visible()&&sender?.canTrack()&&(privacyPublic||historyOn));
}
function ensureGps(){
 const must=shouldTrack();
 if(!must){stopGps();return;}
 if(watchId!==null)return;
 if(!navigator.geolocation){notify('このブラウザでは位置情報を利用できません');return;}
 watchId=navigator.geolocation.watchPosition(position=>{
  if(!shouldTrack())return;
  const fix=core.fixFromPosition(position);
  if(!fix){set('gpsState','GPS測位不正');return;}
  const decision=core.fixDecision(lastAccepted,fix);
  if(historyOn&&shift)startHistoryWrite(fix,!decision.ok);
  if(!decision.ok){set('gpsState','GPS '+decision.reason+'：送信を除外');return;}
  lastAccepted=fix;latestFix=fix;
  set('gpsState','測位中 ±'+Math.round(fix.accuracy)+'m'+(fix.accuracy>100?'（位置精度低下中）':''));
  draw();
  if(map&&!map._taxiInitialCentered){map.setView([fix.lat,fix.lon],14);map._taxiInitialCentered=true;}
  if(privacyPublic&&shift&&visible())publish(fix).catch(error=>notify('位置送信エラー：'+String(error.code||error.message)));
 },error=>set('gpsState','位置情報エラー：'+error.message),{
  enableHighAccuracy:true,maximumAge:10000,timeout:30000
 });
}
function presenceDoc(fix){
 return {
  public:true,onDuty:true,status:currentStatus,
  name:displayName||'登録利用者',
  lat:fix.lat,lon:fix.lon,accuracy:fix.accuracy,
  speed:fix.speed,heading:fix.heading,shiftId,
  capturedAtMs:fix.capturedAtMs,updatedAt:fx.serverTimestamp()
 };
}
async function publish(fix){
 if(!sender?.canTrack()||!db||!fx||!uid||!privacyPublic||!privacyConfirmed||!shift||!visible()||serverBusy)return;
 const interval=core.sendIntervalMs(fix,lastPublishedFix);
 if(lastPublishedMs&&Date.now()-lastPublishedMs<interval)return;
 serverBusy=true;
 try{
  // This is a NEW GPS-only collection; never write privateDuties or taxiapp-store-v1.
  const targetUid=uid,targetShift=shiftId,payload=presenceDoc(fix);
  const sent=await enqueuePresence(async()=>{
   if(uid!==targetUid||shiftId!==targetShift||!privacyPublic||!privacyConfirmed||!shift||!visible())return false;
   const result=await sender.send(payload);return result.status==='sent';
  });
  if(!sent||uid!==targetUid||shiftId!==targetShift)return;
  lastPublishedMs=Date.now();lastPublishedFix=fix;
  set('sendState','送信済み '+new Date(lastPublishedMs).toLocaleTimeString('ja-JP'));
 }finally{serverBusy=false;}
}
function closedPresence(){return {
 public:false,onDuty:false,status:'',name:displayName||'登録利用者',
 lat:null,lon:null,accuracy:null,speed:null,heading:null,shiftId:'',capturedAtMs:null
};}
async function hidePresence(reason){
 if(!sender)return;
 pendingHide=true;stopGps();markHistoryGap();
 if(navigator.onLine===false){set('sendState','共有停止の反映待ち：最終位置が最大5分残る場合があります');return;}
 const owner=uid,current=sender;
 try{
  const stopped=await current.stop(closedPresence());
  if(uid!==owner||sender!==current)return;
  pendingHide=false;
  set('sendState',stopped?'共有停止：'+reason:'この画面からの位置送信は停止中');
 }catch(error){if(uid===owner)notify('共有停止のサーバー反映待ち：'+String(error.code||error.message));}
}
async function maintainSender(){
 const current=sender;if(!current)return;
 if(!shift||!visible()||!editorSession?.canWrite()||(!privacyPublic&&!historyOn)){
  stopGps();if(current.canTrack())await hidePresence('入庫・非表示・共有停止');return;
 }
 try{await current.ensure();}catch(error){notify('位置送信元を確認できません：'+error.message);}
 if(sender===current)ensureGps();
}
function updateControlAccess(){
 const allowed=settingsLoaded&&(editorSession?.canWrite()||(editorSession?.state()==='pending'&&hadEditor));
 $('privacyToggle').disabled=!allowed;$('historyToggle').disabled=!allowed||!history;
}
function applyPrivacyState(){
 if(!preferences)return;
 const state=preferences.state();privacyPublic=state.public;privacyConfirmed=state.confirmed;
 $('privacyToggle').checked=privacyPublic;set('privacyState',state.conflict?'他端末で設定変更：公開・非公開を選び直してください':statusText());
}
async function syncPrivacy(){
 if(!preferences||privacySyncing===preferences)return;
 const current=preferences;privacySyncing=current;
 try{await current.sync();if(preferences!==current)return;applyPrivacyState();
  if(privacyPublic&&shift&&latestFix&&Date.now()-latestFix.capturedAtMs<30000)await publish(latestFix);
 }catch(error){notify('公開設定の同期待ち：'+String(error.message||error));}
 finally{if(privacySyncing===current)privacySyncing=null;if(preferences===current){applyPrivacyState();ensureGps();}}
}
async function savePrivacy(requested){
 if(!preferences)return;
 try{preferences.choose(requested);}catch(error){notify('公開設定の端末保存失敗：'+error.message);}
 applyPrivacyState();
 if(!requested){stopGps();pendingHide=true;hidePresence('本人の非公開操作');}
 ensureGps();await syncPrivacy();
}
function reconcileDuty(){const run=dutyQueue.then(reconcileDutyNow);dutyQueue=run.catch(()=>{});return run;}
async function reconcileDutyNow(){
 if(!user||!uid)return;
 const epoch=authEpoch,owner=uid;
 const nextModel=await readLegacy();
 if(epoch!==authEpoch||uid!==owner)return;
 const next=core.activeDuty(nextModel);
 const old=shiftId;
 localModel=nextModel;
 await finalizeStoredShifts(nextModel);
 if(epoch!==authEpoch||uid!==owner)return;
 shift=next;
 shiftId=next?next.id:'';
 currentStatus=next?core.businessStatus(next):'';
 set('dutyState',next?('営業中：'+currentStatus):'営業状態確認中／入庫後');
 if(old&&old!==shiftId){
  if(history){const capturedOld=old;
   const endIso=(nextModel?.shifts||[]).find(s=>s.id===capturedOld)?.endedIso;
   const endedAtMs=endIso?Date.parse(endIso):NaN;
   if(Number.isFinite(endedAtMs)){
    historyQueue=historyQueue.then(()=>history.finish(owner,capturedOld,endedAtMs))
     .then(()=>refreshHistory())
     .catch(error=>set('historyState','GPS履歴終了記録の失敗：'+error.message));
    historyQueue.then(()=>attemptCloudSync(capturedOld));
   }else{
    markHistoryGap(uid,capturedOld);
   }
  }
  lastPublishedMs=0;lastPublishedFix=null;lastAccepted=null;latestFix=null;
  await hidePresence('入庫または乗務切替');}
 lastDutyChecked=true;
 await maintainSender();
 ensureGps();
 if(shift&&privacyPublic&&latestFix&&!lastPublishedMs&&Date.now()-latestFix.capturedAtMs<30000)await publish(latestFix);
 draw();
}
function subscribe(){
 if(unsubscribe){unsubscribe();unsubscribe=null;}
 const q=fx.query(fx.collection(db,'gpsPresence'),
   fx.where('public','==',true),fx.where('onDuty','==',true));
 unsubscribe=fx.onSnapshot(q,snap=>{
  vehicles.clear();snap.forEach(doc=>vehicles.set(doc.id,doc.data()));draw();
  notify('位置共有の受信中');
 },error=>notify('位置共有の受信不可（権限ルール・通信を確認）：'+String(error.code||error.message)));
}
function bindEvents(){
 $('privacyToggle').addEventListener('change',event=>savePrivacy(event.target.checked));
 $('historyToggle').addEventListener('change',()=>{
  const previous=historyOn;historyOn=$('historyToggle').checked;
  try{localStorage.setItem(historyPrefKey(),historyOn?'1':'0');}catch{}
  if(previous&&!historyOn)markHistoryGap();
  ensureGps();refreshHistory().catch(error=>set('historyState','履歴更新失敗：'+error.message));
 });
 $('historyShiftSelect').addEventListener('change',event=>displayHistory(event.target.value));
 $('historyResend').addEventListener('click',()=>attemptCloudSync($('historyShiftSelect').value));
 $('historyResendAll').addEventListener('click',()=>attemptCloudSync());
 $('historyFetchCloud').addEventListener('click',async()=>{
  if(!cloudSession)return;
  const ownUid=uid;
  set('cloudStatus','保存済みのGPS履歴を取得中…');
  try{
   const remote=await cloudSession.listRemote(ownUid);
   if(uid!==ownUid)return;
   remoteHistoryRows=remote;
   await refreshHistory();
   set('cloudStatus','クラウド履歴を'+remote.length+'乗務取得');
  }catch(error){set('cloudStatus','サーバー履歴を取得できません：'+String(error.message||error));}
 });
 $('historyExport').addEventListener('click',()=>historyExport().catch(error=>set('historyState','CSV出力失敗：'+error.message)));
 $('historyDeleteConfirmed').addEventListener('click',()=>deleteConfirmedCopies().catch(error=>set('historyState','端末コピーの削除失敗：'+error.message)));
 $('historyDelete').addEventListener('click',()=>historyDelete().catch(error=>set('historyState','履歴削除失敗：'+error.message)));
 $('historyDeleteCloud').addEventListener('click',()=>deleteCloudHistory());
 $('historyFit').addEventListener('click',()=>displayHistory($('historyShiftSelect').value));
 $('recenter').addEventListener('click',()=>{if(map&&latestFix)map.setView([latestFix.lat,latestFix.lon],15);});
 $('vehicleHeading').addEventListener('click',()=>{
  const panel=$('vehicleList');
  const open=panel.hidden;panel.hidden=!open;
  $('vehicleHeading').setAttribute('aria-expanded',String(open));
 });
 window.addEventListener('offline',()=>{sender?.invalidate();stopGps();markHistoryGap();set('senderState','通信断：位置送信元の確認待ち');});
 window.addEventListener('online',()=>{reconcileDuty();syncPrivacy();syncCsvAudits();attemptCloudSync();});
 document.addEventListener('visibilitychange',()=>{
  if(!visible()){stopGps();markHistoryGap();hidePresence('画面非表示');}
  else {syncCsvAudits();history?.cleanupConfirmed(uid).then(()=>refreshHistory()).catch(error=>set('historyState','端末整理失敗：'+error.message));reconcileDuty().catch(error=>notify('営業状態確認エラー：'+error.message));}
 });
}
async function boot(){
 const project=window.TAXIAPP_GPS_FIREBASE_PROJECT;
 if(!project)throw Error('GPS専用接続の基盤がありません');
 const config=project.configFor(window.TAXIAPP_GPS_FIREBASE_CONFIG,window.TAXIAPP_FIREBASE_CONFIG);
 initializeMap();bindEvents();set('historyState','ログイン後にGPS履歴を確認できます');
 const v='12.4.0';
 const [{initializeApp,getApps},a,f,fn]=await Promise.all([
  import('https://www.gstatic.com/firebasejs/'+v+'/firebase-app.js'),
  import('https://www.gstatic.com/firebasejs/'+v+'/firebase-auth.js'),
  import('https://www.gstatic.com/firebasejs/'+v+'/firebase-firestore.js'),
  import('https://www.gstatic.com/firebasejs/'+v+'/firebase-functions.js')]);
 fx=f;app=project.initialize({initializeApp,getApps},config,window.TAXIAPP_FIREBASE_CONFIG);auth=a.getAuth(app);db=f.getFirestore(app);
 firebaseFunctions=fn.getFunctions(app,'asia-northeast1');callFirebase=fn.httpsCallable;
 a.onAuthStateChanged(auth,async nextUser=>{
  const epoch=++authEpoch;lastLocalFinalizationMs=0;
  sender?.dispose();sender=null;senderIdentity?.release();senderIdentity=null;editorSession?.clear();editorSession=null;hadEditor=false;settingsLoaded=false;$('privacyToggle').disabled=true;$('historyToggle').disabled=true;
  if(unsubscribeSender){unsubscribeSender();unsubscribeSender=null;}
  stopGps();if(unsubscribe){unsubscribe();unsubscribe=null;}
  cloudSession?.dispose();cloudSession=null;remoteHistoryRows=[];
  preferences?.dispose();preferences=null;privacyConfirmed=false;pendingHide=false;
  if(unsubscribePreferences){unsubscribePreferences();unsubscribePreferences=null;}
  latestFix=null;lastAccepted=null;lastPublishedMs=0;lastPublishedFix=null;
  if(intervalId){clearInterval(intervalId);intervalId=null;}
  if(vehicleLayer)vehicleLayer.clearLayers();if(selfLayer)selfLayer.clearLayers();
  if(historyLayer)historyLayer.clearLayers();$('historyShiftSelect').replaceChildren();
  $('adminGpsHistoryLink').hidden=true;
  user=nextUser;uid=nextUser?.uid||'';shift=null;shiftId='';vehicles.clear();
  if(!user){$('privacyToggle').disabled=true;$('historyToggle').disabled=true;
   notify('TAXIAPP本体でGoogleログインしてください');set('authState','未ログイン');return;}
  try{
   const ownerAtLogin=uid;
   const [own,admin]=await Promise.all([
    f.getDoc(f.doc(db,'users',uid)),f.getDoc(f.doc(db,'admins',uid))
   ]);
   if(epoch!==authEpoch||uid!==ownerAtLogin)return;
   const active=own.exists()&&own.data().status==='active';
   isAdmin=admin.exists()&&admin.data().enabled===true;
   $('adminGpsHistoryLink').hidden=!isAdmin;
   if(!active&&!isAdmin){notify('TAXIAPPの利用登録が確認できません');return;}
   displayName=own.exists()?String(own.data().openChatName||user.displayName||'登録利用者'):
    String(user.displayName||'登録利用者');
   set('authState',displayName+'（既存TAXIAPPログイン）');
   if(map){map._taxiInitialCentered=false;map._taxiFallbackFitted=false;
    try{const saved=JSON.parse(localStorage.getItem('taxiapp-location-map-v1-'+uid)||'null');
     if(saved&&Number.isFinite(saved.lat)&&Math.abs(saved.lat)<=90&&Number.isFinite(saved.lon)&&Math.abs(saved.lon)<=180&&Number.isFinite(saved.zoom)){
      map.setView([saved.lat,saved.lon],saved.zoom);map._taxiFallbackFitted=true;
     }}catch{}
   }
   const owner=uid;
   editorSession=window.TAXIAPP_DEVICE_SESSION.create({auth,db,f,onMode:(mode,previous,detail)=>{
    if(epoch!==authEpoch)return;
    set('senderState',detail);
    if(mode==='writer')hadEditor=true;else if(mode==='viewer')hadEditor=false;
    updateControlAccess();
    if(mode!=='writer'){sender?.invalidate();stopGps();markHistoryGap();}
    else reconcileDuty().catch(error=>notify('操作端末確認後の照合失敗：'+error.message));
   }});
   const identity=await window.TAXIAPP_GPS_PRESENCE_SENDER.acquireIdentity({uid:owner,storage:sessionStorage,locks:navigator.locks});
   if(epoch!==authEpoch){identity.release();return;}
   senderIdentity=identity;
   sender=window.TAXIAPP_GPS_PRESENCE_SENDER.create({auth,db,f,session:editorSession,uid:owner,
    senderId:identity.senderId,onChange:state=>{
     if(epoch!==authEpoch)return;
     set('senderState',state.message);
     if(!state.held){stopGps();markHistoryGap();}
    }});
   await editorSession.begin(nextUser,{claimOnLogin:false});
   if(epoch!==authEpoch)return;
   const currentSender=sender;
   unsubscribeSender=f.onSnapshot(f.doc(db,'gpsSenderSessions',owner),{includeMetadataChanges:true},snap=>{
    if(epoch!==authEpoch||sender!==currentSender)return;
    currentSender.observe(snap);ensureGps();
   },error=>{if(epoch===authEpoch){currentSender.invalidate();stopGps();notify('位置送信元の監視失敗：'+error.message);}});
   preferences=window.TAXIAPP_GPS_SHARING_PREFERENCES.create({uid:owner,storage:localStorage,
    online:()=>navigator.onLine!==false,
    read:async()=>{
     const saved=await f.getDocFromServer(f.doc(db,'gpsSharePrefs',owner));
     return saved.exists()?{public:saved.data().public,revision:saved.data().revision??0,operationId:saved.data().operationId??null}:null;
    },
    write:async(value,operation)=>{
     const activeSession=editorSession?.sessionId();
     if(uid!==owner||!editorSession?.canWrite())throw Error('操作端末ではないため公開設定の送信を保留します');
     await enqueuePresence(async()=>{
      if(uid!==owner||editorSession?.sessionId()!==activeSession)throw Error('操作端末が切り替わりました');
      const prefRef=f.doc(db,'gpsSharePrefs',owner),presenceRef=f.doc(db,'gpsPresence',owner);
      await f.runTransaction(db,async tx=>{
       const pref=await tx.get(prefRef);
       if(uid!==owner||editorSession?.sessionId()!==activeSession)throw Error('操作端末が切り替わりました');
       if(pref.exists()&&pref.data().operationId===operation.id)return;
       if((pref.exists()?(pref.data().revision??0):0)!==operation.baseRevision)
        throw Error('他端末で公開設定が変更されました。公開・非公開を選び直してください');
       tx.set(prefRef,{public:value,revision:operation.baseRevision+1,operationId:operation.id,
        writerSessionId:activeSession,updatedAt:f.serverTimestamp()});
       if(!value)tx.set(presenceRef,{...closedPresence(),updatedAt:f.serverTimestamp(),senderId:'',writerSessionId:''});
      });
     });
    }});
   applyPrivacyState();await syncPrivacy();
   if(epoch!==authEpoch)return;
   const currentPreferences=preferences;
   unsubscribePreferences=f.onSnapshot(f.doc(db,'gpsSharePrefs',owner),{includeMetadataChanges:true},snap=>{
    if(uid!==owner||preferences!==currentPreferences||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)return;
    if(!snap.exists()||typeof snap.data().public!=='boolean')return;
    currentPreferences.receive({public:snap.data().public,revision:snap.data().revision??0,operationId:snap.data().operationId??null});applyPrivacyState();
    if(!privacyPublic)stopGps();ensureGps();draw();
   },error=>{
    if(uid===owner)notify('公開設定の他端末同期を確認できません：'+String(error.message||error));
   });
   $('privacyToggle').checked=privacyPublic;
   set('privacyState',statusText());
   try{historyOn=localStorage.getItem(historyPrefKey())==='1';}catch{historyOn=false;}
   $('historyToggle').checked=historyOn;settingsLoaded=true;updateControlAccess();
   await history.cleanupConfirmed(owner).catch(error=>{if(epoch===authEpoch)set('cloudStatus','保存済みGPS履歴の端末整理に失敗：'+error.message);});
   if(epoch!==authEpoch)return;
   cloudSession=cloudHistory&&history?cloudHistory.create({auth,db,f,store:history,
    upload:data=>callFirebase(firebaseFunctions,'saveOwnGpsHistory')(data)}):null;
   await refreshHistory();
   if(epoch!==authEpoch)return;
   subscribe();
   await reconcileDuty();
   if(epoch!==authEpoch)return;
   attemptCloudSync();syncCsvAudits();
   if(!privacyPublic&&!historyOn)await hidePresence('既存の非公開設定');
   if(!intervalId)intervalId=setInterval(()=>{
    reconcileDuty().catch(error=>notify('営業状態の照合に失敗：'+String(error.message)));
    draw();
    if(pendingHide&&navigator.onLine!==false)hidePresence('未反映操作の再送');
    if(preferences&&!preferences.state().confirmed)syncPrivacy();
   },5000);
  }catch(error){if(epoch===authEpoch)notify('TAXIAPP登録の確認に失敗：'+String(error.code||error.message));}
 });
}
try{await boot();}catch(error){notify('位置共有の起動に失敗：'+String(error.message||error));}
})();
