'use strict';
// Run: node tests/gps-trip.test.js
// Pure GPS trip-meter regression tests: no GPS permission / internet needed.
const assert=require('node:assert/strict');
require('../gps-trip.js');
const gps=globalThis.TAXIAPP_GPS_TRIP;
const t=Date.parse('2026-10-16T00:00:00.000Z');
const p=(lat,at,accuracy=5,speed=9)=>({
  coords:{latitude:lat,longitude:135,accuracy,speed},timestamp:at
});
const approx=(value,expected)=>assert.ok(Math.abs(value-expected)<0.015,
  'expected '+expected+', got '+value);

// Starts at zero and accurately accumulates short distances.
const state=gps.create(0);
gps.resume(state,t);
assert.equal(gps.ingest(state,p(35,t),t).deltaKm,0);
gps.ingest(state,p(35.0009,t+10000),t+10000);
approx(state.tripKm,.1);
approx(state.emptyKm,.1);

// Manual correction never carries forward the earlier error.
const before=state.tripKm;
const correction=gps.correct(state,5.5,'車両トリップ',t+11000);
assert.equal(correction.beforeKm,before);
assert.equal(correction.afterKm,5.5);
assert.equal(state.corrections.length,1);
assert.equal(gps.ingest(state,p(35.0009,t+20000),t+20000).deltaKm,0);
gps.ingest(state,p(35.0018,t+30000),t+30000);
approx(state.tripKm,5.6);

// Ride and empty remain independent; boundary does not invent distance.
gps.mode(state,'real',t+32000);
assert.equal(gps.ingest(state,p(35.0018,t+34000),t+34000).deltaKm,0);
gps.ingest(state,p(35.0027,t+44000),t+44000);
approx(state.realKm,.1);
approx(state.emptyKm,.2);

// A gap cannot be bridged by a straight-line guess.
const prior=state.tripKm;
const missing=gps.ingest(state,p(35.0050,t+120000),t+120000);
assert.equal(missing.gap,true);
assert.equal(state.tripKm,prior);
assert.equal(state.unresolvedGap,true);
assert.equal(gps.ingest(state,p(35.0050,t+121000),t+121000).deltaKm,0);
assert.equal(state.unresolvedGap,true);
gps.correct(state,6.1,'画面消灯後の車両トリップ照合',t+122000);
assert.equal(state.unresolvedGap,false);

// Reject poor GPS accuracy, impossible speeds and outdated fixes.
const coarse=gps.ingest(state,p(35.0051,t+123000,150),t+123000);
assert.equal(coarse.accepted,false);
assert.equal(state.unresolvedGap,true);
gps.correct(state,6.2,'再補正',t+124000);
const old=gps.ingest(state,p(35.0051,t+80000),t+125000);
assert.equal(old.accepted,false);
assert.equal(state.tripKm,6.2);

// Continuous, valid fixes while waiting must not be mistaken for a dropout
// simply because the distance anchor remains at the same coordinates.
for (const velocity of [0,null]) {
  const waiting=gps.create(0);
  gps.resume(waiting,t);
  for (const seconds of [0,15,30,45,61,120,180]) {
    const at=t+seconds*1000;
    const result=gps.ingest(waiting,p(35,at,5,velocity),at);
    assert.equal(result.accepted,true,'stationary fix at '+seconds+' sec');
    assert.equal(result.gap,undefined,'no false gap at '+seconds+' sec');
    assert.equal(waiting.unresolvedGap,false);
    assert.equal(waiting.tripKm,0);
  }
  // Driving away after a long, well-observed stop still counts movement.
  const resumed=gps.ingest(waiting,p(35.0009,t+190000,5,9),t+190000);
  assert.equal(resumed.accepted,true);
  approx(waiting.tripKm,.1);
  // No callbacks at all for 80 seconds remains a genuine measurement gap.
  const lost=gps.ingest(waiting,p(35.0050,t+270000,5,9),t+270000);
  assert.equal(lost.gap,true);
  approx(waiting.tripKm,.1);
  assert.equal(waiting.unresolvedGap,true);
}

// A kilometre-sized coordinate jump directly after valid stationary samples
// is not a measured journey, even if the taxi waited for several minutes.
const jumpCheck=gps.create(0);
gps.resume(jumpCheck,t);
for (const seconds of [0,15,30,45,61,120,180]) {
  const at=t+seconds*1000;
  gps.ingest(jumpCheck,p(35,at,5,0),at);
}
const implausible=gps.ingest(jumpCheck,p(35.01,t+190000,5,9),t+190000);
assert.equal(implausible.gap,true);
assert.equal(jumpCheck.tripKm,0);

console.log('GPS trip tests passed: calibration, mode, gaps, stationary fixes, jump rejection, accuracy, stale points.');
