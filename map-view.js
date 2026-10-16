/* TAXIAPP map + existing input shell.
 * The legacy input runs unchanged in a same-origin iframe.
 * Map access to taxiapp-store-v1 is READ ONLY. Never write the main data.
 */
(function(){
'use strict';
const core=window.TAXIAPP_MAP_SHARED;
if(!core)throw Error('地図データ処理のファイルが読み込めませんでした');
const $=id=>document.getElementById(id);
const layoutKey='taxiapp-map-layout-v1';
const layoutSelect=$('layoutSelect'),syncStatus=$('syncStatus'),shiftSelect=$('mapShiftSelect'),
 mapMessage=$('mapMessage'),pinList=$('pinList'),googleSearch=$('googleSearchBtn'),
 googleRoute=$('googleRouteBtn'),locate=$('locateBtn'),followBtn=$('followBtn'),
 fitPins=$('fitPinsBtn'),fallback=$('mapFallback');
const L=window.L||null;
let map=null,pinLayer=null,liveLayer=null,pins=[],state=null,shift=null,selectedId=null,
 chosenPin=null,locationFix=null,follow=false,defaultFittedShift='',readBusy=false,lastPinSignature='',
 lastShiftChoices='',hasViewedSavedPoint=false;
function message(text){mapMessage.textContent=String(text||'');}
function storageRead(key){try{return localStorage.getItem(key);}catch{return null;}}
function storageWrite(key,value){try{localStorage.setItem(key,value);}catch{/* selection stays for this session */}}
function selectedLayout(){return document.body.dataset.layout||'stack';}
function applyLayout(value){
 const layout=core.chooseLayout(value,'stack');
 document.body.dataset.layout=layout;layoutSelect.value=layout;
 storageWrite(layoutKey,layout);
 if(layout==='map'){
   message('地図のみ表示中です。入力画面は読み込み済みですが、非表示中のGPS記録は保証できません。');
 }else if(selectedLayout()==='side'&&window.innerWidth<600){
   message('左右分割を選択中。画面が狭い場合は、横スクロールで確認できます。');
 }
 // Leaflet uses the container's size; update after user chooses a layout.
 if(map){requestAnimationFrame(()=>{map.invalidateSize({animate:false});setTimeout(()=>map.invalidateSize({animate:false}),180);});}
}
const initialLayout=core.chooseLayout(storageRead(layoutKey),'stack');
applyLayout(initialLayout);
layoutSelect.addEventListener('change',()=>applyLayout(layoutSelect.value));
window.addEventListener('resize',()=>{if(map)map.invalidateSize({animate:false});});
// HTML viewport orientation must not alter the selected layout.

function makeMap(){
 if(!L){
   fallback.style.display='flex';
   message('地図のライブラリを読み込めませんでした。通信を確認してください。入力操作は可能です。');
   return;
 }
 map=L.map('mapCanvas',{zoomControl:true,preferCanvas:true}).setView([34.75,135.4],10);
 L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',{
   minZoom:5,maxZoom:18,attribution:'&copy; <a href="https://maps.gsi.go.jp/" target="_blank" rel="noopener">国土地理院</a>'
 }).addTo(map);
 pinLayer=L.layerGroup().addTo(map);
 liveLayer=L.layerGroup().addTo(map);
 map.on('movestart',event=>{
   // Leaflet's own pan/zoom can stop auto-follow. Ignore programmatic follow.
   if(event.originalEvent&&follow){follow=false;followBtn.setAttribute('aria-pressed','false');
     followBtn.textContent='現在地追従：OFF';}
 });
}
makeMap();

function readIndexedDb(){
 return new Promise(resolve=>{
   if(typeof indexedDB==='undefined')return resolve(null);
   let request;
   try{request=indexedDB.open(core.DB_NAME,1);}catch{return resolve(null);}
   request.onupgradeneeded=()=>{
     // A blank database should not be silently initialized by the map.
     try{request.transaction.abort();}catch{}
   };
   request.onerror=()=>resolve(null);
   request.onblocked=()=>resolve(null);
   request.onsuccess=()=>{
     const db=request.result;
     if(!db.objectStoreNames.contains(core.STORE)){db.close();return resolve(null);}
     let transaction,got;
     try{
       transaction=db.transaction(core.STORE,'readonly');
       got=transaction.objectStore(core.STORE).get(core.KEY);
     }catch{db.close();return resolve(null);}
     got.onsuccess=()=>{const value=got.result;db.close();resolve(value);};
     got.onerror=()=>{db.close();resolve(null);};
     transaction.onabort=()=>{try{db.close();}catch{} resolve(null);};
   };
 });
}
async function readShared(){
 const indexed=await readIndexedDb();
 if(core.validState(indexed))return {data:indexed,store:'IndexedDB'};
 try{
   const fallbackData=JSON.parse(localStorage.getItem(core.FALLBACK_KEY)||'null');
   if(core.validState(fallbackData))return {data:fallbackData,store:'localStorage'};
 }catch{}
 return {data:null,store:'なし'};
}
function createShiftOptions(data){
 const key=(data?.shifts||[]).map(s=>s.id+'|'+s.startedAt+'|'+(s.records||[]).length+'|'+(s.endedAt||'')).join(';');
 if(key===lastShiftChoices)return;
 lastShiftChoices=key;
 const prior=shiftSelect.value||selectedId;
 shiftSelect.replaceChildren();
 const shifts=data?.shifts||[];
 if(!shifts.length){
   const opt=document.createElement('option');opt.textContent='データなし';opt.value='';
   shiftSelect.append(opt);shiftSelect.disabled=true;return;
 }
 shiftSelect.disabled=false;
 for(const s of shifts){
   const option=document.createElement('option');option.value=s.id;
   option.textContent=core.formatShift(s);shiftSelect.append(option);
 }
 const restored=shifts.find(s=>s.id===prior);
 shiftSelect.value=restored?.id||data.activeId||shifts[0].id;
 selectedId=shiftSelect.value;
}
function popupElement(pin){
 const wrapper=document.createElement('div'),title=document.createElement('strong'),
   place=document.createElement('div');
 title.textContent=pin.label;place.textContent=pin.place||'住所未記入';
 wrapper.append(title,place);return wrapper;
}
function selectPin(pin,pan=true){
 chosenPin=pin;
 googleRoute.disabled=false;googleSearch.disabled=false;
 for(const button of pinList.querySelectorAll('button')){
   button.classList.toggle('chosen',button.dataset.pinId===pin.id);
 }
 message(pin.label+(pin.place?'・'+pin.place:'')+'／Googleで地点確認・経路検索ができます。');
 if(map&&pan)map.setView([pin.lat,pin.lng],Math.max(map.getZoom(),14),{animate:false});
}
function fitSaved(){
 if(!map)return;
 const available=[...pins];
 if(locationFix)available.push(locationFix);
 if(available.length>1){
   map.fitBounds(L.latLngBounds(available.map(p=>[p.lat,p.lng])).pad(.14),{maxZoom:16,animate:false});
 }else if(available.length===1){
   map.setView([available[0].lat,available[0].lng],15,{animate:false});
 }else message('位置が保存された営業がまだありません。日報入力で乗車・降車地点を記録してください。');
}
function drawSaved(force=false){
 const fresh=core.getPins(shift);
 const signature=JSON.stringify(fresh.map(p=>[p.id,p.lat,p.lng,p.place]));
 if(!force&&signature===lastPinSignature)return;
 lastPinSignature=signature;pins=fresh;
 pinList.replaceChildren();
 if(pinLayer)pinLayer.clearLayers();
 for(const p of pins){
   const button=document.createElement('button');button.type='button';button.dataset.pinId=p.id;
   button.textContent=p.label+(p.place?'・'+p.place:'');
   button.addEventListener('click',()=>selectPin(p));
   pinList.append(button);
   if(map){
     const color=p.kind==='pickup'?'#067e7a':p.kind==='drop'?'#d66d32':'#7a609d';
     const point=L.circleMarker([p.lat,p.lng],{radius:9,color:'#fff',weight:2,fillColor:color,fillOpacity:.95}).addTo(pinLayer);
     point.bindPopup(popupElement(p));
     point.on('click',()=>selectPin(p,false));
   }
 }
 if(!pins.length){
   const label=document.createElement('span');label.textContent='記録された乗降地点はまだありません。';
   label.style.fontSize='12px';label.style.color='#556a7d';pinList.append(label);
 }
 if(chosenPin){
   const same=pins.find(p=>p.id===chosenPin.id);
   chosenPin=same||null;
   googleRoute.disabled=!chosenPin;googleSearch.disabled=!chosenPin;
 }
 if(shift&&shift.id!==defaultFittedShift&&pins.length){
   defaultFittedShift=shift.id;
   if(!hasViewedSavedPoint){fitSaved();hasViewedSavedPoint=true;}
 }
}
function drawLivePoint(){
 if(!liveLayer)return;
 liveLayer.clearLayers();
 const point=core.currentFix(shift)||locationFix;
 if(!point)return;
 L.circleMarker([point.lat,point.lng],{radius:10,weight:3,color:'#fff',fillColor:'#1873db',fillOpacity:.9})
  .bindPopup('現在地（最終取得位置）').addTo(liveLayer);
 if(follow)map.panTo([point.lat,point.lng],{animate:false});
}
async function refresh(){
 if(readBusy)return;readBusy=true;
 try{
   const result=await readShared();
   if(!result.data){
     state=null;shift=null;syncStatus.textContent='端末内の乗務データを待っています';
     createShiftOptions(null);drawSaved(true);return;
   }
   state=result.data;
   createShiftOptions(state);
   const previous=shift?.id;
   shift=core.selectShift(state,shiftSelect.value||selectedId);
   if(shift){selectedId=shift.id;shiftSelect.value=shift.id;}
   $('mapShiftLabel').textContent=shift?((shift.records||[]).length+'件・'+(shift.endedAt?'入庫済':'乗務中')):'データなし';
   syncStatus.textContent='同じ端末のデータを参照中（'+result.store+'）・約4秒ごとに更新';
   if(shift?.id!==previous){lastPinSignature='';hasViewedSavedPoint=false;}
   drawSaved();drawLivePoint();
 }catch(error){
   syncStatus.textContent='データ読み取りに失敗しました。入力画面を確認してください';
   message('地図の更新エラー：'+String(error?.message||error));
 }finally{readBusy=false;}
}
shiftSelect.addEventListener('change',()=>{
 selectedId=shiftSelect.value;lastPinSignature='';hasViewedSavedPoint=false;
 if(state){shift=core.selectShift(state,selectedId);drawSaved(true);drawLivePoint();}
});
$('fitPinsBtn').addEventListener('click',fitSaved);
followBtn.addEventListener('click',()=>{
 follow=!follow;followBtn.setAttribute('aria-pressed',String(follow));
 followBtn.textContent='現在地追従：'+(follow?'ON':'OFF');
 if(follow)drawLivePoint();
});
locate.addEventListener('click',()=>{
 if(!navigator.geolocation||!window.isSecureContext){
   message('現在地取得にはHTTPSでの位置情報許可が必要です。');return;
 }
 locate.disabled=true;message('スマホの現在地を取得しています…');
 navigator.geolocation.getCurrentPosition(pos=>{
   const found=core.point({lat:pos.coords.latitude,lng:pos.coords.longitude,
     accuracy:pos.coords.accuracy,recordedAt:new Date().toISOString()});
   if(found){
     locationFix=found;drawLivePoint();if(map)map.setView([found.lat,found.lng],15,{animate:false});
     message('現在地を取得しました。推定精度 ±'+Math.round(pos.coords.accuracy||0)+'m。');
   }
   locate.disabled=false;
 },err=>{message('位置情報の取得に失敗しました：'+String(err.message||err.code));locate.disabled=false;},
 {enableHighAccuracy:true,maximumAge:0,timeout:15000});
});
googleSearch.addEventListener('click',()=>{
 const url=core.mapsUrl(chosenPin,false);if(url)window.open(url,'_blank','noopener,noreferrer');
});
googleRoute.addEventListener('click',()=>{
 const url=core.mapsUrl(chosenPin,true);if(url)window.open(url,'_blank','noopener,noreferrer');
});
window.addEventListener('storage',event=>{
 if(event.key===core.FALLBACK_KEY)refresh();
 if(event.key===layoutKey&&event.newValue)applyLayout(event.newValue);
});
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='visible'){refresh();if(map)map.invalidateSize({animate:false});}
});
$('appFrame').addEventListener('load',()=>setTimeout(refresh,550));
setTimeout(refresh,200);
setInterval(()=>{if(document.visibilityState==='visible')refresh();},4000);
})();
