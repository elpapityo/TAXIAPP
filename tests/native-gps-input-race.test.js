'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf(" if(action==='gpsTripFill'&&window.TAXIAPP_EXTERNAL_GPS");
const end=html.indexOf(" if(action==='gpsTripFill'){",start);
assert.ok(start>0&&end>start);
const handler=html.slice(start,end);
async function scenario(change){
 let finish,editable=true,saves=0,refreshes=0;
 const shift={id:'shift-1',draft:{id:'ride-1',raw:{F:'260'},meta:{}}};
 const context={action:'gpsTripFill',id:'F',shift,getShift:()=>shift,
  canEditNow:()=>editable,localStorage:{},Date,
  window:{TAXIAPP_EXTERNAL_GPS:{readKey:()=>true,read:()=>new Promise(r=>finish=r),
   baseline:()=>({gps:100,value:260}),calculated:(km,b)=>b.value+km-b.gps}},
  appEl:{querySelector:()=>null},saveLater:()=>saves++,toast:()=>{},
  refreshDraftGpsFields:()=>refreshes++,updateElapsedTimer:()=>{},
  render:()=>{throw Error('GPS response must not rebuild an input form');}};
 vm.runInNewContext('(function(){'+handler+'})()',context);
 change?.(shift,()=>editable=false);
 finish({tripKm:105});
 await new Promise(resolve=>setImmediate(resolve));
 return {shift,saves,refreshes};
}
(async()=>{
 const ok=await scenario(s=>s.draft.raw.K='3200');
 assert.equal(ok.shift.draft.raw.F,'265.000');
 assert.equal(ok.shift.draft.raw.K,'3200');
 assert.equal(ok.saves,1);assert.equal(ok.refreshes,1);
 for(const change of [
  s=>s.draft.raw.F='270',s=>s.draft.editId='history-1',
  s=>s.draft.id='ride-2',s=>s.endedIso=new Date().toISOString(),
  (s,revoke)=>revoke()
 ]){
  const result=await scenario(change);
  assert.equal(result.saves,0,'stale request must not save');
  assert.equal(result.shift.externalGpsSnapshot,undefined);
 }
 console.log('Native GPS callbacks preserve input, history, closed duties and editor ownership.');
})().catch(e=>{console.error(e);process.exitCode=1;});
