/* TAXIAPP administrator Firestore -> legacy print compatibility PREVIEW.
 * Does not make network requests or write any diary, Google Sheet, or Firebase.
 * Packet format is the existing googleShiftPacket() contract; NEVER call
 * syncPut or savePacket_ as "print only": those also mutate legacy originals.
 */
(function(root){
'use strict';
const ID=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
const MAX_RECORDS=60,MAX_PACKET_LENGTH=650000,MAX_ORIGINAL_LENGTH=600000;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const canonical=value=>JSON.stringify(value,(_key,item)=>
 item&&typeof item==='object'&&!Array.isArray(item)?
  Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
const identical=(a,b)=>canonical(a)===canonical(b);
function mapShifts(rows,label){
 if(!Array.isArray(rows))throw Error(label+'の照合データがありません');
 const result=new Map();
 for(const row of rows){
  if(!row||typeof row.id!=='string'||!ID.test(row.id)||
     result.has(row.id)||!Array.isArray(row.records)||
     !row.settings||typeof row.settings!=='object'||Array.isArray(row.settings))
   throw Error(label+'の乗務IDまたは原本形式が不正です');
  result.set(row.id,row);
 }
 return result;
}
function inspect({uid,cloudUid,localShifts,googleShifts=null,cloudShifts=null,
 cloudRevisions=null,selectedIds,packetFactory,cutover=null}={}){
 if(typeof uid!=='string'||!uid||uid!==cloudUid)
  throw Error('管理者本人UIDの照合が一致しません');
 if(!Array.isArray(selectedIds)||selectedIds.length!==1||
    !ID.test(String(selectedIds[0]||'')))
  return {state:'select-one',selectedCount:Array.isArray(selectedIds)?selectedIds.length:0,
   writeAuthorized:false,cutoverAuthorized:false,printAuthorized:false,
   reasons:['印刷用の確認対象は、端末内の日報から1件だけ選択してください']};
 const id=selectedIds[0],reasons=[];
 const local=mapShifts(localShifts,'端末'),source=local.get(id);
 if(!source)throw Error('選択した端末の日報がありません');
 const cloud=cloudShifts===null?null:mapShifts(cloudShifts,'本人Firebase');
 const google=googleShifts===null?null:mapShifts(googleShifts,'Google同期原本');
 if(!cloud)reasons.push('本人Firebase原本が未照合です');
 if(!google)reasons.push('Google同期原本が未照合です');
 const remote=cloud?.get(id);
 const old=google?.get(id);
 if(cloud&&!remote)reasons.push('本人Firebaseに選択した日報がありません');
 if(google&&!old)reasons.push('Google同期原本に選択した日報がありません');
 if(remote&&!identical(source,remote))reasons.push('端末とFirebase原本の内容が一致しません');
 if(remote&&old&&!identical(remote,old))reasons.push('Firebase原本とGoogle同期原本の内容が一致しません');
 const revision=cloudRevisions&&own(cloudRevisions,id)?cloudRevisions[id]:null;
 if(!Number.isSafeInteger(revision)||revision<1)
  reasons.push('Firebase原本の更新番号が検証されていません');
 const candidate=remote;
 if(candidate){
  if(!candidate.endedAt&&!candidate.endedIso)reasons.push('未入庫の日報は印刷対象にできません');
  if(candidate.records.length>MAX_RECORDS)reasons.push('営業記録が60件を超えています');
  if(candidate.records.some(r=>!r||!r.raw||!['complete','cancelled'].includes(r.status)))
   reasons.push('未精算・不正な営業記録が含まれています');
  if(typeof candidate.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(candidate.date))
   reasons.push('乗務日の形式が不正です');
  for(const group of [cloud,google]){
   if(!group)continue;
   const base=cutover?.interval?.(candidate);
   if(base?.reason){reasons.push(base.reason);break;}
   const intersects=[...group.values()].some(other=>other.id!==id&&
    cutover?.overlaps?.(base,cutover.interval(other)));
   if(intersects)reasons.push('別の日報IDとの乗務時間重複を確認してください');
  }
 }
 let summary=null,packetLength=0;
 if(candidate&&typeof packetFactory==='function'&&
    !reasons.some(x=>x.includes('未入庫')||x.includes('未精算')||x.includes('60件')||x.includes('乗務日'))){
  try{
   const copy=JSON.parse(JSON.stringify(candidate));
   const packet=packetFactory(copy);
   const json=JSON.stringify(packet);
   if(packet?.kind!=='TAXIAPP_SHIFT_V1'||packet.shift?.id!==id||
      !Array.isArray(packet.shift.records)||!packet.summary||!json)
    throw Error('従来の印刷受信形式ではありません');
   packetLength=json.length;
   if(packetLength>MAX_PACKET_LENGTH||
      JSON.stringify(packet.shift).length>MAX_ORIGINAL_LENGTH)
    throw Error('既存Apps Scriptの原本分割・送信サイズ上限を超えます');
   const total=packet.summary;
   for(const key of ['meter','goFee','uberSurcharge','discount',
    'cashRemittance','etcRemittance','totalRemittance','cancellation']){
    if(!Number.isFinite(total[key])||!Number.isInteger(total[key]))
     throw Error('印刷用集計金額が不正です：'+key);
   }
   const meter=packet.shift.records.filter(r=>
    r.kind==='ride'&&r.status==='complete')
    .reduce((sum,r)=>sum+Number(r.raw?.K),0);
   if(!Number.isFinite(meter)||meter!==total.meter)
    throw Error('原本の実車メーター合計と印刷用集計が一致しません');
   if(total.cancellation!==0)
    throw Error('キャンセル料が0円になっていません');
   if(total.totalRemittance!==total.cashRemittance+total.etcRemittance)
    throw Error('現金納金とETCの合計が一致しません');
   // GAS print uses the completed cancellation as zero, despite old raw K.
   summary={recordCount:packet.shift.records.length,meter:total.meter,
    cashRemittance:total.cashRemittance,etcRemittance:total.etcRemittance,
    totalRemittance:total.totalRemittance,goFee:total.goFee,
    uberSurcharge:total.uberSurcharge,cancellation:total.cancellation};
   if(!identical(copy,candidate))throw Error('印刷用変換がFirebase原本を変更しました');
  }catch(e){reasons.push('印刷用データ形式の検証失敗：'+String(e?.message||e));}
 }else if(candidate&&typeof packetFactory!=='function'){
  reasons.push('従来の印刷用データ変換を確認できません');
 }
 const status=reasons.length?'review':'format-checked';
 // Absolutely no packet/ride/customer/GPS details leave this helper.
 return {state:status,id,uid,sourceRevision:revision,selectedCount:1,
  packetLength,summary,reasons,
  sourcesCompared:Boolean(cloud&&google),
  legacySheetsWriteWouldChangeOriginals:true,
  printSheetLiveVerified:false,writeAuthorized:false,
  printAuthorized:false,cutoverAuthorized:false};
}
root.TAXIAPP_ADMIN_PRINT_PREFLIGHT=Object.freeze({inspect});
})(typeof window!=='undefined'?window:globalThis);
