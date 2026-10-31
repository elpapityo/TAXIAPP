/* TAXIAPP GPS履歴管理者画面。日報データには一切アクセスしない。 */
(async()=>{
'use strict';
const $=id=>document.getElementById(id),txt=(id,value)=>{$(id).textContent=String(value)};
const core=window.TAXIAPP_GPS_SHARING_CORE,config=window.TAXIAPP_FIREBASE_CONFIG;
let auth=null,users=[],map=null,layer=null,functions=null,httpsCallable=null;
let currentUser=null,currentTarget='',currentShift='',serverResult=null;
if(!config||!core){txt('status','TAXIAPPの設定を確認できません');return;}
const version='12.4.0';
function makeMap(){
 if(!window.L){txt('status','地図を表示できません');return;}
 map=L.map('historyMap').setView([34.75,135.4],10);
 L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',{
  minZoom:5,maxZoom:18,attribution:'© 国土地理院'}).addTo(map);
 layer=L.layerGroup().addTo(map);
}
function fitRoute(){
 if(!map||!serverResult)return;
 const points=(serverResult.points||[]).filter(p=>p.suspectedJump!==true);
 if(!points.length)return;
 const bounds=L.latLngBounds(points.map(p=>[p.lat,p.lon]));
 if(points.length===1)map.setView([points[0].lat,points[0].lon],15);
 else map.fitBounds(bounds.pad(.12),{maxZoom:16});
}
function drawRoute(){
 if(!map||!layer)return;
 layer.clearLayers();
 if(!serverResult)return;
 const points=(serverResult.points||[]).filter(p=>p.suspectedJump!==true);
 const groups=new Map();
 for(const point of points){
  const n=point.segmentNo;
  if(!groups.has(n))groups.set(n,[]);
  groups.get(n).push(point);
 }
 for(const group of groups.values()){
  if(group.length<2)continue;
  const line=L.polyline(group.map(p=>[p.lat,p.lon]),{color:'#1868b8',weight:4}).addTo(layer);
  line.on('click',event=>{
   let closest=null,best=Infinity;
   for(const p of group){
    const meters=core.distanceMeters({lat:event.latlng.lat,lon:event.latlng.lng},p);
    if(meters<best){closest=p;best=meters;}
   }
   if(closest)L.popup().setLatLng([closest.lat,closest.lon])
    .setContent('測位日時 '+new Date(closest.capturedAtMs).toLocaleString('ja-JP'))
    .openOn(map);
  });
 }
 if(points.length){
  const first=points[0],last=points[points.length-1];
  L.circleMarker([first.lat,first.lon],{radius:7,color:'#078a70'}).bindPopup('記録開始').addTo(layer);
  L.circleMarker([last.lat,last.lon],{radius:7,color:'#c23b42'}).bindPopup('記録終了').addTo(layer);
 }
 fitRoute();
}
function fileName(result){
 const jst=new Date(result.startedAtMs+9*3600000).toISOString().slice(0,19)
  .replace('T','_').replace(/:/g,'-');
 return jst+'_'+result.shiftId+'_gps.csv';
}
function downloadCsv(result){
 const csv=core.historyCsv(result.points);
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
 const uri=URL.createObjectURL(blob),anchor=document.createElement('a');
 anchor.href=uri;anchor.download=fileName(result);document.body.append(anchor);
 anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(uri),1000);
}
async function call(name,data){
 const callable=httpsCallable(functions,name);
 const result=await callable(data);
 return result.data;
}
async function selectTarget(){
 const target=$('target').value;currentTarget=target;
 currentShift='';serverResult=null;layer?.clearLayers();
 $('shift').replaceChildren();$('shift').disabled=true;
 $('view').disabled=true;$('export').disabled=true;$('delete').disabled=true;
 if(!target)return;
 txt('status','選択利用者の保存済みGPS履歴を確認中');
 try{
  const result=await call('adminListGpsHistory',{targetUid:target});
  if(currentTarget!==target)return;
  for(const item of result.shifts||[]){
   const option=document.createElement('option');option.value=item.shiftId;
   option.textContent=new Date(item.startedAtMs).toLocaleString('ja-JP')+
    ' ～ '+new Date(item.endedAtMs).toLocaleString('ja-JP')+'｜'+item.shiftId;
   $('shift').append(option);
  }
  $('shift').disabled=!(result.shifts||[]).length;
  $('view').disabled=$('shift').disabled;
  currentShift=$('shift').value;
  txt('status','履歴 '+(result.shifts||[]).length+'乗務。選択後「履歴を開く」を押してください');
 }catch(error){txt('status','履歴一覧の確認に失敗：'+String(error.message||error));}
}
async function viewSelected(){
 const target=currentTarget,id=$('shift').value;
 if(!target||!id)return;
 txt('status','管理者権限と監査ログ保存を確認中');
 $('view').disabled=true;serverResult=null;layer?.clearLayers();
 try{
  // Server logs actor/time/target/shift before returning coordinates.
  const result=await call('adminViewGpsHistory',{targetUid:target,shiftId:id});
  if(currentTarget!==target||$('shift').value!==id)return;
  serverResult=result;currentShift=id;drawRoute();
  $('export').disabled=false;$('delete').disabled=false;
  txt('status','履歴を表示：GPS '+result.points.length+'点（閲覧監査済み）');
 }catch(error){
  txt('status','閲覧不可（監査ログ・権限・通信を確認）：'+String(error.message||error));
 }finally{$('view').disabled=false;}
}
async function exportSelected(){
 const target=currentTarget,id=currentShift;
 if(!target||!id||!serverResult)return;
 if(!confirm('選択した利用者のGPS履歴をCSV書き出ししますか？'))return;
 txt('status','書き出し監査ログを保存中');
 try{
  const result=await call('adminExportGpsHistory',{
   targetUid:target,shiftId:id,confirmedExport:true
  });
  if(currentTarget!==target||currentShift!==id)return;
  downloadCsv(result);
  txt('status','CSV出力を行いました（監査ログ保存済み）');
 }catch(error){txt('status','CSV出力不可：'+String(error.message||error));}
}
async function deleteSelected(){
 const target=currentTarget,id=currentShift;
 if(!target||!id||!serverResult)return;
 if(!confirm('この利用者の選択乗務のGPS履歴をサーバーから削除します。よろしいですか？'))return;
 txt('status','削除操作と監査ログを保存中');
 try{
  const result=await call('deleteGpsHistory',{targetUid:target,shiftId:id,
   confirmationShiftId:id});
  if(currentTarget!==target)return;
  serverResult=null;layer?.clearLayers();
  txt('status',result.status==='deleted'?'GPS履歴を削除しました（監査ログ記録済み）':
   'このGPS履歴はすでに削除されています');
  await selectTarget();
 }catch(error){txt('status','削除不可：'+String(error.message||error));}
}
async function init(){
 makeMap();
 $('target').addEventListener('change',selectTarget);
 $('shift').addEventListener('change',()=>{currentShift=$('shift').value;
  serverResult=null;layer?.clearLayers();$('export').disabled=true;$('delete').disabled=true;});
 $('view').addEventListener('click',viewSelected);
 $('export').addEventListener('click',exportSelected);
 $('delete').addEventListener('click',deleteSelected);
 $('fit').addEventListener('click',fitRoute);
 const [{initializeApp,getApp,getApps},a,f,fn]=await Promise.all([
  import('https://www.gstatic.com/firebasejs/'+version+'/firebase-app.js'),
  import('https://www.gstatic.com/firebasejs/'+version+'/firebase-auth.js'),
  import('https://www.gstatic.com/firebasejs/'+version+'/firebase-firestore.js'),
  import('https://www.gstatic.com/firebasejs/'+version+'/firebase-functions.js')]);
 const app=getApps().length?getApp():initializeApp(config);
 auth=a.getAuth(app);const db=f.getFirestore(app);
 functions=fn.getFunctions(app,'asia-northeast1');httpsCallable=fn.httpsCallable;
 a.onAuthStateChanged(auth,async user=>{
  $('adminPanel').hidden=true;currentUser=user;currentTarget='';serverResult=null;
  if(!user){txt('status','TAXIAPP本体でログインしてください');return;}
  try{
   const admin=await f.getDocFromServer(f.doc(db,'admins',user.uid));
   if(currentUser!==user)return;
   if(!admin.exists()||admin.data().enabled!==true){
    txt('status','管理者権限がありません');return;
   }
   const snap=await f.getDocsFromServer(f.collection(db,'users'));
   if(currentUser!==user)return;
   users=snap.docs.map(x=>({uid:x.id,name:String(x.data().openChatName||x.id)}))
    .sort((x,y)=>x.name.localeCompare(y.name,'ja'));
   $('target').replaceChildren(new Option('利用者を選択',''));
   for(const item of users)$('target').append(new Option(item.name+'（'+item.uid.slice(-5)+'）',item.uid));
   $('adminPanel').hidden=false;
   txt('status','管理者の認証を確認しました。利用者を選択してください');
  }catch(error){txt('status','権限確認に失敗：'+String(error.message||error));}
 });
}
try{await init()}catch(error){txt('status','管理者画面の起動に失敗：'+String(error.message||error));}
})();