/* TAXIAPP 位置共有・独立試験UI。既存営業データとGPSトリップは読み取りのみ。 */
(async function(){
'use strict';
const $=id=>document.getElementById(id);
const core=window.TAXIAPP_GPS_SHARING_CORE;
const set=(id,value)=>{const el=$(id);if(el)el.textContent=String(value);};
if(!core){set('connection','位置共有の基盤が読み込めません');return;}
const paint={空車:'#171717',迎車:'#e7b900',実車:'#1874d1',支払い:'#d52b38',待機:'#7a8490'};
let app=null,auth=null,db=null,fx=null,user=null,uid='',displayName='',isAdmin=false;
let privacyPublic=true,privacyConfirmed=false,watchId=null,latestFix=null,lastAccepted=null;
let localModel=null,shift=null,shiftId='',currentStatus='',lastPublishedMs=0,lastPublishedFix=null;
let map=null,vehicleLayer=null,selfLayer=null,vehicles=new Map(),unsubscribe=null,intervalId=null;
let userBusy=false,serverBusy=false,pendingHide=false,lastDutyChecked=false;
const STORE='taxiapp-store-v1', STORE_OBJECT='state', STORE_KEY='taxiapp';
const prefKey=()=> 'taxiapp-location-public-v1-'+uid;
const visible=()=>document.visibilityState==='visible';
const statusText=()=>privacyPublic?'公開中':privacyConfirmed?'非公開中':'非公開切替待ち';
const notify=message=>set('connection',message);

function readLegacy(){
 return new Promise(resolve=>{
  let finished=false;const finish=x=>{if(finished)return;finished=true;resolve(x);};
  const fallback=()=>{try{finish(JSON.parse(localStorage.getItem('taxiapp-v1')||'null'));}catch{finish(null);}};
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
    const request=tx.objectStore(STORE_OBJECT).get(STORE_KEY);
    request.onsuccess=()=>{const value=request.result;database.close();finish(value);};
    request.onerror=()=>{database.close();fallback();};
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
 if(!db||!fx||!uid||!privacyPublic||!shift||!visible()||serverBusy)return;
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
 localStorage.setItem(prefKey(),requested?'1':'0');
 set('privacyState',statusText());
 if(!requested){stopGps();await hidePresence('本人の非公開操作');}
 try{
  await fx.setDoc(fx.doc(db,'gpsSharePrefs',uid),{public:requested,updatedAt:fx.serverTimestamp()});
  privacyConfirmed=true;
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
 if(old&&old!==shiftId){lastPublishedMs=0;lastPublishedFix=null;lastAccepted=null;latestFix=null;
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
  // The on-device history logger is not yet connected; do not falsely claim collection.
  $('historyToggle').checked=false;
  set('historyState','走行履歴の保存機能は未実装');
 });
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
 initializeMap();bindEvents();set('historyState','走行履歴保存：未実装（試験版の次段階）');
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
  if(!user){notify('TAXIAPP本体でGoogleログインしてください');set('authState','未ログイン');return;}
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
   const local=localStorage.getItem(prefKey());
   privacyPublic=local!=='0';privacyConfirmed=false;
   try{
    const setting=await f.getDoc(f.doc(db,'gpsSharePrefs',uid));
    if(setting.exists()&&typeof setting.data().public==='boolean'){
     privacyPublic=setting.data().public;privacyConfirmed=true;
     localStorage.setItem(prefKey(),privacyPublic?'1':'0');
    }
   }catch{notify('位置共有の設定は端末値で仮表示中（サーバー未確認）');}
   $('privacyToggle').checked=privacyPublic;set('privacyState',statusText());
   subscribe();
   await reconcileDuty();
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