(function(global){
 'use strict';

 const kinds={
  wait:{label:'待機',distance:false},
  ride:{label:'実車',distance:true},
  dispatch:{label:'迎車',distance:true},
  cancel:{label:'迎車キャンセル',distance:false},
  rest:{label:'休憩',distance:false},
  shift:{label:'乗務全体',distance:true}
 };
 const jstClock=new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
 });
 const day=86400000;

 function validDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
 }
 function* ranges(startDate,endDate){
  const end=Date.parse(endDate+'T00:00:00Z');
  for(let start=Date.parse(startDate+'T00:00:00Z');start<=end;start+=36*day){
   yield {
    startDate:new Date(start).toISOString().slice(0,10),
    endDate:new Date(Math.min(end,start+35*day)).toISOString().slice(0,10)
   };
  }
 }
 function clockSeconds(clock){
  const match=String(clock??'').trim().match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/);
  if(!match||Number(match[1])>23)return null;
  return Number(match[1])*3600+Number(match[2])*60+Number(match[3]||0);
 }
 function recordedClock(clock,iso){
  if(clockSeconds(clock)!==null)return String(clock).trim().padStart(
   String(clock).trim().split(':').length===3?8:5,'0');
  const time=Date.parse(iso);
  return Number.isFinite(time)?jstClock.format(time):'';
 }
 function elapsed(start,end,startIso,endIso){
  if(Number.isFinite(Date.parse(startIso))&&Number.isFinite(Date.parse(endIso))&&
     start===recordedClock('',startIso)&&end===recordedClock('',endIso)){
   const seconds=(Date.parse(endIso)-Date.parse(startIso))/1000;
   return seconds>=0?Math.floor(seconds):null;
  }
  const a=clockSeconds(start),b=clockSeconds(end);
  return a===null||b===null?null:(b-a+86400)%86400;
 }
 function distance(start,end){
  if(start==null||end==null||String(start).trim()===''||String(end).trim()==='')return null;
  const a=Number(start),b=Number(end);
  return Number.isFinite(a)&&Number.isFinite(b)&&a>=0&&b>=a?Math.round((b-a)*1000)/1000:null;
 }
 function rows(shifts){
  const result=[];
  for(const shift of shifts){
   const date=shift.date;
   const add=(kind,{start,end,startIso,endIso,place='',destination='',km=null})=>{
    const from=recordedClock(start,startIso),to=recordedClock(end,endIso);
    result.push({date,kind,from,to,place:String(place||''),destination:String(destination||''),
     seconds:elapsed(from,to,startIso,endIso),km});
   };
   if(shift.endedAt||shift.endedIso)add('shift',{
    start:shift.startedAt,end:shift.endedAt,startIso:shift.startedIso,endIso:shift.endedIso,
    km:distance(shift.startingOdo,shift.endingOdo)
   });
   for(const segment of shift.waitSegments||[])add('wait',{
    start:segment.startedAt,end:segment.endedAt,startIso:segment.startedIso,endIso:segment.endedIso,place:segment.place
   });
   for(const segment of shift.breakSessions||[])add('rest',{
    start:segment.startedAt,end:segment.endedAt,startIso:segment.startedIso,endIso:segment.endedIso,place:segment.place
   });
   for(const record of shift.records||[]){
    if(record.status!=='complete')continue;
    const raw=record.raw||{},meta=record.meta||{};
    if(record.kind==='ride'){
     if(meta.boardedFromDispatch||meta.dispatchAt||meta.dispatchIso)add('dispatch',{
      start:meta.dispatchAt||raw.C,end:raw.G,startIso:meta.dispatchIso,endIso:meta.boardedIso,
      destination:raw.AL,km:distance(meta.dispatchStartKm,raw.F)
     });
     add('ride',{start:raw.G,end:raw.M,startIso:meta.boardedIso,endIso:meta.alightIso,
      place:raw.AL,destination:raw.AM,km:distance(raw.F,raw.L)});
    }
    if(record.kind==='cancel')add('cancel',{
     start:meta.dispatchAt,end:meta.cancelAt,startIso:meta.dispatchIso,endIso:meta.cancelIso,destination:raw.AL
    });
   }
  }
  return result.sort((a,b)=>a.date.localeCompare(b.date)||
   (a.from||'99').localeCompare(b.from||'99'));
 }
 function normalized(value){return String(value||'').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/g,'');}
 function filter(rows,{kinds:selected,area,where,from,to}){
  const query=normalized(area);
  const min=clockSeconds(from),max=clockSeconds(to);
  return rows.filter(row=>{
   if(!selected.includes(row.kind))return false;
   if(query){
    const places=where==='start'?[row.place]:where==='end'?[row.destination]:[row.place,row.destination];
    if(!places.some(place=>normalized(place).includes(query)))return false;
   }
   if(min===null&&max===null)return true;
   const clock=clockSeconds(row.from);
   if(clock===null)return false;
   // The minute selected as the upper bound includes the entire minute.
   if(min!==null&&max!==null&&min>max)return clock>=min||clock<max+60;
   return (min===null||clock>=min)&&(max===null||clock<max+60);
  });
 }
 function summarise(rows){
  const result={};
  for(const row of rows){
   const item=result[row.kind]??={count:0,seconds:0,timed:0,km:0,measured:0};
   item.count++;
   if(row.seconds!==null){item.seconds+=row.seconds;item.timed++;}
   if(row.km!==null){item.km+=row.km;item.measured++;}
  }
  return result;
 }
 const api={kinds,validDate,ranges,rows,filter,summarise};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else global.TAXIAPP_DUTY_ANALYSIS=api;
})(globalThis);
