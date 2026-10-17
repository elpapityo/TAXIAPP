/* TAXIAPP settings-only opt-in migration interface.
 * Keeps the existing duty-level Google Apps Script sync intact.
 */
(function(root){
'use strict';
root.TAXIAPP_ACCOUNT_SETTINGS_UI=function(d){
 const $=id=>document.getElementById(id),settings=root.TAXIAPP_ACCOUNT_SETTINGS;
 const status=$('settingsTransferStatus');
 const controls=['uploadSettings','refreshCloudSettings','backupBeforeSettings','restoreCloudSettings'];
 let user=null,role=null,remote=null,backupFingerprint=null,busy=false;
 function msg(s){status.textContent=s;}
 function describe(summary){
  return '乗務員：'+summary.driver+
   ' ／ 乗務員番号：'+summary.driverNo+
   ' ／ 車両：'+summary.vehicle+
   ' ／ 登録済み待機所：'+summary.waitPlaceCount+'件'+
   ' ／ 設定グループ：'+summary.settingGroups+'種類';
 }
 function allowed(){return !!user && d.auth.currentUser?.uid===user.uid &&
   (role==='admin'||role==='active');}
 const path=()=>d.f.doc(d.db,'accountSettings',user.uid);
 function ui(){
  $('settingsTransfer').hidden=!allowed();
  $('uploadSettings').disabled=busy||!allowed()||!!remote;
  $('refreshCloudSettings').disabled=busy||!allowed();
  $('backupBeforeSettings').disabled=busy||!allowed()||!remote;
  $('restoreCloudSettings').disabled=busy||!allowed()||!remote||!backupFingerprint;
 }
 async function local(){
  const model=await d.readLocal();
  if(!model)throw Error('この端末に既存のTAXIAPPデータがありません。先に従来版を開いてください。');
  settings.extract(model);
  return model;
 }
 async function cloud(){
  if(!allowed())return;
  const snap=await d.f.getDoc(path());
  remote=snap.exists()?snap.data():null;
  if(remote){
   const prefs=settings.validate(remote);
   $('cloudSettingsSummary').textContent=describe(settings.summary(prefs));
   msg('クラウドに設定データがあります。別端末への取り込みには暗号化バックアップが必要です。');
  }else{
   $('cloudSettingsSummary').textContent='未保存（この端末の設定を初回保存できます）';
   msg('まだクラウド設定はありません。乗務員名と待機所の件数を確認してから初回保存してください。');
  }
  backupFingerprint=null;
  ui();
 }
 async function refresh(nextUser,nextRole){
  const previousUid=user?.uid;
  user=nextUser;role=nextRole;
  if(previousUid!==nextUser?.uid){remote=null;backupFingerprint=null;}
  ui();
  if(!allowed())return;
  try{
   const current=await local();
   if(!allowed())return;
   $('localSettingsSummary').textContent=describe(settings.summary(current.prefs));
  }catch(e){
   $('localSettingsSummary').textContent=String(e.message||e);
  }
  try{await cloud();}
  catch(e){
   remote=null;ui();
   $('cloudSettingsSummary').textContent='確認できません';
   msg(e.code==='permission-denied'?
    'Firestoreの設定データ用ルールが未公開です。新ルールを適用するまで保存・取り込みは行えません。':
    'クラウド設定の確認に失敗：'+String(e.code||e.message||e));
  }
 }
 async function controlled(fn){
  if(busy||!allowed())return;
  busy=true;ui();
  try{await fn();}
  catch(e){msg('処理できませんでした：'+String(e.code||e.message||e));}
  finally{busy=false;ui();}
 }
 $('refreshCloudSettings').addEventListener('click',()=>controlled(()=>cloud()));
 $('uploadSettings').addEventListener('click',()=>controlled(async()=>{
  const model=await local(),snapshot=settings.extract(model);
  const sum=settings.summary(snapshot.prefs);
  if(sum.driver==='（未設定）'&&sum.waitPlaceCount===0){
   msg('この端末には乗務員名・待機所が見つかりません。登録済みの端末から初回保存してください。');
   return;
  }
  if(!confirm('この端末の設定を、Googleアカウント専用クラウドへ初回保存します。\\n'+
   describe(sum)+'\\n\\n営業記録は変更しません。続けますか？'))return;
  const targetUid=user.uid;
  await d.f.runTransaction(d.db,async tx=>{
   const ref=d.f.doc(d.db,'accountSettings',targetUid);
   const existing=await tx.get(ref);
   if(existing.exists())throw Error('クラウドに先に保存された設定があります。上書きせず停止しました。');
   tx.set(ref,{...snapshot,updatedAt:d.f.serverTimestamp()});
  });
  await cloud();
  msg('この端末の設定をクラウドへ初回保存しました。営業記録は変更していません。');
 }));
 function saveFile(filename,content){
  const objectUrl=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));
  const a=document.createElement('a');
  a.href=objectUrl;a.download=filename;
  document.body.appendChild(a);
  try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);}
 }
 $('backupBeforeSettings').addEventListener('click',()=>controlled(async()=>{
  if(!remote)throw Error('クラウドに設定がありません');
  const model=await local(),password=$('settingsBackupPassword').value;
  if(!root.TAXIAPP_TRANSFER.passwordOk(password))
   throw Error('暗号化バックアップ用のパスワードは12文字以上で指定してください');
  const oldKey=localStorage.getItem('taxiapp-google-access-v1')||'';
  const snapshot=root.TAXIAPP_DEVICE_DATA.snapshot(model,oldKey);
  const encrypted=await root.TAXIAPP_TRANSFER.encrypt(snapshot,password);
  saveFile('TAXIAPP_設定取込前_全データ_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(encrypted));
  if(confirm('暗号化バックアップファイルを端末に保存できたことを確認しましたか？\\nファイルとパスワードの両方を大切に保管してください。')){
   backupFingerprint=JSON.stringify(model);
   msg('バックアップを確認しました。②を押すと設定だけ取り込めます。営業記録はそのまま残ります。');
  }else{
   backupFingerprint=null;msg('バックアップの保存が確認できないため、取り込みを許可していません。');
  }
 }));
 $('restoreCloudSettings').addEventListener('click',()=>controlled(async()=>{
  if(!remote||!backupFingerprint)throw Error('バックアップを先に保存してください');
  const existing=await local();
  if(JSON.stringify(existing)!==backupFingerprint)
   throw Error('バックアップ後に端末データが変わりました。もう一度バックアップしてください');
  if(existing.activeId&&existing.shifts.some(s=>s.id===existing.activeId&&!s.endedAt))
   throw Error('現在出庫中です。入庫後に設定を取り込んでください。');
  const fresh=await d.f.getDoc(path());
  if(!fresh.exists()||JSON.stringify(fresh.data().prefs)!==JSON.stringify(remote.prefs))
   throw Error('クラウド設定が変更されています。再確認とバックアップが必要です');
  const preview=settings.summary(settings.validate(remote));
  if(!confirm('以下のクラウド設定をこの端末へ取り込みます。\\n'+describe(preview)+
   '\\n\\n営業記録は維持し、この端末のGoogle接続設定・秘密キーは変更しません。続けますか？'))return;
  await overwriteLocalSettings(backupFingerprint,remote);
  backupFingerprint=null;
  msg('設定の取り込みが完了しました。従来版TAXIAPPを開き直してください。乗務データとGoogle接続設定は維持しています。');
  const current=await local();
  $('localSettingsSummary').textContent=describe(settings.summary(current.prefs));
 }));
 async function overwriteLocalSettings(expected,remoteSnapshot){
  // Compare and write inside a single IndexedDB readwrite transaction to
  // avoid silently replacing a shift saved since the pre-migration backup.
  if(!('indexedDB' in window))return writeFallback();
  let db;
  try{
   db=await new Promise((resolve,reject)=>{
    const req=indexedDB.open('taxiapp-store-v1');
    req.onupgradeneeded=()=>req.transaction.abort();
    req.onerror=()=>reject(Error('IndexedDBを開けません。従来版を閉じてください。'));
    req.onblocked=()=>reject(Error('別タブがデータベースを使用しています。'));
    req.onsuccess=()=>resolve(req.result);
   });
   if(!db.objectStoreNames.contains('state')){db.close();return writeFallback();}
   await new Promise((resolve,reject)=>{
    const tx=db.transaction('state','readwrite'),store=tx.objectStore('state');
    const get=store.get('taxiapp');
    let failure=null;
    get.onsuccess=()=>{
     try{
      if(JSON.stringify(get.result)!==expected)
       throw Error('保存直前に端末データが変化しました。最初からやり直してください');
      const merged=settings.merge(get.result,remoteSnapshot);
      store.put(merged,'taxiapp');
     }catch(e){failure=e;tx.abort();}
    };
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(failure||tx.error||Error('端末保存に失敗しました'));
    tx.onabort=()=>reject(failure||tx.error||Error('端末保存を中止しました'));
   });
  }finally{db?.close();}
  return;
  function writeFallback(){
   const raw=localStorage.getItem('taxiapp-v1');
   if(!raw||raw!==expected)throw Error('端末データが変わりました。保存を中止しました。');
   localStorage.setItem('taxiapp-v1',JSON.stringify(settings.merge(JSON.parse(raw),remoteSnapshot)));
  }
 }
 return {refresh};
};
})(typeof window!=='undefined'?window:globalThis);
