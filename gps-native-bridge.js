/* GPS-only read bridge. No automatic edits to diary records or server writes. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.TAXIAPP_EXTERNAL_GPS=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const KEY='taxiapp-gps-local-test-key-v1';
 const CORRECTION_PREFIX='taxiapp-external-gps-baseline-v1:';
 const endpoint='http://127.0.0.1:18765/gps';
 const GAP_ACK_PREFIX='taxiapp-external-gps-gap-ack-v1:';
 function readKey(storage){try{return storage.getItem(KEY)||''}catch{return ''}}
 function correctionKey(shiftId){return CORRECTION_PREFIX+String(shiftId)}
 function baseline(storage,shiftId){try{const x=JSON.parse(storage.getItem(correctionKey(shiftId))||'null');return x&&Number.isFinite(x.gps)&&Number.isFinite(x.value)&&x.value>=0?x:null}catch{return null}}
 function ensureStart(storage,shiftId,gpsKm,startValue=0){
  const prior=baseline(storage,shiftId);
  if(prior)return prior;
  const initial=Number(startValue);
  if(!Number.isFinite(gpsKm)||gpsKm<0||startValue===''||!Number.isFinite(initial)||initial<0)throw Error('GPS乗務開始基準が不正です');
  const b={gps:gpsKm,value:initial,at:Date.now(),automatic:true};
  storage.setItem(correctionKey(shiftId),JSON.stringify(b));
  return b;
 }
 function acknowledgeGap(storage,shiftId,gapCount){
  if(!Number.isInteger(gapCount)||gapCount<0)throw Error('GPS欠測回数が不正です');
  storage.setItem(GAP_ACK_PREFIX+String(shiftId),String(gapCount));
 }
 function gapAcknowledged(storage,shiftId,gapCount){
  try{return Number.isInteger(gapCount)&&gapCount>=0&&storage.getItem(GAP_ACK_PREFIX+String(shiftId))===String(gapCount)}catch{return false}
 }
 function recordManual(storage,shiftId,gpsKm,value){
  const n=Number(value);
  if(!Number.isFinite(gpsKm)||gpsKm<0||value===''||!Number.isFinite(n)||n<0)throw Error('距離基準が不正です');
  const x={gps:gpsKm,value:n,at:Date.now()};storage.setItem(correctionKey(shiftId),JSON.stringify(x));return x;
 }
 function calculated(gpsKm,base){
  if(!Number.isFinite(gpsKm)||gpsKm<0)throw Error('GPS累計が不正です');
  if(base&&gpsKm+0.00001<base.gps)throw Error('GPS累計がリセットされました。基準を再設定してください');
  return Math.round((base?base.value+gpsKm-base.gps:gpsKm)*1000)/1000;
 }
 async function read(storage=localStorage,fetcher=fetch,options={}){
  const key=readKey(storage);
  // v0.3.10 native helper supports keyless read from the fixed trusted origin.
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),4500);
  try{
   const nativeEmbedded=typeof navigator!=='undefined' && /TAXIAPPIntegrated\\/1/.test(navigator.userAgent||'');
   const target=nativeEmbedded?'/TAXIAPP/native-gps':endpoint;
   const resp=await fetcher(target,{headers:!nativeEmbedded&&key?{'X-GPS-Test-Key':key}:{},cache:'no-store',signal:controller.signal});
   if(!resp.ok)throw Error('GPS通信エラー HTTP '+resp.status);
   const data=await resp.json();
   if(data.format!=='TAXIAPP_GPS_LOOPBACK_V1'||!Number.isFinite(data.tripKm)||data.tripKm<0)throw Error('GPS応答が不正です');
   if(data.running!==true)throw Error('GPS計測が停止しています');
   if(!Number.isFinite(data.gpsAgeMs)||data.gpsAgeMs<0||data.gpsAgeMs>30000)throw Error('GPS受信が古いか取得できていません');
   if(data.unresolvedGap!==false && !options.allowUnresolvedGap && !gapAcknowledged(storage,options.shiftId,data.gapCount))throw Error('GPS欠測が未解決です。車両トリップを確認してください');
   return data;
  }finally{clearTimeout(timeout)}
 }
 return {read,readKey,baseline,ensureStart,recordManual,acknowledgeGap,gapAcknowledged,calculated,correctionKey};
});
