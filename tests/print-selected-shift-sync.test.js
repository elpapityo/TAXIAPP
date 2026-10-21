'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
// The print tab displays selectedPrintShift() and MUST send that exact
// selection—not the most recent or active duty from another screen.
assert.match(html,/tab==='print'\?renderPrint\(selectedPrintShift\(\)\)/);
assert.match(html,/function selectedPrintShift\(\)\{return printShiftId\?\(model\.shifts\.find\(s=>s\.id===printShiftId\)\|\|null\):selectedShift\(\);\}/);
assert.match(html,/if\(action==='syncCurrentShift'\)\{const target=tab==='print'\?selectedPrintShift\(\):latest;if\(tab==='print'&&!target\)\{toast\('印刷する乗務が見つかりません。選び直してください',true\);return;\}googleSendShift\(target,true\);return;\}/);
assert.match(html,/data-action="syncCurrentShift" type="button">↥ 選択した乗務をGoogleへ送信/);
assert.match(html,/↗ 既存の印刷シートを開く/);
assert.match(html,/target="_blank" rel="noopener noreferrer">↗ 既存の印刷シートを開く/);
assert.match(html,/既存の計算式・印刷書式をそのまま利用します/);
assert.doesNotMatch(html,/紙の位置・余白はPCでの試し刷り確認が必要/);
// There must be no new Firebase write, new pricing engine, Google print
// backend or bypass of the existing administrator+editor sync guard.
assert.match(html,/if\(!legacyDiary\(\)\)return Promise\.reject\(Error\('この利用者には管理者用Googleシートへの接続権限がありません'\)\)/);
assert.match(html,/if\(!canEditNow\(\)\)return false;\s*if\(memberDiary\(\)\)return syncUI\.run\(manual\)/);
assert.doesNotMatch(html,/printV2ExistingPublishDraft_|printV2ExistingReprintPublishDraft_/);

assert.match(html,/if\(sheetTargetPrefs\(\)\.syncMode==='on'\)\{return syncUI\.run\(manual,tab==='print'&&shift\?\.id\?\[shift\.id\]:null\);\}/);
assert.match(html,/if\(action==='bidirectionalSyncNow'\)\{syncUI\.run\(true\);return;\}/);
// 既存の双方向同期と同じエンジンを呼び出す。印刷画面からのみ対象1乗務に限定。
const vm=require('node:vm');
const moduleSource=fs.readFileSync(path.join(__dirname,'..','cloud-sync-ui.js'),'utf8');
const requested=[],notices=[],state={busy:false,conflicts:[],lastSyncAt:0,lastError:''};
const window={
 localStorage:{getItem:()=>null,setItem:()=>{}},
 TAXIAPP_BIDIRECTIONAL_SYNC:{create:()=>({
  run:async ids=>{requested.push(ids);return true;},
  status:()=>state,viewerStatus:()=>({}),
  resetAccount:()=>{},readOnly:async()=>[],adoptViewerBaseline:()=>true,
  hasLocalRemovals:()=>false,localRemovalIds:()=>[]
 })}
};
vm.runInNewContext(moduleSource,{window,globalThis:window,console});
const local={shifts:[{id:'shift-100-a',records:[]},{id:'shift-200-b',records:[]}]};
const sync=window.TAXIAPP_SYNC_UI({
 getModel:()=>local,prefs:()=>({syncMode:'on'}),
 configured:()=>true,canSync:()=>true,canView:()=>false,
 getPacket:()=>{},endpoint:()=>'/dummy',request:async()=>{},
 replace:async()=>{},setStatus:()=>{},toast:(s)=>notices.push(s),
 root:{querySelector:()=>null},isSettings:()=>true,isEditing:()=>true
});
(async()=>{
 assert.equal(await sync.run(true,['shift-100-a']),true);
 assert.equal(JSON.stringify(requested[0]),JSON.stringify(['shift-100-a']),
  '印刷時は選択された1乗務だけを双方向同期する');
 assert.equal(await sync.run(true),true);
 assert.equal(requested[1],undefined,'設定画面の手動照合は従来どおり全件');
 const before=requested.length;
 assert.equal(await sync.run(true,['shift-999-removed']),false,
  '削除済み・別アカウントの選択を自動的に最新乗務へ置き換えない');
 assert.equal(requested.length,before,'不正なIDをサーバーへ送らない');
 assert.ok(notices.some(s=>s.includes('見つからない')));
 console.log('印刷対象1乗務の同期と通常の全件同期の両立を確認');
})().catch(error=>{console.error(error);process.exitCode=1;});

