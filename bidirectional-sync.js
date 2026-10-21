/* TAXIAPP safety-first, duty-by-duty cloud sync.
 * No cloud deletion. Compare-and-swap revisions on the server. Unknown
 * baselines and simultaneous edits remain conflicts until manually reviewed.
 */
(function(root){
'use strict';
const KEY_PREFIX='taxiapp-sync-v2-state-';
const stable=shift=>JSON.stringify(shift);
function digest(str){
 // FNV-1a paired 32bit for change detection; server revision enforces CAS.
 let a=2166136261,b=2166136261^0x9e3779b9;
 for(let i=0;i<str.length;i++){
  const c=str.charCodeAt(i);
  a=Math.imul(a^c,16777619);
  b=Math.imul(b^(c+i),16777619);
 }
 return (a>>>0).toString(16)+'-'+(b>>>0).toString(16)+'-'+str.length;
}
function create(deps){
 const {getModel, getPacket, replaceRemoteShift, saveLocal, request,
  getEndpoint,toast,localStorage:storage}=deps;
 let busy=false, conflict={},lastError='',lastSyncAt=0;
 let scopeEpoch=0;
 let viewerBusy=false,viewerPromise=null,viewerLastError='',viewerLastSyncAt=0,viewerEndpoint='',viewerCache=new Map();
 const localKey=()=>KEY_PREFIX+digest(String(getEndpoint()||''));
 function getSaved(){
  try{
   const v=JSON.parse(storage.getItem(localKey())||'{}');
   return v&&typeof v==='object'&&!Array.isArray(v)?v:{};
  }catch{return {};}
 }
 function setSaved(saved){
  try{storage.setItem(localKey(),JSON.stringify(saved));return true;}
  catch{lastError='同期の管理情報を端末に保存できません。データは上書きしません。';return false;}
 }
 const REMOVAL_PREFIX='taxiapp-sync-v2-local-removals-';
 const validId=id=>/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(String(id||''));
 const removalKey=()=>REMOVAL_PREFIX+digest(String(getEndpoint()||'')+'|'+String(deps.getScopeKey?.()||''));
 function localRemovals(){
  if(!getEndpoint())throw Error('同期先が未設定のため削除状態を記録できません');
  const raw=storage.getItem(removalKey());
  if(!raw)return {};
  let data;
  try{data=JSON.parse(raw)}catch{throw Error('削除済み日報の管理情報が破損しています。再受信を停止しました');}
  if(!data||typeof data!=='object'||Array.isArray(data)||
    Object.keys(data).some(id=>{
     const entry=data[id],at=typeof entry==='number'?entry:entry?.at;
     return !validId(id)||!Number.isSafeInteger(at)||at<1||
      (typeof entry==='object'&&(entry===null||typeof entry.hash!=='string'||entry.hash.length>100));
    }))
   throw Error('削除済み日報の管理情報が不正です。再受信を停止しました');
  return data;
 }
 function saveRemovals(data){
  const content=JSON.stringify(data);
  storage.setItem(removalKey(),content);
  if(storage.getItem(removalKey())!==content)
   throw Error('削除済み日報の再受信防止情報を保存できません');
 }
 function markLocalRemoval(id,shift){
  if(!validId(id))throw Error('削除する日報IDが不正です');
  const state=localRemovals();
  if(Object.prototype.hasOwnProperty.call(state,id))return false;
  const entry=shift?{at:Date.now(),hash:localHash(shift)}:Date.now();
  saveRemovals({...state,[id]:entry});return true;
 }
 function undoLocalRemoval(id){
  const state=localRemovals();
  if(Object.prototype.hasOwnProperty.call(state,id)){delete state[id];saveRemovals(state);}
 }
 function localRemovalIds(){return Object.keys(localRemovals());}
 function hasLocalRemovals(){return localRemovalIds().length>0;}
 function excludeLocalRemovals(shifts){
  const removed=localRemovals();
  return (shifts||[]).filter(x=>!Object.prototype.hasOwnProperty.call(removed,x.id));
 }
 // A login's cloud-first snapshot must never overwrite unsynced local shifts.
 // A matching prior hash means the local copy is unchanged since its last sync.
 // With no baseline, only byte-identical projected data can be safely adopted.
 // On login, merge nonconflicting cloud originals with local-only drafts.
 // A local duty without a known cloud ancestor is never dropped by a pull.
 // A previously synced duty missing in the cloud is a conflict, not a new upload.
 function planSafeWriterSnapshot(incoming){
  if(!Array.isArray(incoming))throw Error('クラウドの日報一覧が不正です');
  const cloud=new Map(incoming.map(shift=>[shift.id,shift]));
  if(cloud.size!==incoming.length)throw Error('クラウドの乗務IDが重複しています');
  const saved=getSaved(),local=[...(getModel()?.shifts||[])];
  const pendingIds=[],heldIds=[],localIds=new Set();
  const result=new Map(cloud);
  for(const shift of local){
   if(!shift||!validId(shift.id)||localIds.has(shift.id))
    throw Error('端末の日報IDが不正です。受信せず保持します');
   localIds.add(shift.id);
   const remote=cloud.get(shift.id),base=saved[shift.id];
   if(!remote){
    if(base?.revision>0){
     // Deleted/absent server originals are NOT new uploads. Keep the local
     // restored duty accessible and require explicit cloud reconciliation.
     heldIds.push(shift.id);
     continue;
    }
    pendingIds.push(shift.id);
    continue;
   }
   const localValue=localHash(shift),remoteValue=remoteHash(remote);
   if(localValue===remoteValue)continue;
   // If the server's revision AND packet are unchanged from our previous
   // confirmed baseline, only the phone has edits. Keep those edits, then
   // enqueue the exact duty after the writer session is confirmed.
   const serverRevision=viewerCache.get(shift.id)?.revision;
   if(base?.hash===remoteValue&&base.revision===serverRevision){
    result.set(shift.id,shift);
    pendingIds.push(shift.id);
    continue;
   }
   // Only the cloud changed. Local packet still matches the known baseline.
   if(base?.hash===localValue)continue;
   // Unknown ancestor or both sides edited: neither side is safe to replace.
   throw Error('端末とクラウドの乗務 '+shift.id+
    ' の変更が競合しています。双方の原本を保護し、受信を停止しました');
  }
  const extra=local.filter(shift=>!cloud.has(shift.id));
  return {shifts:[...result.values(),...extra],pendingIds,heldIds};
 }
 function assertSafeWriterSnapshot(incoming){
  planSafeWriterSnapshot(incoming);return true;
 }
 const localHash=shift=>digest(stable(getPacket(shift).shift));
 const remoteHash=shift=>digest(stable(getPacket(shift).shift));
 function status(){
  return {busy,conflicts:Object.values(conflict),lastError,lastSyncAt};
 }
 const isConflict=id=>Boolean(conflict[id]);
 function markConflict(id,reason,localRevision,remoteRevision){
  conflict[id]={id,reason,localRevision,remoteRevision};
 }
 async function run(onlyIds=null){
  const selected=Array.isArray(onlyIds)?new Set(onlyIds):null;
  if(busy)return false;
  if(!getEndpoint())return false;
  const epoch=scopeEpoch,endpoint=String(getEndpoint()||'');
  const scopedRequest=async(action,fields)=>{
   if(epoch!==scopeEpoch||String(getEndpoint()||'')!==endpoint)
    throw Error('ログインまたは保存先が変わったため同期を停止しました');
   const result=await request(action,fields);
   if(epoch!==scopeEpoch||String(getEndpoint()||'')!==endpoint)
    throw Error('ログインまたは保存先が変わったため同期を停止しました');
   return result;
  };
  busy=true;lastError='';
  try{
   const listing=await scopedRequest('syncList',selected?{shiftIds:[...selected]}:{});
   if(!Array.isArray(listing?.shifts))throw Error('同期APIに乗務一覧がありません（Google側の更新を確認）');
   const cloud=new Map(listing.shifts.map(item=>[String(item.id),item]));
   const removed=localRemovals();
   const saved=getSaved(),shifts=[...(getModel()?.shifts||[])];
   const present=new Map(shifts.map(s=>[s.id,s]));
   const nextConflict=selected?Object.fromEntries(Object.entries(conflict).filter(([id])=>!selected.has(id))):{};
   // Send explicit deletion intent even though the duty is no longer in model.
   // Require the original content to match the version actually deleted locally.
   for(const [id,marker] of Object.entries(removed)){
    if(selected&&!selected.has(id))continue;
    const remote=cloud.get(id);
    if(!remote||remote.deleted===true)continue;
    if(typeof marker!=='object'||typeof marker.hash!=='string')continue;
    const base=saved[id];
    if(base&&base.revision!==remote.revision){
     nextConflict[id]={id,reason:'削除後に別端末が原本を更新しました。自動削除を保留',localRevision:base.revision,remoteRevision:remote.revision};
     continue;
    }
    const received=await scopedRequest('syncGet',{shiftId:id});
    if(!received?.shift||received.id!==id||received.revision!==remote.revision||
       remoteHash(received.shift)!==marker.hash){
     nextConflict[id]={id,reason:'削除対象のクラウド原本が端末で確認した内容と異なります',localRevision:base?.revision??null,remoteRevision:remote.revision};
     continue;
    }
    const done=await scopedRequest('syncTrash',{shiftId:id,baseRevision:remote.revision});
    if(!done||done.id!==id||done.deleted!==true||done.revision!==remote.revision+1)
     throw Error('クラウド側の削除状態を確認できません');
    const next={revision:done.revision,hash:marker.hash};
    if(!setSaved({...saved,[id]:next}))throw Error(lastError);
    saved[id]=next;
   }
   // Pull cloud-only shifts first. Do not silently create an editing session
   // if the phone has its own active duty.
   for(const remote of listing.shifts){
    if(selected&&!selected.has(remote.id))continue;
    if(remote.deleted===true)continue;
    if(Object.prototype.hasOwnProperty.call(removed,remote.id))continue;
    if(present.has(remote.id))continue;
    const received=await scopedRequest('syncGet',{shiftId:remote.id});
    if(!received?.shift||received.id!==remote.id)throw Error('クラウドから乗務を読み戻せません');
    const local=getModel()?.shifts?.find(s=>s.id===remote.id);
    if(local){nextConflict[remote.id]={id:remote.id,reason:'受信中に同じIDの記録が追加されました',localRevision:0,remoteRevision:remote.revision};continue;}
    const clone=received.shift;
    const mark={revision:received.revision,hash:remoteHash(clone)};
    // Persist baseline BEFORE applying; a failure prevents unsafe assumptions
    if(!setSaved({...saved,[remote.id]:mark}))throw Error(lastError);
    saved[remote.id]=mark;
    await replaceRemoteShift(remote.id,clone,false);
   }
   for(const original of shifts){
    const id=original.id;
    if(selected&&!selected.has(id))continue;
    if(Object.prototype.hasOwnProperty.call(removed,id))continue;
    delete nextConflict[id];
    if(cloud.get(id)?.deleted===true){
     nextConflict[id]={id,reason:'クラウド側でゴミ箱に移動済みです。端末の日報は安全のため保持しています',localRevision:saved[id]?.revision??null,remoteRevision:cloud.get(id).revision};
     continue;
    }
    const remote=cloud.get(id),base=saved[id];
    let current=getModel()?.shifts?.find(s=>s.id===id);
    if(!current)continue;
    const currentHash=localHash(current);
    if(!remote){
     if(base&&base.revision>0){
      nextConflict[id]={id,reason:'クラウドに以前の記録が見つかりません',localRevision:base.revision,remoteRevision:0};
      continue;
     }
     const sent=await scopedRequest('syncPut',{baseRevision:0,payload:JSON.stringify(getPacket(current))});
     if(!sent||sent.id!==id||sent.revision!==1)throw Error('新規送信の応答が不正です');
     const savedHash=currentHash;
     if(!setSaved({...saved,[id]:{revision:sent.revision,hash:savedHash}}))throw Error(lastError);
     saved[id]={revision:sent.revision,hash:savedHash};
     continue;
    }
    if(!base){
     // A migrated device without a known common ancestor cannot decide
     // which distinct record is newer. Only identical content can be linked.
     const got=await scopedRequest('syncGet',{shiftId:id});
     if(!got?.shift||got.id!==id)throw Error('既存乗務を照合できません');
     if(remoteHash(got.shift)!==currentHash){
      nextConflict[id]={id,reason:'初回照合：端末とクラウドの内容が異なります',localRevision:null,remoteRevision:got.revision};
      continue;
     }
     if(!setSaved({...saved,[id]:{revision:got.revision,hash:currentHash}}))throw Error(lastError);
     saved[id]={revision:got.revision,hash:currentHash};
     continue;
    }
    if(base.receiving){
     nextConflict[id]={id,reason:'前回のクラウド受信が完了しませんでした。安全のため照合を保留します',localRevision:base.revision,remoteRevision:remote.revision};
     continue;
    }
    const localChanged=currentHash!==base.hash;
    const remoteChanged=remote.revision!==base.revision;
    if(localChanged&&remoteChanged){
     nextConflict[id]={id,reason:'この端末と別端末の両方で変更されました',localRevision:base.revision,remoteRevision:remote.revision};
     continue;
    }
    if(remoteChanged){
     const got=await scopedRequest('syncGet',{shiftId:id});
     if(!got?.shift||got.id!==id)throw Error('クラウドから乗務を読み込めません');
     const latest=getModel()?.shifts?.find(s=>s.id===id);
     if(!latest||localHash(latest)!==currentHash){
      nextConflict[id]={id,reason:'受信中に端末側で編集されました',localRevision:base.revision,remoteRevision:got.revision};
      continue;
     }
     const nextBase={revision:got.revision,hash:remoteHash(got.shift)};
     const pending={...nextBase,receiving:true};
     if(!setSaved({...saved,[id]:pending}))throw Error(lastError);
     saved[id]=pending;
     await replaceRemoteShift(id,got.shift,true);
     if(!setSaved({...saved,[id]:nextBase}))throw Error(lastError);
     saved[id]=nextBase;
     continue;
    }
    if(localChanged){
     const payload=getPacket(current);
     const sentHash=currentHash;
     const sent=await scopedRequest('syncPut',{baseRevision:base.revision,payload:JSON.stringify(payload)});
     if(!sent||sent.id!==id||sent.revision!==base.revision+1)
      throw Error('送信の更新番号を確認できません');
     if(!setSaved({...saved,[id]:{revision:sent.revision,hash:sentHash}}))throw Error(lastError);
     saved[id]={revision:sent.revision,hash:sentHash};
    }
   }
   conflict=nextConflict;
   lastSyncAt=Date.now();
   return Object.keys(conflict).length===0;
  }catch(e){
   lastError=String(e?.message||e);
   if(lastError.includes('SYNC_CONFLICT')){
    const idMatch=lastError.match(/SYNC_CONFLICT:(\d+)/);
    lastError='別端末の更新が先に保存されました。安全のため自動上書きを停止しました。'+(idMatch?'（クラウド更新番号 '+idMatch[1]+'）':'');
   }
   return false;
  }finally{busy=false;}
 }
 // A viewer NEVER changes the local IndexedDB or server. Cloud data lives only
 // in an isolated in-memory snapshot; incomplete requests retain the prior view.
 async function readOnly(){
  // Login can promote viewer to writer while a cloud read is in progress.
  // Reuse the same verified result; returning null here locks the writer out.
  if(viewerPromise)return viewerPromise;
  const job=(async()=>{
  const endpoint=String(getEndpoint()||'');
  const epoch=scopeEpoch;
  const scopedRequest=async(action,fields)=>{
   if(epoch!==scopeEpoch||String(getEndpoint()||'')!==endpoint)
    throw Error('ログインまたは保存先が変わったため同期を停止しました');
   const result=await request(action,fields);
   if(epoch!==scopeEpoch||String(getEndpoint()||'')!==endpoint)
    throw Error('ログインまたは保存先が変わったため同期を停止しました');
   return result;
  };
  if(!endpoint){viewerLastError='Google接続先が設定されていません';return null;}
  viewerBusy=true;
  try{
   const listing=await scopedRequest('syncList',{});
   if(!Array.isArray(listing?.shifts))throw Error('Googleから乗務一覧を取得できません');
   const previous=viewerEndpoint===endpoint?viewerCache:new Map();
   const updated=new Map();
   for(const item of listing.shifts){
    if(item?.deleted===true)continue;
    const id=String(item?.id||''),revision=Number(item?.revision);
    if(!/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(id)||
       !Number.isSafeInteger(revision)||revision<1||updated.has(id))
     throw Error('Googleの乗務一覧が不正です');
    let entry=previous.get(id);
    if(!entry||entry.revision!==revision){
     const result=await scopedRequest('syncGet',{shiftId:id});
     if(!result?.shift||result.id!==id||result.shift.id!==id||
        Number(result.revision)!==revision||!Array.isArray(result.shift.records)||
        !result.shift.settings)
      throw Error('乗務の受信中に更新されました。次の照合で再取得します');
     entry={revision,shift:result.shift};
    }
    updated.set(id,entry);
   }
   viewerCache=updated;viewerEndpoint=endpoint;viewerLastSyncAt=Date.now();viewerLastError='';
   return [...updated.values()].map(item=>JSON.parse(JSON.stringify(item.shift)));
  }catch(error){
   viewerLastError=String(error?.message||error);
   return null;
  }finally{viewerBusy=false;}
  })();
  viewerPromise=job;
  try{return await job;}
  finally{if(viewerPromise===job)viewerPromise=null;}
 }
 function viewerStatus(){return {lastError:viewerLastError,lastSyncAt:viewerLastSyncAt};}
 // Only after cloud originals have been durably saved locally, establish
 // their server revisions as the new synchronization baseline.
 function adoptViewerBaseline(){
  if(!viewerLastSyncAt||viewerEndpoint!==String(getEndpoint()||''))return false;
  const saved=getSaved();
  for(const [id,entry] of viewerCache){
   saved[id]={revision:entry.revision,hash:remoteHash(entry.shift)};
  }
  if(!setSaved(saved))return false;
  // The operator now holds the authoritative cloud snapshot: prior
  // local-conflict warnings and errors no longer apply.
  conflict={};lastError='';lastSyncAt=viewerLastSyncAt;
  return true;
 }
 async function resolve(id,preferLocal,onBackup){
  if(busy||!conflict[id]||typeof onBackup!=='function')return false;
  busy=true;
  const epoch=scopeEpoch,endpoint=String(getEndpoint()||'');
  const scopedRequest=async(action,fields)=>{
   if(epoch!==scopeEpoch||String(getEndpoint()||'')!==endpoint)
    throw Error('ログインまたは保存先が変わったため同期を停止しました');
   const result=await request(action,fields);
   if(epoch!==scopeEpoch||String(getEndpoint()||'')!==endpoint)
    throw Error('ログインまたは保存先が変わったため同期を停止しました');
   return result;
  };
  try{
   const local=getModel()?.shifts?.find(s=>s.id===id);
   const remote=await scopedRequest('syncGet',{shiftId:id});
   if(!local||!remote?.shift||remote.id!==id)throw Error('競合した乗務データを取得できません');
   const before=localHash(local);
   // A password-encrypted, user-verified backup of BOTH versions is required
   // before either side is overwritten. The backup is never uploaded.
   if(!await onBackup({id,local,remote:remote.shift,revision:remote.revision}))return false;
   if(localHash(getModel()?.shifts?.find(s=>s.id===id))!==before)
    throw Error('バックアップ中にこの端末の記録が変わりました。もう一度確認してください');
   const saved=getSaved();
   if(preferLocal){
    const packet=getPacket(local);
    const ack=await scopedRequest('syncPut',{baseRevision:remote.revision,payload:JSON.stringify(packet)});
    if(!ack||ack.revision!==remote.revision+1||ack.id!==id)
     throw Error('クラウドの更新を確認できません');
    if(!setSaved({...saved,[id]:{revision:ack.revision,hash:before}}))throw Error(lastError);
   }else{
    // Prevent accepting a superseded cloud snapshot.
    const listing=await scopedRequest('syncList',{});
    if(!listing.shifts?.some(x=>x.id===id&&x.revision===remote.revision))
     throw Error('バックアップ中にクラウドが更新されました。再確認してください');
    const latest=getModel()?.shifts?.find(s=>s.id===id);
    if(!latest||localHash(latest)!==before)
     throw Error('クラウドの確認中にこの端末の記録が変わりました。再確認してください');
    const hash=remoteHash(remote.shift),base={revision:remote.revision,hash};
    if(!setSaved({...saved,[id]:{...base,receiving:true}}))throw Error(lastError);
    await replaceRemoteShift(id,remote.shift,true);
    if(!setSaved({...saved,[id]:base}))throw Error(lastError);
   }
   delete conflict[id];lastError='';lastSyncAt=Date.now();return true;
  }catch(e){lastError=String(e?.message||e);return false;}
  finally{busy=false;}
 }
 function resetAccount(){
  scopeEpoch++;
  busy=false;viewerBusy=false;viewerPromise=null;
  conflict={};lastError='';lastSyncAt=0;
  viewerLastError='';viewerLastSyncAt=0;viewerEndpoint='';viewerCache=new Map();
 }
 return {run,readOnly,viewerStatus,adoptViewerBaseline,resolve,status,isConflict,digest,resetAccount,markLocalRemoval,undoLocalRemoval,excludeLocalRemovals,hasLocalRemovals,localRemovalIds,assertSafeWriterSnapshot,planSafeWriterSnapshot};
}
root.TAXIAPP_BIDIRECTIONAL_SYNC=Object.freeze({create,digest});
})(typeof window!=='undefined'?window:globalThis);
