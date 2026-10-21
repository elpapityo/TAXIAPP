'use strict';
// Synthetic runtime test for the real sync adapter. Default administrator
// settings have syncMode=off and must not lock local editing forever.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ui=fs.readFileSync('cloud-sync-ui.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const create=(allow)=>{
 let requests=0,ready=0,feedback='';
 const win={TAXIAPP_BIDIRECTIONAL_SYNC:{create:()=>({
  readOnly:async()=>{requests++;return [];},
  status:()=>({busy:false,conflicts:[],lastError:'',lastSyncAt:0}),
  viewerStatus:()=>({lastSyncAt:0,lastError:''}),
  hasLocalRemovals:()=>false,
  resetAccount:()=>{},excludeLocalRemovals:shifts=>shifts,
  assertSafeWriterSnapshot:()=>true,adoptViewerBaseline:()=>true
 })}};
 vm.runInNewContext(ui,{window:win,globalThis:win,Date,console,setTimeout,clearTimeout});
 const adapter=win.TAXIAPP_SYNC_UI({
  getModel:()=>({shifts:[{id:'shift-1792600000000-local',records:[],settings:{}}]}),
  getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift}),
  endpoint:()=>'',configured:()=>false,prefs:()=>({syncMode:'off'}),
  allowLegacyLocalWriter:()=>allow,canSync:()=>true,
  writerBootstrapAllowed:()=>true,
  onWriterBootstrapReady:()=>{ready++;},
  onWriterBootstrapStatus:value=>{feedback=value;},
  setStatus:value=>{feedback=value;},
  root:{querySelector:()=>null},
  toast:()=>{},escape:x=>String(x),dateStamp:()=> '20261022'
 });
 return {adapter,counts:()=>({requests,ready,feedback})};
};
(async()=>{
 const legacy=create(true);
 assert.equal(await legacy.adapter.bootstrapWriter(),true);
 assert.equal(legacy.counts().ready,1,'owner writer mode must open for local storage');
 assert.equal(legacy.counts().requests,0,'sync OFF must not pull or overwrite cloud');
 assert.match(legacy.counts().feedback,/端末内の日報/);
 const member=create(false);
 assert.equal(await member.adapter.bootstrapWriter(),false,
  'non-legacy users must not bypass verified Firestore cloud');
 assert.equal(member.counts().ready,0);
 assert.match(member.counts().feedback,/Google接続と双方向同期/);
 assert.match(html,/allowLegacyLocalWriter:\(\)=>deviceMode==='writer'&&writerLoadGate&&/);
 assert.match(html,/accountScopeLoaded=true;[\s\S]{0,360}syncUI\.bootstrapWriter\(\)/);
 console.log('既定の同期OFFでも管理者の操作端末を解除し、個人Firestoreの受信ゲートは維持');
})().catch(e=>{console.error(e);process.exitCode=1;});
