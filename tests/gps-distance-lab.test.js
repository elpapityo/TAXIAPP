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
const loopback=fs.readFileSync('android-prototype/app/src/main/java/jp/taxiapp/gpsprototype/GpsLoopbackServer.kt','utf8');
const bridge=fs.readFileSync('android-prototype/app/src/main/assets/gps-external-bridge.js','utf8');
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
assert.match(html,/外部ブラウザ/);
assert.match(html,/connect-src 'self'/);
assert.doesNotMatch(html,/taxiappgpslabv060:\/\/open/);
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
assert.equal(JSON.parse(local.get('gps-distance-lab-browser-v080')).startNative,88.25);
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
const service=fs.readFileSync('android-prototype/app/src/main/java/jp/taxiapp/gpsprototype/GpsTrackingService.kt','utf8');
const manifest=fs.readFileSync('android-prototype/app/src/main/AndroidManifest.xml','utf8');
const gpsStore=fs.readFileSync('android-prototype/app/src/main/java/jp/taxiapp/gpsprototype/GpsStore.kt','utf8');
assert.match(activity,/Intent\(Intent\.ACTION_VIEW,Uri\.parse\(GpsLoopbackServer\.URL\)\)/);
assert.match(activity,/外部ブラウザで距離テストを開く/);
assert.doesNotMatch(activity,/GpsTestWebActivity|WebView|addJavascriptInterface|onNativeSnapshot/);
assert.match(service,/GpsLoopbackServer\(applicationContext\)/);
assert.match(service,/loopback\?\.stop/);
assert.match(service,/GpsStore.noteValidFix/);
assert.match(gpsStore,/fun lastValidGpsFixAt/);
assert.match(loopback,/ServerSocket\(PORT,8,InetAddress\.getByName\("127\.0\.0\.1"\)\)/);
assert.match(loopback,/host!="127\.0\.0\.1:48764"/);
assert.match(loopback,/route=="\/api\/status"/);
assert.match(loopback,/route\.startsWith\("\/api\/capture\?"\)/);
assert.match(loopback,/GpsStore\.lastValidGpsFixAt/);
assert.doesNotMatch(loopback,/Access-Control-Allow-Origin:\s*\*/);
assert.match(bridge,/location\.hostname!=='127\.0\.0\.1'/);
assert.match(bridge,/location\.port!=='48764'/);
assert.match(loopback,/GpsTrackingService.ACTION_REFRESH/);
assert.match(service,/ACTION_REFRESH/);
assert.match(service,/requestFreshFix\(\)/);
assert.match(service,/manager.getCurrentLocation\(LocationManager.GPS_PROVIDER/);
assert.match(service,/LocationManager.GPS_PROVIDER, 2000L, 0f/);
assert.match(bridge,/window.DistanceLab.onNativePending/);
assert.match(html,/class="capture-feedback"/);
assert.match(bridge,/fetch\('\/api\/status'/);
assert.match(bridge,/fetch\(uri/);
assert.doesNotMatch(bridge,/location\.href\s*=|window\.open\s*\(|taxiappgpslab/);
assert.match(manifest,/android\.permission\.INTERNET/);
assert.match(manifest,/android:usesCleartextTraffic="true"/);
assert.doesNotMatch(manifest,/GpsTestWebActivity/);
assert.match(manifest,/android:label="GPS距離ラボ v0.8"/);
assert.match(manifest,/android:scheme="taxiappgpslabv060"/);
console.log('PASS: external browser loopback 127.0.0.1:48764, on-demand GPS refresh, same-tab capture, zero basis, no embedded WebView');

(async function(){
 const response=[];
 let pendingCount=0, count=0;
 const w={DistanceLab:{
  onNativeSnapshot(json){response.push({type:'ok',payload:JSON.parse(json)});},
  onNativePending(nonce,message){pendingCount++;},
  onNativeError(nonce,message){response.push({type:'error',nonce,message});}
 }};
 const ctx={
  window:w,location:{hostname:'127.0.0.1',port:'48764'},
  setInterval(){},setTimeout(f){setImmediate(f);},
  fetch(path){
   count++;
   if(path==='/api/status')return Promise.resolve({ok:true,json:()=>Promise.resolve({running:true,ageMs:200,gaps:0})});
   if(path.startsWith('/api/capture?'))return Promise.resolve({ok:true,json:()=>Promise.resolve(
    count<3?{ready:false,message:'GPS再測位中（有効GPS 26秒前）'}:{
    ready:true,snapshot:{format:'GPS_DISTANCE_LAB_V1',nonce:'a'.repeat(32),target:'start',tripKm:19.5,
     capturedAt:Date.now(),gpsAgeMs:200,running:true,unresolvedGap:false}
   })});
   throw Error('unexpected path: '+path);
  },
  Promise,JSON,Date,encodeURIComponent
 };
 vm.runInNewContext(bridge,ctx);
 assert.equal(typeof w.DistanceNative.requestCapture,'function');
 w.DistanceNative.requestCapture('a'.repeat(32),'start');
 for(let i=0;i<30&&response.length===0;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(response.length,1);
 assert.equal(pendingCount,1);
 assert.equal(response[0].type,'ok');
 assert.equal(response[0].payload.tripKm,19.5);
 assert.ok(count>=2,'status and capture both queried same-origin');
 console.log('PASS: external-browser JavaScript bridge consumes native GPS through fetch, without a new tab');
})().catch(err=>{console.error(err);process.exitCode=1;});
