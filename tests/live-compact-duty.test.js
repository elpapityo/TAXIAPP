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
assert.match(script,/function renderNewAction\(shift(?:,hideWaitCard=false)?\)/);
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
const tableBegin=script.indexOf('let driveLogbookOpen=false;');
const tableEnd=script.indexOf('function renderRecent(shift){',tableBegin);
assert.ok(tableBegin>0&&tableEnd>tableBegin,'same logbook renderer for all input modes');
const begin=script.indexOf('function renderDrive(shift)');
const end=script.indexOf('let breakPageOpen=false;',begin);
assert.ok(end>begin);
let current=null;
const context={
 lastVerifiedPreviousDuty:{uid:'u1',shift:{date:'2026-10-26',records:[{raw:{A:1}}]}},accountScope:{uid:'u1'},
 model:{prefs:{ui:{driveLayout:'legacy',simpleMode:'off'}}},
 canEditNow:()=>true,
 prettyTag:record=>record.raw.E,
 pricing:record=>({printedDetail:Number(record.raw.K||0)}),
 money:value=>'¥'+Number(value).toLocaleString('ja-JP'),
 LABELS:{'現':'現金','G':'GOペイ'},
 renderMeterDrive:()=>'<section>メーター操作</section>',
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
vm.runInContext(script.slice(tableBegin,tableEnd),context);
vm.runInContext('let breakPageOpen=false;\n'+script.slice(begin,end),context);
const render=()=>vm.runInContext('renderDrive(null)',context);
let markup=render();
assert.match(markup,/出庫・入庫メニューへ/);
assert.doesNotMatch(markup,/前回の乗務|メーター照合用累計|履歴を確認する/,'no previous-duty dashboard even if a verified previous duty exists');
current={records:[
 {id:'old',kind:'ride',raw:{A:1,E:'GO',G:'09:20',M:'09:30',AL:'旧乗車地',AM:'旧降車地',K:'1500',N:'現'}},
 {id:'latest',kind:'ride',raw:{A:2,E:'Uber',G:'09:40',M:'09:50',AL:'最新乗車地',AM:'最新降車地',K:'2300',N:'G'}}
],settings:{},date:'2026-10-18',startedAt:'09:00',vehicle:'車123',draft:null};
markup=render();
assert.match(markup,/乗務入力のヘッダー/);
assert.match(markup,/preview-duty-summary/);
assert.equal((markup.match(/preview-duty-summary/g)||[]).length,1,'live duty overview must not duplicate');
assert.ok(markup.indexOf('preview-duty-summary')<markup.indexOf('乗務入力のヘッダー'));
assert.match(markup,/経過時間/);
assert.match(markup,/営業記録一覧（2件）/);
assert.ok(markup.indexOf('最新乗車地')<markup.indexOf('旧乗車地'),'newest record must be listed first');
assert.equal((markup.match(/data-action="editRecord"/g)||[]).length,2,'two existing edit commands');
assert.equal((markup.match(/data-action="deleteRecord"/g)||[]).length,2,'two existing delete commands');
assert.doesNotMatch(markup,/直近の営業記録|前回の乗務/);
context.model.prefs.ui.driveLayout='meter';
markup=render();
assert.match(markup,/メーター操作/);
assert.ok(markup.indexOf('最新乗車地')<markup.indexOf('旧乗車地'),'meter mode uses same newest-first logbook');
context.model.prefs.ui.simpleMode='on';
markup=render();
assert.equal((markup.match(/data-action="editRecord"/g)||[]).length,2,'simple mode also allows editing');
context.model.prefs.ui.driveLayout='legacy';
assert.match(markup,/data-action=beginRide/);
assert.match(markup,/data-action=beginWait/);
assert.match(markup,/data-action=beginDispatch/);
current.draft={kind:'ride',raw:{}};
markup=render();
assert.match(markup,/preview-duty-summary/);
assert.match(markup,/data-action=saveDraft/);
assert.match(markup,/営業記録一覧（2件）/,'the logbook remains viewable while entering a fare');
assert.doesNotMatch(markup,/data-action="editRecord"|data-action="deleteRecord"/,'do not allow edits or removal while another fare is being entered');
assert.match(source,/html\[data-ui-sticky-duty-summary="on"\] \.preview-duty-summary\{\s*position:sticky;top:0/);
assert.match(source,/html\[data-ui-sticky-duty-summary="off"\] \.preview-duty-summary\{position:static\}/);
console.log('Current unified duty view smoke tests passed: no duplicate status, ride/dispatch/wait and original draft save actions');
