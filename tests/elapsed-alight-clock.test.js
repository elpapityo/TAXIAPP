'use strict';
const assert=require('node:assert/strict');
process.env.TZ='Asia/Tokyo';
require('../elapsed-alight-clock.js');
const clock=globalThis.TAXIAPP_ALIGHT_CLOCK;
const iso=v=>new Date(v).toISOString();
const shift={startedIso:iso('2026-10-15T20:00:00+09:00'),records:[]};
let v=clock.reference(shift,new Date('2026-10-15T21:30:00+09:00'));
assert.deepEqual(v,{seconds:5400,hasAlight:false});
const first={kind:'ride',status:'complete',raw:{M:'23:58'},meta:{
 boardedIso:iso('2026-10-15T23:15:00+09:00'),
 settledIso:iso('2026-10-16T00:04:00+09:00'),
 alightIso:iso('2026-10-15T23:58:12+09:00')
}};
shift.records.push(first);
v=clock.reference(shift,new Date('2026-10-16T00:08:12+09:00'));
assert.equal(v.seconds,600);
assert.equal(v.hasAlight,true);
// Legacy data missing alightIso still resolves from local clock and settlement date.
first.meta.alightIso='';
v=clock.reference(shift,new Date('2026-10-16T00:08:00+09:00'));
assert.equal(v.seconds,600);
// Manual correction: old alightIso no longer matches the corrected M.
first.raw.M='23:55';
first.meta.alightIso=iso('2026-10-15T23:58:12+09:00');
v=clock.reference(shift,new Date('2026-10-16T00:08:00+09:00'));
assert.equal(v.seconds,780);
first.raw.M='23:58';
// The next ride's alight time is from an unsaved draft, before settlement.
shift.draft={kind:'ride',status:'alighted',raw:{M:'00:23'},meta:{
 createdAt:iso('2026-10-16T00:11:00+09:00'),
 boardedIso:iso('2026-10-16T00:12:00+09:00'),
 alightIso:iso('2026-10-16T00:23:20+09:00')
}};
v=clock.reference(shift,new Date('2026-10-16T00:24:20+09:00'));
assert.equal(v.seconds,60);
// Historic record currently opened for edit must not reset the elapsed clock.
shift.draft.editId='old-record';
v=clock.reference(shift,new Date('2026-10-16T00:24:20+09:00'));
assert.equal(v.seconds,1580); // 23:58:00 to 00:24:20 (legacy)
delete shift.draft;
// A second completed ride after midnight supersedes the previous ride.
shift.records.push({kind:'ride',status:'complete',raw:{M:'00:35'},meta:{
 createdAt:iso('2026-10-16T00:28:00+09:00'),
 boardedIso:iso('2026-10-16T00:28:00+09:00'),
 settledIso:iso('2026-10-16T00:40:00+09:00')
}});
v=clock.reference(shift,new Date('2026-10-16T00:45:00+09:00'));
assert.equal(v.seconds,600);
assert.equal(clock.rideAlightMs({raw:{M:'25:77'},meta:{}},Date.parse(shift.startedIso),Date.now()),null);
console.log('Alighting clock tests passed: overnight, settled/manual, draft, history edit and live seconds.');
