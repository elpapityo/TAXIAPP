/**
 * TAXIAPP Print Stage V2 - ISOLATED, UNDEPLOYED Apps Script DRAFT.
 * Single NEW dedicated sheet only, never existing originals or print formulas.
 * No doPost, doGet, published URL or automatic UI connection is provided.
 * All calls must come from a trusted server verifying Firebase ID-token
 * signature/revocation, admin ACL and exact active Firestore revision.
 */
var TAXIAPP_PRINT_V2_TAB='TAXIAPP_印刷V2_ステージ';
var TAXIAPP_PRINT_V2_HEADERS=[
 '乗務ID','Firestore更新番号','転送ID','記録種別','分割番号',
 '分割総数','SHA256','ペイロード','記録時刻'];
var TAXIAPP_PRINT_V2_FORMAT='TAXIAPP_PRINT_STAGE_V2';
var TAXIAPP_PRINT_V2_ID=/^shift-[0-9]+(?:-[a-zA-Z0-9]+)?$/;
function printV2Hash_(text){
 if(typeof Utilities==='undefined'||!Utilities.computeDigest)
  throw Error('Apps Script SHA256が利用できません');
 return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
  String(text),Utilities.Charset.UTF_8).map(function(n){
   return ('0'+(n&255).toString(16)).slice(-2);
  }).join('');
}
function printV2TransferId_(uid,id,rev,digest){
 return printV2Hash_(['TAXIAPP_PRINT_V2',uid,id,rev,digest].join('|'));
}
function printV2AssertSheet_(sheet){
 if(!sheet||typeof sheet.getName!=='function'||
    sheet.getName()!==TAXIAPP_PRINT_V2_TAB)
  throw Error('印刷V2専用ステージ以外への書込み・参照は禁止です');
 if(sheet.getLastRow()<1)throw Error('V2ステージの見出しがありません');
 var header=sheet.getRange(1,1,1,9).getValues()[0];
 if(JSON.stringify(header)!==JSON.stringify(TAXIAPP_PRINT_V2_HEADERS))
  throw Error('V2ステージの見出しが一致しません');
}
function printV2Rows_(sheet){
 var last=sheet.getLastRow();
 return last<2?[]:sheet.getRange(2,1,last-1,9).getValues();
}
function printV2AssertPrepared_(p,uid){
 if(!p||p.format!==TAXIAPP_PRINT_V2_FORMAT||
    typeof uid!=='string'||!uid||
    p.sourceUid!==uid||!TAXIAPP_PRINT_V2_ID.test(String(p.id||''))||
    !Number.isSafeInteger(p.revision)||p.revision<1||
    !Number.isSafeInteger(p.expectedCommittedRevision)||p.expectedCommittedRevision<0||
    !Array.isArray(p.chunks)||!Array.isArray(p.chunkDigests)||
    p.count!==p.chunks.length||p.count!==p.chunkDigests.length||
    p.count<1||p.count>24)
  throw Error('本人UID・印刷V2転送情報が不正です');
 var json='';
 p.chunks.forEach(function(c,i){
  if(typeof c!=='string'||!c||c.length>24000||
     printV2Hash_(c)!==p.chunkDigests[i])
   throw Error('V2の分割データが破損しています');
  json+=c;
 });
 if(json.length!==p.length||json.length>400000||
    printV2Hash_(json)!==p.digest||
    printV2TransferId_(uid,p.id,p.revision,p.digest)!==p.transferId)
  throw Error('V2の転送SHA256と本人識別が一致しません');
 var parsed;
 try{parsed=JSON.parse(json);}catch(e){throw Error('V2の印刷JSONが不正です');}
 if(parsed.format!==TAXIAPP_PRINT_V2_FORMAT||parsed.id!==p.id||
    parsed.sourceRevision!==p.revision||
    !parsed.rows||typeof parsed.rows!=='object'||!parsed.headers||
    Object.keys(parsed.rows).length!==4)
  throw Error('V2の4帳票データが不正です');
 var widths={'TAXIAPP_乗務一覧':19,'TAXIAPP_印刷データ':14,
  'TAXIAPP_決済内訳':11,'TAXIAPP_集計':5};
 Object.keys(widths).forEach(function(name){
  var rows=parsed.rows[name];
  if(!Array.isArray(rows)||!Array.isArray(parsed.headers[name])||
     parsed.headers[name].length!==widths[name]||
     rows.some(function(row){return !Array.isArray(row)||
       row.length!==widths[name]||row[0]!==p.id;}))
   throw Error('V2 '+name+' の列数・IDが不正です');
 });
 if(parsed.rows['TAXIAPP_乗務一覧'].length!==1||
    parsed.rows['TAXIAPP_印刷データ'].length>60||
    parsed.rows['TAXIAPP_集計'].length!==14)
  throw Error('V2の営業・集計行数が不正です');
 return json;
}
function printV2Committed_(rows,id){
 return rows.filter(function(r){return String(r[0])===id&&r[3]==='COMMIT';});
}
function printV2ReadOne_(rows,id,revision,uid){
 var committed=printV2Committed_(rows,id).filter(function(r){
  return Number(r[1])===revision;
 });
 if(committed.length!==1)throw Error('V2更新番号の確定行が不足・重複しています');
 var marker=committed[0],transfer=String(marker[2]),count=Number(marker[5]);
 var digest=String(marker[6]),size=Number(marker[7]);
 if(!Number.isSafeInteger(count)||count<1||count>24||
    !Number.isSafeInteger(size)||size<1||size>400000||
    printV2TransferId_(uid,id,revision,digest)!==transfer)
  throw Error('V2確定行の本人UID・SHA256が不正です');
 var chunks=rows.filter(function(row){
  return String(row[0])===id&&Number(row[1])===revision&&
    row[3]==='CHUNK'&&row[2]===transfer;
 });
 if(chunks.length!==count)throw Error('V2印刷データの分割行が不足・重複しています');
 var parts={};
 chunks.forEach(function(row){
  var part=Number(row[4]),total=Number(row[5]),body=String(row[7]||'');
  if(!Number.isSafeInteger(part)||part<1||part>count||total!==count||
     Object.prototype.hasOwnProperty.call(parts,part)||
     !body||body.length>24000||printV2Hash_(body)!==row[6])
   throw Error('V2印刷データが破損・重複しています');
  parts[part]=body;
 });
 var json=Array.from({length:count},function(_,i){return parts[i+1];}).join('');
 if(json.length!==size||printV2Hash_(json)!==digest)
  throw Error('V2印刷データの全体SHA256が不正です');
 var p;
 try{p=JSON.parse(json);}catch(e){throw Error('V2の確定済みJSONが不正です');}
 if(p.format!==TAXIAPP_PRINT_V2_FORMAT||p.id!==id||
    p.sourceRevision!==revision||
    !p.rows||Object.keys(p.rows).length!==4)
  throw Error('V2確定データの原本ID・形式が不正です');
 return {id:id,revision:revision,transferId:transfer,digest:digest,
  projection:p,printAuthorized:false};
}
/** INTERNAL ONLY: never accept verifiedAdminUid as a client-supplied value. */
function printV2AppendDraft_(sheet,prepared,verifiedAdminUid){
 printV2AssertSheet_(sheet);
 printV2AssertPrepared_(prepared,verifiedAdminUid);
 if(typeof LockService==='undefined'||!LockService.getScriptLock)
  throw Error('サーバー側排他ロックが利用できません');
 var lock=LockService.getScriptLock();
 if(!lock.tryLock(25000))throw Error('V2印刷ステージの排他ロックを取得できません');
 try{
  var rows=printV2Rows_(sheet),id=prepared.id,rev=prepared.revision;
  var commits=printV2Committed_(rows,id);
  var latest=commits.reduce(function(max,r){
   var n=Number(r[1]);
   if(!Number.isSafeInteger(n)||n<1)
    throw Error('V2保存済み版番号が不正です');
   return Math.max(n,max);
  },0);
  if(latest>rev)throw Error('旧版からの再送はできません');
  if(commits.filter(function(r){return Number(r[1])===rev;}).length){
   var already=printV2ReadOne_(rows,id,rev,verifiedAdminUid);
   if(already.transferId!==prepared.transferId||
      already.digest!==prepared.digest)
    throw Error('同じ更新番号の印刷データが異なります');
   return {state:'already-staged',id:id,revision:rev,printAuthorized:false};
  }
  if(latest!==prepared.expectedCommittedRevision)
   throw Error('印刷V2ステージの更新番号が変わりました。CAS_CONFLICT');
  // Incomplete rows of a failed attempt must be verified then resumed,
  // never removed or overwritten. An inconsistent orphan requires review.
  var orphan=rows.filter(function(r){
   return String(r[0])===id&&Number(r[1])===rev&&r[3]==='CHUNK';
  });
  if(orphan.some(function(r){return r[2]!==prepared.transferId}))
   throw Error('別内容の未確定V2データが残っています');
  var existing={};
  orphan.forEach(function(row){
   var part=Number(row[4]),total=Number(row[5]);
   if(!Number.isSafeInteger(part)||part<1||part>prepared.count||
      total!==prepared.count||existing[part]||
      row[6]!==prepared.chunkDigests[part-1]||
      row[7]!==prepared.chunks[part-1])
    throw Error('未確定の分割データが不一致です');
   existing[part]=true;
  });
  var stamp=(typeof Utilities!=='undefined'&&Utilities.formatDate)?
   Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd HH:mm:ss'):
   new Date().toISOString();
  for(var part=1;part<=prepared.count;part++){
   if(existing[part])continue;
   var row=[id,rev,prepared.transferId,'CHUNK',part,prepared.count,
    prepared.chunkDigests[part-1],prepared.chunks[part-1],stamp];
   sheet.appendRow(row);
   var check=sheet.getRange(sheet.getLastRow(),1,1,9).getValues()[0];
   if(JSON.stringify(check)!==JSON.stringify(row))
    throw Error('V2分割データの書込確認が取れません');
  }
  // COMMIT is the ONLY validity marker. Failed partial chunk writes remain
  // non-printable and can safely resume on identical transfer retry.
  var marker=[id,rev,prepared.transferId,'COMMIT',0,prepared.count,
   prepared.digest,prepared.length,stamp];
  sheet.appendRow(marker);
  var check=sheet.getRange(sheet.getLastRow(),1,1,9).getValues()[0];
  if(JSON.stringify(check)!==JSON.stringify(marker))
   throw Error('V2印刷データの確定行の書込確認が取れません');
  var read=printV2ReadOne_(printV2Rows_(sheet),id,rev,verifiedAdminUid);
  if(read.digest!==prepared.digest)throw Error('V2読戻しSHA256が不一致です');
  return {state:'staged',id:id,revision:rev,printAuthorized:false};
 }finally{lock.releaseLock();}
}
/** INTERNAL ONLY: isolated read. No official print source is changed. */
function printV2ReadLatestDraft_(sheet,id,verifiedAdminUid){
 printV2AssertSheet_(sheet);
 if(!TAXIAPP_PRINT_V2_ID.test(String(id||''))||
    typeof verifiedAdminUid!=='string'||!verifiedAdminUid)
  throw Error('V2本人UIDまたは乗務IDが不正です');
 var rows=printV2Rows_(sheet);
 var commits=printV2Committed_(rows,id);
 if(!commits.length)return null;
 var revisions={};
 commits.forEach(function(r){
  if(!Number.isSafeInteger(Number(r[1]))||Number(r[1])<1||
     revisions[r[1]])
   throw Error('V2確定版番号が重複・不正です');
  revisions[r[1]]=true;
 });
 var latest=Math.max.apply(null,commits.map(function(r){return Number(r[1]);}));
 return printV2ReadOne_(rows,id,latest,verifiedAdminUid);
}
