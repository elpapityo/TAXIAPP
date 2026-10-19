const assert=require('node:assert/strict');
const fs=require('node:fs');
const bridge=require('../gps-diary-bridge.js');
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v))};};
const runId='e'.repeat(32);
const sample=(km,simulated=false,unresolvedGap=false)=>({
 running:true,runId,tripKm:km,simulated,simSpeedKmh:simulated?40:0,
 ageMs:200,accuracyMeters:4,gaps:unresolvedGap?2:0,unresolvedGap
});
const response=o=>({ok:true,json:async()=>o});
async function check(){
 const saved=storage(),seen=[];
 const get=(km=1.25,simulated=false,unresolvedGap=false)=>{
   return async(u,opts)=>{
     seen.push(u);
     if(u.endsWith('/api/status'))return response(sample(km,simulated,unresolvedGap));
     if(u.includes('/api/capture?')){
       const url=new URL(u),nonce=url.searchParams.get('nonce');
       assert.match(nonce,/^[a-f0-9]{32}$/);
       assert.equal(url.searchParams.get('target'),'start');
       return response({ready:true,snapshot:{
         format:'GPS_DISTANCE_LAB_V1',nonce,target:'start',tripKm:km,
         runId,simulated,gpsAgeMs:200,capturedAt:Date.now(),running:true,
         unresolvedGap}});
     }
     throw Error('Unexpected GET '+u);
   };
 };
 const data=await bridge.read(saved,get(12.15),{shiftId:'shift-one'});
 assert.equal(data.tripKm,12.15);
 assert.equal(data.runId,runId);
 assert.equal(data.simulated,false);
 const base=bridge.ensureStart(saved,'shift-one',data.tripKm,'0',data.runId);
 assert.equal(bridge.calculated(12.45,base,runId),0.3);
 // User reads real 0.35km on vehicle despite GPS +0.3km: rebase.
 const corrected=bridge.recordManual(saved,'shift-one',12.45,'0.350',runId);
 assert.equal(bridge.calculated(12.75,corrected,runId),0.65);
 assert.equal(bridge.baseline(saved,'shift-one').value,0.35);
 assert.equal(bridge.baseline(saved,'shift-other'),null);
 assert.throws(()=>bridge.calculated(12.75,corrected,'different-run-id'),/再起動/);
 assert.throws(()=>bridge.ensureStart(saved,'shift-one',13,0,'new-run-id'),/再起動/);
 assert.throws(()=>bridge.calculated(12.0,corrected,runId),/減少/);
 await assert.rejects(bridge.read(saved,get(12.5,true),{shiftId:'shift-one'}),/模擬GPS/);
 // In a dedicated *test* page only, simulation can be explicitly allowed.
 const sim=await bridge.read(saved,get(12.5,true),{shiftId:'test',allowSimulation:true});
 assert.equal(sim.simulated,true);
 await assert.rejects(bridge.read(saved,get(12.5,false,true),{shiftId:'shift-one'}),/欠測/);
 bridge.acknowledgeGap(saved,'shift-one',2);
 assert.equal((await bridge.read(saved,get(12.5,false,true),{shiftId:'shift-one'})).gapCount,2);
 assert.ok(seen.every(x=>x.startsWith('http://127.0.0.1:48767/')));
 // Inspect live-app wiring without modifying any of its sales formulae.
 const ui=fs.readFileSync('index.html','utf8');
 assert.match(ui,/<script src="\.\/gps-diary-bridge\.js\?v=20261019-1"/);
 assert.match(ui,/\['F','L','S','V','AB','AE'\]\.includes\(key\)/);
 for(const action of ['gpsWaitOdo','gpsShiftEndOdo','gpsShiftRebase'])
   assert.ok(ui.includes(action),'missing diary UI '+action);
 assert.match(ui,/calculated\(data\.tripKm,base,data\.runId\)/);
 assert.match(ui,/recordManual\(localStorage,shiftId,data\.tripKm,manualValue,data\.runId\)/);
 assert.match(ui,/ensureStart\(localStorage,departingId,data\.tripKm,odometer,data\.runId\)/);
 assert.match(ui,/if\(!canEditNow\(\)\)return/);
 const server=fs.readFileSync('android-prototype/app/src/main/java/jp/taxiapp/gpsprototype/GpsLoopbackServer.kt','utf8');
 assert.match(server,/origin!="https:\/\/elpapityo\.github\.io"/);
 assert.match(server,/Access-Control-Allow-Private-Network: true/);
 assert.match(server,/Access-Control-Allow-Origin: https:\/\/elpapityo\.github\.io/);
 assert.match(server,/if\(method=="OPTIONS"\)/);
 assert.doesNotMatch(server,/Access-Control-Allow-Origin: \*/);
 assert.match(server,/127\.0\.0\.1:48769/);
 console.log('PASS diary: native GPS capture, shift-specific baseline, manual correction, subsequent accumulation, runId reset refusal, simulation rejection, gap acknowledgment, HTTPS origin CORS and 9 distance input groups');
}
check().catch(e=>{console.error(e);process.exitCode=1;});
