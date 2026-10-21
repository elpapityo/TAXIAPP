'use strict';
/* 合成データ：クラウド一覧/復元中のUID・保存先切替で他人の結果を表示しない */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','cloud-sync-ui.js'),'utf8');
const idA='shift-1792620000000-ownerA';
let uid='uid-A',endpoint='/owner-A',pendingList=null,pendingRestore=null;
let undoCount=0,receivedCount=0,listCount=0;
const notices=[];
const fakeEngine={
 status:()=>({busy:false,conflicts:[],lastSyncAt:0,lastError:''}),
 viewerStatus:()=>({lastSyncAt:0,lastError:''}),
 resetAccount:()=>{},undoLocalRemoval:()=>{undoCount++;},
 run:async()=>{receivedCount++;return true}
};
const root={
 localStorage:{getItem:()=>null,setItem:()=>{}},
 TAXIAPP_BIDIRECTIONAL_SYNC:{create:()=>fakeEngine},
 confirm:()=>true
};
vm.runInNewContext(source,{window:root,globalThis:root,Date,console,setTimeout,clearTimeout});
const sync=root.TAXIAPP_SYNC_UI({
 scopeKey:()=>uid,endpoint:()=>endpoint,
 prefs:()=>({syncMode:'off'}),configured:()=>true,
 canSync:()=>true,canView:()=>false,
 getModel:()=>({shifts:[]}),
 request:(action)=>{
  if(action==='syncList'){
   listCount++;
   if(listCount===1)return new Promise(resolve=>{pendingList=resolve;});
   return Promise.resolve({shifts:[{id:idA,revision:2,deleted:true}]});
  }
  if(action==='syncRestore')return new Promise(resolve=>{pendingRestore=resolve;});
  throw Error('unexpected '+action);
 },
 replace:async()=>{},
 root:{querySelector:()=>null},
 escape:value=>String(value),toast:value=>notices.push(String(value)),
 setStatus:()=>{},download:()=>{},dateStamp:()=> '20261022'
});
(async()=>{
 const staleLoad=sync.cloudAction('load');
 assert.equal(typeof pendingList,'function');
 sync.resetAccount();uid='uid-B';endpoint='/owner-B';
 pendingList({shifts:[{id:idA,revision:1,deleted:false}]});
 assert.equal(await staleLoad,false,'login change rejects stale listing');
 assert.equal(notices.length,0,'old user listing must not toast in new account');
 assert.doesNotMatch(sync.panel(),/cloudId_A_unrelated/);
 assert.equal(await sync.cloudAction('load'),true);
 assert.match(sync.panel(),/クラウドから復元/);
 const staleRestore=sync.cloudAction('restore',idA);
 assert.equal(typeof pendingRestore,'function');
 sync.resetAccount();uid='uid-C';endpoint='/owner-C';
 pendingRestore({id:idA,revision:3,deleted:false});
 assert.equal(await staleRestore,false,'an in-flight restore must not update the next user');
 assert.equal(undoCount,0,'the new user deletion marker must remain intact');
 assert.equal(receivedCount,0,'the previous user duty must not be received by the next account');
 assert.doesNotMatch(sync.panel(),/クラウドから復元/);
 console.log('ログイン切替レース：前UIDの一覧・復元結果が次UIDへ流入しない');
})().catch(error=>{console.error(error);process.exitCode=1;});
