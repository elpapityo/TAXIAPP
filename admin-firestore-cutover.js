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
// Device-only preview: the cloud has NOT been fetched or compared.
// Never present local-only candidates as approved or safe to upload.
function previewLocal({uid,legacyShifts,selectedIds}={}){
 if(typeof uid!=='string'||!uid.trim())throw Error('管理者本人のUIDを確認できません');
 const legacy=readRows(legacyShifts,'端末内の日報');
 if(!Array.isArray(selectedIds)||new Set(selectedIds).size!==selectedIds.length)
  throw Error('日報を重複なく選択してください');
 for(const id of selectedIds){
  if(!legacy.has(id))throw Error('端末内に選択した日報がありません');
 }
 const chosen=new Set(selectedIds);
 const entries=selectedIds.map(id=>{
  const duty=legacy.get(id),span=interval(duty);
  const intersect=[...legacy.values()].filter(other=>other.id!==id&&overlaps(span,interval(other)));
  return {
   id,date:String(duty.date||''),startedAt:String(duty.startedAt||''),
   endedAt:String(duty.endedAt||''),recordCount:duty.records.length,
   timeIssue:span.reason||'',
   overlapsSelected:intersect.filter(x=>chosen.has(x.id)).map(x=>x.id),
   overlapsExcluded:intersect.filter(x=>!chosen.has(x.id)).map(x=>x.id)
  };
 });
 return {
  format:'TAXIAPP_ADMIN_SELECTION_PREVIEW_V1',
  uid,source:'current-device-only',cloudVerified:false,
  selectedCount:entries.length,sourceCount:legacy.size,
  excludedCount:legacy.size-entries.length,entries,
  requiresReview:entries.some(x=>x.timeIssue||x.overlapsSelected.length||x.overlapsExcluded.length),
  migrationAuthorized:false
 };
}
// Read-only comparison of the legacy administrator's configured Google Sheets
// sync originals and the SAME administrator's local records. A Google Sheet is
// NOT UID-isolated; caller must first verify administrator role and connection.
// This never grants migration, delete, overwrite, or sync permissions.
function compareLegacySheet({uid,localShifts,sheetShifts,selectedIds}={}){
 if(typeof uid!=='string'||!uid.trim())
  throw Error('管理者本人のUIDを確認できません');
 const local=readRows(localShifts,'端末内の日報');
 const sheet=readRows(sheetShifts,'Google同期原本');
 if(!Array.isArray(selectedIds)||new Set(selectedIds).size!==selectedIds.length)
  throw Error('移行対象の日報を重複なく選択してください');
 const chosen=new Set(selectedIds);
 for(const id of chosen)if(!local.has(id))
  throw Error('選択した日報が端末内に見つかりません');
 const selected=selectedIds.map(id=>{
  const current=local.get(id),original=sheet.get(id),span=interval(current);
  const intersect=[...sheet.values()].filter(other=>other.id!==id&&
   overlaps(span,interval(other))).map(other=>other.id);
  const exact=!!original&&canonical(current)===canonical(original);
  return {
   id,source:'device',date:String(current.date||''),
   selected:true,recordCount:current.records.length,
   sheetStatus:!original?'device-only':exact?'same-id-identical':'same-id-different',
   overlapsSheet:intersect,
   timeIssue:span.reason||'',
   needsReview:!original||!exact||intersect.length>0||!!span.reason
  };
 });
 const all=[...local].map(([id,current])=>{
  const remote=sheet.get(id),time=interval(current);
  const peerOverlap=[...sheet.values()].filter(other=>other.id!==id&&
   overlaps(time,interval(other))).map(other=>other.id);
  return {id,source:'device',date:String(current.date||''),
   recordCount:current.records.length,
   selected:chosen.has(id),
   status:!remote?'device-only':
     canonical(current)===canonical(remote)?'same-id-identical':'same-id-different',
   overlapsSheet:peerOverlap,timeIssue:time.reason||''};
 });
 const remoteOnly=[...sheet].filter(([id])=>!local.has(id)).map(([id,duty])=>({
  id,source:'sheet-only',date:String(duty.date||''),
  recordCount:duty.records.length,selected:false,
  timeIssue:interval(duty).reason||'',
  overlapsLocal:[...local.values()].filter(l=>overlaps(interval(duty),interval(l))).map(l=>l.id)
 }));
 return {
  format:'TAXIAPP_LEGACY_SHEET_COMPARISON_V1',
  uid,sheetSource:'TAXIAPP_同期原本',
  firebaseVerified:false,comparisonScope:'configured-legacy-google-sync-originals',
  localCount:local.size,sheetCount:sheet.size,selectedCount:chosen.size,
  matchingCount:all.filter(x=>x.status==='same-id-identical').length,
  changedCount:all.filter(x=>x.status==='same-id-different').length,
  deviceOnlyCount:all.filter(x=>x.status==='device-only').length,
  sheetOnlyCount:remoteOnly.length,selected,device:all,sheetOnly:remoteOnly,
  migrationAuthorized:false,deleteAuthorized:false
 };
}
// Pure three-source preflight: NONE of the records is written, migrated or
// removed. Caller must have fetched Firestore using the signed-in owner's UID.
// The legacy Sheets source may be unavailable; unknown is not the same as empty.
function compareOwnFirestore({uid,cloudUid,localShifts,cloudShifts,
  sheetShifts=null,selectedIds}={}){
 if(!uid||uid!==cloudUid)throw Error('Firebaseと照合するUIDが一致しません');
 const local=readRows(localShifts,'端末内の日報');
 const cloud=readRows(cloudShifts,'本人Firebase原本');
 const sheets=sheetShifts===null?null:readRows(sheetShifts,'Google同期原本');
 if(!Array.isArray(selectedIds)||new Set(selectedIds).size!==selectedIds.length)
  throw Error('照合する日報IDを重複なく選択してください');
 for(const id of selectedIds)if(!local.has(id))
  throw Error('端末内に選択した日報がありません');
 const selected=new Set(selectedIds);
 const entries=[...local].map(([id,shift])=>{
  const onCloud=cloud.get(id),onSheet=sheets?.get(id),time=interval(shift);
  const cloudStatus=!onCloud?'not-in-firestore':
   canonical(shift)===canonical(onCloud)?'same':'different';
  const sheetStatus=sheets===null?'not-checked':!onSheet?'not-in-sheet':
   canonical(shift)===canonical(onSheet)?'same':'different';
  const cloudOverlap=[...cloud.values()].filter(row=>row.id!==id&&
   overlaps(time,interval(row))).map(row=>row.id);
  const sheetOverlap=sheets===null?[]:[...sheets.values()].filter(row=>row.id!==id&&
   overlaps(time,interval(row))).map(row=>row.id);
  return {
   id,date:String(shift.date||''),selected:selected.has(id),
   recordCount:shift.records.length,cloudStatus,sheetStatus,
   cloudOverlap,sheetOverlap,timeIssue:time.reason||'',
   // A missing or unchecked Google original is NOT proof of three-source parity.
   needsReview:cloudStatus!=='same'||
    sheetStatus!=='same'||cloudOverlap.length>0||
    sheetOverlap.length>0||!!time.reason
  };
 });
 const cloudOnly=[...cloud].filter(([id])=>!local.has(id)).map(([id,shift])=>({
  id,date:String(shift.date||''),recordCount:shift.records.length,
  inSheet:sheets===null?'not-checked':sheets.has(id),
  overlappingLocal:[...local.values()].filter(row=>
   overlaps(interval(shift),interval(row))).map(row=>row.id)
 }));
 const sheetOnly=sheets===null?[]:[...sheets].filter(([id])=>
  !local.has(id)&&!cloud.has(id)).map(([id,shift])=>({
  id,date:String(shift.date||''),recordCount:shift.records.length
 }));
 return {
  format:'TAXIAPP_THREE_SOURCE_PREFLIGHT_V1',
  uid,firestoreVerified:true,sheetVerified:sheets!==null,
  firebaseCount:cloud.size,localCount:local.size,
  googleCount:sheets===null?null:sheets.size,
  selectedCount:selected.size,
  firestoreOnlyCount:cloudOnly.length,
  selectedReviewCount:entries.filter(row=>row.selected&&row.needsReview).length,
  entries,cloudOnly,sheetOnly,
  migrationAuthorized:false,deleteAuthorized:false
 };
}
root.TAXIAPP_ADMIN_CUTOVER=Object.freeze({
 plan,previewLocal,compareLegacySheet,compareOwnFirestore,interval,overlaps
});
})(typeof window!=='undefined'?window:globalThis);
