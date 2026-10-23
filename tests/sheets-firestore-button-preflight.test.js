'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('google-apps-script/FirestoreSheetDirectImport.gs','utf8');
const names=['TAXIAPP_乗務一覧','TAXIAPP_印刷データ','TAXIAPP_決済内訳','TAXIAPP_集計'];
const required=['TAXIAPP_同期原本','TAXIAPP_印刷操作','補助簿印刷用','補助簿印刷用_2頁'];
const headers=Object.fromEntries(names.map(x=>[x,['乗務ID','乗務日']]));
let writes=0,authChecks=0,brokenAuth=false,brokenHeaders=false;
const sheets=new Map([...required,...names].map(name=>[name,{
 getRange:(row,col,height,width)=>({
  getValues:()=>[brokenHeaders&&name==='TAXIAPP_印刷データ'?['別の見出し','乗務日']:headers[name]||[]],
  getValue:()=>'',getFormula:()=>'',getDisplayValue:()=>'',setValue:()=>{writes++},
  setDataValidation:()=>{writes++},setNote:()=>{writes++}
 })
}]));
const workbook={getSheetByName:name=>sheets.get(name),toast:()=>{writes++}};
const ctx={Date,JSON,String,Object,Number,Array,Error,RegExp,console,
 TAXIAPP_SHEET_ID:'synthetic-sheet',
 TAXIAPP_FIRESTORE_PRINT_SOURCE_HEADERS:headers,
 firestorePrintConfigDraft_:()=>({project:'test-project',uid:'owner'}),
 firestorePrintSelectedDutyDraft_:()=>{},
 firestorePrintDocDraft_:()=>{},
 SpreadsheetApp:{openById:()=>workbook,getUi:()=>({createMenu:()=>({addItem(){return this},addToUi(){}})})}
};
vm.createContext(ctx);vm.runInContext(source,ctx);
ctx.firestoreSheetFirebaseToken_=()=>{
 authChecks++;
 if(brokenAuth)throw Error('本人Firebase認証の検査失敗');
 return 'synthetic-token-not-logged';
};
const report=ctx.firestoreSheetPreflight_();
assert.equal(report.ready,true);
assert.equal(report.readOnly,true);
assert.equal(report.checkedSheets,8);
assert.equal('token' in report,false);
assert.equal(writes,0,'read-only preflight cannot change the spreadsheet');
brokenAuth=true;
assert.throws(()=>ctx.setupFirestoreSheetImportButton_(),/本人Firebase認証/);
assert.equal(writes,0,'failed preflight cannot alter B20 or install a trigger');
brokenAuth=false;brokenHeaders=true;
assert.throws(()=>ctx.setupFirestoreSheetImportButton_(),/見出し/);
assert.equal(writes,0,'wrong print-source schema cannot alter the spreadsheet');
assert.equal(authChecks,3);
console.log('Firestore本番ボタン：本人認証・印刷元が未確認なら設置前に安全停止');
