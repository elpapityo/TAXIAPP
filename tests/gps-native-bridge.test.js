'use strict';
const assert=require('node:assert/strict');
const B=require('../gps-native-bridge.js');
const values=new Map();
const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
const KEY='0123456789abcdef0123456789abcdef';
storage.setItem('taxiapp-gps-local-test-key-v1',KEY);
const sample={format:'TAXIAPP_GPS_LOOPBACK_V1',tripKm:12.345,running:true,gpsAgeMs:2000,unresolvedGap:false,gapCount:0};
const mockFetch=(overrides={},status=200)=>async(url,opts)=>{
 assert.equal(url,'http://127.0.0.1:18765/gps');
 assert.equal(opts.headers['X-GPS-Test-Key'],KEY);
 assert.equal(opts.cache,'no-store');
 return {ok:status>=200&&status<300,status,json:async()=>({...sample,...overrides})};
};
async function main(){
 assert.equal(B.calculated(10,null),10);
 assert.equal(B.calculated(15,null),15);
 const base=B.recordManual(storage,'shift-A',40,'50');
 assert.equal(B.calculated(60,B.baseline(storage,'shift-A')),70);
 assert.equal(B.calculated(75,B.baseline(storage,'shift-A')),85);
 assert.equal(B.calculated(40,B.baseline(storage,'shift-B')),40);
 assert.throws(()=>B.calculated(30,base),/リセット/);
 const reset=B.recordManual(storage,'shift-A',60,'0');
 assert.equal(B.calculated(65,reset),5);
 assert.equal(B.baseline(storage,'shift-B'),null);
 assert.throws(()=>B.recordManual(storage,'shift-A',65,''),/不正/);
 const data=await B.read(storage,mockFetch());
 assert.equal(data.tripKm,12.345);
 for(const [name,value] of [
  ['stopped',{running:false}],
  ['stale',{gpsAgeMs:30001}],
  ['unresolved',{unresolvedGap:true}],
  ['negative',{tripKm:-2}],
  ['format',{format:'bad'}],
 ]){
  await assert.rejects(B.read(storage,mockFetch(value)),undefined,name);
 }
 await assert.rejects(B.read(storage,mockFetch({},403)),/HTTP 403/);
 const empty={getItem:()=>null};
 await assert.rejects(B.read(empty,mockFetch()),/未登録/);
 console.log('GPS network responses, security key, correction and shift isolation: PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1});
