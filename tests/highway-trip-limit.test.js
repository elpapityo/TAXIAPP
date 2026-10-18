'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
require('../daily-reference.js');
require('../highway-report.js');
const daily=globalThis.TAXIAPP_DAILY_REFERENCE, highway=globalThis.TAXIAPP_HIGHWAY_REPORT;
const records=[
 {id:'r1',kind:'ride',status:'complete',raw:{A:'1',P:'実',S:'280',V:'290',Y:7.5}},
 {id:'r2',kind:'empty',status:'complete',raw:{A:'2',P:'空',AB:'350',AE:'360',AK:7.5}}
];
const start='2026-10-16T07:00:00+09:00',end='2026-10-16T20:00:00+09:00';
const shift={startedIso:new Date(start).toISOString(),endedIso:new Date(end).toISOString(),endedAt:'20:00',startingOdo:'260',endingOdo:'540',records};
const actual=highway.collect(shift,r=>r.raw), d=daily.calculate(shift,{deriveRaw:r=>r.raw});
assert.equal(actual.count,2);
assert.equal(actual.sectionKm,20);
assert.equal(actual.exemptKm,15);
assert.equal(d.exemptKm,15);
assert.equal(d.capKm,290);
assert.equal(d.travelKm,280);
assert.equal(d.remainingKm,10);
const noRoad=daily.calculate({...shift,records:[]},{deriveRaw:r=>r.raw});
assert.equal(noRoad.capKm,275);
assert.equal(noRoad.exceededKm,5);
const reset=daily.calculate({...shift,endingOdo:'17'},{deriveRaw:r=>r.raw});
assert.equal(reset.travelKm,null);
assert.equal(reset.remainingKm,null);
assert.match(reset.distanceSource,/リセット/);
const html=fs.readFileSync('index.html','utf8');
assert.match(html,/number\(selected\.endingOdo\)-number\(selected\.startingOdo\)/);
assert.match(html,/275\+report\.exemptKm/);
assert.match(html,/data-duty-distance-left/);
assert.match(html,/ref\.remainingKm/);
assert.match(html,/report\.unknownDistances>0/);
console.log('Trip continuation, highway report and remaining-distance UI: PASS');
