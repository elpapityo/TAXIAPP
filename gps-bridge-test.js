/* TAXIAPP Android GPS -> isolated browser test; no duty or cloud writes. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.TaxiGpsBridge=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const FORMAT='TAXIAPP_GPS_NATIVE_BRIDGE_V1',METRICS=Object.freeze(['tripKm','realKm','emptyKm','lastRideKm']);
 const hashPrefix='#gps-bridge=', MAX_KM=10000;
 function metricOk(m){if(!METRICS.includes(m))throw Error('距離の種類が不正です');return m;}
 function km(v,nullable=false){
  if(nullable&&(v===null||v===''))return null;
  if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>MAX_KM)throw Error('GPS距離の値が不正です');
  return Math.round(v*1000)/1000;
 }
 function selectKm(data,metric){return km(data[metricOk(metric)],metric==='lastRideKm');}
 function createRequest(metric,nonce,now=Date.now()){
  metricOk(metric);if(!/^[a-f0-9]{32}$/.test(nonce))throw Error('取得番号が不正です');
  return {pending:{nonce,metric,issuedAt:now},uri:'taxiappgpsv035://measure?metric='+metric+'&nonce='+nonce};
 }
 function qualityWarnings(data){
  const msgs=[];
  if(!data.running)msgs.push('GPS測定は停止中です');
  if(data.unresolvedGap)msgs.push('未解決のGPS欠測があります。車両のトリップ距離を確認してください');
  if(data.gpsAgeMs===null)msgs.push('GPS受信時刻を確認できません');
  else if(data.gpsAgeMs>30000)msgs.push('GPSの受信が30秒以上前です');
  if(data.accuracyMeters!==null&&data.accuracyMeters>45)msgs.push('GPS測位精度が低下しています');
  return msgs;
 }
 function validateResponse(data,pending,now=Date.now()){
  if(!pending||!data||typeof pending!=='object'||typeof data!=='object')throw Error('取得操作が見つかりません。ボタンからやり直してください');
  metricOk(pending.metric);
  if(data.format!==FORMAT||data.nonce!==pending.nonce||data.metric!==pending.metric||!/^[a-f0-9]{32}$/.test(data.nonce))throw Error('別の取得操作の結果です。距離を反映しません');
  if(!Number.isFinite(pending.issuedAt)||now-pending.issuedAt>120000||pending.issuedAt>now+10000)throw Error('取得操作の有効時間が過ぎました');
  if(!Number.isFinite(data.capturedAt)||data.capturedAt<pending.issuedAt-10000||data.capturedAt>now+10000)throw Error('結果の時刻が正しくありません');
  const x={source:'android',metric:pending.metric,
   tripKm:km(data.tripKm),realKm:km(data.realKm),emptyKm:km(data.emptyKm),lastRideKm:km(data.lastRideKm,true),
   capturedAt:data.capturedAt, place:typeof data.address==='string'?data.address.slice(0,120):'住所未取得',locationAt:Number.isFinite(data.locationAt)?data.locationAt:null, gapCount:Number.isInteger(data.gapCount)&&data.gapCount>=0?data.gapCount:0,
   unresolvedGap:data.unresolvedGap===true,running:data.running===true,
   gpsAgeMs:Number.isFinite(data.gpsAgeMs)&&data.gpsAgeMs>=0?data.gpsAgeMs:null,
   accuracyMeters:Number.isFinite(data.accuracyMeters)?data.accuracyMeters:null,
   rideCount:Number.isInteger(data.rideCount)&&data.rideCount>=0?data.rideCount:null,
   mode:data.mode==='REAL'?'実車':'空車'};
  x.km=selectKm(x,pending.metric);if(x.km===null)throw Error('指定された実車距離が未測定です');
  x.warnings=qualityWarnings(x);return x;
 }
 function decodeFragment(hash){
  if(typeof hash!=='string'||!hash.startsWith(hashPrefix))return null;
  const raw=hash.slice(hashPrefix.length);if(raw.length>5000)throw Error('GPS応答が長すぎます');
  try{return JSON.parse(decodeURIComponent(raw));}catch{throw Error('GPS応答を読み取れません');}
 }
 function parseCopiedReport(text,metric,now=Date.now()){
  metricOk(metric);
  if(typeof text!=='string'||!text.includes('TAXIAPP GPS距離測定試験'))throw Error('GPS試験アプリのコピー結果ではありません');
  function matchKm(label,required=true){
   const m=text.match(new RegExp('(?:^|\\n)'+label+'\\s+(\\d+(?:\\.\\d+)?)\\s*km'));
   if(!m){if(!required)return null;throw Error(label+' の値がありません');}
   return km(Number(m[1]));
  }
  const m=text.match(/GPS受信\s+(\d+)秒前/);
  const x={source:'clipboard',metric,tripKm:matchKm('GPS累計'),realKm:matchKm('実車GPS累計'),
   emptyKm:matchKm('空車GPS累計'),lastRideKm:matchKm('直前の実車',false),capturedAt:now,place:'住所は旧GPSアプリのコピーでは取得不可',locationAt:null,
   running:!/状態\s+停止中/.test(text),unresolvedGap:/未解決欠測\s+あり/.test(text),
   gapCount:Number(text.match(/GPS欠測\s+(\d+)回/)?.[1]||0),gpsAgeMs:m?Number(m[1])*1000:null,
   accuracyMeters:null,rideCount:Number(text.match(/降車完了\s+(\d+)回/)?.[1]||0),mode:'空車'};
  x.km=selectKm(x,metric);if(x.km===null)throw Error('指定された実車距離が未測定です');
  x.warnings=['コピー時の計測値です。現在の値とは限りません',...qualityWarnings(x)];
  return x;
 }
 return {FORMAT,METRICS,hashPrefix,createRequest,validateResponse,parseCopiedReport,qualityWarnings,decodeFragment,selectKm};
});
