'use strict';
/* Synthetic-only Apps Script staging contract test. No live Sheets connection. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'..','google-apps-script','PrintOnlyStageDraft.gs'),'utf8');
const production=fs.readFileSync(path.join(__dirname,'..','google-apps-script','Code.gs'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const boundUid='synthetic-admin-uid',id='shift-800-a';
const counts={lock:0,release:0,append:0};
let deniedLock=false;
const ctx={
 Utilities:{
  DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'UTF-8'},
  computeDigest:(_algorithm,text)=>[...crypto.createHash('sha256').update(text).digest()],
  formatDate:()=> '2026-10-21 12:00:00'
 },
 LockService:{getScriptLock:()=>({
  tryLock:()=>{counts.lock++;return !deniedLock;},
  releaseLock:()=>{counts.release++;}
 })},
 Date,JSON,Number,String,Math,Array,Object,Error,isFinite
};
vm.createContext(ctx);vm.runInContext(source,ctx);
const headers=Array.from(ctx.TAXIAPP_PRINT_STAGE_COLUMNS_V1);
function sheet(name=ctx.TAXIAPP_PRINT_STAGE_TAB_V1){
 let rows=[headers.slice()],corruptRead=false,failOnAppend=false;
 return {
  getName:()=>name,getLastRow:()=>rows.length,
  getRange:(r,c,height,width)=>({getValues:()=>{
   if(corruptRead&&r===rows.length&&r>1)return [['corrupted',0,'','','','']];
   return Array.from({length:height},(_,i)=>rows[r-1+i].slice(c-1,c-1+width));
  }}),
  appendRow:row=>{
   counts.append++;
   if(failOnAppend)throw Error('Synthetic append failed');
   rows.push(row.slice());
  },
  rows,
  setCorruptRead:v=>corruptRead=v,
  setFailOnAppend:v=>failOnAppend=v
 };
}
const clone=x=>JSON.parse(JSON.stringify(x));
const sourceShift={
 id,date:'2026-10-21',startedAt:'08:00',endedAt:'16:00',
 startedIso:'2026-10-21T08:00:00+09:00',endedIso:'2026-10-21T16:00:00+09:00',
 driver:'合成乗務員',vehicle:'111',startingOdo:'123',endingOdo:'200',
 driverNo:'sample-crew',
 settings:{secretConfig:'NEVER_SYNC'},
 privateGpsTrace:[{lat:999,long:999}],
 records:[
  {kind:'ride',status:'complete',
   raw:{A:1,E:'G',K:'1400',N:'現',G:'09:00',M:'09:15',AL:'合成乗車地',AM:'合成降車地',
    AQ:200,W:0,AI:0,AR:0, gpsPosition:'private-no-sync'},meta:{settledIso:'2026-10-21T09:15:00+09:00'},
   metaSecret:'never-store'},
  {kind:'cancel',status:'complete',raw:{A:2,E:'G',K:'700',C:'10:00',AL:'合成乗車地'},
   meta:{dispatchAt:'10:00',cancelAt:'10:05'}}
 ]
};
const totals={meter:1400,discount:0,goFee:200,uberSurcharge:0,cashRemittance:1600,
 etcRemittance:0,totalRemittance:1600,cancellation:0,realToll:0,emptyToll:0};
const make=(shift=sourceShift,rev=3,other={})=>({sourceUid:boundUid,sourceRevision:rev,
 packet:{kind:'TAXIAPP_SHIFT_V1',shift:clone(shift),summary:clone(totals)},...other});
const prepare=r=>ctx.printStagePrepareV1_(r);
const commit=(sheet,prepared,uid=boundUid)=>ctx.printStageAppendV1_(sheet,prepared,uid);
const prepared=prepare(make());
const original=JSON.stringify(sourceShift);
const p=JSON.parse(prepared.projectionJson);
assert.equal(p.format,'TAXIAPP_PRINT_PROJECTION_V1');
assert.equal(p.id,id);assert.equal(p.recordCount,2);
assert.equal(p.printRows[0].length,13,'source shift ID is stored once in the stage row');
assert.equal(p.printRows[1][2],'キャンセル');
assert.equal(p.printRows[1][3],0);
assert.equal(p.amounts.meter,1400);
assert.equal(p.amounts.goFee,200);
assert.equal(p.amounts.cancellation,0);
assert.equal(JSON.stringify(sourceShift),original,'prepare must not change source');
for(const forbidden of ['privateGpsTrace','gpsPosition','secretConfig','metaSecret','sourceUid','NEVER_SYNC'])
 assert.equal(prepared.projectionJson.includes(forbidden),false,'print-only data cannot leak '+forbidden);
assert.ok(prepared.transferId.length===64&&prepared.digest.length===64);
assert.ok(prepared.projectionJson.startsWith('{'),'cell must not begin with formula prefix');

const s=sheet();const before=counts.append;
assert.equal(commit(s,prepared).state,'staged');
assert.equal(s.rows.length,2);assert.equal(counts.append,before+1);
assert.equal(s.rows[1][0],id);assert.equal(s.rows[1][1],3);
assert.equal(s.rows[1][4],prepared.projectionJson);
const read=(stageSheet,shiftId=id,uid=boundUid)=>ctx.printStageReadLatestV1_(stageSheet,shiftId,uid);
assert.equal(read(s).revision,3);
assert.equal(read(s).projection.amounts.meter,1400);
assert.equal(read(s).projection.printRows[1][2],'キャンセル');
assert.equal(read(sheet()),null);
assert.equal(commit(s,prepared).state,'already-staged');
assert.equal(s.rows.length,2,'same transfer retries must not duplicate');
const wrongUid=sheet();assert.throws(()=>commit(wrongUid,prepared,'other-driver'),/UID/);
assert.equal(wrongUid.rows.length,1);
const wrongTab=sheet('TAXIAPP_同期原本');
assert.throws(()=>commit(wrongTab,prepared),/ステージ以外/);
assert.equal(wrongTab.rows.length,1,'legacy sync original cannot be modified');
assert.throws(()=>read(wrongTab),/ステージ以外/);
for(const tabName of ['TAXIAPP_印刷データ','TAXIAPP_乗務一覧','TAXIAPP_印刷操作','補助簿印刷用','補助簿印刷用_2頁']){
 assert.throws(()=>commit(sheet(tabName),prepared),/ステージ以外/);
}
const forged={...prepared,projectionJson:prepared.projectionJson.replace('1400','9999')};
assert.throws(()=>commit(sheet(),forged),/SHA256/);
const forgedId={...prepared,id:'shift-900-a'};
assert.throws(()=>commit(sheet(),forgedId),/SHA256/);
const forgedUid={...prepared,sourceUid:'other-driver'};
assert.throws(()=>commit(sheet(),forgedUid),/UID/);
const existingModified=sheet();existingModified.rows.push([id,3,'wrong-transfer',
 prepared.digest,prepared.projectionJson,'stamp']);
assert.throws(()=>commit(existingModified,prepared),/異なる印刷データ/);
const stale=prepare(make(sourceShift,2));
assert.throws(()=>commit(s,stale),/古い更新番号/);
const newVersion=prepare(make(sourceShift,4));
assert.equal(commit(s,newVersion).state,'staged');
assert.equal(s.rows.length,3);
assert.equal(read(s).revision,4,'latest immutable print revision must be selected');
assert.equal(commit(s,newVersion).state,'already-staged');
const duplicate=sheet();duplicate.rows.push(s.rows[1].slice(),s.rows[1].slice());
assert.throws(()=>commit(duplicate,prepared),/重複/);
const failed=sheet();failed.setFailOnAppend(true);
assert.throws(()=>commit(failed,prepared),/Synthetic append failed/);
assert.equal(failed.rows.length,1);
const readback=sheet();readback.setCorruptRead(true);
assert.throws(()=>commit(readback,prepared),/書いたデータを確認できません/);
readback.setCorruptRead(false);
assert.equal(commit(readback,prepared).state,'already-staged');
const corrupted=sheet();corrupted.rows.push(s.rows[1].slice());
corrupted.rows[1][4]=corrupted.rows[1][4].replace('1400','1401');
assert.throws(()=>read(corrupted),/改ざん/);
const foreign=sheet();foreign.rows.push(s.rows[1].slice());
assert.throws(()=>read(foreign,id,'other-driver'),/別人/);
const duplicateReader=sheet();duplicateReader.rows.push(s.rows[1].slice(),s.rows[1].slice());
assert.throws(()=>read(duplicateReader),/重複/);
const malformedProjection=sheet();malformedProjection.rows.push(s.rows[1].slice());
const invalid=JSON.parse(malformedProjection.rows[1][4]);
invalid.printRows[0].push('untrusted');
malformedProjection.rows[1][4]=JSON.stringify(invalid);
malformedProjection.rows[1][3]=ctx.printStageHashV1_(malformedProjection.rows[1][4]);
malformedProjection.rows[1][2]=ctx.printStageHashV1_([boundUid,id,3,malformedProjection.rows[1][3]].join('|'));
assert.throws(()=>read(malformedProjection),/明細/);
deniedLock=true;
assert.throws(()=>commit(sheet(),prepared),/排他ロック/);
deniedLock=false;
assert.equal(counts.lock-counts.release,1,'only refused locks remain unreleased');

for(const [item,error] of [
 [make({...sourceShift,endedAt:'',endedIso:''}),/入庫時刻/],
 [make({...sourceShift,records:Array(61).fill(sourceShift.records[0])}),/営業件数/],
 [make({...sourceShift,records:[{...sourceShift.records[0],status:'draft'}]}),/未確定/],
 [make({...sourceShift,records:[{...sourceShift.records[0],raw:{...sourceShift.records[0].raw,K:'-1'}}]}),/メーター/],
 [make(sourceShift,0),/更新番号/],
 [make(sourceShift,3,{sourceUid:'other-driver'}),null],
 [make(sourceShift,3,{packet:{kind:'unknown',shift:sourceShift,summary:totals}}),/パケット/],
 [make(sourceShift,3,{packet:{kind:'TAXIAPP_SHIFT_V1',shift:sourceShift,summary:{...totals,totalRemittance:1700}}}),/納金/],
 [make(sourceShift,3,{packet:{kind:'TAXIAPP_SHIFT_V1',shift:sourceShift,summary:{...totals,cancellation:700}}}),/キャンセル/]
 ]){
 if(error)assert.throws(()=>prepare(item),error);
 else assert.notEqual(prepare(item).sourceUid,boundUid);
}
assert.throws(()=>prepare(make({...sourceShift,records:[
 {...sourceShift.records[0],raw:{...sourceShift.records[0].raw,AL:'x'.repeat(10000)}}]})),/長すぎます/);
assert.equal(/action==='printStage'|action === 'printStage'/.test(production),false,
 'doPost must not route print stage');
assert.equal(/printStageAppendV1_|printStagePrepareV1_/.test(production),false,
 'production GAS stays untouched');
assert.equal(/PrintOnlyStageDraft|printStageAppendV1_|printStagePrepareV1_/.test(html),false,
 'production app must not invoke draft stage API');
console.log('Print-only GAS staging draft PASS: append-only, CAS/idempotency, UID/tab guard, errors, no legacy writes');
