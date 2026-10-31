/* GPS履歴の端末・サーバー共通検証。営業距離・料金計算には使用しない。 */
(function(root){'use strict';
const FORMAT='TAXIAPP_GPS_HISTORY_V1';
const MAX_BYTES=780000;
const SHIFT=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
const encoder=new TextEncoder();
function retentionDeadlineMs(endedAtMs){
 if(!Number.isFinite(endedAtMs)||endedAtMs<=0)throw Error('入庫日時が未確認です');
 const d=new Date(endedAtMs+9*3600000);
 const y=d.getUTCFullYear(),m=d.getUTCMonth()+1,day=d.getUTCDate();
 const lastDay=new Date(Date.UTC(y,m+1,0)).getUTCDate();
 // Same day in following month, or last valid day, through 23:59:59 JST.
 return Date.UTC(y,m,Math.min(day,lastDay)+1)-9*3600000-1;
}
function prepare(row){
 if(!row||!row.uid||!SHIFT.test(String(row.shiftId||''))||
    !Number.isSafeInteger(row.startedAtMs)||row.startedAtMs<=0||!Number.isSafeInteger(row.endedAtMs)||
    row.endedAtMs<row.startedAtMs||!Array.isArray(row.points)||!row.points.length||row.points.length>2500)
   throw Error('入庫済みのGPS走行履歴ではありません');
 let priorTime=row.startedAtMs-1,priorSegment=1;
 const points=row.points.map(p=>{
  if(!Number.isSafeInteger(p.capturedAtMs)||p.capturedAtMs<row.startedAtMs||
     p.capturedAtMs>row.endedAtMs||p.capturedAtMs<=priorTime||!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||
     Math.abs(p.lat)>90||Math.abs(p.lon)>180||!Number.isFinite(p.accuracy)||
     p.accuracy<0||
     (p.speed!=null&&(!Number.isFinite(p.speed)||p.speed<0))||
     (p.heading!=null&&(!Number.isFinite(p.heading)||p.heading<0||p.heading>=360))||
     !Number.isInteger(p.segmentNo)||p.segmentNo<priorSegment)
    throw Error('不正なGPS測位点が含まれています');
  priorTime=p.capturedAtMs;priorSegment=p.segmentNo;
  return {
   capturedAtMs:p.capturedAtMs,lat:p.lat,lon:p.lon,accuracy:p.accuracy,
   speed:p.speed==null?null:p.speed,heading:p.heading==null?null:p.heading,
   suspectedJump:p.suspectedJump===true,segmentNo:p.segmentNo
  };
 });
 const payload={format:FORMAT,shiftId:row.shiftId,startedAtMs:row.startedAtMs,
  endedAtMs:row.endedAtMs,points};
 if(encoder.encode(JSON.stringify(payload)).length>MAX_BYTES)
  throw Error('GPS履歴がクラウド保存上限を超えています。端末履歴を保持します');
 return payload;
}
const api=Object.freeze({FORMAT,MAX_BYTES,SHIFT,prepare,retentionDeadlineMs});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.TAXIAPP_GPS_HISTORY_VALIDATION=api;
})(typeof window!=='undefined'?window:globalThis);
