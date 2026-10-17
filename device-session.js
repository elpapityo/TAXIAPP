/* TAXIAPP v0.3.49: server-acknowledged and watcher-confirmed editor session.
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
  let pendingTakeover=false,watchGeneration=0;
  let claimCandidate='',claimWriteAck=false,confirmedSession='';
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
  function viewOnly(){
   viewerRequested=true;
   claimCandidate='';claimWriteAck=false;
   if(currentUid)set('viewer','閲覧専用で利用中');
  }
  function clear(){
   watchGeneration++;
   if(unsubscribe){unsubscribe();unsubscribe=null;}
   currentUid='';sessionId='';claimedOnce=false;claimInFlight=false;viewerRequested=false;listenerHealthy=false;pendingTakeover=false;claimCandidate='';claimWriteAck=false;confirmedSession='';
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
  async function diagnosePermission(uid,generation){
   // Only runs after a denied operation (never polls): check the CURRENT
   // server-side account registration, not a possibly stale offline cache.
   if(typeof f.getDocFromServer!=='function')return;
   try{
    const results=await Promise.all([
     f.getDocFromServer(f.doc(db,'admins',uid)),
     f.getDocFromServer(f.doc(db,'users',uid))
    ]);
    if(uid!==currentUid||generation!==watchGeneration||mode==='writer')return;
    const admin=results[0].exists()&&results[0].data()?.enabled===true;
    const user=results[1].exists()&&results[1].data()?.status==='active';
    if(!admin&&!user)
     set('viewer','操作権を取得できません：Firestoreに管理者または有効な利用者の登録がありません（Googleログインだけでは操作できません）');
    else
     set('viewer','操作権を取得できません：利用者登録は確認済みですが、deviceSessionsへのアクセスが拒否されています。FirestoreルールとFirebaseの接続先を確認してください');
   }catch(error){
    if(uid===currentUid&&generation===watchGeneration&&mode!=='writer')
     set('viewer','操作権を取得できません：本人の登録情報をサーバーから確認できません（'+
       String(error?.code||error?.message||error)+'）');
   }
  }
  // An onSnapshot callback can be delivered before or after setDoc resolves,
  // and may briefly contain local pending writes. Never depend on callback order.
  function promoteIfConfirmed(){
   if(!claimCandidate||!claimWriteAck||!listenerHealthy||
      confirmedSession!==claimCandidate||viewerRequested===null)return false;
   const acceptedId=claimCandidate;
   setSession(acceptedId);
   claimedOnce=true;viewerRequested=false;
   claimCandidate='';claimWriteAck=false;
   set('writer','操作可能（サーバー確定済み）');
   return true;
  }
  async function claim(){
   if(!currentUid||!d.auth.currentUser||d.auth.currentUser.uid!==currentUid)return;
   if(claimInFlight)return;
   // A denied/disconnected Firestore watcher cannot be trusted to revoke
   // editing rights. An explicit takeover reopens ONE watcher; it never
   // enters writer mode unless the server sends a fresh authorized snapshot.
   if(!listenerHealthy){
    pendingTakeover=true;claimedOnce=true;
    set('pending','操作権の確認をやり直しています…');
    subscribe();
    return;
   }
   claimInFlight=true;
   set('pending','操作する端末を切り替えています…');
   const uid=currentUid,newId=id();
   const generation=watchGeneration;
   claimCandidate=newId;claimWriteAck=false;
   try{
    // A completed write AND a fresh server listener snapshot naming the
    // same session are both necessary; neither alone grants editing rights.
    await f.setDoc(ref(),{sessionId:newId,updatedAt:f.serverTimestamp()});
    if(uid!==currentUid||generation!==watchGeneration||claimCandidate!==newId)return;
    claimWriteAck=true;
    if(!promoteIfConfirmed())
     set('pending','Googleへの書き込み完了・操作権の確定通知を待っています…');
   }catch(error){
    if(uid===currentUid&&generation===watchGeneration&&claimCandidate===newId){
     claimCandidate='';claimWriteAck=false;
     set('viewer','操作権の切り替えに失敗：'+String(error.code||error.message||error));
     if(String(error.code||'').includes('permission-denied'))
      void diagnosePermission(uid,watchGeneration);
    }
   }finally{claimInFlight=false;}
  }
  function subscribe(){
   const uid=currentUid;
   if(!uid)return;
   const generation=++watchGeneration;
   if(unsubscribe){unsubscribe();unsubscribe=null;}
   listenerHealthy=false;confirmedSession='';
   try{
    unsubscribe=f.onSnapshot(ref(),{includeMetadataChanges:true},snap=>{
     if(generation!==watchGeneration||uid!==currentUid||d.auth.currentUser?.uid!==uid)return;
     if(snap.metadata.fromCache||snap.metadata.hasPendingWrites){
      listenerHealthy=false;confirmedSession='';
      set('pending','通信中：操作権をサーバーで確認しています…');
      return;
     }
     listenerHealthy=true;
     confirmedSession=snap.exists()?snap.data().sessionId:'';
     if(claimCandidate){
      if(promoteIfConfirmed())return;
      set('pending','Google側で操作権を確定しています…');
      return;
     }
     if(pendingTakeover){
      pendingTakeover=false;
      claimedOnce=true;
      claim();
      return;
     }
     if(!snap.exists()){
      if(viewerRequested){
       set('viewer','閲覧専用でログイン中');return;
      }
      if(!claimedOnce&&!claimInFlight){claimedOnce=true;claim();}
      else if(!claimInFlight)set('viewer','操作できる端末がありません。切替ボタンで取得してください');
      return;
     }
     const active=snap.data().sessionId;
     if(active===sessionId&&sessionId&&!viewerRequested){
      set('writer','操作可能（この端末が有効です）');
     }else if(!claimedOnce&&!viewerRequested&&!claimInFlight){
      claimedOnce=true;
      claim();
     }else{
      set('viewer','別の端末が操作中。この端末は閲覧専用です');
     }
    },error=>{
     if(generation!==watchGeneration||uid!==currentUid)return;
     listenerHealthy=false;confirmedSession='';claimCandidate='';claimWriteAck=false;
     pendingTakeover=false;
     set('viewer','操作権の確認が拒否されました：'+String(error.code||error.message||error)+
      '（Firestoreの利用者登録・ルールをご確認ください）');
     if(String(error.code||'').includes('permission-denied'))
      void diagnosePermission(uid,generation);
    });
   }catch(error){
    if(generation!==watchGeneration||uid!==currentUid)return;
    listenerHealthy=false;confirmedSession='';claimCandidate='';claimWriteAck=false;pendingTakeover=false;
    set('viewer','操作権の監視を開始できません：'+String(error.code||error.message||error));
   }
  }
  async function begin(user,{viewer=false}={}){
   if(!user){clear();return;}
   if(currentUid===user.uid&&unsubscribe){
    if(viewer)viewOnly();
    return;
   }
   clear();
   currentUid=user.uid;
   const oldId=readStored();
   sessionId=oldId;
   viewerRequested=Boolean(viewer);
   claimedOnce=Boolean(oldId);
   set('pending','操作権を確認しています…');
   subscribe();
  }
  function state(){return mode;}
  function canWrite(){return mode==='writer';}
  return {begin,claim,viewOnly,clear,state,canWrite,sessionId:()=>mode==='writer'?sessionId:''};
 }
};
})(typeof window!=='undefined'?window:globalThis);
