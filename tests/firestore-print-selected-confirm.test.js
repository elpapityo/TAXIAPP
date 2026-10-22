'use strict';
/* 合成データのみ：Firestore原本で既存紙2頁の選択と印刷確認を行う */
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','google-apps-script/Code.gs'),'utf8');
const id='shift-1234567890123-demo',label='2026/10/21 09:00 合成1件';
const shift={id,date:'2026-10-21',records:[{kind:'ride',status:'complete',raw:{K:1000}}],
 settings:{},startedAt:'09:00',endedAt:'10:00'};
let selected=label,derived=id,latest=false,sourceAvailable=true,printMeter=1000;
let rowState='Firestore印刷済',indexCount='1',indexMeter='1000';
let indexUpdatedAt='2026-10-21 11:00:00',legacy=false,reads=0,notices=[];
let detailMatches=true,changeDuringVerification=false,version=3,detailChecks=0;
function range(values){
 return {getDisplayValues:()=>values,getValues:()=>values,
 getDisplayValue:()=>String(values[0]?.[0]??''),getValue:()=>values[0]?.[0]};
}
const operation={getRange(key){if(key==='B15')return range([[latest]]);
 if(key==='B17')return range([[selected]]);
 if(key==='C17')return range([[derived]]);
 throw Error('unknown operation range '+key);}};
const index={getLastRow:()=>2,getRange(r,c,h,w){
 if(r===2&&c===1&&w===21){
  const row=Array(21).fill('');row[0]=id;row[7]=indexCount;
  row[8]=indexMeter;row[15]=indexUpdatedAt;
  row[16]=rowState;row[20]=label;return range([row]);
 }
 if(r===2&&c===1&&w===17){const row=Array(17).fill('');
  row[0]=id;row[7]=indexCount;row[8]=indexMeter;row[15]=indexUpdatedAt;
  row[16]=rowState;return range([row]);}
 if(r==='T2')return range([[label]]);
 throw Error('unknown index range '+r+' '+c+' '+w);
}};
const old={getLastRow:()=>legacy?2:1,getRange:()=>range([[legacy?id:'']])};
const sheet={getRange:address=>{assert.equal(address,'X23');return range([[printMeter]]);}};
const ss={getSheetByName:name=>({
 'TAXIAPP_印刷操作':operation,'TAXIAPP_乗務一覧':index,
 'TAXIAPP_同期原本':old,'補助簿印刷用':sheet,'補助簿印刷用_2頁':{}
})[name]||null,toast:text=>notices.push(text)};
const ctx={Date,console,SpreadsheetApp:{openById:()=>ss,flush:()=>{}},
 Utilities:{formatDate:()=> '2026-10-21 11:00:00'},
 firestorePrintVerifyRowsDraft_:()=>true,
 Logger:{log:()=>{}},Number,Error,Set,
 firestorePrintConfigDraft_:()=>({uid:'ownerSyntheticUID'}),
 firestorePrintDocDraft_:()=>{reads++;if(!sourceAvailable)throw Error('Firebase権限拒否');
  return {revision:version,packet:{shift,summary:{meter:1000},printRecordedAt:'2026-10-21T02:00:00.000Z'}};}
};
vm.createContext(ctx);vm.runInContext(code,ctx);
ctx.savePacket_=(packet,options)=>{
 assert.equal(options.firestorePrintOnly,true);
 assert.equal(options.verifyFirestorePrintOnly,true,'印刷確認は既存印刷元を読み取りのみで照合する');
 detailChecks++;
 if(!detailMatches)throw Error('Firestoreの原本と既存印刷元の明細が一致しません');
 if(changeDuringVerification){changeDuringVerification=false;version++;}
};
const good=ctx.applySelectedPrintShift();
assert.equal(good.ok,true);assert.equal(good.shiftId,id);assert.equal(good.meter,1000);
assert.equal(reads,2,'印刷明細照合前後に本人Firestoreを2度読み戻す');
assert.equal(detailChecks,1,'Firestoreの印刷明細をすべて照合する');
selected='別の乗務';
assert.throws(()=>ctx.applySelectedPrintShift(),/印刷対象/);
selected=label;derived='shift-9999999999999-other';
assert.throws(()=>ctx.applySelectedPrintShift(),/印刷対象ID/);
derived=id;rowState='未確認';
assert.throws(()=>ctx.applySelectedPrintShift(),/印刷対象/);
rowState='Firestore印刷済';indexCount='99';
assert.throws(()=>ctx.applySelectedPrintShift(),/印刷件数/);
indexCount='1';printMeter=1200;
assert.throws(()=>ctx.applySelectedPrintShift(),/メーター売上/);
printMeter=1000;indexUpdatedAt='2026-10-20 11:00:00';
assert.throws(()=>ctx.applySelectedPrintShift(),/更新日時/,'同額・同件数の修正済み日報を拒否する');
indexUpdatedAt='2026-10-21 11:00:00';indexMeter='999';
assert.throws(()=>ctx.applySelectedPrintShift(),/メーター売上/);
indexMeter='1000';detailMatches=false;
assert.throws(()=>ctx.applySelectedPrintShift(),/明細が一致しません/,
 '同額・同件数・同秒の修正でも4印刷元との明細不一致を拒否する');
detailMatches=true;changeDuringVerification=true;
assert.throws(()=>ctx.applySelectedPrintShift(),/印刷確認中にFirestore原本が更新/,
 '印刷元照合中に原本が改版されれば再取得の更新番号で停止する');
sourceAvailable=false;
assert.throws(()=>ctx.applySelectedPrintShift(),/Firebase権限拒否/);
sourceAvailable=true;legacy=true;rowState='受信済み';
let legacyLoad=0;ctx.loadShift_=(spread,id0)=>{legacyLoad++;assert.equal(id0,id);return shift;};
assert.equal(ctx.applySelectedPrintShift().ok,true);
assert.equal(legacyLoad,1,'legacy printing unchanged');
// The PC's explicit choice must agree with the formula-derived ID before
// the draft import may change any of the four print-source sheets.
vm.runInContext(fs.readFileSync(path.join(__dirname,'..',
 'google-apps-script/FirestorePrintPullDraft.gs'),'utf8'),ctx);
legacy=false;rowState='Firestore印刷済';selected=label;derived=id;
let importedId='';
ctx.firestorePrintSelectedDutyDraft_=selectedId=>{
 importedId=selectedId;return '取込検証済み';
};
ctx.firestorePrintChosenMenuDraft_();
assert.equal(importedId,id,'PCのB17で指定した本人乗務のみ転送');
importedId='';derived='shift-9999999999999-other';
assert.throws(()=>ctx.firestorePrintChosenMenuDraft_(),/B15\/B17/,
 'C17の数式が古い乗務IDなら転送しない');
assert.equal(importedId,'','誤選択時はFirestore送信処理を開始しない');
derived=id;selected='別の乗務';
assert.throws(()=>ctx.firestorePrintChosenMenuDraft_(),/B15\/B17/,
 'B17が別乗務ならC17を信用して転送しない');
console.log('既存印刷選択：Firestore専用ID・本人原本金額・件数を確認、旧Google印刷は維持');
