/* 公開設定のUID別未同期操作。世代番号CASと操作IDで他端末・別タブの上書きを防ぐ。 */
(function(root){'use strict';
function create({uid,storage,read,write,online=()=>true}){
 const key='taxiapp-location-pending-v1-'+uid,legacy='taxiapp-location-public-v1-'+uid,
  confirmedKey='taxiapp-location-confirmed-v1-'+uid;
 let pending=null,confirmed=false,publicValue=true,tail=Promise.resolve(),disposed=false,
  serverRevision=null,conflict=false;
 const normalize=value=>typeof value==='boolean'?{public:value,revision:0,operationId:null}:
  value&&typeof value.public==='boolean'&&Number.isSafeInteger(value.revision)&&value.revision>=0?value:null;
 function stored(){const raw=JSON.parse(storage.getItem(key)||'null');return raw&&typeof raw.public==='boolean'?raw:null;}
 try{pending=stored();const saved=normalize(JSON.parse(storage.getItem(confirmedKey)||'null'));
  serverRevision=saved?.revision??null;publicValue=pending?pending.public:storage.getItem(legacy)!=='0';}catch{}
 function state(){return {public:publicValue,confirmed,pending:!!pending,conflict};}
 function remember(saved){
  if(saved&&serverRevision!=null&&saved.revision<serverRevision)return false;
  serverRevision=saved?.revision??0;
  if(saved)storage.setItem(confirmedKey,JSON.stringify(saved));return true;
 }
 function adoptNewerLocal(){
  const saved=stored();
  if(saved&&saved.id!==pending?.id){pending=saved;publicValue=saved.public;confirmed=false;conflict=false;return true;}
  return false;
 }
 function choose(value){
  const operation={public:!!value,id:root.crypto.randomUUID(),baseRevision:serverRevision};
  publicValue=operation.public;confirmed=false;conflict=false;pending=operation;
  storage.setItem(key,JSON.stringify(operation));storage.setItem(legacy,value?'1':'0');
  return state();
 }
 async function synchronize(){
  if(disposed)throw Error('公開設定の利用者が切り替わりました');
  if(!online())throw Error('オフライン：公開設定の同期待ち');
  adoptNewerLocal();
  if(conflict&&pending)return state();
  const action=pending,saved=normalize(await read());
  if(disposed)return state();
  if(!remember(saved))return state();
  if(action){
   if(pending?.id!==action.id||adoptNewerLocal())return state();
   if(saved?.operationId!==action.id){
    const revision=saved?.revision??0;
    if((action.baseRevision==null&&saved)||
       (action.baseRevision!=null&&action.baseRevision!==revision)){
     conflict=true;confirmed=false;
     throw Error('他端末で公開設定が変更されました。公開・非公開を選び直してください');
    }
    await write(action.public,{...action,baseRevision:revision});
   }
   const actual=normalize(await read());
   if(disposed)return state();
   if(!remember(actual))throw Error('公開設定の最新状態を再確認しています');
   if(!actual||actual.public!==action.public||
      (actual.operationId!=null&&actual.operationId!==action.id))
    throw Error('公開設定のサーバー読戻しが一致しません');
   if(pending?.id===action.id&&!adoptNewerLocal()){
    // 別タブの新しい未同期操作は削除しない。
    if(stored()?.id===action.id)storage.removeItem(key);
    pending=null;confirmed=true;conflict=false;
   }
  }else{
   if(pending||adoptNewerLocal())return state();
   if(saved){publicValue=saved.public;confirmed=true;storage.setItem(legacy,saved.public?'1':'0');}
   else{choose(publicValue);return synchronize();}
  }
  return state();
 }
 function receive(value){
  const saved=normalize(value);if(disposed||!saved)return state();
  if(!remember(saved))return state();adoptNewerLocal();
  if(pending)return state();
  publicValue=saved.public;confirmed=true;storage.setItem(legacy,saved.public?'1':'0');return state();
 }
 function sync(){const result=tail.then(synchronize);tail=result.catch(()=>{});return result;}
 return Object.freeze({state,choose,sync,receive,dispose(){disposed=true;}});
}
const api=Object.freeze({create});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.TAXIAPP_GPS_SHARING_PREFERENCES=api;
})(typeof window!=='undefined'?window:globalThis);
