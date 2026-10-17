/* TAXIAPP v0.3.47: fail-closed one editing browser session per Google UID.
 * Later explicit takeover wins; all previous sessions remain view-only.
 * A Firestore listener is required to revoke old devices promptly.
 * This is a UI/storage gate, NOT a revocation of Firebase Auth tokens.
 */
(function(root){
'use strict';
root.TAXIAPP_DEVICE_SESSION={
 create(d){
  let currentUid='',sessionId='',unsubscribe=null,mode='pending';
  let viewerRequested=false,claimedOnce=false,claimInFlight=false,listenerHealthy=false;
  const STORAGE='taxiapp-current-session-v1-';
  const f=d.f,db=d.db;
  const ref=()=>f.doc(db,'deviceSessions',currentUid);
  function id(){
   if(root.crypto?.randomUUID)return root.crypto.randomUUID();
   const bytes=new Uint8Array(24);
   if(!root.crypto?.getRandomValues)throw Error('安全な端末IDを生成できません');
   root.crypto.getRandomValues(bytes);
   return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
  }
  function set(next,detail=''){
   if(mode===next&&detail==='')return;
   const previous=mode;
   mode=next;
   d.onMode?.(next,previous,detail);
  }
  function viewOnly(){viewerRequested=true; if(currentUid)set('viewer','閲覧専用で利用中');}
  function clear(){
   if(unsubscribe){unsubscribe();unsubscribe=null;}
   currentUid='';sessionId='';claimedOnce=false;claimInFlight=false;viewerRequested=false;listenerHealthy=false;
   set('pending','Googleログインと操作権の確認待ち');
  }
  function sessionKey(){return STORAGE+currentUid;}
  function setSession(value){
   sessionId=value;
   try{sessionStorage.setItem(sessionKey(),value);}
   catch{throw Error('端末内のセッション保存を利用できません');}
  }
  function readStored(){
   try{return sessionStorage.getItem(sessionKey())||'';}
   catch{return '';}
  }
  async function claim(){
   if(!currentUid||!d.auth.currentUser||d.auth.currentUser.uid!==currentUid)return;
   if(claimInFlight)return;
   claimInFlight=true;
   set('pending','操作する端末を切り替えています…');
   const uid=currentUid,newId=id();
   try{
    // Do not persist newId until the server has acknowledged the takeover.
    await f.setDoc(ref(),{sessionId:newId,updatedAt:f.serverTimestamp()});
    if(uid!==currentUid)return;
    // A successful write alone is not proof that the listener can revoke
    // this session later. Verify server read access and current ownership.
    const checked=await f.getDocFromServer(ref());
    if(uid!==currentUid)return;
    if(!listenerHealthy||!checked.exists()||checked.data().sessionId!==newId)
     throw Error('サーバーで操作権を確認できません。閲覧専用で利用してください');
    setSession(newId);
    claimedOnce=true;
    viewerRequested=false;
    set('writer','操作可能（サーバー確認済み）');
   }catch(error){
    if(uid===currentUid)set('viewer','操作権の切り替えに失敗：'+String(error.code||error.message||error));
   }finally{claimInFlight=false;}
  }
  async function begin(user,{viewer=false}={}){
   if(!user){clear();return;}
   if(currentUid===user.uid&&unsubscribe){
    if(viewer)set('viewer','この端末は閲覧専用です');
    return;
   }
   clear();
   currentUid=user.uid;
   const oldId=readStored();
   sessionId=oldId;
   // An already-owned tab keeps its editing session on reload;
   // an automatically restored login on a new browser is view-only until takeover.
   viewerRequested=Boolean(viewer);
   claimedOnce=Boolean(oldId);
   set('pending','操作権を確認しています…');
   try{
    unsubscribe=f.onSnapshot(ref(),{includeMetadataChanges:true},snap=>{
     if(d.auth.currentUser?.uid!==currentUid)return;
     // The editor's lease must be based on a server-confirmed snapshot;
     // cached or pending local snapshots cannot prove exclusive ownership.
     if(snap.metadata.fromCache||snap.metadata.hasPendingWrites){
      listenerHealthy=false;
      set('pending','サーバーから操作権を確認できません。編集を停止しています');
      return;
     }
     listenerHealthy=true;
     if(!snap.exists()){
      if(viewerRequested){
       set('viewer','閲覧専用でログイン中');return;
      }
      if(!claimedOnce&&!claimInFlight){claimedOnce=true;claim();}
      else if(!claimInFlight)set('viewer','操作できる端末がありません。操作する場合は切替ボタンを押してください');
      return;
     }
     const active=snap.data().sessionId;
     if(active===sessionId&&sessionId&&!viewerRequested){
      set('writer','操作可能（この端末が有効です）');
     }else if(!claimedOnce&&!viewerRequested&&!claimInFlight){
      // A genuinely new device login takes priority over the old device.
      claimedOnce=true;
      claim();
     }else{
      set('viewer','別の端末が操作中。この端末は閲覧専用です');
     }
    },error=>{
     listenerHealthy=false;
     // Never fall back to editable legacy mode after a Firestore denial.
     // Multiple devices could otherwise both edit the same duty.
     set('viewer','操作権を確認できません：'+String(error.code||error.message||error)+
      '（Firestoreルールと利用者登録を確認してください）');
    });
   }catch(error){set('viewer','端末制限の準備に失敗：'+String(error.message||error));}
  }
  function state(){return mode;}
  function canWrite(){return mode==='writer';}
  return {begin,claim,viewOnly,clear,state,canWrite,sessionId:()=>mode==='writer'?sessionId:''};
 }
};
})(typeof window!=='undefined'?window:globalThis);
