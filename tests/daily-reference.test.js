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
// A legacy checked-in record with no dated end timestamp must not keep ticking.
const legacyClosed=daily.calculate({...shift,endedAt:'21:30',endingOdo:'110'}, {
 ...opts,now:new Date('2026-10-25T12:00:00+09:00')
});
assert.equal(legacyClosed.elapsedSeconds,null);
assert.equal(legacyClosed.remainingSeconds,null);
assert.equal(legacyClosed.distanceProjection!==null,true);
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
// Vehicle trip meter is not required to reset to zero between shifts.
// The 275 km daily base always applies to distance driven AFTER departure.
const continued={...shift,startingOdo:'260',endingOdo:'',records:[]};
const running=daily.calculate({...continued,records:[{kind:'ride',status:'complete',raw:{P:'',L:'270'}}]},opts);
eq(running.travelKm,10);
eq(running.capKm,275);
eq(running.remainingKm,265);
const returnTrip=daily.calculate({...continued,endedAt:'20:00',endedIso:new Date('2026-10-16T20:00:00+09:00').toISOString(),endingOdo:'540'},opts);
eq(returnTrip.travelKm,280);
eq(returnTrip.capKm,275);
eq(returnTrip.exceededKm,5);
const highwayTrip=daily.calculate({...continued,endedAt:'20:00',endedIso:new Date('2026-10-16T20:00:00+09:00').toISOString(),endingOdo:'540',records:[
 {kind:'ride',status:'complete',raw:{P:'実',Y:12.75}},
 {kind:'empty',status:'complete',raw:{P:'空',AK:6.25}}
]},opts);
eq(highwayTrip.capKm,294);
eq(highwayTrip.travelKm,280);
eq(highwayTrip.remainingKm,14);
const nextShift=daily.calculate({...continued,startingOdo:'540',endingOdo:'550',endedAt:'20:00',endedIso:new Date('2026-10-16T20:00:00+09:00').toISOString()},opts);
eq(nextShift.travelKm,10);
eq(nextShift.remainingKm,265);
console.log('Daily reference tests passed: 13h elapsed, return freeze, 275km+highway, estimates, unknown GPS.');
