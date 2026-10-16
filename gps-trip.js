/* TAXIAPP experimental browser GPS trip meter.
 * Uses visible-page geolocation positions only. No routing or paid API.
 * 2026-10-16: Never infer distance over missing/hidden/low-accuracy periods.
 */
(function (root) {
  'use strict';
  const MAX_ACCURACY_M=45, MAX_GAP_MS=60000, MAX_SPEED_MPS=55, MAX_FIX_AGE_MS=15000;
  const roundKm=km=>Math.round(km*10000)/10000;
  const nowIso=ms=>new Date(ms).toISOString();
  function create(startKm=0){
    return {
      version:1,enabled:false,tripKm:Math.max(0,Number(startKm)||0),
      realKm:0,emptyKm:0,correctionKm:0,mode:'empty',status:'off',
      lastFix:null,lastSeenMs:0,lastAccuracy:null,lastError:'',gapOpen:false,unresolvedGap:false,
      gapCount:0,gaps:[],corrections:[],modeHistory:[]
    };
  }
  function point(position){
    const c=position?.coords||{},t=Number(position?.timestamp);
    const lat=Number(c.latitude),lng=Number(c.longitude),accuracy=Number(c.accuracy);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180
       ||!Number.isFinite(accuracy)||accuracy<=0)return null;
    return {lat,lng,accuracy,t,velocity:Number.isFinite(Number(c.speed))&&c.speed!==null?Number(c.speed):null};
  }
  function metersBetween(a,b){
    const rad=Math.PI/180,p1=a.lat*rad,p2=b.lat*rad;
    const dp=(b.lat-a.lat)*rad,dl=(b.lng-a.lng)*rad;
    const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 12742000*Math.asin(Math.min(1,Math.sqrt(Math.max(0,h))));
  }
  function miss(s,reason,t=Date.now()){
    const message=String(reason||'測位が中断しました');
    if(!s.gapOpen){
      s.gapOpen=true;s.gapCount=(s.gapCount||0)+1;
      (s.gaps??=[]).push({at:nowIso(t),reason:message,tripKm:s.tripKm,mode:s.mode});
      if(s.gaps.length>60)s.gaps.shift();
    }
    s.lastFix=null;s.status='gap';s.lastError=message;s.unresolvedGap=true;
    return {accepted:false,gap:true,reason:message};
  }
  function resume(s,t=Date.now()){
    s.enabled=true;s.status='waiting';s.lastError='';
    s.lastFix=null; // Never bridge previous session / background / tab reload.
    s.gapOpen=false;
    s.lastSeenMs=0;
    s.lastStopIso='';
    s.watchStartedIso=nowIso(t);
    if(!s.startedIso)s.startedIso=nowIso(t);
    return s;
  }
  function stop(s,t=Date.now()){
    s.enabled=false;s.status='off';s.lastFix=null;
    s.lastStopIso=nowIso(t);
    return s;
  }
  function mode(s,name,t=Date.now()){
    if(name!=='real'&&name!=='empty')return s;
    if(s.mode!==name){
      (s.modeHistory??=[]).push({from:s.mode,to:name,at:nowIso(t),tripKm:s.tripKm});
      if(s.modeHistory.length>120)s.modeHistory.shift();
      s.mode=name;
      s.lastFix=null; // Treat the fix across a passenger boundary as unknown.
      if(s.enabled)s.status='waiting';
    }
    return s;
  }
  function correct(s,km,source='手動修正',t=Date.now()){
    const after=Number(km);
    if(!Number.isFinite(after)||after<0||after>100000)return null;
    const before=Number(s.tripKm)||0,diff=roundKm(after-before);
    (s.corrections??=[]).push({at:nowIso(t),beforeKm:before,afterKm:after,
      differenceKm:diff,source:String(source).slice(0,80),mode:s.mode});
    if(s.corrections.length>100)s.corrections.shift();
    s.tripKm=roundKm(after);s.correctionKm=roundKm((s.correctionKm||0)+diff);
    s.unresolvedGap=false;s.lastCorrectionIso=nowIso(t);
    s.lastFix=null; // First new position is a new reference, not a traveled leg.
    s.status=s.enabled?'waiting':'off';
    return {beforeKm:before,afterKm:s.tripKm,differenceKm:diff};
  }
  function ingest(s,position,receivedAt=Date.now()){
    if(!s?.enabled)return {accepted:false,reason:'off'};
    const p=point(position);
    if(!p||!Number.isFinite(p.t)||Math.abs(receivedAt-p.t)>MAX_FIX_AGE_MS)
      return miss(s,'測位データが古いか位置が不正',receivedAt);
    if(p.accuracy>MAX_ACCURACY_M)return miss(s,'GPS精度が低い（±'+Math.round(p.accuracy)+'m）',receivedAt);
    if(p.velocity!==null&&(p.velocity<0||p.velocity>MAX_SPEED_MPS))
      return miss(s,'GPS速度が異常',receivedAt);
    const last=s.lastFix;
    s.lastSeenMs=receivedAt;s.lastAccuracy=p.accuracy;
    if(!last||s.gapOpen){
      s.lastFix={lat:p.lat,lng:p.lng,accuracy:p.accuracy,t:p.t};
      s.gapOpen=false;s.lastError='';s.status='tracking';
      return {accepted:true,anchored:true,deltaKm:0};
    }
    const elapsed=(p.t-last.t)/1000;
    if(!Number.isFinite(elapsed)||elapsed<=0)return {accepted:false,reason:'時刻順序が不正'};
    if(elapsed*1000>MAX_GAP_MS)return Object.assign(miss(s,'前回の測位から60秒超：距離は未計測',receivedAt),{reanchorNeeded:true});
    const meters=metersBetween(last,p);
    if(meters/elapsed>MAX_SPEED_MPS)return miss(s,'位置飛びを検出：距離は加算しません',receivedAt);
    // Do not turn stationary GPS jitter into a positive driving distance.
    if(meters<Math.max(9,p.accuracy*.4)||
        (p.velocity!==null&&p.velocity<.7&&meters<Math.max(16,p.accuracy))) {
      s.status='tracking';s.lastError='';
      return {accepted:true,stationary:true,deltaKm:0};
    }
    const distance=roundKm(meters/1000);
    s.tripKm=roundKm(s.tripKm+distance);
    const part=s.mode==='real'?'realKm':'emptyKm';
    s[part]=roundKm((s[part]||0)+distance);
    s.lastFix={lat:p.lat,lng:p.lng,accuracy:p.accuracy,t:p.t};
    s.gapOpen=false;s.status='tracking';s.lastError='';
    return {accepted:true,distanceMeters:meters,deltaKm:distance,mode:s.mode};
  }
  root.TAXIAPP_GPS_TRIP=Object.freeze({
    create,point,metersBetween,miss,resume,stop,mode,correct,ingest,
    MAX_GAP_MS,MAX_ACCURACY_M
  });
})(typeof window!=='undefined'?window:globalThis);
