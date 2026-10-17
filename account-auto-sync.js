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
  let busy=false,again=false,timer=null,unsubscribe=null,booted=false;
  // onSnapshot is itself a real-time network listener. Reuse its document
  // instead of adding a second charged getDocFromServer for every event.
  let liveSnapshot=null,liveSignature=null,localSignature=null;
  const KEY='taxiapp-account-pref-base-v1-',BACKUP='taxiapp-account-pref-backup-v1-';
  const $=id=>document.getElementById(id);
  function status(message){
   const label=$('accountStatus');
   if(label)label.textContent=message;
  }
  function controls(){
   const signIn=$('accountSignIn'),signOut=$('accountSignOut');
   if(signIn)signIn.hidden=!!user;
   if(signOut)signOut.hidden=!user;
   if(signOut)signOut.disabled=!user;
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
   if(!enabled)return;
   clearTimeout(timer);
   timer=setTimeout(()=>{timer=null;reconcile().catch(e=>{
    status('設定同期エラー：'+String(e.code||e.message||e));
   });},ms);
  }
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
   if(!liveSnapshot){return;}
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
    const cloud=liveSnapshot;
    if(!stillCurrent(accountUid))return;
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
      tx.set(ref(),{format:api.FORMAT,schemaVersion:1,
       prefs:beginning,updatedAt:fire.serverTimestamp()});
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
        tx.update(ref(),{prefs:joined,updatedAt:fire.serverTimestamp()});
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
       tx.update(ref(),{prefs:resolved.prefs,updatedAt:fire.serverTimestamp()});
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
   if(unsubscribe){unsubscribe();unsubscribe=null;}
   enabled=false;user=next;uid=next?.uid||'';baseline=null;
   liveSnapshot=null;liveSignature=null;localSignature=null;
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
    status('Googleに接続しています…');
    // A single document listener covers initial load and remote changes.
    // Ignore metadata-only events and local pending writes; never add a
    // getDocFromServer call for each snapshot or ordinary duty save.
    unsubscribe=fire.onSnapshot(ref(),{includeMetadataChanges:true},snap=>{
     if(!enabled||uid!==next.uid)return;
     if(snap.metadata.fromCache||snap.metadata.hasPendingWrites)return;
     const signature=snap.exists()?JSON.stringify(snap.data().prefs):'__missing__';
     if(signature===liveSignature)return;
     liveSignature=signature;
     liveSnapshot=snap;
     schedule(250);
    },e=>status('クラウド監視エラー：'+String(e.code||e.message||e)));
   }catch(e){status('アカウントの確認に失敗：'+String(e.code||e.message||e));}
  }
  async function start(){
   if(booted)return;booted=true;
   if(!root.TAXIAPP_LOGIN_UTILS?.firebaseConfigReady(conf)){
    status('Googleログイン準備中（従来版は利用可能）');return;
   }
   $('accountSignIn')?.addEventListener('click',async()=>{
    if(!auth){status('ログイン機能を読み込み中です…');return;}
    try{await fb.signInWithPopup(auth,new fb.GoogleAuthProvider());}
    catch(e){status('ログイン失敗：'+String(e.code||e.message||e));}
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
    a.onAuthStateChanged(auth,next=>authChanged(next),
     e=>status('Google認証エラー：'+String(e.code||e.message||e)));
   }catch(e){status('Googleログインの準備ができません：'+String(e.message||e));}
   window.addEventListener('online',()=>schedule(0));
   document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')schedule(300);
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
  return {start,localSaved,status:()=>({enabled,uid})};
 }
};
})(typeof window!=='undefined'?window:globalThis);
