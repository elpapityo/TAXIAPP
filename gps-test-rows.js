/* Independent distance-row calculator for GPS bridge testing.
   No access to TAXIAPP daily reports, IndexedDB, Firebase or Google. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.GpsTestRows=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const MAX_ROWS=30;
 function readKm(v,optional=false){
  if(optional&&(v==null||v===''))return null;
  const n=typeof v==='number'?v:Number(String(v).replace(',','.'));
  if(!Number.isFinite(n)||n<0||n>10000)throw Error('距離は0〜10000kmの数値で入力してください');
  return Math.round(n*1000)/1000;
 }
 function fresh(){return {startKm:'0',startGpsKm:null,rows:[{gpsKm:null,manualKm:''},{gpsKm:null,manualKm:''}]};}
 function clone(state){
  if(!state||!Array.isArray(state.rows)||state.rows.length<1||state.rows.length>MAX_ROWS)throw Error('テスト状態が不正です');
  const startKm=readKm(state.startKm);
  const startGpsKm=readKm(state.startGpsKm,true);
  return {startKm:String(startKm),startGpsKm,rows:state.rows.map(r=>({gpsKm:readKm(r.gpsKm,true),manualKm:r.manualKm==null?'':r.manualKm===''?'':String(readKm(r.manualKm))}))};
 }
 function derive(state){
  const d=clone(state);
  let base=readKm(d.startKm),previousGps=d.startGpsKm,previousAvailable=previousGps!==null;
  const rows=d.rows.map((r,i)=>{
   let delta=null,measured=null,error='';
   if(r.gpsKm!==null){
    if(!previousAvailable){error='前の行でGPSを取得してください';}
    else if(r.gpsKm+0.0000001<previousGps){error='GPS累計が減っています。GPSアプリ側で距離がリセットされた可能性があります';}
    else {
     delta=readKm(r.gpsKm-previousGps);
     measured=readKm(base+delta);
    }
   }
   const entered=r.manualKm===''?null:readKm(r.manualKm);
   const finalKm=entered!==null?entered:measured;
   // Refuse interpreting a manual distance without a GPS baseline as a new GPS capture.
   // Following row needs an actual GPS snapshot in this row, not a guessed one.
   if(error===''&&r.gpsKm!==null&&measured!==null){
    base=finalKm;
    previousGps=r.gpsKm;
    previousAvailable=true;
   }else{
    previousAvailable=false;
   }
   return {number:i+1,gpsKm:r.gpsKm,deltaKm:delta,measuredKm:measured,manualKm:entered,finalKm,error};
  });
  return {startKm:readKm(d.startKm),startGpsKm:d.startGpsKm,rows};
 }
 function setStartKm(state,km){const d=clone(state);d.startKm=String(readKm(km));return d;}
 function setManualKm(state,index,km){
  const d=clone(state);
  if(!Number.isInteger(index)||index<0||index>=d.rows.length)throw Error('行番号が不正です');
  d.rows[index].manualKm=km===''?'':String(readKm(km));return d;
 }
 function appendRow(state){const d=clone(state);if(d.rows.length>=MAX_ROWS)throw Error('テストは最大30行です');d.rows.push({gpsKm:null,manualKm:''});return d;}
 function startGps(state,gpsKm,reset=false){
  const d=clone(state);
  if(d.rows.some(r=>r.gpsKm!==null)&&!reset)throw Error('開始地点を再取得すると途中の結果が変わります。リセットしてから開始してください');
  d.startGpsKm=readKm(gpsKm);
  if(reset)d.rows=d.rows.map(()=>({gpsKm:null,manualKm:''}));
  return d;
 }
 function captureRow(state,index,gpsKm){
  const d=clone(state);
  if(!Number.isInteger(index)||index<0||index>=d.rows.length)throw Error('行番号が不正です');
  const gps=readKm(gpsKm);
  const before=derive(d);
  if(d.startGpsKm===null)throw Error('先にスタート行のGPSを取得してください');
  if(index>0&&(before.rows[index-1].gpsKm===null||before.rows[index-1].error))
   throw Error('先に'+index+'行目のGPSを取得してください');
  const reference=index===0?d.startGpsKm:before.rows[index-1].gpsKm;
  if(gps<reference)throw Error('GPS累計が前回より小さくなっています。測定のリセットを確認してください');
  if(d.rows.slice(index+1).some(r=>r.gpsKm!==null))throw Error('後の行にも計測があります。先の計測をリセットしてから取り直してください');
  d.rows[index].gpsKm=gps;
  d.rows[index].manualKm=''; // a new explicit GPS read replaces that row's manual correction
  return d;
 }
 return {fresh,clone,derive,setStartKm,setManualKm,appendRow,startGps,captureRow,readKm,MAX_ROWS};
});
