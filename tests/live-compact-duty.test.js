'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
const script=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
 .map(m=>m[1]).find(v=>v.includes('function renderDrive(shift)'));
assert.ok(script,'main drive logic found');
new Function(script);
assert.match(script,/driveLayout:'legacy'/,'retain legacy preference for old records');
assert.match(script,/const mode='legacy'/,'unified sales view should not unexpectedly switch business flows');
assert.match(script,/function renderNewAction\(shift\)/);
assert.match(script,/class="action-grid cruising-action-grid cruising-action-compact"/,
 'fixed two-column work actions must be available');
assert.match(script,/data-action="beginDispatch"/);
assert.match(script,/data-action="beginRide"/);
assert.match(script,/data-action="beginWait"/);
assert.match(script,/data-action="openBreakPage"/);
assert.match(script,/data-action="saveDraft"/);
assert.match(script,/data-action="gpsTripAlight"/);
assert.match(script,/locationField\('AL',r,'乗車地・住所','gpsPickup'\)/);
assert.match(script,/locationField\('AM',r,'降車地・住所','gpsDrop'\)/);
assert.match(script,/renderPaymentSplit\(shift,d\)/);
assert.match(script,/renderAllFields\(d\)/);
assert.match(script,/await load\(\)/);
assert.match(script,/function renderDutyStatus\(shift\)/);
assert.match(script,/renderDutyStatus\(active\)/);
const begin=script.indexOf('function renderDrive(shift)');
const end=script.indexOf('let breakPageOpen=false;',begin);
assert.ok(end>begin);
let current=null;
const context={
 getShift:()=>current,
 titleBlock:()=>'<h1>乗務入力のヘッダー</h1>',
 renderDriveLayoutChooser:()=>'<div>営業入力</div>',
 paymentElapsedPanel:()=>'<div>経過時間</div>',
 totals:()=>({meter:0}),metrics:()=>'<section class="metrics">集計</section>',
 renderDutyStatus:()=>'<section class="preview-duty-summary">現在：空車</section>',
 renderRecent:()=>'<section>直近の営業記録</section>',
 renderNewAction:()=>'<button data-action=beginWait>待機</button><button data-action=beginRide>乗車</button><button data-action=beginDispatch>迎車</button>',
 renderDraft:()=>'<button data-action=saveDraft>登録</button>',
 friendlyDate:()=> '2026-10-18',shortTime:()=> '09:00',safeText:String
};
vm.createContext(context);
vm.runInContext('let breakPageOpen=false;\n'+script.slice(begin,end),context);
const render=()=>vm.runInContext('renderDrive(null)',context);
let markup=render();
assert.match(markup,/出庫・入庫メニューへ/);
current={records:[],settings:{},date:'2026-10-18',startedAt:'09:00',vehicle:'車123',draft:null};
markup=render();
assert.match(markup,/乗務入力のヘッダー/);
assert.match(markup,/preview-duty-summary/);
assert.equal((markup.match(/preview-duty-summary/g)||[]).length,1,'live duty overview must not duplicate');
assert.ok(markup.indexOf('preview-duty-summary')<markup.indexOf('乗務入力のヘッダー'));
assert.match(markup,/経過時間/);
assert.match(markup,/集計/);
assert.match(markup,/data-action=beginRide/);
assert.match(markup,/data-action=beginWait/);
assert.match(markup,/data-action=beginDispatch/);
current.draft={kind:'ride',raw:{}};
markup=render();
assert.match(markup,/preview-duty-summary/);
assert.match(markup,/data-action=saveDraft/);
assert.doesNotMatch(markup,/直近の営業記録/,'active fare should not embed unrelated recent entries');
assert.match(source,/html\[data-ui-sticky-duty-summary="on"\] \.preview-duty-summary\{\s*position:sticky;top:0/);
assert.match(source,/html\[data-ui-sticky-duty-summary="off"\] \.preview-duty-summary\{position:static\}/);
console.log('Current unified duty view smoke tests passed: no duplicate status, ride/dispatch/wait and original draft save actions');
