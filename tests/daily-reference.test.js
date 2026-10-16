'use strict';
// Run: node tests/daily-reference.test.js
const assert=require('node:assert/strict');
require('../daily-reference.js');
const daily=globalThis.TAXIAPP_DAILY_REFERENCE;
const begun=new Date('2026-10-16T07:00:00+09:00').toISOString();
const now=new Date('2026-10-16T12:00:00+09:00');
const eq=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,
  'expected '+expected+', received '+actual);
const records=[
 {kind:'ride',status:'complete',raw:{P:'実',Y:12.75,L:'24.3'}},
 {kind:'empty',status:'complete',raw:{P:'空',AK:6.25}},
 {kind:'cancel',status:'complete',raw:{P:'実',Y:200}} // Never count cancel as highway exemption
];
const shift={startedIso:begun,startingOdo:'0',endingOdo:'',records};
const opts={now,meter:6400,rides:1,deriveRaw:row=>row.raw};
const r=daily.calculate(shift,opts);
assert.equal(daily.SHIFT_SECONDS,46800);
assert.equal(daily.BASE_KM,275);
assert.equal(r.elapsedSeconds,18000);
assert.equal(r.remainingSeconds,28800);
assert.equal(r.exceededSeconds,0);
eq(r.exemptRealKm,12.75);eq(r.exemptEmptyKm,6.25);eq(r.exemptKm,19);
eq(r.capKm,294);
eq(r.travelKm,24.3);
eq(r.remainingKm,269.7);
eq(r.timeProjection,16640);
eq(r.distanceProjection,6400/24.3*294,.02);
const done=daily.calculate({...shift,endedAt:'21:30',endedIso:new Date('2026-10-16T21:30:00+09:00').toISOString(),
 endingOdo:'110'}, {...opts,now:new Date('2026-10-25T12:00:00+09:00')});
assert.equal(done.elapsedSeconds,52200);
assert.equal(done.remainingSeconds,0);
assert.equal(done.exceededSeconds,5400);
eq(done.travelKm,110);
const unknown=daily.calculate({...shift,startingOdo:'',records:[]},opts);
assert.equal(unknown.travelKm,null);
assert.equal(unknown.distanceProjection,null);
const gap=daily.calculate({...shift,gpsTrip:{enabled:true,unresolvedGap:true}},opts);
assert.equal(gap.travelKm,null);
assert.equal(gap.distanceProjection,null);
assert.ok(gap.distanceSource.includes('GPS未計測区間あり'));
const afterMidnight=daily.calculate({...shift,startedIso:new Date('2026-10-16T20:00:00+09:00').toISOString()},
 {...opts,now:new Date('2026-10-17T01:00:00+09:00')});
assert.equal(afterMidnight.elapsedSeconds,18000);
const freshGps=daily.calculate({...shift,gpsTrip:{enabled:true,tripKm:6.3,lastFix:{lat:35,lng:135},
 lastSeenMs:now.getTime(),status:'tracking',unresolvedGap:false}},opts);
eq(freshGps.travelKm,6.3);
assert.equal(freshGps.capKm,294);
console.log('Daily reference tests passed: 13h elapsed, return freeze, 275km+highway, estimates, unknown GPS.');
