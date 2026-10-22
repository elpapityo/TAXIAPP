'use strict';
/* 本人Firestoreの日報ゴミ箱が設定から実際に開けることを検証 */
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const ui=fs.readFileSync('cloud-sync-ui.js','utf8');
const from=html.indexOf('function renderSheetTargetSettings(){');
const to=html.indexOf('function handleSheetTargetSetting(',from);
assert.ok(from>0&&to>from,'日報保存先の設定画面が見つかりません');
let uid='owner-A',canWrite=true,viewer=false,deleted=false,revision=1,cloudReads=0;
let conflicts=[];
const id='shift-1792600000000-member';
const original={id,date:'2026-10-21',records:[],settings:{}};
const clone=value=>JSON.parse(JSON.stringify(value));
const log=[],remote={id,revision,shift:clone(original)};
const root={
 localStorage:{getItem:()=>null,setItem:()=>{}},
 confirm:()=>true
};
root.TAXIAPP_BIDIRECTIONAL_SYNC={create:()=>({
 status:()=>({busy:false,conflicts,lastSyncAt:0,lastError:''}),
 viewerStatus:()=>({lastSyncAt:0,lastError:''}),
 resetAccount(){},undoLocalRemoval(){log.push('undo');},
 run:async ids=>{assert.deepEqual([...ids],[id]);log.push('receive');return true;}
})};
vm.runInNewContext(ui,{window:root,globalThis:root,Date,console,setTimeout,clearTimeout});
const sync=root.TAXIAPP_SYNC_UI({
 scopeKey:()=>uid,
 endpoint:()=> 'firestore-duties://'+uid,
 configured:()=>true,canSync:()=>canWrite,canView:()=>viewer,
 getModel:()=>({shifts:[]}),
 prefs:()=>({syncMode:'on'}),
 request:async(action,fields={})=>{
  cloudReads++;
  if(action==='syncList')return {shifts:[{id,revision,deleted}]};
  if(action==='syncGet')return {id,revision,shift:clone(original)};
  if(action==='syncTrash'||action==='syncRestore'){
   assert.equal(fields.shiftId,id);
   assert.equal(fields.baseRevision,revision);
   deleted=action==='syncTrash';revision++;
   return {id,revision,deleted};
  }
  throw Error('unexpected '+action);
 },
 root:{querySelector:()=>null},setStatus:()=>{},
 toast:message=>log.push(String(message)),escape:s=>String(s),
 download:()=>log.push('backup'),dateStamp:()=> '20261022'
});
const renderCtx={legacyDiary:()=>false,syncUI:sync};
vm.createContext(renderCtx);
vm.runInContext(html.slice(from,to),renderCtx);
const rendered=renderCtx.renderSheetTargetSettings();
assert.match(rendered,/本人専用クラウド日報の整理/);
assert.match(rendered,/data-action="cloudTrashList"/);
assert.doesNotMatch(rendered,/data-cloud-token|data-cloud-setting="webAppUrl"/,
 'Firestore owners must not see the legacy Google administrator credentials');
(async()=>{
 conflicts=[{id,reason:'別端末の編集と競合',localRevision:1,remoteRevision:2}];
 const conflictHtml=sync.privateDiaryPanel();
 assert.match(conflictHtml,/data-sync-resolve="local"/);
 assert.match(conflictHtml,/data-sync-resolve="remote"/);
 assert.match(conflictHtml,/data-sync-resolve="hold"/);
 const beforeHold=cloudReads;
 await sync.resolve(id,null);
 assert.equal(cloudReads,beforeHold,'保留では原本を読み書きしない');
 conflicts=[];
 assert.equal(await sync.cloudAction('load'),true,'クラウド一覧取得：'+JSON.stringify(log));
 assert.match(sync.privateDiaryPanel(),/data-action="cloudTrash"/);
 assert.equal(await sync.cloudAction('trash',id),true);
 assert.equal(deleted,true);
 assert.ok(log.includes('backup'));
 assert.match(sync.privateDiaryPanel(),/data-action="cloudRestore"/);
 assert.equal(await sync.cloudAction('restore',id),true);
 assert.equal(deleted,false);
 assert.ok(log.includes('receive'));
 const readBefore=cloudReads;
 canWrite=false;viewer=true;
 assert.equal(await sync.cloudAction('load'),false,'read-only device must not trigger trash UI operations');
 assert.equal(cloudReads,readBefore);
 console.log('本人UID別Firestore：設定から一覧→ゴミ箱移動→復元、閲覧専用端末は書込禁止');
})().catch(error=>{console.error(error);process.exitCode=1;});
