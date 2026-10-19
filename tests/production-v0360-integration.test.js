'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync('index.html','utf8');
const gps=require('../gps-diary-bridge.js');
const highway=require('../highway-sections.js');
require('../highway-report.js');
assert.match(html,/<title>TAXIAPP v0\.3\.60 — 乗務日報<\/title>/);
assert.match(html,/const DB_NAME='taxiapp-store-v1';const STORE='state';const KEY='taxiapp';/);
assert.match(html,/localStorage\.getItem\('taxiapp-v1'\)/);
assert.match(html,/localStorage\.setItem\('taxiapp-v1'/);
assert.match(html,/deviceMode='pending'/);
assert.match(html,/accountSettingsAuto=window\.TAXIAPP_ACCOUNT_AUTO\.create/);
assert.match(html,/accountSettingsAuto\.start\(\)/);
assert.match(html,/canSync:\(\)=>canEditNow\(\)/);
assert.match(html,/canView:\(\)=>deviceMode==='viewer'&&Boolean\(accountSettingsAuto\?\.status\(\)\.enabled\)/);
assert.match(html,/function googlePostRequest\(action,fields=\{\}\)\{\s*if\(!canEditNow\(\)/);
assert.match(html,/function scheduleGoogleSync\(\)\{\s*if\(!canEditNow\(\)/);
assert.match(html,/function googleShiftPacket\(shift\)/);
assert.match(html,/const item=\{\.\.\.record,raw:deriveRaw\(record,shift\.settings\)\}/);
assert.match(html,/gps-diary-bridge\.js\?v=20261020-1/);
assert.match(html,/highway-sections\.js\?v=20261020-1/);
assert.match(html,/highway-report\.js\?v=20261020-1/);
assert.match(html,/NATIVE_AUTO_DISTANCE_PREF='taxiapp-production-auto-distance-v140'/);
assert.match(html,/NATIVE_DIARY_GPS_PREF='taxiapp-production-native-gps-v140'/);
for(const pattern of [/gps-preview-ribbon/,/data-preview-simulator/,/PREVIEW_SIMULATED_GPS_PREF/,
 /GPS試験版ではGoogleへの/,/canSync:\(\)=>false/,/deviceMode='writer',deviceNoticeAt/,
 /taxiapp-gps-preview-v0359-store/,/noindex,nofollow/])
 assert.doesNotMatch(html,pattern,'preview isolation must not ship to production');
assert.match(html,/if\(!nativeDiaryGpsEnabled\(\)&&nativeAutoDistanceEnabled\(\)\)gpsTripUI\?\.alight/);
for(const [,source] of html.matchAll(/<script src="([^"]+)"/g)){
 const local=source.split('?')[0];assert.ok(fs.existsSync(path.resolve(local)), 'missing dependency '+local);
}
for(const [,script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
 if(script.trim())new Function(script);
}
const data=new Map(), storage={
 getItem:k=>data.get(k)??null,
 setItem:(k,v)=>data.set(k,String(v)),
 removeItem:k=>data.delete(k)
};
const run='production-run-12345678';
const legacy={marker:'GPS_DISTANCE_LAB_DIARY_V1_3_1_100',
 packageId:'jp.taxiapp.gpsprototype.distancelabv131',webVersion:'1.3.1',
 running:true,simulated:false,runId:run,gaps:0,gpsAgeMs:500,unresolvedGap:false};
const current={...legacy,marker:'GPS_DISTANCE_LAB_DIARY_V1_4_0_100',
 packageId:'jp.taxiapp.gpsprototype.distancelabv140',webVersion:'1.4.0'};
function mockFetch(gpsState,snapshot,failCurrent=false){
 return async url=>{
  const nativeV14=url.startsWith('http://127.0.0.1:48769/');
  if(nativeV14&&failCurrent)throw new TypeError('v1.4 app unavailable');
  const v= gpsState;
  if(url.endsWith('/api/status'))return {ok:true,json:async()=>v};
  if(url.includes('/api/capture?'))return {ok:true,json:async()=>({
   ready:true,snapshot:{...v,...snapshot,format:'GPS_DISTANCE_LAB_V1',
      nonce:new URL(url).searchParams.get('nonce'),target:'start',
      tripKm:snapshot?.tripKm??12.345,capturedAt:Date.now(),gpsAgeMs:500}
  })};
  throw Error('unexpected '+url);
 };
}
(async()=>{
 data.set('taxiapp-preview-v0359-simulator-optin','on'); // Must NEVER permit in production.
 await assert.rejects(gps.read(storage,mockFetch({...current,simulated:true}),{shiftId:'one',allowSimulation:true}),/模擬GPS/);
 await assert.rejects(gps.read(storage,mockFetch(current,{simulated:true}),{shiftId:'one',allowSimulation:true}),/模擬GPS/);
 const capture=await gps.read(storage,mockFetch(current),{shiftId:'one'});
 assert.equal(capture.gpsSource,'v1.4.0');assert.equal(capture.simulated,false);
 const old=await gps.read(storage,mockFetch(legacy,null,true),{shiftId:'one'});
 assert.equal(old.gpsSource,'v1.3.1');
 const base=gps.ensureStart(storage,'one',12.345,15.0,run);
 assert.equal(base.value,15);
 assert.equal(gps.calculated(12.845,base,run),15.5);
 gps.recordManual(storage,'one',12.845,20.0,run);
 assert.equal(gps.calculated(13.345,gps.baseline(storage,'one'),run),20.5);
 assert.throws(()=>gps.calculated(13.5,gps.baseline(storage,'one'),'another-run'),/再起動/);
 assert.equal(gps.baseline(storage,'another-duty'),null);
 assert.equal([...data.keys()].filter(k=>k.startsWith('taxiapp-v1')).length,0);
 const segments=[{mode:'実',entryIC:'吹田',entryKm:'10.0',exitIC:'西宮',exitKm:'20.2',fee:'500'},
 {mode:'実',entryIC:'西宮北',entryKm:'21.0',exitIC:'宝塚',exitKm:'26.0',fee:'600'}];
 const record={kind:'ride',status:'complete',raw:{P:'実',W:'500'},meta:{highwaySections:segments}};
 const projected=highway.project(record.raw,segments);
 assert.equal(projected.W,'1100');
 assert.equal(projected.X,'15.2');
 assert.equal(projected.Y,'11.4');
 assert.equal(highway.project(projected,segments).W,'1100');
 const summary=globalThis.TAXIAPP_HIGHWAY_REPORT.collect({records:[record]});
 assert.equal(summary.count,2);assert.equal(summary.chargeYen,1100);
 assert.equal(summary.exemptKm,11.4);
 console.log('PASS production v0.3.60: existing database/login/cloud, original HTML syntax, GPS identity/run protection, hard simulator deny, toll detail');
})().catch(e=>{console.error(e);process.exitCode=1});
