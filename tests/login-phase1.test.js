'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const utilSource=fs.readFileSync(path.join(root,'login-core.js'),'utf8');
const context={};vm.createContext(context);vm.runInContext(utilSource,context);
const u=context.TAXIAPP_LOGIN_UTILS;
assert.equal(u.firebaseConfigReady(null),false);
assert.equal(u.firebaseConfigReady({apiKey:'YOUR_KEY',authDomain:'x',projectId:'y',appId:'z'}),false);
assert.equal(u.firebaseConfigReady({apiKey:'ABC123',authDomain:'x.firebaseapp.com',projectId:'p',appId:'app:xyz'}),true);
const logged={uid:'account-123',email:'test@example.com'};
assert.equal(u.accessState(null,{enabled:true},null),'signed-out');
assert.equal(u.accessState(logged,null,null),'pending');
assert.equal(u.accessState(logged,null,{status:'active',role:'admin'}),'active','self-claimed profile role cannot grant admin');
assert.equal(u.accessState(logged,{enabled:false},{status:'active'}),'active');
assert.equal(u.accessState(logged,{enabled:true},null),'admin');
assert.equal(u.accessState(logged,null,{status:'suspended'}),'suspended');
const summary=u.summarizeLegacyModel({shifts:[{records:[{},{}]},{records:[{}]}]});
assert.equal(summary.shiftCount,2);assert.equal(summary.recordCount,3);
assert.equal(u.summarizeLegacyModel(null).shiftCount,0);
const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
assert.match(rules,/match \/admins\/\{uid\} \{[\s\S]*?allow create, update, delete: if false;/);
assert.match(rules,/match \/users\/\{uid\} \{[\s\S]*?allow create, update, delete: if false;/);
assert.match(rules,/match \/\{document=\*\*\} \{ allow read, write: if false; \}/);
const page=fs.readFileSync(path.join(root,'login.html'),'utf8');
assert.match(page,/Googleでログイン/);
assert.match(page,/id="copyLoginUid"/);
assert.match(page,/id="loginUid"[^>]+readonly/);
assert.match(page,/src="\.\/login\.js\?v=20261017-4"/);

assert.match(page,/既存の日報・同期設定は変更しません/);
assert.match(page,/普段のGoogleログインと日報入力はTAXIAPP本体で行います/);
assert.match(page,/再ログインする必要はありません/);
assert.equal((page.match(/href="\.\/index\.html/g)||[]).length,1,'single main-app entry in admin diagnostics');

assert.match(page,/type="module" src="\.\/login\.js\?v=20261017-4"/);
const js=fs.readFileSync(path.join(root,'login.js'),'utf8');
assert.match(js,/signInWithPopup\(/);
assert.match(js,/const credential=await a\.signInWithPopup\(auth,provider\);\s*await refreshIdentity\(credential\.user\);/);
assert.match(js,/a\.onAuthStateChanged\(auth,refreshIdentity/);
assert.match(js,/navigator\.clipboard\.writeText\(uid\)/);
assert.match(js,/getDoc\(f\.doc\(db,'admins',user\.uid\)\)/);
assert.match(js,/transaction\('state','readonly'\)/);
assert.match(js,/request\.transaction\.abort\(\)/);
assert.doesNotMatch(js,/\b(?:setDoc|addDoc|updateDoc|deleteDoc|setItem|put\()\s*\(/);
assert.doesNotMatch(js,/TAXIAPP_WRITE_KEY/);
const config=fs.readFileSync(path.join(root,'firebase-config.js'),'utf8');
assert.match(config,/projectId: "taxiapp-2b6bd"/);
const configContext={window:{}};vm.createContext(configContext);vm.runInContext(config,configContext);
assert.equal(u.firebaseConfigReady(configContext.window.TAXIAPP_FIREBASE_CONFIG),true);
assert.equal(configContext.window.TAXIAPP_FIREBASE_CONFIG.authDomain,'taxiapp-2b6bd.firebaseapp.com');
assert.doesNotMatch(config,/PRIVATE KEY|BEGIN RSA PRIVATE KEY/);
const check=spawnSync(process.execPath,['--input-type=module','--check'],{input:js,encoding:'utf8'});
assert.equal(check.status,0,check.stderr);
const live=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.match(live,/TAXIAPP v0\.3\.49/);
assert.match(live,/device-session\.js/);
assert.match(live,/id="accountTakeOver"/);
assert.match(live,/account-auto-sync\.js/);
assert.match(live,/id="accountSignIn"/);
assert.doesNotMatch(live,/TAXIAPP_WRITE_KEY/);
console.log('Login phase1 tests passed: admin isolated, default deny, legacy read-only and no main-app disruption.');

// Execute the real click handler with older and modern browser clipboard mocks.
const copyStart=js.indexOf("$('copyLoginUid').addEventListener");
const copyEnd=js.indexOf('function showIdentity(',copyStart);
assert.ok(copyStart>=0&&copyEnd>copyStart);
const copyCode=js.slice(copyStart,copyEnd);
async function copyTest({legacy,modern,expectedCopied}){
 let handler=null,selected=0,write='',value='test-uid-ABC',focus=0;
 const input={
  value,
  focus(){focus++;},
  select(){selected++;},
  setSelectionRange(a,b){assert.equal(a,0);assert.equal(b,value.length);}
 };
 const feedback={textContent:''};
 const nodes={copyLoginUid:{addEventListener(name,cb){assert.equal(name,'click');handler=cb;}},loginUid:input,uidCopyStatus:feedback};
 const scope={
  $:id=>nodes[id],document:{execCommand(){return legacy;}},
  navigator:{clipboard:modern?{writeText:async v=>{write=v;}}:undefined}
 };
 vm.createContext(scope);vm.runInContext(copyCode,scope);
 await handler();
 assert.equal(selected,1,'UID must stay selectable even when copying fails');
 assert.equal(focus,1);
 assert.match(feedback.textContent,expectedCopied?/コピーしました/:/選択しました/);
 assert.equal(write,modern&&!legacy?value:'');
}
Promise.resolve().then(async()=>{
 await copyTest({legacy:true,modern:false,expectedCopied:true});
 await copyTest({legacy:false,modern:true,expectedCopied:true});
 await copyTest({legacy:false,modern:false,expectedCopied:false});
 console.log('UID clipboard fallback tests passed: legacy, modern and manual selection.');
}).catch(error=>{console.error(error);process.exitCode=1;});

