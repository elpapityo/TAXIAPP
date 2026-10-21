'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),
 vm=require('node:vm'),crypto=require('node:crypto');
const {createPrintStageBoundary}=require('../server-drafts/print-stage-secure-boundary.js');
const {projectTrustedPacket,COLUMNS}=require('../server-drafts/print-stage-legacy-rows.js');
const stageSource=fs.readFileSync(path.join(__dirname,'..','google-apps-script','PrintOnlyStageDraft.gs'),'utf8');
const code=fs.readFileSync(path.join(__dirname,'..','google-apps-script','Code.gs'),'utf8');
const now=Math.floor(Date.now()/1000),projectId='demo-taxiapp-stage7',uid='owner-uid-A',id='shift-805-a';
const original={
 id,date:'2026-10-21',startedAt:'07:00',endedAt:'16:00',
 startedIso:'2026-10-21T07:00:00+09:00',endedIso:'2026-10-21T16:00:00+09:00',
 records:[{kind:'ride',status:'complete',
  raw:{A:1,E:'G',K:1200,N:'現',G:'08:00',M:'08:15',AL:'=IMPORTXML(example)',AM:'安全な合成地名',W:0,AR:0,AQ:200,AI:0},
  payments:[{type:'現',received:1400,company:1400}],meta:{settledIso:'2026-10-21T08:15:00+09:00'}},
  {kind:'cancel',status:'complete',raw:{A:2,E:'G',K:700,C:'09:00',N:'現'},meta:{cancelAt:'09:02'}}],
 settings:{private:'secret'},gpsTrack:[{lat:3,lon:4}]
};
const totals={
 meter:1200,discount:0,goFee:200,uberSurcharge:0,cashRemittance:1400,etcRemittance:0,
 totalRemittance:1400,realToll:0,emptyToll:0,cancellation:0,tip:0,reservation:0,
 cashReceived:1400,paymentAllocated:1400
};
const clone=x=>JSON.parse(JSON.stringify(x));
function createContext(){
 const ctx={Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'UTF-8'},
  computeDigest:(_algo,x)=>[...crypto.createHash('sha256').update(x).digest()],
  formatDate:()=> '2026-10-21 09:00:00'},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  JSON,Math,Date,Number,String,Array,Object,isFinite,Error};
 vm.createContext(ctx);vm.runInContext(stageSource,ctx);return ctx;
}
function makeTab(ctx){
 const rows=[Array.from(ctx.TAXIAPP_PRINT_STAGE_COLUMNS_V1)];
 return {rows,getName:()=>ctx.TAXIAPP_PRINT_STAGE_TAB_V1,
  getLastRow:()=>rows.length,
  getRange:(row,col,count,width)=>({getValues:()=>rows.slice(row-1,row-1+count).map(r=>r.slice(col-1,col-1+width))}),
  appendRow:r=>rows.push(r.slice())};
}
const request={idToken:'synthetic-verified-token',shiftId:id,sourceRevision:3,expectedStageRevision:0};
const claims={sub:uid,uid,aud:projectId,iss:'https://securetoken.google.com/'+projectId,
 auth_time:now-500,iat:now-100,exp:now+3500};
function harness(){
 const ctx=createContext(),tab=makeTab(ctx),stats={verified:0,auth:0,read:0,append:0,packet:0};
 let cloud={uid,revision:3,shift:clone(original),tombstoneState:'active',deleted:false};
 let role=true,verified=clone(claims),rejectSignature=false,editAfterWrite=false;
 const deps={projectId,nowSeconds:()=>now,
  verifyIdToken:async(token,options)=>{stats.verified++;assert.equal(options.checkRevoked,true);
   if(rejectSignature||token!==request.idToken)throw Error('signature/revocation invalid');
   return clone(verified);},
  isAuthorizedAdmin:async claimUid=>{stats.auth++;return role&&claimUid===uid;},
  readFirestoreDuty:async({uid:readUid,shiftId})=>{stats.read++;
   if(readUid!==uid||shiftId!==id)return null;
   return clone(cloud);},
  makeLegacyPrintPacket:async shift=>{stats.packet++;
   return {kind:'TAXIAPP_SHIFT_V1',shift,summary:clone(totals)};},
  preparePrintStage:arg=>ctx.printStagePrepareV1_(arg),
  appendPrintStage:(prepared,verifiedUid)=>{stats.append++;
   const result=ctx.printStageAppendV1_(tab,prepared,verifiedUid);
   if(editAfterWrite){cloud.revision++;editAfterWrite=false;}
   return result;},
  readLatestPrintStage:(shiftId,verifiedUid)=>ctx.printStageReadLatestV1_(tab,shiftId,verifiedUid)
 };
 const gate=createPrintStageBoundary(deps);
 return {gate,stats,tab,ctx,
  setRole:x=>role=x,setVerified:x=>verified=x,setRejectSignature:x=>rejectSignature=x,
  setCloud:x=>cloud=x,getCloud:()=>cloud,setEditAfterWrite:x=>editAfterWrite=x};
}
async function failure(h,arg,regex){
 const saved=h.stats.append;
 await assert.rejects(h.gate.stage(arg),regex);
 assert.equal(h.stats.append,saved,'auth, origin or revision errors never append print data');
}
(async()=>{
 const success=harness(),originalBefore=JSON.stringify(success.getCloud());
 const first=await success.gate.stage(request);
 assert.equal(first.state,'staged-needs-print-review');
 assert.equal(first.printAuthorized,false);
 assert.equal(first.cutoverAuthorized,false);
 assert.equal(JSON.stringify(success.getCloud()),originalBefore);
 assert.equal(success.tab.rows.length,2);
 assert.equal(success.stats.verified,1);
 const retry=await success.gate.stage(request);
 assert.equal(retry.state,first.state);
 assert.equal(success.tab.rows.length,2,'idempotent retry does not duplicate rows');
 assert.equal(success.tab.rows[1][0],id);
 const badToken=harness();await failure(badToken,{...request,idToken:'fabricated'},/signature/);
 assert.equal(badToken.stats.auth,0);
 const revoked=harness();revoked.setRejectSignature(true);
 await failure(revoked,request,/signature/);
 const badRole=harness();badRole.setRole(false);
 await failure(badRole,request,/管理者/);
 assert.equal(badRole.stats.read,0,'role must be checked before reading Firestore');
 const otherUid=harness();otherUid.setVerified({...claims,sub:'another-uid',uid:'another-uid'});
 await failure(otherUid,request,/管理者/);
 const wrongAudience=harness();wrongAudience.setVerified({...claims,aud:'different-project'});
 await failure(wrongAudience,request,/発行元/);
 const expired=harness();expired.setVerified({...claims,exp:now-20});
 await failure(expired,request,/有効期限/);
 const forgedIssuer=harness();forgedIssuer.setVerified({...claims,iss:'https://example.com'});
 await failure(forgedIssuer,request,/発行元/);
 const invalidUid=harness();invalidUid.setVerified({...claims,uid:'another-uid'});
 await failure(invalidUid,request,/UID/);
 const noRev=harness();await failure(noRev,{...request,sourceRevision:0},/更新番号/);
 const forgedOwner=harness();await failure(forgedOwner,{...request,sourceUid:uid},/未対応/);
 const forgedPacket=harness();await failure(forgedPacket,{...request,packet:{kind:'TAXIAPP_SHIFT_V1'}},/未対応/);
 const missingToken=harness();await failure(missingToken,{...request,idToken:''},/トークン/);
 const stale=harness();stale.setCloud({...clone(originalBefore&&success.getCloud()),revision:4});
 await failure(stale,request,/更新番号/);
 const trashed=harness();trashed.setCloud({...trashed.getCloud(),tombstoneState:'deleted'});
 await failure(trashed,request,/削除状態/);
 const missingMarker=harness();missingMarker.setCloud({...trashed.getCloud(),tombstoneState:null});
 await failure(missingMarker,request,/削除状態/);
 const wrongOwner=harness();wrongOwner.setCloud({...wrongOwner.getCloud(),uid:'someone-else'});
 await failure(wrongOwner,request,/本人/);
 const racing=harness();racing.setEditAfterWrite(true);
 await assert.rejects(racing.gate.stage(request),/更新番号/);
 assert.equal(racing.tab.rows.length,2,'staged snapshot remains for audit but was NOT approved for printing');
 const reader=harness();
 const planned=await reader.gate.verifyAndPrepare(request);
 assert.equal(reader.tab.rows.length,1,'prepare alone is read-only');
 assert.equal(planned.uid,uid);
 assert.equal(planned.prepared.revision,3);
 assert.equal(planned.prepared.projectionJson.includes('secret'),false);
 assert.equal(planned.prepared.projectionJson.includes('gpsTrack'),false);
 const packet={kind:'TAXIAPP_SHIFT_V1',shift:clone(original),summary:clone(totals)};
 const virtual=projectTrustedPacket({packet,sourceRevision:3});
 assert.equal(virtual.records,2);
 assert.equal(virtual.meter,1200);
 assert.equal(virtual.pages[0].length,2);
 assert.equal(virtual.pages[1].length,0);
 assert.deepEqual(virtual.rows['TAXIAPP_印刷データ'][0].slice(0,2),[id,1]);
 assert.equal(virtual.rows['TAXIAPP_印刷データ'][0][7],"'=IMPORTXML(example)");
 assert.equal(virtual.rows['TAXIAPP_印刷データ'][1][4],0,'cancellation must be zero');
 assert.deepEqual(virtual.rows['TAXIAPP_決済内訳'][0].slice(0,7),[id,1,1,'現',1400,'',1400]);
 assert.equal(virtual.rows['TAXIAPP_決済内訳'][0][9],0,'GO is not deducted from remittance');
 assert.equal(virtual.rows['TAXIAPP_集計'].find(r=>r[1]==='goFee')[2],200);
 assert.equal(virtual.sourceSheetsRequired.length,4);
 assert.equal(virtual.printAuthorized,false);
 assert.equal(virtual.stage6ProjectionHasAllSources,false);
 for(const [name,rows] of Object.entries(virtual.rows))
  assert.ok(rows.every(r=>r.length===COLUMNS[name].length),'column width '+name);
 // Cross-check the actual production Code.gs literal sheet columns and storage logic.
 assert.match(code,/'TAXIAPP_印刷データ': \['乗務ID','営業番号'/);
 assert.match(code,/'TAXIAPP_決済内訳': \['乗務ID','営業番号'/);
 assert.match(code,/'TAXIAPP_集計': \['乗務ID','種類','金額'/);
 assert.match(code,/replaceRowsForShift_\(ss,'TAXIAPP_決済内訳'/);
 assert.match(code,/replaceRowsForShift_\(ss,'TAXIAPP_印刷データ'/);
 const big=clone(original);
 big.records=Array.from({length:60},(_,i)=>({
  kind:'ride',status:'complete',raw:{A:i+1,K:1000,E:'G',N:'現'},
  payments:[{type:'現',received:1000,company:1000}]}));
 const bigRows=projectTrustedPacket({packet:{kind:'TAXIAPP_SHIFT_V1',shift:big,
  summary:{...totals,meter:60000,cashReceived:60000,paymentAllocated:60000,
   cashRemittance:60000,totalRemittance:60000}},sourceRevision:4});
 assert.equal(bigRows.pages[0].length,36);
 assert.equal(bigRows.pages[1].length,24);
 assert.equal(bigRows.pages[1][0][1],37);
 const over=clone(big);over.records.push(clone(big.records[0]));
 assert.throws(()=>projectTrustedPacket({packet:{kind:'TAXIAPP_SHIFT_V1',shift:over,summary:totals},sourceRevision:4}),/不正/);
 console.log('Stage7 secure boundary and virtual four-source print data PASS: auth gates, UID, CAS, replay, 36+24 pages');
})().catch(e=>{console.error(e);process.exitCode=1;});
