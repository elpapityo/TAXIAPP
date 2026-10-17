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
     if(!setSaved({...saved,[id]:nextBase}))throw Error(lastError);
     saved[id]=nextBase;
     await replaceRemoteShift(id,got.shift,true);
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
 return {run,status,isConflict,digest};
}
root.TAXIAPP_BIDIRECTIONAL_SYNC=Object.freeze({create,digest});
})(typeof window!=='undefined'?window:globalThis);
