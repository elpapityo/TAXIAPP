/* TAXIAPP v2 cloud-sync UI adapter. Opt-in, per-duty CAS, encrypted conflict backup. */
(function(root){
'use strict';
// Event-based sync policy. Non-financial text, passenger counts, GPS samples
// and payment-method selections never cause a Google duty upload on their own.
// The next operational/fare trigger sends the complete latest duty snapshot.
const moneyFields=['K','W','AF','AG','AH','AI','AN','AO','AQ','AR'];
function moneyState(record){
 const raw=record?.raw||{},meta=record?.meta||{},split=meta.splitPayment||{};
 return [
  moneyFields.map(key=>raw[key]??''),
  meta.uberReservation??'',meta.uberTip??'',meta.uberAppDisplayed??'',
  split.manualAmount??'',
  (meta.highwaySections||[]).map(section=>section?.fee??'')
 ];
}
function recordState(record){
 if(!record)return null;
 const raw=record.raw||{},meta=record.meta||{};
 return [record.id||'',record.kind||'',record.status||'',
  raw.E??'',raw.G??'',raw.M??'',meta.settledIso||'',
  meta.cancelAt||'',moneyState(record)];
}
function dutyState(shift){
 return JSON.stringify([
  shift?.startedIso||shift?.startedAt||'',shift?.endedIso||shift?.endedAt||'',
  shift?.waiting?.id||'',shift?.waiting?.startedIso||'',
  (shift?.waitSegments||[]).map(x=>[x.id||'',x.startedIso||'',x.endedIso||'']),
  shift?.breakActive?.id||'',shift?.breakActive?.startedIso||'',
  (shift?.breakSessions||[]).map(x=>[x.id||'',x.endedIso||'']),
  recordState(shift?.draft),
  (shift?.records||[]).map(recordState)
 ]);
}
function dutyStates(model){
 return new Map((model?.shifts||[]).map(shift=>[String(shift.id),dutyState(shift)]));
}
root.TAXIAPP_SYNC_EVENT_POLICY=Object.freeze({dutyState,dutyStates});
root.TAXIAPP_SYNC_UI=function(d){
 let timer=null,viewerTimer=null,viewerBusy=false;
 let observedDutyStates=null,queuedDutyIds=new Set(),writerRunBusy=false;
 let viewerFeedback='',viewerFingerprint=null,writerFeedback='';
 let archiveRows=[],archiveDetail=null,archiveError='',archiving=false;
 let writerBootstrapBusy=false;
 const engine=root.TAXIAPP_BIDIRECTIONAL_SYNC.create({
  getModel:d.getModel,getPacket:d.getPacket,getEndpoint:d.endpoint,
  localStorage:root.localStorage,request:d.request,replaceRemoteShift:d.replace
 });
 const enabled=()=>d.prefs().syncMode==='on'&&d.configured()&&(!d.canSync||d.canSync());
 const status=()=>engine.status();
 const viewEnabled=()=>d.prefs().syncMode==='on'&&d.configured()&&Boolean(d.canView?.());
 function message(){
  if(viewEnabled()){
   if(viewerFeedback)return viewerFeedback;
   const v=engine.viewerStatus();
   return v.lastError?'閲覧受信エラー：'+v.lastError:
    v.lastSyncAt?'閲覧データ最終照合 '+new Date(v.lastSyncAt).toLocaleString('ja-JP'):'閲覧データの受信待ち';
  }
  const s=status();
  if(writerFeedback)return writerFeedback;
  if(s.lastError)return '同期エラー：'+s.lastError;
  if(s.conflicts.length)return s.conflicts.length+'乗務で競合。両方の記録を保持しています。';
  return s.lastSyncAt?'最終照合 '+new Date(s.lastSyncAt).toLocaleString('ja-JP'):'未同期';
 }
 async function bootstrapWriter(){
  if(writerBootstrapBusy||!d.writerBootstrapAllowed?.())return false;
  writerBootstrapBusy=true;
  try{
   if(!d.configured()||d.prefs().syncMode!=='on')throw Error('Google接続と双方向同期の設定が必要です');
   d.onWriterBootstrapStatus?.('Googleの最新乗務を取得中…');
   const shifts=await engine.readOnly();
   if(shifts===null)throw Error(engine.viewerStatus().lastError||'Googleから乗務を読み込めません');
   if(!d.writerBootstrapAllowed?.())return false;
   if(!await d.onWriterSnapshot(shifts))return false;
   if(!engine.adoptViewerBaseline())throw Error('同期の管理情報を保存できません');
   observedDutyStates=dutyStates(d.getModel());queuedDutyIds.clear();
   if(timer!==null){clearTimeout(timer);timer=null;}
   writerFeedback='Googleから'+shifts.length+'乗務を取得・保存しました';
   d.onWriterBootstrapReady?.();
   d.setStatus(writerFeedback);return true;
  }catch(error){
   writerFeedback='操作待機：'+String(error?.message||error);
   d.onWriterBootstrapStatus?.(writerFeedback);
   d.setStatus(writerFeedback);return false;
  }finally{writerBootstrapBusy=false;}
 }
 function queueSync(delay=250){
  if(timer!==null||!enabled()||writerRunBusy)return;
  timer=setTimeout(()=>{timer=null;void run(false);},delay);
 }
 async function run(manual=false){
  if(viewEnabled())return viewNow(manual);
  if(!enabled()){
   if(manual){
    writerFeedback='同期停止：Google接続情報または双方向同期設定を確認してください';
    d.setStatus(writerFeedback);d.toast(writerFeedback,true);
   }
   return false;
  }
  if(writerRunBusy||status().busy)return false;
  if(!manual&&!queuedDutyIds.size)return true;
  const batch=[...queuedDutyIds];
  queuedDutyIds.clear();
  writerRunBusy=true;
  writerFeedback='Googleと照合中…';
  d.setStatus(writerFeedback);
  const before=status().lastSyncAt;
  let ok=false;
  try{
   // A manual verification checks every duty; normal operations touch only
   // duties that had status, break or fare changes since the last sync.
   ok=await engine.run(manual?undefined:batch);
   if(status().conflicts.length)await saveConflictCopies();
   writerFeedback=ok?'同期完了：'+(d.getModel()?.shifts?.length||0)+'乗務を照合':
    '同期失敗：'+(status().lastError||status().conflicts.map(c=>c.reason).join('／')||'同期処理が完了していません');
   if(status().lastSyncAt>before)await d.onWriterSynced?.(status().conflicts);
   d.setStatus(message());
   // A background confirmation must never dismiss a driver's active input.
   if(!d.isSettings?.()&&!d.isEditing?.())d.render?.();
   if(manual)d.toast(message(),!ok);
   refreshPanel();
   return ok;
  }finally{
   writerRunBusy=false;
   if(!ok)batch.forEach(id=>queuedDutyIds.add(id));
   // Changes saved during the network round trip must be sent afterwards.
   // A failed batch waits for another meaningful edit, reconnect or retry.
   if(queuedDutyIds.size&&ok)queueSync(250);
  }
 }
 function schedule(){
  if(viewEnabled()){viewSchedule();return;}
  if(!enabled())return;
  const current=dutyStates(d.getModel());
  if(!observedDutyStates){observedDutyStates=current;return;}
  let changed=false;
  for(const [id,fingerprint] of current){
   if(observedDutyStates.get(id)!==fingerprint){
    queuedDutyIds.add(id);changed=true;
   }
  }
  observedDutyStates=current;
  if(changed||queuedDutyIds.size)queueSync(250);
 }
 async function viewNow(manual=false){
  if(!viewEnabled()||viewerBusy)return false;
  viewerBusy=true;
  viewerFeedback='取得中…';d.render?.();
  try{
   const shifts=await engine.readOnly();
   if(!viewEnabled())return false;
   if(shifts===null){
    viewerFeedback='取得失敗：'+engine.viewerStatus().lastError;
    d.render?.();
    d.onViewerStatus?.(message(),true);
    if(manual)d.toast(message(),true);
    return false;
   }
   const fingerprint=JSON.stringify(shifts);
   const changed=viewerFingerprint!==null&&viewerFingerprint!==fingerprint;
   viewerFingerprint=fingerprint;
   await d.onViewerSnapshot?.(shifts);
   viewerFeedback=changed?'更新完了：'+shifts.length+'乗務を確認':'最新の状態です（'+shifts.length+'乗務）';
   d.render?.();
   d.onViewerStatus?.(message(),false);
   if(manual)d.toast(message());
   refreshPanel();
   return true;
  }catch(error){
   viewerFeedback='取得失敗：'+String(error?.message||error);
   d.render?.();
   if(viewEnabled())d.onViewerStatus?.(message(),true);
   return false;
  }finally{viewerBusy=false;}
 }
 function viewSchedule(){
  if(!viewEnabled()||viewerTimer!==null||viewerBusy)return;
  viewerTimer=setTimeout(async()=>{viewerTimer=null;await viewNow();},1500);
 }
 function cancelViewer(){
  if(viewerTimer!==null)clearTimeout(viewerTimer);
  viewerTimer=null;viewerFeedback='';viewerFingerprint=null;
 }
 async function resolve(id,localWins){
  if(!enabled())return;
  const pass=String(d.root.querySelector('[data-sync-backup-password]')?.value||'');
  if(!root.TAXIAPP_TRANSFER.passwordOk(pass)){
   d.toast('競合の控えを暗号化する12文字以上のパスワードを入力してください',true);return;
  }
  if(!root.confirm('この端末とクラウドの双方を暗号化バックアップしてから、選択した版に置き換えます。続けますか？'))return;
  const ok=await engine.resolve(id,localWins,async backup=>{
   const encrypted=await root.TAXIAPP_TRANSFER.encrypt(backup,pass);
   d.download(JSON.stringify(encrypted),'TAXIAPP_競合両版_'+d.dateStamp()+'_'+id+'.json','application/json;charset=utf-8');
   return root.confirm('暗号化バックアップのダウンロード完了を確認しましたか？\n保存とパスワードを確認した場合のみ「OK」を押してください。');
  });
  d.setStatus(message());refreshPanel();
  d.toast(ok?'競合を解決しました。暗号化バックアップを保管してください。':status().lastError||'競合はそのまま保留しました',!ok);
 }

 async function saveConflictCopies(){
  if(!enabled()||archiving||!status().conflicts.length)return;
  archiving=true;
  try{
   for(const conflict of status().conflicts){
    if(!enabled())return;
    const local=d.getModel()?.shifts?.find(s=>s.id===conflict.id);
    if(!local)continue;
    const remote=await d.request('syncGet',{shiftId:conflict.id});
    if(!remote?.shift||remote.shift.id!==conflict.id)throw Error('競合のGoogle版を受信できません');
    const saved=await d.request('conflictSave',{payload:JSON.stringify({
     id:conflict.id,local,remote:remote.shift,remoteRevision:remote.revision
    })});
    if(!Array.isArray(saved?.archiveIds)||saved.archiveIds.length!==2)
     throw Error('Google上の競合保管を確認できません');
   }
   await loadArchives(false);
  }catch(error){
   archiveError='競合保管失敗：'+String(error?.message||error);
   d.setStatus(archiveError);
  }finally{archiving=false;}
 }
 async function loadArchives(manual=true){
  if(!enabled())return;
  try{
   const result=await d.request('conflictList',{});
   if(!Array.isArray(result?.archives))throw Error('競合保管一覧の形式が不正です');
   archiveRows=result.archives;archiveError='';
  }catch(error){archiveError='競合保管一覧を取得できません：'+String(error?.message||error);}
  refreshPanel();
  if(manual&&archiveError)d.toast(archiveError,true);
 }
 async function archiveAction(kind,id){
  if(!enabled())return;
  try{
   if(kind==='open'){
    archiveDetail=await d.request('conflictGet',{archiveId:id});
    if(!archiveDetail?.shift)throw Error('競合保管を取得できません');
   }else if(kind==='compare'){
    const base=String(id).replace(/-(?:local|remote)$/,'');
    const local=await d.request('conflictGet',{archiveId:base+'-local'});
    const remote=await d.request('conflictGet',{archiveId:base+'-remote'});
    if(!local?.shift||!remote?.shift||local.shift.id!==remote.shift.id)
     throw Error('比較対象の両版が揃っていません');
    archiveDetail={compare:[local,remote]};
   }else if(kind==='trash'||kind==='restore'){
    if(!root.confirm(kind==='trash'?'このコピーをゴミ箱へ移しますか？元の乗務は変更しません。':'コピーをゴミ箱から復元しますか？'))return;
    await d.request(kind==='trash'?'conflictTrash':'conflictRestore',{archiveId:id});
    await loadArchives(false);archiveDetail=null;
   }else if(kind==='keep'){
    d.toast('このコピーをGoogleの競合保管庫に保持します。正式な売上には加算されません。');
   }else if(kind==='close'){archiveDetail=null;}
   refreshPanel();
  }catch(error){archiveError=String(error?.message||error);d.toast(archiveError,true);refreshPanel();}
 }
 function vaultMarkup(){
  const escape=d.escape;
  const rows=archiveRows.map(a=>'<div class="card"><strong>'+escape(a.shiftId)+' / '+(a.kind==='local'?'PC版':'Google版')+'</strong>'+
   '<p class="helper">保管日時 '+escape(a.savedAt)+' / '+(a.trashed?'ゴミ箱':'隔離保管')+'</p>'+
   '<div class="actions"><button class="btn" type="button" data-sync-archive="compare" data-id="'+escape(a.archiveId)+'">両版を比較</button>'+
   '<button class="btn" type="button" data-sync-archive="open" data-id="'+escape(a.archiveId)+'">原本を確認</button>'+
   (!a.trashed?'<button class="btn" type="button" data-sync-archive="keep" data-id="'+escape(a.archiveId)+'">この版を保持</button>':'')+
   '<button class="btn" type="button" data-sync-archive="'+(a.trashed?'restore':'trash')+'" data-id="'+escape(a.archiveId)+'">'+(a.trashed?'復元':'ゴミ箱へ移動')+'</button></div></div>').join('');
  const show=a=>{
   const sh=a.shift;
   return '<section class="card" style="min-width:0"><strong>'+(a.kind==='local'?'PC版':'Google版')+'</strong>'+
    '<p class="helper">乗務日 '+escape(sh.date||'')+' / 出庫 '+escape(sh.startedAt||'')+
    ' / 営業記録 '+(sh.records?.length||0)+'件</p>'+
    '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto">'+escape(JSON.stringify(sh,null,2))+'</pre></section>';
  };
  const detail=archiveDetail;
  const raw=detail?.compare?'<div class="card"><h3 class="subsection">PC版とGoogle版を比較（どちらも正式売上には加算しません）</h3>'+
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px">'+detail.compare.map(show).join('')+
    '</div><button class="btn" data-sync-archive="close">閉じる</button></div>':
    detail?.shift?show(detail)+'<button class="btn" data-sync-archive="close">閉じる</button>':'';
  return '<h3 class="subsection">Google競合保管庫（売上に加算しません）</h3>'+
   '<p class="helper">元の乗務は変更せずPC版・Google版を別々に保管します。ゴミ箱へ移したコピーも復元できます。</p>'+
   '<div class="actions"><button type="button" class="btn" data-sync-archive="list">保管一覧を取得</button></div>'+
   (archiveError?'<p class="warn">'+escape(archiveError)+'</p>':'')+
   raw+(rows||'<p class="helper">一覧を取得してください。</p>');
 }
 function conflictMarkup(s){
  const conflicts=s.conflicts.map(c=>'<div class="card"><strong>競合乗務 '+d.escape(c.id)+'</strong>'+
   '<p class="warn">'+d.escape(c.reason)+'</p>'+
   '<div class="actions"><button class="btn" type="button" data-sync-resolve="remote" data-id="'+d.escape(c.id)+'">クラウド版を採用</button>'+
   '<button class="btn red" type="button" data-sync-resolve="local" data-id="'+d.escape(c.id)+'">この端末版を採用</button></div></div>').join('');
  return conflicts?'<h3 class="subsection">競合の解決</h3><p class="warn">採用する版を選ぶ前に、両方の版を暗号化バックアップします。</p>'+
   '<label class="field"><span class="field-label">バックアップ用パスワード（12文字以上）</span>'+
   '<input class="control" type="password" data-sync-backup-password autocomplete="new-password"></label>'+conflicts:'';
 }
 // Refresh the status in place after login or a manual viewer refresh.
 // Never rebuild Settings: that would collapse details and reset the scroll.
 function refreshPanel(){
  const text=d.root.querySelector('[data-sync-status]');
  if(text)text.textContent=message();
  const holder=d.root.querySelector('[data-sync-conflicts]');
  if(!holder)return;
  const signature=JSON.stringify([status().conflicts,archiveRows,archiveDetail,archiveError]);
  if(holder.dataset.syncSignature===signature)return;
  if(holder.querySelector('input:focus,textarea:focus,select:focus'))return;
  holder.innerHTML=conflictMarkup(status())+vaultMarkup();
  holder.dataset.syncSignature=signature;
 }
 function panel(){
  const on=d.prefs().syncMode==='on',s=status();
  return '<hr class="divider"><h3 class="subsection">端末間の双方向同期（ブラウザ版・Android版／試験）</h3>'+
   '<p class="helper">端末内の保存は継続します。Google側の更新番号を照合し、別端末と同時に変更した乗務は自動上書きせず保留します。</p>'+
   '<label class="field"><span class="field-label">同期モード</span><select class="control" data-cloud-setting="syncMode">'+
   '<option value="off" '+(!on?'selected':'')+'>無効（従来どおり）</option>'+
   '<option value="on" '+(on?'selected':'')+'>双方向同期（Google受信API更新後）</option></select></label>'+
   '<div class="actions"><button class="btn primary" type="button" data-action="bidirectionalSyncNow">↕ 今すぐ照合</button></div>'+
   '<p class="caption-note" data-sync-status>'+d.escape(message())+'</p>'+
   '<div data-sync-conflicts>'+conflictMarkup(s)+vaultMarkup()+'</div>'+
   '<p class="footnote">初回に同一乗務の内容が異なる場合も競合扱いです。クラウド側のコードを更新・再公開するまで有効にしないでください。端末ごとの表示設定・GPS権限は個別です。</p>';
 }
 return {enabled,run,schedule,viewNow,viewSchedule,cancelViewer,panel,resolve,status,message,archiveAction,loadArchives,bootstrapWriter};
};
})(typeof window!=='undefined'?window:globalThis);
