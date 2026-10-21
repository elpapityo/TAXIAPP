'use strict';
/**
 * STAGE 8: pure, isolated four-source print projection transport V2.
 * Not a production route. No Sheet, Firestore or diary writes.
 * The trusted server must construct 'virtual' from its own Firestore read.
 */
const {createHash}=require('node:crypto');
const {COLUMNS}=require('./print-stage-legacy-rows.js');
const ID=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
const FORMAT='TAXIAPP_PRINT_STAGE_V2';
const DEFAULT_CHUNK_SIZE=20000,MAX_CHUNKS=24,MAX_LENGTH=400000;
const sha=x=>createHash('sha256').update(x,'utf8').digest('hex');
const digestFor=(uid,id,revision,hash)=>
 sha(['TAXIAPP_PRINT_V2',uid,id,revision,hash].join('|'));
const validateInteger=(x,min,label)=>{
 if(!Number.isSafeInteger(x)||x<min)throw Error(label+'が不正です');
 return x;
};
function normalizeCell(v){
 if(v instanceof Date){
  if(!Number.isFinite(v.getTime()))throw Error('日時が不正です');
  return {__taxiappPrintDateUtc:v.toISOString()};
 }
 if(v===null||v===undefined)return '';
 if(typeof v==='string'){
  if(v.length>1000)throw Error('印刷セルの文字数が多すぎます');
  if(/^[=+@]/.test(v))throw Error('印刷セルの数式注入を拒否しました');
  return v;
 }
 if(typeof v==='number'&&Number.isFinite(v))return v;
 if(typeof v==='boolean')return v;
 throw Error('印刷セルのデータ型が不正です');
}
function validateProjection(virtual){
 if(virtual?.format!=='TAXIAPP_LEGACY_PRINT_VIRTUAL_ROWS_V1'||
    !ID.test(String(virtual.id||''))||
    !Number.isSafeInteger(virtual.sourceRevision)||virtual.sourceRevision<1||
    virtual.records>60||!Number.isSafeInteger(virtual.records)||
    virtual.records<0||!virtual.rows||typeof virtual.rows!=='object')
  throw Error('印刷派生データの形式が不正です');
 const expected=Object.keys(COLUMNS);
 if(Object.keys(virtual.rows).length!==expected.length||
    expected.some(k=>!Object.hasOwn(virtual.rows,k)))
  throw Error('印刷に必要な4種類のデータがそろっていません');
 const rows={};
 for(const name of expected){
  const data=virtual.rows[name];
  const width=COLUMNS[name].length;
  if(!Array.isArray(data)||data.length>1200||
     data.some(r=>!Array.isArray(r)||r.length!==width||r[0]!==virtual.id))
   throw Error(name+'の行数・列数・乗務IDが不正です');
  rows[name]=data.map(r=>r.map(normalizeCell));
 }
 if(rows['TAXIAPP_乗務一覧'].length!==1||
    rows['TAXIAPP_印刷データ'].length!==virtual.records||
    rows['TAXIAPP_決済内訳'].length>1200||
    rows['TAXIAPP_集計'].length!==14)
  throw Error('印刷の行数または集計数が一致しません');
 if(rows['TAXIAPP_乗務一覧'][0][8]!==virtual.meter||
    rows['TAXIAPP_乗務一覧'][0][7]!==virtual.records)
  throw Error('乗務一覧の売上・件数が一致しません');
 if(rows['TAXIAPP_印刷データ'].filter(r=>r[3]==='キャンセル').some(r=>r[4]!==0))
  throw Error('キャンセル行の印刷金額が0円ではありません');
 return rows;
}
function prepareV2({sourceUid,sourceRevision,expectedCommittedRevision,
 virtual,chunkSize=DEFAULT_CHUNK_SIZE}={}){
 if(typeof sourceUid!=='string'||!sourceUid.trim()||sourceUid.length>128)
  throw Error('管理者UIDが不正です');
 validateInteger(sourceRevision,1,'Firestore更新番号');
 validateInteger(expectedCommittedRevision,0,'ステージ期待版');
 if(virtual?.sourceRevision!==sourceRevision)
  throw Error('Firestore原本と印刷派生データの更新番号が違います');
 validateInteger(chunkSize,1,'分割サイズ');
 if(chunkSize>24000)throw Error('分割サイズが大きすぎます');
 const rows=validateProjection(virtual);
 const document={format:FORMAT,id:virtual.id,sourceRevision,
  headers:Object.fromEntries(Object.entries(COLUMNS).map(([k,v])=>[k,[...v]])),
  rows};
 const json=JSON.stringify(document);
 if(json.length>MAX_LENGTH)throw Error('印刷派生データの全体サイズを超えました');
 const chunks=[];
 for(let i=0;i<json.length;i+=chunkSize)chunks.push(json.slice(i,i+chunkSize));
 if(chunks.length<1||chunks.length>MAX_CHUNKS)
  throw Error('印刷データの分割数上限を超えています');
 const digest=sha(json),transferId=digestFor(sourceUid,virtual.id,sourceRevision,digest);
 return Object.freeze({format:FORMAT,id:virtual.id,sourceUid,
  revision:sourceRevision,expectedCommittedRevision,transferId,digest,
  length:json.length,chunks,chunkDigests:chunks.map(sha),
  count:chunks.length});
}
function decodeV2(prepared,verifiedUid){
 if(!prepared||prepared.format!==FORMAT||prepared.sourceUid!==verifiedUid||
    typeof verifiedUid!=='string'||!verifiedUid||
    !ID.test(String(prepared.id||'')))
  throw Error('印刷ステージの形式・本人UIDが不正です');
 validateInteger(prepared.revision,1,'印刷版');
 validateInteger(prepared.expectedCommittedRevision,0,'ステージ期待版');
 if(!Array.isArray(prepared.chunks)||!Array.isArray(prepared.chunkDigests)||
    prepared.chunks.length===0||prepared.chunks.length>MAX_CHUNKS||
    prepared.count!==prepared.chunks.length||
    prepared.chunkDigests.length!==prepared.chunks.length||
    prepared.chunks.some((c,i)=>typeof c!=='string'||c.length>24000||
      sha(c)!==prepared.chunkDigests[i]))
  throw Error('印刷データの分割構造・SHA256が不正です');
 const json=prepared.chunks.join('');
 if(json.length!==prepared.length||json.length>MAX_LENGTH||
    sha(json)!==prepared.digest||
    digestFor(verifiedUid,prepared.id,prepared.revision,prepared.digest)!==prepared.transferId)
  throw Error('印刷データのSHA256・転送IDが一致しません');
 let doc;
 try{doc=JSON.parse(json);}catch{throw Error('印刷派生JSONが不正です');}
 if(doc.format!==FORMAT||doc.id!==prepared.id||
    doc.sourceRevision!==prepared.revision)
  throw Error('印刷派生データの乗務ID・版が不正です');
 for(const [name,columns] of Object.entries(COLUMNS)){
  if(JSON.stringify(doc.headers?.[name])!==JSON.stringify(columns)||
     !Array.isArray(doc.rows?.[name])||
     doc.rows[name].some(r=>!Array.isArray(r)||r.length!==columns.length||
       r[0]!==prepared.id))
   throw Error(name+'の帳票列が一致しません');
 }
 const denormalize=x=>{
  if(x&&typeof x==='object'&&!Array.isArray(x)&&
     Object.keys(x).length===1&&typeof x.__taxiappPrintDateUtc==='string'){
   const d=new Date(x.__taxiappPrintDateUtc);
   if(!Number.isFinite(d.getTime())||d.toISOString()!==x.__taxiappPrintDateUtc)
    throw Error('印刷用日時が不正です');
   return d;
  }
  return x;
 };
 const rows=Object.fromEntries(Object.entries(doc.rows).map(([k,arr])=>[
  k,arr.map(row=>row.map(denormalize))]));
 return {id:prepared.id,revision:prepared.revision,
  rows,headers:doc.headers,
  // Never returned as an approved printable document.
  printAuthorized:false,sourceVerified:false};
}
module.exports=Object.freeze({prepareV2,decodeV2,FORMAT,COLUMNS});
