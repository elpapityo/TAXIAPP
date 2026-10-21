/* TAXIAPP: optional post-login trash cleanup controller.
 * NOT included in index.html; feature stays disabled until strict Firestore
 * Rules, UID tests, restore UI and archival obligations are approved.
 * Requires actual server-confirmed editor status from the caller.
 * No schedules, managed TTL, or other paid Firebase services.
 */
(function(root){
'use strict';
function create({trashFactory,enabled,isCurrentEditor,onStatus}={}){
 if(typeof trashFactory!=='function')throw Error('ゴミ箱機能が接続されていません');
 const canUse=typeof enabled==='function'?enabled:()=>false;
 const editor=typeof isCurrentEditor==='function'?isCurrentEditor:()=>false;
 const notify=typeof onStatus==='function'?onStatus:()=>{};
 let sequence=0,pending=null;
 function cancel(){
  sequence++;
  if(pending)pending.bind(null);
  pending=null;
 }
 async function afterLogin({uid,firebase}={}){
  // Turned off by default. Caller must set enabled only after Rules rollout.
  if(!canUse())return {state:'disabled',purged:[]};
  if(typeof uid!=='string'||!uid||
     firebase?.auth?.currentUser?.uid!==uid||
     !firebase.f||!firebase.db||!firebase.session)
   return {state:'not-authenticated',purged:[]};
  if(!editor(uid))return {state:'read-only',purged:[]};
  cancel();
  const token=sequence;
  const client=trashFactory();
  pending=client;
  try{
   client.bind({uid},{...firebase,readOnly:false});
   if(!canUse()||!editor(uid)||token!==sequence)
    return {state:'cancelled',purged:[]};
   // Server rules must independently verify owner + current session. The
   // controller's flag is not itself security authorization.
   const report=await client.purgeExpired({max:20});
   if(token!==sequence||firebase.auth.currentUser?.uid!==uid||
      !canUse()||!editor(uid))return {state:'cancelled',purged:[]};
   if(!Array.isArray(report?.purged))throw Error('期限切れ整理の応答が不正です');
   const result={state:'checked',purged:report.purged,
    totalTrashCountAtRead:report.totalTrashCountAtRead};
   notify(result);
   return result;
  }catch(error){
   if(token!==sequence)return {state:'cancelled',purged:[]};
   const result={state:'deferred',purged:[],error:String(error?.message||error)};
   notify(result);
   // A failed cleanup cannot be reported as a deleted duty and must not
   // stop login itself; it is safe to retry on the next verified login.
   return result;
  }finally{
   client.bind(null);
   if(pending===client)pending=null;
  }
 }
 return Object.freeze({afterLogin,cancel});
}
root.TAXIAPP_TRASH_LOGIN=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
