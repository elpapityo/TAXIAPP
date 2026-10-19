'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const a=html.indexOf('function renderSettings(shift)');
const b=html.indexOf('function download(',a);
assert.ok(a>0 && b>a,'settings renderer must exist');
const settings=html.slice(a,b);
const groups=[
 ['data-ride-field-settings','営業入力項目の表示設定'],
 ['data-drive-status-settings','営業情報の表示'],
 ['data-cruising-summary-settings','空車・流し時の上部表示項目'],
 ['data-text-size-settings','文字の大きさ'],
 ['data-button-size-settings','ボタンの大きさ'],
 ['data-help-settings','説明文の表示'],
 ['data-theme-settings','画面の配色・コントラスト'],
 ['data-ui-preview-settings','表示サンプル・表示設定の初期化']
];
const indexes=[];
for(const [attr,title] of groups){
 const marker='<details class="details settings-advanced" '+attr+'>';
 const i=settings.indexOf(marker);
 assert.ok(i>=0,attr+' must be a standalone collapsible menu');
 assert.equal(settings.indexOf(marker,i+1),-1,'duplicated '+attr);
 assert.ok(settings.slice(i,i+150).includes('<summary>'+title+'</summary>'),title);
 assert.ok(settings.slice(i,i+150).includes('<div class="inner">'),attr);
 indexes.push(i);
}
assert.deepEqual(indexes,[...indexes].sort((x,y)=>x-y),'menu order should be predictable');
assert.ok(settings.includes('${renderRideFieldSettings()}'),'ride option data path preserved');
assert.ok(settings.includes('${renderCruisingSummarySettings()}'),'status list option data path preserved');
for(const option of ['driveStatusDisplay','text','buttons','help','contrast','theme']){
 assert.ok(settings.includes("renderUiChoice('"+option+"'"),'saved UI option missing '+option);
}
assert.doesNotMatch(settings,/営業ボタンの並び方|従来の並び|cruisingButtonsLayout/);
assert.doesNotMatch(html,/cruisingButtonsLayout|cruising-action-stack/);
assert.match(html,/class="action-grid cruising-action-grid cruising-action-compact"/,
 'cruising actions must always use the 2-column grid');
assert.match(html,/\.cruising-action-grid\.cruising-action-compact\{display:grid!important;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
assert.match(html,/querySelectorAll\('details\.settings-advanced,details\[data-gps-settings\],details\[data-address-settings\]'\)/,
 'settings disclosure state must be preserved across renders');
assert.match(html,/const DB_NAME='taxiapp-store-v1';const STORE='state';const KEY='taxiapp';/,
 'existing duty IndexedDB stays unchanged');
console.log('PASS settings: 8 independent foldable categories; obsolete button layout removed; cruising fixed 2x2; persistence guards');
