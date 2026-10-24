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
  let deviceSession=null,viewerLogin=false,explicitWriterLogin=false;
  let pendingRegistration=null,registrationBusy=false,authGeneration=0;
  // A dedicated print session may READ its own duties but never take over
  // the Galaxy's last-login-wins writerSessionId.
  const printViewerMode=(()=>{
   try{return new URLSearchParams(root.location.search).get('printViewer')==='1';}
   catch{return false;}
  })();
  let deferredWhileEditing=false;
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
   if(signOut)signOut.hidden=!user;
   if(signOut)signOut.disabled=!user;
   const takeOver=$('accountTakeOver');
   if(takeOver)takeOver.hidden=printViewerMode||!user||!enabled||deviceSession?.state()!=='viewer';
  }
  function displayRegistration(open){
   const panel=$('accountRegistration');
   if(panel)panel.hidden=!open;
   const button=$('accountRegister');
   if(button)button.disabled=!open||registrationBusy;
   if(!open){const input=$('accountOpenChatName');if(input)input.value='';}
  }
  function displayOpenChatName(name){
   const label=$('accountOpenChatNameLabel');
   if(!label)return;
   label.hidden=!name;
   label.textContent=name?'オプチャネーム：'+name:'';
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
    // Wait until editing actually ends. Polling every 2.5 seconds generates
    // repeated status changes and may turn into endless cloud reads.
    deferredWhileEditing=true;
    status('入力中：設定の保存は入力終了まで保留');
    return;
   }
   deferredWhileEditing=false;
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
    status('設定情報の同期確認済み（日報とは別）');
   }finally{
    busy=false;
    // Applying a remote update is not a user edit.
    if(stillCurrent(accountUid)){
     try{localSignature=api.signature(currentPrefs());}catch{}
    }
    if(again){again=false;schedule(300);}
   }
  }
  async function completeRegistration(){
   const pending=pendingRegistration;
   if(!pending||registrationBusy||!auth||!fire)return;
   let name;
   try{name=root.TAXIAPP_LOGIN_UTILS.normalizeOpenChatName(
    $('accountOpenChatName')?.value);}
   catch(error){
    status(String(error.message||error));
    $('accountOpenChatName')?.focus?.();
    return;
   }
   registrationBusy=true;displayRegistration(true);
   const valid=()=>pendingRegistration===pending&&
    authGeneration===pending.generation&&auth.currentUser?.uid===pending.uid;
   const profileRef=fire.doc(db,'users',pending.uid);
   try{
    const credentials=await pending.user.getIdTokenResult();
    if(!valid())return;
    if(root.TAXIAPP_LOGIN_UTILS.autoRegistrationDecision(
      pending.user,null,null,credentials)!=='create')
     throw Error('Googleアカウントの本人確認ができません');
    // No users/{uid} document is created until the name is supplied.
    // Existing documents may NEVER be changed through self-registration.
    const current=await fire.getDocFromServer(profileRef);
    if(!valid())return;
    if(current.exists()){
     if(current.data()?.status!=='active')
      throw Error('この利用登録は停止または保留中です');
    }else{
     status('オプチャネームと利用登録を保存しています…');
     try{
      await fire.setDoc(profileRef,{
       status:'active',openChatName:name,registeredAt:fire.serverTimestamp()
      });
     }catch(error){
      if(!valid())return;
      // A concurrent login might have created the profile. Read back the
      // result rather than overwriting an existing or suspended account.
      const simultaneous=await fire.getDocFromServer(profileRef);
      if(!valid())return;
      if(!simultaneous.exists()||simultaneous.data()?.status!=='active')
       throw Error('自動登録に失敗しました。Firestoreの登録ルールを確認してください（'+
        String(error.code||error.message||error)+'）');
     }
    }
    const verified=await fire.getDocFromServer(profileRef);
    if(!valid())return;
    const profile=verified.exists()?verified.data():null;
    if(profile?.status!=='active')
     throw Error('本人の利用登録をサーバーで確認できません');
    if(!profile.openChatName)
     throw Error('オプチャネームの保存を確認できません');
    pendingRegistration=null;displayRegistration(false);
    explicitWriterLogin=!printViewerMode;
    status('オプチャネームを登録しました');
    await authChanged(pending.user);
   }catch(error){
    if(valid())status('登録できません：'+String(error.code||error.message||error));
   }finally{
    registrationBusy=false;
    if(pendingRegistration===pending)displayRegistration(true);
   }
  }
  async function authChanged(next){
   clearTimeout(timer);
   authGeneration++;
   pendingRegistration=null;registrationBusy=false;
   displayRegistration(false);displayOpenChatName('');
   enabled=false;user=next;uid=next?.uid||'';baseline=null;
   deferredWhileEditing=false;localSignature=null;
   deviceSession?.clear();
   // Clear the previous account even if the next login is denied or inactive.
   await deps.onUserScope?.(null);
   if(!next)deps.onDeviceMode?.('viewer','','ログインすると操作できます');
   controls();
   if(!next){status('Googleログインで設定を端末間共有');return;}
   status('Googleアカウントを確認しています…');
   const accountUid=uid,generation=authGeneration;
   const stillSignedIn=()=>authGeneration===generation&&uid===accountUid&&auth.currentUser?.uid===accountUid;
   try{
    const profileRef=fire.doc(db,'users',accountUid);
    const [adminSnap,userSnap]=await Promise.all([
     fire.getDocFromServer(fire.doc(db,'admins',accountUid)),
     fire.getDocFromServer(profileRef)
    ]);
    if(!stillSignedIn())return;
    const adminDoc=adminSnap.exists()?adminSnap.data():null;
    const admin=adminDoc?.enabled===true;
    let profile=userSnap.exists()?userSnap.data():null;
    let active=profile?.status==='active';
    if(!admin&&!userSnap.exists()){
     const tokenInfo=await next.getIdTokenResult();
     if(!stillSignedIn())return;
     const decision=root.TAXIAPP_LOGIN_UTILS.autoRegistrationDecision(
      next,adminDoc,profile,tokenInfo);
     if(decision==='create'){
      // The user chooses their LINE Open Chat name. It stays in the private
      // user profile, reserved for a future consent-based public display.
      // This is not verification against the LINE service.
      pendingRegistration={uid:accountUid,user:next,generation:authGeneration};
      displayRegistration(true);
      status('初回登録：オプチャネームを入力して「登録を完了」を押してください');
      deps.onDeviceMode?.('viewer','','オプチャネーム登録待ち（入力停止）');
      return;
     }
    }
    if(!admin&&!active){
     const reason=profile?.status==='suspended'?
      'この利用者は停止中です。自動では利用再開しません':
      profile?'利用者登録が保留中です。自動では既存登録を変更しません':
      '利用登録がありません。認証済みGoogleアカウントでログインしてください';
     status(reason);deps.onDeviceMode?.('viewer','','有効な利用者登録がありません');return;
    }
    displayOpenChatName(typeof profile?.openChatName==='string'?profile.openChatName:'');
    // The account's duty namespace MUST be selected before either settings
    // reconciliation or editor-session confirmation can access local records.
    await deps.onUserScope?.({
     uid,admin,active,
     firebase:{f:fire,db,auth,session:deviceSession}
    });
    if(!stillSignedIn())return;
    enabled=true;
    baseline=readBase();
    localSignature=api.signature(currentPrefs());
    status('ログイン済み：操作端末を確認しています');
    await deviceSession.begin(next,{
     viewer:printViewerMode,claimOnLogin:!printViewerMode&&explicitWriterLogin
    });
    viewerLogin=false;explicitWriterLogin=false;
    // The session transition to writer/legacy schedules the initial read.
    // Do not schedule the same login fetch a second time here.
   }catch(e){if(!stillSignedIn())return;await deps.onUserScope?.(null);status('アカウントの確認に失敗：'+String(e.code||e.message||e));deps.onDeviceMode?.('viewer','','利用者情報のサーバー確認に失敗しました');}
  }
  async function start(){
   if(booted)return;booted=true;
   if(!root.TAXIAPP_LOGIN_UTILS?.firebaseConfigReady(conf)){
    status('Googleログイン準備中（従来版は利用可能）');return;
   }
   $('accountSignIn')?.addEventListener('click',async()=>{
    if(!auth){status('ログイン機能を読み込み中です…');return;}
    viewerLogin=printViewerMode;explicitWriterLogin=!printViewerMode;
    try{
     await fb.signInWithPopup(auth,new fb.GoogleAuthProvider());
     if(!printViewerMode&&deviceSession?.state()==='viewer')await deviceSession.claim();
    }catch(e){status('ログイン失敗：'+String(e.code||e.message||e));}
   });
   $('accountRegister')?.addEventListener('click',()=>{void completeRegistration();});
   $('accountOpenChatName')?.addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();void completeRegistration();}
   });
   $('accountTakeOver')?.addEventListener('click',()=>{
    if(printViewerMode)return;
    explicitWriterLogin=true;
    if(!enabled){status('利用者登録を確認できないため操作権を取得できません');return;}
    deviceSession?.claim().catch(e=>status('切替失敗：'+String(e.message||e)));
   });
   $('accountSignOut')?.addEventListener('click',async()=>{
    if(!auth)return;
    const button=$('accountSignOut');
    if(button)button.disabled=true;
    try{
     const allowed=await deps.beforeSignOut?.();
     if(allowed===false){
      status('日報の最終保存を確認できません。端末原本を保持し、ログアウトを保留しました。');
      return;
     }
     await fb.signOut(auth);
    }catch(e){status('ログアウト前の照合に失敗：'+String(e.code||e.message||e));}
    finally{controls();}
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
      if(next!==previous){
       if(next==='writer')status('操作可能：この端末が営業入力できます');
       else if(next==='viewer')status('閲覧専用：操作する端末の切り替えは画面上部から');
       else status('ログイン済み：操作権をサーバーで確認しています');
      }
      // A repeated Firestore session snapshot must NOT cause another
      // settings read when the editing permission has not changed.
      if(next==='writer'&&next!==previous)schedule(0);
      else if(next!=='writer'&&next!=='legacy')clearTimeout(timer);
     }
    });
    a.onAuthStateChanged(auth,next=>{
     if(next)deps.onDeviceMode?.('pending','','操作権を確認しています…');
     return authChanged(next);
    },
     e=>status('Google認証エラー：'+String(e.code||e.message||e)));
   }catch(e){status('Googleログインの準備ができません：'+String(e.message||e));}
   window.addEventListener('online',()=>schedule(0));
   // No visibility/focus polling: reload settings when login obtains an
   // editing session, and on actual preference changes only.
  }
  function localSaved(){
   if(!enabled)return;
   try{
    const nextSignature=api.signature(currentPrefs());
    // Duty records and GPS events are saved often; they must not
    // trigger settings traffic when preferences are unchanged.
    if(nextSignature===localSignature)return;
    localSignature=nextSignature;
    schedule(1000);
   }catch(e){status('設定の確認エラー：'+String(e.message||e));}
  }
  function editingEnded(){
   // Focus-out is an event, not a polling interval. The previous scheduled
   // read may have stopped while the driver was actively editing a field.
   if(!deferredWhileEditing||deps.isEditing?.())return;
   deferredWhileEditing=false;
   schedule(200);
  }
  return {start,localSaved,editingEnded,status:()=>({enabled,uid,mode:deviceSession?.state()})};
 }
};
})(typeof window!=='undefined'?window:globalThis);
