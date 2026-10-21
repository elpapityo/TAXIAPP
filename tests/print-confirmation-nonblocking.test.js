'use strict';
// Verifies print confirmation never blocks a run on a hidden UI dialog.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','google-apps-script','Code.gs'),'utf8');
const start=source.indexOf('function applySelectedPrintShift() {');
assert.ok(start>=0);
const func=source.slice(start);
const notices=[],logs=[];
let alertCalled=false;
const shift={date:'2026-10-16',records:[
 {kind:'ride',status:'complete',raw:{K:10000}},
 {kind:'ride',status:'complete',raw:{K:5100}},
 {kind:'cancel',status:'complete',raw:{K:0}},
 {kind:'empty',status:'complete',raw:{K:0}}
]};
const sheet={getRange:(k)=>({getValue:()=>k==='X23'?15100:undefined})};
const operation={};
const spreadsheet={
 getSheetByName:(n)=>n==='TAXIAPP_印刷操作'?operation:
  n==='補助簿印刷用'||n==='補助簿印刷用_2頁'?sheet:
  n==='TAXIAPP_同期原本'?{getLastRow:()=>2,getRange:()=>({getDisplayValues:()=>[['shift-1792124520000']]})}:null,
 toast:(...args)=>notices.push(args)
};
const context={
 TAXIAPP_SHEET_ID:'test-id',
 SpreadsheetApp:{openById:()=>spreadsheet,flush:()=>{},getUi:()=>{
  alertCalled=true;throw Error('A blocking UI dialog must never open');
 }},
 resolvePrintShiftId_:()=> 'shift-1792124520000',
 loadShift_:()=>shift,
 numeric_:n=>Number(n||0),
 Logger:{log:v=>logs.push(v)},
 String,Number,Math,Error,Array
};
vm.createContext(context);
vm.runInContext(func,context);
const result=context.applySelectedPrintShift();
assert.equal(result.ok,true);
assert.equal(result.shiftId,'shift-1792124520000');
assert.equal(result.records,4);
assert.equal(result.meter,15100);
assert.equal(notices.length,1);
assert.equal(alertCalled,false);
assert.ok(logs.some(x=>x.includes('TAXIAPP_PRINT_CHECK_OK')));
sheet.getRange=()=>({getValue:()=>12000});
assert.throws(()=>context.applySelectedPrintShift(),/メーター売上が一致しません/);
assert.equal(alertCalled,false);
console.log('Nonblocking print confirmation test passed: toast, logs, success return, mismatch protection.');
