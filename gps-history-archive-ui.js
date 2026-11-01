/* 既存の履歴欄だけをGASへ接続する。測位・営業日報・位置共有は開始しない。 */
(function(root){'use strict';
function create({session,diaryAuth,gpsAuth,store,core,document:doc=root.document}){
 if(root.TAXIAPP_GPS_CLOUD_POLICY?.enabled!==false)throw Error('履歴専用モードと位置送信を同時に起動できません');
 const $=id=>doc.getElementById(id),d=diaryAuth.currentUser,g=gpsAuth.currentUser,uid=session.localUid;
 if(!d||!g||d.uid!==uid||g.uid!==session.cloudUid)throw Error('履歴の本人連携を確認できません');
 let disposed=false,busy=false,local=[],remote=[],selected=null,selection=0,map=null,layer=null;
 const bindings=[],controls=['historyShiftSelect','historyFit','historyExport','historyResend','historyResendAll','historyFetchCloud','historyDeleteCloud'];
 function current(){if(disposed||diaryAuth.currentUser!==d||gpsAuth.currentUser!==g||d.uid!==uid||g.uid!==session.cloudUid)throw Error('履歴のログイン利用者が切り替わりました');}
 function text(id,value){current();const el=$(id);if(el)el.textContent=value;}
 function access(){
  const ended=selected&&Number.isSafeInteger(selected.endedAtMs),points=ended&&selected.points?.length>0;
  for(const id of controls)if($(id))$(id).disabled=disposed||busy;
  $('historyShiftSelect').disabled=disposed||busy||!$('historyShiftSelect').options.length;
  $('historyFit').disabled=$('historyExport').disabled=disposed||busy||!points;
  $('historyResend').disabled=disposed||busy||!ended||!local.some(r=>r.shiftId===selected.shiftId&&r.serverStatus!=='削除済み');
  $('historyDeleteCloud').disabled=disposed||busy||!selected||!(selected.serverStatus==='保存済み'||remote.some(r=>r.shiftId===selected.shiftId));
  $('historyResendAll').disabled=disposed||busy||!local.some(r=>Number.isSafeInteger(r.endedAtMs)&&!['保存済み','削除済み'].includes(r.serverStatus));
 }
 function bind(id,event,action){
  const el=$(id),handler=()=>run(action);el.addEventListener(event,handler);bindings.push(()=>el.removeEventListener(event,handler));
 }
 async function run(action){
  if(disposed||busy)return;busy=true;access();
  try{current();await action();current();}catch(error){if(!disposed&&diaryAuth.currentUser===d&&gpsAuth.currentUser===g)text('cloudStatus','履歴操作を完了できませんでした：'+String(error.message||error));}
  finally{busy=false;if(!disposed)access();}
 }
 async function choose(){
  const epoch=++selection,id=$('historyShiftSelect').value;selected=null;layer?.clearLayers();access();
  if(!id){text('historyDetail','記録した乗務を選択してください。');return;}
  let row=local.find(r=>r.shiftId===id);
  if(!row){text('historyDetail','選択した乗務のクラウド履歴を取得中…');row=await session.readRemote(uid,id);current();}
  if(epoch!==selection||$('historyShiftSelect').value!==id)return;
  if(!row){text('historyDetail','このクラウド履歴は存在しないか保存期限を過ぎています。');return;}
  if(row.uid!==uid||row.shiftId!==id)throw Error('履歴の所有者が一致しません');
  if(Number.isSafeInteger(row.endedAtMs)&&row.points?.length)root.TAXIAPP_GPS_HISTORY_SYNC.prepare(row);
  selected=row;
  text('historyDetail',(local.some(r=>r.shiftId===id)?'端末内':'クラウド')+'｜'+(row.points?.length||0)+'地点｜'+(row.serverStatus||'未送信')+'｜'+id);
  access();
 }
 async function refresh(){
  current();const rows=await store.list(uid);current();
  if(rows.some(r=>r.uid!==uid))throw Error('別の本人の端末履歴が含まれています');
  local=rows;const old=$('historyShiftSelect').value,merged=new Map(remote.map(r=>[r.shiftId,r]));
  for(const row of rows)merged.set(row.shiftId,row); // 未同期の端末原本をクラウド通知で置換しない。
  $('historyShiftSelect').replaceChildren();
  for(const row of [...merged.values()].sort((a,b)=>b.startedAtMs-a.startedAtMs)){
   const option=doc.createElement('option');option.value=row.shiftId;
   option.textContent=new Date(row.startedAtMs).toLocaleString('ja-JP')+'｜'+(rows.some(r=>r.shiftId===row.shiftId)?'端末内':'クラウド')+'｜'+(row.serverStatus||'未送信');
   $('historyShiftSelect').append(option);
  }
  if(merged.has(old))$('historyShiftSelect').value=old;
  text('connection','位置共有と新しいGPS記録は停止中です。保存済み履歴は下の手動操作で確認できます。');
  text('historyState','保存済み履歴の手動操作。位置共有・新しいGPS記録は停止中です。');
  text('storageSummary','端末内 '+local.length+'乗務／クラウド一覧 '+remote.length+'乗務（端末原本は自動削除しません）');
  await choose();current();access();
 }
 async function fetchCloud(){
  text('cloudStatus','クラウドの乗務一覧を確認中…');remote=await session.listRemote(uid);current();
  // 一覧では座標を取得せず、選択したクラウド専用乗務だけchooseで読む。
  await refresh();text('cloudStatus','クラウド一覧 '+remote.length+'乗務を確認しました。');
 }
 async function resend(){
  const id=$('historyShiftSelect').value;if(!id)return;
  const result=await session.one(uid,id);current();await refresh();
  text('cloudStatus',result.status==='saved'?'内容照合後にクラウド保存を確認しました。':result.message||'送信結果：'+result.status);
 }
 async function resendAll(){
  const results=await session.all(uid);current();await refresh();
  text('cloudStatus','履歴送信の結果：'+results.map(r=>r.shiftId+' '+r.status).join('／')+(results.some(r=>r.status==='error')?'。以降の送信は保留しました。通信・資格を確認して再操作してください。':''));
 }
 async function syncAudits(){
  current();if(root.navigator?.onLine===false){text('auditState','CSV監査は端末保存済み・通信復旧後に再送します。');return;}
  const rows=await store.pendingAudits(uid);current();
  for(const row of rows){
   await session.recordCsvAudit(uid,row);current();await store.confirmAudit(uid,row.operationId);current();
  }
  text('auditState','CSV監査のサーバー保存を確認しました。');
 }
 async function csv(){
  const row=selected;if(!row||!row.points?.length)return;
  if(root.TAXIAPP_GPS_HISTORY_SYNC.retentionDeadlineMs(row.endedAtMs)<=Date.now())throw Error('保存期限を過ぎた履歴です。端末原本は保持します');
  await store.queueCsvAudit(uid,row.shiftId);current();
  const blob=new Blob([core.historyCsv(row.points)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);
  const anchor=doc.createElement('a');anchor.href=url;anchor.download=new Date(row.startedAtMs+9*3600000).toISOString().slice(0,19).replace('T','_').replaceAll(':','-')+'_'+row.shiftId+'_gps.csv';
  doc.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  text('csvDownloadInfo','CSVファイル名：'+anchor.download+'（ブラウザのダウンロード一覧で確認）');
  text('auditState','CSV監査は端末保存済み。');
  try{await syncAudits();}catch(error){current();text('auditState','CSV監査は端末に保持しています：'+String(error.message||error));}
 }
 async function remove(){
  const id=$('historyShiftSelect').value;if(!id)return;
  if(!root.confirm('選択した乗務のクラウドGPS履歴を削除します。端末原本は残します。削除しますか？'))return;
  current();await session.removeRemote(uid,id,id);current();
  const row=await store.fetchOne(uid,id);current();if(row)await store.setSyncState(uid,id,'削除済み');current();
  remote=remote.filter(r=>r.shiftId!==id);await refresh();text('cloudStatus','クラウド削除と削除済みの印を確認しました。端末原本は保持しています。');
 }
 function fit(){
  current();if(!root.L||!selected)return;
  const points=(selected.points||[]).filter(p=>!p.suspectedJump);if(!points.length)return;
  if(!map){map=root.L.map('historyMap');root.L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© 国土地理院'}).addTo(map);layer=root.L.layerGroup().addTo(map);}
  layer.clearLayers();const groups=new Map();for(const p of points){if(!groups.has(p.segmentNo))groups.set(p.segmentNo,[]);groups.get(p.segmentNo).push(p);}
  for(const group of groups.values())if(group.length>1)root.L.polyline(group.map(p=>[p.lat,p.lon]),{color:'#1868b8',weight:4}).addTo(layer);
  for(const p of [points[0],points[points.length-1]])root.L.circleMarker([p.lat,p.lon],{radius:6}).addTo(layer);
  if(points.length===1)map.setView([points[0].lat,points[0].lon],15);else map.fitBounds(root.L.latLngBounds(points.map(p=>[p.lat,p.lon])).pad(.12),{maxZoom:16});
 }
 bind('historyShiftSelect','change',choose);bind('historyFetchCloud','click',fetchCloud);bind('historyResend','click',resend);bind('historyResendAll','click',resendAll);bind('historyExport','click',csv);bind('historyDeleteCloud','click',remove);bind('historyFit','click',fit);
 const online=()=>run(syncAudits);root.addEventListener('online',online);bindings.push(()=>root.removeEventListener('online',online));
 access();
 return Object.freeze({refresh,
  dispose(){if(disposed)return;disposed=true;++selection;session.dispose();for(const off of bindings)off();map?.remove();map=null;selected=null;local=[];remote=[];for(const id of controls)if($(id))$(id).disabled=true;$('historyShiftSelect').replaceChildren();$('historyDetail').textContent='ログイン利用者を確認してください。';}
 });
}
root.TAXIAPP_GPS_HISTORY_ARCHIVE_UI=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
