'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const B=require('../gps-bridge-test.js');
const metricList=['tripKm','realKm','emptyKm','lastRideKm'];
const nonce='0123456789abcdef0123456789abcdef';
const now=1792281000000;
for(const m of metricList){
 const req=B.createRequest(m,nonce,now);
 assert.equal(req.pending.metric,m);
 assert.match(req.uri,/^taxiappgpsv034:\/\/measure\?/);
 const reply={format:B.FORMAT,nonce,metric:m,capturedAt:now+3000,
  tripKm:12.34567,realKm:4.12345,emptyKm:8.22222,lastRideKm:3.99991,
  gapCount:2,unresolvedGap:true,running:true,gpsAgeMs:5000,accuracyMeters:15,rideCount:3,mode:'REAL',address:'兵庫県伊丹市北本町',locationAt:now+2000};
 const validated=B.validateResponse(reply,req.pending,now+3500);
 assert.equal(validated.metric,m);
 assert.equal(validated.place,'兵庫県伊丹市北本町');
 assert.equal(validated.locationAt,now+2000);
 assert.equal(validated.km,Math.round(reply[m]*1000)/1000);
 assert.ok(validated.warnings.length>0);
 assert.equal(B.decodeFragment(B.hashPrefix+encodeURIComponent(JSON.stringify(reply))).nonce,nonce);
 assert.throws(()=>B.validateResponse({...reply,nonce:'0'.repeat(32)},req.pending,now+3500),/別の取得操作/);
 assert.throws(()=>B.validateResponse(reply,{...req.pending,metric:m==='emptyKm'?'tripKm':'emptyKm'},now+3500),/別の取得操作/);
 assert.throws(()=>B.validateResponse(reply,req.pending,now+121000),/有効時間/);
 assert.throws(()=>B.validateResponse({...reply,tripKm:NaN},req.pending,now+3500),/GPS距離/);
 assert.throws(()=>B.validateResponse({...reply,tripKm:-5},req.pending,now+3500),/GPS距離/);
 assert.throws(()=>B.validateResponse({...reply,tripKm:10001},req.pending,now+3500),/GPS距離/);
}
assert.throws(()=>B.createRequest('routeKm',nonce),/不正/);
assert.throws(()=>B.createRequest('tripKm','xyz'),/取得番号/);
assert.equal(B.decodeFragment('#other=abc'),null);
assert.throws(()=>B.decodeFragment(B.hashPrefix+'%ZZ'),/応答を読み取れません/);
assert.throws(()=>B.decodeFragment(B.hashPrefix+'x'.repeat(6000)),/長すぎ/);
const oldAppText=[
 'TAXIAPP GPS距離測定試験',
 'GPS累計 12.345 km','実車GPS累計 4.100 km','空車GPS累計 8.245 km',
 '計測中の実車 0.000 km','直前の実車 2.000 km',
 '降車完了 3回','GPS欠測 1回','未解決欠測 あり','GPS受信 15秒前','状態 実車'
].join('\n');
const copied=B.parseCopiedReport(oldAppText,'tripKm',now);
assert.equal(copied.km,12.345);
assert.equal(B.parseCopiedReport(oldAppText,'lastRideKm').km,2);
assert.equal(copied.realKm,4.1);
assert.equal(copied.emptyKm,8.245);
assert.equal(copied.gapCount,1);
assert.equal(copied.gpsAgeMs,15000);
assert.ok(copied.warnings.some(x=>x.includes('未解決')));
assert.throws(()=>B.parseCopiedReport('fake text','tripKm'),/コピー結果ではありません/);
assert.throws(()=>B.parseCopiedReport(oldAppText.replace('直前の実車 2.000 km','直前の実車 未計測'),'lastRideKm'),/未測定/);
assert.match(B.createRequest('tripKm',nonce).uri,/^taxiappgpsv034:\/\/measure\?/);
const html=fs.readFileSync('gps-import-test.html','utf8');
assert.match(html,/id="rows"/);
assert.match(html,/id="pasteTarget"/);
assert.match(html,/data-gps/);
assert.match(html,/GPS距離・住所・時間/);
assert.match(html,/location\.href=req\.uri/);
assert.match(html,/history\.replaceState/);
assert.match(html,/sessionStorage/);
assert.match(html,/位置座標/); // no coordinates should be handled in the test UI
assert.match(html,/HANDOFF_MS=120000/);
assert.match(html,/localStorage\.removeItem\(HANDOFF_KEY\)/);
assert.doesNotMatch(html,/(?:indexedDB|fetch\(|firebase|collection\(|syncPut)/i);
for(const [,code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(code);
console.log('GPS browser bridge tests passed: four metrics, nonce, freshness, invalid values, clipboard fallback and isolated test UI.');
