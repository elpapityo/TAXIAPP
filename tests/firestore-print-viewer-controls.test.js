'use strict';
// PC print is a read-only login: only deliberate Firestore history navigation,
// bridge configuration and owner-authenticated print may bypass editing lock.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const begin=html.indexOf('function blockViewerEdit(event){');
const end=html.indexOf('\nfor(const eventName of',begin);
assert.ok(begin>=0&&end>begin,'閲覧端末の操作保護コードを取得できません');
const source=html.slice(begin,end);
const context={
 canEditNow:()=>false,
 document:{getElementById:()=>({contains:()=>true})},
 TAXIAPP_PRINT_VIEWER_MODE:true,
 deviceMode:'viewer',
 accountScope:{adminFirestore:true,adminFirestorePreview:false,uid:'admin-test'},
 currentLoginScope:{admin:true,uid:'admin-test'},
 accountDiary:{ready:()=>true},
 deviceNoticeAt:Date.now(),
 toast:()=>{throw Error('予期しない操作拒否通知');},
 Date
};
vm.createContext(context);
vm.runInContext(source,context);
function target(kind){
 return {
  matches:(selectors)=>kind==='historyDate'&&selectors.includes('#historyDate')||
   kind==='historyShiftSelect'&&selectors.includes('#historyShiftSelect')||
   kind==='pcSetting'&&selectors.includes('[data-firestore-print-setting]'),
  closest:(selectors)=>kind==='pcPrint'&&selectors.includes('[data-action="firestorePrintToGoogle"]')||
   kind==='historyFetch'&&selectors.includes('[data-action="loadCloudHistory"]')
 };
}
function allowed(kind,type='click'){
 let prevented=false;
 const event={type,target:target(kind),preventDefault:()=>{prevented=true;},
  stopImmediatePropagation:()=>{}};
 context.blockViewerEdit(event);
 return !prevented;
}
assert.equal(allowed('historyDate','pointerdown'),true,'閲覧専用でも日付を開ける');
assert.equal(allowed('historyShiftSelect','click'),true,'同じ日の乗務を選べる');
assert.equal(allowed('historyFetch','click'),true,'日付指定の本人日報取得を許可');
assert.equal(allowed('pcSetting','input'),true,'PCの接続先を入力できる');
assert.equal(allowed('pcSetting','change'),true,'PCの接続設定を保存できる');
assert.equal(allowed('pcPrint','click'),true,'本人認証済みPCの印刷転送を許可');
assert.equal(allowed('other','click'),false,'閲覧専用の営業編集を拒否');
context.TAXIAPP_PRINT_VIEWER_MODE=false;
assert.equal(allowed('pcPrint','click'),false,'通常閲覧端末は印刷転送できない');
assert.equal(allowed('pcSetting','change'),false,'通常閲覧端末は印刷鍵を設定できない');
context.TAXIAPP_PRINT_VIEWER_MODE=true;
context.currentLoginScope={admin:true,uid:'someone-else'};
assert.equal(allowed('pcPrint','click'),false,'他人UIDのログインで印刷転送を許可しない');
context.currentLoginScope={admin:true,uid:'admin-test'};
context.accountScope.adminFirestorePreview=true;
assert.equal(allowed('pcPrint','click'),false,'開発用プレビューで本番印刷転送しない');
console.log('PC印刷用の閲覧端末: 日付・対象選択・接続設定・認証転送のみ許可 / 営業編集は遮断');
