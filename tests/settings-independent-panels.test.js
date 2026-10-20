'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const a=html.indexOf('function renderSettings(shift)');
const b=html.indexOf('function download(',a);
assert.ok(a>0 && b>a,'settings renderer must exist');
const settings=html.slice(a,b);
const groups=[
 ['data-business-field-settings','営業画面の表示項目'],
 ['data-drive-status-settings','営業情報の表示'],
 ['data-appearance-settings','画面表示のカスタマイズ']
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
const start=settings.indexOf('<details class="details settings-advanced" data-business-field-settings>');
const finish=settings.indexOf('<details class="details settings-advanced" data-drive-status-settings>',start);
assert.ok(start>=0&&finish>start);
const grouped=settings.slice(start,finish);
assert.match(grouped,/<summary>営業画面の表示項目<\/summary>/);
for(const [name,title] of [
 ['data-ride-field-settings','営業入力項目の表示設定'],
 ['data-cruising-summary-settings','空車・流し時の上部表示項目']
]){
 const nested='<details class="details" '+name+'>';
 assert.equal(grouped.split(nested).length,2,'nested menu must appear once: '+name);
 assert.ok(grouped.slice(grouped.indexOf(nested),grouped.indexOf(nested)+140)
  .includes('<summary>'+title+'</summary>'));
 assert.doesNotMatch(settings,new RegExp('details class="details settings-advanced" '+name));
}
assert.ok(grouped.indexOf('data-ride-field-settings')<grouped.indexOf('data-cruising-summary-settings'));

const appearanceStart=settings.indexOf('<details class="details settings-advanced" data-appearance-settings>');
const appearanceEnd=settings.indexOf('<details class="details settings-advanced"><summary>入力・キーボード設定</summary>',appearanceStart);
assert.ok(appearanceStart>=0&&appearanceEnd>appearanceStart,'appearance menu encloses exactly the requested categories');
const appearance=settings.slice(appearanceStart,appearanceEnd);
assert.match(appearance,/<summary>画面表示のカスタマイズ<\/summary>/);
const appearanceItems=[
 ['data-text-size-settings','文字の大きさ'],
 ['data-button-size-settings','ボタンの大きさ'],
 ['data-help-settings','説明文の表示'],
 ['data-theme-settings','画面の配色・コントラスト'],
 ['data-ui-preview-settings','表示サンプル・表示設定の初期化']
];
const positions=[];
for(const [name,title] of appearanceItems){
 const nested='<details class="details" '+name+'>';
 const pos=appearance.indexOf(nested);
 assert.ok(pos>=0,'nested appearance setting missing: '+name);
 assert.equal(appearance.split(nested).length,2,'appearance setting repeated: '+name);
 assert.ok(appearance.slice(pos,pos+170).includes('<summary>'+title+'</summary>'),title);
 assert.doesNotMatch(settings,new RegExp('details class="details settings-advanced" '+name),'not a top-level menu: '+name);
 positions.push(pos);
}
assert.deepEqual(positions,[...positions].sort((a,b)=>a-b),'preserve appearance option order');
for(const option of ['text','buttons','help','contrast','theme'])
 assert.ok(appearance.includes("renderUiChoice('"+option+"'"),'setting choice moved incorrectly: '+option);
assert.match(appearance,/data-action="resetUi"/,'reset remains inside appearance parent');

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
assert.match(html,/querySelectorAll\('details\.settings-advanced,details\[data-ride-field-settings\],details\[data-cruising-summary-settings\],details\[data-text-size-settings\],details\[data-button-size-settings\],details\[data-help-settings\],details\[data-theme-settings\],details\[data-ui-preview-settings\],details\[data-driver-profile-settings\],details\[data-vehicle-profile-settings\],details\[data-cancel-settings\],details\[data-fee-settings\],details\[data-duty-plan-settings\],details\[data-gps-settings\],details\[data-address-settings\]'\)/,
 'settings disclosure state must be preserved across renders');
assert.match(html,/const DB_NAME='taxiapp-store-v1';const STORE='state';const KEY='taxiapp';/,
 'existing duty IndexedDB stays unchanged');
console.log('PASS settings: both nested groups, 5 independently collapsible appearance controls, saved UI choices retained');
