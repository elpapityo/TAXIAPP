/* TAXIAPP PC administrator console.
 * Reads registered users, but never downloads or modifies private duty originals.
 * Permanent deletion is performed only by an independently authorised server function.
 */
import {initializeApp,getApps,getApp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut,reauthenticateWithPopup} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {getFirestore,doc,getDocFromServer,collection,query,limit,getDocs} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js';
import './firebase-config.js';
const $=id=>document.getElementById(id);
const app=getApps().length?getApp():initializeApp(window.TAXIAPP_FIREBASE_CONFIG);
const auth=getAuth(app),db=getFirestore(app),functions=getFunctions(app,'asia-northeast1');
let adminUid='',users=[],selected=null,preview=null,busy=false,epoch=0;
const api={
 mark: httpsCallable(functions,'markTestAccount'),
 preview: httpsCallable(functions,'previewTestAccountDeletion'),
 remove: httpsCallable(functions,'deleteTestAccount')
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
function buttons(){
 const ok=!!selected&&!busy&&selectedIsValid();
 $('markTest').disabled=!ok||selected.testOnly||selected.status==='deleted'||selected.status==='deleting';
 $('preview').disabled=!ok||!selected.testOnly||selected.status==='deleted';
 $('deleteAccount').disabled=!ok||!selected.testOnly||!preview||preview.uid!==selected.uid||preview.openChatName!==(selected.openChatName||'');
 for(const id of ['reload','search','signIn','signOut'])$(id).disabled=busy;
}
function selectUser(user){
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
 const snap=await getDocs(query(collection(db,'users'),limit(150)));
 if(myEpoch!==epoch||!adminUid)return;
 users=snap.docs.map(s=>({uid:s.id,...s.data()}))
  .sort((a,b)=>String(a.openChatName||'').localeCompare(String(b.openChatName||''),'ja'));
 selected=null;preview=null;$('selectedPanel').hidden=true;
 renderList();
 notice('登録一覧を更新しました。');
}
async function execute(fn){
 if(busy||!adminUid)return;
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
}));
$('signOut').addEventListener('click',()=>execute(async()=>{await signOut(auth);}));
$('reload').addEventListener('click',()=>execute(loadList));
$('search').addEventListener('input',renderList);
$('confirmUid').addEventListener('input',buttons);
$('ack').addEventListener('change',buttons);
$('markTest').addEventListener('click',()=>execute(async()=>{
 if(!selectedIsValid()||selected.testOnly)return;
 if(!window.confirm('選択したUIDをテスト用に指定します。実営業アカウントには実行しないでください。'))return;
 const target=selected;
 await recentAdminLogin();
 const res=await api.mark({uid:target.uid,confirmationUid:target.uid,openChatName:target.openChatName||''});
 notice('テスト用に指定しました。'+String(res.data?.message||''));
 await loadList();
}));
$('preview').addEventListener('click',()=>execute(async()=>{
 if(!selectedIsValid()||!selected.testOnly)return;
 const target=selected;
 const response=await api.preview({uid:target.uid});
 preview=response.data;
 if(!preview||preview.uid!==target.uid)throw Error('UIDの照合に失敗しました');
 $('previewDetails').textContent=
  'サーバー確認：UID '+preview.uid+'／オプチャネーム '+preview.openChatName+
  '／日報 '+preview.shiftCount+' 件／操作端末・個人設定・認証情報も削除対象。'+
  '削除対象以外のデータは操作しません。';
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
