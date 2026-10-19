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
  value:'',className:'',_listeners:{},
  addEventListener(name,handler){this._listeners[name]=handler;},getAttribute(){return null;}});
 return nodes.get(id);
}
const local=new Map();
const nativeCalls=[];
const window={
 DistanceNative:{requestCapture(nonce,target){nativeCalls.push({nonce,target});},
  getStatus(){return JSON.stringify({running:true,ageMs:1000,gaps:0,unresolvedGap:false,accuracyMeters:10});}}
};
const context={window,document:{getElementById:node},
 localStorage:{getItem(k){return local.get(k)||null;},setItem(k,v){local.set(k,v);}},
 setInterval(){},Date,Math,JSON,Number,String,Array,Object,RegExp,crypto:{getRandomValues(a){a.fill(7);return a;}},
 confirm(){return true;}};
window.crypto=context.crypto;
vm.runInNewContext(source,context);
// Browser UI must not duplicate native GPS start/stop controls.
assert.doesNotMatch(html,/id="native-start"|id="native-stop"/);
assert.match(html,/id="start-feedback"/);
assert.match(html,/基準点未記録/);
assert.match(html,/GPS距離ラボ アプリを開く|GPS計測アプリを開く/);
// Regression for actual reported bug: pressing 0km must complete or show an error
// beside the button (never fail silently at the bottom of the page).
const btn=node('start-btn');
const clickStart=btn._listeners?.click;
assert.equal(typeof clickStart,'function');
clickStart();
assert.equal(nativeCalls.length,1);
assert.equal(nativeCalls[0].target,'start');
assert.match(node('start-feedback').textContent,/GPS基準点を確認/);
window.DistanceLab.onNativeError(nativeCalls[0].nonce,'GPS未受信');
assert.equal(node('start-detail').textContent,'基準点未記録');
assert.match(node('start-feedback').textContent,/GPS未受信/);
clickStart();
assert.equal(nativeCalls.length,2);
const now=Date.now();
window.DistanceLab.onNativeSnapshot(JSON.stringify({
 format:'GPS_DISTANCE_LAB_V1',nonce:nativeCalls[1].nonce,target:'start',
 capturedAt:now,tripKm:88.25,gpsAgeMs:3000,running:true,unresolvedGap:false
}));
assert.match(node('start-detail').textContent,/基準点を 0.000 km に設定済み/);
assert.match(node('start-feedback').textContent,/記録が完了/);
assert.equal(JSON.parse(local.get('gps-distance-lab-console-v1')).startNative,88.25);
// Captures remain on one screen; with prior missing GPS allowed after retry.

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
const webActivity=fs.readFileSync('android-prototype/app/src/main/java/jp/taxiapp/gpsprototype/GpsTestWebActivity.kt','utf8');
const gpsStore=fs.readFileSync('android-prototype/app/src/main/java/jp/taxiapp/gpsprototype/GpsStore.kt','utf8');
const service=fs.readFileSync('android-prototype/app/src/main/java/jp/taxiapp/gpsprototype/GpsTrackingService.kt','utf8');
const manifest=fs.readFileSync('android-prototype/app/src/main/AndroidManifest.xml','utf8');
assert.match(activity,/GpsTestWebActivity::class.java/);
assert.doesNotMatch(activity,/DistanceNative|loadDataWithBaseURL/);
assert.match(webActivity,/loadDataWithBaseURL/);
assert.match(webActivity,/DistanceNative/);
assert.match(webActivity,/onNativeSnapshot/);
assert.match(webActivity,/requestCapture/);
assert.match(webActivity,/postDelayed\(this,750L\)/);
assert.match(webActivity,/GPSを30秒間取得できませんでした/);
assert.match(webActivity,/lastValidGpsFixAt/);
assert.match(gpsStore,/fun lastValidGpsFixAt/);
assert.match(gpsStore,/fun clearValidFix/);
assert.match(service,/GpsStore.noteValidFix/);
assert.match(service,/GpsStore.clearValidFix/);
assert.doesNotMatch(activity,/startActivity\s*\(\s*Intent\s*\(\s*Intent\.ACTION_VIEW/);
assert.doesNotMatch(webActivity,/gps-import-test\.html|taxiappgpsaudit:\/\//);
assert.doesNotMatch(activity,/http:\/\/|https:\/\/elpapityo/);
assert.doesNotMatch(manifest,/android\.permission\.INTERNET/);
assert.match(manifest,/android:scheme="taxiappgpslabv060"/);
assert.match(manifest,/android:name=".GpsTestWebActivity"/);
assert.doesNotMatch(activity,/車両トリップ累計の補正|ここを 0 km として記録/);
assert.match(manifest,/android:label="GPS距離ラボ 計測"/);
assert.match(webActivity,/settings\.allowFileAccess=false/);
console.log('GPS Distance Lab v0.6 PASS: zero GPS retry and visible errors, native monitor separate from Web corrections, single WebView, no Chrome navigation');
