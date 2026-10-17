'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
const script=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(v=>v.includes('function renderDrive(shift)'));
assert.ok(script,'main drive logic found');
new Function(script);
assert.match(script,/driveLayout:'legacy'/,'preserve legacy as the default');
assert.match(script,/driveLayout:\['legacy','compact'\]/);
assert.match(script,/if\(key==='driveLayout'\)render\(\)/);
assert.match(script,/appEl\.classList\.toggle\('drive-compact'/);
assert.match(source,/\.drive-compact \.hero \.action-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
assert.match(source,/\.drive-compact \.wait-inputs/);
assert.match(script,/renderDriveLayoutChooser\(\)/);
assert.match(script,/renderUiChoice\('driveLayout'/);
assert.match(script,/data-action="gpsWait"/);
assert.match(script,/data-action="beginDispatch"/);
assert.match(script,/data-action="beginRide"/);
assert.match(script,/data-action="beginWait"/);
assert.match(script,/data-action="saveDraft"/);
assert.match(script,/data-action="gpsTripAlight"/);
assert.match(script,/locationField\('AL',r,'乗車地・住所','gpsPickup'\)/);
assert.match(script,/locationField\('AM',r,'降車地・住所','gpsDrop'\)/);
assert.match(script,/renderPaymentSplit\(shift,d\)/);
assert.match(script,/renderAllFields\(d\)/);
assert.match(script,/await load\(\)/);
const begin=script.indexOf('function renderDriveLayoutChooser()');
const end=script.indexOf('function renderDispatchForm',begin);
assert.ok(end>begin);
let current=null,mode='legacy';
const ctx={
 displayPrefs:()=>({driveLayout:mode}),
 getShift:()=>current,
 titleBlock:()=>'<h1>従来ヘッダー</h1>',
 paymentElapsedPanel:()=>'<div>経過時間</div>',
 totals:()=>({}),
 metrics:()=>'<section class="metrics">集計</section>',
 renderRecent:()=>'<section>直近</section>',
 friendlyDate:()=> '2026-10-18',
 shortTime:()=> '09:00',
 safeText:String,
 waitingPlaces:()=>[],
 elapsedWaitingText:()=> '00:15',
 MAX_RECORDS:60
};
vm.createContext(ctx);
vm.runInContext(script.slice(begin,end),ctx);
// Mock the existing real action area and draft renderer, verifying only the view switches.
vm.runInContext("renderNewAction=()=>'<button data-action=beginWait>待機</button><button data-action=beginRide>乗車</button><button data-action=beginDispatch>迎車</button>';renderDraft=()=>'<button data-action=saveDraft>精算</button>';",ctx);
let markup=vm.runInContext('renderDrive(null)',ctx);
assert.match(markup,/出庫・入庫メニューへ/);
assert.match(markup,/data-ui-value="legacy" aria-pressed="true"/);
current={records:[],settings:{},date:'2026-10-18',startedAt:'09:00',vehicle:'車123',draft:null};
markup=vm.runInContext('renderDrive(null)',ctx);
assert.match(markup,/従来ヘッダー/);
assert.match(markup,/集計/);
assert.match(markup,/data-action=beginRide/);
mode='compact';
markup=vm.runInContext('renderDrive(null)',ctx);
assert.doesNotMatch(markup,/従来ヘッダー/);
assert.match(markup,/data-action=beginRide/);
assert.match(markup,/compact-secondary/);
assert.match(markup,/日報集計・直近の営業記録/);
assert.match(markup,/data-ui-value="compact" aria-pressed="true"/);
current.draft={kind:'ride'};
markup=vm.runInContext('renderDrive(null)',ctx);
assert.match(markup,/data-action=saveDraft/);
assert.doesNotMatch(markup,/compact-secondary/);
mode='legacy';
markup=vm.runInContext('renderDrive(null)',ctx);
assert.match(markup,/data-action=saveDraft/);
console.log('Connected duty layout smoke tests passed: default legacy, compact opt-in, standby/ride/dispatch and draft UI use original actions.');