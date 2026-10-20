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
 const localHash=shift=>digest(stable(getPacket(shift).shift));
 const remoteHash=shift=>digest(stable(getPacket(shift).shift));
 function status(){
  return {busy,conflicts:Object.values(conflict),lastError,lastSyncAt};
 }
 const isConflict=id=>Boolean(conflict[id]);
 function markConflict(id,reason,localRevision,remoteRevision){
  conflict[id]={id,reason,localRevision,remoteRevision};
 }
 async function run(){
  if(busy)return false;
  if(!getEndpoint())return false;
  busy=true;lastError='';
  try{
   const listing=await request('syncList',{});
   if(!Array.isArray(listing?.shifts))throw Error('同期APIに乗務一覧がありません（Google側の更新を確認）');
   const cloud=new Map(listing.shifts.map(item=>[String(item.id),item]));
   const saved=getSaved(),shifts=[...(getModel()?.shifts||[])];
   const present=new Map(shifts.map(s=>[s.id,s]));
   const nextConflict={};
   // Pull cloud-only shifts first. Do not silently create an editing session
   // if the phone has its own active duty.
   for(const remote of listing.shifts){
    if(present.has(remote.id))continue;
    const received=await request('syncGet',{shiftId:remote.id});
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
    const id=original.id,remote=cloud.get(id),base=saved[id];
    let current=getModel()?.shifts?.find(s=>s.id===id);
    if(!current)continue;
    const currentHash=localHash(current);
    if(!remote){
     if(base&&base.revision>0){
      nextConflict[id]={id,reason:'クラウドに以前の記録が見つかりません',localRevision:base.revision,remoteRevision:0};
      continue;
     }
     const sent=await request('syncPut',{baseRevision:0,payload:JSON.stringify(getPacket(current))});
     if(!sent||sent.id!==id||sent.revision!==1)throw Error('新規送信の応答が不正です');
     const savedHash=currentHash;
     if(!setSaved({...saved,[id]:{revision:sent.revision,hash:savedHash}}))throw Error(lastError);
     saved[id]={revision:sent.revision,hash:savedHash};
     continue;
    }
    if(!base){
     // A migrated device without a known common ancestor cannot decide
     // which distinct record is newer. Only identical content can be linked.
     const got=await request('syncGet',{shiftId:id});
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
     const got=await request('syncGet',{shiftId:id});
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
     const sent=await request('syncPut',{baseRevision:base.revision,payload:JSON.stringify(payload)});
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
  if(!endpoint){viewerLastError='Google接続先が設定されていません';return null;}
  viewerBusy=true;
  try{
   const listing=await request('syncList',{});
   if(!Array.isArray(listing?.shifts))throw Error('Googleから乗務一覧を取得できません');
   const previous=viewerEndpoint===endpoint?viewerCache:new Map();
   const updated=new Map();
   for(const item of listing.shifts){
    const id=String(item?.id||''),revision=Number(item?.revision);
    if(!/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/.test(id)||
       !Number.isSafeInteger(revision)||revision<1||updated.has(id))
     throw Error('Googleの乗務一覧が不正です');
    let entry=previous.get(id);
    if(!entry||entry.revision!==revision){
     const result=await request('syncGet',{shiftId:id});
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
  return setSaved(saved);
 }
 async function resolve(id,preferLocal,onBackup){
  if(busy||!conflict[id]||typeof onBackup!=='function')return false;
  busy=true;
  try{
   const local=getModel()?.shifts?.find(s=>s.id===id);
   const remote=await request('syncGet',{shiftId:id});
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
    const ack=await request('syncPut',{baseRevision:remote.revision,payload:JSON.stringify(packet)});
    if(!ack||ack.revision!==remote.revision+1||ack.id!==id)
     throw Error('クラウドの更新を確認できません');
    if(!setSaved({...saved,[id]:{revision:ack.revision,hash:before}}))throw Error(lastError);
   }else{
    // Prevent accepting a superseded cloud snapshot.
    const listing=await request('syncList',{});
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
 return {run,readOnly,viewerStatus,adoptViewerBaseline,resolve,status,isConflict,digest};
}
root.TAXIAPP_BIDIRECTIONAL_SYNC=Object.freeze({create,digest});
})(typeof window!=='undefined'?window:globalThis);
