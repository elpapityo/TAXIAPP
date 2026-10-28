'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const auto=fs.readFileSync(path.join(root,'account-auto-sync.js'),'utf8');
const main=fs.readFileSync(path.join(root,'index.html'),'utf8');
// This is an event-driven sync. Visibility change, repeated server snapshots
// and actively focused settings fields must NOT generate periodic cloud reads.
assert.doesNotMatch(auto,/document\.addEventListener\('visibilitychange'/);
assert.doesNotMatch(auto,/schedule\(2500\)/);
assert.match(auto,/next==='writer'\&\&next!==previous/);
assert.match(auto,/function editingEnded\(\)/);
assert.match(main,/accountSettingsAuto\?\.editingEnded\(\)/);
assert.match(main,/account-auto-sync\.js\?v=[^"']+/, '自動同期スクリプトを読み込む');
function between(a,b){
 const start=auto.indexOf(a);
 assert.ok(start>=0,'missing '+a);
 const end=auto.indexOf(b,start);
 assert.ok(end>start,'missing '+b);
 return auto.slice(start,end);
}
const schedule=between('  function schedule(ms=900){','  // Legacy Firebase rules');
const funcs=between('  function localSaved(){','  return {start,localSaved,editingEnded');
const preflight=between('  async function reconcile(){','   busy=true;')+'   busy=true;\n   reads++;busy=false;\n  }';
const settingsContext={TextEncoder};vm.createContext(settingsContext);
vm.runInContext(fs.readFileSync(path.join(root,'account-settings.js'),'utf8'),settingsContext);
const api=settingsContext.TAXIAPP_ACCOUNT_SETTINGS;
const tasks=new Map();let sequence=0,editing=false,writerReady=true,durable=true;
const prefs={driver:'既存の乗務員名',waitPlaces:['伊丹駅']};
const context={
 enabled:true,uid:'same-uid',
 deviceSession:{canWrite:()=>true},
 deps:{isEditing:()=>editing,canApplyPrefs:()=>writerReady,isLocalSaved:()=>durable},navigator:{onLine:true},
 busy:false,again:false,timer:null,localSignature:api.signature(prefs),
 api,
 deferredWhileEditing:false,deferredWhileLocalSave:false,reads:0,
 currentPrefs:()=>prefs,status:()=>{},
 setTimeout(fn){const id=++sequence;tasks.set(id,fn);return id;},
 clearTimeout(id){tasks.delete(id);}
};
vm.createContext(context);
vm.runInContext(schedule+'\n'+funcs+'\n'+preflight,context);
const evaluate=code=>vm.runInContext(code,context);
function firePending(){
 const callbacks=[...tasks.values()];tasks.clear();
 callbacks.forEach(fn=>fn());
}
evaluate('localSaved()');
assert.equal(tasks.size,0,'unchanged preferences must not trigger a sync');
assert.equal(context.reads,0);
// Equivalent prefs with differently ordered keys are not real changes.
const sameDriver=prefs.driver;delete prefs.driver;prefs.driver=sameDriver;
evaluate('localSaved()');
assert.equal(tasks.size,0,'object key order alone must not cause a sync');
prefs.driver='変更された乗務員名';
evaluate('localSaved()');
assert.equal(tasks.size,1);
firePending();
assert.equal(context.reads,1,'changed setting triggers one read');
assert.equal(tasks.size,0,'no repeat timer after successful reconciliation');
editing=true;
prefs.waitPlaces.push('大阪空港');
evaluate('localSaved()');
firePending();
assert.equal(context.reads,1,'active text entry defers cloud reads');
assert.equal(context.deferredWhileEditing,true);
assert.equal(tasks.size,0,'must not poll while input is active');
editing=false;
evaluate('editingEnded()');
assert.equal(tasks.size,1,'blur wakes the deferred sync exactly once');
firePending();
assert.equal(context.reads,2);
assert.equal(context.deferredWhileEditing,false);
assert.equal(tasks.size,0,'no more reads without an actual new change');
evaluate('editingEnded()');
assert.equal(tasks.size,0,'repeated blur must not generate reads');
writerReady=false;
prefs.driver='原本復元待ちの設定変更';
evaluate('localSaved()');
firePending();
assert.equal(context.reads,2,'原本読込が完了するまではクラウド照合を開始しない');
assert.equal(tasks.size,0,'原本未復元中に繰り返し読取を行わない');
writerReady=true;
evaluate('schedule(0)');
firePending();
assert.equal(context.reads,3,'原本読込完了の通知で保留した設定を照合する');
assert.match(main,/onWriterBootstrapReady:\(\)=>\{[\s\S]*?accountSettingsAuto\?\.syncNow\(\)/);
assert.match(main,/canApplyPrefs:\(\)=>canEditNow\(\)/);
// 入力中の変更は端末保存完了までFirestoreへ送らない。
durable=false;
prefs.driver='未保存の月間設定';
evaluate('localSaved()');
assert.equal(tasks.size,0,'未保存の変更では送信予約を作らない');
assert.equal(context.reads,3);
assert.equal(context.deferredWhileLocalSave,true);
durable=true;
evaluate('localSaved()');
assert.equal(tasks.size,1,'端末保存後に保留した同期を再開');
firePending();
assert.equal(context.reads,4);
durable=true;
prefs.driver='保存待ち中の更新';
evaluate('localSaved()');
assert.equal(tasks.size,1);
durable=false;
firePending();
assert.equal(context.reads,4,'既存タイマーが発火しても保存待機中は送らない');
assert.equal(context.deferredWhileLocalSave,true);
durable=true;
evaluate('localSaved()');
assert.equal(tasks.size,1);
firePending();
assert.equal(context.reads,5,'保存完了イベントで保留していた変更を送信');
assert.match(main,/isLocalSaved:\(\)=>!localSavePending&&!persistTimer/);
assert.doesNotMatch(main,/appEl\.addEventListener\('focusout',[\s\S]{0,90}accountSettingsAuto\?\.localSaved\(\)/,
 'フォーカス終了を端末保存成功の通知に使わない');
console.log('Account settings sync scheduling passed: durable local save before cloud reads.');
