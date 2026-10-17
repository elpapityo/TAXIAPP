/* TAXIAPP: transparent, account-scoped preferences sync.
 * The existing per-duty Google Apps Script sync remains independent.
 * User settings never contain the Apps Script key or device-only bridge options.
 */
(function(root){
'use strict';
root.TAXIAPP_ACCOUNT_AUTO={
 create(deps){
  const api=root.TAXIAPP_ACCOUNT_SETTINGS,conf=root.TAXIAPP_FIREBASE_CONFIG;
  let auth=null,fb=null,fire=null,db=null,user=null,enabled=false,uid='',baseline=null;
  let deviceSession=null,viewerLogin=false,explicitWriterLogin=false,lastCloudRead=0;
  let busy=false,again=false,timer=null,booted=false;
  // A single per-UID session listener revokes old editors.
  // User settings use one-off server reads only, never continuous watching.
  let localSignature=null;
  const KEY='taxiapp-account-pref-base-v1-',BACKUP='taxiapp-account-pref-backup-v1-';
  const $=id=>document.getElementById(id);
  function status(message){
   const label=$('accountStatus');
   if(label)label.textContent=message;
  }
  function controls(){
   const signIn=$('accountSignIn'),signOut=$('accountSignOut');
   if(signIn)signIn.hidden=!!user;
   const viewLogin=$('accountViewSignIn');
   if(viewLogin)viewLogin.hidden=!!user;
   if(signOut)signOut.hidden=!user;
   if(signOut)signOut.disabled=!user;
   const takeOver=$('accountTakeOver');
   if(takeOver)takeOver.hidden=!user||deviceSession?.state()!=='viewer';
  }
  function currentPrefs(){return api.extract(deps.getModel()).prefs;}
  function readBase(){
   try{const v=JSON.parse(localStorage.getItem(KEY+uid)||'null');
    return v&&typeof v==='object'&&!Array.isArray(v)?v:null;
   }catch{return null;}
  }
  function storeBase(value){
   baseline=value;
   try{localStorage.setItem(KEY+uid,JSON.stringify(value));}catch{}
  }
  function safeBackup(model){
   // Preserve prior local preferences before adopting changes from the cloud.
   // Keep only a per-account single rollback; do not duplicate sales data.
   try{
    if(!localStorage.getItem(BACKUP+uid))
     localStorage.setItem(BACKUP+uid,JSON.stringify({
      createdAt:new Date().toISOString(),prefs:model.prefs
     }));
   }catch{}
  }
  const ref=()=>fire.doc(db,'accountSettings',uid);
  function schedule(ms=900){
   if(!enabled||!deviceSession?.canWrite())return;
   clearTimeout(timer);
   timer=setTimeout(()=>{timer=null;reconcile().catch(e=>{
    status('設定同期エラー：'+String(e.code||e.message||e));
   });},ms);
  }
  // Legacy Firebase rules have not been updated yet: do not break existing settings writes.
  const writerFields=()=>deviceSession?.state()==='writer'
   ?{writerSessionId:deviceSession.sessionId()}:{};
  function stillCurrent(accountUid){return enabled&&uid===accountUid&&auth.currentUser?.uid===accountUid;}
  async function apply(shared){
   const model=deps.getModel(),newModel=api.merge(model,{
    format:api.FORMAT,schemaVersion:1,prefs:shared
   },{preserveLocalWaiting:false});
   if(api.same(currentPrefs(),api.extract(newModel).prefs))return;
   safeBackup(model);
   await deps.applyPrefs(newModel.prefs);
  }
  async function reconcile(){
   if(!deviceSession?.canWrite())return;
   if(enabled&&deps.isEditing?.()){
    status('入力中のため設定同期を一時保留しています');
    schedule(2500);
    return;
   }
   if(!enabled||!navigator.onLine){if(enabled)status('オフライン：設定は端末に保存中');return;}
   if(busy){again=true;return;}
   busy=true;
   const accountUid=uid;
   try{
    status('設定を照合しています…');
    const beginning=currentPrefs();
    // The listener delivered a server-confirmed snapshot already.
    // Do not issue another document read for every reconciliation.
    const cloud=await fire.getDocFromServer(ref());
    lastCloudRead=Date.now();
    if(!stillCurrent(accountUid)||!deviceSession.canWrite())return;
    const remote=cloud.exists()?api.extract({
     version:1,shifts:[],prefs:api.validate(cloud.data())
    }).prefs:null;
    const base=baseline||readBase();
    if(!remote){
     const summary=api.summary(beginning);
     if(summary.driver==='（未設定）'&&summary.waitPlaceCount===0){
      status('Google接続済み・設定は未登録');return;
     }
     // Never overwrite a remotely-created document from another device.
     const result=await fire.runTransaction(db,async tx=>{
      const doc=await tx.get(ref());
      if(doc.exists())return false;
      if(!deviceSession.canWrite())throw Error('閲覧専用端末から保存できません');
      tx.set(ref(),{format:api.FORMAT,schemaVersion:1,
       prefs:beginning,...writerFields(),updatedAt:fire.serverTimestamp()});
      return true;
     });
     if(!stillCurrent(accountUid))return;
     if(result){storeBase(beginning);status('設定は自動保存済み');}
     else again=true;
     return;
    }
    if(!base){
     // First login on a device: adopt the account profile but retain waiting
     // locations that were registered here before this device was linked.
     if(!api.same(currentPrefs(),beginning)){again=true;return;}
     const model=deps.getModel();
     const adopted=api.extract(api.merge(model,{
      format:api.FORMAT,schemaVersion:1,prefs:remote
     },{preserveLocalWaiting:true})).prefs;
     let selected=adopted;
     if(!api.same(adopted,remote)){
      selected=await fire.runTransaction(db,async tx=>{
       const latest=await tx.get(ref());
       if(!latest.exists())throw Error('クラウド設定が見つかりません');
       const freshest=api.extract({
        version:1,shifts:[],prefs:api.validate(latest.data())
       }).prefs;
       const joined=api.extract(api.merge(model,{
        format:api.FORMAT,schemaVersion:1,prefs:freshest
       },{preserveLocalWaiting:true})).prefs;
       if(!api.same(joined,freshest))
        tx.update(ref(),{prefs:joined,...writerFields(),updatedAt:fire.serverTimestamp()});
       return joined;
      });
     }
     if(!stillCurrent(accountUid))return;
     if(!api.same(currentPrefs(),beginning)){again=true;return;}
     await apply(selected);
     if(!stillCurrent(accountUid))return;
     storeBase(selected);
     status('Googleの設定を自動で反映しました');
     return;
    }
    const merged=api.reconcile(base,beginning,remote);
    if(merged.conflicts.length){
     status('設定の同時変更を検出：上書きを保留しました（'+merged.conflicts.slice(0,2).join('、')+'）');
     return;
    }
    if(!api.same(currentPrefs(),beginning)){again=true;return;}
    let result=merged.prefs;
    if(!api.same(result,remote)){
     result=await fire.runTransaction(db,async tx=>{
      const fresh=await tx.get(ref());
      if(!fresh.exists())throw Error('クラウド設定が削除されました。確認が必要です');
      const current=api.extract({version:1,shifts:[],prefs:api.validate(fresh.data())}).prefs;
      const resolved=api.reconcile(base,beginning,current);
      if(resolved.conflicts.length)
       throw Error('別端末と同じ項目が同時変更されました。設定を保護するため停止しました');
      if(!api.same(current,resolved.prefs))
       tx.update(ref(),{prefs:resolved.prefs,...writerFields(),updatedAt:fire.serverTimestamp()});
      return resolved.prefs;
     });
     if(!stillCurrent(accountUid))return;
    }
    if(!api.same(currentPrefs(),beginning)){again=true;return;}
    if(!api.same(result,beginning))await apply(result);
    if(!stillCurrent(accountUid))return;
    storeBase(result);
    status('設定はGoogleと同期済み');
   }finally{
    busy=false;
    // Applying a remote update is not a user edit.
    if(stillCurrent(accountUid)){
     try{localSignature=JSON.stringify(currentPrefs());}catch{}
    }
    if(again){again=false;schedule(300);}
   }
  }
  async function authChanged(next){
   clearTimeout(timer);
   enabled=false;user=next;uid=next?.uid||'';baseline=null;
   lastCloudRead=0;localSignature=null;
   if(!next){deviceSession?.clear();deps.onDeviceMode?.('viewer','','ログインすると操作できます');}
   controls();
   if(!next){status('Googleログインで設定を端末間共有');return;}
   status('Googleアカウントを確認しています…');
   try{
    const [adminSnap,userSnap]=await Promise.all([
     fire.getDoc(fire.doc(db,'admins',uid)),
     fire.getDoc(fire.doc(db,'users',uid))
    ]);
    if(auth.currentUser?.uid!==uid)return;
    const admin=adminSnap.exists()&&adminSnap.data()?.enabled===true;
    const active=userSnap.exists()&&userSnap.data()?.status==='active';
    if(!admin&&!active){status('利用登録待ち：設定同期は停止中');return;}
    // A shared browser must not send the previous driver's preferences to
    // a different Firebase account. Full account-switch isolation comes later.
    const bound=localStorage.getItem('taxiapp-bound-account-uid-v1');
    if(bound&&bound!==uid){
     status('別のGoogleアカウントです。端末データ保護のため自動同期を停止しました');
     return;
    }
    try{localStorage.setItem('taxiapp-bound-account-uid-v1',uid);}catch{
     status('アカウント識別を保存できません。安全のため同期を停止しました');
     return;
    }
    enabled=true;
    baseline=readBase();
    localSignature=JSON.stringify(currentPrefs());
    status('ログイン済み：操作端末を確認しています');
    await deviceSession.begin(next,{viewer:!explicitWriterLogin});
    viewerLogin=false;explicitWriterLogin=false;
    if(deviceSession.canWrite())schedule(0);
   }catch(e){status('アカウントの確認に失敗：'+String(e.code||e.message||e));}
  }
  async function start(){
   if(booted)return;booted=true;
   if(!root.TAXIAPP_LOGIN_UTILS?.firebaseConfigReady(conf)){
    status('Googleログイン準備中（従来版は利用可能）');return;
   }
   $('accountSignIn')?.addEventListener('click',async()=>{
    if(!auth){status('ログイン機能を読み込み中です…');return;}
    viewerLogin=false;explicitWriterLogin=true;
    try{
     await fb.signInWithPopup(auth,new fb.GoogleAuthProvider());
     if(deviceSession?.state()==='viewer')await deviceSession.claim();
    }catch(e){status('ログイン失敗：'+String(e.code||e.message||e));}
   });
   $('accountViewSignIn')?.addEventListener('click',async()=>{
    if(!auth)return;
    viewerLogin=true;explicitWriterLogin=false;
    try{
     await fb.signInWithPopup(auth,new fb.GoogleAuthProvider());
     deviceSession?.viewOnly();
    }catch(e){status('閲覧ログイン失敗：'+String(e.code||e.message||e));}
   });
   $('accountTakeOver')?.addEventListener('click',()=>{
    explicitWriterLogin=true;
    deviceSession?.claim().catch(e=>status('切替失敗：'+String(e.message||e)));
   });
   $('accountSignOut')?.addEventListener('click',()=>{
    if(auth)fb.signOut(auth).catch(e=>status('ログアウト失敗：'+String(e.code||e.message||e)));
   });
   try{
    const version='12.4.0';
    const [{initializeApp,getApps,getApp},a,f]=await Promise.all([
     import('https://www.gstatic.com/firebasejs/'+version+'/firebase-app.js'),
     import('https://www.gstatic.com/firebasejs/'+version+'/firebase-auth.js'),
     import('https://www.gstatic.com/firebasejs/'+version+'/firebase-firestore.js')
    ]);
    fb=a;fire=f;
    const firebaseApp=getApps().length?getApp():initializeApp(conf);
    auth=a.getAuth(firebaseApp);db=f.getFirestore(firebaseApp);
    deviceSession=root.TAXIAPP_DEVICE_SESSION.create({
     auth,f,db,onMode:(next,previous,detail)=>{
      deps.onDeviceMode?.(next,previous,detail);
      if(next==='writer'||next==='legacy')schedule(0);
      else clearTimeout(timer);
     }
    });
    a.onAuthStateChanged(auth,next=>{
     if(next)deps.onDeviceMode?.('pending','','操作権を確認しています…');
     return authChanged(next);
    },
     e=>status('Google認証エラー：'+String(e.code||e.message||e)));
   }catch(e){status('Googleログインの準備ができません：'+String(e.message||e));}
   window.addEventListener('online',()=>schedule(0));
   document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&Date.now()-lastCloudRead>120000)schedule(300);
   });
  }
  function localSaved(){
   if(!enabled)return;
   try{
    const nextSignature=JSON.stringify(currentPrefs());
    // Duty records and GPS events are saved often; they must not
    // trigger settings traffic when preferences are unchanged.
    if(nextSignature===localSignature)return;
    localSignature=nextSignature;
    schedule(1000);
   }catch(e){status('設定の確認エラー：'+String(e.message||e));}
  }
  return {start,localSaved,status:()=>({enabled,uid,mode:deviceSession?.state()})};
 }
};
})(typeof window!=='undefined'?window:globalThis);
