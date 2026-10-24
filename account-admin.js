/* TAXIAPP PC administrator console.
 * Lists registered users and fetches selected duties via administrator-only Callables.
 * Permanent deletion is performed only by an independently authorised server function.
 */
import {initializeApp,getApps,getApp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut,reauthenticateWithPopup} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {getFirestore,doc,getDocFromServer,collection,query,limit,getDocsFromServer,orderBy,documentId,startAfter} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js';
import './firebase-config.js';
const $=id=>document.getElementById(id);
const app=getApps().length?getApp():initializeApp(window.TAXIAPP_FIREBASE_CONFIG);
const auth=getAuth(app),db=getFirestore(app),functions=getFunctions(app,'asia-northeast1');
let adminUid='',users=[],selected=null,preview=null,busy=false,epoch=0;
let selectedDuty=null,dutyCursor=null,dutyRows=[],dutyUid='';
let editDraft=null;
const api={
 mark: httpsCallable(functions,'markTestAccount'),
 preview: httpsCallable(functions,'previewTestAccountDeletion'),
 remove: httpsCallable(functions,'deleteTestAccount'),
 updateOpenChatName: httpsCallable(functions,'adminUpdateOpenChatName'),
 listDuties: httpsCallable(functions,'listAdminAccountDuties'),
 duty: httpsCallable(functions,'getAdminDutyDetail'),
 settings: httpsCallable(functions,'getAdminAccountSettings'),
 trash: httpsCallable(functions,'adminTrashAccountDuty'),
 updateLocations: httpsCallable(functions,'adminUpdateDutyLocations'),
 restore: httpsCallable(functions,'adminRestoreAccountDuty')
};
const notice=(message,error=false)=>{
 $('message').textContent=message;
 $('message').style.color=error?'#a02d2d':'#135881';
};
function shortDate(v){
 try{return v?.toDate?.().toLocaleString('ja-JP')||'―';}catch{return '―';}
}
function selectedIsValid(){
 return !!selected&&$('confirmUid').value.trim()===selected.uid&&$('ack').checked;
}
function validSelectedDuty(allowBusy=false){
 return (allowBusy||!busy)&&!!selected&&!!selectedDuty&&
  dutyUid===selected.uid&&selectedDuty.uid===selected.uid&&
  (!selected.isAdmin||selected.uid===adminUid)&&
  $('trashConfirmId').value.trim()===selectedDuty.shiftId&&
  $('trashConfirmAck').checked&&selectedDuty.trashed!==true&&
  (selectedDuty.shift?.endedAt||selectedDuty.shift?.endedIso);
}
function buttons(){
 const ok=!!selected&&!busy&&selectedIsValid();
 const activeTarget=!!selected&&!['deleted','deleting'].includes(selected.status);
 $('openNameEdit').disabled=busy||!activeTarget;
 $('openAccountDelete').hidden=!selected||selected.isAdmin;
 $('openAccountDelete').disabled=busy||!activeTarget||selected.isAdmin;
 $('saveAdminName').disabled=busy||!activeTarget;
 $('cancelAdminName').disabled=busy;
 $('closeAccountDelete').disabled=busy;
 $('loadDuties').disabled=!selected||busy;
 $('loadSettings').disabled=!selected||busy;
 $('moreDuties').disabled=!selected||busy||!dutyCursor;
 $('trashDuty').disabled=!validSelectedDuty();
 $('restoreDuty').hidden=!selectedDuty||selectedDuty.trashed!==true;
 $('restoreDuty').disabled=!selectedDuty||busy||selectedDuty.trashed!==true||
  selected?.isAdmin&&selected.uid!==adminUid;
 $('trashDutyShortcut').hidden=!!selectedDuty&&selectedDuty.trashed===true;
 $('trashDutyShortcut').disabled=!selectedDuty||busy||
  selectedDuty.trashed===true||!selectedDuty.shift?.endedAt&&!selectedDuty?.shift?.endedIso||
  selected?.isAdmin&&selected.uid!==adminUid;
 $('editDuty').disabled=!selectedDuty||busy||selectedDuty.trashed===true||
  !selectedDuty.shift?.endedAt&&!selectedDuty?.shift?.endedIso||
  !selectedDuty.shift?.records?.some(row=>row?.id&&['ride','cancel'].includes(row.kind))||
  selected?.isAdmin&&selected.uid!==adminUid;
 $('adminEditSave').disabled=busy||!editDraft;
 $('markTest').disabled=!ok||selected.isAdmin||selected.testOnly||!preview||preview.uid!==selected.uid||selected.status==='deleted'||selected.status==='deleting';
 $('preview').disabled=!ok||selected.isAdmin||selected.status==='deleted';
 $('deleteAccount').disabled=!ok||selected.isAdmin||!selected.testOnly||!preview||preview.uid!==selected.uid||preview.openChatName!==(selected.openChatName||'');
 for(const id of ['reload','search','signIn','signOut'])$(id).disabled=busy;
}
function clearDutyPanel(){
 selectedDuty=null;dutyCursor=null;dutyRows=[];dutyUid='';editDraft=null;
 $('adminLocationEdit').hidden=true;
 $('dutyRows').textContent='';
 $('dutySelected').hidden=true;
 $('settingsDetail').hidden=true;
 $('moreDuties').hidden=true;
 $('trashConfirmId').value='';
 $('trashConfirmAck').checked=false;
}
function selectUser(user){
 clearDutyPanel();
 selected=user;preview=null;
 $('selectedPanel').hidden=false;
 $('accountDeletionSection').hidden=true;
 $('adminNicknameSection').hidden=true;
 $('adminNameStatus').textContent='';
 $('adminNewName').value=user.storedOpenChatName||'';
 $('adminSourceNotice').hidden=!user.isAdmin;
 $('dutyTrashSection').hidden=true;
 $('confirmUid').value='';$('ack').checked=false;
 $('previewDetails').hidden=true;
 $('targetDetails').textContent='';
 for(const [key,value] of [
  ['オプチャネーム',user.openChatName||'（未登録）'],
  ['UID',user.uid],['区分',user.isAdmin?'管理者':'一般利用者'],['状態',user.status||'未設定'],
  ['テスト用指定',user.testOnly?'あり':'なし'],
  ['登録日時',shortDate(user.registeredAt)]
 ]){
  const line=document.createElement('div');
  const keyEl=document.createElement('strong');keyEl.textContent=key+'：';
  line.append(keyEl,document.createTextNode(String(value)));
  $('targetDetails').append(line);
 }
 buttons();
}
function renderList(){
 const tbody=$('usersBody');tbody.textContent='';
 const filter=$('search').value.trim().toLocaleLowerCase('ja-JP');
 const shown=users.filter(u=>u.uid.toLowerCase().includes(filter)||(u.openChatName||'').toLocaleLowerCase('ja-JP').includes(filter));
 for(const person of shown){
  const tr=document.createElement('tr');
  for(const [txt,cls] of [
   [person.openChatName||'（未設定）',''],[person.uid,'code'],
   [person.isAdmin?(person.adminEnabled?'管理者':'管理者登録履歴'):(person.status||'未設定'),''],[person.isAdmin?'削除対象外':person.testOnly?'テスト用':'未指定','']
  ]){
   const td=document.createElement('td');td.textContent=txt;if(cls)td.className=cls;tr.append(td);
  }
  const td=document.createElement('td'),btn=document.createElement('button');
  btn.textContent='選択';btn.addEventListener('click',()=>selectUser(person));
  td.append(btn);tr.append(td);tbody.append(tr);
 }
 $('listCount').textContent='表示 '+shown.length+' 件（一般利用者は最大150件、管理者も含む）';
}
async function loadList(){
 const myEpoch=epoch,ownUid=adminUid;
 // users と admins を別々に読み、重複するUIDは一件に統合する。
 // 管理者は users ドキュメントを持たない場合も必ず表示する。
 const [members,administrators]=await Promise.all([
  getDocsFromServer(query(collection(db,'users'),limit(150))),
  getDocsFromServer(query(collection(db,'admins'),limit(150)))
 ]);
 if(myEpoch!==epoch||adminUid!==ownUid||!adminUid)return;
 const records=new Map();
 for(const snap of members.docs){
  const data=snap.data()||{};
  const name=typeof data.openChatName==='string'?data.openChatName:'';
  records.set(snap.id,{
   uid:snap.id,
   openChatName:name,storedOpenChatName:name,
   status:typeof data.status==='string'?data.status:'',
   testOnly:data.testOnly===true,
   registeredAt:data.registeredAt,
   isAdmin:false,adminEnabled:false
  });
 }
 for(const snap of administrators.docs){
  const adminName=typeof snap.data()?.openChatName==='string'?
   snap.data().openChatName:'';
  const prior=records.get(snap.id)||{
   uid:snap.id,openChatName:adminName,storedOpenChatName:adminName,
   status:'管理者登録',testOnly:false,registeredAt:null
  };
  records.set(snap.id,{
   ...prior,isAdmin:true,adminEnabled:snap.data()?.enabled===true,
   testOnly:false
  });
 }
 // 管理者本人の権限は、ログイン時に admins/{uid} を直接読んで確定済み。
 // 管理者一覧の150件制限で漏れても、usersに同じUIDがあっても必ず管理者と扱う。
 const ownProfile=records.get(ownUid)||{
  uid:ownUid,openChatName:'',storedOpenChatName:'',
  status:'管理者登録',testOnly:false,registeredAt:null
 };
 records.set(ownUid,{
  ...ownProfile,isAdmin:true,adminEnabled:true,testOnly:false
 });
 users=[...records.values()].map(u=>({
  ...u,
  openChatName:u.openChatName||(u.isAdmin?
   (u.uid===ownUid?'管理者（自分）':'管理者'):'')
 })).sort((a,b)=>
  (a.uid===ownUid?-1:b.uid===ownUid?1:0)||
  String(a.openChatName||'').localeCompare(String(b.openChatName||''),'ja'));
 selected=null;preview=null;clearDutyPanel();$('selectedPanel').hidden=true;
 renderList();
 notice('管理者を含む登録一覧を更新しました。');
}
async function execute(fn,requireAdmin=true){
 if(busy||(requireAdmin&&!adminUid))return;
 busy=true;buttons();const myEpoch=epoch;
 try{await fn();}catch(e){
  if(epoch===myEpoch)notice('操作できません：'+String(e?.message||e),true);
 }finally{busy=false;buttons();}
}
async function recentAdminLogin(){
 if(!auth.currentUser||auth.currentUser.uid!==adminUid)throw Error('管理者ログインを確認できません');
 // Reauthentication is performed by the Auth SDK. UI verification alone does not
 // grant any permission; the callable checks admin docs and auth_time again.
 await reauthenticateWithPopup(auth.currentUser,new GoogleAuthProvider());
 if(auth.currentUser.uid!==adminUid)throw Error('管理者アカウントが変更されました');
 await auth.currentUser.getIdToken(true);
}
onAuthStateChanged(auth,async user=>{
 const myEpoch=++epoch;adminUid='';users=[];selected=null;preview=null;
 clearDutyPanel();
 $('workspace').hidden=true;$('selectedPanel').hidden=true;
 $('signIn').hidden=!!user;$('signOut').hidden=!user;
 $('loginState').textContent=user?'管理者権限を確認しています…':'未ログイン';
 if(!user){notice('Googleアカウントで管理者ログインしてください。');return;}
 try{
  const admin=await getDocFromServer(doc(db,'admins',user.uid));
  if(myEpoch!==epoch)return;
  if(!admin.exists()||admin.data()?.enabled!==true){
   $('loginState').textContent='一般利用者：管理画面は利用できません';
   notice('管理者権限がありません。',true);return;
  }
  adminUid=user.uid;
  $('workspace').hidden=false;
  $('loginState').textContent='管理者として確認済み';
  await loadList();
 }catch(e){if(myEpoch===epoch)notice('権限を確認できません：'+String(e.message||e),true);}
});
$('signIn').addEventListener('click',()=>execute(async()=>{
 await signInWithPopup(auth,new GoogleAuthProvider());
},false));
$('signOut').addEventListener('click',()=>execute(async()=>{await signOut(auth);},false));
$('reload').addEventListener('click',()=>execute(loadList));
$('search').addEventListener('input',renderList);
$('confirmUid').addEventListener('input',buttons);
$('ack').addEventListener('change',buttons);
$('trashConfirmId').addEventListener('input',buttons);
$('trashConfirmAck').addEventListener('change',buttons);

// 自分のFirestore原本と個人設定は既存の本人UID読み取りルールで直接参照する。
 // Cloud Functionsが未配信でも管理者自身のデータだけは確認可能。
 // 他人のUIDへの直接参照はせず、管理者認証済みCallableだけを利用する。
function viewingOwnAdmin(uid){
 return !!adminUid&&uid===adminUid&&auth.currentUser?.uid===uid&&
  selected?.uid===uid&&selected.isAdmin&&selected.adminEnabled;
}
async function getDutyList(uid,after){
 if(!viewingOwnAdmin(uid))return (await api.listDuties({uid,afterId:after||''})).data;
 const items=collection(db,'privateDuties',uid,'shifts');
 const parameters=[orderBy(documentId()),limit(50)];
 if(after)parameters.splice(1,0,startAfter(after));
 const snapshots=await getDocsFromServer(query(items,...parameters));
 const list=snapshots.docs.map(entry=>{
  const record=entry.data()||{},shift=record.shift||{};
  return {
   id:entry.id,
   date:String(shift.date||''),
   startedIso:String(shift.startedIso||''),
   ended:Boolean(shift.endedAt||shift.endedIso),
   recordCount:Array.isArray(shift.records)?shift.records.length:0,
   revision:record.revision,
   trashed:record.trashed===true
  };
 });
 return {uid,shifts:list,
  nextAfterId:list.length===50?list[list.length-1].id:null};
}
async function getDutyRecord(uid,shiftId){
 if(!viewingOwnAdmin(uid))return (await api.duty({uid,shiftId})).data;
 const snap=await getDocFromServer(doc(db,'privateDuties',uid,'shifts',shiftId));
 if(!snap.exists())throw Error('指定したFirestore原本は見つかりません');
 const record=snap.data();
 if(record?.shift?.id!==shiftId||record?.format!=='TAXIAPP_PRIVATE_SHIFT_V1')
  throw Error('乗務IDまたは原本形式が一致しません');
 return {uid,shiftId,revision:record.revision,
  trashed:record.trashed===true,shift:record.shift};
}
async function getAccountPrefs(uid){
 if(!viewingOwnAdmin(uid))return (await api.settings({uid})).data;
 const snap=await getDocFromServer(doc(db,'accountSettings',uid));
 return snap.exists()?
  {uid,exists:true,prefs:snap.data()?.prefs||{}}:
  {uid,exists:false};
}
function displayDutyRows(){
 const container=$('dutyRows');container.textContent='';
 for(const item of dutyRows){
  const tr=document.createElement('tr');
  const row=[
   item.date||'日付未登録',item.id,
   String(item.recordCount??'―'),
   item.trashed?'ゴミ箱':item.ended?'入庫済み':'進行中',
   String(item.revision)
  ];
  for(const text of row){
   const td=document.createElement('td');td.textContent=text;tr.append(td);
  }
  const cell=document.createElement('td'),btn=document.createElement('button');
  btn.type='button';btn.textContent='原本を表示';
  btn.addEventListener('click',()=>execute(()=>readDuty(item.id)));
  cell.append(btn);tr.append(cell);container.append(tr);
 }
 $('moreDuties').hidden=!dutyCursor;
}
async function loadDuties(reset=true){
 if(!selected)return;
 const uid=selected.uid,version=epoch;
 if(reset)clearDutyPanel();
 const start=reset?'':dutyCursor;
 const result=await getDutyList(uid,start||'');
 if(version!==epoch||selected?.uid!==uid)return;
 if(result?.uid!==uid||!Array.isArray(result?.shifts))
  throw Error('日報一覧のUIDが一致しません');
 dutyUid=uid;
 dutyRows=[...dutyRows,...result.shifts];
 dutyCursor=result.nextAfterId||null;
 displayDutyRows();
 notice('Firestore日報 '+dutyRows.length+' 件を表示しています。'+(selected.isAdmin?' 旧Google原本はTAXIAPP本体で確認してください。':''));
}
async function readDuty(shiftId){
 if(!selected)return;
 const uid=selected.uid,version=epoch;
 const duty=await getDutyRecord(uid,shiftId);
 if(version!==epoch||selected?.uid!==uid)return;
 if(!duty||duty.uid!==uid||duty.shiftId!==shiftId||
    duty.shift?.id!==shiftId||!Number.isSafeInteger(duty.revision))
  throw Error('日報原本のUID・ID・更新番号が一致しません');
 selectedDuty=duty;dutyUid=uid;
 editDraft=null;$('adminLocationEdit').hidden=true;
 $('dutySelected').hidden=false;
 $('dutyTrashSection').hidden=true;
 $('dutyHeader').textContent='UID：'+uid+'／乗務ID：'+shiftId+
  '／更新番号：'+duty.revision+'／'+(duty.trashed?'ゴミ箱':duty.shift.endedAt||duty.shift.endedIso?'入庫済み':'進行中');
 // 日報は元の保存データに基づく日本語閲覧専用UIで表示する。
 // textContentからDOMを構築するため、住所・GPSをHTMLとして解釈しない。
 if(!window.TAXIAPP_ADMIN_DUTY_VIEW?.render)
  throw Error('日報の表示部品を読み込めません。画面を再読み込みしてください');
 window.TAXIAPP_ADMIN_DUTY_VIEW.render($('dutyDetail'),duty.shift,{
  revision:duty.revision,trashed:duty.trashed
 });
 $('trashConfirmId').value='';$('trashConfirmAck').checked=false;
 buttons();
 notice('選択した1乗務の原本を表示しました。入庫済みなら編集・ゴミ箱移動が選べます。');
}
$('loadDuties').addEventListener('click',()=>execute(()=>loadDuties(true)));
$('moreDuties').addEventListener('click',()=>execute(()=>loadDuties(false)));
$('loadSettings').addEventListener('click',()=>execute(async()=>{
 if(!selected)return;
 const uid=selected.uid,version=epoch;
 const result=await getAccountPrefs(uid);
 if(version!==epoch||selected?.uid!==uid)return;
 if(result?.uid!==uid)throw Error('設定のUIDが一致しません');
 $('settingsDetail').textContent=result.exists?
  JSON.stringify(result.prefs,null,2):'設定は未登録です';
 $('settingsDetail').hidden=false;
 notice('本人の設定を閲覧用に取得しました。変更・保存は行いません。');
}));
function locationEditKey(uid,shiftId){
 return 'taxiapp-admin-location-edit-v1-'+encodeURIComponent(uid)+'-'+encodeURIComponent(shiftId);
}
function preserveLocationEdit(){
 if(!editDraft)return;
 editDraft.pickup=$('adminEditPickup').value;
 editDraft.dropoff=$('adminEditDropoff').value;
 // 再ログインや通信失敗後も、修正控えをUID別に残して復旧する。
 localStorage.setItem(locationEditKey(editDraft.uid,editDraft.shiftId),JSON.stringify(editDraft));
 $('adminEditStatus').textContent='修正控えをこのPC内に保護しました（サーバー未保存）';
}
function chooseLocationRecord(){
 if(!editDraft||!selectedDuty)return;
 const id=$('adminEditRecord').value;
 const record=selectedDuty.shift.records.find(row=>row?.id===id);
 if(!record)return;
 editDraft.recordId=id;
 editDraft.pickup=String(record.raw?.AL||'');
 editDraft.dropoff=String(record.raw?.AM||'');
 $('adminEditPickup').value=editDraft.pickup;
 $('adminEditDropoff').value=editDraft.dropoff;
 preserveLocationEdit();
}
function startLocationEdit(){
 if(!selectedDuty||selectedDuty.trashed||!selectedDuty.shift?.endedAt&&!selectedDuty.shift?.endedIso)return;
 if(selected?.isAdmin&&selected.uid!==adminUid)return;
 const uid=selected.uid,shiftId=selectedDuty.shiftId,revision=selectedDuty.revision;
 const saved=localStorage.getItem(locationEditKey(uid,shiftId));
 let restored=null;
 if(saved){
  try{restored=JSON.parse(saved);}catch{throw Error('端末の編集控えが破損しています。控えを消さずに保護します');}
  if(restored?.uid!==uid||restored.shiftId!==shiftId||
     !Number.isSafeInteger(restored.revision)||typeof restored.recordId!=='string')
   throw Error('編集控えが対象乗務と一致しません。保護のため開始できません');
  if(restored.revision!==revision)
   throw Error('編集中にサーバーの更新番号が変わりました。修正控えを保持しています。競合を確認してください');
 }
 const records=selectedDuty.shift.records.filter(row=>row?.id&&['ride','cancel'].includes(row.kind));
 if(!records.length)throw Error('この日報に乗降地を訂正できる営業記録がありません');
 const selector=$('adminEditRecord');selector.textContent='';
 for(const record of records){
  const option=document.createElement('option');
  option.value=record.id;
  option.textContent='№'+String(record.raw?.A||'?')+'／'+
   (record.kind==='ride'?'実車':'キャンセル')+
   '／'+String(record.raw?.G||record.raw?.C||'時刻未記録');
  selector.append(option);
 }
 editDraft=restored||{uid,shiftId,revision,recordId:records[0].id,
  pickup:'',dropoff:''};
 selector.value=records.some(row=>row.id===editDraft.recordId)?editDraft.recordId:records[0].id;
 if(!restored||selector.value!==editDraft.recordId)chooseLocationRecord();
 else{
  $('adminEditPickup').value=editDraft.pickup;
  $('adminEditDropoff').value=editDraft.dropoff;
 }
 $('adminLocationEdit').hidden=false;
 $('adminEditStatus').textContent=restored?
  '前回の修正控えを復元しました。保存先の更新番号を再確認してください。':
  'この変更はまだサーバーへ送信していません。';
 buttons();
}
$('editDuty').addEventListener('click',()=>execute(async()=>{startLocationEdit();}));
$('adminEditRecord').addEventListener('change',chooseLocationRecord);
for(const key of ['adminEditPickup','adminEditDropoff'])
 $(key).addEventListener('input',()=>{
  try{preserveLocationEdit();}catch(e){
   $('adminEditStatus').textContent='修正控えを保護できません。保存を中断してください：'+String(e.message||e);
  }
 });
$('adminEditCancel').addEventListener('click',()=>{
 // 編集を閉じても修正控えを勝手に削除しない。
 $('adminLocationEdit').hidden=true;editDraft=null;buttons();
});
$('adminEditSave').addEventListener('click',()=>execute(async()=>{
 if(!editDraft||!selectedDuty||selectedDuty.uid!==editDraft.uid||
    selectedDuty.shiftId!==editDraft.shiftId||
    selectedDuty.revision!==editDraft.revision||
    selected?.uid!==editDraft.uid)
  throw Error('対象UID・乗務ID・更新番号が変わりました。保存を停止しました');
 preserveLocationEdit();
 const draft={...editDraft};
 if(draft.pickup.length>160||draft.dropoff.length>160)
  throw Error('乗降地は160文字以内にしてください');
 const record=selectedDuty.shift.records.find(row=>row?.id===draft.recordId);
 if(!record)throw Error('対象の営業記録が見つかりません');
 if(String(record.raw?.AL||'')===draft.pickup&&
    String(record.raw?.AM||'')===draft.dropoff)
  throw Error('変更がありません。修正控えは保持しました');
 if(!window.confirm('UID '+draft.uid+'／乗務ID '+draft.shiftId+
    '／営業記録 '+draft.recordId+' の乗降地だけを保存しますか？'))return;
 await recentAdminLogin();
 if(selected?.uid!==draft.uid||selectedDuty?.shiftId!==draft.shiftId||
    selectedDuty?.revision!==draft.revision)
  throw Error('選択した日報が変わりました。保存を中止しました');
 const response=await api.updateLocations({
  uid:draft.uid,confirmationUid:draft.uid,shiftId:draft.shiftId,
  confirmationShiftId:draft.shiftId,expectedRevision:draft.revision,
  recordId:draft.recordId,pickup:draft.pickup,dropoff:draft.dropoff,confirmEdit:true
 });
 if(response.data?.uid!==draft.uid||response.data?.shiftId!==draft.shiftId||
    response.data?.recordId!==draft.recordId||
    response.data?.revision!==draft.revision+1||
    response.data?.pickup!==draft.pickup||response.data?.dropoff!==draft.dropoff)
  throw Error('サーバー保存結果を確認できません。修正控えを残しました');
 // 再取得が失敗しても修正控えを保護する。
 const confirmed=await getDutyRecord(draft.uid,draft.shiftId);
 const changed=confirmed.shift.records.filter(row=>row.id===draft.recordId);
 if(confirmed.revision!==response.data.revision||changed.length!==1||
    changed[0].raw?.AL!==draft.pickup||changed[0].raw?.AM!==draft.dropoff)
  throw Error('原本の再取得照合が一致しません。修正控えを保護しました');
 try{localStorage.removeItem(locationEditKey(draft.uid,draft.shiftId));}
 catch(e){$('adminEditStatus').textContent='保存確認済みですが修正控えの整理に失敗しました：'+String(e.message||e);}
 editDraft=null;$('adminLocationEdit').hidden=true;
 await readDuty(draft.shiftId);
 notice('乗降地の訂正を保存し、更新番号と原本の内容を読み戻し確認しました。');
}));
$('restoreDuty').addEventListener('click',()=>execute(async()=>{
 const target=selectedDuty,uid=selected?.uid;
 if(!target||target.trashed!==true||target.uid!==uid||
    selected.isAdmin&&uid!==adminUid)return;
 if(!window.confirm('UID '+uid+'／乗務ID '+target.shiftId+
  ' をゴミ箱から復元しますか？更新番号 '+target.revision+' を確認します。'))return;
 await recentAdminLogin();
 if(selected?.uid!==uid||selectedDuty!==target)
  throw Error('選択対象が変わりました。復元を中止します');
 const response=await api.restore({
  uid,confirmationUid:uid,shiftId:target.shiftId,
  confirmationShiftId:target.shiftId,expectedRevision:target.revision,
  confirmRestore:true
 });
 if(response.data?.uid!==uid||response.data?.shiftId!==target.shiftId||
    response.data?.revision!==target.revision+1||response.data?.trashed!==false)
  throw Error('復元結果を確認できません');
 const verified=await getDutyRecord(uid,target.shiftId);
 if(verified.revision!==response.data.revision||verified.trashed!==false)
  throw Error('復元後の原本が一致しません。再読み込みしてください');
 await readDuty(target.shiftId);
 notice('日報をゴミ箱から復元しました。入庫済みの原本なら乗降地を編集できます。');
}));
$('trashDutyShortcut').addEventListener('click',()=>{
 if($('trashDutyShortcut').disabled)return;
 $('dutyTrashSection').hidden=false;
 $('dutyTrashSection').scrollIntoView?.({behavior:'smooth',block:'nearest'});
 $('trashConfirmId').focus?.();
});
$('trashDuty').addEventListener('click',()=>execute(async()=>{
 if(!validSelectedDuty(true))return;
 const target=selectedDuty,uid=selected.uid;
 if(!window.confirm('UID '+uid+' の「'+target.shiftId+
   '」をゴミ箱へ移します。営業記録が表示から外れます。続行しますか？'))return;
 await recentAdminLogin();
 if(selected?.uid!==uid||selectedDuty!==target||!validSelectedDuty(true))
  throw Error('選択した日報が変更されました。操作を停止しました');
 const response=await api.trash({
  uid,shiftId:target.shiftId,confirmationUid:uid,
  confirmationShiftId:target.shiftId,
  expectedRevision:target.revision,confirmTrash:true
 });
 if(response.data?.uid!==uid||response.data.shiftId!==target.shiftId||
    response.data.trashed!==true)
  throw Error('ゴミ箱移動のサーバー確認ができません');
 notice('日報をゴミ箱へ移しました。原本は復元用に保持されています。');
 await loadDuties(true);
}));
function normalizedAdminName(value){
 if(typeof value!=='string')throw Error('新しいオプチャネームを入力してください');
 const name=value.normalize('NFC').trim();
 if(!name||Array.from(name).length>32||
    Array.from(name).some(ch=>ch.codePointAt(0)<32||ch.codePointAt(0)===127))
  throw Error('オプチャネームは改行なしの1～32文字で入力してください');
 return name;
}
$('openNameEdit').addEventListener('click',()=>{
 if(!selected||$('openNameEdit').disabled)return;
 $('adminNicknameSection').hidden=false;
 $('accountDeletionSection').hidden=true;
 $('adminNewName').value=selected.storedOpenChatName||'';
 $('adminNameStatus').textContent='登録済みの名前だけを変更します。UID・権限は変更しません。';
 $('adminNicknameSection').scrollIntoView?.({behavior:'smooth',block:'nearest'});
 $('adminNewName').focus?.();
});
$('cancelAdminName').addEventListener('click',()=>{
 if(busy)return;
 $('adminNicknameSection').hidden=true;
 $('adminNameStatus').textContent='';
});
$('saveAdminName').addEventListener('click',()=>execute(async()=>{
 if(!selected||$('adminNicknameSection').hidden)return;
 const target=selected,uid=target.uid;
 const current=target.storedOpenChatName||'';
 const next=normalizedAdminName($('adminNewName').value);
 if(next===current)throw Error('オプチャネームが変更されていません');
 if(!window.confirm('UID '+uid+' の登録名を「'+current+
  '」から「'+next+'」に変更しますか？'))return;
 await recentAdminLogin();
 if(selected!==target||selected.uid!==uid||adminUid!==auth.currentUser?.uid)
  throw Error('変更対象またはログインが変わりました。保存を停止しました');
 const result=await api.updateOpenChatName({
  uid,confirmationUid:uid,expectedName:current,newName:next
 });
 if(result.data?.uid!==uid||result.data.newName!==next||
    !['users','admins'].includes(result.data.source))
  throw Error('オプチャネーム変更結果を照合できません');
 // サーバーの一覧を読み直して反映確認。変更済みと判断して
 // ローカル表示だけ書き換えることはしない。
 await loadList();
 const verified=users.find(u=>u.uid===uid);
 if(!verified||verified.storedOpenChatName!==next)
  throw Error('更新後の登録名を確認できません。再読み込みしてください');
 selectUser(verified);
 notice('オプチャネームを更新し、サーバーから読み戻し確認しました。');
}));
$('openAccountDelete').addEventListener('click',()=>{
 if(!selected||selected.isAdmin||$('openAccountDelete').disabled)return;
 $('adminNicknameSection').hidden=true;
 $('accountDeletionSection').hidden=false;
 $('accountDeletionSection').scrollIntoView?.({behavior:'smooth',block:'nearest'});
 $('confirmUid').focus?.();
});
$('closeAccountDelete').addEventListener('click',()=>{
 if(busy)return;
 $('accountDeletionSection').hidden=true;
});
// 完全削除ボタンはテスト用明示指定・UID・サーバー照合後にだけ使用できる。
$('markTest').addEventListener('click',()=>execute(async()=>{
 if(!selectedIsValid()||selected.isAdmin||selected.testOnly||!preview||preview.uid!==selected.uid)return;
 const target=selected,checked=preview;
 if(!window.confirm('日報 '+checked.shiftCount+' 件を含むアカウントをテスト用として指定します。実営業アカウントには実行しないでください。'))return;
 await recentAdminLogin();
 const res=await api.mark({
  uid:target.uid,confirmationUid:target.uid,openChatName:target.openChatName||'',
  expectedShiftCount:checked.shiftCount,confirmedTestOnly:true
 });
 notice('テスト用に指定しました。'+String(res.data?.message||''));
 await loadList();
}));
$('preview').addEventListener('click',()=>execute(async()=>{
 if(!selectedIsValid()||selected.isAdmin)return;
 const target=selected;
 const response=await api.preview({uid:target.uid});
 preview=response.data;
 if(!preview||preview.uid!==target.uid)throw Error('UIDの照合に失敗しました');
 $('previewDetails').textContent=
  'サーバー確認：UID '+preview.uid+'／オプチャネーム '+preview.openChatName+
  '／日報 '+preview.shiftCount+' 件／設定 '+(preview.hasSettings?'あり':'なし')+
  '／操作端末 '+(preview.hasSession?'あり':'なし')+
  '／テスト指定 '+(preview.testOnly?'あり':'なし')+'。'+
  'テスト用として指定した場合だけ完全削除が可能です。';
 $('previewDetails').hidden=false;
 notice('削除対象を確認しました。実行する場合はもう一度UIDを確認してください。');
}));
$('deleteAccount').addEventListener('click',()=>execute(async()=>{
 if(!selectedIsValid()||selected.isAdmin||!preview||preview.uid!==selected.uid||!selected.testOnly)return;
 const target=selected,expected=preview;
 const exact='完全削除';
 if(window.prompt('取り消せません。実行する場合は「'+exact+'」と入力してください。')!==exact)return;
 await recentAdminLogin();
 const r=await api.remove({
  uid:target.uid,confirmationUid:$('confirmUid').value.trim(),
  openChatName:target.openChatName||'',expectedShiftCount:expected.shiftCount
 });
 notice(r.data?.message||'対象アカウントの削除が終了しました。');
 await loadList();
}));
