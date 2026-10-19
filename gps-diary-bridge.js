/* Native Android GPS -> production browser diary. Read-only loopback GPS snapshot: no direct shift writes.
 * Strictly no write to daily records here. Simulated input is flagged to the caller.
 * Auto correction basis lives in this browser, keyed by the actual shift ID.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.TAXIAPP_EXTERNAL_GPS=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 // Main everyday-use APK gets a dedicated package and port so previous
 // v1.3.1 keeps its Android data; fallback keeps existing users connected.
 const ENDPOINT='http://127.0.0.1:48769/';
 const LEGACY_ENDPOINT='http://127.0.0.1:48768/';
 const EXPECTED_MARKER='GPS_DISTANCE_LAB_DIARY_V1_4_0_100';
 const EXPECTED_PACKAGE='jp.taxiapp.gpsprototype.distancelabv140';
 const EXPECTED_WEB_VERSION='1.4.0';
 const LEGACY_MARKER='GPS_DISTANCE_LAB_DIARY_V1_3_1_100';
 const LEGACY_PACKAGE='jp.taxiapp.gpsprototype.distancelabv131';
 function correctIdentity(value,endpoint=ENDPOINT){
   if(!value)return false;
   return endpoint===ENDPOINT
     ?value.marker===EXPECTED_MARKER&&value.packageId===EXPECTED_PACKAGE&&value.webVersion===EXPECTED_WEB_VERSION
     :endpoint===LEGACY_ENDPOINT&&value.marker===LEGACY_MARKER&&
       value.packageId===LEGACY_PACKAGE&&value.webVersion==='1.3.1';
 }
 const PREFIX='taxiapp-production-native-gps-baseline-v140:';
 const GAP='taxiapp-production-native-gps-gaps-v140:';
 const FORMAT='GPS_DISTANCE_LAB_V1';
 function key(id){return PREFIX+String(id);}
 function finiteKm(x){return typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<100000;}
 function getStorage(storage){return storage||(typeof localStorage==='undefined'?null:localStorage);}
 function baseline(storage,id){
   try{
     const val=JSON.parse(getStorage(storage)?.getItem(key(id))||'null');
     return val&&finiteKm(val.gps)&&finiteKm(val.value)&&typeof val.runId==='string'&&val.runId?val:null;
   }catch{return null;}
 }
 function ensureStart(storage,id,gpsKm,startValue,runId){
   const current=baseline(storage,id);
   if(current){
     if(current.runId!==runId)throw Error('GPSアプリが再起動しました。車両トリップを手入力してGPS基準を再登録してください');
     return current;
   }
   return recordManual(storage,id,gpsKm,startValue,runId,true);
 }
 function recordManual(storage,id,gpsKm,value,runId,automatic=false){
   const n=Number(value);
   if(!finiteKm(gpsKm)||value===''||!finiteKm(n)||
      typeof runId!=='string'||runId.length<8||!id)throw Error('GPS基準・車両トリップの値が不正です');
   const b={gps:gpsKm,value:n,runId,at:Date.now(),automatic:!!automatic};
   getStorage(storage).setItem(key(id),JSON.stringify(b));return b;
 }
 function calculated(gpsKm,base,runId){
   if(!finiteKm(gpsKm)||!base||!finiteKm(base.gps)||!finiteKm(base.value))
     throw Error('出庫時のGPS基準が未登録です。車両トリップを確認してください');
   if(runId!==base.runId)throw Error('GPSアプリが再起動しました。車両トリップの実測値を入力して基準を合わせてください');
   if(gpsKm+0.00001<base.gps)throw Error('GPS累計が基準点より減少しています。車両トリップで再補正してください');
   return Math.round((base.value+gpsKm-base.gps)*1000)/1000;
 }
 function acknowledgeGap(storage,id,gaps){
   if(!Number.isInteger(gaps)||gaps<0)throw Error('GPS欠測件数が不正です');
   getStorage(storage).setItem(GAP+String(id),String(gaps));
 }
 function gapAcknowledged(storage,id,gaps){
   try{return getStorage(storage).getItem(GAP+String(id))===String(gaps);}catch{return false;}
 }
 function nonce(){
   if(typeof crypto==='undefined'||!crypto.getRandomValues)throw Error('安全なGPS取得識別子がありません');
   const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
   return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
 }
 function pause(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
 async function getJson(path,fetcher,endpoint=ENDPOINT){
   const control=new AbortController(),timer=setTimeout(()=>control.abort(),4700);
   try{
     const response=await fetcher(endpoint+path,{cache:'no-store',signal:control.signal,targetAddressSpace:'loopback'});
     if(!response.ok)throw Error('GPS通信 HTTP '+response.status);
     return await response.json();
   }catch(e){
     if(e instanceof TypeError||e?.name==='AbortError')
       throw Error('Android日報GPSと通信できません。GPSアプリを開始し、Chromeでこの日報サイトの「ループバックネットワーク（ローカルネットワーク）」への接続を許可してください。拒否済みならサイト設定から許可を変更してください');
     throw e;
   }finally{clearTimeout(timer);}
 }
 async function read(storage,fetcher,options={}){
   const call=fetcher||(typeof fetch==='undefined'?null:fetch.bind(globalThis));
   if(!call)throw Error('GPS通信を使用できません');
   let endpoint=ENDPOINT,state;
   try{state=await getJson('api/status',call,endpoint);}
   catch(error){
     // Only transport failure permits compatibility fallback: an identity
     // mismatch on the production port is never silently accepted.
     if(!String(error?.message||'').includes('Android日報GPSと通信できません'))throw error;
     endpoint=LEGACY_ENDPOINT;
     state=await getJson('api/status',call,endpoint);
   }
   if(!correctIdentity(state,endpoint))throw Error('GPS距離ラボのアプリ識別情報が接続先と一致しません。48769（v1.4.0）または48768（v1.3.1）を確認してください');
   if(state.running!==true)throw Error('GPSアプリの計測が停止しています');
   if(typeof state.runId!=='string'||!state.runId)
      throw Error('GPS計測の識別番号がありません');
   const n=nonce();
   let last='';
   for(let attempt=0;attempt<5;attempt++){
     const p=await getJson('api/capture?target=start&nonce='+n,call,endpoint);
     if(p.ready===true){
       const x=p.snapshot;
       if(!correctIdentity(x,endpoint)||!x||x.format!==FORMAT||x.nonce!==n||x.target!=='start'||
          x.runId!==state.runId||!finiteKm(x.tripKm)||x.running!==true||
          !Number.isFinite(x.capturedAt)||
          !Number.isFinite(x.gpsAgeMs)||x.gpsAgeMs<0||x.gpsAgeMs>15000)
         throw Error('GPS応答の内容が不正または古いです');
       const gaps=Number.isInteger(state.gaps)?state.gaps:0;
       if(x.unresolvedGap===true&&!options.allowUnresolvedGap&&
          !gapAcknowledged(storage,options.shiftId,gaps))
         throw Error('GPS欠測が未補正です。車両トリップを確認して手入力してください');
       return {format:'TAXIAPP_GPS_DIARY_V131',tripKm:x.tripKm,runId:x.runId,
               capturedAt:x.capturedAt,gpsAgeMs:x.gpsAgeMs,
               gapCount:gaps,unresolvedGap:x.unresolvedGap===true,
               simulated:x.simulated===true,accuracyMeters:state.accuracyMeters,
               gpsSource:endpoint===ENDPOINT?'v1.4.0':'v1.3.1'};
     }
     last=p.message||'再取得中';
     if(attempt<4)await pause(800);
   }
   throw Error('新しいGPS地点を取得できません：'+last);
 }
 return {read,baseline,ensureStart,recordManual,calculated,acknowledgeGap,
         gapAcknowledged,endpoint:ENDPOINT,legacyEndpoint:LEGACY_ENDPOINT,format:'TAXIAPP_GPS_DIARY_V131'};
});
