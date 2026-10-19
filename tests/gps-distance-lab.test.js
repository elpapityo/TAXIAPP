'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');

const html=fs.readFileSync('android-prototype/app/src/main/assets/distance-console.html','utf8');
const source=html.split('<script>')[1]?.split('</script>')[0];
assert.ok(source,'single embedded page must contain its own JS');
new Function(source);
const nodes=new Map();
function node(id) {
 if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',hidden:false,disabled:false,
  value:'',className:'',addEventListener(){},getAttribute(){return null;}});
 return nodes.get(id);
}
const local=new Map();
const window={
 DistanceNative:{requestCapture(){},startTracking(){},stopTracking(){},
  getStatus(){return JSON.stringify({running:false,ageMs:null,gaps:0,unresolvedGap:false});}}
};
const context={window,document:{getElementById:node},
 localStorage:{getItem(k){return local.get(k)||null;},setItem(k,v){local.set(k,v);}},
 setInterval(){},Date,Math,JSON,Number,String,Array,Object,RegExp,crypto:{getRandomValues(a){a.fill(7);return a;}},
 confirm(){return true;}};
vm.runInNewContext(source,context);
const {fresh,derive,goodKm}=window.DistanceLabTest;
let state=fresh();
state.startNative=70.25;
state.rows=[
 {gps:79.75,manual:'10',at:1111},
 {gps:81.75,manual:'15',at:2222},
 {gps:83.25,manual:'',at:3333}
];
const v=derive(state);
assert.deepEqual(Array.from(v,x=>x.gpsKm),[9.5,11.5,13]);
assert.deepEqual(Array.from(v,x=>x.legKm),[9.5,2,1.5]);
assert.deepEqual(Array.from(v,x=>x.autoKm),[9.5,12,16.5]);
assert.deepEqual(Array.from(v,x=>x.finalKm),[10,15,16.5]);
assert.equal(goodKm('1,250'),1.25);
state.rows[1].manual='';
state.rows[2].manual='';
const v2=derive(state);
assert.equal(v2[1].finalKm,12);
assert.equal(v2[2].finalKm,13.5);
state.rows[1].gps=null;
assert.equal(derive(state)[2].finalKm,null,'must not bridge an unknown GPS segment');
assert.ok(!/location\.href\s*=|window\.open\s*\(|taxiappgpsaudit:\/\/measure/.test(source),
 'GPS collection must not open an external browser');

const activity=fs.readFileSync('android-prototype/app/src/main/java/jp/taxiapp/gpsprototype/MainActivity.kt','utf8');
const manifest=fs.readFileSync('android-prototype/app/src/main/AndroidManifest.xml','utf8');
assert.match(activity,/loadDataWithBaseURL/);
assert.match(activity,/DistanceNative/);
assert.match(activity,/onNativeSnapshot/);
assert.match(activity,/requestCapture/);
assert.doesNotMatch(activity,/startActivity\s*\(\s*Intent\s*\(\s*Intent\.ACTION_VIEW/);
assert.doesNotMatch(activity,/gps-import-test\.html|taxiappgpsaudit:\/\//);
assert.doesNotMatch(activity,/http:\/\/|https:\/\/elpapityo/);
assert.doesNotMatch(manifest,/android\.permission\.INTERNET/);
assert.match(manifest,/android:scheme="taxiappgpslab"/);
assert.match(manifest,/android:label="GPS距離ラボ"/);
assert.match(activity,/settings\.allowFileAccess = false/);
console.log('GPS Distance Lab PASS: single local WebView, zero-relative cumulation, GPS legs, 10/15km corrections, no Chrome navigation');
