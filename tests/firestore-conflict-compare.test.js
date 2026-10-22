'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('cloud-sync-ui.js','utf8');
let owner='UID-A',reads=0;
const id='shift-1792700000000-member';
const original={id,date:'2026-10-22',startedAt:'08:00',endedAt:'19:00',
 records:[{raw:{G:'09:00',K:'2000',AL:'端末 <img src=x>',AM:'終点'}}]};
const remote={...original,records:[{raw:{G:'09:00',K:'2200',AL:'クラウド起点',AM:'終点'}}]};
const log=[];
const root={localStorage:{getItem:()=>null,setItem:()=>{}},confirm:()=>true,
 TAXIAPP_BIDIRECTIONAL_SYNC:{create:()=>({
  status:()=>({busy:false,conflicts:[{id,reason:'両端末の同時編集'}],lastSyncAt:0,lastError:''}),
  viewerStatus:()=>({lastSyncAt:0,lastError:''}),
  resetAccount:()=>{},run:async()=>true
 })}};
vm.runInNewContext(code,{window:root,globalThis:root,console,setTimeout,clearTimeout});
const ui=root.TAXIAPP_SYNC_UI({
 scopeKey:()=>owner,endpoint:()=> 'firestore-duties://'+owner,
 getModel:()=>({shifts:[original]}),
 getPacket:shift=>({kind:'TAXIAPP_SHIFT_V1',shift}),
 request:async(action,payload)=>{reads++;assert.equal(action,'syncGet');
  assert.equal(payload.shiftId,id);return {id,revision:3,shift:remote};},
 prefs:()=>({syncMode:'on'}),configured:()=>true,
 canSync:()=>true,canView:()=>false,remoteOnDemand:()=>true,
 root:{querySelector:()=>null},setStatus:()=>{},toast:m=>log.push(String(m)),
 escape:val=>String(val).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 download:()=>{},dateStamp:()=>'20261022'
});
(async()=>{
 assert.match(ui.privateDiaryPanel(),/data-sync-compare/);
 assert.equal(await ui.compare(id),true);
 const html=ui.privateDiaryPanel();
 assert.match(html,/メーター入力 2000/);
 assert.match(html,/メーター入力 2200/);
 assert.doesNotMatch(html,/<img src=x>/,'個人記録はHTMLエスケープする');
 assert.equal(reads,1);
 ui.resetAccount();
 assert.doesNotMatch(ui.privateDiaryPanel(),/メーター入力 2200/,'ログアウト時は比較キャッシュ破棄');
 owner='UID-B';
 assert.equal(await ui.compare('shift-0000000000000-wrong'),false);
 assert.equal(reads,1);
 console.log('本人Firestore競合：両版比較・HTML保護・ログアウト時破棄を確認');
})().catch(error=>{console.error(error);process.exitCode=1;});
