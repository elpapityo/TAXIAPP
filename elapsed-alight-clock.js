/* Taxi duty clock: elapsed time since the most recent actual alighting.
 * Uses the recorded full timestamp when valid, preserving overnight duties and
 * respecting an edited alighting clock instead of treating settlement as alighting.
 */
(function(root){
'use strict';
function ms(value){
 if(!value)return null;
 const n=Date.parse(value);
 return Number.isFinite(n)?n:null;
}
function clock(value){
 const m=String(value||'').match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
 return m?{h:Number(m[1]),m:Number(m[2]),s:Number(m[3]||0)}:null;
}
function sameLocalMinute(instant,c){
 const d=new Date(instant);
 return d.getHours()===c.h&&d.getMinutes()===c.m;
}
function dateCandidates(anchor,c,startMs,nowMs){
 const result=[];
 const d=new Date(anchor);
 d.setHours(12,0,0,0);
 for(let day=-2;day<=3;day++){
  const candidate=new Date(d);
  candidate.setDate(candidate.getDate()+day);
  candidate.setHours(c.h,c.m,c.s,0);
  const n=candidate.getTime();
  if(n>=startMs&&n<=nowMs)result.push(n);
 }
 return result;
}
function rideAlightMs(ride,startMs,nowMs){
 const c=clock(ride?.raw?.M);
 if(!c)return null;
 const meta=ride.meta||{};
 // A real alight timestamp is authoritative only while its local time agrees
 // with the editable time field (minute precision in the UI).
 for(const iso of [meta.alightIso,meta.gpsDistance?.alightedIso]){
  const instant=ms(iso);
  if(instant!==null&&instant>=startMs&&instant<=nowMs&&sameLocalMinute(instant,c))
   return instant;
 }
 const settled=ms(meta.settledIso);
 const boarded=ms(meta.boardedIso);
 const created=ms(meta.createdAt);
 if(settled!==null){
  const candidates=dateCandidates(settled,c,startMs,nowMs)
   .filter(v=>v<=settled&&settled-v<=36*3600000);
  if(candidates.length)return Math.max(...candidates);
 }
 // For a still-open ride (or old records with no settlement ISO), align
 // the clock to the first corresponding day after boarding/start.
 const anchor=boarded??created??startMs;
 const candidates=dateCandidates(anchor,c,startMs,nowMs)
  .filter(v=>v>=anchor-60000&&v-anchor<=36*3600000);
 return candidates.length?Math.min(...candidates):null;
}
function reference(shift,now=new Date()){
 const startMs=ms(shift?.startedIso);
 const nowMs=now instanceof Date?now.getTime():ms(now);
 if(startMs===null||nowMs===null||!Number.isFinite(nowMs))
  return {seconds:null,hasAlight:false};
 const rides=(shift?.records||[]).filter(r=>r?.kind==='ride'&&r.status==='complete');
 if(shift?.draft?.kind==='ride'&&!shift.draft.editId&&shift.draft.raw?.M)
  rides.push(shift.draft);
 let last=null;
 for(const ride of rides){
  const t=rideAlightMs(ride,startMs,nowMs);
  if(t!==null&&(last===null||t>last))last=t;
 }
 const base=last??startMs;
 return {seconds:Math.max(0,Math.floor((nowMs-base)/1000)),hasAlight:last!==null};
}
root.TAXIAPP_ALIGHT_CLOCK=Object.freeze({reference,rideAlightMs});
})(typeof window!=='undefined'?window:globalThis);
