'use strict';
const assert=require('node:assert/strict');
require('../device-management.js');
const dev=globalThis.TAXIAPP_DEVICE_DATA;
const closed={
 id:'shift-closed',date:'2026-10-15',startedAt:'08:00:00',endedAt:'20:00:00',
 settings:{goFee:200},records:[{id:'one',kind:'ride',status:'complete',raw:{A:1,K:3200}}],
 gpsTrip:{enabled:true,status:'tracking',lastFix:{lat:35,lng:135},tripKm:15},
 waiting:null,waitSegments:[{place:'駅'}]
};
const ongoing={
 id:'shift-open',date:'2026-10-16',startedAt:'08:00:00',endedAt:'',
 settings:{},records:[{id:'two',kind:'cancel',raw:{A:1,K:0}}]
};
const model={
 version:1,activeId:'shift-open',
 prefs:{driver:'テスト',waitPlaces:['駅'],sheetTarget:{mode:'auto',
  webAppUrl:'https://script.google.com/macros/s/deployment/exec'}},
 shifts:[ongoing,closed]
};
assert.equal(dev.validModel(model),true);
const backup=dev.snapshot(model,'secret-key-that-must-never-go-to-github');
assert.equal(backup.kind,dev.KIND);
assert.equal(backup.model.shifts.length,2);
assert.notEqual(backup.model,model);
const transfer=dev.prepareImport(backup);
assert.equal(transfer.model.prefs.driver,'テスト');
assert.equal(transfer.model.prefs.sheetTarget.mode,'manual');
assert.equal(transfer.googleAccessKey,backup.googleAccessKey);
assert.equal(transfer.model.shifts[1].gpsTrip.enabled,false);
assert.equal(transfer.model.shifts[1].gpsTrip.unresolvedGap,true);
assert.equal(transfer.model.shifts[1].gpsTrip.lastFix,null);
assert.equal(model.shifts[1].gpsTrip.enabled,true);
assert.equal(model.prefs.sheetTarget.mode,'auto');
// Deleting one completed departure-to-return session keeps the other untouched.
const removal=dev.deleteShift(model,'shift-closed');
assert.equal(removal.deleted.id,'shift-closed');
assert.equal(removal.deleted.records[0].raw.K,3200);
assert.equal(removal.model.shifts.length,1);
assert.equal(removal.model.shifts[0].id,'shift-open');
assert.equal(removal.model.activeId,'shift-open');
assert.equal(model.shifts.length,2);
assert.throws(()=>dev.deleteShift(model,'shift-open'),/入庫/);
assert.throws(()=>dev.deleteShift(model,'nonexistent'),/見つかりません/);
assert.throws(()=>dev.validate({...backup,googleAccessKey:123}),/形式/);
assert.equal(dev.validModel({...model,shifts:[closed,closed]}),false);
assert.equal(dev.validModel({...model,activeId:'missing'}),false);
console.log('Device management tests passed: encrypted payload structure, overwrite prep, whole-shift deletion, validation.');
