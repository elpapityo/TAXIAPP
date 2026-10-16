'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(){
 const state={
  running:false,tripKm:0,realKm:0,emptyKm:0,correctionKm:0,
  gapCount:0,unresolvedGap:false,mode:'empty',accuracy:5,
  lastGpsAt:Date.now(),lastRideKm:null,completedRides:0,status:'測位中'
 };
 const commands=[];
 const api={
  snapshot:()=>JSON.stringify(state),
  start:()=>{commands.push('start');state.running=true;},
  stop:()=>{commands.push('stop');state.running=false;},
  mode:value=>{commands.push(value);state.mode=value;
   if(value==='empty'){state.completedRides++;state.lastRideKm=state.realKm;}
  },
  correct:value=>{commands.push('correct');state.tripKm=value;}
 };
 const dom={
  getElementById:()=>null,
  querySelector:()=>null,
  activeElement:null
 };
 const context={window:{TAXIAPP_NATIVE_GPS:api},document:dom,
  Date,Number,Math,JSON,String,Object,Array,Set,setTimeout:()=>0,clearTimeout:()=>{}};
 const src=fs.readFileSync(path.join(__dirname,'..','..','assets','native-gps-ui.js'),'utf8');
 vm.runInNewContext(src,context);
 const shift={id:'unit',endedAt:'',draft:null,waiting:null,gpsTrip:null};
 let saves=0;
 const ui=context.window.TAXIAPP_GPS_UI({
  getShift:()=>shift,persist:()=>{saves++;},render:()=>{},
  toast:()=>{},number:value=>value===''||value===undefined?null:Number(value),
  safeText:value=>String(value)
 });
 return {state,ui,shift,commands,get saves(){return saves;}};
}
test('native GPS starts and reports accurate cumulative distance',()=>{
 const {state,ui,shift,commands}=setup();
 ui.start(shift);
 assert.equal(commands[0],'start');
 state.tripKm=9.174;state.realKm=5.5;state.emptyKm=3.674;
 ui.tick();
 assert.equal(shift.gpsTrip.tripKm,9.174);
 assert.equal(shift.gpsTrip.realKm,5.5);
 assert.equal(shift.gpsTrip.emptyKm,3.674);
 assert.equal(shift.gpsTrip.source,'android-native');
});
test('manual checkpoint is protected and mode changes without browser watch',()=>{
 const {state,ui,shift,commands}=setup();
 ui.start(shift);
 state.tripKm=9.174;ui.tick();
 const ride={kind:'ride',id:'ride1',raw:{F:'9.1',L:''},meta:{}};
 shift.draft=ride;
 ui.board(shift,ride);
 assert.equal(ride.raw.F,'9.1'); // manual 9.1 must not be overwritten
 assert.equal(shift.gpsTrip.mode,'real');
 assert.ok(commands.includes('real'));
 state.tripKm=10.3;state.realKm=1.126;
 ui.alight(shift,ride);
 ui.tick();
 assert.equal(state.mode,'empty');
 assert.equal(ride.meta.gpsDistance.alightQuality,'valid');
 assert.equal(ride.raw.L,'10.3');
 assert.ok(shift.gpsTrip.nativeCompletedRides>=1);
});
test('GPS gap disables automatic distance and retains manual values',()=>{
 const {state,ui,shift}=setup();
 ui.start(shift);
 state.tripKm=6.5;ui.tick();
 state.unresolvedGap=true;ui.tick();
 const record={id:'r',kind:'ride',raw:{F:'',L:'7.2'},meta:{}};
 assert.equal(ui.fillDistance(shift,record,'F'),false);
 assert.equal(record.raw.F,'');
 assert.equal(record.raw.L,'7.2');
});
