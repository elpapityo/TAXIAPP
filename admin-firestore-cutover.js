/* TAXIAPP: administrator's read-only, selection-based Firestore cutover preflight.
 * This module never reads or writes external services. Callers must supply
 * both datasets from the SAME authenticated UID; do not pass other drivers.
 * No migration, deletion, print update, or backend switch is performed here.
 */
(function(root){
'use strict';
const ID=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
function canonical(value){
 return JSON.stringify(value,(_key,entry)=>
  entry&&typeof entry==='object'&&!Array.isArray(entry)
   ?Object.fromEntries(Object.keys(entry).sort().map(k=>[k,entry[k]])):entry);
}
function toInstant(iso,date,time){
 if(typeof iso==='string'&&iso.trim()){
  // A malformed saved ISO value must not silently fall back to local time.
  const n=Date.parse(iso);
  return Number.isFinite(n)?n:null;
 }
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return null;
 if(!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(String(time||'')))return null;
 const [h,m,sec=0]=String(time).split(':').map(Number);
 if(h>23||m>59||sec>59)return null;
 const local=String(date)+'T'+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0')+'+09:00';
 const n=Date.parse(local);
 return Number.isFinite(n)?n:null;
}
function interval(shift){
 const start=toInstant(shift?.startedIso,shift?.date,shift?.startedAt);
 const end=toInstant(shift?.endedIso,shift?.date,shift?.endedAt);
 if(start===null)return {start:null,end:null,reason:'出庫時刻を確認できません'};
 if(!shift?.endedIso&&!shift?.endedAt)return {start,end:null,reason:'未入庫の乗務です'};
 if(end===null)return {start,end:null,reason:'入庫時刻を確認できません'};
 let normalized=end;
 // Only legacy clock-only rows may legitimately cross midnight.
 if(!shift?.endedIso&&!shift?.startedIso&&end<start)
  normalized+=24*60*60*1000;
 if(normalized<=start)return {start,end:normalized,reason:'乗務時間の前後関係が不正です'};
 return {start,end:normalized,reason:''};
}
function overlaps(a,b){
 return a.start!==null&&a.end!==null&&!a.reason&&
  b.start!==null&&b.end!==null&&!b.reason&&
  a.start<b.end&&b.start<a.end;
}
function readRows(rows,name){
 if(!Array.isArray(rows))throw Error(name+'が配列ではありません');
 const m=new Map();
 for(const row of rows){
  if(!row||!ID.test(String(row.id||''))||m.has(row.id)||
     !Array.isArray(row.records)||!row.settings||typeof row.settings!=='object')
   throw Error(name+'に不正または重複する日報があります');
  m.set(row.id,row);
 }
 return m;
}
function plan({uid,cloudUid,legacyShifts,cloudShifts,selectedIds}={}){
 if(typeof uid!=='string'||!uid.trim()||cloudUid!==uid)
  throw Error('比較する日報は本人の同じ認証UIDである必要があります');
 const legacy=readRows(legacyShifts,'移行元');
 const cloud=readRows(cloudShifts,'Firebase');
 if(!Array.isArray(selectedIds)||new Set(selectedIds).size!==selectedIds.length)
  throw Error('移行対象の日報を重複なく明示的に選択してください');
 for(const id of selectedIds){
  if(!ID.test(String(id||''))||!legacy.has(id))
   throw Error('選択された移行元日報が見つかりません');
 }
 const chosen=new Set(selectedIds);
 const entries=selectedIds.map(id=>{
  const local=legacy.get(id),stored=cloud.get(id),span=interval(local);
  let action='create-only',details=[];
  if(stored){
   action=canonical(local)===canonical(stored)?'already-present':'conflict';
   if(action==='conflict')details.push('同じIDのクラウド日報と内容が異なります');
  }
  if(span.reason){details.push(span.reason);if(action==='create-only')action='review';}
  // A different ID whose shift time intersects must be reviewed.
  const overlapsCloud=[...cloud.values()].filter(other=>other.id!==id&&
   overlaps(span,interval(other))).map(other=>other.id);
  const overlapsSelected=selectedIds.filter(otherId=>otherId!==id&&
   overlaps(span,interval(legacy.get(otherId))));
  const overlapsExcluded=[...legacy.values()].filter(other=>other.id!==id&&
   !chosen.has(other.id)&&overlaps(span,interval(other))).map(other=>other.id);
  if(overlapsCloud.length||overlapsSelected.length){
   details.push('乗務時間が他の日報と重複しています');
   if(action==='create-only')action='overlap';
  }
  return {
   id,date:String(local.date||''),startedAt:String(local.startedAt||''),
   endedAt:String(local.endedAt||''),recordCount:local.records.length,
   action,details,overlapsCloud,overlapsSelected,overlapsExcluded,
   // Display-only helper; never treat this as an authorization to upload.
   cloudRevision:stored?null:0
  };
 });
 const blocked=entries.filter(x=>!['create-only','already-present'].includes(x.action));
 return {
  uid,sourceCount:legacy.size,cloudCount:cloud.size,
  selectedCount:selectedIds.length,skippedCount:legacy.size-selectedIds.length,
  entries,readyCount:entries.filter(x=>x.action==='create-only').length,
  alreadyPresentCount:entries.filter(x=>x.action==='already-present').length,
  requiresReview:blocked.length>0,
  // This is a preflight only: always require a separate, explicit migration action.
  migrationAuthorized:false
 };
}
root.TAXIAPP_ADMIN_CUTOVER=Object.freeze({plan,interval,overlaps});
})(typeof window!=='undefined'?window:globalThis);
