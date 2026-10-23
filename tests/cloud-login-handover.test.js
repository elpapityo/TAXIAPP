'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
require('../bidirectional-sync.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const store=new Map();
const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
const shift={id:'shift-111-xyz',date:'2026-10-20',startedIso:'2026-10-20T06:00:00+09:00',records:[{id:'ride',kind:'ride',status:'complete',raw:{A:'1'}}],settings:{}};
(async()=>{
 let release,lists=0,gets=0;
 const gate=new Promise(resolve=>{release=resolve;});
 const app=globalThis.TAXIAPP_BIDIRECTIONAL_SYNC.create({
  getEndpoint:()=>'/same-cloud',
  localStorage:storage,
  getModel:()=>({shifts:[]}),
  getPacket:s=>({kind:'TAXIAPP_SHIFT_V1',shift:clone(s)}),
  replaceRemoteShift:async()=>{throw Error('read-only fetch must not edit local model');},
  request:async(action)=>{
   if(action==='syncList'){lists++;await gate;return {shifts:[{id:shift.id,revision:8}]};}
   if(action==='syncGet'){gets++;return {id:shift.id,revision:8,shift:clone(shift)};}
   throw Error('unexpected action '+action);
  }
 });
 // A viewer read is still pending when the same account becomes editor.
 const viewer=app.readOnly();
 const writer=app.readOnly();
 assert.equal(lists,1,'shared cloud read must only start one syncList');
 release();
 const [viewResult,writerResult]=await Promise.all([viewer,writer]);
 assert.deepEqual(viewResult,[shift]);
 assert.deepEqual(writerResult,[shift],'writer must not see a spurious null when viewer fetch is in flight');
 assert.equal(gets,1);
 assert.equal(app.adoptViewerBaseline(),true,'revision should only be committed after durable local save');
 assert.equal(app.status().lastError,'');
 assert.ok(app.status().lastSyncAt>0);
 assert.equal(app.status().conflicts.length,0);
 // Temporary network errors must be observable and a subsequent read must retry.
 let fail=true,attempts=0;
 const offline=globalThis.TAXIAPP_BIDIRECTIONAL_SYNC.create({
  getEndpoint:()=>'/other-cloud',localStorage:storage,getModel:()=>({shifts:[]}),
  getPacket:s=>({kind:'TAXIAPP_SHIFT_V1',shift:s}),
  replaceRemoteShift:async()=>{throw Error('must not run');},
  request:async action=>{
   if(action!=='syncList')throw Error('unexpected action');
   attempts++;
   if(fail)throw Error('temporary offline');
   return {shifts:[]};
  }
 });
 const [bad1,bad2]=await Promise.all([offline.readOnly(),offline.readOnly()]);
 assert.equal(bad1,null);assert.equal(bad2,null);
 assert.match(offline.viewerStatus().lastError,/temporary offline/);
 fail=false;
 assert.deepEqual(await offline.readOnly(),[]);
 assert.equal(offline.viewerStatus().lastError,'');
 assert.ok(attempts>=2);
 const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 const account=fs.readFileSync(path.join(__dirname,'..','account-auto-sync.js'),'utf8');
 const session=fs.readFileSync(path.join(__dirname,'..','device-session.js'),'utf8');
 assert.match(index,/syncUI\.bootstrapWriter\(\)/);
 assert.match(index,/function canEditNow\(\)\{return deviceMode==='writer'&&!writerLoadGate;\}/);
 assert.match(account,/deviceSession\.begin\(next,\{\s*viewer:printViewerMode,claimOnLogin:!printViewerMode&&explicitWriterLogin\s*\}\)/);
 assert.match(account,/if\(!printViewerMode&&deviceSession\?\.state\(\)==='viewer'\)await deviceSession\.claim\(\)/);
 assert.match(account,/if\(printViewerMode\)return;/);
 assert.match(index,/TAXIAPP_PRINT_VIEWER_MODE/);
 assert.match(index,/firestorePrintGooglePostRequest/);
 assert.match(index,/const printReadAction=TAXIAPP_PRINT_VIEWER_MODE&&deviceMode==='viewer'&&/);
 assert.match(index,/\['loadCloudHistory','firestorePrintToGoogle','historyIndexLoad','historyIndexOpen','cloudIndexOpen','cloudTrashList'\]\.includes\(action\)/);
  assert.doesNotMatch(index,/\['loadCloudHistory','firestorePrintToGoogle'[^\n]*'cloudTrash'[^\n]*\]\.includes\(action\)/,'印刷専用の閲覧端末に削除操作は許可しない');
 assert.match(index,/const verifiedOctoberTransfer=action==='migrateOctober16GoogleDuty'/);
 assert.match(index,/if\(!canEditNow\(\)&&action!=='bidirectionalSyncNow'&&!printReadAction&&!verifiedOctoberTransfer\)/);
 assert.match(session,/claimedOnce=Boolean\(oldId\)\|\|!claimOnLogin/);
 console.log('Cloud login handover race and offline retry tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
