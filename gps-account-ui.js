/* 既存GPS試験画面の本人連携。位置・履歴・日報の書込を開始しない。 */
(function(){'use strict';
const panel=document.getElementById('gpsAccountPanel'),button=document.getElementById('gpsAccountLink'),status=document.getElementById('gpsAccountStatus');
const config=window.TAXIAPP_GPS_ACCOUNT_CONFIG,project=window.TAXIAPP_GPS_FIREBASE_PROJECT,core=window.TAXIAPP_GPS_ACCOUNT_BRIDGE;
if(!panel||!button||!status||config?.enabled!==true||!project||!core)return;
panel.hidden=false;
let loading=null,sessionReady=null,client=null,busy=false,trialPending=null,archive=null;
const historyTrial=document.getElementById('gpsHistoryBackendTrial'),historyStatus=document.getElementById('gpsHistoryBackendStatus');
if(historyTrial&&historyStatus&&config.historyTrialEnabled===true){historyTrial.hidden=false;historyStatus.hidden=false;}
function nextStep(session){
 if(!session.diaryAuth.currentUser){button.textContent='日報のGoogleアカウントを確認する';message('準備できました。ボタンを押して日報のGoogleアカウントを確認してください。');return true;}
 try{core.pair(session.diaryAuth.currentUser,session.gpsAuth.currentUser);return false;}catch{}
 button.textContent='同じGoogleアカウントをGPSでも確認する';message('日報の本人確認ができました。次のボタンでGPSでも同じGoogleアカウントを確認してください。');return true;
}
function message(text){status.textContent=text;}
async function load(){
 const gpsConfig=project.configFor(window.TAXIAPP_GPS_FIREBASE_CONFIG,window.TAXIAPP_FIREBASE_CONFIG);
 if(window.TAXIAPP_FIREBASE_CONFIG?.projectId!==core.DIARY_PROJECT)throw Error('日報の接続設定が一致しません');
 const v='12.4.0';
 const [sdk,a]=await Promise.all([
  import('https://www.gstatic.com/firebasejs/'+v+'/firebase-app.js'),
  import('https://www.gstatic.com/firebasejs/'+v+'/firebase-auth.js')]);
 // 日報本体のdefault Authをログイン/ログアウトしない。
 // 別タブの日報が認証変化で操作端末を取得する副作用も避ける。
 const diaryName='TAXIAPP_GPS_DIARY_IDENTITY';
 let diary=sdk.getApps().find(app=>app.name===diaryName);
 if(diary&&diary.options.projectId!==core.DIARY_PROJECT)throw Error('日報の接続先が異なります');
 diary=diary||sdk.initializeApp(window.TAXIAPP_FIREBASE_CONFIG,diaryName);
 const gps=project.initialize(sdk,gpsConfig,window.TAXIAPP_FIREBASE_CONFIG);
 const diaryAuth=a.getAuth(diary),gpsAuth=a.getAuth(gps);
 await Promise.all([diaryAuth.authStateReady(),gpsAuth.authStateReady()]);
 for(const auth of [diaryAuth,gpsAuth]){
  let prior=auth.currentUser;
  a.onAuthStateChanged(auth,user=>{
   if(prior!==user){prior=user;client?.invalidate();archive?.dispose();archive=null;if(historyTrial)historyTrial.disabled=true;message('ログインが切り替わりました。利用者の連携をやり直してください。');}
  });
 }
 return {a,diaryAuth,gpsAuth};
}
button.addEventListener('click',async()=>{
 if(busy)return;busy=true;button.disabled=true;
 try{
  // 初回のSDK読込後と各Google認証は別の明示操作にする。
  // popupはクリック直後（SDK読込等のawaitより前）に1つだけ開く。
  if(!sessionReady){
   message('Googleの本人確認を準備しています…');
   sessionReady=await(loading||(loading=load().catch(error=>{loading=null;throw error;})));
   if(nextStep(sessionReady))return;
  }
  const session=sessionReady;
  const {a,diaryAuth,gpsAuth}=session;
  if(!diaryAuth.currentUser){
   message('日報で使うGoogleアカウントを選択してください。');
   const provider=new a.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
   await a.signInWithPopup(diaryAuth,provider);
   if(nextStep(session))return;
  }
  const diaryUser=diaryAuth.currentUser;
  if(!diaryUser)throw Error('日報のログインを確認できません');
  let matched=false;try{core.pair(diaryUser,gpsAuth.currentUser);matched=true;}catch{}
  if(!matched){
   message('GPSでも同じGoogleアカウントを選択してください。');
   const provider=new a.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account',login_hint:diaryUser.email||''});
   await a.signInWithPopup(gpsAuth,provider);
  }
  core.pair(diaryAuth.currentUser,gpsAuth.currentUser);
  archive?.dispose();archive=null;client?.dispose();client=core.create({diaryAuth,gpsAuth,endpoint:config.endpoint});
  message('日報の利用資格とGPS側の保存内容を確認しています…');
  // まず利用者資格だけを連携。日報/位置の操作権を取得・奪取しない。
  await client.link(null);
  let archiveNotice='';
  if(config.historyArchiveEnabled===true){
   let historySession;try{
   historySession=window.TAXIAPP_GPS_HISTORY_SYNC.createGas({diaryAuth,gpsAuth,client,store:window.TAXIAPP_GPS_HISTORY_STORE,subtle:crypto.subtle});
   archive=window.TAXIAPP_GPS_HISTORY_ARCHIVE_UI.create({session:historySession,diaryAuth,gpsAuth,store:window.TAXIAPP_GPS_HISTORY_STORE,core:window.TAXIAPP_GPS_SHARING_CORE});
   await archive.refresh();
   }catch(error){archive?.dispose();archive=null;historySession?.dispose();archiveNotice=' 保存済み履歴の表示を確認できません：'+String(error.message||error);}
  }
  if(historyTrial&&config.historyTrialEnabled===true)historyTrial.disabled=false;
  button.textContent='利用者の連携をもう一度確認する';
  message('利用者の連携を確認しました。'+(config.historyArchiveEnabled===true?'新しい位置共有・GPS記録は停止中です。保存済み履歴は手動で操作できます。':'位置共有・走行履歴の送信は停止中です。')+archiveNotice);
 }catch(error){
  const code=String(error?.code||'');
  if(code==='auth/popup-blocked')message('ログイン画面を開けませんでした。もう一度ボタンを押してください。');
  else if(code==='auth/popup-closed-by-user')message('ログインが中断されました。もう一度連携できます。');
  else if(code==='auth/unauthorized-domain')message('この試験ページのログイン許可が未設定です。連携は行っていません。');
  else message('連携を完了できませんでした：'+String(error.message||'通信を確認してください'));
 }finally{busy=false;button.disabled=false;}
});
if(historyTrial&&historyStatus&&config.historyTrialEnabled===true)historyTrial.addEventListener('click',async()=>{
 if(busy||!client||!sessionReady)return;
 busy=true;button.disabled=true;historyTrial.disabled=true;
 const d=sessionReady.diaryAuth.currentUser,g=sessionReady.gpsAuth.currentUser;
 const check=()=>{if(sessionReady.diaryAuth.currentUser!==d||sessionReady.gpsAuth.currentUser!==g)throw Error('ログインが切り替わりました');core.pair(d,g);};
 try{
  check();const sync=window.TAXIAPP_GPS_HISTORY_SYNC;
  if(!sync)throw Error('履歴の共通検証を読み込めません');
  if(!trialPending){
   const now=Date.now(),shiftId='shift-'+now+'-gastrial'+crypto.randomUUID().replaceAll('-','');
   const payload=sync.prepare({uid:g.uid,shiftId,startedAtMs:now-3000,endedAtMs:now-1000,
    points:[{capturedAtMs:now-2000,lat:0,lon:0,accuracy:1,segmentNo:1}]});
   trialPending={diaryUid:d.uid,gpsUid:g.uid,payload,stage:'save',hash:await sync.sha256(payload,crypto.subtle)};
  }
  check();const pending=trialPending;
  if(pending.diaryUid!==d.uid||pending.gpsUid!==g.uid)throw Error('前の本人の合成試験が未完了です');
  const shiftId=pending.payload.shiftId;
  const call=async(action,data)=>{check();const result=await client.call(action,data);check();return result;};
  historyStatus.textContent='合成履歴を保存・照合しています。実GPSは取得しません。';
  if(pending.stage==='save'){
   const saved=await call('saveOwnGpsHistory',{payload:pending.payload,contentHash:pending.hash});
   if(saved.status!=='saved'||saved.contentHash!==pending.hash||saved.shiftId!==shiftId)throw Error('合成履歴の保存応答が一致しません');
   pending.stage='verify';
  }
  if(pending.stage==='verify'){
   const result=await call('getOwnGpsHistory',{shiftId}),row=result.history;
   if(row?.uid!==g.uid||row?.shiftId!==shiftId||row?.contentHash!==pending.hash||await sync.sha256(sync.prepare(row),crypto.subtle)!==pending.hash)throw Error('合成履歴の内容が一致しません');
   check();pending.stage='delete';
  }
  if(pending.stage==='delete'){
   const result=await call('deleteGpsHistory',{shiftId,confirmationShiftId:shiftId});
   if(result.targetUid!==g.uid||result.shiftId!==shiftId||!['deleted','already-deleted'].includes(result.status))throw Error('合成履歴の削除確認が一致しません');
   pending.stage='tomb';
  }
  if((await call('getOwnGpsHistoryTombstone',{shiftId})).deleted!==true)throw Error('削除済みの確認ができません');
  trialPending=null;historyStatus.textContent='合成履歴の保存・内容照合・削除確認に成功しました。新しい位置共有・GPS記録は停止中です。';
 }catch(error){historyStatus.textContent='合成履歴の確認を完了できませんでした：'+String(error.message||'通信を確認してください')+(trialPending?'（試験ID '+trialPending.payload.shiftId+'）':'');}
 finally{busy=false;button.disabled=false;historyTrial.disabled=false;}
});
})();
