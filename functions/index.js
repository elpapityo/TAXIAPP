/* TAXIAPP administrator backend (not deployed automatically).
 * Only accounts deliberately marked testOnly may be permanently purged.
 * NEVER delete an administrator, old Sheets data, or an unmarked live user.
 */
'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp,getApps}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
if(!getApps().length)initializeApp();
const db=getFirestore(),authentication=getAuth();
const region='asia-northeast1';
const options={region,memory:'256MiB',timeoutSeconds:120,maxInstances:1};
const fail=(code,message)=>{throw new HttpsError(code,message);};
async function administrator(request,requireRecent=false){
 const uid=request.auth?.uid;
 if(!uid)fail('unauthenticated','管理者ログインが必要です');
 const admin=await db.doc('admins/'+uid).get();
 if(!admin.exists||admin.get('enabled')!==true)
  fail('permission-denied','管理者権限を確認できません');
 if(requireRecent){
  const at=Number(request.auth.token?.auth_time||0);
  const now=Math.floor(Date.now()/1000);
  if(!at||at>now+60||now-at>300)
   fail('unauthenticated','管理者の再認証が必要です');
 }
 return uid;
}
function requestedUid(data){
 const uid=data?.uid;
 if(typeof uid!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(uid))
  fail('invalid-argument','UIDが不正です');
 return uid;
}
function confirmed(data,uid){
 if(data?.confirmationUid!==uid)
  fail('failed-precondition','UIDの確認が一致しません');
}
async function protectedTarget(uid,actor){
 if(uid===actor)fail('permission-denied','管理者自身は削除できません');
 const [admin,profile]=await Promise.all([
  db.doc('admins/'+uid).get(),db.doc('users/'+uid).get()
 ]);
 if(admin.exists)fail('permission-denied','管理者登録履歴があるUIDは操作できません');
 if(!profile.exists)fail('not-found','登録されていません');
 return profile;
}
async function shiftCount(uid){
 const agg=await db.collection('privateDuties').doc(uid).collection('shifts').count().get();
 return agg.data().count;
}
function nameMatches(data,name){
 if(typeof data?.openChatName!=='string'||data.openChatName!==name)
  fail('failed-precondition','オプチャネームが一覧取得時と異なります');
}
// 管理画面からテスト用を指定。日報原本が1件でも存在すれば指定不可。
// 実営業データに対する操作を防ぐため、UID一致と再認証が必須。
exports.markTestAccount=onCall(options,async request=>{
 const actor=await administrator(request,true),uid=requestedUid(request.data);
 confirmed(request.data,uid);
 const record=await protectedTarget(uid,actor);
 nameMatches(request.data,record.get('openChatName')||'');
 if(record.get('status')!=='active'&&record.get('status')!=='suspended')
  fail('failed-precondition','登録状態がテスト指定可能ではありません');
 if(await shiftCount(uid)!==0)
  fail('failed-precondition','日報原本があるためテスト用に変更できません');
 // Also avoid reclassifying an existing accountSettings profile with duty settings.
 const settings=await db.doc('accountSettings/'+uid).get();
 if(settings.exists)
  fail('failed-precondition','設定保存済みの利用者はテスト用に自動変更できません');
 await db.runTransaction(async transaction=>{
  const admin=await transaction.get(db.doc('admins/'+uid));
  const fresh=await transaction.get(db.doc('users/'+uid));
  if(admin.exists||!fresh.exists||fresh.get('openChatName')!==(request.data.openChatName||'')||
      (fresh.get('status')!=='active'&&fresh.get('status')!=='suspended'))
   fail('failed-precondition','対象ユーザーが変更されました');
  transaction.update(fresh.ref,{testOnly:true,testMarkedBy:actor,testMarkedAt:FieldValue.serverTimestamp()});
 });
 return {uid,message:'テスト用のアカウントとして設定しました'};
});
exports.previewTestAccountDeletion=onCall(options,async request=>{
 const actor=await administrator(request),uid=requestedUid(request.data);
 const target=await protectedTarget(uid,actor);
 if(target.get('testOnly')!==true||!['active','suspended','deleting'].includes(target.get('status')))
  fail('failed-precondition','削除可能なテスト用ユーザーではありません');
 return {
  uid,openChatName:target.get('openChatName')||'',
  status:target.get('status'),shiftCount:await shiftCount(uid)
 };
});
exports.deleteTestAccount=onCall(options,async request=>{
 const actor=await administrator(request,true),uid=requestedUid(request.data);
 confirmed(request.data,uid);
 if(!Number.isSafeInteger(request.data?.expectedShiftCount)||request.data.expectedShiftCount<0)
  fail('invalid-argument','事前照合した日報件数が必要です');
 const profile=await protectedTarget(uid,actor);
 if(profile.get('testOnly')!==true)
  fail('permission-denied','テスト用指定がありません');
 nameMatches(request.data,profile.get('openChatName')||'');
 const count=await shiftCount(uid);
 if(count!==request.data.expectedShiftCount)
  fail('failed-precondition','日報件数が変わりました。再照合してください');
 // Mark as deleting BEFORE removing any record. It immediately revokes
 // ownerEnabled(uid), blocking further writes and re-registration by same UID.
 await db.runTransaction(async tx=>{
  const a=await tx.get(db.doc('admins/'+uid));
  const doc=await tx.get(db.doc('users/'+uid));
  if(a.exists||!doc.exists||doc.get('testOnly')!==true ||
     !['active','suspended','deleting'].includes(doc.get('status')) ||
     doc.get('openChatName')!==(request.data.openChatName||''))
   fail('failed-precondition','対象が変更されたため削除しません');
  tx.update(doc.ref,{status:'deleting',deletionRequestedBy:actor,
   deletionRequestedAt:FieldValue.serverTimestamp()});
 });
 // If a previous attempt partially failed, the same admin may run this again.
 // recursiveDelete includes subcollections and supports documents without a parent.
 await db.recursiveDelete(db.collection('privateDuties').doc(uid));
 await db.doc('accountSettings/'+uid).delete();
 await db.doc('deviceSessions/'+uid).delete();
 try{await authentication.deleteUser(uid);}
 catch(e){if(e?.code!=='auth/user-not-found')throw e;}
 // Keep ONLY a minimal UID tombstone to prevent an old UID from self-registering
 // again. Nickname, settings, duty data and Firebase Auth identity are erased.
 await db.doc('users/'+uid).set({
  status:'deleted',deletedAt:FieldValue.serverTimestamp()
 });
 return {uid,message:'認証情報・オプチャネーム・サーバー日報・設定の削除が完了しました。'
   +' 再登録防止の最小記録のみ保持しています。'};
});
