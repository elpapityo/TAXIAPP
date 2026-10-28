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
const monthlyOnly={version:1,shifts:[],prefs:{
 monthlyDutyPlans:{'2026-11-02':{status:'work',start:'17:00',end:'06:00'}},
 monthlyDutyActuals:{'2026-11-02':{status:'normal'}},
 monthlySalesGoals:{'2026-11':1000000},
 monthlyDutySalesGoals:{'2026-11':40000},
 monthlyIncludePublicSales:'off'
}};
const recoveredMonthly=api.merge({version:1,shifts:[],prefs:{}},api.extract(monthlyOnly));
for(const key of Object.keys(monthlyOnly.prefs))
 assert.deepEqual(copy(recoveredMonthly.prefs[key]),monthlyOnly.prefs[key],
  '乗務員名・待機所が未設定でも月間設定を復元：'+key);
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
assert.equal(api.same({driver:'A',waitPlaces:['伊丹駅'],ui:{text:'large',contrast:'high'}},
                      {ui:{contrast:'high',text:'large'},waitPlaces:['伊丹駅'],driver:'A'}),true,
 'reordered object keys must not look like a settings update');
assert.equal(api.same({waitPlaces:['伊丹駅','大阪空港']},
                      {waitPlaces:['大阪空港','伊丹駅']}),false,
 'waiting-place order remains a meaningful change');
assert.equal(api.signature({x:1,y:2}),api.signature({y:2,x:1}));

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
assert.match(auto,/onUserScope/,"scope must be selected before editing privileges");
assert.match(auto,/settings?\.merge|api\.merge/);
assert.match(html,/id="accountStatus"|Google/);
// 初回接続でも別日の月間予定は統合し、同じ日の食い違いは自動採用しない。
const firstStart=auto.indexOf('  function mergeInitialMonthlyPrefs(');
const firstEnd=auto.indexOf('  async function reconcile(){',firstStart);
assert.ok(firstStart>0&&firstEnd>firstStart,'月間設定の初回統合処理が存在');
const firstCtx={api};vm.createContext(firstCtx);
vm.runInContext(auto.slice(firstStart,firstEnd),firstCtx);
const initialLocal={version:1,shifts:[{id:'keep-local'}],prefs:{
 monthlyDutyPlans:{'2026-11-02':{status:'work',start:'17:00',end:'06:00'}},
 monthlySalesGoals:{'2026-11':800000}
}};
const initialRemote={
 monthlyDutyPlans:{'2026-11-03':{status:'off',start:'',end:''}},
 monthlyDutySalesGoals:{'2026-11':40000}
};
firstCtx.local=initialLocal;firstCtx.remote=initialRemote;
const firstMerged=vm.runInContext('mergeInitialMonthlyPrefs(local,remote)',firstCtx);
assert.equal(firstMerged.monthlyDutyPlans['2026-11-02'].status,'work');
assert.equal(firstMerged.monthlyDutyPlans['2026-11-03'].status,'off');
assert.equal(firstMerged.monthlySalesGoals['2026-11'],800000);
assert.equal(firstMerged.monthlyDutySalesGoals['2026-11'],40000);
assert.equal(initialLocal.shifts[0].id,'keep-local','日報原本を変更しない');
firstCtx.remote={monthlyDutyPlans:{
 '2026-11-02':{status:'leave',start:'',end:''}}};
assert.throws(()=>vm.runInContext('mergeInitialMonthlyPrefs(local,remote)',firstCtx),
 /競合/, '同一日付の変更が異なる場合は双方を保護し停止する');

// 書き込みが成功しても読戻し不一致は「保存確認済み」としない。
const verifyStart=auto.indexOf('  async function verifySavedPrefs(');
const verifyEnd=auto.indexOf('  async function apply(',verifyStart);
assert.ok(verifyStart>0&&verifyEnd>verifyStart);
const verifyCtx={
 api,authGeneration:12,
 stillCurrent:uid=>uid==='own-uid',
 deviceSession:{canWrite:()=>true},
 ref:()=>({path:'accountSettings/own-uid'}),
 expected:{monthlySalesGoals:{'2026-11':1000000}}
};vm.createContext(verifyCtx);
vm.runInContext(auto.slice(verifyStart,verifyEnd),verifyCtx);
const snap=prefs=>({exists:()=>true,data:()=>({
 format:api.FORMAT,schemaVersion:1,prefs
})});
verifyCtx.fire={getDocFromServer:async()=>snap(verifyCtx.expected)};
(async()=>{
 assert.equal(await vm.runInContext('verifySavedPrefs(expected,"own-uid",12)',verifyCtx),true);
 verifyCtx.fire={getDocFromServer:async()=>snap({monthlySalesGoals:{'2026-11':900000}})};
 await assert.rejects(vm.runInContext('verifySavedPrefs(expected,"own-uid",12)',verifyCtx),/一致しません/);
 verifyCtx.authGeneration=13;
 verifyCtx.fire={getDocFromServer:async()=>snap(verifyCtx.expected)};
 assert.equal(await vm.runInContext('verifySavedPrefs(expected,"own-uid",12)',verifyCtx),false);
})().catch(error=>{console.error(error);process.exitCode=1;});
console.log('Account settings migration passed: name, waiting places, inputs, display, fares, credentials and shift preservation.');
console.log('Account settings automatic synchronization regression passed.');
