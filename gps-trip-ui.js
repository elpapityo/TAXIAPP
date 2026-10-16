/* TAXIAPP browser-only GPS trip pilot UI + lifecycle bridge.
 * Enables manual rebasing, position quality warnings, and limited event hooks.
 * All values are estimates, never guessed across missing measurement periods.
 */
(function(root){
'use strict';
function factory(deps){
 const engine=root.TAXIAPP_GPS_TRIP;
 let watchId=null,watchShift='',lastLocalSave=0,watchGeneration=0;
 const {getShift,persist,render,toast,gpsMessage,number,safeText}=deps;
 const rootEl=()=>document.getElementById('app');
 const fmt=km=>(Math.round((Number(km)||0)*10)/10).toFixed(1);
 const active=shift=>Boolean(engine&&shift?.gpsTrip?.enabled&&!shift.endedAt);
 // Do not automatically certify an estimate until we have a recent valid fix
 // AND any prior missed interval was corrected using the vehicle trip meter.
 const trusted=shift=>Boolean(active(shift)&&shift.gpsTrip.lastFix&&
   shift.gpsTrip.status==='tracking'&&!shift.gpsTrip.unresolvedGap&&
   Date.now()-Number(shift.gpsTrip.lastSeenMs||0)<60000);
 function status(shift){
  const s=shift?.gpsTrip;
  if(!s)return '未開始（距離は従来どおり手入力できます）';
  if(!s.enabled)return 'GPS停止中：補正履歴は保存しています';
  if(document.visibilityState!=='visible')return '非表示：計測中断（未計測区間あり）';
  if(s.status==='gap')return '計測中断：'+(s.lastError||'トリップで確認してください');
  if(s.unresolvedGap)return '未計測区間があります。車両トリップの実測値へ補正するまで距離欄への自動転記を停止します';
  if(!s.lastSeenMs)return '最初の有効なGPS測位を待っています';
  const seconds=Math.max(0,Math.floor((Date.now()-s.lastSeenMs)/1000));
  if(seconds>60)return 'GPS更新停止の可能性：最後の測位から'+seconds+'秒';
  return 'GPS '+(s.status==='tracking'?'計測中':'再基準点の測位待ち')+'／最終更新 '+seconds+'秒前／精度 ±'+Math.round(s.lastAccuracy||0)+'m';
 }
 function panel(shift){
  if(!shift||shift.endedAt)return '';
  const s=shift.gpsTrip;
  return `<section class="card gps-trip-panel" aria-label="GPS走行距離（試験）">
   <h2 class="h2">GPSトリップ距離（試験）</h2>
   <p class="helper">車両トリップを0kmにリセットしてください。画面消灯・他アプリ使用中は連続計測できない場合があります。</p>
   <div class="gps-trip-stats">
    <div><span>GPSトリップ推定値</span><strong data-gps-trip>${fmt(s?.tripKm||0)} km</strong></div>
    <div><span>実車（GPS計測分）</span><strong data-gps-real>${fmt(s?.realKm||0)} km</strong></div>
    <div><span>空車（GPS計測分）</span><strong data-gps-empty>${fmt(s?.emptyKm||0)} km</strong></div>
    <div><span>計測中断</span><strong data-gps-gaps>${s?.gapCount||0}回</strong></div>
   </div>
   <p class="gps-trip-status" data-gps-trip-status role="status">${safeText(status(shift))}</p>
   <div class="actions">${active(shift)?
     '<button class="btn" type="button" data-action="gpsTripStop">■ GPS計測停止</button>':
     '<button class="btn primary" type="button" data-action="gpsTripStart">⌖ GPS試験計測を開始</button>'}</div>
   ${s?`<div class="gps-trip-correction"><label class="field"><span class="field-label">車両トリップの実測値に補正（km）</span>
    <input class="control" data-gps-trip-correct data-number-kind="distance" type="text" inputmode="none" placeholder="例：5.5"></label>
    <button class="btn" type="button" data-action="gpsTripCorrect">この距離から計測を続ける</button></div>
    <p class="footnote">補正差の合計：${fmt(s.correctionKm||0)}km ／ 補正履歴 ${s.corrections?.length||0}件。
    GPS実車・空車の計測分と補正差は別管理です。中断区間の距離は推測しません。</p>`:''}
   </section>`;
 }
 const distanceKeys=new Set(['F','L','S','V','AB','AE']);
 // The value is always the cumulative vehicle-trip estimate, not the route
 // section length. Auto-filled values can advance, manual values never do.
 function fillDistance(shift,record,field,source='event'){
  if(!trusted(shift)||!record||record.editId||!distanceKeys.has(field))return false;
  const current=String(record.raw?.[field]??'').trim();
  const prior=record.meta?.gpsFilledFields?.[field];
  if(current&&(!prior||String(prior.km)!==current))return false;
  const km=fmt(shift.gpsTrip.tripKm);
  // The browser may miss most of a journey while locked/backgrounded.
  // Never put an undercounted GPS drop reading below a manual boarding trip
  // reading: that would make the otherwise valid fare impossible to save.
  if(field==='L'&&number(record.raw.F)!==null&&Number(km)<number(record.raw.F))return false;
  record.raw[field]=km;
  record.meta??={};record.meta.gpsFilledFields??={};
  record.meta.gpsFilledFields[field]={km,at:new Date().toISOString(),source};
  return true;
 }
 function fillLocationDistance(shift,record,when){
  const field=when==='pickup'?'F':when==='drop'?'L':null;
  if(!field||!record||(when==='pickup'&&!['ride','dispatch'].includes(record.kind))||
     (when==='drop'&&record.kind!=='ride'))return false;
  return fillDistance(shift,record,field,'location');
 }
 function fillWaitDistance(shift,waiting,source='wait'){
  if(!trusted(shift)||!waiting)return false;
  const current=String(waiting.odometer??'').trim();
  const prior=waiting.gpsAutoOdometer;
  if(current&&(!prior||String(prior.km)!==current))return false;
  const km=fmt(shift.gpsTrip.tripKm);
  waiting.odometer=km;
  waiting.gpsAutoOdometer={km,at:new Date().toISOString(),source};
  return true;
 }
 function fillEndingDistance(shift){
  if(!trusted(shift))return false;
  const current=String(shift.endingOdo??'').trim();
  const prior=shift.gpsAutoEndingOdo;
  if(current&&(!prior||String(prior.km)!==current))return false;
  const km=fmt(shift.gpsTrip.tripKm);
  shift.endingOdo=km;shift.gpsAutoEndingOdo={km,at:new Date().toISOString()};
  return true;
 }
 function paint(shift){
  const s=shift?.gpsTrip;if(!s)return;
  const ui=rootEl();if(!ui)return;
  for(const [attr,value] of [
   ['data-gps-trip',fmt(s.tripKm)+' km'],['data-gps-real',fmt(s.realKm)+' km'],
   ['data-gps-empty',fmt(s.emptyKm)+' km'],['data-gps-gaps',(s.gapCount||0)+'回'],
   ['data-gps-trip-status',status(shift)]]){
   ui.querySelectorAll('['+attr+']').forEach(el=>el.textContent=value);
  }
  if(!trusted(shift))return;
  // Only reflect already-validated auto values; never replace a manual reading.
  for(const [key,value] of [
   ['[data-shift-odo="end"]',shift.gpsAutoEndingOdo?.km===shift.endingOdo?shift.endingOdo:null],
   ['[data-wait-field="odometer"]',shift.waiting?.gpsAutoOdometer?.km===shift.waiting?.odometer?shift.waiting.odometer:null],
   ['[data-col="L"]',shift.draft?.kind==='ride'&&shift.draft?.meta?.gpsFilledFields?.L?.km===shift.draft.raw.L?shift.draft.raw.L:null]]){
   const input=ui.querySelector(key);
   if(input&&value!==null&&value!==undefined&&document.activeElement!==input)input.value=String(value);
  }
 }
 function clearWatch(){
  // Invalidate callbacks queued by an old session, even for the same shift.
  watchGeneration++;
  if(watchId!==null&&navigator.geolocation)try{navigator.geolocation.clearWatch(watchId);}catch(e){}
  watchId=null;watchShift='';
 }
 function missing(shift,reason){
  if(!active(shift))return;
  engine.miss(shift.gpsTrip,reason);
  persist(false);paint(shift);
 }
 function fill(shift){
  if(!trusted(shift))return;
  fillEndingDistance(shift);
  const draft=shift.draft;
  if(shift.waiting&&!draft)fillWaitDistance(shift,shift.waiting,'tracking');
  if(draft?.kind==='dispatch')fillDistance(shift,draft,'F','tracking');
  if(draft?.kind==='ride'&&!draft.raw.M)fillDistance(shift,draft,'L','tracking');
 }
 function onPosition(shiftId,generation,position){
  if(generation!==watchGeneration)return;
  const shift=getShift();
  if(!shift||shift.id!==shiftId||!active(shift)||document.visibilityState!=='visible')return;
  const r=engine.ingest(shift.gpsTrip,position);
  if(r.accepted&&trusted(shift))fill(shift);
  paint(shift);
  if(Date.now()-lastLocalSave>12000){lastLocalSave=Date.now();persist(false);}
 }
 function startWatch(shift){
  if(!active(shift)||document.visibilityState!=='visible')return;
  if(!root.isSecureContext||!navigator.geolocation){
   missing(shift,'GPS不可：HTTPSと位置情報の許可が必要');return;
  }
  clearWatch();
  const id=shift.id,generation=watchGeneration;watchShift=id;
  try{
   watchId=navigator.geolocation.watchPosition(pos=>onPosition(id,generation,pos),err=>{
    if(generation!==watchGeneration)return;
    const current=getShift();if(!current||current.id!==id||!active(current))return;
    missing(current,gpsMessage(err));
    if(err.code===1){clearWatch();engine.stop(current.gpsTrip);persist(true);render();}
   },{enableHighAccuracy:true,timeout:16000,maximumAge:0});
  }catch(err){missing(shift,String(err?.message||err));}
 }
 function modeForShift(shift){
  return shift?.draft?.kind==='ride'&&!shift.draft.raw.M&&shift.draft.status!=='alighted'?'real':'empty';
 }
 function start(shift,reloading=false){
  if(!shift||shift.endedAt)return;
  if(!engine){toast('GPS計測ファイルを読み込めませんでした。再読み込みしてください。',true);return;}
  if(!root.isSecureContext||!navigator.geolocation){toast('HTTPSと位置情報の許可が必要です。',true);return;}
  if(!shift.gpsTrip){
    shift.gpsTrip=engine.create(number(shift.startingOdo)||0);
    const start=Date.parse(shift.startedIso||'');
    if(Number.isFinite(start)&&Date.now()-start>120000)
      engine.miss(shift.gpsTrip,'乗務途中のGPS開始：車両トリップで補正してください');
  }
  if(reloading&&shift.gpsTrip.enabled)
    engine.miss(shift.gpsTrip,'アプリ再起動の間の移動は未計測');
  // Manual stop / restart must not silently count the untracked time as measured.
  if(!shift.gpsTrip.enabled&&(shift.gpsTrip.lastStopIso||shift.gpsTrip.startedIso))
    engine.miss(shift.gpsTrip,'GPS停止中の移動は未計測：車両トリップで確認・補正してください');
  engine.resume(shift.gpsTrip);
  engine.mode(shift.gpsTrip,modeForShift(shift));
  startWatch(shift);persist(false);render();
  if(!reloading)toast('GPS計測を開始しました。画面消灯中の計測は保証できません。');
 }
 function stop(shift,quiet=false){
  if(!shift?.gpsTrip||!engine)return;
  clearWatch();engine.stop(shift.gpsTrip);persist(true);
  if(!quiet){render();toast('GPS計測を停止しました。履歴は保持されています。');}
 }
 function changeMode(shift,to){
  if(!active(shift))return;
  engine.mode(shift.gpsTrip,to);
  persist(false);paint(shift);
 }
 function board(shift,record){
  if(!active(shift)||!record||record.editId)return;
  const s=shift.gpsTrip;
  fillDistance(shift,record,'F','board');
  record.meta??={};
  record.meta.gpsDistance={boardTripKm:s.tripKm,boardRealKm:s.realKm,boardEmptyKm:s.emptyKm,
    boardGapCount:s.gapCount,boardQuality:trusted(shift)?'valid':'needs_correction',
    boardedIso:new Date().toISOString()};
  changeMode(shift,'real');
 }
 function alight(shift,record){
  if(!active(shift)||!record||record.kind!=='ride'||record.editId||record.meta?.gpsDistance?.alightedIso)return;
  const s=shift.gpsTrip;
  fillDistance(shift,record,'L','alight');
  record.meta??={};record.meta.gpsDistance??={};
  const meta=record.meta.gpsDistance;
  meta.alightTripKm=s.tripKm;meta.alightRealKm=s.realKm;
  meta.alightGapCount=s.gapCount;
  meta.alightQuality=trusted(shift)?'valid':'needs_correction';
  meta.realRouteKm=Math.max(0,Math.round((s.realKm-(meta.boardRealKm??s.realKm))*10000)/10000);
  meta.alightedIso=new Date().toISOString();
  changeMode(shift,'empty');
 }
 function correct(shift,km,source){
  if(!active(shift))return false;
  const r=engine.correct(shift.gpsTrip,km,source);
  if(!r){toast('0以上の正しいトリップ距離を入力してください。',true);return false;}
  fill(shift);persist(true);paint(shift);
  toast('トリップ距離を'+fmt(r.afterKm)+'kmへ補正しました。次のGPS測位を新しい基準にします。');
  return true;
 }
 function hidden(){
  const shift=getShift();if(!active(shift))return;
  if(document.visibilityState==='hidden'){
   missing(shift,'ブラウザ非表示・画面消灯：距離を推測しません');
   clearWatch();
  }else{
   engine.resume(shift.gpsTrip);startWatch(shift);persist(false);paint(shift);
  }
 }
 function tick(){
  const shift=getShift(),s=shift?.gpsTrip;if(!active(shift))return;
  const latest=s.lastSeenMs||Date.parse(s.watchStartedIso||s.startedIso||'');
  if(document.visibilityState==='visible'&&latest&&Date.now()-latest>75000&&s.status!=='gap')
    missing(shift,'GPS位置が75秒以上届いていません。車両トリップを確認してください');
  paint(shift);
 }
 function atInputDistance(shift,column,value,source){
  if(!active(shift))return;
  if(!['F','L','S','V','AB','AE'].includes(column))return;
  correct(shift,value,source||('距離欄'+column));
 }
 return {panel,status,paint,start,stop,mode:changeMode,board,alight,correct,hidden,tick,
         atInputDistance,active,trusted,fill,fillLocationDistance,fillDistance,fillWaitDistance,clearWatch,fmt};
}
root.TAXIAPP_GPS_UI=factory;
})(typeof window!=='undefined'?window:globalThis);
