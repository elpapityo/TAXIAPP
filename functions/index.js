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
const options={region,memory:'256MiB',timeoutSeconds:120,maxInstances:1,concurrency:1,minInstances:0};
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
// 管理画面からテスト用を指定。既存日報件数をプレビューと一致照合する。
// 実営業データに対する誤操作を防ぐため、UID一致・明示確認・再認証が必須。
exports.markTestAccount=onCall(options,async request=>{
 const actor=await administrator(request,true),uid=requestedUid(request.data);
 confirmed(request.data,uid);
 const record=await protectedTarget(uid,actor);
 nameMatches(request.data,record.get('openChatName')||'');
 if(record.get('status')!=='active'&&record.get('status')!=='suspended')
  fail('failed-precondition','登録状態がテスト指定可能ではありません');
 if(request.data?.confirmedTestOnly!==true)
  fail('failed-precondition','テスト用であることを明示してください');
 const count=await shiftCount(uid);
 if(!Number.isSafeInteger(request.data?.expectedShiftCount)||
    request.data.expectedShiftCount!==count)
  fail('failed-precondition','サーバーの日報件数が変わりました。再照合してください');
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
 if(!['active','suspended','deleting'].includes(target.get('status')))
  fail('failed-precondition','管理対象ではありません');
 const [count,settings,session]=await Promise.all([
  shiftCount(uid),db.doc('accountSettings/'+uid).get(),
  db.doc('deviceSessions/'+uid).get()
 ]);
 return {
  uid,openChatName:target.get('openChatName')||'',
  status:target.get('status'),testOnly:target.get('testOnly')===true,
  shiftCount:count,hasSettings:settings.exists,hasSession:session.exists
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


// ==========================================
// 管理者による別UIDの日報閲覧と1乗務単位のゴミ箱移動
// クライアント向けFirestoreルールは本人だけのまま変更しない。
// ==========================================
const {FieldPath}=require('firebase-admin/firestore');
const SHIFT_ID=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
function checkedShiftId(value){
 if(typeof value!=='string'||!SHIFT_ID.test(value))
  fail('invalid-argument','乗務IDの形式が不正です');
 return value;
}
async function readableAccount(uid){
 const [member,admin]=await Promise.all([
  db.doc('users/'+uid).get(),db.doc('admins/'+uid).get()
 ]);
 if(!member.exists&&!admin.exists)
  fail('not-found','対象アカウントが登録されていません');
 if(member.get('status')==='deleted'||member.get('status')==='deleting')
  fail('failed-precondition','削除中または削除済みアカウントは閲覧対象外です');
 return {member,admin};
}
async function auditAccess(actor,uid,action,shiftId){
 await db.collection('adminAccessAudit').add({
  actorUid:actor,targetUid:uid,action,
  ...(shiftId?{shiftId}:{}),
  at:FieldValue.serverTimestamp()
 });
}
function listingMeta(snapshot){
 const value=snapshot.data()||{},shift=value.shift||{};
 return {
  id:snapshot.id,date:String(shift.date||''),
  startedIso:String(shift.startedIso||''),ended:Boolean(shift.endedAt||shift.endedIso),
  recordCount:Array.isArray(shift.records)?shift.records.length:0,
  revision:value.revision,trashed:value.trashed===true
 };
}
// ページングで50乗務単位。起動時・ユーザー選択時の全件原本取得は禁止。
exports.listAdminAccountDuties=onCall(options,async request=>{
 const actor=await administrator(request),uid=requestedUid(request.data);
 await readableAccount(uid);
 const cursor=request.data?.afterId||'';
 if(cursor)checkedShiftId(cursor);
 let q=db.collection('privateDuties').doc(uid).collection('shifts')
  .orderBy(FieldPath.documentId()).limit(50);
 if(cursor)q=q.startAfter(cursor);
 const snap=await q.get();
 const last=snap.docs.length?snap.docs[snap.docs.length-1].id:'';
 await auditAccess(actor,uid,'list_duties');
 return {
  uid,shifts:snap.docs.map(listingMeta),
  nextAfterId:snap.docs.length===50?last:null
 };
});
exports.getAdminDutyDetail=onCall(options,async request=>{
 const actor=await administrator(request),uid=requestedUid(request.data),
  shiftId=checkedShiftId(request.data?.shiftId);
 await readableAccount(uid);
 const snapshot=await db.doc('privateDuties/'+uid+'/shifts/'+shiftId).get();
 if(!snapshot.exists)fail('not-found','指定乗務は存在しません');
 const value=snapshot.data();
 if(value?.shift?.id!==shiftId||value?.format!=='TAXIAPP_PRIVATE_SHIFT_V1')
  fail('failed-precondition','乗務IDと原本の形式が一致しません');
 await auditAccess(actor,uid,'read_duty',shiftId);
 // 元の日報・料金計算済みデータを再計算せず、そのまま読む。
 // 操作端末識別子等のアクセス制御用フィールドは公開しない。
 return {uid,shiftId,revision:value.revision,trashed:value.trashed===true,
  shift:value.shift};
});
exports.getAdminAccountSettings=onCall(options,async request=>{
 const actor=await administrator(request),uid=requestedUid(request.data);
 await readableAccount(uid);
 const snapshot=await db.doc('accountSettings/'+uid).get();
 await auditAccess(actor,uid,'read_settings');
 if(!snapshot.exists)return {uid,exists:false};
 const value=snapshot.data()||{};
 return {uid,exists:true,schemaVersion:value.schemaVersion,
  prefs:value.prefs||{}};
});
// 「個別削除」は既存のtrashed仕様に従い1乗務だけをゴミ箱へ。
// 完全削除ではない。実データの破棄、再計算、別UIDへの移行は行わない。
exports.adminTrashAccountDuty=onCall(options,async request=>{
 const actor=await administrator(request,true),uid=requestedUid(request.data),
  shiftId=checkedShiftId(request.data?.shiftId);
 confirmed(request.data,uid);
 if(request.data?.confirmationShiftId!==shiftId)
  fail('failed-precondition','乗務IDの確認が一致しません');
 const revision=request.data?.expectedRevision;
 if(!Number.isSafeInteger(revision)||revision<1)
  fail('invalid-argument','原本の更新番号を確認してください');
 if(request.data?.confirmTrash!==true)
  fail('failed-precondition','個別日報の削除確認が必要です');
 await db.runTransaction(async tx=>{
  const adminRef=db.doc('admins/'+uid),
   userRef=db.doc('users/'+uid),
   dutyRef=db.doc('privateDuties/'+uid+'/shifts/'+shiftId);
  const [admin,member,duty]=await Promise.all([
   tx.get(adminRef),tx.get(userRef),tx.get(dutyRef)
  ]);
  // 管理者が自分のFirestore原本を操作する場合に限り例外的に許可。
  // 他の管理者・一般利用者に対する制限は維持する。
  const authorisedTarget=uid===actor?
   admin.exists&&admin.get('enabled')===true:
   !admin.exists&&member.exists&&
   ['active','suspended'].includes(member.get('status'));
  if(!authorisedTarget)
   fail('permission-denied','指定したUIDの日報削除権限がありません');
  if(!duty.exists)fail('not-found','指定乗務がありません');
  const original=duty.data();
  if(original?.format!=='TAXIAPP_PRIVATE_SHIFT_V1'||
     original?.shift?.id!==shiftId)
   fail('failed-precondition','原本のIDまたは形式が不正です');
  if(original.trashed===true)
   fail('failed-precondition','この日報は既にゴミ箱に入っています');
  if(original.revision!==revision)
   fail('aborted','更新番号が変わりました。詳細を読み直してください');
  if(!original.shift.endedAt&&!original.shift.endedIso)
   fail('failed-precondition','進行中の乗務は削除できません。入庫済みだけを選択してください');
  tx.update(dutyRef,{
   trashed:true,revision:revision+1,updatedAt:FieldValue.serverTimestamp()
  });
  tx.create(db.collection('adminAccessAudit').doc(),{
   actorUid:actor,targetUid:uid,action:'trash_duty',shiftId,
   beforeRevision:revision,afterRevision:revision+1,
   at:FieldValue.serverTimestamp()
  });
 });
 const check=await db.doc('privateDuties/'+uid+'/shifts/'+shiftId).get();
 if(!check.exists||check.get('revision')!==revision+1||check.get('trashed')!==true)
  fail('unavailable','ゴミ箱移動後のサーバー確認ができません。再読み込みしてください');
 return {uid,shiftId,revision:revision+1,trashed:true,
  message:'指定した1乗務をゴミ箱へ移動しました。原本内容は保持されています。'};
});


// 乗降地だけを安全に修正する。料金・手数料・距離は変更せず、
// TAXIAPP本体の唯一の計算エンジンを代替する処理を作らない。
exports.adminUpdateDutyLocations=onCall(options,async request=>{
 const actor=await administrator(request,true),uid=requestedUid(request.data),
  shiftId=checkedShiftId(request.data?.shiftId);
 confirmed(request.data,uid);
 if(request.data?.confirmationShiftId!==shiftId||
    request.data?.confirmEdit!==true)
  fail('failed-precondition','乗務IDと編集操作を確認してください');
 const revision=request.data?.expectedRevision;
 if(!Number.isSafeInteger(revision)||revision<1)
  fail('invalid-argument','対象原本の更新番号が不正です');
 const recordId=request.data?.recordId;
 if(typeof recordId!=='string'||recordId.length<1||recordId.length>128)
  fail('invalid-argument','営業記録IDが不正です');
 const pickup=request.data?.pickup,dropoff=request.data?.dropoff;
 if(typeof pickup!=='string'||typeof dropoff!=='string'||
    pickup.length>160||dropoff.length>160)
  fail('invalid-argument','乗降地の文字数を確認してください');
 await db.runTransaction(async tx=>{
  const adminRef=db.doc('admins/'+uid),userRef=db.doc('users/'+uid),
   dutyRef=db.doc('privateDuties/'+uid+'/shifts/'+shiftId);
  const [targetAdmin,targetUser,snapshot]=await Promise.all([
   tx.get(adminRef),tx.get(userRef),tx.get(dutyRef)
  ]);
  const authorisedTarget=uid===actor?
   targetAdmin.exists&&targetAdmin.get('enabled')===true:
   !targetAdmin.exists&&targetUser.exists&&
   ['active','suspended'].includes(targetUser.get('status'));
  if(!authorisedTarget)fail('permission-denied','対象利用者の編集権限がありません');
  if(!snapshot.exists)fail('not-found','対象の日報原本がありません');
  const original=snapshot.data(),shift=original?.shift;
  if(original?.format!=='TAXIAPP_PRIVATE_SHIFT_V1'||
     shift?.id!==shiftId||!Array.isArray(shift?.records))
   fail('failed-precondition','原本の形式または乗務IDが不正です');
  if(original.trashed===true||(!shift.endedIso&&!shift.endedAt))
   fail('failed-precondition','入庫済みでゴミ箱にない日報だけを修正できます');
  if(original.revision!==revision)
   fail('aborted','日報が他端末で更新されました。読み直して比較してください');
  const matches=shift.records.filter(row=>row?.id===recordId);
  if(matches.length!==1||!['ride','cancel'].includes(matches[0]?.kind))
   fail('failed-precondition','対象の営業記録が見つかりません');
  const previous=matches[0];
  if(!previous.raw||typeof previous.raw!=='object')
   fail('failed-precondition','営業原本の形式が不正です');
  if(String(previous.raw.AL??'')===pickup&&String(previous.raw.AM??'')===dropoff)
   fail('failed-precondition','編集内容に変更がありません');
  // 入力箇所以外の原本、集計済み値、GPS等は一切変更しない。
  const adjusted={...shift,records:shift.records.map(row=>
   row.id===recordId?{...row,raw:{...row.raw,AL:pickup,AM:dropoff}}:row)};
  tx.update(dutyRef,{
   shift:adjusted,revision:revision+1,updatedAt:FieldValue.serverTimestamp()
  });
  tx.create(db.collection('adminAccessAudit').doc(),{
   actorUid:actor,targetUid:uid,action:'edit_duty_location',shiftId,
   recordId,beforeRevision:revision,afterRevision:revision+1,
   at:FieldValue.serverTimestamp()
  });
 });
 // サーバー読戻しで、UID・乗務ID・更新番号・編集箇所の一致を確認。
 const saved=await db.doc('privateDuties/'+uid+'/shifts/'+shiftId).get();
 const record=saved.data();
 const matches=record?.shift?.records?.filter(row=>row?.id===recordId)||[];
 if(!saved.exists||record?.shift?.id!==shiftId||
    record?.revision!==revision+1||record?.trashed===true||
    matches.length!==1||matches[0].raw?.AL!==pickup||
    matches[0].raw?.AM!==dropoff)
  fail('unavailable','保存結果の照合ができません。原本を読み直してください');
 return {uid,shiftId,recordId,revision:revision+1,
  pickup,dropoff,message:'乗車地・降車地を保存し、サーバー原本を読戻し確認しました。'};
});


// 管理者本人・一般利用者のゴミ箱日報を、CAS確認して1件だけ復元する。
exports.adminRestoreAccountDuty=onCall(options,async request=>{
 const actor=await administrator(request,true),uid=requestedUid(request.data),
  shiftId=checkedShiftId(request.data?.shiftId);
 confirmed(request.data,uid);
 if(request.data?.confirmationShiftId!==shiftId||
    request.data?.confirmRestore!==true)
  fail('failed-precondition','乗務IDと復元操作を確認してください');
 const revision=request.data?.expectedRevision;
 if(!Number.isSafeInteger(revision)||revision<1)
  fail('invalid-argument','原本の更新番号が不正です');
 await db.runTransaction(async tx=>{
  const adminRef=db.doc('admins/'+uid),userRef=db.doc('users/'+uid),
   dutyRef=db.doc('privateDuties/'+uid+'/shifts/'+shiftId);
  const [targetAdmin,targetUser,duty]=await Promise.all([
   tx.get(adminRef),tx.get(userRef),tx.get(dutyRef)
  ]);
  const authorisedTarget=uid===actor?
   targetAdmin.exists&&targetAdmin.get('enabled')===true:
   !targetAdmin.exists&&targetUser.exists&&
   ['active','suspended'].includes(targetUser.get('status'));
  if(!authorisedTarget)fail('permission-denied','この利用者の日報は復元できません');
  if(!duty.exists)fail('not-found','日報原本がありません');
  const saved=duty.data();
  if(saved?.format!=='TAXIAPP_PRIVATE_SHIFT_V1'||saved?.shift?.id!==shiftId)
   fail('failed-precondition','乗務IDと原本が一致しません');
  if(saved.trashed!==true)
   fail('failed-precondition','ゴミ箱内の日報ではありません');
  if(saved.revision!==revision)
   fail('aborted','更新番号が変わりました。原本を読み直してください');
  tx.update(dutyRef,{
   trashed:false,revision:revision+1,
   updatedAt:FieldValue.serverTimestamp()
  });
  tx.create(db.collection('adminAccessAudit').doc(),{
   actorUid:actor,targetUid:uid,action:'restore_duty',shiftId,
   beforeRevision:revision,afterRevision:revision+1,
   at:FieldValue.serverTimestamp()
  });
 });
 const check=await db.doc('privateDuties/'+uid+'/shifts/'+shiftId).get();
 if(!check.exists||check.get('revision')!==revision+1||
    check.get('trashed')!==false||check.get('shift')?.id!==shiftId)
  fail('unavailable','復元後の原本を照合できません。再読み込みしてください');
 return {uid,shiftId,revision:revision+1,trashed:false,
  message:'対象の1乗務をゴミ箱から復元しました。'};
});


// オプチャネームは本人の初回登録後は固定し、管理者だけが変更する。
// ブラウザ側のFirestore rulesの users 更新禁止を維持する。
exports.adminUpdateOpenChatName=onCall(options,async request=>{
 const actor=await administrator(request,true),uid=requestedUid(request.data);
 confirmed(request.data,uid);
 const submitted=request.data?.newName;
 if(typeof submitted!=='string')
  fail('invalid-argument','変更後のオプチャネームを入力してください');
 const name=submitted.normalize('NFC').trim();
 if(!name||Array.from(name).length>32||
    Array.from(name).some(ch=>ch.codePointAt(0)<32||ch.codePointAt(0)===127))
  fail('invalid-argument','オプチャネームは改行なしの1～32文字で入力してください');
 if(typeof request.data?.expectedName!=='string')
  fail('invalid-argument','変更前の登録名を確認してください');
 const expectedName=request.data.expectedName;
 let source='';
 try{
 await db.runTransaction(async tx=>{
  const userRef=db.doc('users/'+uid),adminRef=db.doc('admins/'+uid);
  const [user,admin]=await Promise.all([tx.get(userRef),tx.get(adminRef)]);
  // 管理者の users プロフィールが古い停止・保留形式でも、
  // admins の有効な本人登録があれば正規の管理者名を設定できる。
  // active/suspended のユーザープロフィールがあればそちらを優先する。
  if(user.exists&&['active','suspended'].includes(user.get('status'))){
   source='users';
   const existing=user.get('openChatName')||'';
   if(existing!==expectedName)
    fail('aborted','登録名が変更されています。一覧を更新して確認してください');
   if(existing===name)
    fail('failed-precondition','変更後の名前が同じです');
   tx.update(userRef,{
    openChatName:name,
    openChatNameUpdatedAt:FieldValue.serverTimestamp(),
    openChatNameUpdatedBy:actor
   });
  }else if(admin.exists&&admin.get('enabled')===true){
   // users 未登録または古い保留プロフィールでも、管理者権限は別保存。
   // enabled・他の管理者設定は変更せず、名前だけ更新する。
   source='admins';
   const existing=admin.get('openChatName')||'';
   if(existing!==expectedName)
    fail('aborted','管理者名が変更されています。一覧を更新してください');
   if(existing===name)
    fail('failed-precondition','変更後の名前が同じです');
   tx.update(adminRef,{
    openChatName:name,
    openChatNameUpdatedAt:FieldValue.serverTimestamp(),
    openChatNameUpdatedBy:actor
   });
  }else{
   fail('failed-precondition','このアカウントの名前変更は許可されていません');
  }
  tx.create(db.collection('adminAccessAudit').doc(),{
   actorUid:actor,targetUid:uid,action:'update_open_chat_name',
   at:FieldValue.serverTimestamp()
  });
 });
 }catch(error){
  if(error instanceof HttpsError)throw error;
  // 実名やUIDはログに書かない。実行環境の失敗種別だけ記録する。
  console.error('adminUpdateOpenChatName transaction failed',{
   code:String(error?.code||'unknown'),
   type:String(error?.name||'unknown')
  });
  fail('unavailable','オプチャネーム保存サーバーでエラーが発生しました。'+
   '結果が不明なため原本を確認してください。Cloud Functionsのログにも記録しました。');
 }
 let verified;
 try{verified=await db.doc(source+'/'+uid).get();}
 catch(error){
  console.error('adminUpdateOpenChatName readback failed',{
   code:String(error?.code||'unknown'),
   type:String(error?.name||'unknown')
  });
  fail('unavailable','保存後の読戻しに失敗しました。'+
   '保存済みの可能性があるため、再送する前に登録名を再取得してください。');
 }
 if(!verified.exists||verified.get('openChatName')!==name)
  fail('unavailable','変更後の登録名を読み戻し確認できません');
 return {uid,newName:name,source,
  message:'オプチャネームの変更をサーバーで確認しました。'};
});
