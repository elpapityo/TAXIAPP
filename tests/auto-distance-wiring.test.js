'use strict';
// The milestone hooks must be attached to the same native-GPS ON/OFF settings
// rather than the retired v0.3.57 implicit browser-GPS path.
const assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const ui=fs.readFileSync('gps-trip-ui.js','utf8');
const checks=[
 ['wait start', /beginWaiting\(shift,new Date\(\)\);gpsTripUI\?\.fillWaitDistance\(shift,w,'waitStart'\)/],
 ['wait address', /if\(duty\?\.waiting\?\.id===waitId&&nativeAutoDistanceEnabled\(\)\)/],
 ['wait native fallback', /fillNativeDistanceSilently\(duty,target,'odometer',true\)/],
 ['wait browser fallback', /fillWaitDistance\(duty,target,'waitLocation'\)/],
 ['dispatch address native', /fillNativeDistanceSilently\(currentDuty,target,when==='pickup'\?'F':'L'\)/],
 ['dispatch address browser', /fillLocationDistance\(currentDuty,target,when\)/],
 ['board ride', /gpsTripUI\?\.board\(shift,d\)/],
 ['board F and alight L', /\{G:'F',M:'L',R:'S',U:'V',AA:'AB',AD:'AE'\}/],
 ['time-linked native only with ON', /if\(gpsDistanceField&&nativeAutoDistanceEnabled\(\)\)/],
 ['native fill', /fillNativeDistanceSilently\(s,d,gpsDistanceField\)/],
 ['alight handling', /function requestDropLocation\(/],
 ['pickup location', /locationField\('AL',r,'乗車地・住所','gpsPickup'\)/],
 ['drop location', /locationField\('AM',r,'降車地・住所','gpsDrop'\)/],
 ['inline clock', /class="inline-time-field"/],
 ['manual protection', /String\(waiting\?record\.odometer\?\?'':record\.raw\?\.\[col\]\?\?''\)\.trim\(\)!==''/],
 ['auto disabled until source explicit', /NATIVE_AUTO_DISTANCE_PREF='taxiapp-production-auto-distance-v140'/]
];
for(const [name,pattern] of checks)assert.match(html,pattern,'Missing '+name);
for(const p of [/function fillDistance\(/,/function fillWaitDistance\(/,/fillDistance\(shift,record,'F','board'\)/,/fillDistance\(shift,record,'L','alight'\)/])
 assert.match(ui,p);
assert.doesNotMatch(html,/data-preview-simulator/);
console.log('PASS: time/location-triggered native/browser GPS distance hooks, OFF and manual-entry safety');
