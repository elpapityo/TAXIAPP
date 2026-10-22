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
  (meta.highwaySections||[]).map(section=>section?.fee??'').filter(fee=>String(fee)!=='')
 ];
}
function recordState(record){
 if(!record)return null;
 const raw=record.raw||{},meta=record.meta||{};
 return [record.id||'',record.kind||'',record.status||'',
  raw.E??'',raw.G??'',raw.M??'',meta.settledIso||'',
  meta.cancelAt||'',moneyState(record)];
}
function dutyState(shift,operationalOnly=false){
 const eventRecord=record=>operationalOnly?[
  record?.id||'',record?.kind||'',record?.status||'',
  record?.meta?.settledIso||'',record?.meta?.cancelAt||''
 ]:recordState(record);
 return JSON.stringify([
  shift?.startedIso||shift?.startedAt||'',shift?.endedIso||shift?.endedAt||'',
  shift?.waiting?.id||'',shift?.waiting?.startedIso||'',
  (shift?.waitSegments||[]).map(x=>[x.id||'',x.startedIso||'',x.endedIso||'']),
  shift?.breakActive?.id||'',shift?.breakActive?.startedIso||'',
  (shift?.breakSessions||[]).map(x=>[x.id||'',x.endedIso||'']),
  eventRecord(shift?.draft),
  (shift?.records||[]).map(eventRecord)
 ]);
}
function dutyStates(model,operationalOnly=false){
 return new Map((model?.shifts||[]).map(shift=>[String(shift.id),dutyState(shift,operationalOnly)]));
}
root.TAXIAPP_SYNC_EVENT_POLICY=Object.freeze({dutyState,dutyStates});
root.TAXIAPP_SYNC_UI=function(d){
 let timer=null,viewerTimer=null,viewerBusy=false;
 let observedDutyStates=null,queuedDutyIds=new Set(),writerRunBusy=false;
 let viewerFeedback='',viewerFingerprint=null,writerFeedback='';
 let archiveRows=[],archiveDetail=null,archiveError='',archiving=false;
 let cloudRows=[],cloudError='',cloudBusy=false,cloudLoaded=false,cloudEpoch=0;
 let comparedDuties={};
 let writerBootstrapBusy=false,writerBootstrapEpoch=0;
 const engine=root.TAXIAPP_BIDIRECTIONAL_SYNC.create({
  getModel:d.getModel,getPacket:d.getPacket,getEndpoint:d.endpoint,
  localStorage:root.localStorage,request:d.request,replaceRemoteShift:d.replace,
  getScopeKey:d.scopeKey,getRemoteOnDemand:d.remoteOnDemand
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
  const token=++writerBootstrapEpoch;
  const accountEndpoint=d.endpoint(),accountUid=String(d.scopeKey?.()||'');
  const stable=()=>token===writerBootstrapEpoch&&
   accountUid===String(d.scopeKey?.()||'')&&d.endpoint()===accountEndpoint;
  try{
   // Legacy managers intentionally run with bidirectional sync OFF by default.
   // Their locally persisted duties must remain editable in a confirmed
   // writer session, without a compulsory Google pull or data replacement.
   if(d.allowLegacyLocalWriter?.()&&d.prefs().syncMode!=='on'){
    if(!stable()||!d.writerBootstrapAllowed?.())return false;
    writerFeedback='端末内の日報を使用中（双方向同期OFF）';
    observedDutyStates=dutyStates(d.getModel(),Boolean(d.remoteOnDemand?.()));
    d.onWriterBootstrapReady?.();
    d.setStatus(writerFeedback);
    return true;
   }
   if(d.remoteOnDemand?.()){
    if(!d.configured()||d.prefs().syncMode!=='on')
     throw Error('本人Firestoreの接続と同期設定を確認してください');
    d.onWriterBootstrapStatus?.('本人Firestoreの乗務一覧を確認中…');
    const local=[...(d.getModel()?.shifts||[])];
    const ids=local.map(shift=>String(shift?.id||''));
    if(ids.some(id=>!/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(id))||
       new Set(ids).size!==ids.length)
      throw Error('端末の日報IDに不正または重複があります。原本を保持して照合を停止しました');
    // Existing phone originals already identify the duties to check. Do not
    // download every historical Firestore document during this login.
    // Exceptional unsynced/legacy originals may exceed one duty: check in
    // bounded batches without deleting or ignoring any of them.
    const listRows=[];
    if(ids.length){
      for(let i=0;i<ids.length;i+=60){
        const listing=await d.request('syncList',{shiftIds:ids.slice(i,i+60)});
        if(!stable())return false;
        if(!Array.isArray(listing?.shifts))
          throw Error('Firestoreの日報一覧を確認できません');
        listRows.push(...listing.shifts);
      }
    }else if(!d.previewFreshOnly?.()){
      // A normal new device resumes just one owner duty. A development-only
      // administrator preview is different: never import an unrelated live
      // owner original into the isolated synthetic-data editor.
      const listing=await d.request('syncList',{resumeOnly:true,
       excludeIds:d.resumeExcludedIds?.()||[]});
      if(!stable())return false;
      if(!Array.isArray(listing?.shifts))
        throw Error('Firestoreの再開候補を確認できません');
      listRows.push(...listing.shifts);
    }
    const listing={shifts:listRows};
    const seen=new Set();
    for(const row of listing.shifts){
     if(!/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(String(row?.id||''))||
        seen.has(row.id)||!Number.isSafeInteger(Number(row.revision)))
      throw Error('Firestoreの乗務一覧が不正です');
     seen.add(row.id);
    }
    let selected=local,receivedForBootstrap=null;
    if(!local.length){
     const available=listing.shifts.filter(row=>!row.deleted);
     const open=available.filter(row=>!row.ended);
     if(open.length>1)throw Error('未入庫の乗務が複数あります。誤選択を避けるため自動受信を停止しました');
     const candidate=open[0]||available.sort((a,b)=>String(b.startedIso||'').localeCompare(String(a.startedIso||'')))[0];
     if(candidate){
      const received=await d.request('syncGet',{shiftId:candidate.id});
      if(!stable())return false;
      if(received?.id!==candidate.id||received?.revision!==candidate.revision||
         received.shift?.id!==candidate.id)throw Error('Firestoreの乗務が受信中に変更されました');
      selected=[received.shift];
      receivedForBootstrap=received;
     }
    }
    if(!stable()||!d.writerBootstrapAllowed?.())return false;
    if(!await d.onWriterSnapshot(selected))return false;
    if(!stable())return false;
    if(receivedForBootstrap&&!engine.adoptReceivedDuty(receivedForBootstrap))
     throw Error('再開した原本の更新番号を端末へ保護できません。再送を停止しました');
    observedDutyStates=dutyStates(d.getModel(),Boolean(d.remoteOnDemand?.()));queuedDutyIds.clear();
    // Offline or unsent local duties must be retried after sign-in; never
    // assume that a successful login means they reached Firestore.
    local.forEach(shift=>queuedDutyIds.add(shift.id));
    writerFeedback=d.previewFreshOnly?.()?
     '管理者検証領域を準備済み／Firestoreへの原本保存は未確認':
     '本人Firestoreへ接続済み／端末の日報'+(d.getModel()?.shifts?.length||0)+'件を保護';
    d.onWriterBootstrapReady?.();
    d.setStatus(writerFeedback);
    if(queuedDutyIds.size)queueSync(400);
    return true;
   }
   if(!d.configured()||d.prefs().syncMode!=='on')throw Error('Google接続と双方向同期の設定が必要です');
   d.onWriterBootstrapStatus?.('Googleの最新乗務を取得中…');
   const shifts=await engine.readOnly();
   if(!stable())return false;
   if(shifts===null)throw Error(engine.viewerStatus().lastError||'Googleから乗務を読み込めません');
   const visible=engine.excludeLocalRemovals(shifts);
   if(!stable()||!d.writerBootstrapAllowed?.())return false;
   const planned=engine.planSafeWriterSnapshot(visible);
   if(!await d.onWriterSnapshot(planned.shifts))return false;
   if(!stable())return false;
   if(!engine.adoptViewerBaseline())throw Error('同期の管理情報を保存できません');
   observedDutyStates=dutyStates(d.getModel(),Boolean(d.remoteOnDemand?.()));queuedDutyIds.clear();
   planned.pendingIds.forEach(id=>queuedDutyIds.add(id));
   if(timer!==null){clearTimeout(timer);timer=null;}
   writerFeedback='クラウドから'+visible.length+'乗務を取得・端末の未同期'+planned.pendingIds.length+
    '乗務を保護'+(planned.heldIds.length?'／以前の同期済み'+planned.heldIds.length+
    '乗務はクラウド不在のため照合保留（自動再送信しません）':'');
   d.onWriterBootstrapReady?.();
   if(queuedDutyIds.size||engine.hasLocalRemovals())queueSync(400);
   d.setStatus(writerFeedback);return true;
  }catch(error){
   if(stable()){
    writerFeedback='操作待機：'+String(error?.message||error);
    d.onWriterBootstrapStatus?.(writerFeedback);
    d.setStatus(writerFeedback);
   }
   return false;
  }finally{if(token===writerBootstrapEpoch)writerBootstrapBusy=false;}
 }
 function queueSync(delay=250){
  if(timer!==null||!enabled()||writerRunBusy)return;
  timer=setTimeout(()=>{timer=null;void run(false);},delay);
 }
 async function run(manual=false,onlyIds=null){
  if(viewEnabled())return viewNow(manual);
  if(!enabled()){
   if(manual){
    writerFeedback=d.remoteOnDemand?.()?'同期停止：本人Firestoreの接続と編集端末の設定を確認してください':
     '同期停止：Google接続情報または双方向同期設定を確認してください';
    d.setStatus(writerFeedback);d.toast(writerFeedback,true);
   }
   return false;
  }
  if(writerRunBusy||status().busy){
   // A status/payment/return event must not vanish while the preceding
   // one-duty upload is still running.
   if(Array.isArray(onlyIds))onlyIds.forEach(id=>queuedDutyIds.add(id));
   return false;
  }
  // Deletion markers persist across logout/restart even when the in-memory
  // event queue is cleared. Include them in each required retry batch.
  const requested=Array.isArray(onlyIds)?onlyIds:null;
  if(!manual&&!requested&&!queuedDutyIds.size&&!engine.hasLocalRemovals())return true;
  if(requested&&(requested.length!==1||typeof requested[0]!=='string'||
    !d.getModel()?.shifts?.some(shift=>shift.id===requested[0]))){
   d.toast('選択した乗務が見つからないため、'+
    (d.remoteOnDemand?.()?'本人Firestore同期':'Google送信')+'を停止しました',true);
   return false;
  }
  const pending=[...new Set([...queuedDutyIds,...engine.localRemovalIds()])];
  const firestore=Boolean(d.remoteOnDemand?.());
  // Even an explicit manual check must not enumerate the owner's entire
  // Firestore archive. Check local duty IDs plus pending removal markers,
  // using the same bounded query batches as event-triggered sync.
  const selectedNow=firestore&&manual&&!requested?
   [...new Set([...(d.getModel()?.shifts||[]).map(shift=>shift.id),...pending])]:pending;
  // Exceptional unsynced originals have no count limit; only each network
  // request is limited to 60 known IDs. Preserve the remainder for retry.
  const batch=firestore&&!requested?selectedNow.slice(0,60):pending;
  const deferred=firestore&&!requested?selectedNow.slice(batch.length):[];
  // A required single-duty event can run without a manual dialog. Leave
  // other pending duties untouched, and requeue this one if the upload fails.
  if(requested)requested.forEach(id=>queuedDutyIds.delete(id));
  else {
   queuedDutyIds.clear();
   deferred.forEach(id=>queuedDutyIds.add(id));
  }
  writerRunBusy=true;
  writerFeedback=(d.remoteOnDemand?.()?'本人Firestore':'Google')+'と照合中…';
  d.setStatus(writerFeedback);
  const before=status().lastSyncAt;
  let ok=false;
  try{
   // A manual verification checks every duty; normal operations touch only
   // duties that had status, break or fare changes since the last sync.
   ok=await engine.run(requested|| (firestore?batch:(manual?undefined:batch)));
   if(status().conflicts.length)await saveConflictCopies();
   writerFeedback=ok?(requested?'同期完了：選択した1乗務を照合':
     firestore?
      '同期完了：'+batch.length+'乗務を照合'+
      (deferred.length?'／残り'+deferred.length+'乗務は再送待ち':''):
      '同期完了：現在の端末'+(d.getModel()?.shifts?.length||0)+'乗務と削除状態を照合'):
    '同期失敗：'+(status().lastError||status().conflicts.map(c=>c.reason).join('／')||'同期処理が完了していません');
   if(status().lastSyncAt>before)await d.onWriterSynced?.(status().conflicts);
   d.setStatus(message());
   // A background confirmation must never dismiss a driver's active input.
   if(!d.isSettings?.()&&!d.isEditing?.())d.render?.();
   if(manual)d.toast(message(),!ok);
   refreshPanel();
   return ok;
  }catch(error){
   writerFeedback='同期失敗：'+String(error?.message||error);
   d.setStatus(writerFeedback);
   if(manual)d.toast(writerFeedback,true);
   return false;
  }finally{
   writerRunBusy=false;
   if(!ok){
    batch.forEach(id=>queuedDutyIds.add(id));
    if(requested)requested.forEach(id=>queuedDutyIds.add(id));
   }
   // Changes saved during the network round trip must be sent afterwards.
   // A failed batch waits for another meaningful edit, reconnect or retry.
   if(queuedDutyIds.size&&ok)queueSync(250);
  }
 }
 function verifiedRevision(id){
  return enabled()&&!queuedDutyIds.has(id)?engine.verifiedRevision(id):null;
 }
 function dutySyncStatus(shift){
  if(!d.remoteOnDemand?.())return {state:'legacy',label:'Google原本運用中（Firestore未確認）',revision:null};
  if(!shift?.id)return {state:'none',label:'日報がありません',revision:null};
  const id=String(shift.id);
  if(status().conflicts.some(c=>c.id===id)||engine.isConflict(id))
   return {state:'conflict',label:'競合：端末とサーバーを保護中',revision:null};
  if(engine.isSendUnknown(id))return {state:'unknown',label:'送信結果不明：原本を保持',revision:null};
  const revision=verifiedRevision(id);
  if(revision!==null)return {state:'confirmed',label:'保存確認済み（更新番号 '+revision+'）',revision};
  if(writerRunBusy||status().busy)return {state:'pending',label:'同期中・保存未確認',revision:null};
  return {state:'pending',label:'未同期（Firestore保存未確認）',revision:null};
 }
 function resetAccount(){
  // Cancel older writer bootstrap without blocking the next UID's session.
  writerBootstrapEpoch++;writerBootstrapBusy=false;
  if(timer!==null)clearTimeout(timer);
  if(viewerTimer!==null)clearTimeout(viewerTimer);
  timer=null;viewerTimer=null;
  observedDutyStates=null;queuedDutyIds.clear();
  writerFeedback='';viewerFeedback='';viewerFingerprint=null;
  archiveRows=[];archiveDetail=null;archiveError='';
  cloudEpoch++;
  cloudRows=[];cloudError='';cloudLoaded=false;cloudBusy=false;comparedDuties={};
  engine.resetAccount();
 }
 function schedule(retry=false){
  if(viewEnabled()){viewSchedule();return;}
  if(!enabled())return;
  const current=dutyStates(d.getModel(),Boolean(d.remoteOnDemand?.()));
  if(!observedDutyStates){observedDutyStates=current;if(queuedDutyIds.size||engine.hasLocalRemovals())queueSync(250);return;}
  let changed=false;
  for(const [id,fingerprint] of current){
   if(observedDutyStates.get(id)!==fingerprint){
    queuedDutyIds.add(id);changed=true;
   }
  }
  observedDutyStates=current;
  if(changed||(retry&&queuedDutyIds.size))queueSync(250);
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
 async function compare(id){
  if(!(enabled()||(d.canReviewBlockedConflict?.()&&status().conflicts.length))||!status().conflicts.some(x=>x.id===id))return false;
  const uid=String(d.scopeKey?.()||''),endpoint=String(d.endpoint()||''),epoch=cloudEpoch;
  const check=()=>uid===String(d.scopeKey?.()||'')&&endpoint===String(d.endpoint()||'')&&epoch===cloudEpoch;
  try{
   const local=d.getModel()?.shifts?.find(shift=>shift.id===id);
   if(!local)throw Error('端末版の日報がありません');
   const server=await d.request('syncGet',{shiftId:id});
   if(!check()||server?.id!==id||server.shift?.id!==id)
    throw Error('ログイン利用者または比較対象が変わりました');
   const present=shift=>({
    date:String(shift.date||''),started:String(shift.startedAt||shift.startedIso||''),
    ended:String(shift.endedAt||shift.endedIso||''),count:shift.records?.length||0,
    records:(shift.records||[]).map(r=>{
     const raw=r.raw||{},meta=r.meta||{};
     return {
      kind:String(r.kind==='ride'?'乗車':r.kind==='cancel'?'キャンセル':r.kind||''),
      board:String(raw.G||r.boardedAt||r.pickupTime||''),
      alight:String(raw.M||r.alightedAt||r.dropoffTime||''),
      fare:String(raw.K??r.fare??''),
      pickup:String(raw.AL||r.pickup||r.pickupAddress||''),
      dropoff:String(raw.AM||r.dropoff||r.dropoffAddress||''),
      payment:String(raw.W||r.paymentMethod||meta.paymentMethod||'')
     };
    })
   });
   comparedDuties[id]={local:present(local),remote:present(server.shift),differences:conflictDifferences(local,server.shift)};
   refreshPanel();return true;
  }catch(error){
   if(check()){writerFeedback='競合比較エラー：'+String(error?.message||error);d.toast(writerFeedback,true);}
   return false;
  }
 }
 async function resolve(id,localWins){
  if(!(enabled()||d.canReviewBlockedConflict?.()))return;
  if(localWins===null){
   writerFeedback='競合を保留しました。端末・Firestoreの双方は変更していません。';
   d.setStatus(message());d.toast(writerFeedback);return;
  }
  if(!comparedDuties[id]){d.toast('端末原本とクラウド原本の比較を先に行ってください',true);return;}
  // Generate a random recovery key, rather than requiring typed passwords.
  // Keep it outside the encrypted backup; both downloads are required to restore.
  if(!root.crypto?.getRandomValues){d.toast('安全な復旧キーを生成できません。原本は変更しません',true);return;}
  const random=new Uint8Array(24);root.crypto.getRandomValues(random);
  const secret=Array.from(random,x=>x.toString(16).padStart(2,'0')).join('');
  const pass=secret;
  if(!root.TAXIAPP_TRANSFER.passwordOk(pass))return;
  if(!root.confirm('この端末とクラウドの双方を暗号化バックアップしてから、選択した版に置き換えます。続けますか？'))return;
  let ok=false;
  try{
   ok=await engine.resolve(id,localWins,async backup=>{
    const encrypted=await root.TAXIAPP_TRANSFER.encrypt(backup,pass);
    const base='TAXIAPP_競合両版_'+d.dateStamp()+'_'+id;
    d.download(JSON.stringify(encrypted),base+'.json','application/json;charset=utf-8');
    d.download('TAXIAPP 競合バックアップ復旧情報（厳重保管）\n対象：'+base+'.json\n復旧キー：'+secret+'\n',base+'_復旧キー.txt','text/plain;charset=utf-8');
    if(!root.confirm('暗号化バックアップと復旧キーの2ファイルを保存できましたか？\n両ファイルを保管できた場合だけ「OK」を押してください。'))return false;
    d.beginBootstrapConflictResolution?.(id);
    return true;
   });
  }finally{d.endBootstrapConflictResolution?.();}
  if(ok&&d.canReviewBlockedConflict?.())void bootstrapWriter();
  d.setStatus(message());refreshPanel();
  d.toast(ok?'競合を解決しました。暗号化バックアップを保管してください。':status().lastError||'競合はそのまま保留しました',!ok);
 }

 async function saveConflictCopies(){
  if(!enabled()||archiving||!status().conflicts.length||d.remoteOnDemand?.())return;
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
 // Existing remote originals remain intact; a user must explicitly select
 // each old test duty for trash. This also covers deleted-before-update records.
 function cloudTrashMarkup(){
  const esc=d.escape;
  const rows=[...cloudRows].sort((a,b)=>String(b.startedIso||'').localeCompare(String(a.startedIso||''))).map(r=>{
   const n=Number.isSafeInteger(r.recordsCount)?r.recordsCount:r.shift?.records?.length;
   const amount=Number.isFinite(r.meter)?r.meter.toLocaleString('ja-JP')+'円':'金額未記録';
   return '<div style="border-bottom:1px solid var(--line);padding:9px 0"><strong>'+
    esc(r.date||r.shift?.date||'日付未記録')+' ／ '+(n==null?'件数未記録':n+'件')+' ／ '+amount+
    '</strong><p class="caption-note">'+(r.deleted?'ゴミ箱（復元可能）':r.ended?'入庫済み':'未入庫')+
    ' ／ 更新番号 '+r.revision+' ／ '+esc(r.id)+'</p><div class="actions">'+
    (r.deleted?'<button class="btn" data-action="cloudRestore" data-id="'+esc(r.id)+'">クラウドから復元</button>':
    '<button class="btn" data-action="cloudIndexOpen" data-id="'+esc(r.id)+'">内容を確認・編集</button>'+
    '<button class="btn red" data-action="cloudTrash" data-id="'+esc(r.id)+'">クラウドのゴミ箱へ移動</button>')+
    '</div></div>';
  }).join('');
  return '<h3 class="subsection">Firestore日報一覧（1乗務1行）</h3>'+
   '<p class="helper">本人UIDの保存済み日報を表示します。日報の詳細は選択後に取得します。ゴミ箱は復元できます。</p>'+
   '<button class="btn primary" data-action="cloudTrashList" '+(cloudBusy?'disabled':'')+'>'+
   (cloudBusy?'取得中…':'Firestore日報一覧を取得・更新')+'</button>'+
   (cloudError?'<p class="warn">'+esc(cloudError)+'</p>':'')+
   (cloudLoaded?(rows||'<p class="helper">日報はありません。</p>'):'<p class="caption-note">一覧はボタン操作時のみ取得します。</p>');
 }
 async function cloudAction(kind,id=''){
  if(cloudBusy)return false;
  // A manual owner-approved cleanup must work with automatic two-way sync OFF.
  // Never enable background upload merely to reach an old Google-only duty.
  if(!d.configured()||(d.canSync&&!d.canSync())||d.canView?.()){
   d.toast('操作可能な本人端末でクラウド接続を確認してください',true);return false;
  }
  cloudBusy=true;cloudError='';refreshPanel(true);
  const epoch=cloudEpoch,uid=String(d.scopeKey?.()||''),endpoint=String(d.endpoint()||'');
  const verifyScope=()=>{
   if(cloudEpoch!==epoch||String(d.scopeKey?.()||'')!==uid||
      String(d.endpoint()||'')!==endpoint||!d.configured()||
      (d.canSync&&!d.canSync())||d.canView?.())
    throw Error('ログイン利用者または保存先が変更されたため操作を停止しました');
  };
  const scopedRequest=async(action,payload)=>{
   verifyScope();
   const result=await d.request(action,payload);
   verifyScope();
   return result;
  };
  try{
   if(kind==='load'){
    const result=await scopedRequest('syncList',{});
    if(!Array.isArray(result?.shifts))throw Error('原本一覧の形式が不正です');
    const seen=new Set();
    cloudRows=result.shifts.map(m=>{
     const id=String(m?.id||''),revision=Number(m?.revision);
     if(!/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(id)||
       !Number.isSafeInteger(revision)||revision<1||seen.has(id))
      throw Error('原本の乗務IDまたは更新番号が不正です');
     seen.add(id);
     return {id,revision,deleted:m.deleted===true,ended:m.ended===true,
      date:String(m.date||''),startedIso:String(m.startedIso||''),
      recordsCount:Number.isSafeInteger(m.recordsCount)?m.recordsCount:null,
      meter:Number.isFinite(m.meter)?m.meter:null};
    });
    // Preserve the existing legacy Google full listing; Firestore only uses
    // lightweight server-verified metadata until one row is opened.
    if(!d.remoteOnDemand?.()){
     for(const row of cloudRows){
      if(row.deleted)continue;
      const full=await scopedRequest('syncGet',{shiftId:row.id});
      if(full?.id!==row.id||Number(full.revision)!==row.revision||full.shift?.id!==row.id)
       throw Error('旧Google原本が一覧取得中に更新されました');
      row.shift=full.shift;row.date=full.shift.date;
      row.recordsCount=full.shift.records?.length??null;
     }
    }
    verifyScope();cloudLoaded=true;
    d.toast('Firestore '+cloudRows.filter(r=>!r.deleted).length+'乗務／ゴミ箱 '+cloudRows.filter(r=>r.deleted).length+'乗務');
   }else if(kind==='trash'){
    const row=cloudLoaded&&cloudRows.find(x=>x.id===id&&!x.deleted);
    if(!row)throw Error('対象を一覧から取得し直してください');
    const remote=await scopedRequest('syncGet',{shiftId:id});
    if(remote?.id!==id||remote.shift?.id!==id||(row.date&&remote.shift.date!==row.date)||
       Number(remote.revision)!==row.revision)
     throw Error('原本に変更がありました。ゴミ箱操作を停止しました');
    row.shift=remote.shift;
    if(d.getModel()?.shifts?.some(x=>x.id===id))
     throw Error('この日報は端末内にもあります。端末の「この乗務を削除」を先に実行してください');
    const date=row.shift.date||'日付不明',count=row.shift.records?.length||0;
    if(!root.confirm('【クラウド日報のゴミ箱移動】\n'+date+'／営業'+count+'件\nID: '+id+
       '\n\n復元できる状態で非表示にします。印刷対象からも除外します。続けますか？'))return false;
    verifyScope();
    d.download(JSON.stringify({version:1,ownerUid:d.scopeKey?.()||null,
      shifts:[row.shift],cloudBackup:{kind:'TAXIAPP_BEFORE_TRASH',revision:row.revision}}),
      'TAXIAPP_削除前バックアップ_'+d.dateStamp()+'_'+id+'.json','application/json;charset=utf-8');
    if(!root.confirm('元の日報のバックアップを保存したことを確認しましたか？\nOKでゴミ箱へ移動します。'))return false;
    verifyScope();
    const done=await scopedRequest('syncTrash',{shiftId:id,baseRevision:row.revision});
    if(done?.id!==id||done?.deleted!==true||Number(done.revision)!==row.revision+1)
     throw Error('クラウドの削除完了を確認できません');
    cloudRows=cloudRows.map(x=>x.id===id?{...x,revision:done.revision,deleted:true}:x);
    d.toast('選択した乗務をクラウドのゴミ箱へ移しました。原本は保持しています。');
   }else if(kind==='trashLocal'){
    // Explicit manual deletion only. Do not confuse normal verified-device
    // retention cleanup with a server trash operation.
    if(!d.remoteOnDemand?.())throw Error('本人Firestore保存中の日報のみゴミ箱へ移動できます');
    const local=d.getModel()?.shifts?.find(shift=>shift.id===id);
    if(!local||local.draft||(!local.endedAt&&!local.endedIso))
     throw Error('入庫済みの日報だけをゴミ箱へ移動できます');
    const baseline=verifiedRevision(id);
    if(baseline===null||engine.isSendUnknown(id)||engine.isConflict(id))
     throw Error('保存確認済みでないため削除しません。未同期・競合の原本は保持してください');
    const metaList=await scopedRequest('syncList',{shiftIds:[id]});
    if(!Array.isArray(metaList?.shifts))throw Error('サーバー一覧を確認できません');
    const matches=metaList.shifts.filter(row=>row.id===id);
    if(matches.length!==1||matches[0].deleted===true||
       Number(matches[0].revision)!==baseline)
     throw Error('サーバー原本の更新番号またはゴミ箱状態が変わりました');
    const remote=await scopedRequest('syncGet',{shiftId:id});
    if(remote?.id!==id||remote?.shift?.id!==id||Number(remote.revision)!==baseline)
     throw Error('サーバー原本の読戻し内容が不正です');
    const normalized=(value)=>{
     if(Array.isArray(value))return value.map(normalized);
     if(value&&typeof value==='object')
      return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalized(value[key])]));
     return value;
    };
    const remoteText=JSON.stringify(normalized(remote.shift));
    const originalText=JSON.stringify(normalized(d.getPacket(local).shift));
    if(remoteText!==originalText||verifiedRevision(id)!==baseline)
     throw Error('端末とFirestoreの内容が一致しません。双方の原本を保持します');
    // Validate again immediately before the CAS: an in-flight edit cannot be
    // silently moved to trash even if it started while the confirmation was open.
    const current=d.getModel()?.shifts?.find(shift=>shift.id===id);
    if(!current||JSON.stringify(normalized(d.getPacket(current).shift))!==originalText||
       verifiedRevision(id)!==baseline)
     throw Error('確認中に端末原本が変更されたため削除を中止しました');
    const done=await scopedRequest('syncTrash',{shiftId:id,baseRevision:baseline});
    const verified=await scopedRequest('syncList',{shiftIds:[id]});
    const resulting=verified?.shifts?.filter(row=>row.id===id);
    if(done?.id!==id||done?.deleted!==true||
       Number(done.revision)!==baseline+1||resulting?.length!==1||
       resulting[0].deleted!==true||Number(resulting[0].revision)!==baseline+1)
     throw Error('サーバーのゴミ箱移動結果を確認できません。端末原本は保持してください');
    cloudLoaded=false;
    d.toast('本人Firestore原本をゴミ箱へ移動・確認しました。続けて端末の整理を行います。');
   }else if(kind==='restore'){
    const row=cloudLoaded&&cloudRows.find(x=>x.id===id&&x.deleted===true);
    if(!row)throw Error('復元対象を取得し直してください');
    if(!root.confirm('この乗務をクラウドのゴミ箱から復元しますか？\nID: '+id))return false;
    verifyScope();
    const done=await scopedRequest('syncRestore',{shiftId:id,baseRevision:row.revision});
    if(done?.id!==id||done?.deleted!==false||Number(done.revision)!==row.revision+1)
     throw Error('復元した乗務の版番号を確認できません');
    verifyScope();engine.undoLocalRemoval(id);
    cloudRows=cloudRows.map(x=>x.id===id?{...x,revision:done.revision,deleted:false}:x);
    cloudLoaded=false;
    // The recovered original is re-fetched only for this exact ID, with the
    // normal per-duty revision checks and local-save confirmation.
    const received=await engine.run([id]);
    verifyScope();
    if(!received)throw Error(engine.status().lastError||'クラウドは復元しましたが端末への再受信は未完了です。手動照合してください');
    d.toast('ゴミ箱の乗務を復元し、この端末へ受信しました。');
   }else throw Error('未対応のクラウド操作です');
   return true;
  }catch(error){
   // An old account's result must never render in the new account's panel.
   if(cloudEpoch===epoch&&String(d.scopeKey?.()||'')===uid&&String(d.endpoint()||'')===endpoint){
    cloudError='クラウド処理を中止：'+String(error?.message||error);
    d.toast(cloudError,true);
   }
   return false;
  }finally{
   if(cloudEpoch===epoch){cloudBusy=false;refreshPanel(true);}
  }
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
 function conflictFieldLabel(path){
  const parts=path.split('.'),top=parts[0],field=parts[parts.length-1];
  const raw={G:'乗車時刻',M:'降車時刻',K:'メーター料金',AL:'乗車地',AM:'降車地',W:'支払方法',C:'出庫時刻',D:'乗車地点の座標',H:'降車地点の座標'};
  const named={date:'乗務日',startedAt:'出庫時刻',startedIso:'出庫時刻',endedAt:'入庫時刻',endedIso:'入庫時刻',records:'営業記録',settings:'乗務設定',status:'営業状態',kind:'記録区分',paymentMethod:'支払方法',startingOdo:'出庫時オドメーター',endingOdo:'入庫時オドメーター',gpsTrip:'GPS距離記録',distance:'走行距離',amounts:'計算済み金額',payments:'支払内訳',meta:'営業補足情報',raw:'営業入力項目',__taxiPrintSummary:'印刷用集計'};
  const ride=top==='records'?'営業'+(Number(parts[1])+1)+'件目・':'';
  return ride+(top==='records'&&parts[2]==='raw'&&raw[field]?raw[field]:(named[field]||named[top]||'記録詳細'))+
   (named[field]||raw[field]?'':'（'+path.replace(/[^a-zA-Z0-9_.\[\]-]/g,'').slice(0,65)+'）');
 }
 function conflictDifferences(a,b){
  const result=[],push=(path,left,right)=>{
   if(result.length>=80)return;
   const val=v=>v===undefined?'（なし）':v===null?'（未設定）':
    typeof v==='object'?'（内容が異なります）':String(v).slice(0,90)||'（空欄）';
   result.push({label:conflictFieldLabel(path),local:val(left),remote:val(right)});
  };
  const walk=(x,y,path,depth)=>{
   if(result.length>=80||Object.is(x,y))return;
   if(depth>8){if(JSON.stringify(x)!==JSON.stringify(y))push(path,x,y);return;}
   if(x&&y&&typeof x==='object'&&typeof y==='object'&&Array.isArray(x)===Array.isArray(y)){
    const keys=new Set([...Object.keys(x),...Object.keys(y)]);
    for(const key of keys)walk(x[key],y[key],path?path+'.'+key:key,depth+1);
   }else if(x!==y)push(path,x,y);
  };
  walk(a,b,'',0);
  return result;
 }
 function conflictMarkup(s){
  const summary=(heading,info)=>'<div class="card"><strong>'+heading+'</strong>'+
   '<p class="caption-note">乗務日 '+d.escape(info.date)+' ／ 営業記録 '+info.count+'件</p>'+
   '<p class="caption-note">出庫 '+d.escape(info.started||'未記録')+' ／ 入庫 '+d.escape(info.ended||'未記録')+'</p>'+
   (info.records.length?info.records.map((r,i)=>'<div class="card"><strong>営業 '+(i+1)+'件目</strong>'+
    '<p>乗車 '+d.escape(r.board||'未記録')+' ／ 降車 '+d.escape(r.alight||'未記録')+'</p>'+
    '<p>乗車地：'+d.escape(r.pickup||'未記録')+'</p>'+
    '<p>降車地：'+d.escape(r.dropoff||'未記録')+'</p>'+
    '<p>メーター料金：'+d.escape(r.fare||'未記録')+(r.fare?'円':'')+'</p>'+
    '<p>支払方法：'+d.escape(r.payment||'未記録')+'</p>'+
    '<p class="caption-note">記録区分：'+d.escape(r.kind||'未記録')+'</p></div>').join(''):
    '<p>営業記録はありません。</p>')+'</div>';
  const conflicts=s.conflicts.map(c=>{const local=d.getModel()?.shifts?.find(sh=>sh.id===c.id);const reviewed=Boolean(comparedDuties[c.id]);return '<div class="card"><strong>'+d.escape(local?.date||comparedDuties[c.id]?.remote?.date||'日付確認中')+'の日報で保存内容が異なります</strong>'+ '<p class="caption-note">対象の乗務ID：'+d.escape(c.id)+'</p>'+
   '<p class="warn">'+d.escape(c.reason)+'</p>'+
   '<button class="btn" type="button" data-sync-compare="'+d.escape(c.id)+'">端末版とサーバー版を比較</button>'+
   (comparedDuties[c.id]?'<section class="card"><strong>実際に異なる項目</strong>'+
     (comparedDuties[c.id].differences.length?comparedDuties[c.id].differences.map(diff=>'<p class="caption-note"><strong>'+d.escape(diff.label)+'</strong>：端末「'+d.escape(diff.local)+'」／クラウド「'+d.escape(diff.remote)+'」</p>').join(''):'<p class="caption-note">記録項目の差は検出されませんでした。更新番号などの同期情報を確認してください。</p>')+'</section><div class="form-grid">'+summary('端末版',comparedDuties[c.id].local)+
     summary(d.remoteOnDemand?.()?'Firestore版':'旧Google原本',comparedDuties[c.id].remote)+'</div>':'')+
   '<p class="caption-note">'+(reviewed?'比較後、残したい原本を選んでください。選ばれない側も暗号化バックアップに保存します。':'先に「端末版とクラウド版を比較」を押してください。比較するまで選択はできません。')+'</p>'+ '<div class="actions"><button class="btn" type="button" data-sync-resolve="remote" data-id="'+d.escape(c.id)+'" '+(!reviewed?'disabled':'')+'>クラウド原本を残す</button>'+
   '<button class="btn red" type="button" data-sync-resolve="local" data-id="'+d.escape(c.id)+'" '+(!reviewed?'disabled':'')+'>端末原本を残す</button>'+
   '<button class="btn" type="button" data-sync-resolve="hold" data-id="'+d.escape(c.id)+'">保留（両方残す）</button></div></div>';}).join('');
  return conflicts?'<h3 class="subsection">競合の解決</h3><p class="caption-note">「両方残す」は変更せず保留します。片方を残す場合は、もう片方を復旧できる控えを自動保存します。</p>'+conflicts:'';
 }
 // Refresh the status in place after login or a manual viewer refresh.
 // Never rebuild Settings: that would collapse details and reset the scroll.
 function refreshPanel(forceCloud=false){
  const text=d.root.querySelector('[data-sync-status]');
  if(text)text.textContent=message();
  const cloudHolder=d.root.querySelector('[data-sync-cloud-trash]');
  if(cloudHolder&&(forceCloud||!cloudHolder.querySelector('button:focus')))
   cloudHolder.innerHTML=cloudTrashMarkup();
  const holder=d.root.querySelector('[data-sync-conflicts]');
  if(!holder)return;
  const signature=JSON.stringify([status().conflicts,archiveRows,archiveDetail,archiveError,comparedDuties]);
  if(holder.dataset.syncSignature===signature)return;
  if(holder.querySelector('input:focus,textarea:focus,select:focus'))return;
  holder.innerHTML=conflictMarkup(status())+vaultMarkup();
  holder.dataset.syncSignature=signature;
 }
 // Firestore members use the same verified trash/restore API but must never
 // see the administrator's Google connection keys or legacy print controls.
 function privateDiaryPanel(){
  return '<section class="card"><h2 class="h2">本人専用クラウド日報の整理</h2>'+
   '<p class="helper">現在ログインしている本人UIDの日報だけを確認します。ゴミ箱への移動後も原本は保持され、復元できます。</p>'+
   '<div data-sync-cloud-trash>'+cloudTrashMarkup()+'</div>'+
   '<div data-sync-conflicts>'+conflictMarkup(status())+'</div></section>';
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
   '<div data-sync-cloud-trash>'+cloudTrashMarkup()+'</div>'+ 
   '<div data-sync-conflicts>'+conflictMarkup(s)+vaultMarkup()+'</div>'+
   '<p class="footnote">初回に同一乗務の内容が異なる場合も競合扱いです。クラウド側のコードを更新・再公開するまで有効にしないでください。端末ごとの表示設定・GPS権限は個別です。</p>';
 }
 return {conflictPanel:()=>conflictMarkup(status()),enabled,run,schedule,viewNow,viewSchedule,cancelViewer,panel,privateDiaryPanel,resolve,compare,status,dutySyncStatus,message,archiveAction,loadArchives,bootstrapWriter,verifiedRevision,resetAccount,
  cloudEntries:()=>cloudLoaded?cloudRows.map(r=>({...r,shift:undefined})):null,
  cloudEntry:id=>cloudLoaded?cloudRows.find(r=>r.id===id)||null:null,
  // A history CAS edit may also affect the retained last returned duty.
  // Called only after that exact server-confirmed version is durable locally.
  adoptHistoryDuty:received=>{
   if(writerRunBusy||queuedDutyIds.has(received?.id))return false;
   return engine.adoptReceivedDuty(received);
  },
  markLocalRemoval:(id,shift)=>engine.markLocalRemoval(id,shift),
  undoLocalRemoval:id=>{engine.undoLocalRemoval(id);queuedDutyIds.delete(id);},cloudAction};
};
})(typeof window!=='undefined'?window:globalThis);
