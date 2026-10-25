'use strict';
/* 出庫時の任意の有効な距離で旧欠測が残るAndroid距離ラボの合成シミュレーション */
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const bridge=require('../gps-diary-bridge.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf("   if(nativeDiaryGpsEnabled()){",html.indexOf("}if(action==='startShift')"));
const end=html.indexOf("  model.shifts.unshift(",start);
assert.ok(start>0&&end>start,'出庫時GPS基準登録が見つかりません');
const script=html.slice(start,end);
function storage(){
 const m=new Map();return {getItem:key=>m.get(key)??null,setItem:(key,v)=>m.set(key,v)};
}
async function scenario({odometer='0',unresolvedGap=true,gapCount=3,elapsedSeconds=0,changeShift=false}={}){
 const localStorage=storage(),id='shift-100-test',now=Date.now();
 const shift={id,startedIso:new Date(now-elapsedSeconds*1000).toISOString(),startingOdo:odometer,endedAt:'',externalGpsSnapshot:null};
 const data={tripKm:105.5,runId:'new-session-1234567',unresolvedGap,gapCount,simulated:false};
 const notices=[];let writes=0;
 const b={...bridge,read:()=>Promise.resolve(data)};
 const ctx={nativeDiaryGpsEnabled:()=>true,newRecord:shift,odometer,localStorage,fetch:()=>{},
  canEditNow:()=>true,getShift:()=>changeShift?{...shift,id:'other-shift'}:shift,
  window:{TAXIAPP_EXTERNAL_GPS:b},saveLater:()=>writes++,updateElapsedTimer:()=>{},
  toast:(message,error)=>notices.push({message,error}),Date};
 vm.runInNewContext('(function(){'+script+'})()',ctx);
 await new Promise(done=>setImmediate(done));
 return {shift,id,localStorage,data,notices,writes};
}
(async()=>{
 const zero=await scenario({});
 assert.ok(zero.shift.externalGpsSnapshot,'初回GPS測位が登録されていません：'+JSON.stringify(zero.notices));
 assert.equal(zero.shift.externalGpsSnapshot.tripKm,0);
 assert.equal(bridge.baseline(zero.localStorage,zero.id).value,0);
 assert.equal(bridge.gapAcknowledged(zero.localStorage,zero.id,3),true);
 assert.equal(bridge.gapAcknowledged(zero.localStorage,zero.id,4),false,
  'NEW gaps after departure cannot be silently dismissed');
 assert.equal(bridge.calculated(107,bridge.baseline(zero.localStorage,zero.id),'new-session-1234567'),1.5);
 assert.equal(zero.writes,1);
 const normal=await scenario({unresolvedGap:false});
 assert.equal(normal.shift.externalGpsSnapshot.tripKm,0);
 assert.equal(bridge.gapAcknowledged(normal.localStorage,normal.id,3),false);
 const nonzero=await scenario({odometer:'30511'});
 assert.equal(nonzero.shift.externalGpsSnapshot.tripKm,30511);
 assert.equal(bridge.gapAcknowledged(nonzero.localStorage,nonzero.id,3),true,
  'the entered departure odometer is a valid anchor regardless of its value');
 const tenth=await scenario({odometer:'0.1'});
 assert.equal(tenth.shift.externalGpsSnapshot.tripKm,0.1);
 assert.equal(bridge.gapAcknowledged(tenth.localStorage,tenth.id,3),true);
 assert.equal(bridge.calculated(107,bridge.baseline(tenth.localStorage,tenth.id),'new-session-1234567'),1.6);
 assert.equal(bridge.gapAcknowledged(tenth.localStorage,tenth.id,4),false,
  'a later GPS gap must still block automatic readings');
 const delayed=await scenario({elapsedSeconds:11});
 assert.equal(delayed.shift.externalGpsSnapshot.tripKm,0);
 assert.equal(bridge.gapAcknowledged(delayed.localStorage,delayed.id,3),false,
  'late GPS sampling is not certified as a departure-only gap');
 const switched=await scenario({changeShift:true});
 assert.equal(switched.writes,0,'asynchronous GPS must not modify a different duty');
 assert.equal(bridge.baseline(switched.localStorage,switched.id),null);
 assert.match(script,/allowUnresolvedGap:true/);
 console.log('出庫時の0km・0.1km・任意距離の初回GPS基準・既存欠測の限定補正・新欠測拒否・乗務切替レース：合成テスト成功');
})().catch(error=>{console.error(error);process.exitCode=1;});
