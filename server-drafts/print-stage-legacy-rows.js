'use strict';
/**
 * Stage 7: PURE (zero I/O) print-sheet compatibility projection.
 *
 * These rows are NOT live spreadsheet writes, not a print authorization, and
 * not a new snapshot/source of truth. Data comes only from a trusted
 * Firestore-loaded, server-built TAXIAPP_SHIFT_V1 packet.
 *
 * Existing spreadsheet print formulas depend on 乗務一覧, 印刷データ,
 * 決済内訳 and 集計. Stage-6 V1 omits the latter two; do not print V1 alone.
 */
const ID=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
const SUM_KEYS=['meter','discount','goFee','uberSurcharge','cashRemittance',
 'etcRemittance','totalRemittance','realToll','emptyToll','cancellation','tip',
 'reservation','cashReceived','paymentAllocated'];
const COLUMNS=Object.freeze({
 'TAXIAPP_乗務一覧':Object.freeze(['乗務ID','乗務日','出庫日時','入庫日時','運転者','社員番号','車両番号','営業件数','メーター売上','障がい者割引','GO手数料','Uber配車手数料','現金納金','ETC','総入金額','更新日時','転送状態','出庫km','入庫km']),
 'TAXIAPP_印刷データ':Object.freeze(['乗務ID','営業番号','配車区分','支払表示','表示金額','乗車時刻','降車時刻','乗車地','降車地','GO手数料確認','実車高速','空車高速','障がい者割引','精算完了日時']),
 'TAXIAPP_決済内訳':Object.freeze(['乗務ID','営業番号','決済内訳番号','支払金種','支払金額','アプリ決済額','現金受取','高速料金','割引額','手数料','備考']),
 'TAXIAPP_集計':Object.freeze(['乗務ID','種類','金額','計算根拠','更新日時'])
});
const numeric=(value,label)=>{
 if(value===''||value===null||value===undefined)return 0;
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<0)throw Error(label+'の金額が不正です');
 return n;
};
const copy=x=>JSON.parse(JSON.stringify(x));
const timestamp=(iso,day,clock)=>{
 // Match Code.gs shiftTimestamp_ so the existing print formulas receive
 // native Sheets Date cells rather than ISO strings with double JST offsets.
 if(iso){
  const d=new Date(String(iso));
  if(Number.isFinite(d.getTime()))return d;
 }
 if(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(day||''))&&
    /^[0-9]{1,2}:[0-9]{2}/.test(String(clock||''))){
  const [year,month,date]=day.split('-').map(Number);
  const [hour,minute,second]=clock.split(':').map(Number);
  return new Date(Date.UTC(year,month-1,date,hour-9,minute,second||0));
 }
 return '';
};
// Keep the same spreadsheet-formula injection protection as Code.gs safeCell_.
const safeCell=item=>typeof item==='string'&&/^[=+@]/.test(item)?"'"+item:item;
function projectTrustedPacket({packet,sourceRevision}={}){
 const shift=packet?.shift,sum=packet?.summary;
 if(!packet||packet.kind!=='TAXIAPP_SHIFT_V1'||!shift||!ID.test(String(shift.id||''))||
    !Array.isArray(shift.records)||shift.records.length>60||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(shift.date||''))||
    (!shift.endedAt&&!shift.endedIso)||!sum||
    !Number.isSafeInteger(sourceRevision)||sourceRevision<1)
  throw Error('印刷対象原本・更新番号が不正です');
 const totals=Object.fromEntries(SUM_KEYS.map(k=>[k,numeric(sum[k],k)]));
 if(totals.cancellation!==0||
    totals.totalRemittance!==totals.cashRemittance+totals.etcRemittance)
  throw Error('キャンセル料または納金合計が不正です');
 const id=shift.id,detail=[],payments=[],revenue=[];
 let meter=0;
 for(const [i,record] of shift.records.entries()){
  if(!record||!record.raw||record.status!=='complete'||
     !['ride','cancel','empty'].includes(record.kind))
   throw Error('未確定または不正な乗車記録があります：'+(i+1));
  const raw=record.raw,meta=record.meta||{};
  const number=raw.A||'',cancel=record.kind==='cancel';
  if(record.kind==='ride')meter+=numeric(raw.K,'メーター');
  const detailRow=[id,number,raw.E||'',
   cancel?'キャンセル':raw.N||'',cancel?0:raw.K||'',
   cancel?(meta.dispatchAt||raw.C||''):(raw.G||''),
   cancel?(meta.cancelAt||''):(raw.M||''),
   raw.AL||'',raw.AM||'',raw.AQ||'',raw.W||'',raw.AI||'',raw.AR||'',
   meta.settledIso||''];
  detail.push(detailRow);
  if(!Array.isArray(record.payments||[]))throw Error('決済内訳が配列ではありません');
  (record.payments||[]).forEach((p,j)=>{
   if(record.kind!=='ride')throw Error('乗車以外に決済内訳があります');
   const received=numeric(p?.received,'受取金額'),company=numeric(p?.company,'会社納金');
   if(company>received)throw Error('会社納金が受取金額を超えています');
   const ptype=p?.type;
   if(typeof ptype!=='string'||!ptype||ptype.length>80)
    throw Error('支払金種が不正です');
   payments.push([id,number,j+1,ptype,received,ptype==='U'?received:'',
    ptype==='現'?received:'',numeric(raw.W,'高速料金'),
    numeric(raw.AR,'割引額'),received-company,
    ptype===raw.N?'主金種':'複合決済']);
  });
 }
 if(totals.meter!==meter)throw Error('印刷明細のメーター売上が一致しません');
 for(const k of SUM_KEYS)revenue.push([id,k,totals[k],'TAXIAPP 計算済み','']);
 const summary=[[id,shift.date,
  timestamp(shift.startedIso,shift.date,shift.startedAt),
  timestamp(shift.endedIso,shift.date,shift.endedAt),
  shift.driver||'',shift.driverNo||'',
  shift.vehicle||'',shift.records.length,totals.meter,totals.discount,
  totals.goFee,totals.uberSurcharge,totals.cashRemittance,
  totals.etcRemittance,totals.totalRemittance,'','印刷派生候補',
  shift.startingOdo||'',shift.endingOdo||'']];
 const rows={
  'TAXIAPP_乗務一覧':summary,'TAXIAPP_印刷データ':detail,
  'TAXIAPP_決済内訳':payments,'TAXIAPP_集計':revenue
 };
 for(const [name,values] of Object.entries(rows)){
  const width=COLUMNS[name].length;
  if(values.some(r=>r.length!==width))throw Error(name+'の列数が不正です');
  rows[name]=values.map(row=>row.map(safeCell));
 }
 return Object.freeze({
  format:'TAXIAPP_LEGACY_PRINT_VIRTUAL_ROWS_V1',
  id,sourceRevision,
  headers:COLUMNS,
  rows:Object.fromEntries(Object.entries(rows).map(([name,data])=>[
   name,data.map(line=>line.map(cell=>cell instanceof Date?new Date(cell):cell))])),
  pages:[copy(detail.slice(0,36)),copy(detail.slice(36,60))],
  meter:totals.meter,records:detail.length,
  sourceSheetsRequired:Object.keys(COLUMNS),
  stage6ProjectionHasAllSources:false,
  legacySelectorRequiresMigration:true,
  writeAuthorized:false,printAuthorized:false,cutoverAuthorized:false
 });
}
module.exports=Object.freeze({projectTrustedPacket,COLUMNS,SUM_KEYS});
