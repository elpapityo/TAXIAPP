'use strict';
// 「Chromeのログインアカウント」ではなく、TAXIAPPに認証された本人を表示する。
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf('function renderLoginAccountInfo(){');
const end=html.indexOf('function renderSettings(shift)',start);
assert.ok(start>0&&end>start,'設定画面にログイン情報表示が組み込まれている');
const source=html.slice(start,end);
assert.match(html.slice(end,end+500),/data-login-account-settings open/,'設定から確認できる');
assert.match(html.slice(end,end+500),/renderLoginAccountInfo\(\)/);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const uid='owner-test-uid',email='test-owner@example.invalid';
const context={
 currentLoginScope:{uid,admin:true,firebase:{auth:{currentUser:{uid,email,displayName:'本人の表示名'}}}},
 accountScope:{uid,kind:'legacy',adminFirestorePreview:false},
 deviceMode:'writer',writerLoadGate:false,
 safeText:esc,document:{getElementById:id=>id==='accountOpenChatNameLabel'?{textContent:'オプチャネーム：テスター'}:null},
 memberDiary:()=>context.accountScope.kind==='member',
 legacyDiary:()=>context.accountScope.kind==='legacy'
};
vm.createContext(context);
vm.runInContext(source,context);
let result=context.renderLoginAccountInfo();
assert.match(result,/本人の表示名/);
assert.ok(result.includes(email),'Firebaseログインのメールアドレスを表示');
assert.match(result,/管理者/);
assert.match(result,/Google Sheets（従来運用）/);
assert.match(result,/操作端末（操作可能）/);
context.accountScope={uid,kind:'member',adminFirestorePreview:true};
result=context.renderLoginAccountInfo();
assert.match(result,/本人UID別Firestore（開発検証）/);
context.currentLoginScope.admin=false;
context.currentLoginScope.active=true;
context.accountScope.adminFirestorePreview=false;
result=context.renderLoginAccountInfo();
assert.match(result,/一般利用者/);
assert.match(result,/本人UID別Firestore/);
context.deviceMode='viewer';
result=context.renderLoginAccountInfo();
assert.match(result,/閲覧専用端末/);
context.currentLoginScope.firebase.auth.currentUser={uid:'different-uid',email:'wrong@example.invalid'};
result=context.renderLoginAccountInfo();
assert.doesNotMatch(result,/wrong@example.invalid/,'Firebase認証UID不一致時はメールを表示しない');
assert.match(result,/ログイン確認中/);
context.currentLoginScope=null;
result=context.renderLoginAccountInfo();
assert.match(result,/未確認/,'未ログインでは身元を推測しない');
console.log('設定：本人アカウントのUID照合・管理者区分・Firestore検証・閲覧専用・未ログイン表示を確認');
