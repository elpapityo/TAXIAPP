'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {projectTrustedPacket,COLUMNS}=require('../server-drafts/print-stage-legacy-rows.js');
const {prepareV2}=require('../server-drafts/print-stage-v2.js');
const base=path.join(__dirname,'..'),fixtureId='shift-1792501200000-a',uid='synthetic-admin-owner';
const source=fs.readFileSync(path.join(base,'google-apps-script','PrintOnlyExistingSheetsDraft.gs'),'utf8');
const stageJs=fs.readFileSync(path.join(base,'google-apps-script','PrintOnlyStageV2Draft.gs'),'utf8');
const confirmJs=fs.readFileSync(path.join(base,'google-apps-script','PrintOnlyExistingSheetsConfirmDraft.gs'),'utf8');
const production=fs.readFileSync(path.join(base,'google-apps-script','Code.gs'),'utf8');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const labels=['TAXIAPP_印刷データ','TAXIAPP_決済内訳','TAXIAPP_集計','TAXIAPP_乗務一覧'];
const originalSheets=['TAXIAPP_同期原本','TAXIAPP_印刷操作','補助簿印刷用','補助簿印刷用_2頁'];
function ctx(){
 const sandbox={Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'UTF-8'},
   computeDigest:(_algorithm,text)=>[...crypto.createHash('sha256').update(text).digest()],
   formatDate:()=> '2026-10-21 16:30:00'},
   LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
   Date,JSON,Math,Number,Object,Array,String,isFinite,Error,Set};
 vm.createContext(sandbox);vm.runInContext(stageJs+'\n'+source+'\n'+confirmJs,sandbox);
 return sandbox;
}
function sheet(name,header=[],maxRows=1200){
 const values={1:header.slice()},formulaCells=new Set(),reads=[],writes=[];
 let failWrites=false,lastRowFloor=1;
 const width=header.length||24;
 const me={
  name,values,formulaCells,reads,writes,
  getName:()=>name,getMaxRows:()=>maxRows,getMaxColumns:()=>24,
  getLastRow:()=>Math.max(lastRowFloor,...Object.keys(values).map(Number)),
  setLastRowFloor:x=>lastRowFloor=x,
  failWrites:v=>failWrites=v,
  getRange:(first,col,count=1,cols=1)=>({
   getValues:()=>{reads.push({first,col,count,cols});return Array.from({length:count},(_,i)=>{
    const row=values[first+i]||[];
    return Array.from({length:cols},(_,j)=>row[col-1+j]===undefined?'':row[col-1+j]);
   });},
   getFormulas:()=>Array.from({length:count},(_,i)=>Array.from({length:cols},(_,j)=>
    formulaCells.has((first+i)+':'+(col+j))?'=SENTINEL':'')),
   clearContent:()=>{
    writes.push({first,col,clear:true});
    for(let i=0;i<count;i++){
     const row=values[first+i]||[];
     for(let j=0;j<cols;j++)row[col-1+j]='';
     values[first+i]=row;
    }
   },
   setValues:rows=>{
    if(failWrites)throw Error('Simulated Sheets service write failure');
    if(name==='TAXIAPP_同期原本'||name==='TAXIAPP_印刷操作'||name.startsWith('補助簿'))throw Error('PROTECTED_SHEET_WRITE');
    writes.push({first,col,rows:rows.length});
    for(let i=0;i<rows.length;i++){
     const r=values[first+i]||[];
     for(let j=0;j<rows[i].length;j++)r[col-1+j]=rows[i][j];
     values[first+i]=r;
    }
   }
  }),
  appendRow:r=>{
   if(failWrites)throw Error('Simulated Sheets append interruption');
   values[me.getLastRow()+1]=[...r];
  }
 };
 return me;
}
function make(){
 const sandbox=ctx(),book={},stage=sheet(sandbox.TAXIAPP_PRINT_V2_TAB,
  [...sandbox.TAXIAPP_PRINT_V2_HEADERS]);
 const legacyId='shift-1792400000000';
 for(const name of labels){
  const existing=sheet(name,[...sandbox.TAXIAPP_PRINT_EXISTING_V2_HEADERS[name]]);
  const oldRow=Array(existing.values[1].length).fill('');
  oldRow[0]=legacyId;oldRow[1]=name==='TAXIAPP_乗務一覧'?'2026-10-20':1;
  existing.values[2]=oldRow;
  if(name==='TAXIAPP_乗務一覧'){
   existing.setLastRowFloor(1200);existing.formulaCells.add('2:20');existing.formulaCells.add('2:21');
  }
  book[name]=existing;
 }
 for(const name of originalSheets)book[name]=sheet(name,['SENTINEL']);
 book['TAXIAPP_同期原本'].values[2]=[legacyId,'old-snapshot-never-write'];
 book['TAXIAPP_印刷操作'].values[15]=['','checked',true];
 book['TAXIAPP_印刷操作'].values[17]=['B17 label','old-selected-ID'];
 book['補助簿印刷用'].values[23]=['PRINT_1_PROTECTED'];
 book['補助簿印刷用_2頁'].values[11]=['PRINT_2_PROTECTED'];
 const ss={getSheetByName:name=>book[name]||null};
 const ui={followLatest:true,selectedId:fixtureId,
  selectedLabel:'10/21 08:15出庫・営業37件・合成',meter:37000};
 const op=book['TAXIAPP_印刷操作'];
 const opRange=op.getRange;
 op.getRange=(ref,...rest)=>{
  if(ref==='B15')return {getValue:()=>ui.followLatest};
  if(ref==='B17')return {getDisplayValue:()=>ui.selectedLabel};
  if(ref==='C17')return {getDisplayValue:()=>ui.selectedId};
  return opRange(ref,...rest);
 };
 const index=book['TAXIAPP_乗務一覧'],indexRange=index.getRange;
 index.getRange=(ref,col,count,width)=>{
  if(ref==='T2')return {getDisplayValue:()=>ui.selectedLabel};
  if(ref===2&&col===1&&width===21){
   const range=indexRange(ref,col,count,width),getter=range.getValues;
   return {...range,getDisplayValues:()=>getter().map(row=>{
    const r=row.map(v=>String(v??''));
    if(r[0]===fixtureId)r[20]=ui.selectedLabel;
    return r;
   })};
  }
  return indexRange(ref,col,count,width);
 };
 const printed=book['補助簿印刷用'],printRange=printed.getRange;
 printed.getRange=(ref,...rest)=>
  ref==='X23'?{getValue:()=>ui.meter}:printRange(ref,...rest);
 const sh={id:fixtureId,date:'2026-10-21',startedAt:'08:15',endedAt:'18:00',
  startedIso:'2026-10-20T23:15:00.000Z',endedIso:'2026-10-21T09:00:00.000Z',
  driver:'合成',records:[],settings:{secret:'DO_NOT_PRINT'},gpsTrack:[{lat:99}]};
 for(let i=1;i<=37;i++)sh.records.push({
  kind:'ride',status:'complete',
  raw:{A:i,E:'G',K:1000,N:'現',G:'08:15',M:'08:30',AL:'合成乗車',AM:'合成降車',AQ:200,W:0,AI:0,AR:0},
  payments:[{type:'現',received:700,company:700},{type:'QR',received:500,company:500}],meta:{}
 });
 const sums={meter:37000,discount:0,goFee:7400,uberSurcharge:0,
  cashRemittance:25900,etcRemittance:0,totalRemittance:25900,
  realToll:0,emptyToll:0,cancellation:0,tip:0,reservation:0,
  cashReceived:25900,paymentAllocated:44400};
 const virtual=projectTrustedPacket({packet:{kind:'TAXIAPP_SHIFT_V1',shift:sh,summary:sums},sourceRevision:3});
 const prepared=prepareV2({sourceUid:uid,sourceRevision:3,expectedCommittedRevision:0,virtual,chunkSize:4000});
 sandbox.printV2AppendDraft_(stage,prepared,uid);
 return {sandbox,ss,book,stage,prepared,legacyId,ui};
}
function testRun(){
 const z=make(),{sandbox,ss,book,stage}=z;
 const before=Object.fromEntries(originalSheets.map(n=>[n,JSON.stringify(book[n].values)]));
 const plan=sandbox.printV2ExistingPlan_(ss,stage,fixtureId,uid);
 assert.equal(plan.id,fixtureId);
 assert.equal(plan.needsWrite,4);
 assert.deepEqual([...plan.actions].map(x=>x.name),labels);
 assert.equal(plan.actions.at(-1).name,'TAXIAPP_乗務一覧');
 assert.equal(plan.actions.find(x=>x.name==='TAXIAPP_印刷データ').rows.length,37);
 assert.equal(plan.actions.find(x=>x.name==='TAXIAPP_決済内訳').rows.length,74);
 assert.equal(plan.actions.find(x=>x.name==='TAXIAPP_集計').rows.length,14);
 assert.equal(plan.actions.find(x=>x.name==='TAXIAPP_乗務一覧').rows[0][2].toISOString(),
  '2026-10-20T23:15:00.000Z');
 for(const name of originalSheets)assert.equal(JSON.stringify(book[name].values),before[name],
  'preflight must never mutate '+name);
 let authCalls=0;
 const result=sandbox.printV2ExistingPublishDraft_(ss,stage,fixtureId,uid,()=>{
  authCalls++;return true;
 });
 assert.equal(authCalls,3);
 assert.equal(result.state,'print-source-staged-review-required');
 assert.equal(result.printAuthorized,false);
 assert.equal(result.changedSheets.length,4);
 const updated=sandbox.printV2ExistingPlan_(ss,stage,fixtureId,uid);
 assert.equal(updated.needsWrite,0,'repeat is idempotent, no duplicate rows');
 assert.equal(sandbox.printV2ExistingPublishDraft_(ss,stage,fixtureId,uid,()=>true).changedSheets.length,0);
 const confirmation=sandbox.printV2ConfirmExistingSelectedDraft_(ss,stage,uid,()=>true);
 assert.equal(confirmation.state,'existing-paper-sheets-verified');
 assert.equal(confirmation.records,37);
 assert.equal(confirmation.meter,37000);
 assert.equal(confirmation.printTriggered,false);
 z.ui.meter=36999;
 assert.throws(()=>sandbox.printV2ConfirmExistingSelectedDraft_(ss,stage,uid,()=>true),
  /メーター売上/);
 z.ui.meter=37000;
 z.ui.selectedId='shift-999-a';
 assert.throws(()=>sandbox.printV2ConfirmExistingSelectedDraft_(ss,stage,uid,()=>true),
  /一致していません/);
 z.ui.selectedId=fixtureId;
 z.ui.followLatest=false;
 assert.equal(sandbox.printV2ConfirmExistingSelectedDraft_(ss,stage,uid,()=>true).shiftId,
  fixtureId,'manual B17 selection must also work');
 assert.throws(()=>sandbox.printV2ConfirmExistingSelectedDraft_(ss,stage,uid,()=>false),
  /Firestore原本/);
 z.ui.followLatest=true;
 for(const name of originalSheets){
  assert.equal(JSON.stringify(book[name].values),before[name],'protected '+name+' must not change');
  assert.equal(book[name].writes.length,0,'no protected ranges must be written');
 }
 for(const name of labels){
  const s=book[name],row2=s.values[2];
  assert.equal(row2[0],z.legacyId,'other selected legacy duty must remain unchanged');
  assert.equal(s.writes.length,1,'only one append permitted in '+name);
 }
 assert.equal(book['TAXIAPP_乗務一覧'].formulaCells.has('2:20'),true);
 assert.equal(book['TAXIAPP_乗務一覧'].formulaCells.has('2:21'),true);
 assert.equal(book['TAXIAPP_乗務一覧'].writes[0].col,1);
 assert.equal(book['TAXIAPP_乗務一覧'].writes[0].rows,1,
  'only index A:S is written; T/U formulas remain untouched');
 assert.throws(()=>sandbox.printV2ExistingPlan_(ss,stage,fixtureId,'wrong-uid'),/SHA256|本人UID/);
 const sameOld=make();
 sameOld.book['TAXIAPP_同期原本'].values[3]=[fixtureId,'legit-old-original'];
 assert.throws(()=>sameOld.sandbox.printV2ExistingPlan_(sameOld.ss,sameOld.stage,fixtureId,uid),
  /旧Google原本/);
 const missing=make();delete missing.book['補助簿印刷用_2頁'];
 assert.throws(()=>missing.sandbox.printV2ExistingPlan_(missing.ss,missing.stage,fixtureId,uid),
  /印刷シート/);
 const header=make();header.book['TAXIAPP_決済内訳'].values[1][2]='corrupted';
 assert.throws(()=>header.sandbox.printV2ExistingPlan_(header.ss,header.stage,fixtureId,uid),
  /列構造/);
 const full=make();full.book['TAXIAPP_決済内訳'].setLastRowFloor(1200);
 full.book['TAXIAPP_決済内訳'].values[1190]=['some-other-shift'];
 assert.throws(()=>full.sandbox.printV2ExistingPlan_(full.ss,full.stage,fixtureId,uid),
  /空き行/);
 const wrong=make();wrong.book['TAXIAPP_印刷データ'].values[3]=[fixtureId,'old-bad-content'];
 assert.throws(()=>wrong.sandbox.printV2ExistingPlan_(wrong.ss,wrong.stage,fixtureId,uid),
  /版または内容/);
 const denied=make();let called=0;
 assert.throws(()=>denied.sandbox.printV2ExistingPublishDraft_(denied.ss,denied.stage,
  fixtureId,uid,()=>{called++;return false;}),/Firestore原本/);
 assert.equal(called,1);
 assert.equal(denied.book['TAXIAPP_印刷データ'].writes.length,0);
 const recovery=make();
 recovery.book['TAXIAPP_決済内訳'].failWrites(true);
 assert.throws(()=>recovery.sandbox.printV2ExistingPublishDraft_(recovery.ss,recovery.stage,
  fixtureId,uid,()=>true),/Simulated/);
 assert.equal(recovery.book['TAXIAPP_乗務一覧'].writes.length,0,
  'do not make a partly transmitted duty selectable');
 recovery.book['TAXIAPP_決済内訳'].failWrites(false);
 assert.equal(recovery.sandbox.printV2ExistingPublishDraft_(
  recovery.ss,recovery.stage,fixtureId,uid,()=>true).changedSheets.length,3);
 assert.equal(recovery.book['TAXIAPP_印刷データ'].writes.length,1,
  'only missing sources are appended after recoverable interruption');
 const missingAuth=make();
 assert.throws(()=>missingAuth.sandbox.printV2ExistingPublishDraft_(
  missingAuth.ss,missingAuth.stage,fixtureId,uid,null),/最新状態/);
 assert.equal(missingAuth.book['TAXIAPP_印刷データ'].writes.length,0);
 const mutateAfter=make();let checks=0;
 assert.throws(()=>mutateAfter.sandbox.printV2ExistingPublishDraft_(
  mutateAfter.ss,mutateAfter.stage,fixtureId,uid,()=>++checks===1),/転送中/);
 assert.equal(mutateAfter.book['TAXIAPP_乗務一覧'].writes.length,0,
  'an expired source before publishing must never create a selectable index');
 const afterIndex=make();let finalChecks=0;
 assert.throws(()=>afterIndex.sandbox.printV2ExistingPublishDraft_(
  afterIndex.ss,afterIndex.stage,fixtureId,uid,()=>++finalChecks<3),/転送中/);
 assert.equal(afterIndex.book['TAXIAPP_乗務一覧'].writes.length,2,
  'failed last check writes then clears ONLY the newly appended list cells');
 assert.equal(afterIndex.book['TAXIAPP_乗務一覧'].values[3][0],'',
  'stale original must not remain selectable after index rollback');
 assert.equal(afterIndex.book['TAXIAPP_同期原本'].writes.length,0);
 // Race must be handled by a trusted backend and must never be reported as authorized.
 assert.equal(/printV2ExistingPublishDraft_|PrintOnlyExistingSheetsDraft/.test(production),false);
 assert.equal(/printV2ExistingPublishDraft_|PrintOnlyExistingSheetsDraft/.test(html),false);
 console.log('Existing sheet print-only draft PASS: 4 sources, original protection, no selector changes, interrupted retry and conflict rejection');
}
testRun();
