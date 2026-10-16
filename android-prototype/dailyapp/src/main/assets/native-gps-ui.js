/* Bundled Android-only connector. The public browser build is not modified. */
(function(root){
'use strict';
const native=root.TAXIAPP_NATIVE_GPS;
if(!native)return;
root.TAXIAPP_GPS_UI=function(deps){
 const {getShift,persist,render,toast,number,safeText}=deps;
 let startingAt=0,lastPersist=0,pendingDrop=null;
 const fmt=km=>(Math.round((Number(km)||0)*10)/10).toFixed(1);
 const fmt3=km=>(Math.round((Number(km)||0)*1000)/1000).toFixed(3);
 function snapshot(){try{return JSON.parse(native.snapshot());}catch{return null;}}
 function sync(shift){
  if(!shift||shift.endedAt)return null;
  const n=snapshot();if(!n)return null;
  const previous=shift.gpsTrip||{};
  const enabled=Boolean(n.running)||(startingAt>0&&Date.now()-startingAt<12000);
  shift.gpsTrip={...previous,enabled,source:'android-native',version:2,
   tripKm:n.tripKm,realKm:n.realKm,emptyKm:n.emptyKm,correctionKm:n.correctionKm,
   gapCount:n.gapCount,unresolvedGap:n.unresolvedGap,mode:n.mode,
   status:enabled?'tracking':'off',lastError:n.status,
   lastAccuracy:n.accuracy,lastSeenMs:n.lastGpsAt,
   lastFix:n.lastGpsAt?{t:n.lastGpsAt}:null,
   nativeLastRideKm:n.lastRideKm,nativeCompletedRides:n.completedRides,
   corrections:previous.corrections||[]};
  return n;
 }
 function active(shift){return Boolean(shift?.gpsTrip?.enabled&&!shift.endedAt);}
 function trusted(shift){
  const s=shift?.gpsTrip;
  return Boolean(active(shift)&&s.source==='android-native'&&!s.unresolvedGap&&
   Number(s.lastSeenMs)>0&&Date.now()-s.lastSeenMs<15000&&
   Number.isFinite(s.lastAccuracy)&&s.lastAccuracy>0&&s.lastAccuracy<=45);
 }
 function status(shift){
  if(!shift?.gpsTrip)return 'Android GPSは未開始です';
  const s=shift.gpsTrip;
  if(!s.enabled)return 'GPS停止中。開始操作が必要です';
  if(s.unresolvedGap)return 'GPS欠測あり。車両トリップで補正してください';
  if(!trusted(shift))return 'GPSの最新測位待ち（距離は参考値）';
  return 'AndroidバックグラウンドGPS／精度 ±'+Math.round(s.lastAccuracy)+'m／'+(s.lastError||'測位中');
 }
 function panel(shift){
  if(!shift||shift.endedAt)return '';
  const s=shift.gpsTrip||{};
  const blocks=[
   ['data-gps-trip','GPS累計',fmt3(s.tripKm)],
   ['data-gps-real','実車累計',fmt3(s.realKm)],
   ['data-gps-empty','空車累計',fmt3(s.emptyKm)],
   ['data-gps-gaps','GPS欠測',String(s.gapCount||0)]
  ].map(([attr,label,value])=>'<div><span>'+label+'</span><strong '+attr+'>'+
   value+(attr==='data-gps-gaps'?' 回':' km')+'</strong></div>').join('');
  return '<section class="card gps-trip-panel"><h2 class="h2">Android GPS走行距離</h2>'+
   '<p class="helper">画面消灯中も位置情報サービスが計測します。車両トリップで実測を確認してください。</p>'+
   '<div class="gps-trip-stats">'+blocks+'</div>'+
   '<p class="gps-trip-status" data-gps-trip-status>'+safeText(status(shift))+'</p>'+
   '<div class="actions">'+(active(shift)?
    '<button type="button" class="btn" data-action="gpsTripStop">■ GPS計測停止</button>':
    '<button type="button" class="btn primary" data-action="gpsTripStart">⌖ GPS計測開始</button>')+'</div>'+
   '<div class="gps-trip-correction"><label class="field"><span class="field-label">車両トリップ補正（km）</span>'+
   '<input class="control" data-gps-trip-correct data-number-kind="distance" inputmode="none" type="text"></label>'+
   '<button class="btn" type="button" data-action="gpsTripCorrect">この距離から続ける</button></div>'+
   '<p class="footnote">電波が途切れた区間の距離は推測加算しません。過少・過大になった場合は手入力を優先します。</p></section>';
 }
 function fillDistance(shift,record,field,source='event'){
  if(!trusted(shift)||!record||record.editId||!['F','L','S','V','AB','AE'].includes(field))return false;
  const before=String(record.raw?.[field]??'').trim();
  const previous=record.meta?.gpsFilledFields?.[field];
  if(before&&(!previous||String(previous.km)!==before))return false;
  const value=fmt(shift.gpsTrip.tripKm);
  if(field==='L'&&number(record.raw.F)!==null&&Number(value)<number(record.raw.F))return false;
  record.raw[field]=value;
  record.meta??={};record.meta.gpsFilledFields??={};
  record.meta.gpsFilledFields[field]={km:value,source,at:new Date().toISOString()};
  return true;
 }
 function fillWaitDistance(shift,waiting,source='nativeWait'){
  if(!trusted(shift)||!waiting)return false;
  const current=String(waiting.odometer??'').trim();
  const old=waiting.gpsAutoOdometer;
  if(current&&(!old||String(old.km)!==current))return false;
  const value=fmt(shift.gpsTrip.tripKm);
  waiting.odometer=value;
  waiting.gpsAutoOdometer={km:value,source,at:new Date().toISOString()};
  return true;
 }
 function paint(shift){
  const s=shift?.gpsTrip,ui=document.getElementById('app');
  if(!s||!ui)return;
  const fields=[
   ['[data-gps-trip]',fmt3(s.tripKm)+' km'],
   ['[data-gps-real]',fmt3(s.realKm)+' km'],
   ['[data-gps-empty]',fmt3(s.emptyKm)+' km'],
   ['[data-gps-gaps]',String(s.gapCount||0)+' 回'],
   ['[data-gps-trip-status]',status(shift)]];
  for(const [selector,value] of fields)
   ui.querySelectorAll(selector).forEach(el=>el.textContent=value);
 }
 function fill(shift){
  if(!trusted(shift))return;
  if(shift.waiting&&!shift.draft)fillWaitDistance(shift,shift.waiting);
  if(shift.draft?.kind==='dispatch')fillDistance(shift,shift.draft,'F','nativeTracking');
 }
 function start(shift,reloading=false){
  if(!shift||shift.endedAt)return;
  const n=snapshot();
  if(!n?.running&&!reloading){startingAt=Date.now();native.start();}
  if(!n?.running&&reloading)startingAt=0; // do not pretend to have measured while stopped
  shift.gpsTrip??={};shift.gpsTrip.enabled=Boolean(n?.running)||!reloading;
  sync(shift);persist(false);render();
  if(!reloading)toast('Android GPS計測を開始します。位置情報の許可を確認してください。');
 }
 function stop(shift,quiet=false){
  native.stop();startingAt=0;
  if(shift?.gpsTrip)shift.gpsTrip.enabled=false;
  persist(false);
  if(!quiet){render();toast('GPS計測を停止しました。');}
 }
 function changeMode(shift,to){
  if(!active(shift)||!['real','empty'].includes(to))return;
  native.mode(to);
  shift.gpsTrip.mode=to;
 }
 function board(shift,record){
  if(!active(shift)||!record||record.editId)return;
  const n=sync(shift);if(!n)return;
  const manual=number(record.raw?.F);
  if(manual!==null&&manual>n.tripKm+.0001){
   native.correct(manual);
   shift.gpsTrip.tripKm=manual;
  }
  fillDistance(shift,record,'F','nativeBoard');
  record.meta??={};
  record.meta.gpsDistance={boardTripKm:shift.gpsTrip.tripKm,
   boardRealKm:shift.gpsTrip.realKm,boardEmptyKm:shift.gpsTrip.emptyKm,
   boardGapCount:shift.gpsTrip.gapCount,
   boardQuality:trusted(shift)?'valid':'needs_correction',
   boardedIso:new Date().toISOString()};
  changeMode(shift,'real');
 }
 function completeDrop(shift){
  if(!pendingDrop||!shift||pendingDrop.shiftId!==shift.id)return false;
  const n=snapshot();
  if(!n||n.mode!=='empty'||n.completedRides<=pendingDrop.count)return false;
  const item=shift.draft?.id===pendingDrop.id?shift.draft:
   shift.records?.find(r=>r.id===pendingDrop.id);
  const old=pendingDrop;pendingDrop=null;
  sync(shift);
  if(item){
   item.meta??={};item.meta.gpsDistance??={};
   const meta=item.meta.gpsDistance;
   meta.alightedIso=new Date().toISOString();
   meta.alightTripKm=n.tripKm;meta.alightRealKm=n.realKm;
   meta.alightGapCount=n.gapCount;
   meta.alightQuality=n.unresolvedGap?'needs_correction':'valid';
   meta.realRouteKm=Math.max(0,Math.round((n.realKm-(meta.boardRealKm??n.realKm))*1000)/1000);
   if(!n.unresolvedGap)fillDistance(shift,item,'L','nativeAlight');
   persist(false);
   const input=document.querySelector('.settlement-section [data-col="L"]');
   if(input&&item.raw.L&&document.activeElement!==input)input.value=item.raw.L;
  }
  old.done?.(!n.unresolvedGap);
  return true;
 }
 function alight(shift,record){
  if(!active(shift)||!record||record.kind!=='ride'||record.editId||
    record.meta?.gpsDistance?.alightedIso)return;
  if(pendingDrop?.id===record.id)return;
  const n=sync(shift);
  if(!n||n.mode!=='real')return;
  pendingDrop={shiftId:shift.id,id:record.id,count:n.completedRides,done:null};
  native.mode('empty'); // native service samples the last position (up to 8 seconds)
 }
 function captureFreshAlightFix(shift,record){
  if(!active(shift)||!record||record.raw.M)return Promise.resolve(false);
  return new Promise(resolve=>{
   alight(shift,record);
   if(!pendingDrop||pendingDrop.id!==record.id){resolve(false);return;}
   pendingDrop.done=resolve;
   setTimeout(()=>{
    if(pendingDrop?.id===record.id){
     pendingDrop.done?.(false);pendingDrop=null;
    }
   },10500);
  });
 }
 function correct(shift,value,source='manual'){
  if(!active(shift))return false;
  const km=number(value);if(km===null||km<0)return false;
  native.correct(km);
  shift.gpsTrip.tripKm=km;
  (shift.gpsTrip.corrections??=[]).push({at:new Date().toISOString(),afterKm:km,source});
  persist(false);paint(shift);
  toast('Android GPS距離を'+fmt(km)+'kmへ補正しました。');
  return true;
 }
 function tick(){
  const shift=getShift();if(!shift)return;
  sync(shift);
  completeDrop(shift);
  fill(shift);paint(shift);
  if(Date.now()-lastPersist>12000){lastPersist=Date.now();persist(false);}
 }
 function atInputDistance(shift,column,value){
  if(!active(shift)||!['F','L','S','V','AB','AE'].includes(column))return;
  const km=number(value);
  if(km!==null&&km>=shift.gpsTrip.tripKm+.0001)correct(shift,km,'距離欄'+column);
 }
 function fillLocationDistance(shift,record,when){
  sync(shift);return fillDistance(shift,record,when==='pickup'?'F':'L','nativeLocation');
 }
 function hidden(){} // Background Android service stays live.
 function clearWatch(){} // No browser GPS distance watcher is allowed.
 return {panel,status,paint,start,stop,mode:changeMode,board,alight,
  captureFreshAlightFix,correct,hidden,tick,atInputDistance,active,trusted,
  fill,fillLocationDistance,fillDistance,fillWaitDistance,clearWatch,fmt};
};
})(typeof window!=='undefined'?window:globalThis);
