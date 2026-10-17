'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {TextEncoder}=require('node:util');
const root=path.join(__dirname,'..');
const context={TextEncoder};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'account-settings.js'),'utf8'),context);
const api=context.TAXIAPP_ACCOUNT_SETTINGS;
const copy=x=>JSON.parse(JSON.stringify(x));
const model={
 version:1,activeId:null,
 shifts:[{id:'duty-existing',records:[{kind:'ride',raw:{K:'3200'}}]}],
 prefs:{
  driver:'乗務員A',driverNo:'17',vehicle:'伊丹500',startingOdo:'100',
  waitPlaces:['大阪空港','伊丹駅','梅田'],waitPlaceCoords:{大阪空港:{lat:34.78,lng:135.45}},
  ui:{text:'extra',theme:'night'},input:{keyboard:'custom',scrollDismiss:'off'},
  sheetTarget:{mode:'auto',syncMode:'on',webAppUrl:'https://script.google.com/macros/s/old/exec',
   spreadsheetUrl:'https://docs.google.com/spreadsheets/d/old/edit',fileBaseName:'日報A'},
  nested:{apiKey:'do-not-export',nested:{refreshToken:'do-not-export',important:'keep'}},
  name:''}
};
const stored=api.extract(model);
assert.equal(stored.format,api.FORMAT);
assert.equal(stored.prefs.driver,'乗務員A');
assert.equal(stored.prefs.waitPlaces.length,3);
assert.equal(stored.prefs.waitPlaceCoords.大阪空港.lat,34.78);
assert.equal(stored.prefs.ui.text,'extra');
assert.equal(stored.prefs.sheetTarget.fileBaseName,'日報A');
assert.equal(stored.prefs.sheetTarget.webAppUrl,undefined,'never export device Google endpoint');
assert.equal(stored.prefs.sheetTarget.spreadsheetUrl,undefined);
assert.equal(stored.prefs.sheetTarget.mode,undefined);
assert.equal(stored.prefs.sheetTarget.syncMode,undefined);
assert.equal(stored.prefs.nested.apiKey,undefined);
assert.equal(stored.prefs.nested.nested.refreshToken,undefined);
assert.equal(stored.prefs.nested.nested.important,'keep');
const info=api.summary(stored.prefs);
assert.equal(info.waitPlaceCount,3);
assert.equal(info.driver,'乗務員A');
const phone={
 version:1,activeId:null,
 shifts:[{id:'existing-phone-record',records:[{kind:'ride',raw:{K:'4000'}}]}],
 prefs:{driver:'old',waitPlaces:['旧候補'],
  sheetTarget:{mode:'manual',syncMode:'off',webAppUrl:'https://script.google.com/macros/s/phone/exec',
   spreadsheetUrl:'https://docs.google.com/spreadsheets/d/phone/edit'}}
};
const oldJson=JSON.stringify(phone);
const merged=api.merge(phone,stored);
assert.equal(JSON.stringify(phone),oldJson,'merge must not mutate previous local model');
assert.equal(merged.shifts,phone.shifts,'the exact local duty list is preserved');
assert.equal(merged.activeId,phone.activeId);
assert.equal(merged.prefs.driver,'乗務員A');
assert.deepEqual(Array.from(merged.prefs.waitPlaces),['大阪空港','伊丹駅','梅田','旧候補']);
assert.equal(merged.prefs.waitPlaceCoords.大阪空港.lng,135.45);
const overcrowded=copy(phone);
overcrowded.prefs.waitPlaces=Array.from({length:30},(_,i)=>'別端末の待機所'+i);
assert.throws(()=>api.merge(overcrowded,stored),/30件/,'must not discard waiting places when total exceeds 30');
assert.equal(merged.prefs.ui.theme,'night');
assert.equal(merged.prefs.sheetTarget.mode,'manual','device sync mode must stay manual');
assert.equal(merged.prefs.sheetTarget.syncMode,'off','device two-way sync setting must be preserved');
assert.equal(merged.prefs.sheetTarget.webAppUrl,phone.prefs.sheetTarget.webAppUrl);
assert.equal(merged.prefs.sheetTarget.spreadsheetUrl,phone.prefs.sheetTarget.spreadsheetUrl);
assert.equal(merged.prefs.sheetTarget.fileBaseName,'日報A','print-specific settings still migrate');
const modifiedPhone=copy(phone);
modifiedPhone.prefs.sheetTarget.fileBaseName='端末独自のファイル名';
const mergedPrint=api.merge(modifiedPhone,stored);
assert.equal(mergedPrint.prefs.sheetTarget.fileBaseName,'日報A','the shared file name must beat local device defaults');
const afterRemoteRemove=api.merge(phone,{format:api.FORMAT,schemaVersion:1,prefs:{
 driver:'乗務員A',waitPlaces:['伊丹駅'],waitPlaceCoords:{}
}},{preserveLocalWaiting:false});
assert.deepEqual(Array.from(afterRemoteRemove.prefs.waitPlaces),['伊丹駅'],
 'deletions from cloud must propagate when account sync is enabled');
const base={driver:'Alice',waitPlaces:['伊丹駅'],ui:{text:'normal',theme:'day'}};
const local={driver:'Alice',waitPlaces:['伊丹駅','空港'],ui:{text:'normal',theme:'day'}};
const remote={driver:'Alice',waitPlaces:['伊丹駅'],ui:{text:'extra',theme:'day'}};
const combined=api.reconcile(base,local,remote);
assert.deepEqual(Array.from(combined.conflicts),[]);
assert.deepEqual(Array.from(combined.prefs.waitPlaces),['伊丹駅','空港']);
assert.equal(combined.prefs.ui.text,'extra');
const clashing=api.reconcile(base,{...base,driver:'Bob'},{...base,driver:'Charlie'});
assert.deepEqual(Array.from(clashing.conflicts),['driver'],'same-setting simultaneous edits must be preserved as conflicts');
const identical=api.reconcile(base,{...base,driver:'Bob'},{...base,driver:'Bob'});
assert.deepEqual(Array.from(identical.conflicts),[]);

assert.throws(()=>api.validate({format:'wrong',schemaVersion:1,prefs:{}}));
assert.throws(()=>api.extract({version:1,prefs:{},shifts:'invalid'}));
const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
assert.match(rules,/match \/accountSettings\/\{uid\}/);
assert.match(rules,/request\.auth\.uid == uid/);
assert.match(rules,/request\.resource\.data\.updatedAt == request\.time/);
assert.match(rules,/allow list, delete: if false/);
const html=fs.readFileSync(path.join(root,'login.html'),'utf8');
const pageJs=fs.readFileSync(path.join(root,'login.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'account-settings-ui.js'),'utf8');
assert.match(html,/id="settingsTransfer"/);
assert.match(html,/id="backupBeforeSettings"/);
assert.match(html,/src="\.\/account-settings-ui\.js\?v=20261017-4"/);
assert.match(pageJs,/settingsController\.refresh\(user,state\)/);
assert.match(ui,/runTransaction/);
assert.match(ui,/encrypted=await root\.TAXIAPP_TRANSFER\.encrypt/);
assert.match(ui,/JSON\.stringify\(existing\)!==backupFingerprint/);
assert.match(ui,/settings\.merge\(get\.result,remoteSnapshot\)/);
assert.doesNotMatch(ui,/TAXIAPP_WRITE_KEY/);
new vm.Script(ui);

const auto=fs.readFileSync(path.join(root,'account-auto-sync.js'),'utf8');
new vm.Script(auto);
assert.match(auto,/onAuthStateChanged/);
assert.match(auto,/getDocFromServer/);
assert.match(auto,/runTransaction/);
assert.match(auto,/taxiapp-bound-account-uid-v1/,"reject syncing a different account on a shared device");
assert.match(auto,/settings?\.merge|api\.merge/);
assert.match(html,/id="accountStatus"|Google/);
console.log('Account settings migration passed: name, waiting places, inputs, display, fares, credentials and shift preservation.');
console.log('Account settings automatic synchronization regression passed.');
