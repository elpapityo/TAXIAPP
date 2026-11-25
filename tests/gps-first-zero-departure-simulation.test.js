'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const bridge=require('../gps-diary-bridge.js');
globalThis.crypto??=require('node:crypto').webcrypto;
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const handler=html.indexOf(" if(action==='startShift'){");
const start=html.indexOf("   if(nativeDiaryGpsEnabled()){",handler);
const end=html.indexOf("  model.shifts.unshift(",start);
assert.ok(handler>0&&start>handler&&end>start);
const script=html.slice(start,end);
function storage(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v))};}
const fixed={marker:'GPS_DISTANCE_LAB_DIARY_V1_4_1_100',packageId:'jp.taxiapp.gpsprototype.distancelabv141',webVersion:'1.4.1',running:true,runId:'native-run-12345678'};
const legacy={...fixed,marker:'GPS_DISTANCE_LAB_DIARY_V1_4_0_100',packageId:'jp.taxiapp.gpsprototype.distancelabv140',webVersion:'1.4.0'};
function mock({identity=fixed,statusGaps=3,captureGaps=3,afterGaps=statusGaps,unresolvedGap=true,lastGapAt=1,gapOpen=false,tripKm=105.5}={}){
 let statuses=0;
 return async u=>{const url=new URL(u);
 return {ok:true,json:async()=>url.pathname.endsWith('status')
  ?{...identity,gaps:++statuses===1?statusGaps:afterGaps,unresolvedGap,accuracyMeters:5}
  :{ready:true,snapshot:{...identity,format:'GPS_DISTANCE_LAB_V1',nonce:url.searchParams.get('nonce'),target:'start',tripKm,capturedAt:Date.now(),gpsAgeMs:200,unresolvedGap,...(identity===fixed?{gaps:captureGaps,lastGapAt,gapOpen}:{})}}};};
}
async function scenario({odometer='0.0',responseDelay=1,enteredSecondsAgo=45,changeShift=false,manualPending=false,manualBase=false,options={}}={}){
 const ls=storage(),id='shift-100-test',click=Date.now();
 const shift={id,startedIso:new Date(click-enteredSecondsAgo*1000).toISOString(),startingOdo:odometer,endedAt:''};
 const notices=[];let writes=0;
 const localStorage=ls,departurePressedAt=click;
 const fetch=mock({lastGapAt:click-1000,...options});
 if(manualBase)bridge.recordManual(ls,id,110,9,fixed.runId);
 const ctx={nativeDiaryGpsEnabled:()=>true,newRecord:shift,odometer,localStorage,fetch,departurePressedAt,
  canEditNow:()=>true,getShift:()=>changeShift?{...shift,id:'other-shift'}:{...shift,...(manualPending?{externalGpsManualPending:true}:{})},
  window:{TAXIAPP_EXTERNAL_GPS:bridge},saveLater:()=>writes++,updateElapsedTimer:()=>{},
  toast:(message,error)=>notices.push({message,error}),Date:class extends Date{static now(){return click+responseDelay*1000}}};
 // Use the same object as the active duty unless deliberately testing a race.
 if(!changeShift&&!manualPending)ctx.getShift=()=>shift;
 vm.runInNewContext('(function(){'+script+'})()',ctx);
 await new Promise(setImmediate);
 return {shift,id,ls,notices,writes};
}
(async()=>{
 const zero=await scenario();
 assert.equal(zero.shift.externalGpsDeparturePending,false);
 assert.equal(bridge.baseline(zero.ls,zero.id).value,0);
 assert.equal(bridge.gapAcknowledged(zero.ls,zero.id,3),true);
 assert.equal(zero.writes,1);
 const next=await bridge.read(zero.ls,mock({tripKm:107}),{shiftId:zero.id});
 assert.equal(bridge.calculated(next.tripKm,bridge.baseline(zero.ls,zero.id),next.runId),1.5);
 await assert.rejects(bridge.read(zero.ls,mock({captureGaps:4}),{shiftId:zero.id}),/欠測が未補正/);
 const old=await scenario({options:{identity:legacy}});
 assert.equal(bridge.gapAcknowledged(old.ls,old.id,3),true);
 const race=await scenario({options:{identity:legacy,afterGaps:4}});
 assert.equal(bridge.baseline(race.ls,race.id),null);
 const retry=await scenario({responseDelay:11});
 assert.equal(bridge.baseline(retry.ls,retry.id),null);
 assert.equal(retry.shift.externalGpsDeparturePending,true);
 const after=await scenario({options:{lastGapAt:Date.now()+100000,captureGaps:4}});
 assert.equal(bridge.baseline(after.ls,after.id),null);
 const open=await scenario({options:{gapOpen:true}});
 assert.equal(bridge.baseline(open.ls,open.id),null);
 const nonzero=await scenario({odometer:'14.6'});
 assert.equal(bridge.baseline(nonzero.ls,nonzero.id),null);
 const normal=await scenario({odometer:'14.6',options:{unresolvedGap:false}});
 assert.equal(bridge.baseline(normal.ls,normal.id).value,14.6);
 const switched=await scenario({changeShift:true});
 assert.equal(switched.writes,0);
 const manual=await scenario({manualBase:true});
 assert.equal(bridge.baseline(manual.ls,manual.id).value,9);
 assert.equal(manual.writes,0);
 const manualPending=await scenario({manualPending:true});
 assert.equal(bridge.baseline(manualPending.ls,manualPending.id),null);
 console.log('PASS 出庫時刻分丸め、旧欠測・新欠測、通信中の欠測変化、遅延、手動入力・乗務切替保護');
})().catch(error=>{console.error(error);process.exitCode=1;});
