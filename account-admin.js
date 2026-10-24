/* TAXIAPP PC administrator console.
 * Lists registered users and fetches selected duties via administrator-only Callables.
 * Permanent deletion is performed only by an independently authorised server function.
 */
import {initializeApp,getApps,getApp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut,reauthenticateWithPopup} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {getFirestore,doc,getDocFromServer,collection,query,limit,getDocsFromServer} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js';
import './firebase-config.js';
const $=id=>document.getElementById(id);
const app=getApps().length?getApp():initializeApp(window.TAXIAPP_FIREBASE_CONFIG);
const auth=getAuth(app),db=getFirestore(app),functions=getFunctions(app,'asia-northeast1');
let adminUid='',users=[],selected=null,preview=null,busy=false,epoch=0;
let selectedDuty=null,dutyCursor=null,dutyRows=[],dutyUid='';
const api={
 mark: httpsCallable(functions,'markTestAccount'),
 preview: httpsCallable(functions,'previewTestAccountDeletion'),
 remove: httpsCallable(functions,'deleteTestAccount'),
 listDuties: httpsCallable(functions,'listAdminAccountDuties'),
 duty: httpsCallable(functions,'getAdminDutyDetail'),
 settings: httpsCallable(functions,'getAdminAccountSettings'),
 trash: httpsCallable(functions,'adminTrashAccountDuty')
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
function validSelectedDuty(){
 return !busy&&!!selected&&!!selectedDuty&&
  dutyUid===selected.uid&&selectedDuty.uid===selected.uid&&
  $('trashConfirmId').value.trim()===selectedDuty.shiftId&&
  $('trashConfirmAck').checked&&selectedDuty.trashed!==true&&
  (selectedDuty.shift?.endedAt||selectedDuty.shift?.endedIso);
}
function buttons(){
 const ok=!!selected&&!busy&&selectedIsValid();
 $('loadDuties').disabled=!selected||busy;
 $('loadSettings').disabled=!selected||busy;
 $('moreDuties').disabled=!selected||busy||!dutyCursor;
 $('trashDuty').disabled=!validSelectedDuty();
 $('markTest').disabled=!ok||selected.testOnly||!preview||preview.uid!==selected.uid||selected.status==='deleted'||selected.status==='deleting';
 $('preview').disabled=!ok||selected.status==='deleted';
 $('deleteAccount').disabled=!ok||!selected.testOnly||!preview||preview.uid!==selected.uid||preview.openChatName!==(selected.openChatName||'');
 for(const id of ['reload','search','signIn','signOut'])$(id).disabled=busy;
}
function clearDutyPanel(){
 selectedDuty=null;dutyCursor=null;dutyRows=[];dutyUid='';
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
 $('confirmUid').value='';$('ack').checked=false;
 $('previewDetails').hidden=true;
 $('targetDetails').textContent='';
 for(const [key,value] of [
  ['オプチャネーム',user.openChatName||'（未登録）'],
  ['UID',user.uid],['状態',user.status||'未設定'],
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
   [person.status||'未設定',''],[person.testOnly?'テスト用':'未指定','']
  ]){
   const td=document.createElement('td');td.textContent=txt;if(cls)td.className=cls;tr.append(td);
  }
  const td=document.createElement('td'),btn=document.createElement('button');
  btn.textContent='選択';btn.addEventListener('click',()=>selectUser(person));
  td.append(btn);tr.append(td);tbody.append(tr);
 }
 $('listCount').textContent='表示 '+shown.length+' 件（最大150件を取得）';
}
async function loadList(){
 const myEpoch=epoch;
 const snap=await getDocsFromServer(query(collection(db,'users'),limit(150)));
 if(myEpoch!==epoch||!adminUid)return;
 users=snap.docs.map(s=>{
  const value=s.data()||{};
  // The authoritative UID is ALWAYS the Firestore document ID, never
  // a field from remote data (which might be stale or malformed).
  return {
   uid:s.id,
   openChatName:typeof value.openChatName==='string'?value.openChatName:'',
   status:typeof value.status==='string'?value.status:'',
   testOnly:value.testOnly===true,
   registeredAt:value.registeredAt
  };
 })
  .sort((a,b)=>String(a.openChatName||'').localeCompare(String(b.openChatName||''),'ja'));
 selected=null;preview=null;clearDutyPanel();$('selectedPanel').hidden=true;
 renderList();
 notice('登録一覧を更新しました。');
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
 const result=await api.listDuties({uid,afterId:start||''});
 if(version!==epoch||selected?.uid!==uid)return;
 if(result.data?.uid!==uid||!Array.isArray(result.data?.shifts))
  throw Error('日報一覧のUIDが一致しません');
 dutyUid=uid;
 dutyRows=[...dutyRows,...result.data.shifts];
 dutyCursor=result.data.nextAfterId||null;
 displayDutyRows();
 notice('日報 '+dutyRows.length+' 件を表示しています。');
}
async function readDuty(shiftId){
 if(!selected)return;
 const uid=selected.uid,version=epoch;
 const result=await api.duty({uid,shiftId});
 if(version!==epoch||selected?.uid!==uid)return;
 const duty=result.data;
 if(!duty||duty.uid!==uid||duty.shiftId!==shiftId||
    duty.shift?.id!==shiftId||!Number.isSafeInteger(duty.revision))
  throw Error('日報原本のUID・ID・更新番号が一致しません');
 selectedDuty=duty;dutyUid=uid;
 $('dutySelected').hidden=false;
 $('dutyHeader').textContent='UID：'+uid+'／乗務ID：'+shiftId+
  '／更新番号：'+duty.revision+'／'+(duty.trashed?'ゴミ箱':duty.shift.endedAt||duty.shift.endedIso?'入庫済み':'進行中');
 // No HTML rendering: contents may contain passengers' addresses and GPS.
 $('dutyDetail').textContent=JSON.stringify(duty.shift,null,2);
 $('trashConfirmId').value='';$('trashConfirmAck').checked=false;
 buttons();
 notice('選択した1乗務の原本を読み取り専用で表示しました。');
}
$('loadDuties').addEventListener('click',()=>execute(()=>loadDuties(true)));
$('moreDuties').addEventListener('click',()=>execute(()=>loadDuties(false)));
$('loadSettings').addEventListener('click',()=>execute(async()=>{
 if(!selected)return;
 const uid=selected.uid,version=epoch;
 const result=await api.settings({uid});
 if(version!==epoch||selected?.uid!==uid)return;
 if(result.data?.uid!==uid)throw Error('設定のUIDが一致しません');
 $('settingsDetail').textContent=result.data.exists?
  JSON.stringify(result.data.prefs,null,2):'設定は未登録です';
 $('settingsDetail').hidden=false;
 notice('本人の設定を閲覧用に取得しました。変更・保存は行いません。');
}));
$('trashDuty').addEventListener('click',()=>execute(async()=>{
 if(!validSelectedDuty())return;
 const target=selectedDuty,uid=selected.uid;
 if(!window.confirm('UID '+uid+' の「'+target.shiftId+
   '」をゴミ箱へ移します。営業記録が表示から外れます。続行しますか？'))return;
 await recentAdminLogin();
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
$('markTest').addEventListener('click',()=>execute(async()=>{
 if(!selectedIsValid()||selected.testOnly||!preview||preview.uid!==selected.uid)return;
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
 if(!selectedIsValid())return;
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
 if(!selectedIsValid()||!preview||preview.uid!==selected.uid||!selected.testOnly)return;
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
