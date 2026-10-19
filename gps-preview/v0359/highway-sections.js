/* Isolated GPS preview only: lossless per-ride highway sections, old 44 columns compatible. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.TAXIAPP_HIGHWAY_SECTIONS=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const KEYS={実:['Q','R','S','T','U','V'],空:['Z','AA','AB','AC','AD','AE']};
 const NAMES=['entryIC','entryTime','entryKm','exitIC','exitTime','exitKm'];
 const num=x=>x===null||x===undefined||String(x).trim()===''?null:(Number.isFinite(Number(x))?Number(x):null);
 const km=x=>Math.round(x*10)/10;
 const precise=x=>Math.round(x*1000)/1000;
 const escapeMode=m=>m==='実'||m==='空'?m:null;
 function fromLegacy(raw,mode){
   if(!escapeMode(mode))throw Error('高速区分が不正です');
   const fields=KEYS[mode],data={mode};
   NAMES.forEach((n,i)=>data[n]=String(raw?.[fields[i]]??''));
   data.fee=mode==='実'?String(raw?.W??''):String(['AF','AG','AH'].reduce((a,k)=>a+(num(raw?.[k])??0),0));
   if(mode==='空'&&['AF','AG','AH'].every(k=>num(raw?.[k])===null))data.fee='';
   return data;
 }
 function list(row){
   const items=row?.meta?.highwaySections;
   return Array.isArray(items)?items.filter(v=>v&&escapeMode(v.mode)):null;
 }
 function initialize(row){
   if(!row?.raw)throw Error('高速明細の対象がありません');
   row.meta??={};
   if(Array.isArray(row.meta.highwaySections))return row.meta.highwaySections;
   row.meta.highwaySections=[];
   const flags=String(row.raw.P??'');
   for(const m of ['実','空'])if(flags.includes(m))row.meta.highwaySections.push(fromLegacy(row.raw,m));
   return row.meta.highwaySections;
 }
 function entryValid(seg){
   const entry=num(seg.entryKm),exit=num(seg.exitKm);
   return entry!==null&&entry>=0&&exit!==null&&exit>=entry;
 }
 function entryDistance(seg){return entryValid(seg)?km(num(seg.exitKm)-num(seg.entryKm)):null;}
 function aggregate(items){
   const result={};
   for(const mode of ['実','空']){
     const rows=(items||[]).filter(x=>x?.mode===mode);
     const missing=rows.filter(x=>entryDistance(x)===null).length;
     const sectionKm=precise(rows.reduce((a,x)=>a+(entryDistance(x)??0),0));
     const exemptKm=precise(rows.reduce((a,x)=>a+precise((entryDistance(x)??0)*.75),0));
     const fee=rows.reduce((a,x)=>a+(num(x.fee)??0),0);
     const first=rows[0]??null;
     result[mode]={rows,count:rows.length,first,sectionKm,exemptKm,fee,
       missingDistance:missing,missingFee:rows.filter(x=>num(x.fee)===null).length};
   }
   return result;
 }
 function project(raw,segments){
   if(!Array.isArray(segments))return {...raw};
   const a=aggregate(segments),out={...raw};
   out.P=(a.実.count?'実':'')+(a.空.count?'空':'');
   for(const mode of ['実','空']){
     const keys=KEYS[mode],first=a[mode].first;
     NAMES.forEach((name,i)=>out[keys[i]]=first?String(first[name]??''):'');
   }
   out.W=a.実.count?String(a.実.fee):'';
   out.X=a.実.count?String(a.実.sectionKm):'';
   out.Y=a.実.count?String(a.実.exemptKm):'';
   out.AF=a.空.count?String(a.空.fee):'';
   out.AG='';out.AH='';
   out.AI=a.空.count?String(a.空.fee):'';
   out.AJ=a.空.count?String(a.空.sectionKm):'';
   out.AK=a.空.count?String(a.空.exemptKm):'';
   return out;
 }
 function validate(items){
  const issues=[];
  for(const [i,seg] of (items||[]).entries()){
   if(!escapeMode(seg.mode)){issues.push('高速'+(i+1)+'区間の区分');continue;}
   const a=num(seg.entryKm),b=num(seg.exitKm),fee=num(seg.fee);
   if((a!==null||b!==null)&&!entryValid(seg))issues.push('高速'+(i+1)+'区間の乗距離・降距離');
   if(fee!==null&&(!Number.isInteger(fee)||fee<0))issues.push('高速'+(i+1)+'区間の料金');
  }
  return issues;
 }
 return Object.freeze({KEYS,NAMES,num,km,precise,fromLegacy,list,initialize,entryValid,entryDistance,aggregate,project,validate});
});