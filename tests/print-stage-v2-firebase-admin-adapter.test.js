'use strict';
const assert=require('node:assert/strict');
const {createFirebaseAdminV2ReadOnlyAdapter}=require('../server-drafts/print-stage-v2-firebase-admin-adapter.js');
const {decodeV2}=require('../server-drafts/print-stage-v2.js');
const uid='synthetic-admin',id='shift-1200-a',projectId='demo-taxiapp-readonly';
const now=1792551600;
const clone=x=>JSON.parse(JSON.stringify(x));
const source={format:'TAXIAPP_PRIVATE_SHIFT_V1',revision:4,
 shift:{id,date:'2026-10-21',startedAt:'07:00',endedAt:'18:00',
 startedIso:'2026-10-20T22:00:00.000Z',endedIso:'2026-10-21T09:00:00.000Z',
 records:[{kind:'ride',status:'complete',raw:{A:1,K:1200,N:'現',E:'G',AQ:200},
 payments:[{type:'現',received:1400,company:1400}]}],settings:{secret:'never-export'},gpsHistory:[{lat:100}]}
};
const marker={format:'TAXIAPP_DUTY_TOMBSTONE_V1',state:'active',revision:4,generation:1};
const amounts={meter:1200,discount:0,goFee:200,uberSurcharge:0,cashRemittance:1400,
 etcRemittance:0,totalRemittance:1400,realToll:0,emptyToll:0,cancellation:0,
 tip:0,reservation:0,cashReceived:1400,paymentAllocated:1400};
function setup(){
 const state={shift:clone(source),tomb:clone(marker),adminEnabled:true,revoked:false,
  writes:0,signatureChecks:[],reads:[],gasStage:null};
 const firestore={collection:prefix=>({
  doc:value=>{
   const full=prefix+'/'+value;
   const doc={path:full,
    collection:name=>({doc:child=>({path:full+'/'+name+'/'+child})}),
    get:async()=>{
     state.reads.push(full);
     return {exists:state.adminEnabled,data:()=>({enabled:state.adminEnabled})};
    }};
   return doc;
  }
 }),runTransaction:async fn=>fn({get:async ref=>{
  state.reads.push(ref.path);
  let data=ref.path.endsWith('/shifts/'+id)?state.shift:
   ref.path.endsWith('/tombstones/'+id)?state.tomb:null;
  return {exists:Boolean(data),data:()=>clone(data)};
 }})};
 const claim={sub:uid,uid,aud:projectId,iss:'https://securetoken.google.com/'+projectId,
  auth_time:now-300,iat:now-100,exp:now+3600};
 const adminAuth={verifyIdToken:async(token,checkRevoked)=>{
  state.signatureChecks.push({token,checkRevoked});
  if(state.revoked||token!=='valid-signature-token')throw Error('Firebase signature/revoked');
  return claim;
 }};
 const adapter=createFirebaseAdminV2ReadOnlyAdapter({
  adminAuth,firestore,projectId,nowSeconds:()=>now,
  makeLegacyPrintPacket:async shift=>({kind:'TAXIAPP_SHIFT_V1',shift,summary:clone(amounts)}),
  appendV2:async (prepared,verifiedUid)=>{
   assert.equal(verifiedUid,uid);
   state.writes++;
   const decoded=decodeV2(prepared,uid);
   if(state.gasStage&&state.gasStage.revision>prepared.revision)throw Error('old version');
   state.gasStage={id,revision:prepared.revision,transferId:prepared.transferId,
    digest:prepared.digest,projection:JSON.parse(prepared.chunks.join(''))};
   assert.equal(decoded.rows['TAXIAPP_決済内訳'].length,1);
   return {state:'staged',id,revision:prepared.revision,printAuthorized:false};
  },
  readV2:async ()=>state.gasStage
 });
 return {state,adapter};
}
(async()=>{
 const good=setup();
 const request={idToken:'valid-signature-token',shiftId:id,sourceRevision:4,
  expectedStageRevision:0};
 const result=await good.adapter.stage(request);
 assert.equal(result.state,'staged-needs-print-review');
 assert.equal(result.printAuthorized,false);
 assert.equal(result.legacySheetsTouched,false);
 assert.ok(good.state.signatureChecks.length>=2);
 assert.ok(good.state.signatureChecks.every(x=>x.checkRevoked===true));
 assert.ok(good.state.reads.includes('admins/'+uid));
 assert.ok(good.state.reads.includes('privateDuties/'+uid+'/shifts/'+id));
 assert.ok(good.state.reads.includes('privateDuties/'+uid+'/tombstones/'+id));
 assert.equal(good.state.writes,1);
 assert.equal(JSON.stringify(good.state.gasStage).includes('never-export'),false);
 assert.equal(JSON.stringify(good.state.gasStage).includes('gpsHistory'),false);
 async function deny(setter,re=/Firestore|管理者|削除履歴|signature|有効/){
  const h=setup();setter(h.state);
  await assert.rejects(h.adapter.stage(request),re);
  assert.equal(h.state.writes,0,'reject before staging any write');
 }
 await deny(s=>{s.adminEnabled=false;},/管理者/);
 await deny(s=>{s.revoked=true;},/signature/);
 await deny(s=>{s.tomb=null;},/削除履歴|原本/);
 await deny(s=>{s.tomb.state='deleted';},/削除履歴/);
 await deny(s=>{s.tomb.revision=3;},/削除履歴/);
 await deny(s=>{s.shift.revision=5;},/削除履歴/);
 await deny(s=>{s.shift.format='invalid';},/原本/);
 await deny(s=>{s.shift.shift.id='shift-999-a';},/原本/);
 await deny(s=>{s.shift=null;},/原本/);
 await assert.rejects(setup().adapter.stage({...request,sourceUid:uid}),/未対応/);
 await assert.rejects(setup().adapter.stage({...request,packet:{shift:{id}}}),/未対応/);
 assert.throws(()=>createFirebaseAdminV2ReadOnlyAdapter({
  adminAuth:{verifyIdToken(){}},firestore:{},projectId
 }),/Firebase Admin/);
 console.log('Firebase Admin V2 read-only adapter PASS: signature/revocation, ACL, transactional marker, UID and CAS; no production writes');
})().catch(e=>{console.error(e);process.exitCode=1;});
