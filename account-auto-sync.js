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
  let pendingRegistration=null,registrationBusy=false,authGeneration=0,adminAuthorized=false,viewerPrefsReadEpoch=0;
  let accountSwitchBusy=false;
  // A dedicated print session may READ its own duties but never take over
  // the Galaxy's last-login-wins writerSessionId.
  const printViewerMode=(()=>{
   try{return new URLSearchParams(root.location.search).get('printViewer')==='1';}
   catch{return false;}
  })();
  let deferredWhileEditing=false,deferredWhileLocalSave=false;
  let busy=false,again=false,timer=null,booted=false,settingsMessage='設定の同期状態を確認していません';
  // A single per-UID session listener revokes old editors.
  // User settings use one-off server reads only, never continuous watching.
  let localSignature=null;
  const KEY='taxiapp-account-pref-base-v1-',BACKUP='taxiapp-account-pref-backup-v1-';
  const $=id=>document.getElementById(id);
  function status(message){
   settingsMessage=String(message||'');
   deps.onSettingsStatus?.(settingsMessage);
   const label=$('accountStatus');
   if(label)label.textContent=message;
   if(document.documentElement.classList.contains('taxi-auth-locked')){
    const gateStatus=$('accountGateStatus');
    if(gateStatus)gateStatus.textContent=message;
   }
  }
  // 初期HTMLから営業画面を閉じ、本人UIDと登録状態の確認が完了した後だけ表示。
  function gate(stage,message=''){
   const ready=stage==='ready';
   document.documentElement.classList.toggle('taxi-auth-locked',!ready);
   const panel=$('accountGate');
   if(panel)panel.dataset.stage=stage;
   const guide=$('accountGateGuide');
   const explanations={
    checking:'Googleアカウントと利用登録を確認しています。',
    signedOut:'TAXIAPPを利用するには、Googleアカウントでログインしてください。初めての方は「新規登録」を選んでください。',
    registering:'オプチャネームを入力して「登録を完了」を押してください。登録が確認されるまで営業画面は表示しません。',
    blocked:'利用登録を確認できません。営業データは表示しません。再確認または別のGoogleアカウントを選択してください。',
    error:'ログイン機能の準備・確認に問題があります。営業画面を開かず、既存の端末データを保持します。'
   };
   if(guide)guide.textContent=explanations[stage]||'';
   const canChoose=stage==='signedOut'&&!!auth&&!!fb;
   for(const id of ['accountGateRegister','accountGateSignIn']){
    const button=$(id);
    if(button){button.hidden=stage!=='signedOut';button.disabled=!canChoose||accountSwitchBusy;}
   }
   const switchButton=$('accountGateSwitch');
   if(switchButton)switchButton.hidden=!auth?.currentUser||!['registering','blocked'].includes(stage);
   const retry=$('accountGateRetry');
   if(retry)retry.hidden=stage!=='blocked'||!auth?.currentUser;
   if(message){
    const gateStatus=$('accountGateStatus');
    if(gateStatus)gateStatus.textContent=message;
   }
  }
  function controls(){
   const accountBar=$('accountBar');
   accountBar?.classList.toggle('account-signed-in',!!user);
   document.body?.classList.toggle('taxi-account-signed-in',!!user);
   const signIn=$('accountSignIn'),signOut=$('accountSignOut');
   if(signIn)signIn.hidden=!!user; 
   const initialRegister=$('accountInitialRegister');
   if(initialRegister){initialRegister.hidden=!!user;initialRegister.disabled=accountSwitchBusy;}
   if(signOut)signOut.hidden=!user;
   if(signOut)signOut.disabled=!user||accountSwitchBusy;
   for(const id of ['accountSwitchLogin','accountSwitchRegister']){
    const button=$(id);
    if(button){button.hidden=!user;button.disabled=!user||accountSwitchBusy;}
   }
   const intro=$('accountAccessIntro');
   if(intro)intro.hidden=!!user;
   const identity=$('accountCurrentIdentity');
   if(identity)identity.textContent=user?
    'Google：'+String(user.email||'メール非公開')+'／ UID：'+String(user.uid||'不明'):
    'Googleアカウント：未ログイン';
   const takeOver=$('accountTakeOver');
   if(takeOver)takeOver.hidden=printViewerMode||!user||!enabled||deviceSession?.state()!=='viewer';
   const manageLink=$('accountAdminLink');
   if(manageLink)manageLink.hidden=!user||!adminAuthorized;
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
   // 保存済みの照合基準が壊れていても「初回端末」と誤認して上書きしない。
   const owner=uid;
   if(!owner)throw Error('本人UIDが未確定のため設定照合を開始できません');
   try{
    const raw=localStorage.getItem(KEY+owner);
    if(raw===null)return null; // 正常な初回接続だけが未登録
    const saved=JSON.parse(raw);
    if(!saved||typeof saved!=='object'||Array.isArray(saved))
     throw Error('照合基準の形式が不正です');
    return saved;
   }catch(error){
    throw Error('端末の設定照合基準を読み取れません。既存設定を保護して同期を停止しました：'+
     String(error?.message||error));
   }
  }
  function storeBase(value){
   // Firestoreの読戻しだけで完了とせず、次回のCAS照合に必要な端末基準も永続化する。
   // 書込失敗時は従来の基準を残し「保存確認済み」を表示しない。
   const owner=uid;
   if(!owner||!enabled||auth?.currentUser?.uid!==owner)
    throw Error('本人UIDが変更されたため設定の保存確認を停止しました');
   try{
    const data=JSON.stringify(value);
    localStorage.setItem(KEY+owner,data);
    if(localStorage.getItem(KEY+owner)!==data)
     throw Error('照合基準を端末から読み戻せません');
   }catch(error){
    throw Error('端末の設定照合基準を保存できません。クラウド設定の保存確認を保留しました：'+
     String(error?.message||error));
   }
   if(uid!==owner||auth?.currentUser?.uid!==owner)
    throw Error('設定照合中に本人UIDが変更されました');
   baseline=value;
  }
  function safeBackup(model){
   // クラウドから設定を採用する前に、元の本人設定の退避を確認する。
   // 退避に失敗しても黙って採用すると、復旧可能な原本を失う。
   const owner=uid;
   if(!owner||!enabled||auth?.currentUser?.uid!==owner)
    throw Error('本人の設定退避中にログインが変更されました');
   const key=BACKUP+owner;
   try{
    const existing=localStorage.getItem(key);
    if(existing){
     const saved=JSON.parse(existing);
     if(!saved||typeof saved!=='object'||!saved.prefs||
        typeof saved.prefs!=='object'||Array.isArray(saved.prefs)||
        saved.uid&&saved.uid!==owner)
      throw Error('設定の退避データが不正です');
     return;
    }
    const snapshot=JSON.stringify({
     uid:owner,createdAt:new Date().toISOString(),prefs:model.prefs
    });
    localStorage.setItem(key,snapshot);
    if(localStorage.getItem(key)!==snapshot)
     throw Error('退避データの保存を読み戻し確認できません');
   }catch(error){
    throw Error('端末設定のバックアップを保護できないためクラウド反映を停止しました：'+
     String(error?.message||error));
   }
  }
  const ref=()=>fire.doc(db,'accountSettings',uid);
  // 閲覧端末は操作権を取得せず、本人の月間設定だけをサーバーから読む。
  // ローカル日報やprefsを書き換えず、ログイン変更後の遅延応答を破棄する。
  async function loadViewerMonthlyPrefs(){
   if(!enabled||deviceSession?.state()!=='viewer'||!auth?.currentUser)return;
   const accountUid=uid,generation=authGeneration,readEpoch=++viewerPrefsReadEpoch;
   deps.onMonthlyViewPrefs?.(null,accountUid,'月間設定を取得しています…');
   try{
    const snapshot=await fire.getDocFromServer(ref());
    if(!enabled||readEpoch!==viewerPrefsReadEpoch||uid!==accountUid||authGeneration!==generation||
       auth.currentUser?.uid!==accountUid||deviceSession?.state()!=='viewer')return;
    const prefs=snapshot.exists()?api.validate(snapshot.data()):{};
    deps.onMonthlyViewPrefs?.(prefs,accountUid,
     snapshot.exists()?'月間設定をFirestoreから取得しました':'月間設定は未登録です');
   }catch(error){
    if(enabled&&readEpoch===viewerPrefsReadEpoch&&uid===accountUid&&authGeneration===generation&&
       auth.currentUser?.uid===accountUid&&deviceSession?.state()==='viewer')
     deps.onMonthlyViewPrefs?.(null,accountUid,
      '月間設定を取得できません：'+String(error.code||error.message||error));
   }
  }
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
  // 書込み完了だけで保存済みとしない。本人UIDのサーバー原本と内容を照合する。
  async function verifySavedPrefs(expected,accountUid,sessionGeneration,accountRef){
   if(!stillCurrent(accountUid)||authGeneration!==sessionGeneration||!deviceSession?.canWrite())return false;
   const snapshot=await fire.getDocFromServer(accountRef);
   if(!stillCurrent(accountUid)||authGeneration!==sessionGeneration||!deviceSession?.canWrite())return false;
   if(!snapshot.exists())throw Error('設定を送信しましたがサーバー原本を読み戻せません');
   const actual=api.extract({version:1,shifts:[],prefs:api.validate(snapshot.data())}).prefs;
   if(!api.same(actual,expected))
    throw Error('送信した設定とサーバー原本が一致しません。端末の設定を保持して再照合してください');
   return true;
  }
  async function apply(shared){
   const model=deps.getModel(),newModel=api.merge(model,{
    format:api.FORMAT,schemaVersion:1,prefs:shared
   },{preserveLocalWaiting:false});
   if(api.same(currentPrefs(),api.extract(newModel).prefs))return;
   safeBackup(model);
   await deps.applyPrefs(newModel.prefs);
  }
  // 初回連携でベースラインがない端末の月間設定を保護する。
  // 別の日付・別の目標は統合し、同じ項目の変更が食い違えば双方を保持して保留。
  function mergeInitialMonthlyPrefs(model,remote){
   const adopted=api.extract(api.merge(model,{
    format:api.FORMAT,schemaVersion:1,prefs:remote
   },{preserveLocalWaiting:true})).prefs;
   const local=api.extract(model).prefs;
   const fields=['monthlyDutyPlans','monthlyDutyActuals','monthlySalesGoals',
    'monthlyDutySalesGoals','monthlyWeekdaySalesGoals','monthlyDateSalesGoals',
    'monthlyIncludePublicSales','monthlySalesCloseDay'];
   const subset=prefs=>Object.fromEntries(fields.filter(key=>Object.prototype.hasOwnProperty.call(prefs,key))
    .map(key=>[key,prefs[key]]));
   const joined=api.reconcile({},subset(local),subset(remote));
   if(joined.conflicts.length)throw Error(
    '初回の月間設定に端末とクラウドの競合があります：'+joined.conflicts.slice(0,3).join('、')+
    '。双方を保持して上書きを保留しました');
   return api.extract({version:1,shifts:[],prefs:{...adopted,...joined.prefs}}).prefs;
  }
  async function reconcile(){
   if(!deviceSession?.canWrite())return;
   // 本人の日報読込・端末復元が終わるまで設定を反映しない。
   // 端末保存権がない時刻に同期基準だけ確定させるのを防ぐ。
   if(deps.canApplyPrefs?.()===false){
    status('営業原本の読込完了後に設定を照合します');
    return;
   }
   // 月間設定の入力が端末へ永続保存されるまでFirestore送信を禁止。
   // 編集終了時のblurだけでは端末保存完了とはみなさない。
   if(deps.isLocalSaved?.()===false){
    deferredWhileLocalSave=true;
    status('端末の設定保存を確認してからFirestoreと照合します');
    return;
   }
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
   const accountUid=uid,sessionGeneration=authGeneration,accountRef=ref();
   const sameSession=()=>stillCurrent(accountUid)&&authGeneration===sessionGeneration;
   try{
    status('設定を照合しています…');
    const beginning=currentPrefs();
    // The listener delivered a server-confirmed snapshot already.
    // Do not issue another document read for every reconciliation.
    const cloud=await fire.getDocFromServer(accountRef);
    if(!sameSession()||!deviceSession.canWrite())return;
    const remote=cloud.exists()?api.extract({
     version:1,shifts:[],prefs:api.validate(cloud.data())
    }).prefs:null;
    const base=baseline||readBase();
    if(!remote){
     // 過去に確認済みの設定原本が消えた場合、端末から勝手に再作成しない。
     if(base)throw Error('以前確認したFirestore設定原本がありません。端末の設定を保護して再登録を停止しました');
     // 初回ログインで乗務員名・待機所が未設定でも、月間予定や目標は同期対象。
     // 他端末が先に作成した設定原本は、この後のトランザクションで保護する。
     // Never overwrite a remotely-created document from another device.
     const result=await fire.runTransaction(db,async tx=>{
      if(!sameSession()||!deviceSession.canWrite())throw Error('ログインまたは端末操作権が変わりました。設定を保護して停止しました');
      const doc=await tx.get(accountRef);
      if(!sameSession()||!deviceSession.canWrite())throw Error('設定の初回保存中にログインが変更されました');
      if(doc.exists())return false;
      if(!deviceSession.canWrite())throw Error('閲覧専用端末から保存できません');
      tx.set(accountRef,{format:api.FORMAT,schemaVersion:1,
       prefs:beginning,...writerFields(),updatedAt:fire.serverTimestamp()});
      return true;
     });
     if(!sameSession())return;
     if(result){
      if(!await verifySavedPrefs(beginning,accountUid,sessionGeneration,accountRef))return;
      if(!api.same(currentPrefs(),beginning)){again=true;return;}
      storeBase(beginning);status('設定はFirestore読戻し確認済み');
     }else again=true;
     return result===true;
    }
    if(!base){
     // First login on a device: adopt the account profile but retain waiting
     // locations that were registered here before this device was linked.
     if(!api.same(currentPrefs(),beginning)){again=true;return;}
     const model=deps.getModel();
     const adopted=mergeInitialMonthlyPrefs(model,remote);
     let selected=adopted;
     if(!api.same(adopted,remote)){
      selected=await fire.runTransaction(db,async tx=>{
       if(!sameSession()||!deviceSession.canWrite())throw Error('ログインまたは端末操作権が変わりました。設定を保護して停止しました');
       const latest=await tx.get(accountRef);
       if(!sameSession()||!deviceSession.canWrite())throw Error('設定の初回統合中にログインが変更されました');
       if(!latest.exists())throw Error('クラウド設定が見つかりません');
       const freshest=api.extract({
        version:1,shifts:[],prefs:api.validate(latest.data())
       }).prefs;
       const joined=mergeInitialMonthlyPrefs(model,freshest);
       if(!api.same(joined,freshest))
        tx.update(accountRef,{prefs:joined,...writerFields(),updatedAt:fire.serverTimestamp()});
       return joined;
      });
     }
     if(!sameSession())return;
     if(!api.same(currentPrefs(),beginning)){again=true;return;}
     if(!await verifySavedPrefs(selected,accountUid,sessionGeneration,accountRef))return;
     if(!api.same(currentPrefs(),beginning)){again=true;return;}
     await apply(selected);
     if(!sameSession())return;
     storeBase(selected);
     status('Firestoreの設定を端末に反映し、照合基準を保存しました');
     return true;
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
      if(!sameSession()||!deviceSession.canWrite())throw Error('設定の差分統合前にログインが変更されました');
      const fresh=await tx.get(accountRef);
      if(!sameSession()||!deviceSession.canWrite())throw Error('設定の差分統合中にログインが変更されました');
      if(!fresh.exists())throw Error('クラウド設定が削除されました。確認が必要です');
      const current=api.extract({version:1,shifts:[],prefs:api.validate(fresh.data())}).prefs;
      const resolved=api.reconcile(base,beginning,current);
      if(resolved.conflicts.length)
       throw Error('別端末と同じ項目が同時変更されました。設定を保護するため停止しました');
      if(!api.same(current,resolved.prefs))
       tx.update(accountRef,{prefs:resolved.prefs,...writerFields(),updatedAt:fire.serverTimestamp()});
      return resolved.prefs;
     });
     if(!sameSession())return;
    }
    if(!api.same(currentPrefs(),beginning)){again=true;return;}
    if(!await verifySavedPrefs(result,accountUid,sessionGeneration,accountRef))return;
    if(!api.same(currentPrefs(),beginning)){again=true;return;}
    if(!api.same(result,beginning))await apply(result);
    if(!sameSession())return;
    storeBase(result);
    status('設定のFirestore読戻し確認済み（日報とは別）');
    return true;
   }finally{
    busy=false;
    // Applying a remote update is not a user edit.
    if(sameSession()){
     try{localSignature=api.signature(currentPrefs());}catch{}
    }
    if(again){again=false;schedule(300);}
   }
  }
  // ログアウト直前に月間予定・実績区分・目標を本人Firestoreへ確定させる。
  // タイマー送信を待たず、サーバー読戻しと端末側CAS基準の保存を両方確認する。
  // 競合・保存待機・通信失敗時はログアウトを止め、本人設定を保持する。
  async function syncBeforeSignOut(){
   const accountUid=uid,generation=authGeneration;
   if(!enabled||!accountUid||auth?.currentUser?.uid!==accountUid||
      !deviceSession?.canWrite())return false;
   if(busy||deps.isLocalSaved?.()===false||deps.canApplyPrefs?.()===false||
      deps.isEditing?.()||!navigator.onLine){
    status('月間設定の端末保存またはFirestore照合が未完了です。ログアウトを保留します');
    return false;
   }
   clearTimeout(timer);timer=null;
   try{
    const confirmed=await reconcile();
    if(confirmed!==true||!stillCurrent(accountUid)||authGeneration!==generation||
       !deviceSession?.canWrite())return false;
    const saved=readBase();
    if(!saved||!api.same(saved,currentPrefs())){
     status('月間設定の保存内容が一致しません。ログアウトを保留します');
     return false;
    }
    return true;
   }catch(error){
    status('月間設定の保存確認に失敗：'+String(error?.message||error));
    return false;
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
   gate('checking','認証と本人の登録状態を確認しています…');
   clearTimeout(timer);
   authGeneration++;
   adminAuthorized=false;
   pendingRegistration=null;registrationBusy=false;
   displayRegistration(false);displayOpenChatName('');
   enabled=false;user=next;uid=next?.uid||'';baseline=null;
   deferredWhileEditing=false;deferredWhileLocalSave=false;localSignature=null;
   deviceSession?.clear();
   // Clear the previous account even if the next login is denied or inactive.
   await deps.onUserScope?.(null);
   if(!next)deps.onDeviceMode?.('viewer','','ログインすると操作できます');
   controls();
   if(!next){
    gate('signedOut','新規登録、またはGoogleでログインしてください。');
    status('Googleでログインすると本人の日報を表示します');
    return;
   }
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
    adminAuthorized=admin;
    controls();
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
      gate('registering','本人の登録名を入力してください。');
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
     gate('blocked',reason);
     status(reason);deps.onDeviceMode?.('viewer','','有効な利用者登録がありません');return;
    }
    // 管理者本人が users 未登録の場合も admins の登録名を正しく表示する。
    const accountName=admin&&(!profile||!['active','suspended'].includes(profile.status))?
     adminDoc?.openChatName:profile?.openChatName;
    displayOpenChatName(typeof accountName==='string'?accountName:'');
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
    if(stillSignedIn())gate('ready');
    // The session transition to writer/legacy schedules the initial read.
    // Do not schedule the same login fetch a second time here.
   }catch(e){
    if(!stillSignedIn())return;
    enabled=false;
    await deps.onUserScope?.(null);
    gate('blocked','利用登録の確認に失敗：'+String(e.code||e.message||e));
    status('アカウントの確認に失敗：'+String(e.code||e.message||e));
    deps.onDeviceMode?.('viewer','','利用者情報のサーバー確認に失敗しました');
   }
  }
  async function start(){
   if(booted)return;booted=true;
   if(!root.TAXIAPP_LOGIN_UTILS?.firebaseConfigReady(conf)){
    gate('error','Firebaseのログイン設定を読み込めません。営業原本はそのまま保持しています。');
    status('Googleログインの設定を読み込めません');return;
   }
   async function selectGoogleAccount(intent){
    if(!auth||!fb){status('ログイン機能を読み込み中です…');return;}
    if(accountSwitchBusy)return;
    accountSwitchBusy=true;controls();
    try{
     const previous=auth.currentUser;
     if(previous){
      // GoogleのポップアップはUIDを直ちに切り替えられる。
      // 事前に必ず従来の端末保存・同期待ち保護を実行する。
      const approved=await deps.beforeSignOut?.();
      if(approved===false){
       status('進行中・未同期の日報があるため、アカウント切替を中止しました。');
       return;
      }
      if(auth.currentUser?.uid!==previous.uid)
       throw Error('アカウントを確認中に認証が変わりました。切替を中止しました');
      await fb.signOut(auth);
      // 端末保存・同期を待つとブラウザのポップアップ許可が失われるため、
      // 安全なログアウト後は利用者の次のクリックでGoogle選択を開く。
      status('前のアカウントから安全にログアウトしました。上部の「ログイン」または「新規登録」を押してください。');
      return;
     }
     viewerLogin=printViewerMode;explicitWriterLogin=!printViewerMode;
     const provider=new fb.GoogleAuthProvider();
     provider.setCustomParameters?.({prompt:'select_account'});
     status(intent==='register'?
      '新しいGoogleアカウントを選択してください。登録済みの場合は既存登録にログインします。':
      'ログインするGoogleアカウントを選択してください。');
     await fb.signInWithPopup(auth,provider);
     if(!printViewerMode&&deviceSession?.state()==='viewer'&&enabled)
      await deviceSession.claim();
    }catch(error){
     if(!auth.currentUser)gate('signedOut');
     status('アカウント選択を完了できません：'+String(error.code||error.message||error));
    }finally{
     accountSwitchBusy=false;controls();
     if(!auth.currentUser)gate('signedOut');
    }
   }
   $('accountGateSignIn')?.addEventListener('click',()=>{void selectGoogleAccount('login');});
   $('accountGateRegister')?.addEventListener('click',()=>{void selectGoogleAccount('register');});
   $('accountGateSwitch')?.addEventListener('click',()=>{void selectGoogleAccount('login');});
   $('accountGateRetry')?.addEventListener('click',()=>{
    if(auth?.currentUser)void authChanged(auth.currentUser);
   });
   $('accountSignIn')?.addEventListener('click',()=>{void selectGoogleAccount('login');});
   $('accountInitialRegister')?.addEventListener('click',()=>{
    void selectGoogleAccount('register');
   });
   $('accountSwitchLogin')?.addEventListener('click',()=>{
    void selectGoogleAccount('login');
   });
   $('accountSwitchRegister')?.addEventListener('click',()=>{
    void selectGoogleAccount('register');
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
      else if(next==='viewer'&&next!==previous){
       clearTimeout(timer);void loadViewerMonthlyPrefs();
      }else if(next!=='writer'&&next!=='legacy')clearTimeout(timer);
     }
    });
    a.onAuthStateChanged(auth,next=>{
     if(next)deps.onDeviceMode?.('pending','','操作権を確認しています…');
     return authChanged(next);
    },e=>{
     gate('error','Google認証の状態を取得できません：'+String(e.code||e.message||e));
     status('Google認証エラー：'+String(e.code||e.message||e));
    });
   }catch(e){
    gate('error','Googleログインの準備ができません：'+String(e.message||e));
    status('Googleログインの準備ができません：'+String(e.message||e));
   }
   window.addEventListener('online',()=>{
    if(deviceSession?.state()==='viewer')void loadViewerMonthlyPrefs();
    else schedule(0);
   });
   // No visibility/focus polling: reload settings when login obtains an
   // editing session, and on actual preference changes only.
  }
  function localSaved(){
   if(!enabled)return;
   // 端末書込前の変更は通知しない。保存完了した瞬間だけ同期を解放。
   if(deps.isLocalSaved?.()===false){deferredWhileLocalSave=true;return;}
   const waiting=deferredWhileLocalSave;
   deferredWhileLocalSave=false;
   try{
    const nextSignature=api.signature(currentPrefs());
    // 日報/GPSの保存では設定送信を発生させない。
    if(nextSignature===localSignature){
     if(waiting)schedule(0);
     return;
    }
    localSignature=nextSignature;
    schedule(waiting?0:1000);
   }catch(e){status('設定の確認エラー：'+String(e.message||e));}
  }
  function editingEnded(){
   // Focus-out is an event, not a polling interval. The previous scheduled
   // read may have stopped while the driver was actively editing a field.
   if(!deferredWhileEditing||deps.isEditing?.())return;
   deferredWhileEditing=false;
   schedule(200);
  }
  return {start,localSaved,editingEnded,syncBeforeSignOut,refreshViewerMonthlyPrefs:loadViewerMonthlyPrefs,
   syncNow:()=>{if(enabled&&deviceSession?.canWrite())schedule(0);},
   status:()=>({enabled,uid,mode:deviceSession?.state(),message:settingsMessage})};
 }
};
})(typeof window!=='undefined'?window:globalThis);
