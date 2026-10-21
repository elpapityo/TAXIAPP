'use strict';
/* 合成Firestore原本：ゴミ箱内の最新版を補助簿の印刷候補から外す */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'..','google-apps-script','FirestorePrintPullDraft.gs'),'utf8');
const idA='shift-1792620000100-valid',idB='shift-1792620000200-trashed';
const doc=(id,iso,trashed)=>({
 name:'projects/synthetic-proj/databases/(default)/documents/privateDuties/userSynthetic/shifts/'+id,
 fields:{
  trashed:{booleanValue:trashed},
  shift:{mapValue:{fields:{
   id:{stringValue:id},startedIso:{stringValue:iso},endedIso:{stringValue:iso},
   __taxiPrintSummary:{mapValue:{fields:{meter:{integerValue:'1000'}}}}
  }}}
 }
});
const ctx={Date,JSON,Object,Number,Error,RegExp,Set,Array,console,
 TAXIAPP_SHEET_ID:'synthetic',PropertiesService:{}};
vm.createContext(ctx);
vm.runInContext(script,ctx);
ctx.firestorePrintConfigDraft_=()=>({project:'synthetic-proj',uid:'userSynthetic'});
let documents=[
 doc(idA,'2026-10-21T09:00:00.000Z',false),
 doc(idB,'2026-10-21T10:00:00.000Z',true)
];
ctx.firestorePrintRestDraft_=()=>({documents});
let selected='';
ctx.firestorePrintSelectedDutyDraft_=id=>{selected=id;return '印刷候補:'+id;};
assert.equal(ctx.firestorePrintLatestDutyDraft_(),'印刷候補:'+idA);
assert.equal(selected,idA,'latest active duty wins even if trashed one has newer timestamp');
documents=[documents[1]];
assert.throws(()=>ctx.firestorePrintLatestDutyDraft_(),/印刷可能な入庫済み乗務が見つかりません/);
documents=[doc(idA,'2026-10-21T09:00:00.000Z',false)];
documents[0].name='projects/synthetic-proj/databases/(default)/documents/privateDuties/otherUser/shifts/'+idA;
assert.throws(()=>ctx.firestorePrintLatestDutyDraft_(),/本人以外/,'別UIDの候補を選択しない');
documents[0].name='projects/other-proj/databases/(default)/documents/privateDuties/userSynthetic/shifts/'+idA;
assert.throws(()=>ctx.firestorePrintLatestDutyDraft_(),/本人以外/,'別プロジェクトの候補を選択しない');
documents[0].name='projects/synthetic-proj/databases/(default)/documents/privateDuties/userSynthetic/shifts/'+idA+'/nested';
assert.throws(()=>ctx.firestorePrintLatestDutyDraft_(),/不正な乗務ID/,'子ドキュメントを候補にしない');
console.log('Firestore印刷：ゴミ箱の除外、本人UID・プロジェクト・正規文書パスを確認');
