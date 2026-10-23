'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync('cloud-sync-ui.js','utf8');
const uid='owner-print',id='shift-1792700000000-pc';
const host={localStorage:{getItem:()=>null,setItem(){}},confirm:()=>true};
host.TAXIAPP_BIDIRECTIONAL_SYNC={create:()=>({status:()=>({busy:false,conflicts:[],lastSyncAt:0,lastError:''}),resetAccount(){}})};
vm.runInNewContext(script,{window:host,globalThis:host,console,setTimeout,clearTimeout});
let reads=0,writes=0;
const sync=host.TAXIAPP_SYNC_UI({
 remoteOnDemand:()=>true,allowCloudIndexView:()=>true,
 scopeKey:()=>uid,endpoint:()=> 'firestore-duties://'+uid,
 configured:()=>true,canView:()=>true,canSync:()=>false,
 prefs:()=>({syncMode:'on'}),getModel:()=>({shifts:[]}),
 request:async(action)=>{
  if(action==='syncList'){reads++;return {shifts:[{id,revision:2,deleted:false,ended:true,date:'2026-10-23',startedIso:'2026-10-23T01:00:00Z',recordsCount:3,meter:9000}]};}
  writes++;throw Error('閲覧専用では禁止: '+action);
 },
 root:{querySelector:()=>null},setStatus:()=>{},
 toast:()=>{},escape:String
});
(async()=>{
 assert.equal(await sync.cloudAction('load'),true);
 assert.equal(reads,1);assert.equal(writes,0);
 const html=sync.privateDiaryPanel();
 assert.match(html,/2026-10-23.*3件.*9,000円/);
 assert.match(html,/cloudIndexOpen/);
 assert.doesNotMatch(html,/data-action="cloudTrash"/);
 assert.doesNotMatch(html,/data-action="cloudRestore"/);
 assert.equal(sync.cloudEntry(id).revision,2);
 assert.equal(await sync.cloudAction('trash',id),false);
 assert.equal(writes,0);
 console.log('PC印刷専用：本人UID一覧だけ読み取り、原本の削除・復元を禁止');
})().catch(e=>{console.error(e);process.exitCode=1;});
