/* Isolated GPS distance trial:
 * B = actual vehicle trip (manual), C = corrected distance,
 * D = raw GPS cumulative (Android), E = section GPS delta (overrideable).
 * Daily TAXIAPP business data is never accessed.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.GpsTestRows=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const MAX_ROWS=30;
 function readKm(v,optional=false){
  if(optional&&(v===null||v===undefined||v===''))return null;
  if(typeof v!=='number'&&typeof v!=='string')throw Error('距離は数値で入力してください');
  const normalized=typeof v==='number'?v:v.trim().replace(',','.');
  if(normalized==='')throw Error('距離を入力してください');
  const n=Number(normalized);
  if(!Number.isFinite(n)||n<0||n>10000)throw Error('距離は0〜10000kmの数値で入力してください');
  return Math.round(n*1000)/1000;
 }
 function emptyRow(){return {realTripKm:'',manualKm:'',intervalOverrideKm:'',gpsKm:null,place:'',at:null};}
 function fresh(){return {startKm:'0',startGpsKm:null,startPlace:'',startAt:null,rows:[emptyRow(),emptyRow()]};}
 function place(v){return typeof v==='string'?v.slice(0,120):'';}
 function dateTime(v){return typeof v==='number'&&Number.isFinite(v)&&v>0?v:null;}
 function optionalTextKm(v){return v==null||v===''?'':String(readKm(v));}
 function clone(state){
  if(!state||!Array.isArray(state.rows)||state.rows.length<1||state.rows.length>MAX_ROWS)throw Error('テスト状態が不正です');
  return {
   startKm:String(readKm(state.startKm)),startGpsKm:readKm(state.startGpsKm,true),
   startPlace:place(state.startPlace),startAt:dateTime(state.startAt),
   rows:state.rows.map(r=>({
    realTripKm:optionalTextKm(r.realTripKm),
    manualKm:optionalTextKm(r.manualKm),
    intervalOverrideKm:optionalTextKm(r.intervalOverrideKm),
    gpsKm:readKm(r.gpsKm,true),place:place(r.place),at:dateTime(r.at)
   }))
  };
 }
 function derive(state){
  const d=clone(state);
  let base=readKm(d.startKm),previousGps=d.startGpsKm,previousAvailable=previousGps!==null;
  const rows=d.rows.map((r,i)=>{
   let delta=null,calculated=null,error='';
   if(r.gpsKm!==null){
    if(!previousAvailable)error='前の行でGPSを取得してください';
    else if(r.gpsKm+1e-7<previousGps)error='GPS累計が減っています。GPS計測がリセットされた可能性があります';
    else delta=readKm(r.gpsKm-previousGps);
   }
   const entered=r.manualKm===''?null:readKm(r.manualKm);
   const intervalOverride=r.intervalOverrideKm===''?null:readKm(r.intervalOverrideKm);
   const intervalKm=delta!==null?(intervalOverride??delta):null;
   if(intervalKm!==null)calculated=readKm(base+intervalKm);
   const finalKm=entered!==null?entered:calculated;
   // Every automatic interval must have both its own and the preceding GPS snapshot.
   // A manual correction never changes the GPS cumulative reference.
   if(!error&&r.gpsKm!==null&&delta!==null){
    base=finalKm;
    previousGps=r.gpsKm;
    previousAvailable=true;
   }else previousAvailable=false;
   return {
    number:i+1,realTripKm:r.realTripKm===''?null:readKm(r.realTripKm),
    gpsKm:r.gpsKm,deltaKm:delta,intervalOverrideKm:intervalOverride,
    intervalKm,measuredKm:calculated,manualKm:entered,finalKm,
    error,place:r.place,at:r.at
   };
  });
  return {startKm:readKm(d.startKm),startGpsKm:d.startGpsKm,startPlace:d.startPlace,startAt:d.startAt,rows};
 }
 function indexCheck(d,index){if(!Number.isInteger(index)||index<0||index>=d.rows.length)throw Error('行番号が不正です');}
 function setStartKm(state,v){const d=clone(state);d.startKm=String(readKm(v));return d;}
 function setManualKm(state,index,v){const d=clone(state);indexCheck(d,index);d.rows[index].manualKm=optionalTextKm(v);return d;}
 function setRealTripKm(state,index,v){const d=clone(state);indexCheck(d,index);d.rows[index].realTripKm=optionalTextKm(v);return d;}
 function setIntervalKm(state,index,v){const d=clone(state);indexCheck(d,index);d.rows[index].intervalOverrideKm=optionalTextKm(v);return d;}
 function appendRow(state){const d=clone(state);if(d.rows.length>=MAX_ROWS)throw Error('テストは最大30行です');d.rows.push(emptyRow());return d;}
 function startGps(state,gpsKm,reset=false,details={}){
  const d=clone(state);
  if(d.rows.some(r=>r.gpsKm!==null)&&!reset)throw Error('開始地点を再取得すると途中の結果が変わります。リセットしてから開始してください');
  d.startGpsKm=readKm(gpsKm);d.startPlace=place(details.place);d.startAt=dateTime(details.at);
  if(reset)d.rows=d.rows.map(()=>emptyRow());
  return d;
 }
 function captureRow(state,index,gpsKm,details={}){
  const d=clone(state);indexCheck(d,index);
  const gps=readKm(gpsKm),before=derive(d);
  if(d.startGpsKm===null)throw Error('先にスタート行のGPSを取得してください');
  if(index>0&&(before.rows[index-1].gpsKm===null||before.rows[index-1].error))
   throw Error('先に'+index+'行目のGPSを取得してください');
  const reference=index===0?d.startGpsKm:before.rows[index-1].gpsKm;
  if(gps+1e-7<reference)throw Error('GPS累計が前回より小さくなっています。測定のリセットを確認してください');
  if(d.rows.slice(index+1).some(r=>r.gpsKm!==null))
   throw Error('後の行にも計測があります。先の計測をリセットしてから取り直してください');
  d.rows[index].gpsKm=gps;
  // Preserve user-entered vehicle trip, corrected distance and interval override.
  // GPS button updates ONLY the snapshot and location/time of this row.
  d.rows[index].place=place(details.place);d.rows[index].at=dateTime(details.at);
  return d;
 }
 return {fresh,clone,derive,setStartKm,setManualKm,setRealTripKm,setIntervalKm,appendRow,startGps,captureRow,readKm,MAX_ROWS};
});
