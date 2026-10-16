'use strict';
// Integration guard: each user milestone must retain its GPS distance hook.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'..','gps-trip-ui.js'),'utf8');
const checks=[
 ['wait start distance', /beginWaiting\(shift,new Date\(\)\);gpsTripUI\?\.fillWaitDistance\(shift,w,'waitStart'\)/],
 ['wait address distance', /fillWaitDistance\(duty,target,'waitLocation'\)/],
 ['dispatch arrival distance via address', /fillLocationDistance\(currentDuty,target,when\)/],
 ['dispatch board distance', /boardDispatch\(shift,new Date\(\)\);gpsTripUI\?\.board\(shift,d\)/],
 ['ride board distance', /gpsTripUI\?\.board\(shift,d\)/],
 ['highway and board/alight timestamp mapping', /\{G:'F',M:'L',R:'S',U:'V',AA:'AB',AD:'AE'\}/],
 ['highway manual timestamp change', /fillDistance\(s,s\.draft,paired,'timeChange:'\+col\)/],
 ['alight button', /gpsTripUI\?\.alight\(shift,d\);requestDropLocation\(shift,d\)/],
 ['alight address request', /function requestDropLocation\(/],
 ['pickup coordinates and distance', /locationField\('AL',r,'乗車地・住所','gpsPickup'\)/],
 ['drop coordinates and distance', /locationField\('AM',r,'降車地・住所','gpsDrop'\)/],
 ['location time icon inline', /class="inline-time-field"/],
];
for(const [label,pattern] of checks)assert.match(html,pattern,'Missing '+label);
assert.match(ui,/function fillDistance\(/);
assert.match(ui,/function fillWaitDistance\(/);
assert.match(ui,/fillDistance\(shift,record,'F','board'\)/);
assert.match(ui,/fillDistance\(shift,record,'L','alight'\)/);
assert.match(ui,/if\(current&&\(!prior\|\|String\(prior\.km\)!==current\)\)return false/);
console.log('Milestone wiring tests passed: wait, dispatch, board, highway, alight, icon and manual protection.');
