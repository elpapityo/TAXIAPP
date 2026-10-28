'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const live=fs.readFileSync('index.html','utf8');
const demo=fs.readFileSync('demo/index.html','utf8');
const auth=fs.readFileSync('account-auto-sync.js','utf8');
const start='// 初回の利用登録を自分で完了したUIDだけ案内する。';
const end='function setDeviceMode(next,previous=';
const extract=html=>{
 const a=html.indexOf(start),b=html.indexOf(end,a);
 assert.ok(a>=0&&b>a,'初回設定の実コードが存在すること');
 return html.slice(a,b);
};
const source=extract(live);
assert.match(live,/pickupDropDistance:'off',highwayDistance:'on',autoDistance:'off',gpsTripAtStart:'off'/,'新規登録者だけ距離・自動取得の初期値を設定');
assert.match(live,/driveLayout:'meter',simpleMode:'on'/,'メーター型のシンプル表示を初期ON');
assert.match(live,/if\(key==='distanceStart'\|\|key==='distanceEnd'\)return distanceEnabled\('F'\)/,'シンプルモードの距離表示は選択した設定に従う');
assert.equal(extract(demo),source,'公開デモと正式版の初回案内ロジックは同じ');
assert.match(auth,/let createdHere=false;/);
assert.match(auth,/await fire\.setDoc\(profileRef,[\s\S]*?createdHere=true;/);
assert.match(auth,/if\(createdHere\)\{\s*try\{deps\.onInitialRegistrationVerified\?\.\(pending\.uid\);/,
 '新規作成とサーバー検証を完了した本人だけ初回案内する');
assert.match(live,/onInitialRegistrationVerified:firstRunGuideRegistered/);
assert.match(live,/onWriterBootstrapReady:\(\)=>\{[\s\S]*?firstRunGuideActivate\(\)/);
assert.match(live,/renderFirstRunGuideFields\(\)/,'初回専用の入力フォームを利用する');
assert.match(live,/if\(isGuide&&FIRST_RUN_STEPS\[firstRunGuide\.step\]\.id===chosen\.id\)/);
assert.match(live,/data-first-run-action="skip"/);
assert.match(live,/\.first-run-step\.active/,'色と文字で段階を示す');
const memory=new Map(),notice=[];
const ctx={
 model:{prefs:{},version:1,shifts:[]},
 currentLoginScope:{uid:'new-A',firebase:{auth:{currentUser:{uid:'new-A'}}}},
 accountScope:{uid:'new-A'},accountScopeLoaded:true,accountScopeGeneration:2,
 tab:'drive',settingsCategoryActive:'driver',settingsOpenState:null,
 canEditNow:()=>true,getShift:()=>null,safeText:String,
 localStorage:{
  getItem:key=>memory.has(key)?memory.get(key):null,
  setItem:(key,value)=>{memory.set(key,String(value));},
  removeItem:key=>{memory.delete(key);}
 },
 save:async()=>true,render:()=>{},toast:(msg)=>notice.push(msg),
 monthlyGoalInputRaw:()=>'',document:{getElementById:()=>({value:''})}
};
vm.createContext(ctx);
vm.runInContext(source,ctx);
const call=expr=>vm.runInContext(expr,ctx);
(async()=>{
 assert.equal(call('firstRunGuideActive()'),false,'既存利用者は登録がなくても初回扱いしない');
 call('firstRunGuideActivate()');
 assert.equal(ctx.tab,'drive','既存利用者の画面を勝手に変更しない');
 call("firstRunGuideRegistered('new-A')");
 assert.deepEqual(JSON.parse(memory.get('taxiapp-initial-guide-v1-new-A')),{uid:'new-A',step:0});
 call('firstRunGuideActivate()');
 assert.equal(ctx.tab,'settings');
 assert.equal(call('firstRunGuideActive()'),true);
 assert.match(call('renderFirstRunGuide()'),/3 \/ 7/);
 assert.match(call('renderFirstRunGuide()'),/メーターモード/);
 let saves=0;
 ctx.save=async()=>{saves++;return false;};
 await call("firstRunGuideAction('next')");
 assert.equal(call('firstRunGuide.step'),0,'端末の保存に失敗したら次へ進まない');
 ctx.save=async()=>{saves++;return true;};
 await call("firstRunGuideAction('next')");
 assert.equal(call('firstRunGuide.step'),1);
 assert.equal(ctx.settingsCategoryActive,'driver');
 assert.equal(JSON.parse(memory.get('taxiapp-initial-guide-v1-new-A')).step,1);
 // 同一UIDで再ログインした場合だけ中断時の段階を復元する。
 call("firstRunGuide=null;tab='drive';firstRunGuideActivate()");
 assert.equal(call('firstRunGuide.step'),1);
 assert.equal(ctx.tab,'settings');
 await call("firstRunGuideAction('next')");
 assert.equal(ctx.settingsCategoryActive,'gps');
 await call("firstRunGuideAction('next')");
 assert.equal(ctx.settingsCategoryActive,'display');
 await call("firstRunGuideAction('next')");
 assert.equal(ctx.settingsCategoryActive,'monthly');
 assert.match(call('renderFirstRunGuide()'),/保存して利用開始/);
 await call("firstRunGuideAction('finish')");
 assert.equal(ctx.model.prefs.initialGuideCompleted,true);
 assert.equal(call('firstRunGuideActive()'),false);
 assert.equal(memory.has('taxiapp-initial-guide-v1-new-A'),false);
 call('firstRunGuideActivate()');
 assert.equal(call('firstRunGuideActive()'),false,'完了した初期設定を再開しない');
 assert.ok(saves>=5,'保存確認後に進んだ');

 // 閲覧専用PCや違うUIDから、他の利用者の初期設定を表示・完了しない。
 ctx.model.prefs={};ctx.currentLoginScope.uid='new-B';
 ctx.currentLoginScope.firebase.auth.currentUser.uid='new-B';
 ctx.accountScope.uid='new-B';
 call("firstRunGuideRegistered('new-B')");
 ctx.canEditNow=()=>false;
 assert.equal(call('firstRunGuideActive()'),false);
 ctx.tab='drive';ctx.settingsCategoryActive='gps';
 call('firstRunGuideActivate()');
 assert.equal(ctx.tab,'drive','閲覧専用で強制的に設定画面へ移さない');
 assert.equal(ctx.settingsCategoryActive,'gps','閲覧専用では設定分類を変更しない');
 ctx.canEditNow=()=>true;
 ctx.accountScope.uid='new-A';
 assert.equal(call('firstRunGuideActive()'),false,'別UIDには初期設定の表示を許可しない');
 ctx.accountScope.uid='new-B';
 await call("firstRunGuideAction('skip')");
 assert.equal(ctx.model.prefs.initialGuideCompleted,undefined,'中断しても完了扱いにしない');
 assert.equal(memory.has('taxiapp-initial-guide-v1-new-B'),true,'本人の再開位置を残す');
 call('firstRunGuideActivate()');
 assert.equal(call('firstRunGuideActive()'),true,'次回は中断位置から再開する');
 console.log('PASS: 新規登録UID限定・7項目登録・保存失敗保護・再ログイン再開・UID分離');
})().catch(error=>{console.error(error);process.exitCode=1;});


// 登録サーバーの返答ごとに実働のcompleteRegistrationを実行する。
// 既存アカウントや競合中の登録から、新規利用者ガイドを誤起動させない。
const registrationStart=auth.indexOf('async function completeRegistration(){');
const registrationEnd=auth.indexOf('async function authChanged(next){',registrationStart);
assert.ok(registrationStart>0&&registrationEnd>registrationStart);
const registrationSource=auth.slice(registrationStart,registrationEnd);
async function simulateRegistration({existing=false,concurrent=false,verified=true}={}){
 const hits=[],messages=[],writes=[];
 const user={uid:'member-1',getIdTokenResult:async()=>({})};
 const record={status:'active',openChatName:'新人乗務員'};
 let present=existing,reads=0;
 const reg={
  pendingRegistration:{uid:'member-1',user,generation:7},registrationBusy:false,
  authGeneration:7,auth:{currentUser:user},db:{},
  fire:{
   doc:(_db,col,uid)=>({path:col+'/'+uid}),
   getDocFromServer:async()=>{reads++;
    const exists=present&&(!verified||reads===1?true:verified);
    return {exists:()=>exists,data:()=>record};
   },
   setDoc:async(ref,doc)=>{writes.push({ref,doc});present=true;
    if(concurrent)throw Error('concurrent registration');},
   serverTimestamp:()=>({serverTime:true})
  },
  root:{TAXIAPP_LOGIN_UTILS:{
   normalizeOpenChatName:name=>name,
   autoRegistrationDecision:()=> 'create'
  }},
  $:()=>({value:'新人乗務員'}),displayRegistration:()=>{},
  status:message=>messages.push(message),console,
  deps:{onInitialRegistrationVerified:uid=>hits.push(uid)},
  explicitWriterLogin:false,printViewerMode:false,
  authChanged:async()=>{}
 };
 vm.createContext(reg);vm.runInContext(registrationSource,reg);
 await vm.runInContext('completeRegistration()',reg);
 return {hits,writes,messages,reg};
}
(async()=>{
 const created=await simulateRegistration();
 assert.deepEqual(created.hits,['member-1'],'新規登録＋サーバー読戻し後だけ案内');
 assert.equal(created.writes.length,1);
 const known=await simulateRegistration({existing:true});
 assert.deepEqual(known.hits,[],'既存アカウントには表示しない');
 assert.equal(known.writes.length,0,'既存プロフィールを書き換えない');
 const simultaneous=await simulateRegistration({concurrent:true});
 assert.deepEqual(simultaneous.hits,[],'同時登録されたユーザーを初回登録と誤認しない');
 assert.equal(simultaneous.writes.length,1);
 console.log('PASS: 本人の新規登録作成と読戻し後だけ初回設定を案内');
})().catch(error=>{console.error(error);process.exitCode=1;});
