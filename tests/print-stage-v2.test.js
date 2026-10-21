'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),
 vm=require('node:vm'),crypto=require('node:crypto');
const {projectTrustedPacket,COLUMNS}=require('../server-drafts/print-stage-legacy-rows.js');
const {prepareV2,decodeV2,FORMAT}=require('../server-drafts/print-stage-v2.js');
const {previewSelector}=require('../server-drafts/print-stage-v2-selection.js');
const code=fs.readFileSync(path.join(__dirname,'..','google-apps-script','Code.gs'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'..','google-apps-script','PrintOnlyStageV2Draft.gs'),'utf8');
const uid='synthetic-admin',id='shift-9001-a';
const clone=x=>JSON.parse(JSON.stringify(x));
const shift={id,date:'2026-10-21',startedAt:'08:15',endedAt:'18:30',
 startedIso:'2026-10-20T23:15:00.000Z',endedIso:'2026-10-21T09:30:00.000Z',
 driver:'試験用',records:[],settings:{secret:'NEVER-PRINT'},gpsLocations:[{lat:99,long:99}]};
for(let i=1;i<=60;i++){
 const raw={A:i,E:'G',N:'現',K:1000,AL:i===1?'=IMPORTRANGE(A1)':'合成地点',AM:'合成到着地',
  G:'08:20',M:'08:30',AQ:200,W:0,AI:0,AR:0};
 shift.records.push({kind:'ride',status:'complete',raw,payments:[
  {type:'現',received:700,company:700},{type:'QR',received:500,company:500}
 ],meta:{}});
}
const totals={meter:60000,discount:0,goFee:12000,uberSurcharge:0,cashRemittance:42000,
 etcRemittance:0,totalRemittance:42000,realToll:0,emptyToll:0,cancellation:0,
 tip:0,reservation:0,cashReceived:42000,paymentAllocated:72000};
const original=JSON.stringify(shift),packet={kind:'TAXIAPP_SHIFT_V1',shift:clone(shift),summary:totals};
const virtual=projectTrustedPacket({packet,sourceRevision:4});
assert.equal(virtual.pages[0].length,36);
assert.equal(virtual.pages[1].length,24);
const prepared=prepareV2({sourceUid:uid,sourceRevision:4,expectedCommittedRevision:0,
 virtual,chunkSize:4000});
assert.equal(prepared.format,FORMAT);
assert.ok(prepared.count>1,'large 60 ride duty should split into multiple chunks');
assert.ok(prepared.count<=24);
const decoded=decodeV2(prepared,uid);
assert.equal(decoded.rows['TAXIAPP_印刷データ'].length,60);
assert.equal(decoded.rows['TAXIAPP_決済内訳'].length,120);
assert.equal(decoded.rows['TAXIAPP_集計'].length,14);
assert.equal(decoded.rows['TAXIAPP_乗務一覧'][0][2].toISOString(),'2026-10-20T23:15:00.000Z');
assert.equal(decoded.rows['TAXIAPP_印刷データ'][0][7],"'=IMPORTRANGE(A1)");
assert.equal(decoded.printAuthorized,false);
assert.equal(JSON.stringify(shift),original,'source Firestore object must not be changed');
assert.equal(prepared.chunks.join('').includes('NEVER-PRINT'),false);
assert.equal(prepared.chunks.join('').includes('gpsLocations'),false);
assert.throws(()=>decodeV2(prepared,'another-user'),/UID/);
const altered={...prepared,chunks:[...prepared.chunks]};
altered.chunks[0]=altered.chunks[0].replace('TAXIAPP_','TAXIAPPX');
assert.throws(()=>decodeV2(altered,uid),/SHA256/);
const missing={...prepared,chunks:prepared.chunks.slice(1)};
assert.throws(()=>decodeV2(missing,uid),/分割/);
const wrongRev={...prepared,revision:3};
assert.throws(()=>decodeV2(wrongRev,uid),/SHA256|転送ID/);
const wrongExpected={...prepared,expectedCommittedRevision:-1};
assert.throws(()=>decodeV2(wrongExpected,uid),/期待版/);
const missingData=clone(virtual);
delete missingData.rows['TAXIAPP_決済内訳'];
assert.throws(()=>prepareV2({sourceUid:uid,sourceRevision:4,expectedCommittedRevision:0,
 virtual:missingData}),/4種類/);
const wrongRow=clone(virtual);
wrongRow.rows['TAXIAPP_印刷データ'][0][0]='shift-123-a';
assert.throws(()=>prepareV2({sourceUid:uid,sourceRevision:4,expectedCommittedRevision:0,
 virtual:wrongRow}),/行数・列数・乗務ID/);
const copied=clone(virtual);
copied.rows['TAXIAPP_印刷データ'][0][7]='=IMPORTXML(A1)';
assert.throws(()=>prepareV2({sourceUid:uid,sourceRevision:4,expectedCommittedRevision:0,
 virtual:copied}),/数式注入/);
const badSum=clone(virtual);
badSum.rows['TAXIAPP_乗務一覧'][0][8]=1;
assert.throws(()=>prepareV2({sourceUid:uid,sourceRevision:4,expectedCommittedRevision:0,
 virtual:badSum}),/売上・件数/);
let calls=0,failAt=0,damageRead=false,lockAllowed=true;
const ctx={Utilities:{
 DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'UTF-8'},
 computeDigest:(_algorithm,text)=>[...crypto.createHash('sha256').update(text).digest()],
 formatDate:()=> '2026-10-21 19:00:00'},
 LockService:{getScriptLock:()=>({tryLock:()=>lockAllowed,releaseLock:()=>{}})},
 JSON,Date,Number,String,Math,Array,Object,isFinite,Error};
vm.createContext(ctx);vm.runInContext(script,ctx);
const header=Array.from(ctx.TAXIAPP_PRINT_V2_HEADERS);
function sheet(name=ctx.TAXIAPP_PRINT_V2_TAB){
 const rows=[header.slice()];
 return {rows,getName:()=>name,getLastRow:()=>rows.length,
  getRange:(start,col,count,width)=>({getValues:()=>rows.slice(start-1,start-1+count).map(row=>row.slice(col-1,col-1+width))}),
  appendRow:row=>{
   calls++;
   if(failAt&&calls===failAt)throw Error('interrupted synthetic append');
   rows.push([...row]);
  }};
}
const stage=ctx.printV2AppendDraft_,latest=ctx.printV2ReadLatestDraft_;
const s=sheet();
failAt=2;calls=0;
assert.throws(()=>stage(s,prepared,uid),/interrupted/);
assert.equal(s.rows.length,2,'only one incomplete chunk persists without COMMIT');
assert.equal(latest(s,id,uid),null,'incomplete transfer must never print');
failAt=0;calls=0;
const registered=stage(s,prepared,uid);
assert.equal(registered.state,'staged');
const chunks=s.rows.filter(row=>row[3]==='CHUNK');
const commits=s.rows.filter(row=>row[3]==='COMMIT');
assert.equal(chunks.length,prepared.count,'retry must resume without duplicated chunks');
assert.equal(commits.length,1,'exactly one final commit marker');
assert.equal(latest(s,id,uid).revision,4);
assert.equal(latest(s,id,uid).projection.rows['TAXIAPP_決済内訳'].length,120);
assert.equal(stage(s,prepared,uid).state,'already-staged');
assert.equal(s.rows.length,prepared.count+2);
assert.throws(()=>latest(s,id,'other-user'),/SHA256|本人UID/);
assert.throws(()=>stage(sheet('TAXIAPP_同期原本'),prepared,uid),/専用/);
assert.throws(()=>stage(sheet('TAXIAPP_印刷データ'),prepared,uid),/専用/);
assert.throws(()=>stage(sheet(),prepared,'other-user'),/本人UID/);
const hashWrong={...prepared,chunkDigests:[...prepared.chunkDigests]};
hashWrong.chunkDigests[0]='0'.repeat(64);
assert.throws(()=>stage(sheet(),hashWrong,uid),/破損/);
const corrupt=sheet();
corrupt.rows.push(...s.rows.slice(1).map(row=>[...row]));
corrupt.rows[1][7]=corrupt.rows[1][7]+'X';
assert.throws(()=>latest(corrupt,id,uid),/破損/);
const doubleCommit=sheet();
doubleCommit.rows.push(...s.rows.slice(1).map(row=>[...row]),[...s.rows.at(-1)]);
assert.throws(()=>latest(doubleCommit,id,uid),/重複/);
const oldStage=prepareV2({sourceUid:uid,sourceRevision:3,expectedCommittedRevision:0,
 virtual:{...virtual,sourceRevision:3},chunkSize:4000});
assert.throws(()=>stage(s,oldStage,uid),/旧版/);
const newer=prepareV2({sourceUid:uid,sourceRevision:5,expectedCommittedRevision:4,
 virtual:{...virtual,sourceRevision:5},chunkSize:4000});
assert.equal(stage(s,newer,uid).state,'staged');
assert.equal(latest(s,id,uid).revision,5);
const conflict=prepareV2({sourceUid:uid,sourceRevision:6,expectedCommittedRevision:4,
 virtual:{...virtual,sourceRevision:6},chunkSize:4000});
assert.throws(()=>stage(s,conflict,uid),/CAS_CONFLICT/);
const stamp=s.rows.length;
assert.equal(stage(s,newer,uid).state,'already-staged');
assert.equal(s.rows.length,stamp);
const orphanConflict=sheet();
orphanConflict.rows.push([...s.rows[1]]);
orphanConflict.rows[1][2]='different-transfer';
assert.throws(()=>stage(orphanConflict,prepared,uid),/別内容/);
lockAllowed=false;
assert.throws(()=>stage(sheet(),prepared,uid),/排他ロック/);
lockAllowed=true;
const labels=[
 {id,revision:5,projection:latest(s,id,uid).projection}
];
const selection=previewSelector({committed:labels,followLatest:true,c17:'stale-id'});
assert.equal(selection.state,'preview-only');
assert.equal(selection.selectedId,id);
assert.equal(selection.page1Count,36);
assert.equal(selection.page2Count,24);
assert.equal(selection.staleDerived,true);
assert.equal(selection.printAuthorized,false);
assert.equal(selection.legacySwitchAuthorized,false);
assert.equal(previewSelector({committed:labels,b17:selection.label,c17:id}).selectedId,id);
assert.equal(previewSelector({committed:labels,b17:id,c17:'wrong-id'}).selectedId,id);
assert.equal(previewSelector({committed:labels,b17:'not-a-duty'}).state,'not-selected');
assert.equal(previewSelector({committed:labels}).state,'not-selected');
assert.equal(previewSelector({committed:[]}).state,'no-committed-shifts');
const twin=clone(latest(s,id,uid).projection);
twin.id='shift-9001-b';twin.rows['TAXIAPP_乗務一覧'][0][0]=twin.id;
twin.rows['TAXIAPP_印刷データ'].forEach(row=>row[0]=twin.id);
twin.rows['TAXIAPP_決済内訳'].forEach(row=>row[0]=twin.id);
twin.rows['TAXIAPP_集計'].forEach(row=>row[0]=twin.id);
const ambiguous=previewSelector({committed:[...labels,{id:twin.id,revision:5,projection:twin}],b17:selection.label});
assert.equal(ambiguous.state,'not-selected');
assert.throws(()=>previewSelector({committed:[...labels,{id:twin.id,revision:5,projection:twin}],followLatest:true}),
 /最新乗務の判定が曖昧/,'same timestamp must never auto-select the wrong duty');
for(const [name,cols] of Object.entries(COLUMNS)){
 assert.match(code,new RegExp("'"+name+"'"),'existing production GAS source uses '+name);
 assert.equal(decoded.rows[name][0].length,cols.length);
}
assert.equal(/printV2AppendDraft_|PrintOnlyStageV2Draft/.test(code),false);
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
assert.equal(/printV2AppendDraft_|PrintOnlyStageV2Draft/.test(html),false);
console.log('Print-stage V2: 60 rides + 120 payments, four sources, chunk recovery, CAS, SHA256, B15/B17/C17 selection PASS');
