/* TAXIAPP owner-scoped preferences transfer. Pure data functions; no storage writes.
 * Shifts are managed by existing duty sync and are deliberately untouched.
 */
(function(root){
'use strict';
const FORMAT='TAXIAPP_ACCOUNT_SETTINGS_V1';
const MAX_BYTES=350000;
const PRIVATE_KEY_RE=/(?:password|secret|credential|accessKey|apiKey|writeKey|authToken|refreshToken)/i;
function plain(v){return v&&typeof v==='object'&&!Array.isArray(v);}
function clean(value){
 const seen=new WeakSet();
 const result=JSON.parse(JSON.stringify(value,(key,v)=>{
  if(key&&(/^(?:__proto__|constructor|prototype)$/.test(key)||PRIVATE_KEY_RE.test(key)))return undefined;
  if(v&&typeof v==='object'){
   if(seen.has(v))throw Error('循環する設定は移行できません');
   seen.add(v);
  }
  return v;
 }));
 if(!plain(result))throw Error('設定の形式が正しくありません');
 return result;
}
function extract(model){
 if(model?.version!==1||!Array.isArray(model?.shifts)||!plain(model.prefs))
  throw Error('既存のTAXIAPP設定を確認できません');
 const prefs=clean(model.prefs);
 const bytes=new TextEncoder().encode(JSON.stringify(prefs)).length;
 if(bytes>MAX_BYTES)throw Error('設定データが大きすぎます（上限350KB）。送信しません。');
 return {format:FORMAT,schemaVersion:1,prefs};
}
function validate(remote){
 if(!remote||remote.format!==FORMAT||remote.schemaVersion!==1||!plain(remote.prefs))
  throw Error('クラウド上の設定データ形式が違います');
 const data=clean(remote.prefs);
 if(new TextEncoder().encode(JSON.stringify(data)).length>MAX_BYTES)throw Error('クラウド設定の容量が不正です');
 return data;
}
function summary(prefs){
 const p=plain(prefs)?prefs:{};
 return {
  driver:String(p.driver||'（未設定）').slice(0,80),
  driverNo:String(p.driverNo||'（未設定）').slice(0,80),
  vehicle:String(p.vehicle||'（未設定）').slice(0,80),
  waitPlaceCount:Array.isArray(p.waitPlaces)?p.waitPlaces.length:0,
  hasDisplay:plain(p.ui),
  hasInput:plain(p.input),
  settingGroups:Object.keys(p).length
 };
}
function merge(model,remote){
 const prefs=validate(remote);
 if(model?.version!==1||!Array.isArray(model?.shifts)||!plain(model.prefs))
  throw Error('この端末の既存データを確認できません');
 const current=clean(model.prefs);
 // Google Apps Script sync endpoint, write modes and credentials belong to
 // each device. A login on a new phone must not inherit a live auto-sync mode.
 const localSheet=plain(current.sheetTarget)?current.sheetTarget:{};
 const remoteSheet=plain(prefs.sheetTarget)?prefs.sheetTarget:{};
 const sheetTarget={...remoteSheet,...localSheet};
 for(const field of ['webAppUrl','spreadsheetUrl','syncMode','mode'])
  if(Object.hasOwn(localSheet,field))sheetTarget[field]=localSheet[field];
  else delete sheetTarget[field];
 // Keep waiting locations registered on this particular device too.
 // Do not silently drop overflow beyond the app's 30-location UI limit.
 const remotePlaces=Array.isArray(prefs.waitPlaces)?prefs.waitPlaces:[];
 const localPlaces=Array.isArray(current.waitPlaces)?current.waitPlaces:[];
 const combined=[...new Set([...remotePlaces,...localPlaces].filter(
  n=>typeof n==='string'&&n.trim()))];
 if(combined.length>30)
  throw Error('待機所が合計30件を超えるため自動統合できません。どちらの端末も変更せず停止しました。');
 const remoteCoords=plain(prefs.waitPlaceCoords)?prefs.waitPlaceCoords:{};
 const localCoords=plain(current.waitPlaceCoords)?current.waitPlaceCoords:{};
 return {
  ...model,
  prefs:{
   ...current,...prefs,
   waitPlaces:combined,
   waitPlaceCoords:{...localCoords,...remoteCoords},
   sheetTarget
  }
 };
}
root.TAXIAPP_ACCOUNT_SETTINGS=Object.freeze({FORMAT,MAX_BYTES,extract,validate,summary,merge});
})(typeof window!=='undefined'?window:globalThis);
