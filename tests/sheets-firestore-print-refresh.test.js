'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('google-apps-script/FirestoreSheetDirectImport.gs','utf8');
const id='shift-1792699000000-live',date='2026-10-22';
let printed=0,reads=0,compared=0,currentRev=5,lastPrinted=0;
const doc=()=>({id,revision:currentRev,packet:{shift:{id,date,records:[{id:'r'+currentRev}]}}});
const ctx={Date,JSON,Object,Array,Number,String,Error,RegExp,console,
 firestorePrintConfigDraft_:()=>({uid:'owner',project:'test'}),
 firestorePrintDocDraft_:()=>{reads++;return doc();},
 firestorePrintSelectedDutyDraft_:(gotId,gotDate)=>{
  assert.equal(gotId,id);assert.equal(gotDate,date);
  lastPrinted=currentRev;printed++;return '保存完了';
 },
 SpreadsheetApp:{openById:()=>({toast(){}})},
 firestorePrintVerifyPublishedDraft_:()=>({id,date,revision:lastPrinted}),
 savePacket_:(packet,opt)=>{assert.equal(opt.verifyFirestorePrintOnly,true);
  assert.equal(packet.shift.records[0].id,'r'+lastPrinted);compared++;return '保存完了';}
};
vm.createContext(ctx);vm.runInContext(source,ctx);
const result=ctx.firestoreSheetCommitSelected_({id,date,revision:4},date,'test-token');
assert.equal(result.revision,5,'stale listing must adopt the latest complete Firestore duty');
assert.equal(printed,1);assert.equal(compared,1);assert.ok(reads>=2);
currentRev=6;
ctx.firestorePrintSelectedDutyDraft_=(gotId,gotDate)=>{
 lastPrinted=currentRev;printed++;
 currentRev=7; // A new event after the published print source.
 return '保存完了';
};
assert.throws(()=>ctx.firestoreSheetCommitSelected_({id,date,revision:5},date,'test-token'),
 /転送後にFirestore原本が更新/,'newer Firestore must not be incorrectly reported as printed');
console.log('シート日報取得：一覧の旧版から最新版全文を採用、転送後の再改版は未確認として保護');
