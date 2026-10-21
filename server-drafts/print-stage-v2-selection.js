'use strict';
/* Stage 8: offline mirror of B15/B17/C17 print selection.
 * NEVER feeds actual B17/C17, changes Sheets formulas or prints paper.
 * Only already authenticated & revision-checked V2 committed projections
 * should be supplied by a future trusted adapter.
 */
const ID=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
function assertEntries(items){
 if(!Array.isArray(items)||items.length>1200)throw Error('印刷ステージの一覧が不正です');
 const seen=new Set();
 return items.map(entry=>{
  if(!entry||!ID.test(String(entry.id||''))||seen.has(entry.id)||
     !Number.isSafeInteger(entry.revision)||entry.revision<1||
     !entry.projection||entry.projection.id!==entry.id||
     entry.projection.sourceRevision!==entry.revision||
     entry.projection.format!=='TAXIAPP_PRINT_STAGE_V2')
   throw Error('印刷対象の版・ID・ステージ確定情報が不正です');
  const summary=entry.projection.rows?.['TAXIAPP_乗務一覧']?.[0];
  const details=entry.projection.rows?.['TAXIAPP_印刷データ'];
  if(!Array.isArray(summary)||summary.length!==19||
     summary[0]!==entry.id||!Array.isArray(details)||details.length>60||
     summary[7]!==details.length)
   throw Error('印刷対象の帳票集計行が不正です');
  seen.add(entry.id);
  const m=entry.id.match(/^shift-([0-9]+)/);
  return {...entry,order:Number(m[1]),source:summary};
 });
}
function previewSelector({committed=[],followLatest=false,b17='',c17=''}={}){
 const entries=assertEntries(committed);
 const labels=entries.map(e=>{
  const date=String(e.source[1]||'');
  // A label is for display only; a C17 string must never select a
  // different record than the independently resolved B17/follow-latest.
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('乗務日が不正です');
  const started=e.source[2];
  let clock='';
  if(started instanceof Date&&!Number.isNaN(started.getTime())){
   const parts=new Intl.DateTimeFormat('ja-JP',{
    timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
   }).format(started);
   clock=parts;
  }else if(started&&typeof started==='object'&&
    typeof started.__taxiappPrintDateUtc==='string'){
   const d=new Date(started.__taxiappPrintDateUtc);
   if(Number.isNaN(d.getTime()))throw Error('印刷日時が不正です');
   clock=new Intl.DateTimeFormat('ja-JP',{
    timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
   }).format(d);
  }else throw Error('印刷日時が未確認です');
  return {id:e.id,revision:e.revision,
   label:`${Number(date.slice(5,7))}/${Number(date.slice(8,10))} ${clock}出庫・営業${e.source[7]}件`,
   order:e.order,entry:e};
 });
 if(!labels.length)return {state:'no-committed-shifts',reason:'確定済みの印刷ステージがありません',
  printAuthorized:false,legacySwitchAuthorized:false};
 let winner=null;
 if(followLatest){
  const sorted=[...labels].sort((a,b)=>b.order-a.order||b.revision-a.revision);
  if(sorted.length>1&&sorted[0].order===sorted[1].order&&sorted[0].id!==sorted[1].id)
   throw Error('最新乗務の判定が曖昧です');
  winner=sorted[0];
 }else{
  if(typeof b17!=='string'||!b17.trim())
   return {state:'not-selected',reason:'B17の選択がありません',
    printAuthorized:false,legacySwitchAuthorized:false};
  const matching=labels.filter(x=>x.label===b17||x.id===b17);
  if(matching.length!==1)
   return {state:'not-selected',reason:matching.length?'同じ乗務表示が複数あります':'選択した乗務はありません',
    printAuthorized:false,legacySwitchAuthorized:false};
  winner=matching[0];
 }
 const derived=String(c17||'').trim(),staleDerived=Boolean(derived&&derived!==winner.id);
 const rows=winner.entry.projection.rows;
 if(Object.keys(rows||{}).length!==4)
  throw Error('印刷帳票に必要な4系統がそろっていません');
 return {state:'preview-only',selectedId:winner.id,revision:winner.revision,
  label:winner.label,source:'staged-v2',detailCount:rows['TAXIAPP_印刷データ'].length,
  paymentCount:rows['TAXIAPP_決済内訳'].length,
  aggregateCount:rows['TAXIAPP_集計'].length,
  page1Count:Math.min(36,rows['TAXIAPP_印刷データ'].length),
  page2Count:Math.max(0,rows['TAXIAPP_印刷データ'].length-36),
  staleDerived,printAuthorized:false,legacySwitchAuthorized:false,
  note:'B15/B17/C17を変更せず、旧Google原本と混在させない検証結果'};
}
module.exports=Object.freeze({previewSelector});
