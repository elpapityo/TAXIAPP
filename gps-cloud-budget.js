/* GPSだけの通信制御。利用量/上限/他用途予約はサーバー側で取得して渡す。 */
(function(root){'use strict';
function create({resources, costs, now=()=>Date.now(), maxAgeMs=300000,checkpoint}={}){
 const names=Object.keys(resources||{}),operations=Object.keys(costs||{});
 const number=n=>Number.isSafeInteger(n)&&n>=0;
 if(!names.length||!operations.length||!number(maxAgeMs)||!maxAgeMs)throw Error('GPS通信予算の設定が不正です');
 // 呼出元のオブジェクト変更では制限を外せないようにコピーする。
 const limits={},prices={};
 for(const k of names){const r=resources[k];if(!number(r?.limit)||!r.limit||!number(r.reserve)||r.reserve>=r.limit)throw Error('他用途の予約枠が不正です');limits[k]={limit:r.limit,reserve:r.reserve};}
 for(const op of operations){prices[op]={};for(const k of names){if(!number(costs[op]?.[k]))throw Error('通信コストが未確認です');prices[op][k]=costs[op][k];}}
 let snapshot=null,lastObserved=-1,periods={},peak={},spent=Object.fromEntries(names.map(k=>[k,0]));
 const last=new Map();
 const config=JSON.stringify({limits,prices,maxAgeMs});
 if(checkpoint!==undefined){
  const c=checkpoint;
  if(!c||c.version!==1||c.config!==config||!Number.isSafeInteger(c.lastObserved)||c.lastObserved< -1||
   !Array.isArray(c.last)||c.last.length>500||c.last.some(row=>!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||row[0].length>300||!number(row[1]))||
   names.some(k=>!number(c.spent?.[k])||(c.periods?.[k]!==undefined&&!number(c.periods[k]))||(c.peak?.[k]!==undefined&&!number(c.peak[k])))||
   (c.snapshot!==null&&(!number(c.snapshot?.observedAtMs)||names.some(k=>!number(c.snapshot?.used?.[k])||!number(c.periods?.[k])))))
   throw Error('保存されたGPS予算を復元できません');
  snapshot=c.snapshot===null?null:JSON.parse(JSON.stringify(c.snapshot));lastObserved=c.lastObserved;
  periods={...c.periods};peak={...c.peak};spent={...c.spent};for(const [key,t] of c.last)last.set(key,t);
 }
 function update(value){
  const t=now();
  // 欠落/古い情報/日付逆転は余裕ありと解釈しない。
  if(!value||value.scope!=='account-and-project'||!number(value.observedAtMs)||value.observedAtMs>t||
   t-value.observedAtMs>=maxAgeMs||value.observedAtMs<=lastObserved||names.some(k=>{
    const w=value.windows?.[k],p=periods[k];
    return !number(w?.used)||!number(w?.resetAtMs)||w.resetAtMs<=t||w.resetAtMs>t+86400000||
     (p&&(w.resetAtMs<p||(w.resetAtMs!==p&&t<p)));
   })){snapshot=null;return false;}
  const used={};for(const k of names){
   if(value.windows[k].resetAtMs!==periods[k]){spent[k]=0;peak[k]=0;periods[k]=value.windows[k].resetAtMs;}
   used[k]=peak[k]=Math.max(peak[k]||0,value.windows[k].used);
  }
  snapshot={observedAtMs:value.observedAtMs,used};lastObserved=value.observedAtMs;return true;
 }
 function state(){
  const t=now();
  if(!snapshot||t<snapshot.observedAtMs||t-snapshot.observedAtMs>=maxAgeMs||names.some(k=>t>=periods[k]))
   return {mode:'paused',sendMs:Infinity,listMs:Infinity,message:'クラウド利用量を確認できないためGPS通信を休止'};
  const ratio=Math.max(...names.map(k=>(snapshot.used[k]+spent[k])/(limits[k].limit-limits[k].reserve)));
  if(ratio>=0.95)return {mode:'paused',sendMs:Infinity,listMs:Infinity,message:'他用途のクラウド枠を確保するためGPS通信を休止'};
  if(ratio>=0.8)return {mode:'saving',sendMs:180000,listMs:180000,message:'クラウド利用量によりGPS更新を180秒間隔へ延長'};
  if(ratio>=0.6)return {mode:'reduced',sendMs:60000,listMs:120000,message:'クラウド利用量によりGPS通信間隔を延長'};
  return {mode:'normal',sendMs:15000,listMs:60000,message:'GPS通常更新'};
 }
 function admit(operation,{minIntervalMs=0,actor='local'}={}){
  if(!prices[operation]||!number(minIntervalMs)||typeof actor!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(actor))throw Error('GPS通信操作が不正です');
  const key=actor+':'+operation;
  const s=state(),t=now(),interval=Math.max(minIntervalMs,operation==='send'?s.sendMs:operation==='list'?s.listMs:0);
  if(s.mode==='paused')return {...s,allowed:false,reason:'budget-unavailable'};
  if(last.has(key)&&t<last.get(key)+interval)return {...s,allowed:false,reason:'interval',nextAtMs:last.get(key)+interval};
  // 前期間の間隔記録だけを回収。本人別の間引きに対し、消費予算は全員共通。
  for(const [id,at] of last)if(t-at>=300000)last.delete(id);
  if(!last.has(key)&&last.size>=500)return {...s,allowed:false,reason:'actor-limit',message:'GPS通信の利用者数を確認できません'};
  // 通信前に予約。失敗時も解放せず、同時呼出/再送で予算を超えさせない。
  if(names.some(k=>snapshot.used[k]+spent[k]+prices[operation][k]>(limits[k].limit-limits[k].reserve)*0.95))
   return {...s,mode:'paused',allowed:false,reason:'budget-exhausted',message:'他用途の予約枠を保護するためGPS通信を休止'};
  for(const k of names)spent[k]+=prices[operation][k];last.set(key,t);
  return {...s,allowed:true};
 }
 return Object.freeze({update,state,admit,invalidate(){snapshot=null;},
  checkpoint(){return JSON.parse(JSON.stringify({version:1,config,snapshot,lastObserved,periods,peak,spent,last:[...last]}));}});
}
const api=Object.freeze({create});root.TAXIAPP_GPS_CLOUD_BUDGET=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
