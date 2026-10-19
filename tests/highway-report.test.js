'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
require('../highway-report.js');
const report=globalThis.TAXIAPP_HIGHWAY_REPORT;
assert.ok(report);
const records=[
 {id:'one',kind:'ride',status:'complete',raw:{
   A:1,P:'実',Q:'吹田',R:'08:30',S:'12.0',T:'豊中',U:'08:42',V:'20.4',W:'680'}},
 {id:'two',kind:'ride',status:'complete',raw:{
   A:2,P:'実空',Q:'豊中',R:'09:00',S:'21',T:'西宮',U:'09:25',V:'34.1',W:'940',
   Z:'西宮',AA:'09:30',AB:'34.1',AC:'尼崎',AD:'09:50',AE:'46.5',AF:'520',AG:'100'}},
 {id:'three',kind:'empty',status:'complete',raw:{
   A:3,P:'空',Z:'尼崎',AA:'13:00',AB:'80',AC:'吹田',AD:'13:20',AE:'89.3',AF:'620'}},
 {id:'canceled',kind:'cancel',status:'complete',raw:{
   A:4,P:'実',Q:'excluded',S:1,V:100,W:999}},
 {id:'draft',kind:'ride',status:'draft',raw:{
   A:5,P:'実',Q:'unfinished',S:1,V:100,W:999}},
 {id:'missing',kind:'ride',status:'complete',raw:{
   A:6,P:'実',Q:'有馬口',T:'西宮北',S:'100.5',V:'',W:''}}
];
const shift={id:'test',records};
const original=JSON.stringify(shift);
const output=report.collect(shift);
assert.equal(output.count,5); // 1 + (real and empty for #2) + 1 + missing
assert.deepEqual(output.entries.map(e=>e.no+'-'+e.mode),['1-実','2-実','2-空','3-空','6-実']);
assert.deepEqual(output.entries.map(e=>[e.entryIC,e.exitIC]),[
 ['吹田','豊中'],['豊中','西宮'],['西宮','尼崎'],['尼崎','吹田'],['有馬口','西宮北']]);
assert.deepEqual(output.entries.filter(e=>!e.distanceMissing).map(e=>e.sectionKm),[8.4,13.1,12.4,9.3]);
assert.deepEqual(output.entries.filter(e=>!e.distanceMissing).map(e=>e.exemptKm),[6.3,9.825,9.3,6.975]);
assert.equal(output.real.count,3);
assert.equal(output.empty.count,2);
assert.equal(output.real.sectionKm,21.5);
assert.equal(output.empty.sectionKm,21.7);
assert.equal(output.sectionKm,43.2);
assert.equal(output.real.exemptKm,16.125);
assert.equal(output.empty.exemptKm,16.275);
assert.equal(output.exemptKm,32.4);
assert.equal(output.chargeYen,2860); // 680 + 940 + 520 + 100 + 620
assert.equal(output.unknownDistances,1);
assert.equal(output.unknownCharges,1);
assert.equal(output.entries[4].sectionKm,null);
assert.equal(output.entries[4].exemptKm,null);
assert.equal(output.entries[4].chargeYen,null);
assert.equal(JSON.stringify(shift),original,'read-only reporting must not mutate records');
const empty=report.collect({records:[]});
assert.equal(empty.count,0);assert.equal(empty.sectionKm,0);assert.equal(empty.exemptKm,0);
const malformed=report.collect({records:[{kind:'ride',status:'complete',raw:{A:8,P:'実',S:'19',V:'8'}}]});
assert.equal(malformed.unknownDistances,1);
assert.equal(malformed.sectionKm,0);
// Integration: retain six bottom nav items and entry buttons on history and operations.
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
assert.match(html,/highway-report\.js\?v=20261020-1/);
assert.match(html,/function renderHighwayReport\(\)/);
assert.match(html,/tab==='highway'\?renderHighwayReport\(\)/);
assert.match(html,/id="highwayShiftSelect"/);
assert.match(html,/data-tab="highway"/);
assert.match(html,/const labels=\{drive:\['🚕','乗務入力'\],live:\['◴','営業・集計'\],history:\['▤','営業履歴'\],print:/);
console.log('Highway register passed: each ride record, combined real/empty, IC route, totals, 75%, missing data, no mutation, HTML wiring.');
