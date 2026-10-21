'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),
 crypto=require('node:crypto'),vm=require('node:vm');
const {createStageV2Gateway}=require('../server-drafts/print-stage-v2-gateway.js');
const source=fs.readFileSync(path.join(__dirname,'..','google-apps-script','PrintOnlyStageV2Draft.gs'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const liveGas=fs.readFileSync(path.join(__dirname,'..','google-apps-script','Code.gs'),'utf8');
const time=Math.floor(Date.now()/1000),projectId='demo-taxiapp-gateway',uid='synthetic-admin-A',id='shift-1400-a';
const clone=x=>JSON.parse(JSON.stringify(x));
const shift={id,date:'2026-10-21',startedAt:'08:00',endedAt:'17:00',
 startedIso:'2026-10-20T23:00:00.000Z',endedIso:'2026-10-21T08:00:00.000Z',
 records:[{kind:'ride',status:'complete',
 raw:{A:1,E:'G',N:'現',K:1000,G:'08:10',M:'08:40',AL:'合成出発',AM:'合成到着',W:0,AQ:200},
 payments:[{type:'現',received:1200,company:1200}],meta:{}}],
 settings:{privateConfig:'not to be printed'},gpsHistory:[{lat:99,long:99}]};
const amounts={meter:1000,discount:0,goFee:200,uberSurcharge:0,cashRemittance:1200,
 etcRemittance:0,totalRemittance:1200,realToll:0,emptyToll:0,
 cancellation:0,tip:0,reservation:0,cashReceived:1200,paymentAllocated:1200};
const token={sub:uid,uid,aud:projectId,iss:'https://securetoken.google.com/'+projectId,
 auth_time:time-500,iat:time-100,exp:time+3600};
const request={idToken:'synthetic-token',shiftId:id,sourceRevision:3,expectedStageRevision:0};
function fixture(){
 const ctx={Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'UTF-8'},
  computeDigest:(_algo,v)=>[...crypto.createHash('sha256').update(v).digest()],
  formatDate:()=> '2026-10-21 18:00:00'},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  JSON,Date,Number,String,Math,Array,Object,isFinite,Error};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 const rows=[Array.from(ctx.TAXIAPP_PRINT_V2_HEADERS)];
 const sheet={getName:()=>ctx.TAXIAPP_PRINT_V2_TAB,getLastRow:()=>rows.length,
  getRange:(s,c,count,width)=>({getValues:()=>rows.slice(s-1,s-1+count).map(r=>r.slice(c-1,c-1+width))}),
  appendRow:row=>rows.push([...row])};
 let live={uid,shift:clone(shift),revision:3,tombstoneState:'active',deleted:false};
 let role=true,revoked=false,mutateAfterWrite=false,writeCount=0;
 const deps={projectId,nowSeconds:()=>time,
  verifyIdToken:async(value,opts)=>{
   assert.equal(opts.checkRevoked,true);
   if(revoked||value!=='synthetic-token')throw Error('Firebase signature/revoked');
   return {...token};
  },
  isAuthorizedAdmin:async userUid=>role&&userUid===uid,
  readFirestoreDuty:async({uid:asked,shiftId})=>asked===uid&&shiftId===id?clone(live):null,
  makeLegacyPrintPacket:async original=>({kind:'TAXIAPP_SHIFT_V1',shift:clone(original),summary:{...amounts}}),
  appendV2:async(prepared,authenticatedUid)=>{
   writeCount++;
   const result=ctx.printV2AppendDraft_(sheet,prepared,authenticatedUid);
   if(mutateAfterWrite){live.revision++;mutateAfterWrite=false;}
   return result;
  },
  readV2:async(shiftId,authenticatedUid)=>ctx.printV2ReadLatestDraft_(sheet,shiftId,authenticatedUid)
 };
 return {gate:createStageV2Gateway(deps),rows,getWrites:()=>writeCount,
  setRole:v=>role=v,setRevoked:v=>revoked=v,setChange:v=>mutateAfterWrite=v,
  setLive:v=>live=v,getLive:()=>live,ctx,sheet};
}
(async()=>{
 const h=fixture(),before=JSON.stringify(h.getLive());
 const success=await h.gate.stage(request);
 assert.equal(success.state,'staged-needs-print-review');
 assert.equal(success.printAuthorized,false);
 assert.equal(success.legacySheetsTouched,false);
 assert.equal(h.rows.at(-1)[3],'COMMIT');
 assert.equal(JSON.stringify(h.getLive()),before);
 assert.equal(h.rows.some(row=>JSON.stringify(row).includes('privateConfig')),false);
 assert.equal(h.rows.some(row=>JSON.stringify(row).includes('gpsHistory')),false);
 const length=h.rows.length;
 assert.equal((await h.gate.stage(request)).state,'staged-needs-print-review');
 assert.equal(h.rows.length,length,'repeat must not add rows');
 const unauthorized=fixture();unauthorized.setRole(false);
 await assert.rejects(unauthorized.gate.stage(request),/管理者/);
 assert.equal(unauthorized.getWrites(),0);
 const revoked=fixture();revoked.setRevoked(true);
 await assert.rejects(revoked.gate.stage(request),/signature/);
 assert.equal(revoked.getWrites(),0);
 const wrong=fixture();
 await assert.rejects(wrong.gate.stage({...request,packet:{shift:{id}}}),/未対応/);
 assert.equal(wrong.getWrites(),0);
 const foreign=fixture();foreign.setLive({...foreign.getLive(),uid:'wrong'});
 await assert.rejects(foreign.gate.stage(request),/本人Firestore/);
 assert.equal(foreign.getWrites(),0);
 const deleted=fixture();deleted.setLive({...deleted.getLive(),deleted:true,tombstoneState:'trash'});
 await assert.rejects(deleted.gate.stage(request),/削除状態/);
 assert.equal(deleted.getWrites(),0);
 const stale=fixture();stale.setLive({...stale.getLive(),revision:4});
 await assert.rejects(stale.gate.stage(request),/更新番号/);
 assert.equal(stale.getWrites(),0);
 const race=fixture();race.setChange(true);
 await assert.rejects(race.gate.stage(request),/更新番号/);
 assert.equal(race.rows.at(-1)[3],'COMMIT','immutable staged audit remains after race');
 assert.equal(/printV2AppendDraft_|printV2ReadLatestDraft_/.test(liveGas),false);
 assert.equal(/printV2AppendDraft_|printV2ReadLatestDraft_/.test(html),false);
 console.log('V2 authenticated adapter draft PASS: trusted sources, reject malicious client payload, revocation, races, idempotent stage');
})().catch(error=>{console.error(error);process.exitCode=1;});
