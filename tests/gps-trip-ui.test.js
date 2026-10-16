'use strict';
// Run with: node tests/gps-trip-ui.test.js
// A browser-like stub permits deterministic position-watch lifecycle tests.
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.resolve(__dirname,'..');
const session={};
const callbacks=new Map(),errors=new Map(),cleared=[];
let watchCount=0;
const ctx={
  window:{isSecureContext:true},
  document:{visibilityState:'visible',getElementById:()=>null,activeElement:null},
  navigator:{geolocation:{
    watchPosition:(ok,err)=>{const id=++watchCount;callbacks.set(id,ok);errors.set(id,err);return id;},
    clearWatch:id=>cleared.push(id)
  }},
  console,Date,Math,Number,String,Array,Object,JSON,Set,Map
};
vm.runInNewContext(fs.readFileSync(path.join(dir,'gps-trip.js'),'utf8'),ctx,{filename:'gps-trip.js'});
vm.runInNewContext(fs.readFileSync(path.join(dir,'gps-trip-ui.js'),'utf8'),ctx,{filename:'gps-trip-ui.js'});
const shift={id:'unit-shift',startedIso:new Date().toISOString(),
  startingOdo:'0.0',endingOdo:'',records:[],draft:null};
const messages=[];
const pilot=ctx.window.TAXIAPP_GPS_UI({
  getShift:()=>shift,persist:()=>{},render:()=>{},toast:message=>messages.push(message),
  gpsMessage:error=>String(error),number:value=>Number(value),safeText:value=>String(value)
});
const p=(lat,speed=10)=>({
  coords:{latitude:lat,longitude:135,accuracy:5,speed},timestamp:Date.now()
});
const send=(id,lat,speed=10)=>{
  if(shift.gpsTrip.lastFix)shift.gpsTrip.lastFix.t-=10000;
  callbacks.get(id)(p(lat,speed));
};
pilot.start(shift);
const first=watchCount;
send(first,35);send(first,35.0009);
const original=shift.gpsTrip.tripKm;
assert.ok(Math.abs(original-.1)<.015);
pilot.stop(shift);
assert.ok(shift.gpsTrip.lastStopIso);
pilot.start(shift);
const second=watchCount;
assert.equal(shift.gpsTrip.unresolvedGap,true);
assert.equal(shift.gpsTrip.gapCount,1);
// Callbacks queued before clearWatch should never mutate current tracking.
callbacks.get(first)(p(37));
errors.get(first)({code:2,message:'stale error'});
assert.equal(shift.gpsTrip.lastFix,null);
assert.equal(shift.gpsTrip.gapCount,1);
send(second,35.0018);
send(second,35.0027);
assert.equal(pilot.trusted(shift),false); // gap must be corrected first
pilot.correct(shift,5.5,'車両トリップ照合');
send(second,35.0027);send(second,35.0036);
assert.ok(Math.abs(shift.gpsTrip.tripKm-5.6)<.015);
assert.equal(shift.gpsTrip.unresolvedGap,false);
// Hiding browser suspends the geolocation watch and flags distance as unknown.
ctx.document.visibilityState='hidden';pilot.hidden();
assert.equal(shift.gpsTrip.gapCount,2);
ctx.document.visibilityState='visible';pilot.hidden();
const third=watchCount;
assert.ok(third>second);
callbacks.get(second)(p(36));
assert.equal(shift.gpsTrip.lastFix,null);
assert.ok(cleared.includes(second));
pilot.stop(shift);
// Reject stationary GPS drift and sudden zero-velocity jumps.
const engine=ctx.window.TAXIAPP_GPS_TRIP;
const drift=engine.create(0),start=Date.now();
engine.resume(drift,start);
const pos=(lat,t,velocity)=>({coords:{
  latitude:lat,longitude:135,accuracy:5,speed:velocity},timestamp:t
});
engine.ingest(drift,pos(35,start,0),start);
const jitter=engine.ingest(drift,pos(35.00023,start+10000,0),start+10000);
assert.equal(jitter.deltaKm,0);
assert.equal(drift.tripKm,0);
const jumped=engine.ingest(drift,pos(35.001,start+20000,0),start+20000);
assert.equal(jumped.gap,true);
assert.equal(drift.unresolvedGap,true);
console.log('GPS UI lifecycle tests passed: pause/restart, stale callbacks, gaps and stationary jitter.');
