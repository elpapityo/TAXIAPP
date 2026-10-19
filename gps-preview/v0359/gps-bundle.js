(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.TAXIAPP_GPS_BUNDLE=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const targets={
 dispatch:{kind:'dispatch',distance:'F',coordinate:'D',address:'AL',label:'迎車先到着'},
 pickup:{kind:'ride',distance:'F',time:'G',coordinate:'D',address:'AL',label:'乗車'},
 drop:{kind:'ride',distance:'L',time:'M',coordinate:'H',address:'AM',label:'降車'},
 realEntry:{kind:'ride',distance:'S',time:'R',label:'実車高速入口'},
 realExit:{kind:'ride',distance:'V',time:'U',label:'実車高速出口'},
 emptyEntry:{kind:'any',distance:'AB',time:'AA',label:'空車高速入口'},
 emptyExit:{kind:'any',distance:'AE',time:'AD',label:'空車高速出口'},
 waiting:{kind:'waiting',label:'待機'}
 };
 function definition(k){return Object.prototype.hasOwnProperty.call(targets,k)?targets[k]:null}
 function validate(g,p,now=Date.now()){
  if(!g||g.format!=='TAXIAPP_GPS_DIARY_V131'||!Number.isFinite(g.tripKm)||
   !Number.isFinite(g.capturedAt)||Math.abs(now-g.capturedAt)>15000)
   throw Error('Android GPS距離・取得時刻が正しくありません');
  if(!p?.coords||!Number.isFinite(p.coords.latitude)||!Number.isFinite(p.coords.longitude)||
   Math.abs(p.coords.latitude)>90||Math.abs(p.coords.longitude)>180||
   !Number.isFinite(p.coords.accuracy)||p.coords.accuracy<=0||p.coords.accuracy>100||
   !Number.isFinite(p.timestamp)||Math.abs(now-p.timestamp)>15000)
   throw Error('Chromeの位置情報を正確に取得できません');
  if(Math.abs(g.capturedAt-p.timestamp)>8000)
   throw Error('距離と位置の取得時刻に差があります。停止して再取得してください');
  return {timeMs:g.capturedAt,positionTimeMs:p.timestamp,lat:p.coords.latitude,
   lng:p.coords.longitude,accuracy:p.coords.accuracy,simulated:g.simulated===true};
 }
 function positionOnce(geo){
  if(!geo?.getCurrentPosition)return Promise.reject(Error('Chromeの位置情報が利用できません'));
  return new Promise((resolve,reject)=>geo.getCurrentPosition(resolve,e=>
    reject(Error('現在地を取得できません：'+(e?.message||'位置情報を許可してください'))),
    {enableHighAccuracy:true,maximumAge:0,timeout:12000}));
 }
 return {definition,validate,positionOnce};
});