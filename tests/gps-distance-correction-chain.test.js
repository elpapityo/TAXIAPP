'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../gps-test-rows.js');
const A=require('../gps-segment-audit.js');

test('Web GPS cumulative starts at zero regardless of native app raw trip baseline',()=>{
 let s=R.startGps(R.fresh(),87.650);
 let d=R.derive(s);
 assert.equal(d.startGpsKm,87.65);assert.equal(d.startKm,0);
 s=R.captureRow(s,0,97.000);
 d=R.derive(s);
 assert.equal(d.rows[0].gpsFromStartKm,9.35);
 assert.equal(d.rows[0].deltaKm,9.35);
 assert.equal(d.rows[0].finalKm,9.35);
});

test('Manual 10 at row 1, manual 15 at row 2, repeated automatic GPS segment correction',()=>{
 let s=R.startGps(R.fresh(),87.650);
 s=R.captureRow(s,0,97);
 s=R.setManualKm(s,0,10);
 s=R.setManualKm(s,1,15); // entered before the second GPS tap
 s=R.captureRow(s,1,99.5);
 let d=R.derive(s);
 assert.equal(d.rows[0].finalKm,10);
 assert.equal(d.rows[1].gpsFromStartKm,11.85);
 assert.equal(d.rows[1].deltaKm,2.5);
 assert.equal(d.rows[1].measuredKm,12.5); // 10 + 2.5
 assert.equal(d.rows[1].manualKm,15); // must survive the GPS tap
 assert.equal(d.rows[1].finalKm,15);
 s=R.appendRow(s);
 s=R.captureRow(s,2,100.3);
 d=R.derive(s);
 assert.equal(d.rows[2].gpsFromStartKm,12.65);
 assert.equal(d.rows[2].deltaKm,0.8);
 assert.equal(d.rows[2].measuredKm,15.8); // second manual 15 + 0.8
 assert.equal(d.rows[2].finalKm,15.8);
});

test('Later manual correction becomes new base without modifying GPS actual increments',()=>{
 let s=R.startGps(R.fresh(),1);
 s=R.captureRow(s,0,10);
 s=R.setManualKm(s,0,10);
 s=R.captureRow(s,1,12);
 s=R.appendRow(s);
 s=R.captureRow(s,2,15);
 assert.equal(R.derive(s).rows[2].finalKm,15);
 s=R.setManualKm(s,1,15);
 let d=R.derive(s);
 assert.equal(d.rows[1].measuredKm,12);
 assert.equal(d.rows[2].finalKm,18);
 assert.equal(d.rows[2].deltaKm,3);
 assert.equal(d.rows[2].gpsFromStartKm,14);
});

test('Compare actual vehicle legs only when cumulative readings exist at both ends',()=>{
 let s=R.startGps(R.fresh(),87.65);
 s=R.captureRow(s,0,97);
 s=R.setManualKm(s,0,10);
 s=R.captureRow(s,1,99.5);
 s=R.setManualKm(s,1,15);
 s=R.appendRow(s);
 s=R.captureRow(s,2,100.3);
 const legs=A.compareFromCumulative(R.derive(s));
 assert.equal(legs[0].vehicleKm,10);
 assert.equal(legs[0].gpsKm,9.35);
 assert.equal(legs[0].differenceMeters,650);
 assert.equal(legs[1].vehicleKm,5);
 assert.equal(legs[1].gpsKm,2.5);
 assert.equal(legs[1].differenceMeters,2500);
 assert.equal(legs[2].vehicleKm,null);
 assert.equal(legs[2].differenceMeters,null);
});
test('Broken GPS counter does not silently become cumulative distance',()=>{
 let s=R.startGps(R.fresh(),10);
 s=R.captureRow(s,0,11);
 assert.throws(()=>R.captureRow(s,1,9),/小さく/);
});
