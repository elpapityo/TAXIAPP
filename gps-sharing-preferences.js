/* 公開設定の未同期操作をUID別に保持。サーバー読戻し一致後だけ確認済み。 */
(function(root){'use strict';
function create({uid,storage,read,write,online=()=>true}){
 const key='taxiapp-location-pending-v1-'+uid,legacy='taxiapp-location-public-v1-'+uid;
 let pending=null,confirmed=false,publicValue=true,tail=Promise.resolve(),disposed=false;
 try{const raw=JSON.parse(storage.getItem(key)||'null');if(raw&&typeof raw.public==='boolean')pending=raw;
  publicValue=pending?pending.public:storage.getItem(legacy)!=='0';}catch{}
 function state(){return {public:publicValue,confirmed,pending:!!pending};}
 function choose(value){
  const operation={public:!!value,id:root.crypto.randomUUID()};
  // Persistence failure must be visible and must never restore public sending.
  publicValue=operation.public;confirmed=false;pending=operation;
  storage.setItem(key,JSON.stringify(operation));storage.setItem(legacy,value?'1':'0');
  return state();
 }
 async function synchronize(){
  if(disposed)throw Error('公開設定の利用者が切り替わりました');
  if(!online())throw Error('オフライン：公開設定の同期待ち');
  const action=pending;
  if(action){
   await write(action.public);
   const saved=await read();
   if(saved!==action.public)throw Error('公開設定のサーバー読戻しが一致しません');
   if(disposed)return state();
   if(pending?.id===action.id){pending=null;confirmed=true;storage.removeItem(key);}
  }else{
   const saved=await read();
   if(disposed||pending)return state();
   if(typeof saved==='boolean'){
    publicValue=saved;confirmed=true;storage.setItem(legacy,saved?'1':'0');
   }else{choose(publicValue);return synchronize();}
  }
  return state();
 }
 function sync(){const result=tail.then(synchronize);tail=result.catch(()=>{});return result;}
 return Object.freeze({state,choose,sync,dispose(){disposed=true;}});
}
const api=Object.freeze({create});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.TAXIAPP_GPS_SHARING_PREFERENCES=api;
})(typeof window!=='undefined'?window:globalThis);
