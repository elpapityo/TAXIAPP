'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const a=html.indexOf('function rebaseNativeTripAfterManual(');
const b=html.indexOf('function handleInput(',a);
assert.ok(a>0&&b>a);
async function test({overwrite=false,changeWait=false}={}){
 const bases=[],acks=[],notices=[],saves=[];
 const active={id:'shift-one',waiting:{id:'wait-one',odometer:'0.350'},endedAt:''};
 let resolve;
 const native={
  read:()=>new Promise(r=>resolve=r),
  recordManual:(store,id,gpsKm,value,runId)=>bases.push({id,gpsKm,value,runId}),
  acknowledgeGap:(store,id,gaps)=>acks.push({id,gaps})
 };
 const context={window:{TAXIAPP_EXTERNAL_GPS:native},nativeDiaryGpsEnabled:()=>true,
   number:Number,localStorage:{},fetch:()=>{},getShift:()=>active,
   canEditNow:()=>true,saveLater:()=>saves.push(1),toast:s=>notices.push(s),Date};
 vm.createContext(context);vm.runInContext(html.slice(a,b),context);
 context.shift=active;context.value='0.350';
 context.stillCurrent=s=>s.waiting?.id==='wait-one'&&s.waiting?.odometer==='0.350';
 vm.runInContext('rebaseNativeTripAfterManual(shift,value,stillCurrent)',context);
 if(overwrite)active.waiting.odometer='0.400';
 if(changeWait)active.waiting.id='wait-two';
 resolve({tripKm:12.45,runId:'a'.repeat(32),unresolvedGap:true,gapCount:2});
 await new Promise(r=>setImmediate(r));
 return {active,bases,acks,saves,notices};
}
(async()=>{
 const good=await test();
 assert.equal(good.bases.length,1);
 assert.equal(good.bases[0].value,'0.350');
 assert.equal(good.bases[0].gpsKm,12.45);
 assert.equal(good.active.waiting.odometer,'0.350','GPS correction never overrides manual value');
 assert.equal(good.active.externalGpsSnapshot.tripKm,0.35);
 assert.equal(good.acks.length,1);
 for(const mode of [{overwrite:true},{changeWait:true}]){
  const x=await test(mode);assert.equal(x.bases.length,0,'stale responses must not rebase');
 }
 assert.match(html,/if\(nativeDiaryGpsEnabled\(\)\)\{\s*const edited=target\.value\.trim\(\),waitId=s\.waiting\.id/);
 assert.match(html,/rebaseNativeTripAfterManual\(s,edited,a=>String\(a\.endingOdo\)/);
 console.log('Native manual rebase: fresh result, correction, gaps and stale field guards passed');
})().catch(e=>{console.error(e);process.exitCode=1});
