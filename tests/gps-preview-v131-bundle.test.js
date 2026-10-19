'use strict';
const assert=require('node:assert/strict');
const bundle=require('../gps-preview/v0359/gps-bundle.js');
const targets={dispatch:['F',null],pickup:['F','G'],drop:['L','M'],
realEntry:['S','R'],realExit:['V','U'],emptyEntry:['AB','AA'],emptyExit:['AE','AD'],
waiting:[undefined,undefined]};
for(const [key,[distance,time]] of Object.entries(targets)){
 const target=bundle.definition(key);
 assert.equal(target.distance,distance,key+' distance');
 assert.equal(target.time,time===null?undefined:time,key+' time');
}
assert.equal(bundle.definition('__proto__'),null);
const now=Date.now();
const gps={format:'TAXIAPP_GPS_DIARY_V131',tripKm:10.154,capturedAt:now,simulated:true};
const position={coords:{latitude:34.6991,longitude:135.2002,accuracy:8},timestamp:now};
assert.equal(bundle.validate(gps,position,now).simulated,true);
assert.equal(bundle.validate({...gps,simulated:false},position,now).simulated,false);
assert.throws(()=>bundle.validate({...gps,capturedAt:now-16000},position,now),/時刻/);
assert.throws(()=>bundle.validate(gps,{...position,timestamp:now-9000},now),/時刻/);
assert.throws(()=>bundle.validate(gps,{...position,coords:{...position.coords,accuracy:150}},now),/位置情報/);
assert.throws(()=>bundle.validate({...gps,format:'WRONG'},position,now),/Android GPS/);
(async()=>{
 const p=await bundle.positionOnce({getCurrentPosition:ok=>ok(position)});
 assert.equal(p.coords.latitude,34.6991);
 await assert.rejects(bundle.positionOnce(null),/Chrome/);
 console.log('PASS bundled time/distance/device location: targets, age, skew, precision, simulated separation');
})().catch(e=>{console.error(e);process.exitCode=1});
