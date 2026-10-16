/* TAXIAPP map viewer: read-only adapters for the existing on-device state.
 * map.html does not write taxiapp-store-v1 / taxiapp-v1.
 */
(function(global){
 'use strict';
 const LAYOUTS=['side','stack','input','map'];
 const DB_NAME='taxiapp-store-v1',STORE='state',KEY='taxiapp',FALLBACK_KEY='taxiapp-v1';
 function validState(value){
   return Boolean(value&&value.version===1&&Array.isArray(value.shifts));
 }
 function point(value){
   if(!value)return null;
   let lat,lng,accuracy=null,recordedAt='';
   if(typeof value==='string'){
     const match=value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
     if(!match)return null;
     lat=Number(match[1]);lng=Number(match[2]);
   }else{
     lat=Number(value.lat??value.latitude);
     lng=Number(value.lng??value.lon??value.longitude);
     if(value.accuracy!==null&&value.accuracy!==undefined&&Number.isFinite(Number(value.accuracy)))accuracy=Number(value.accuracy);
     recordedAt=String(value.recordedAt||value.iso||'');
   }
   if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return null;
   return {lat,lng,accuracy,recordedAt};
 }
 function locationFromRecord(rec,which){
   const raw=rec?.raw||{},meta=rec?.meta||{};
   if(which==='pickup')return point(meta.pickupGeo)||point(raw.D);
   if(which==='drop')return point(meta.dropGeo)||point(raw.H);
   return null;
 }
 function getPins(shift){
   if(!shift)return [];
   const out=[];
   for(const [index,record] of [...(shift.records||[]),...(shift.draft?[shift.draft]:[])].entries()){
     if(!record||!['ride','cancel','dispatch'].includes(record.kind))continue;
     const number=record.raw?.A??index+1;
     const pickup=locationFromRecord(record,'pickup');
     const drop=record.kind==='ride'?locationFromRecord(record,'drop'):null;
     const recordId=String(record.id||index);
     if(pickup)out.push({id:recordId+'-pickup',recordId,kind:'pickup',number,
       label:'№'+number+' 乗車・迎車地点',place:String(record.raw?.AL||''),...pickup});
     if(drop)out.push({id:recordId+'-drop',recordId,kind:'drop',number,
       label:'№'+number+' 降車地点',place:String(record.raw?.AM||''),...drop});
   }
   if(shift.waiting?.geo){
     const wait=point(shift.waiting.geo);
     if(wait)out.push({id:'current-wait',kind:'waiting',label:'現在の待機場所',
       place:String(shift.waiting.place||''),...wait});
   }
   return out;
 }
 function currentFix(shift,now=Date.now()){
   const g=shift?.gpsTrip;
   const last=g?.lastFix;
   const t=Number(last?.t||g?.lastSeenMs||0);
   if(!last||!Number.isFinite(t)||!t||now-t<0||now-t>60000)return null;
   const fixed=point(last);
   return fixed?{...fixed,recordedAt:new Date(t).toISOString(),source:'GPS走行距離の最終測位'}:null;
 }
 function selectShift(state,id){
   if(!validState(state))return null;
   return state.shifts.find(s=>s.id===id)||state.shifts.find(s=>s.id===state.activeId)||state.shifts[0]||null;
 }
 function chooseLayout(requested,stored='stack'){
   return LAYOUTS.includes(requested)?requested:LAYOUTS.includes(stored)?stored:'stack';
 }
 function formatShift(shift){
   if(!shift)return '乗務なし';
   return [shift.date||'日付不明',shift.startedAt||'出庫時刻不明',
    (shift.records||[]).length+'件',shift.endedAt?'入庫済':'乗務中'].join(' ・ ');
 }
 function mapsUrl(pointValue,route=false){
   const p=point(pointValue);
   if(!p)return null;
   const coords=encodeURIComponent(p.lat.toFixed(6)+','+p.lng.toFixed(6));
   return route?
    'https://www.google.com/maps/dir/?api=1&destination='+coords:
    'https://www.google.com/maps/search/?api=1&query='+coords;
 }
 global.TAXIAPP_MAP_SHARED=Object.freeze({DB_NAME,STORE,KEY,FALLBACK_KEY,LAYOUTS,
   validState,point,locationFromRecord,getPins,currentFix,selectShift,chooseLayout,
   formatShift,mapsUrl});
})(typeof window!=='undefined'?window:globalThis);
