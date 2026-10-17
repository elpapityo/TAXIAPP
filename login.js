/* TAXIAPP Phase 1: Google sign-in and read-only legacy inventory only.
 * No new data writes, no migration, no Apps Script key use.
 * Authorization is enforced in Firestore rules; this page only displays status.
 */
const $=id=>document.getElementById(id);
const status=$('loginStatus'),login=$('googleLogin'),logout=$('googleLogout');
const core=window.TAXIAPP_LOGIN_UTILS;
const config=window.TAXIAPP_FIREBASE_CONFIG;
function message(text){status.textContent=text;}
$('copyLoginUid').addEventListener('click',async()=>{
 const uid=$('loginUid').textContent.trim();
 if(!uid)return;
 try{
  await navigator.clipboard.writeText(uid);
  message('利用者ID（UID）をコピーしました。FirebaseのドキュメントID欄へ貼り付けてください。');
 }catch{
  message('コピーできませんでした。上に表示されたUIDを選択してコピーしてください。');
 }
});
function showIdentity(user,state){
 $('loginDetails').hidden=!user;
 logout.hidden=!user;
 login.hidden=!!user;
 if(!user)return;
 $('loginEmail').textContent=user.email||'メールアドレスなし';
 $('loginUid').textContent=user.uid;
 $('loginRole').textContent={
  admin:'管理者登録を確認しました（準備段階）',
  active:'利用可能（準備段階）',
  suspended:'利用停止中',
  pending:'未登録・承認準備中'
 }[state]||state;
}
function legacyLocal(){
 const fallback=()=>{try{
  const raw=localStorage.getItem('taxiapp-v1');
  return raw?JSON.parse(raw):null;
 }catch{return null;}};
 return new Promise(resolve=>{
  if(!('indexedDB' in window)){resolve(fallback());return;}
  // Opening a missing database normally creates one. Abort the upgrade,
  // so inspecting an empty device never creates or alters the legacy store.
  let done=false;
  const finish=value=>{if(done)return;done=true;resolve(value);};
  try{
   const request=indexedDB.open('taxiapp-store-v1');
   request.onupgradeneeded=()=>request.transaction.abort();
   request.onerror=()=>finish(fallback());
   request.onsuccess=()=>{
    const db=request.result;
    if(!db.objectStoreNames.contains('state')){db.close();finish(fallback());return;}
    try{
     const tx=db.transaction('state','readonly');
     const read=tx.objectStore('state').get('taxiapp');
     read.onsuccess=()=>{const value=read.result;db.close();finish(value||fallback());};
     read.onerror=()=>{db.close();finish(fallback());};
    }catch{db.close();finish(fallback());}
   };
  }catch{finish(fallback());}
 });
}
try{
 const snapshot=await legacyLocal();
 const {shiftCount,recordCount}=core.summarizeLegacyModel(snapshot);
 $('legacyStatus').textContent=snapshot?
  'この端末の保存記録：乗務 '+shiftCount+'件 ／ 営業・待機など '+recordCount+'件':
  'この端末で従来の日報データを確認できませんでした（削除・変更はしていません）';
}catch{
 $('legacyStatus').textContent='端末データの確認ができませんでした。従来版で確認してください。';
}

if(!core.firebaseConfigReady(config)){
 message('Firebaseの接続設定がまだありません。従来版はそのまま利用できます。');
}else{
 try{
  // Hosting on GitHub Pages: popup avoids third-party storage restrictions
  // affecting signInWithRedirect. User gesture starts the popup.
  const version='12.4.0';
  const [{initializeApp},a,f]=await Promise.all([
   import('https://www.gstatic.com/firebasejs/'+version+'/firebase-app.js'),
   import('https://www.gstatic.com/firebasejs/'+version+'/firebase-auth.js'),
   import('https://www.gstatic.com/firebasejs/'+version+'/firebase-firestore.js')
  ]);
  const auth=a.getAuth(initializeApp(config)),db=f.getFirestore();
  const provider=new a.GoogleAuthProvider();
  login.disabled=false;
  login.addEventListener('click',async()=>{
   login.disabled=true;
   message('Googleログイン画面を開いています…');
   try{
    await a.signInWithPopup(auth,provider);
   }catch(error){
    message(error.code==='auth/popup-blocked'?
     'ポップアップが制限されています。ブラウザのポップアップ許可を確認してください。':
     error.code==='auth/unauthorized-domain'?
     'Firebaseの承認済みドメインに elpapityo.github.io を追加してください。':
     'ログインに失敗しました：'+String(error.code||error.message||error));
   }finally{login.disabled=false;}
  });
  logout.addEventListener('click',()=>a.signOut(auth).catch(
   ()=>message('ログアウトできませんでした。再度お試しください。')));
  a.onAuthStateChanged(auth,async user=>{
   if(!user){showIdentity(null,'signed-out');message('未ログインです。Googleでログインしてください。');return;}
   let admin=null,profile=null;
   try{
    const [adminSnap,userSnap]=await Promise.all([
     f.getDoc(f.doc(db,'admins',user.uid)),
     f.getDoc(f.doc(db,'users',user.uid))
    ]);
    admin=adminSnap.exists()?adminSnap.data():null;
    profile=userSnap.exists()?userSnap.data():null;
   }catch(error){
    showIdentity(user,'pending');
    message('権限の確認ができません。Firestoreルールと接続設定をご確認ください。');
    return;
   }
   const state=core.accessState(user,admin,profile);
   showIdentity(user,state);
   message(state==='admin'?
    'Googleログインと管理者権限の確認に成功しました。営業データの移行はまだ行っていません。':
    state==='suspended'?'このアカウントは利用停止中です。':
    state==='active'?'認証を確認しました。アプリ本体への認証連携は今後の実装です。':
    'Googleログイン成功。管理者登録はまだ完了していません。UIDを控え、Firebase Consoleで初期管理者を設定してください。');
  },error=>message('認証状態を取得できません：'+String(error.code||error.message||error)));
 }catch(error){
  message('Googleログイン用ライブラリを読み込めませんでした。通信状態を確認してください。');
  console.error('TAXIAPP login initialization',error);
 }
}
