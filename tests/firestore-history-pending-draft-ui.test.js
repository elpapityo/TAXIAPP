'use strict';
// 過去日報：別の営業へ移っても未保存修正を見つけて再開できること。
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
const begin=source.indexOf('function historyProtectedEdits(');
const end=source.indexOf('function startHistoryLocationEdit(',begin);
assert.ok(begin>0&&end>begin,'未保存修正の表示・保護処理が必要');
assert.match(source,/\$\{historyProtectedEditsHtml\(shift\)\}\$\{historyLocationEditHtml\(shift\)\}/,
 '過去日報の既存営業一覧に未保存修正を表示する');
const uid='u-1',id='shift-1792700000000';
const shift={id,date:'2026-10-22',records:[
 {id:'record-1',kind:'ride',raw:{A:'1'}},
 {id:'record-2',kind:'ride',raw:{A:'2'}}
]};
const map=new Map(),copy=x=>JSON.parse(JSON.stringify(x));
const edited=(recordId,extras={})=>JSON.stringify({
 uid,id,recordId,date:shift.date,baseRevision:3,addRecord:false,...extras
});
const editKey=(u,s,r)=>'edit/'+u+'/'+s+'/'+r;
const addKey=(u,s,kind)=>'new/'+u+'/'+s+'/'+kind;
let localSaveCalls=0,inputCalls=0,visible=true,allowSave=true;
const ctx={
 accountScope:{uid},historyCloudUid:uid,historyCloudDate:shift.date,
 historyCloudRows:[{id,revision:3,shift:copy(shift)}],historyLocationEdit:null,
 memberDiary:()=>true,historyEditStorageKey:editKey,historyPendingAdditionKey:addKey,
 localStorage:{getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,v)},
 safeText:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
 document:{getElementById:()=>visible?{value:'編集中'}:null},
 historyLocationInputs:()=>{inputCalls++;return allowSave;},
 saveHistoryLocationDraft:()=>{localSaveCalls++;},
 Number,Object,JSON,Error,String
};
vm.createContext(ctx);vm.runInContext(source.slice(begin,end),ctx);
map.set(editKey(uid,id,'record-1'),edited('record-1'));
let pending=ctx.historyProtectedEdits(shift);
assert.equal(pending.length,1,'本人の未保存営業だけを一覧化');
assert.equal(pending[0].recordId,'record-1');
assert.equal(pending[0].blocked,false);
assert.match(ctx.historyProtectedEditsHtml(shift),/data-action="editHistoryLocation"/,
 '編集を再開する操作が見える');
assert.match(ctx.historyProtectedEditsHtml(shift),/営業№1/);
map.set(addKey(uid,id,'ride'),'record-added');
map.set(editKey(uid,id,'record-added'),edited('record-added',{addRecord:true}));
pending=ctx.historyProtectedEdits(shift);
assert.equal(pending.length,2,'追加途中の乗車も保護・再開対象にする');
assert.match(ctx.historyProtectedEditsHtml(shift),/data-action="historyAddRecord"/);
ctx.historyCloudRows[0].revision=4;
assert.equal(ctx.historyProtectedEdits(shift).filter(item=>item.stale).length,2,
 'サーバー版が変わった控えを自動採用しない');
map.set(editKey(uid,id,'record-2'),'{broken');
assert.equal(ctx.historyProtectedEdits(shift).find(item=>item.recordId==='record-2').blocked,true,
 '破損した控えを消さず、再開不可と明示する');
assert.equal(ctx.historyProtectedEditsHtml(shift).includes('修正控えを確認できません'),true);
const previousCount=map.size;
ctx.accountScope.uid='u-2';
assert.equal(ctx.historyProtectedEdits(shift).length,0,'別UIDに控えを表示しない');
ctx.accountScope.uid=uid;
assert.equal(map.size,previousCount,'表示だけで端末の修正控えを変更しない');
ctx.historyLocationEdit={uid,id,recordId:'record-1',busy:false};
ctx.protectOpenHistoryEdit();
assert.equal(inputCalls,1,'画面表示中は入力値を先に回収する');
allowSave=false;
assert.throws(()=>ctx.protectOpenHistoryEdit(),/保存できません/,'端末保存失敗時に遷移しない');
visible=false;allowSave=true;
ctx.protectOpenHistoryEdit();
assert.equal(localSaveCalls,1,'画面外の修正控えも保護する');
ctx.historyLocationEdit.busy=true;
assert.throws(()=>ctx.protectOpenHistoryEdit(),/保存処理中/,'同期中の画面切替を拒否');
console.log('過去日報：控えの一覧・再開導線・UID隔離・版違い表示・画面切替保護を確認');
