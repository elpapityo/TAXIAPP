/* TAXIAPP daily analysis: 13-hour duty reference and 275 km + expressway
 * exemption reference distance. These are comparison/forecast figures, not
 * legal limits and never affect sales, settlements, or the meter total.
 */
(function(root){
 'use strict';
 const SHIFT_SECONDS=13*3600, BASE_KM=275;
 const finite=value=>{
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const n=Number(value);return Number.isFinite(n)?n:null;
 };
 const rounded=(number,places=3)=>Math.round(number*10**places)/10**places;
 function exemption(records,deriveRaw){
  let real=0,empty=0;
  for(const row of records||[]){
   if(row?.status!=='complete'||!['ride','empty'].includes(row.kind))continue;
   const raw=typeof deriveRaw==='function'?deriveRaw(row):row.raw||{};
   const category=String(raw?.P||'');
   if(category.includes('実'))real+=Math.max(0,finite(raw.Y)||0);
   if(category.includes('空'))empty+=Math.max(0,finite(raw.AK)||0);
  }
  return {realKm:rounded(real),emptyKm:rounded(empty),totalKm:rounded(real+empty)};
 }
 function distanceReading(shift,now=new Date()){
  const start=finite(shift?.startingOdo);
  if(start===null||start<0)return {km:null,source:'出庫トリップ未記録'};
  if(shift?.endedAt||shift?.endedIso){
   const end=finite(shift.endingOdo);
   return end!==null&&end>=start
    ?{km:rounded(end-start),source:'入庫時の実測トリップ'}
    :{km:null,source:'入庫トリップ未記録'};
  }
  const gps=shift?.gpsTrip;
  if(gps?.enabled){
   const age=now.getTime()-Number(gps.lastSeenMs||0);
   if(gps.unresolvedGap||gps.gapOpen||gps.status==='gap')
    return {km:null,source:'GPS未計測区間あり：車両トリップで補正してください'};
   if(gps.lastFix&&gps.status==='tracking'&&age>=0&&age<60000){
    const reading=finite(gps.tripKm);
    return reading!==null&&reading>=start
     ?{km:rounded(reading-start),source:'GPSの最新トリップ（参考値）'}
     :{km:null,source:'GPS距離は未確定'};
   }
   return {km:null,source:'GPS測位待ち：実測距離は未確定'};
  }
  // A manually entered return odometer can serve as a provisional reading.
  // Do not treat an old GPS estimate from a stopped session as current.
  if(!gps){
   const manual=finite(shift?.endingOdo);
   if(manual!==null&&manual>=start)
    return {km:rounded(manual-start),source:'入力済みトリップ（暫定）'};
   if(shift?.waiting){
    const wait=finite(shift.waiting.odometer);
    if(wait!==null&&wait>=start)
     return {km:rounded(wait-start),source:'待機時の入力トリップ（暫定）'};
   }
   for(const record of [...(shift.records||[])].reverse()){
    if(record?.status!=='complete'||record.kind!=='ride')continue;
    const last=finite(record.raw?.L);
    if(last!==null&&last>=start)
     return {km:rounded(last-start),source:'直近の降車時トリップ（以降の空車距離は未含有）'};
   }
  }
  return {km:null,source:gps?'GPS停止中：車両トリップの照合が必要':'トリップ距離の入力待ち'};
 }
 function calculate(shift,{now=new Date(),meter=0,rides=0,deriveRaw}={}){
  if(!(now instanceof Date))now=new Date(now);
  const start=Date.parse(shift?.startedIso||'');
  const stopped=Boolean(shift?.endedAt||shift?.endedIso);
  const final=shift?.endedIso?Date.parse(shift.endedIso):NaN;
  // A historical check-in with only a clock string has no reliable end date.
  // Never count time up to the present once the shift is closed.
  const end=stopped?final:now.getTime();
  const elapsed=Number.isFinite(start)?Math.max(0,Math.floor((end-start)/1000)):null;
  const deadline=Number.isFinite(start)?new Date(start+SHIFT_SECONDS*1000):null;
  const remaining=elapsed===null?null:Math.max(0,SHIFT_SECONDS-elapsed);
  const exceeded=elapsed===null?null:Math.max(0,elapsed-SHIFT_SECONDS);
  const hours=elapsed===null?null:elapsed/3600;
  const revenue=Math.max(0,finite(meter)||0),finished=Number(rides)||0;
  const hourly=hours>0?revenue/hours:null;
  const timeProjection=hours>=.5&&finished>0?hourly*13:null;
  const exempt=exemption(shift?.records,deriveRaw);
  const capKm=rounded(BASE_KM+exempt.totalKm);
  const distance=distanceReading(shift,now);
  const kmRevenue=distance.km>0?revenue/distance.km:null;
  const distanceProjection=distance.km>0&&finished>0?kmRevenue*capKm:null;
  return {
   baseHours:13,baseKm:BASE_KM,limitSeconds:SHIFT_SECONDS,
   elapsedSeconds:elapsed,remainingSeconds:remaining,exceededSeconds:exceeded,
   deadlineIso:deadline?.toISOString()||null, ended:Boolean(shift?.endedAt||shift?.endedIso),
   revenue,rides:finished,hourlyRevenue:hourly,timeProjection,
   exemptRealKm:exempt.realKm,exemptEmptyKm:exempt.emptyKm,exemptKm:exempt.totalKm,
   capKm,travelKm:distance.km,distanceSource:distance.source,
   remainingKm:distance.km===null?null:rounded(Math.max(0,capKm-distance.km)),
   exceededKm:distance.km===null?null:rounded(Math.max(0,distance.km-capKm)),
   yenPerKm:kmRevenue,distanceProjection,
   combinedProjection:timeProjection!==null&&distanceProjection!==null?
    Math.min(timeProjection,distanceProjection):null
  };
 }
 root.TAXIAPP_DAILY_REFERENCE=Object.freeze({calculate,exemption,distanceReading,SHIFT_SECONDS,BASE_KM});
})(typeof window!=='undefined'?window:globalThis);
