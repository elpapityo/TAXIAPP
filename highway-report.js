/* TAXIAPP consolidated expressway register (read-only).
 * Uses the same 44-column A:AR source and 75% exemption rounding
 * as deriveRaw(). No route distances or missing charges are guessed.
 */
(function(root) {
 'use strict';
 const rounded=(n,d=3)=>Math.round(n*10**d)/10**d;
 function value(x) {
  if(x===null||x===undefined||String(x).trim()==='')return null;
  const n=Number(x);
  return Number.isFinite(n)?n:null;
 }
 const written=x=>x===null||x===undefined?'':String(x);
 const sum=items=>rounded(items.reduce((a,b)=>a+b,0));
 function collect(shift,deriveRaw) {
  const entries=[];
  for(const [i,record] of (shift?.records||[]).entries()){
   if(record?.status!=='complete'||!['ride','empty'].includes(record.kind))continue;
   const raw=record.raw||{};
   const flag=written(raw.P);
   if(!flag.includes('実')&&!flag.includes('空'))continue;
   const derived=typeof deriveRaw==='function'?deriveRaw(record):raw;
   for(const mode of ['実','空']){
    if(!flag.includes(mode))continue;
    const real=mode==='実';
    const at=real?['Q','R','S','T','U','V']:['Z','AA','AB','AC','AD','AE'];
    const entryKm=value(raw[at[2]]),exitKm=value(raw[at[5]]);
    const validDistance=entryKm!==null&&entryKm>=0&&exitKm!==null&&exitKm>=entryKm;
    // Existing reference calculates a 0.1km section, then 75% with 0.001km rounding.
    const sectionKm=validDistance?rounded(exitKm-entryKm,1):null;
    const exemptKm=validDistance?rounded(sectionKm*.75):null;
    const fees=real?['W']:['AF','AG','AH'];
    const amounts=fees.map(key=>value(raw[key]));
    const anyFee=amounts.some(n=>n!==null);
    const chargeYen=anyFee?sum(amounts.filter(n=>n!==null)):null;
    entries.push({
     id:written(record.id)||String(i),
     no:written(raw.A)||String(i+1),
     mode,entryIC:written(raw[at[0]]),entryTime:written(raw[at[1]]),
     entryKm,exitIC:written(raw[at[3]]),exitTime:written(raw[at[4]]),exitKm,
     sectionKm,exemptKm,chargeYen,
     distanceMissing:!validDistance,
     chargeMissing:!anyFee,
     // For existing records that contain derived values only, show the correct
     // derived fields but never accept them as confirmed driving checkpoints.
     legacyDerivedKm:value(derived?.[real?'X':'AJ'])
    });
   }
  }
  const groups={};
  for(const mode of ['実','空']){
   const rows=entries.filter(r=>r.mode===mode);
   groups[mode]={
    count:rows.length,
    sectionKm:sum(rows.map(r=>r.sectionKm??0)),
    exemptKm:sum(rows.map(r=>r.exemptKm??0)),
    chargeYen:sum(rows.map(r=>r.chargeYen??0)),
    unknownDistances:rows.filter(r=>r.distanceMissing).length,
    unknownCharges:rows.filter(r=>r.chargeMissing).length
   };
  }
  return {
   entries, real:groups['実'],empty:groups['空'],
   count:entries.length,
   sectionKm:sum([groups['実'].sectionKm,groups['空'].sectionKm]),
   exemptKm:sum([groups['実'].exemptKm,groups['空'].exemptKm]),
   chargeYen:sum([groups['実'].chargeYen,groups['空'].chargeYen]),
   unknownDistances:groups['実'].unknownDistances+groups['空'].unknownDistances,
   unknownCharges:groups['実'].unknownCharges+groups['空'].unknownCharges
  };
 }
 root.TAXIAPP_HIGHWAY_REPORT=Object.freeze({collect,value});
})(typeof window!=='undefined'?window:globalThis);
