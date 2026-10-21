/* TAXIAPP explicit trash actions (STAGED; not imported by index.html).
 * This controller only connects to already authenticated SAME-UID clients.
 * No delete occurs without a verified durable backup, server revision check,
 * a single-duty user confirmation, and server-side Firestore Rules validation.
 */
(function(root){
'use strict';
function create({trash,diary,enabled,isCurrentEditor,verifiedBackup,confirmAction,afterChange}={}){
 if(!trash||!diary||typeof trash.move!=='function'||
    typeof diary.request!=='function')throw Error('ゴミ箱の保存先が未接続です');
 const flag=typeof enabled==='function'?enabled:()=>false;
 const editor=typeof isCurrentEditor==='function'?isCurrentEditor:()=>false;
 const backup=typeof verifiedBackup==='function'?verifiedBackup:()=>false;
 const ask=typeof confirmAction==='function'?confirmAction:()=>false;
 const changed=typeof afterChange==='function'?afterChange:()=>{};
 let currentUid='',generation=0,busy=false;
 function switchAccount(uid){
  generation++;
  currentUid=String(uid||'');
  busy=false;
 }
 function guard(uid,stamp){
  if(!uid||uid!==currentUid||generation!==stamp||!flag()||!editor(uid))
   throw Error('ログイン利用者・編集権限が変更されたため操作を停止しました');
 }
 async function moveSelected(shiftId){
  if(busy)return {status:'busy'};
  const uid=currentUid,stamp=generation;
  if(!flag())return {status:'disabled'};
  guard(uid,stamp);
  busy=true;
  try{
   const remote=await diary.request('syncGet',{shiftId});
   guard(uid,stamp);
   if(remote?.id!==shiftId||remote.shift?.id!==shiftId||
      !Number.isSafeInteger(remote.revision)||remote.revision<1)
    throw Error('削除対象の最新原本を取得できません');
   if(!remote.shift.endedAt&&!remote.shift.endedIso)
    throw Error('未入庫の日報は削除できません');
   const safeCopy=JSON.parse(JSON.stringify(remote.shift));
   // The callback MUST read back the UID-scoped durable copy. Returning
   // false/error means no server deletion. Tests cover this contract.
   const saved=await backup({
    uid,shiftId,revision:remote.revision,shift:safeCopy,
    purpose:'BEFORE_TRASH'
   });
   guard(uid,stamp);
   if(saved?.verified!==true||saved.uid!==uid||saved.shiftId!==shiftId||
      saved.revision!==remote.revision)
    throw Error('原本の保護コピーの保存と読み戻しを確認できません');
   const records=Array.isArray(safeCopy.records)?safeCopy.records.length:'確認不可';
   const message='【サーバーのゴミ箱へ移動】\n'+
    '日報 '+String(safeCopy.date||'日付不明')+
    '／営業 '+records+'件\nID：'+shiftId+
    '\nこの1件の最新版を30日間ゴミ箱で保管します。'+
    '\n端末の他の日報やGoogleシートは変更しません。'+
    '\n原本のバックアップ保存を確認済みです。実行しますか？';
   if(!await ask(message)){guard(uid,stamp);return {status:'cancelled'};}
   guard(uid,stamp);
   // Firestore transaction checks this revision AGAIN and will refuse
   // if another editor changed the duty after confirmation.
   const result=await trash.move({
    shiftId,expectedRevision:remote.revision,confirmed:true
   });
   guard(uid,stamp);
   const items=await trash.list();
   guard(uid,stamp);
   if(!Array.isArray(items)||!items.some(x=>x.id===shiftId))
    throw Error('サーバーでゴミ箱への移動を確認できません');
   await changed({uid,shiftId,action:'moved'});
   guard(uid,stamp);
   return {status:'moved',shiftId,expiresAt:result.expiresAt};
  }catch(error){
   return {status:'deferred',error:String(error?.message||error)};
  }finally{busy=false;}
 }
 async function restoreSelected(shiftId){
  if(busy)return {status:'busy'};
  const uid=currentUid,stamp=generation;
  if(!flag())return {status:'disabled'};
  guard(uid,stamp);
  busy=true;
  try{
   const items=await trash.list();
   guard(uid,stamp);
   const item=items.find(x=>x.id===shiftId);
   if(!item)throw Error('復元する日報がゴミ箱にありません');
   if(!await ask('【ゴミ箱から復元】\n'+String(item.date||'日付不明')+
    '\nID：'+shiftId+
    '\n同じIDの日報には上書きせず、サーバーの最新版へ戻します。復元しますか？')){
    guard(uid,stamp);return {status:'cancelled'};
   }
   guard(uid,stamp);
   const result=await trash.restore({shiftId,confirmed:true});
   guard(uid,stamp);
   const checked=await diary.request('syncGet',{shiftId});
   guard(uid,stamp);
   if(checked?.id!==shiftId||checked.shift?.id!==shiftId||
      checked.revision!==result.revision)
    throw Error('復元後のサーバー原本を確認できません');
   // Never overwrite an unsynced local duty here; that is the separate
   // data reconciliation / conflict approval workflow.
   await changed({uid,shiftId,action:'restored'});
   guard(uid,stamp);
   return {status:'restored',shiftId,revision:result.revision};
  }catch(error){
   return {status:'deferred',error:String(error?.message||error)};
  }finally{busy=false;}
 }
 return Object.freeze({switchAccount,moveSelected,restoreSelected});
}
root.TAXIAPP_TRASH_ACTIONS=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
