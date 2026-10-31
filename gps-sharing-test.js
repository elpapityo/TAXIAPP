/* TAXIAPP 位置共有・独立試験UI。既存営業データとGPSトリップは読み取りのみ。 */
(async function(){
'use strict';
const $=id=>document.getElementById(id);
const core=window.TAXIAPP_GPS_SHARING_CORE;
const history=window.TAXIAPP_GPS_HISTORY_STORE;
const set=(id,value)=>{const el=$(id);if(el)el.textContent=String(value);};
if(!core){set('connection','位置共有の基盤が読み込めません');return;}
const paint={空車:'#171717',迎車:'#e7b900',実車:'#1874d1',支払い:'#d52b38',待機:'#7a8490'};
let app=null,auth=null,db=null,fx=null,user=null,uid='',displayName='',isAdmin=false;
let privacyPublic=true,privacyConfirmed=false,watchId=null,latestFix=null,lastAccepted=null;
let localModel=null,shift=null,shiftId='',currentStatus='',lastPublishedMs=0,lastPublishedFix=null;
let map=null,vehicleLayer=null,selfLayer=null,vehicles=new Map(),unsubscribe=null,intervalId=null;
let userBusy=false,serverBusy=false,pendingHide=false,lastDutyChecked=false;
let historyOn=false,historyQueue=Promise.resolve(),historyMap=null,historyLayer=null,historyRows=[];
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
  let finished=false;const finish=x=>{if(finished)return;finished=true;resolve(x);};
  const fallback=()=>{for(const key of dutyKeys()){
   try{const value=JSON.parse(localStorage.getItem(key)||'null');if(core.activeDuty(value)){finish(value);return;}}catch{}
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
    const keys=dutyKeys();let found=null;let pending=keys.length;
    for(const key of keys){
     const request=tx.objectStore(STORE_OBJECT).get(key);
     request.onsuccess=()=>{if(!found&&core.activeDuty(request.result))found=request.result;
       if(--pending===0){database.close();finish(found);}};
     request.onerror=()=>{if(--pending===0){database.close();finish(found);}};
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
 vehicleLayer=L.layerGroup().addTo(map);
 selfLayer=L.layerGroup().addTo(map);
}
function makeMarker(p,label,status,own=false,accuracy=null){
 if(!map)return;
 const layer=own?selfLayer:vehicleLayer;
 const marker=L.circleMarker([p.lat,p.lon],{radius:own?10:9,color:'#fff',weight:2,
  fillColor:paint[status]||'#171717',fillOpacity:0.92}).addTo(layer);
 const name=document.createElement('div');
 const title=document.createElement('strong');title.textContent=label;
 name.append(title,document.createElement('br'),document.createTextNode(status));
 if(Number.isFinite(accuracy))name.append(document.createElement('br'),
  document.createTextNode('測位精度 ±'+Math.round(accuracy)+'m'));
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
  makeMarker(data,data.name||'登録利用者',data.status||'空車',false,data.accuracy);
 }
 visiblePeers.sort((a,b)=>{
  if(latestFix){
   return core.distanceMeters(latestFix,a)-core.distanceMeters(latestFix,b);
  }
  return String(a.name||'').localeCompare(String(b.name||''),'ja');
 });
 const list=$('vehicleList');list.replaceChildren();
 const local=document.createElement('button');
 local.type='button';local.textContent='自分'+(shift?'（'+currentStatus+'）':'（営業外）');
 local.addEventListener('click',()=>{if(latestFix)map.setView([latestFix.lat,latestFix.lon],15);});
 list.append(local);
 for(const peer of visiblePeers){
  const button=document.createElement('button');button.type='button';
  let distance='—';
  if(latestFix)distance=core.distanceMeters(latestFix,peer)<1000?
   Math.round(core.distanceMeters(latestFix,peer))+'m':
   (core.distanceMeters(latestFix,peer)/1000).toFixed(1)+'km';
  button.textContent=(peer.name||'登録利用者')+'｜'+peer.status+'｜'+distance+
   (peer.view.stale?'｜通信停止中':'');
  button.addEventListener('click',()=>map.setView([peer.lat,peer.lon],15));
  list.append(button);
 }
 if(latestFix){
  makeMarker(latestFix,'自分',currentStatus||'空車',true,latestFix.accuracy);
 }
 set('vehicleCount','共有車両 '+visiblePeers.length+'台');
}

function startHistoryWrite(fix,suspectedJump){
 if(!historyOn||!shift||!history)return;
 const owner=uid,id=shiftId;
 const start=Date.parse(shift.startedIso||'')||Date.now();
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
 historyRows=await history.list(uid);
 const select=$('historyShiftSelect'),prior=select.value;
 select.replaceChildren();
 for(const row of historyRows){
  const option=document.createElement('option');option.value=row.shiftId;
  option.textContent=new Date(row.startedAtMs).toLocaleString('ja-JP')+'｜'+row.points.length+
   '点｜'+(row.serverStatus||'未送信');
  select.append(option);
 }
 select.disabled=historyRows.length===0;
 if(prior&&historyRows.some(row=>row.shiftId===prior))select.value=prior;
 set('historyState',(historyOn?'走行履歴：記録ON':'走行履歴：記録OFF')+
  '｜端末内 '+historyRows.length+'乗務｜クラウド未送信');
 if(select.value)await displayHistory(select.value);
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
 set('historyDetail','端末保存 '+row.points.length+'地点／表示 '+pts.length+
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
async function historyExport(){
 const select=$('historyShiftSelect');if(!select.value)return;
 const row=await history.fetchOne(uid,select.value);
 if(!row||!row.points.length)return;
 const csv=core.historyCsv(row.points);
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const filename=new Date(row.startedAtMs).toISOString().replace(/[:.]/g,'-')+
  '_'+row.shiftId+'_gps.csv';
 const a=document.createElement('a');a.href=url;a.download=filename;
 document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function historyDelete(){
 const id=$('historyShiftSelect').value;if(!id)return;
 if(!confirm('この乗務の端末内GPS履歴を削除します。未送信の履歴は復元できません。削除しますか？'))return;
 await history.remove(uid,id);await refreshHistory();
 if(historyLayer)historyLayer.clearLayers();
}

function stopGps(){
 if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null;}
}
function shouldTrack(){
 return Boolean(uid&&shift&&visible()&&(privacyPublic||$('historyToggle').checked));
}
function ensureGps(){
 const must=shouldTrack();
 if(!must){stopGps();return;}
 if(watchId!==null)return;
 if(!navigator.geolocation){notify('このブラウザでは位置情報を利用できません');return;}
 watchId=navigator.geolocation.watchPosition(position=>{
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
 if(!db||!fx||!uid||!privacyPublic||!privacyConfirmed||!shift||!visible()||serverBusy)return;
 const interval=core.sendIntervalMs(fix,lastPublishedFix);
 if(lastPublishedMs&&Date.now()-lastPublishedMs<interval)return;
 serverBusy=true;
 try{
  // This is a NEW GPS-only collection; never write privateDuties or taxiapp-store-v1.
  await fx.setDoc(fx.doc(db,'gpsPresence',uid),presenceDoc(fix));
  lastPublishedMs=Date.now();lastPublishedFix=fix;
  set('sendState','送信済み '+new Date(lastPublishedMs).toLocaleTimeString('ja-JP'));
 }finally{serverBusy=false;}
}
async function hidePresence(reason){
 if(!uid||!db||!fx)return;
 pendingHide=true;
 try{
  await fx.setDoc(fx.doc(db,'gpsPresence',uid),{
   public:false,onDuty:false,status:'',name:displayName||'登録利用者',
   lat:null,lon:null,accuracy:null,speed:null,heading:null,shiftId:'',
   capturedAtMs:null,updatedAt:fx.serverTimestamp()
  });
  pendingHide=false;privacyConfirmed=true;
  set('sendState','共有停止：'+reason);
 }catch(error){notify('共有停止のサーバー反映待ち：'+String(error.code||error.message));}
}
async function savePrivacy(requested){
 if(!uid||userBusy)return;
 userBusy=true;privacyPublic=requested;privacyConfirmed=false;
 try{localStorage.setItem(prefKey(),requested?'1':'0');}catch{}
 set('privacyState',statusText());
 if(!requested){stopGps();await hidePresence('本人の非公開操作');}
 try{
  await fx.setDoc(fx.doc(db,'gpsSharePrefs',uid),{public:requested,updatedAt:fx.serverTimestamp()});
  privacyConfirmed=!pendingHide;
  if(requested&&shift&&latestFix)await publish(latestFix);
 }catch(error){notify('公開設定の同期待ち：'+String(error.code||error.message));}
 set('privacyState',statusText());userBusy=false;ensureGps();
}
async function reconcileDuty(){
 if(!user||!uid)return;
 const nextModel=await readLegacy();
 const next=core.activeDuty(nextModel);
 const old=shiftId;
 localModel=nextModel;
 shift=next;
 shiftId=next?next.id:'';
 currentStatus=next?core.businessStatus(next):'';
 set('dutyState',next?('営業中：'+currentStatus):'営業状態確認中／入庫後');
 if(old&&old!==shiftId){
  if(history){const capturedOld=old,completed=Date.now();
   historyQueue=historyQueue.then(()=>history.finish(uid,capturedOld,completed))
    .then(refreshHistory).catch(error=>set('historyState','履歴終了保存失敗：'+error.message));}
  lastPublishedMs=0;lastPublishedFix=null;lastAccepted=null;latestFix=null;
  await hidePresence('入庫または乗務切替');}
 lastDutyChecked=true;
 ensureGps();
 if(shift&&privacyPublic&&latestFix&&!lastPublishedMs)await publish(latestFix);
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
 $('historyExport').addEventListener('click',()=>historyExport().catch(error=>set('historyState','CSV出力失敗：'+error.message)));
 $('historyDelete').addEventListener('click',()=>historyDelete().catch(error=>set('historyState','履歴削除失敗：'+error.message)));
 $('historyFit').addEventListener('click',()=>displayHistory($('historyShiftSelect').value));
 $('recenter').addEventListener('click',()=>{if(map&&latestFix)map.setView([latestFix.lat,latestFix.lon],15);});
 $('vehicleHeading').addEventListener('click',()=>{
  const panel=$('vehicleList');
  const open=panel.hidden;panel.hidden=!open;
  $('vehicleHeading').setAttribute('aria-expanded',String(open));
 });
 document.addEventListener('visibilitychange',()=>{
  if(!visible())stopGps();
  else reconcileDuty().catch(error=>notify('営業状態確認エラー：'+error.message));
 });
}
async function boot(){
 initializeMap();bindEvents();set('historyState','ログイン後にGPS履歴を確認できます');
 const config=window.TAXIAPP_FIREBASE_CONFIG;
 if(!config||!config.projectId){notify('TAXIAPPのFirebase設定が見つかりません');return;}
 const v='12.4.0';
 const [{initializeApp,getApps,getApp},a,f]=await Promise.all([
  import('https://www.gstatic.com/firebasejs/'+v+'/firebase-app.js'),
  import('https://www.gstatic.com/firebasejs/'+v+'/firebase-auth.js'),
  import('https://www.gstatic.com/firebasejs/'+v+'/firebase-firestore.js')]);
 fx=f;app=getApps().length?getApp():initializeApp(config);auth=a.getAuth(app);db=f.getFirestore(app);
 a.onAuthStateChanged(auth,async nextUser=>{
  stopGps();if(unsubscribe){unsubscribe();unsubscribe=null;}
  user=nextUser;uid=nextUser?.uid||'';shift=null;shiftId='';vehicles.clear();
  if(!user){$('privacyToggle').disabled=true;$('historyToggle').disabled=true;
   notify('TAXIAPP本体でGoogleログインしてください');set('authState','未ログイン');return;}
  try{
   const [own,admin]=await Promise.all([
    f.getDoc(f.doc(db,'users',uid)),f.getDoc(f.doc(db,'admins',uid))
   ]);
   const active=own.exists()&&own.data().status==='active';
   isAdmin=admin.exists()&&admin.data().enabled===true;
   if(!active&&!isAdmin){notify('TAXIAPPの利用登録が確認できません');return;}
   displayName=own.exists()?String(own.data().openChatName||user.displayName||'登録利用者'):
    String(user.displayName||'登録利用者');
   set('authState',displayName+'（既存TAXIAPPログイン）');
   let local=null;try{local=localStorage.getItem(prefKey());}catch{}
   privacyPublic=local!=='0';privacyConfirmed=false;
   try{
    const setting=await f.getDocFromServer(f.doc(db,'gpsSharePrefs',uid));
    if(setting.exists()&&typeof setting.data().public==='boolean'){
     privacyPublic=setting.data().public;privacyConfirmed=true;
     try{localStorage.setItem(prefKey(),privacyPublic?'1':'0');}catch{}
    } else if(!setting.exists()){
     // Initial default is public, but do not publish before server acknowledgement.
     privacyPublic=true;
     await f.setDoc(f.doc(db,'gpsSharePrefs',uid),{public:true,updatedAt:f.serverTimestamp()});
     privacyConfirmed=true;
    }
   }catch{notify('位置共有の設定は端末値で仮表示中（サーバー未確認）');}
   $('privacyToggle').checked=privacyPublic;
   $('privacyToggle').disabled=false;set('privacyState',statusText());
   try{historyOn=localStorage.getItem(historyPrefKey())==='1';}catch{historyOn=false;}
   $('historyToggle').checked=historyOn;$('historyToggle').disabled=!history;
   await refreshHistory();
   subscribe();
   await reconcileDuty();
   if(!privacyPublic)await hidePresence('既存の非公開設定');
   if(!intervalId)intervalId=setInterval(()=>{
    reconcileDuty().catch(error=>notify('営業状態の照合に失敗：'+String(error.message)));
    draw();
    if(pendingHide)hidePresence('未反映操作の再送');
   },5000);
  }catch(error){notify('TAXIAPP登録の確認に失敗：'+String(error.code||error.message));}
 });
}
try{await boot();}catch(error){notify('位置共有の起動に失敗：'+String(error.message||error));}
})();