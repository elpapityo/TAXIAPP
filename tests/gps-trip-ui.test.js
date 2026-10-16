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
// Pressing the location button fills both coordinates (app controller) and
// trusted trip distance (this controller), without overwriting manual input.
shift.gpsTrip=engine.create(0);
pilot.start(shift);
send(watchCount,35,0);
assert.equal(pilot.trusted(shift),true);
shift.gpsTrip.tripKm=3.4;
const ride={id:'gps-ride',kind:'ride',raw:{F:'',L:''},meta:{}};
assert.equal(pilot.fillLocationDistance(shift,ride,'pickup'),true);
assert.equal(ride.raw.F,'3.4');
assert.equal(ride.meta.gpsFilledFields.F.source,'location');
shift.gpsTrip.tripKm=4.6;
assert.equal(pilot.fillLocationDistance(shift,ride,'drop'),true);
assert.equal(ride.raw.L,'4.6');
// On subsequent location requests, GPS-filled numbers may be refreshed.
shift.gpsTrip.tripKm=5.1;
assert.equal(pilot.fillLocationDistance(shift,ride,'drop'),true);
assert.equal(ride.raw.L,'5.1');
// Once corrected by a human, GPS may no longer silently replace the value.
ride.raw.F='12.5';
assert.equal(pilot.fillLocationDistance(shift,ride,'pickup'),false);
assert.equal(ride.raw.F,'12.5');
ride.raw.L='9.9';
assert.equal(pilot.fillLocationDistance(shift,ride,'drop'),false);
assert.equal(ride.raw.L,'9.9');
// An already-complete record opened for edit is also protected.
ride.editId='historic-ride';
ride.raw.F='';
assert.equal(pilot.fillLocationDistance(shift,ride,'pickup'),false);
// Dispatch address capture has a matching pickup-side odometer field.
const dispatch={kind:'dispatch',raw:{F:''},meta:{}};
assert.equal(pilot.fillLocationDistance(shift,dispatch,'pickup'),true);
assert.equal(dispatch.raw.F,'5.1');
pilot.stop(shift);
assert.equal(pilot.fillLocationDistance(shift,{kind:'ride',raw:{F:''}},'pickup'),false);

// Every operational milestone captures a cumulative GPS trip when trusted.
shift.gpsTrip=engine.create(0);pilot.start(shift);
send(watchCount,35,0);
shift.gpsTrip.tripKm=6.1;
const waiting={odometer:'',gpsAutoOdometer:null};
assert.equal(pilot.fillWaitDistance(shift,waiting,'waitStart'),true);
assert.equal(waiting.odometer,'6.1');
// A second GPS fix may advance only the auto-captured waiting distance.
shift.waiting=waiting;shift.gpsTrip.tripKm=6.2;
send(watchCount,35,0);
assert.equal(waiting.odometer,'6.2');
waiting.odometer='10.5';shift.gpsTrip.tripKm=6.3;
send(watchCount,35,0);
assert.equal(waiting.odometer,'10.5');
assert.equal(pilot.fillWaitDistance(shift,waiting,'waitLocation'),false);
// A dispatch that has manually entered a value must not be overwritten on boarding.
shift.waiting=null;
const dispatchManual={kind:'dispatch',raw:{F:'12.8'},meta:{}};
shift.draft=dispatchManual;
shift.gpsTrip.tripKm=6.4;
send(watchCount,35,0);
assert.equal(dispatchManual.raw.F,'12.8');
dispatchManual.kind='ride';
pilot.board(shift,dispatchManual);
assert.equal(dispatchManual.raw.F,'12.8');
// Fresh GPS after board mode transition; test highway IN/OUT and alight.
send(watchCount,35,0);
assert.equal(pilot.trusted(shift),true);
const highway={kind:'ride',raw:{S:'',V:'',AB:'',AE:''},meta:{}};
shift.gpsTrip.tripKm=7.1;
assert.equal(pilot.fillDistance(shift,highway,'S','highwayIn'),true);
assert.equal(highway.raw.S,'7.1');
shift.gpsTrip.tripKm=8.2;
assert.equal(pilot.fillDistance(shift,highway,'V','highwayOut'),true);
assert.equal(highway.raw.V,'8.2');
shift.gpsTrip.tripKm=9.3;
assert.equal(pilot.fillDistance(shift,highway,'AB','emptyHighwayIn'),true);
assert.equal(highway.raw.AB,'9.3');
shift.gpsTrip.tripKm=10.4;
assert.equal(pilot.fillDistance(shift,highway,'AE','emptyHighwayOut'),true);
assert.equal(highway.raw.AE,'10.4');
highway.raw.AE='42.0';shift.gpsTrip.tripKm=10.9;
assert.equal(pilot.fillDistance(shift,highway,'AE','repeatedTimeTap'),false);
assert.equal(highway.raw.AE,'42.0');
// The alight button records L before switching real->empty mode.
const alight={kind:'ride',raw:{F:'7.0',L:''},meta:{gpsDistance:{boardRealKm:0}}};
pilot.alight(shift,alight);
assert.equal(alight.raw.L,'10.9');
assert.equal(shift.gpsTrip.mode,'empty');
// A subsequent fresh GPS fix cannot clobber corrected L.
send(watchCount,35,0);
alight.raw.L='11.7';shift.gpsTrip.tripKm=11.1;
assert.equal(pilot.fillDistance(shift,alight,'L','repeatedAlight'),false);
assert.equal(alight.raw.L,'11.7');
// Untrusted GPS never writes a plausible-looking number.
engine.miss(shift.gpsTrip,'lost signal');
assert.equal(pilot.fillDistance(shift,highway,'S','highwayIn'),false);
assert.equal(pilot.fillWaitDistance(shift,{odometer:''}),false);
pilot.stop(shift);
// Regression: a driver's 10.0km pickup-odometer must not be left behind the
// browser's 3.0km undercount, even if the last input 'change' event was missed.
shift.gpsTrip=engine.create(0);
pilot.start(shift);
send(watchCount,35,0);
shift.gpsTrip.tripKm=3.0;
const driverPickup={kind:'ride',id:'driver-pickup',raw:{F:'10.0',L:''},meta:{}};
pilot.board(shift,driverPickup);
assert.equal(shift.gpsTrip.tripKm,10.0);
assert.equal(shift.gpsTrip.mode,'real');
assert.equal(driverPickup.meta.gpsDistance.boardTripKm,10.0);
assert.equal(driverPickup.raw.F,'10.0');
// Entering a historical highway entrance reading after boarding must not
// rewind the current trip from 10 km down to 6 km.
pilot.atInputDistance(shift,'S','6.0','過去の高速入口');
assert.equal(shift.gpsTrip.tripKm,10.0);
pilot.atInputDistance(shift,'V','10.2','現在の高速出口');
assert.equal(shift.gpsTrip.tripKm,10.2);
// The fresh GPS fixes must add distance on top of the corrected baseline.
send(watchCount,35.0030,10);
send(watchCount,35.0039,10);
assert.ok(shift.gpsTrip.tripKm>10.25);
pilot.alight(shift,driverPickup);
assert.ok(Number(driverPickup.raw.L)>=Number(driverPickup.raw.F));
assert.equal(shift.gpsTrip.mode,'empty');
// An explicit GPS correction button can still decrease a previously inflated
// GPS total; only incidental field changes are protected from rewinding it.
pilot.correct(shift,8.0,'明示的な車両トリップ補正');
assert.equal(shift.gpsTrip.tripKm,8.0);
pilot.stop(shift);

console.log('GPS UI lifecycle tests passed: pause/restart, stale callbacks, gaps, stationary jitter location distance, waiting, highway and alight protection.');
