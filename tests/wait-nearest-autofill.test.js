'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
function chunk(start,end){
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'source section not found: '+start);
 return html.slice(a,b);
}
const funcs=chunk('function waitingPlaces(){','function registerWaitName(')
 +chunk('function waitNameGeo(name){','function nearestWaitName(')
 +chunk('function refreshWaitView(waitId){','// Coordinate registration is an explicit action,');
const core=funcs.slice(0,funcs.indexOf('async function getWaitGps('));
const getWaitGps=funcs.slice(funcs.indexOf('async function getWaitGps('));
assert.match(getWaitGps,/const nearby=waitCandidates\(geo\)/);
assert.match(getWaitGps,/if\(nearby\.length>0\)/);
assert.match(getWaitGps,/target\.place=nearby\[0\]\.name/);
assert.doesNotMatch(getWaitGps,/if\(nearby\.length>1\)\s*\{\s*target\.place=''/);
const near=(lat)=>({lat,lng:135,accuracy:15});
const prefs={
 waitPlaces:['遠い待機所','近い待機所','中間の待機所','座標未登録'],
 waitPlaceCoords:{
  '遠い待機所':near(35.00028),
  '近い待機所':near(35.00006),
  '中間の待機所':near(35.00018)
 },
 waitPlaceInfo:Object.fromEntries(['遠い待機所','近い待機所','中間の待機所'].map(
  (name,i)=>[name,{id:'place-'+(i+1),radius:100,address:name+'付近'}]))
};
async function scenario(count,options={}){
 const wait={id:'wait-01',place:options.manual?'遠い待機所':'',
  placeSource:options.manual?'manual':'',geo:null,address:''};
 const shift={id:'shift-01',waiting:wait,waitSegments:[],draft:null,records:[]};
 const model={prefs:{...prefs,waitPlaces:prefs.waitPlaces.slice(0,count)},shifts:[shift],activeId:shift.id};
 // For count=2, the registered list deliberately places the farther stand FIRST.
 // The actual visible nearby list is sorted by distance, so its first item must win.
 let gpsCallback,saveCalls=0,viewUpdates=0;
 const field={value:'',isConnected:true},status={textContent:''};
 const appEl={querySelector(selector){
  return selector==='[data-wait-field="place"]'?field:
   selector==='[data-wait-gps-status]'?status:null;
 }};
 const ctx={
  model,Date,tab:'drive',window:{isSecureContext:true},
  navigator:{geolocation:{getCurrentPosition(ok){gpsCallback=ok;}}},
  document:{activeElement:null},appEl,safeText:String,
  getShift:()=>model.shifts.find(x=>x.id===model.activeId),
  waitRecord:(shiftId,waitId)=>shift.id===shiftId&&shift.waiting?.id===waitId?shift.waiting:null,
  nativeAutoDistanceEnabled:()=>false,nativeDiaryGpsEnabled:()=>false,
  reverseAddress:async()=> 'GPS取得住所',saveLater(){},save:async()=>{saveCalls++;},
  render(){throw Error('GPS nearest stand must not redraw current form');},meterConfirmRefresh:()=>{},
  gpsMessage:e=>String(e),gpsTripUI:null
 };
 vm.createContext(ctx);
 vm.runInContext(core+getWaitGps,ctx);
 const incoming={lat:35,lng:135,accuracy:options.accuracy??15};
 const choices=vm.runInContext('waitCandidates('+JSON.stringify(incoming)+')',ctx);
 assert.ok(choices.every((v,i)=>i===0||choices[i-1].meters<=v.meters),
  'nearby list must be ordered nearest first');
 assert.ok(choices.length>0,'test needs registered nearby places');
 assert.equal(choices[0].name,'近い待機所');
 assert.equal(vm.runInContext('waitCandidates({lat:35,lng:135,accuracy:101})',ctx).length,0,
  'inaccurate GPS should never auto-assign');
 vm.runInContext('getWaitGps(model.shifts[0],model.shifts[0].waiting)',ctx);
 assert.equal(typeof gpsCallback,'function');
 await gpsCallback({coords:{latitude:incoming.lat,longitude:incoming.lng,
  accuracy:incoming.accuracy}});
 await new Promise(setImmediate); // wait for independently resolved address lookup
 assert.ok(saveCalls>=1);
 assert.ok(!model.shifts[0].draft,'GPS wait lookup cannot start a sale');
 if(options.manual){
  assert.equal(wait.place,'遠い待機所','a manually selected stand must not be overwritten');
  assert.equal(wait.placeSource,'manual');
 }else{
  assert.equal(wait.place,choices[0].name,
   'entered stand must exactly equal FIRST item of sorted visible candidates');
  assert.equal(wait.placeId,prefs.waitPlaceInfo[choices[0].name].id);
  assert.equal(wait.placeSource,'gps');
  assert.equal(field.value,choices[0].name,'displayed input must update automatically');
  assert.match(status.textContent,/自動入力|自動判定/);
 }
 assert.ok(wait.geo && wait.geo.accuracy===incoming.accuracy,'GPS sample must be retained');
 return {selected:wait.place,choices:choices.map(x=>x.name),viewUpdates};
}
(async()=>{
 const two=await scenario(2);
 assert.deepEqual(two.choices,['近い待機所','遠い待機所'],
  'two results are sorted by proximity not registration sequence');
 const three=await scenario(3);
 assert.deepEqual(three.choices,['近い待機所','中間の待機所','遠い待機所']);
 await scenario(3,{manual:true});
 console.log('PASS nearby registered stands: 2 or 3 candidates auto-fill the first visible (nearest) entry; manual selection kept');
})().catch(e=>{console.error(e);process.exitCode=1});
