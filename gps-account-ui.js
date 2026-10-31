/* 既存GPS試験画面の本人連携。位置・履歴・日報の書込を開始しない。 */
(function(){'use strict';
const panel=document.getElementById('gpsAccountPanel'),button=document.getElementById('gpsAccountLink'),status=document.getElementById('gpsAccountStatus');
const config=window.TAXIAPP_GPS_ACCOUNT_CONFIG,project=window.TAXIAPP_GPS_FIREBASE_PROJECT,core=window.TAXIAPP_GPS_ACCOUNT_BRIDGE;
if(!panel||!button||!status||config?.enabled!==true||!project||!core)return;
panel.hidden=false;
let loading=null,client=null,busy=false;
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
   if(prior!==user){prior=user;client?.invalidate();message('ログインが切り替わりました。利用者の連携をやり直してください。');}
  });
 }
 return {a,diaryAuth,gpsAuth};
}
button.addEventListener('click',async()=>{
 if(busy)return;busy=true;button.disabled=true;
 try{
  message('Googleの本人確認を準備しています…');
  // Firebase SDKの読込・認証初期化は、利用者がボタンを押した後だけ。
  const session=await(loading||(loading=load().catch(error=>{loading=null;throw error;})));
  const {a,diaryAuth,gpsAuth}=session;
  if(!diaryAuth.currentUser){
   message('日報で使うGoogleアカウントを選択してください。');
   const provider=new a.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
   await a.signInWithPopup(diaryAuth,provider);
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
  client?.dispose();client=core.create({diaryAuth,gpsAuth,endpoint:config.endpoint});
  message('日報の利用資格とGPS側の保存内容を確認しています…');
  // まず利用者資格だけを連携。日報/位置の操作権を取得・奪取しない。
  await client.link(null);
  message('利用者の連携を確認しました。位置共有・走行履歴の送信は停止中です。');
 }catch(error){
  const code=String(error?.code||'');
  if(code==='auth/popup-blocked')message('ログイン画面を開けませんでした。もう一度ボタンを押してください。');
  else if(code==='auth/popup-closed-by-user')message('ログインが中断されました。もう一度連携できます。');
  else if(code==='auth/unauthorized-domain')message('この試験ページのログイン許可が未設定です。連携は行っていません。');
  else message('連携を完了できませんでした：'+String(error.message||'通信を確認してください'));
 }finally{busy=false;button.disabled=false;}
});
})();
