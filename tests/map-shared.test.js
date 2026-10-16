'use strict';
// Run: node tests/map-shared.test.js
const assert=require('node:assert/strict');
require('../map-shared.js');
const m=globalThis.TAXIAPP_MAP_SHARED;
assert.ok(m);
assert.equal(m.DB_NAME,'taxiapp-store-v1');
assert.equal(m.STORE,'state');
assert.equal(m.KEY,'taxiapp');
assert.equal(m.FALLBACK_KEY,'taxiapp-v1');
assert.equal(m.chooseLayout('side'),'side');
assert.equal(m.chooseLayout('stack'),'stack');
assert.equal(m.chooseLayout('input'),'input');
assert.equal(m.chooseLayout('map'),'map');
assert.equal(m.chooseLayout('side','map'),'side'); // manual layout never overridden
assert.equal(m.chooseLayout('wrong','map'),'map');
assert.equal(m.chooseLayout(null,'wrong'),'stack');
assert.deepEqual(m.LAYOUTS,['side','stack','input','map']);
assert.equal(m.point('35.0001,135.1234').lat,35.0001);
assert.equal(m.point({latitude:35.2,longitude:135.4}).lng,135.4);
assert.equal(m.point('invalid'),null);
assert.equal(m.point('91,135'),null);
assert.equal(m.point('35,200'),null);
assert.equal(m.point(null),null);
const ride={
 id:'ride-1',kind:'ride',status:'complete',
 raw:{A:1,D:'35.124,135.456',H:'35.200,135.550',AL:'乗車A',AM:'降車B'},
 meta:{pickupGeo:{lat:35.1,lng:135.1,accuracy:8,recordedAt:'2026-10-16T00:00:00Z'},
       dropGeo:{lat:35.3,lng:135.3}}
};
const cancelled={id:'cancel-2',kind:'cancel',status:'complete',
 raw:{A:2,D:'35.6,135.7',H:'35.7,135.8',AL:'迎車予定地',AM:'表示しない'},meta:{}};
const shift={id:'shift-1',date:'2026-10-16',startedAt:'07:30',endedAt:'',
  records:[ride,cancelled],waiting:{geo:{lat:35.4,lng:135.4},place:'待機地点'}};
const pins=m.getPins(shift);
assert.equal(pins.length,4); // ride pickup/drop + cancelled pickup + waiting
assert.equal(pins[0].lat,35.1); // metadata coordinates take precedence over RAW
assert.equal(pins[1].lng,135.3);
assert.equal(pins[2].kind,'pickup');
assert.equal(pins[3].kind,'waiting');
assert.equal(pins.filter(x=>x.kind==='drop').length,1); // cancel has NO drop
assert.equal(m.validState({version:1,shifts:[shift]}),true);
assert.equal(m.validState({version:2,shifts:[]}),false);
assert.equal(m.selectShift({version:1,activeId:'shift-1',shifts:[shift]},null).id,'shift-1');
assert.equal(m.selectShift({version:1,activeId:'missing',shifts:[shift]},'shift-1').id,'shift-1');
assert.equal(m.selectShift({version:1,shifts:[]}),null);
assert.equal(m.currentFix({gpsTrip:{lastFix:{lat:35.5,lng:135.5,t:100000},lastSeenMs:100000}},140000).lat,35.5);
assert.equal(m.currentFix({gpsTrip:{lastFix:{lat:35.5,lng:135.5,t:100000}}},170001),null);
assert.equal(m.currentFix({gpsTrip:{lastFix:{lat:35.5,lng:135.5,t:100000}}},90000),null);
assert.equal(m.mapsUrl({lat:35.5,lng:135.5},true).startsWith('https://www.google.com/maps/dir/?api=1&destination='),true);
assert.equal(m.mapsUrl({lat:35.5,lng:135.5},false).startsWith('https://www.google.com/maps/search/?api=1&query='),true);
assert.equal(m.mapsUrl(null,true),null);
console.log('map-shared tests passed: shared storage keys, layouts, geometry, shift selection, maps URLs.');
