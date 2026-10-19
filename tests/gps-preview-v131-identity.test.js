'use strict';
const assert=require('node:assert/strict');
const gps=require('../gps-preview/v0359/gps-diary-bridge.js');
const PREFIX='taxiapp-preview-v0359-simulator-optin';
const store=new Map();
const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))};
const good={marker:'GPS_DISTANCE_LAB_DIARY_V1_3_1_100',packageId:'jp.taxiapp.gpsprototype.distancelabv131',webVersion:'1.3.1',running:true,simulated:true,runId:'v131-native-run-A',tripKm:0.25,ageMs:1000,accuracyMeters:8,gaps:0,unresolvedGap:false};
let calls=[];
const makeFetch=(state, snapshot) => async url=>{
  calls.push(url);
  if(url==='http://127.0.0.1:48768/api/status')return {ok:true,json:async()=>state};
  if(url.startsWith('http://127.0.0.1:48768/api/capture?')) {
    const nonce=new URL(url).searchParams.get('nonce');
    return {ok:true,json:async()=>({ready:true,snapshot:{...good, ...snapshot,format:'GPS_DISTANCE_LAB_V1',nonce,target:'start',running:true,capturedAt:Date.now(),gpsAgeMs:500}})};
  }
  // Production v1.4 is tried first; a transport failure allows legacy v1.3.1 fallback.
  if(url.startsWith('http://127.0.0.1:48769/'))throw new TypeError('v1.4 unavailable');
  throw Error('unexpected endpoint '+url);
};
(async()=>{
 calls=[];
 await assert.rejects(gps.read(storage,makeFetch({...good,marker:'GPS_DISTANCE_LAB_DIARY_V1_3'}),{shiftId:'demo'}),/識別情報/);
 assert.equal(calls.length,2,'legacy status rejected before capture');
 calls=[];
 await assert.rejects(gps.read(storage,makeFetch({...good,packageId:'jp.taxiapp.gpsprototype.distancelabv122'}),{shiftId:'demo'}),/識別情報/);
 assert.equal(calls.length,2);
 await assert.rejects(gps.read(storage,makeFetch(good),{shiftId:'demo'}),/模擬GPS/);
 store.set(PREFIX,'on');
 calls=[];
 await assert.rejects(gps.read(storage,makeFetch(good,{marker:'GPS_DISTANCE_LAB_DIARY_V1_3'}),{shiftId:'demo'}),/不正/);
 const prod={...good,marker:'GPS_DISTANCE_LAB_DIARY_V1_4_0_100',
   packageId:'jp.taxiapp.gpsprototype.distancelabv140',webVersion:'1.4.0',
   runId:'native-v140-safe-run',simulated:false};
 const makeProductionFetch=async url=>{
  if(url==='http://127.0.0.1:48769/api/status')return {ok:true,json:async()=>prod};
  if(url.startsWith('http://127.0.0.1:48769/api/capture?')){
   const n=new URL(url).searchParams.get('nonce');
   return {ok:true,json:async()=>({ready:true,snapshot:{...prod,format:'GPS_DISTANCE_LAB_V1',
     nonce:n,target:'start',capturedAt:Date.now(),gpsAgeMs:500}})};
  }
  throw Error('must never query old port when new app is reachable: '+url);
 };
 const prodRead=await gps.read(storage,makeProductionFetch,{shiftId:'prod'});
 assert.equal(prodRead.gpsSource,'v1.4.0');
 assert.equal(prodRead.simulated,false);
 assert.equal(gps.endpoint,'http://127.0.0.1:48769/');
 const wrongPortStatus=async url=>({ok:true,json:async()=>({...prod,marker:good.marker,packageId:good.packageId,webVersion:good.webVersion})});
 await assert.rejects(gps.read(storage,wrongPortStatus,{shiftId:'prod'}),/識別情報/);
 // Production also rejects simulated checkpoints; only isolated preview's opt-in can allow them.
 store.delete(PREFIX);
 await assert.rejects(gps.read(storage,async url=>{
   const data={...prod,simulated:true};
   return {ok:true,json:async()=>data};
 },{shiftId:'prod'}),/模擬GPS/);
 store.set(PREFIX,'on');
 const got=await gps.read(storage,makeFetch(good),{shiftId:'demo'});
 assert.equal(got.tripKm,0.25);
 assert.equal(got.simulated,true);
 gps.ensureStart(storage,'demo',0.25,0,got.runId);
 assert.equal(gps.calculated(0.4,gps.baseline(storage,'demo'),got.runId),0.15);
 gps.recordManual(storage,'demo',0.4,0.6,got.runId);
 assert.equal(gps.calculated(0.55,gps.baseline(storage,'demo'),got.runId),0.75);
 assert.throws(()=>gps.calculated(0.6,gps.baseline(storage,'demo'),'restarted-v131-run'),/再起動/);
 calls=[];
 await assert.rejects(gps.read(storage,makeFetch({...good,gaps:1,unresolvedGap:true},{unresolvedGap:true}),{shiftId:'demo'}),/GPS欠測/);
 assert.equal([...store.keys()].some(x=>x.includes('v0358')||x==='taxiapp-v1'),false);
 console.log('PASS v1.3.1 identity / 48768 port / old APK refusal / opt-in simulation / manual rebase / GPS restart & gap safety');
})().catch(e=>{console.error(e);process.exitCode=1});
