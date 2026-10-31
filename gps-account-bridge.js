/* 日報UIDとGPS UIDを区別する認証連携。既存日報・認証状態を更新しない。 */
(function(root){'use strict';
const DIARY_PROJECT='taxiapp-2b6bd',GPS_PROJECT='taxigps-9f82e';
function subject(user){
 if(!user?.uid||user.emailVerified!==true)throw Error('確認済みGoogleアカウントが必要です');
 const rows=(user.providerData||[]).filter(x=>x.providerId==='google.com');
 if(rows.length!==1||typeof rows[0].uid!=='string'||!rows[0].uid)throw Error('Google本人確認情報がありません');
 return rows[0].uid;
}
function pair(diaryUser,gpsUser){
 if(subject(diaryUser)!==subject(gpsUser))throw Error('日報とGPSで別のGoogleアカウントが選ばれています');
 return Object.freeze({diaryUid:diaryUser.uid,gpsUid:gpsUser.uid});
}
function create({diaryAuth,gpsAuth,endpoint,fetch:fetcher=root.fetch,timeoutMs=15000}){
 if(diaryAuth?.app?.options?.projectId!==DIARY_PROJECT||gpsAuth?.app?.options?.projectId!==GPS_PROJECT||diaryAuth===gpsAuth)
  throw Error('日報とGPSの認証接続先が一致しません');
 let url;try{url=new URL(endpoint);}catch{throw Error('GPS認証連携は未配置です');}
 if(url.origin!=='https://script.google.com'||!/^\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(url.pathname)||url.search||url.hash||url.username||url.password)
  throw Error('GPS認証連携のURLが不正です');
 if(typeof fetcher!=='function')throw Error('GPS認証連携に接続できません');
 let disposed=false,generation=0,tail=Promise.resolve();
 function current(d,g,epoch){
  if(disposed||generation!==epoch||diaryAuth.currentUser!==d||gpsAuth.currentUser!==g)
   throw Error('ログイン利用者が切り替わりました。連携を保留します');
  pair(d,g);
 }
 async function request(writerSessionId,d,g,epoch){
  const ids=pair(d,g);current(d,g,epoch);
  if(writerSessionId!==null&&(typeof writerSessionId!=='string'||writerSessionId.length<32||writerSessionId.length>128))
   throw Error('操作端末の識別情報が不正です');
  const [diaryIdToken,gpsIdToken]=await Promise.all([d.getIdToken(),g.getIdToken()]);
  current(d,g,epoch);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   // トークンはPOST本文のみ。URL/保存領域/ログには記録しない。
   // text/plainの単純POST。GASの実CORS/redirect受入は公開後に別途検証する。
   const response=await fetcher(url.href,{method:'POST',credentials:'omit',redirect:'follow',
    headers:{'Content-Type':'text/plain;charset=UTF-8'},signal:controller.signal,
    body:JSON.stringify({action:'link',diaryIdToken,gpsIdToken,writerSessionId})});
   current(d,g,epoch);
   if(!response.ok)throw Error('GPS認証連携に接続できません');
   const result=await response.json();current(d,g,epoch);
   if(!result.ok)throw Error('GPS認証連携を確認できません（'+String(result.code||'unavailable')+'）');
   const data=result.data;
   if(data?.diaryUid!==ids.diaryUid||data?.gpsUid!==ids.gpsUid||
      data?.writerSessionId!==writerSessionId||!Number.isSafeInteger(data?.validUntilMs)||
      data.validUntilMs<=Date.now())throw Error('GPS認証連携の保存確認が一致しません');
   return Object.freeze({...ids,writerSessionId,validUntilMs:data.validUntilMs});
  }finally{clearTimeout(timer);}
 }
 return Object.freeze({link(writerSessionId=null){
  const d=diaryAuth.currentUser,g=gpsAuth.currentUser,epoch=generation;
  const run=tail.then(()=>request(writerSessionId,d,g,epoch));tail=run.catch(()=>{});return run;
 },
  invalidate(){generation++;},dispose(){disposed=true;generation++;}});
}
const api=Object.freeze({pair,create,DIARY_PROJECT,GPS_PROJECT});
root.TAXIAPP_GPS_ACCOUNT_BRIDGE=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
