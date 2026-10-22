'use strict';
// The PC's Firebase-verified import stores its complete four-sheet digest.
// The Google spreadsheet itself must compare this digest and selected ID
// WITHOUT ever using IAM to fetch other users' Firestore originals.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('google-apps-script/Code.gs','utf8');
const pull=fs.readFileSync('google-apps-script/FirestorePrintPullDraft.gs','utf8');
const id='shift-1234567890123-owner',label='2026/10/21 09:00 合成1件';
const shift={id,date:'2026-10-21',records:[{kind:'ride',status:'complete',raw:{K:1000}}],
 settings:{},startedAt:'09:00',endedAt:'10:00'};
let selected=label,derived=id,latest=false,printMeter=1000,legacy=false;
let rowState='Firestore印刷済',indexCount='1',indexMeter='1000',verified=true;
let notices=[],journalChecks=0,firestoreReads=0;
const range=values=>({getDisplayValues:()=>values,getValues:()=>values,
 getDisplayValue:()=>String(values[0]?.[0]??''),getValue:()=>values[0]?.[0]});
const operation={getRange:key=>{
 if(key==='B15')return range([[latest]]);
 if(key==='B17')return range([[selected]]);
 if(key==='C17')return range([[derived]]);
 throw Error('unexpected operation cell '+key);
}};
const index={getLastRow:()=>2,getRange:(r,c,h,w)=>{
 if(r===2&&c===1&&w===21){const row=Array(21).fill('');
  row[0]=id;row[7]=indexCount;row[8]=indexMeter;
  row[16]=rowState;row[20]=label;return range([row]);}
 if(r===2&&c===1&&w===17){const row=Array(17).fill('');
  row[0]=id;row[7]=indexCount;row[8]=indexMeter;
  row[16]=rowState;return range([row]);}
 throw Error('unexpected index '+r+' '+c+' '+w);
}};
const originals={getLastRow:()=>legacy?2:1,getRange:()=>range([[legacy?id:'']])};
const paper={getRange:address=>{assert.equal(address,'X23');return range([[printMeter]]);}};
const ss={getSheetByName:name=>({
 'TAXIAPP_印刷操作':operation,'TAXIAPP_乗務一覧':index,
 'TAXIAPP_同期原本':originals,'補助簿印刷用':paper,'補助簿印刷用_2頁':{}
})[name]||null,toast:s=>notices.push(s)};
const ctx={Date,console,SpreadsheetApp:{openById:()=>ss,flush:()=>{}},
 Logger:{log:()=>{}},Number,Error,Set,
 firestorePrintConfigDraft_:()=>({uid:'ownerSyntheticUID'}),
 firestorePrintDocDraft_:()=>{firestoreReads++;throw Error('印刷確認で直接Firestoreへ接続しない');},
 firestorePrintVerifyPublishedDraft_:(_ss,shiftId)=>{
  journalChecks++;assert.equal(shiftId,id);
  if(!verified)throw Error('印刷元の版管理と内容が一致しません');
  return {id,date:shift.date,records:1,meter:1000,revision:3};
 }};
vm.createContext(ctx);vm.runInContext(code,ctx);
const good=ctx.applySelectedPrintShift();
assert.equal(good.ok,true);assert.equal(good.shiftId,id);assert.equal(good.meter,1000);
assert.equal(firestoreReads,0,'Google側の印刷確認ではFirebaseのIDトークンなしに原本を読まない');
assert.equal(journalChecks,1,'事前転送の本人確認済み版管理を照合');
selected='別の乗務';assert.throws(()=>ctx.applySelectedPrintShift(),/印刷対象/);
selected=label;derived='shift-9999999999999-other';
assert.throws(()=>ctx.applySelectedPrintShift(),/印刷対象ID/);
derived=id;rowState='未確認';
assert.throws(()=>ctx.applySelectedPrintShift(),/印刷対象/);
rowState='Firestore印刷済';indexCount='99';
assert.throws(()=>ctx.applySelectedPrintShift(),/印刷元の件数|印刷件数/);
indexCount='1';indexMeter='999';
assert.throws(()=>ctx.applySelectedPrintShift(),/メーター売上/);
indexMeter='1000';printMeter=1200;
assert.throws(()=>ctx.applySelectedPrintShift(),/メーター売上/);
printMeter=1000;verified=false;
assert.throws(()=>ctx.applySelectedPrintShift(),/版管理と内容が一致しません/,
 '手動で印刷元が変わった場合は確認停止');
verified=true;legacy=true;rowState='受信済み';
let legacyCount=0;ctx.loadShift_=(_ss,sid)=>{legacyCount++;assert.equal(sid,id);return shift;};
assert.equal(ctx.applySelectedPrintShift().ok,true);
assert.equal(legacyCount,1,'旧Google日報の既存印刷を維持する');
assert.equal(firestoreReads,0,'旧Google運用にもFirebase認証を要求しない');
// Former IAM-powered Google-sheet menu must stay disabled.
vm.runInContext(pull,ctx);
assert.throws(()=>ctx.firestorePrintChosenMenuDraft_(),/PCのTAXIAPP/);
assert.throws(()=>ctx.firestorePrintDateMenuDraft_(),/PCのTAXIAPP/);
console.log('Google印刷：本人認証済み4印刷元のみを版管理で確認し、旧Google印刷を維持');
