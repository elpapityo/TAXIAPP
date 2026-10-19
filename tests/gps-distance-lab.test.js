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
 capturedAt:now,tripKm:88.25,runId:'native-run-A',gpsAgeMs:3000,running:true,unresolvedGap:false
}));
assert.match(node('start-detail').textContent,/基準点を 0.000 km に設定済み/);
assert.match(node('start-feedback').textContent,/記録が完了/);
assert.equal(JSON.parse(local.get('gps-distance-lab-browser-diary-v131')).startNative,88.25);
// Captures remain on one screen; with prior missing GPS allowed after retry.

// Reproduce 2026-10-19 real screenshot: "取得済み" button, but GPS all
// em dashes and "記録時刻：未取得" after a missing preceding checkpoint.
// Do not delete the stored GPS value or manual correction during recovery.
const missingHistory=fresh => ({
  startNative:1.372,startAt:1792381200000,
  rows:[
   {gps:null,manual:'',at:null},
   {gps:1.572,manual:'200',at:null},
   {gps:1.672,manual:'300',at:1792381220000},
   {gps:1.772,manual:'',at:null}
  ]
});
const stored=missingHistory();
const recover=window.DistanceLabTest.derive(stored);
assert.equal(recover[0].finalKm,null,'never invent a missing first checkpoint');
assert.equal(recover[1].gpsKm,0.2,'later GPS cumulative stays visible');
assert.equal(recover[1].legKm,0.2,'gap from last known native baseline is explicit');
assert.equal(recover[1].finalKm,200,'manual input preserved, not silently dropped');
assert.equal(recover[1].confirmed,false,'GPS time missing is unverified');
assert.match(recover[1].error,/記録時刻がありません/);
assert.equal(recover[2].gpsKm,0.3,'following readings do not become invisible');
assert.equal(recover[2].legKm,0.1);
assert.equal(recover[2].confirmed,true);
assert.equal(recover[3].confirmed,false,'timestamp missing is retryable');
assert.equal(stored.rows[1].manual,'200');
assert.equal(stored.rows[2].manual,'300');
const previewLocal=new Map([['gps-distance-lab-browser-diary-v131',JSON.stringify(stored)]]);
const previewNodes=new Map();
function previewNode(id){
 if(!previewNodes.has(id))previewNodes.set(id,{
  textContent:'',innerHTML:'',hidden:false,disabled:false,value:'',className:'',
  addEventListener(){},getAttribute(){return null;}
 });
 return previewNodes.get(id);
}
const previewWin={DistanceNative:{getStatus(){return JSON.stringify({
  running:true,ageMs:1000,accuracyMeters:8,gaps:0,unresolvedGap:false
 });},requestCapture(){}}};
previewWin.crypto=context.crypto;
vm.runInNewContext(source,{window:previewWin,document:{getElementById:previewNode},
  localStorage:{getItem(k){return previewLocal.get(k)||null;},setItem(k,v){previewLocal.set(k,v);}},
  setInterval(){},Date,Math,JSON,Number,String,Array,Object,RegExp,crypto:context.crypto,confirm(){return true;}
});
const uiRows=previewNode('rows').innerHTML;
assert.match(uiRows,/保存済みGPS内部累計：1\.572 km（未確認）/);
assert.match(uiRows,/GPS累計<\/label><strong>0\.200<\/strong>/);
assert.match(uiRows,/GPS区間<\/label><strong>0\.200<\/strong>/);
assert.match(uiRows,/再取得/);
assert.match(uiRows,/GPS累計<\/label><strong>0\.300<\/strong>/);
assert.match(uiRows,/200mなら 0\.200/);
assert.equal(JSON.parse(previewLocal.get('gps-distance-lab-browser-diary-v131')).rows[1].manual,'200');
console.log('PASS: screenshot missing-time records repaired without loss, later GPS and corrections visible');
// Regression: screenshot showed ZERO SET from prior v0.8, but current APK native
// cumulative had restarted at 0.000km. User must start a new measurement without
// deleting old 0km baseline or car-trip corrections.
const oldTrip={
 startNative:4.75,startAt:1792381200000,
 rows:[{gps:5.0,manual:'0.250',at:1792381210000},
       {gps:5.3,manual:'0.550',at:1792381220000}],
 sessionId:null
};
const oldStore=new Map([['gps-distance-lab-browser-diary-v131',JSON.stringify(oldTrip)]]);
const newNodes=new Map();
function newNode(id){
 if(!newNodes.has(id))newNodes.set(id,{
 textContent:'',innerHTML:'',hidden:false,disabled:false,className:'',value:'',
 _listeners:{},addEventListener(name,cb){this._listeners[name]=cb;},getAttribute(){return null;}
 });return newNodes.get(id);
}
const nativeQueue=[];
let activeRun='new-native-run';
const newWindow={DistanceNative:{
 getStatus(){return JSON.stringify({running:true,runId:activeRun,ageMs:100,accuracyMeters:4,gaps:0,unresolvedGap:false});},
 requestCapture(nonce,target){nativeQueue.push({nonce,target});}
}};
const confirms=[];
const newCtx={window:newWindow,document:{getElementById:newNode},
 localStorage:{getItem(k){return oldStore.get(k)||null;},setItem(k,v){oldStore.set(k,v);}},
 setInterval(){},Date,Math,JSON,Number,String,Array,Object,RegExp,
 crypto:context.crypto,confirm(message){confirms.push(message);return true;}};
newWindow.crypto=context.crypto;
vm.runInNewContext(source,newCtx);
assert.equal(newNode('start-btn').disabled,true,'old 0km is already set');
assert.equal(newNode('session-warning').hidden,false,'old session requires a new native baseline');
assert.equal(newNode('new-session-btn').disabled,false,'new measurement button is always available');
newNode('new-session-btn')._listeners.click();
assert.equal(confirms.length,1,'user must consent to archiving');
assert.equal(newNode('start-btn').disabled,false,'old 0km should no longer lock the button');
assert.equal(JSON.parse(oldStore.get('gps-distance-lab-history-diary-v131')).length,1);
const archived=JSON.parse(oldStore.get('gps-distance-lab-history-diary-v131'))[0].data;
assert.deepEqual(archived.rows.map(x=>Number(x.manual)),[0.250,0.550]);
assert.equal(archived.startNative,4.75);
assert.equal(JSON.parse(oldStore.get('gps-distance-lab-browser-diary-v131')).startNative,null);
newNode('start-btn')._listeners.click();
assert.equal(nativeQueue[0].target,'start');
newWindow.DistanceLab.onNativeSnapshot(JSON.stringify({
 format:'GPS_DISTANCE_LAB_V1',nonce:nativeQueue[0].nonce,
 target:'start',tripKm:0,runId:activeRun,capturedAt:Date.now(),
 gpsAgeMs:500,running:true,unresolvedGap:false
}));
const newBaseline=JSON.parse(oldStore.get('gps-distance-lab-browser-diary-v131'));
assert.equal(newBaseline.startNative,0);
assert.equal(newBaseline.sessionId,'new-native-run');
assert.equal(newNode('start-btn').disabled,true);
newNode('rows')._listeners.click({target:{closest(){
 return {getAttribute(){return '0';}};
}}});
assert.equal(nativeQueue[1].target,'0');
newWindow.DistanceLab.onNativeSnapshot(JSON.stringify({
 format:'GPS_DISTANCE_LAB_V1',nonce:nativeQueue[1].nonce,
 target:'0',tripKm:0.375,runId:activeRun,capturedAt:Date.now(),
 gpsAgeMs:500,running:true,unresolvedGap:false
}));
assert.equal(JSON.parse(oldStore.get('gps-distance-lab-browser-diary-v131')).rows[0].gps,0.375);
assert.match(newNode('rows').innerHTML,/GPS区間<\/label><strong>0\.375<\/strong>/);
assert.equal(Number(JSON.parse(oldStore.get('gps-distance-lab-history-diary-v131'))[0].data.rows[0].manual),0.250);
console.log('PASS: user can archive old browser run, press 0km anew and capture 375m; old trip stays intact');



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
assert.equal(derive(state)[2].finalKm,13.5,'later raw GPS cumulative is still usable after a missing checkpoint');
assert.match(derive(state)[2].error,/未取得地点を含むGPS差分/,'cross-gap distance must be explicitly labelled, not silently attributed');
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
assert.match(loopback,/host!="127\.0\.0\.1:48768"/);
assert.match(loopback,/route=="\/api\/status"/);
assert.match(loopback,/route\.startsWith\("\/api\/capture\?"\)/);
assert.match(loopback,/GpsStore\.lastValidGpsFixAt/);
assert.doesNotMatch(loopback,/Access-Control-Allow-Origin:\s*\*/);
assert.match(bridge,/location\.hostname!=='127\.0\.0\.1'/);
assert.match(bridge,/location\.port!=='48768'/);
assert.match(loopback,/GpsTrackingService.ACTION_REFRESH/);
assert.match(service,/ACTION_REFRESH/);
assert.match(activity,/api\/identity/,'launch must verify local server owner');
assert.match(activity,/IDENTITY_MARKER/);
assert.match(activity,/openVerifiedExternalBrowser/);
assert.match(loopback,/route=="\/api\/identity"/);
assert.match(loopback,/GPS_DISTANCE_LAB_DIARY_V1_3/);
assert.match(loopback,/put\("packageId",context.packageName\)/);
assert.match(loopback,/put\("webVersion","1.3.1"\)/);
assert.match(service,/GpsStore.setBrowserConnectionIssue/);
assert.doesNotMatch(service,/engine.interrupted\("外部ブラウザのローカル接続ができません"\)/);
assert.match(html,/Web v1.3.1/);
assert.match(html,/gps-distance-lab-browser-diary-v131/,'keep old Chrome data');
assert.match(activity,/旧バージョンのアプリが接続先を使用/);
assert.match(gpsStore,/fun startNewRun/);
assert.match(gpsStore,/fun currentRunId/);
assert.match(service,/GpsStore.startNewRun\(this\)/);
assert.match(activity,/模擬走行を開始/);
assert.match(activity,/speedButtons.add\(speed to b\)/);
assert.match(activity,/b.isEnabled=true/,'all speed buttons must remain tappable when stopped');
assert.match(activity,/startGps\(simulation=true,initialSpeed=speed\)/,'a speed tap auto-starts simulator');
assert.match(activity,/if \(!simulation && checkSelfPermission/,'only real GPS requires location grant');
assert.match(service,/intent.action == ACTION_START && !hasPreciseLocation\(\)/,'simulate without GPS permission');
assert.match(service,/FOREGROUND_SERVICE_TYPE_DATA_SYNC/);
assert.match(manifest,/android.permission.FOREGROUND_SERVICE_DATA_SYNC/);
assert.match(manifest,/foregroundServiceType="location\|dataSync"/);
assert.match(service,/intent.getIntExtra\(EXTRA_SIM_SPEED,0\)/);

assert.match(activity,/ACTION_SIM_SPEED/);
assert.match(service,/ACTION_SIM_START/);
assert.match(service,/simTicker/);
assert.match(service,/simulating=true/);
assert.match(service,/SimulatedDrive\(\)/);
assert.match(service,/Location\("GPS_LAB_SIMULATION"\)/);
assert.match(service,/if \(simulating \|\| !engine\.snapshot\(\)\.running/);
assert.match(service,/stopSimulation\(\)/);
assert.match(gpsStore,/fun isSimulating/);
assert.match(loopback,/put\("simulated",GpsStore.isSimulating\(context\)\)/);
assert.match(loopback,/put\("simSpeedKmh",GpsStore.simSpeedKmh\(context\)\)/);
assert.match(html,/模擬走行テスト専用 v1.3.1/);
assert.match(html,/gps-distance-lab-browser-diary-v131/);
assert.doesNotMatch(html,/gps-distance-lab-browser-v080/);
assert.match(bridge,/location.port!=='48768'/);

assert.match(loopback,/put\("runId",GpsStore.currentRunId\(context\)\)/);
assert.match(html,/新しい計測を開始（旧記録は保存）/);
assert.match(html,/history-content/);
assert.match(html,/sessionMismatch\(\)/);
assert.match(html,/gps-distance-lab-history-diary-v131/);
assert.match(html,/gps-distance-lab-browser-diary-v131/,'existing browser records must survive');


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
assert.match(manifest,/android:label="GPS距離ラボ v1.3.1 模擬テスト"/);
assert.match(manifest,/android:scheme="taxiappgpsdiaryv131"/);
console.log('PASS: external browser loopback 127.0.0.1:48768, on-demand GPS refresh, same-tab capture, zero basis, no embedded WebView');

(async function(){
 const response=[];
 let pendingCount=0, count=0;
 const w={DistanceLab:{
  onNativeSnapshot(json){response.push({type:'ok',payload:JSON.parse(json)});},
  onNativePending(nonce,message){pendingCount++;},
  onNativeError(nonce,message){response.push({type:'error',nonce,message});}
 }};
 const ctx={
  window:w,location:{hostname:'127.0.0.1',port:'48768'},
  setInterval(){},setTimeout(f){setImmediate(f);},
  fetch(path){
   count++;
   if(path==='/api/status')return Promise.resolve({ok:true,json:()=>Promise.resolve({running:true,ageMs:200,gaps:0})});
   if(path.startsWith('/api/capture?'))return Promise.resolve({ok:true,json:()=>Promise.resolve(
    count<3?{ready:false,message:'GPS再測位中（有効GPS 26秒前）'}:{
    ready:true,snapshot:{format:'GPS_DISTANCE_LAB_V1',nonce:'a'.repeat(32),target:'start',tripKm:19.5,runId:'test-run',
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
