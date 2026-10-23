'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync('google-apps-script/FirestoreSheetDirectImport.gs','utf8');
const cell={'B30':'2026-10-22','B31':'','B32':''};
let dialogs=0,commits=0,events=0,selectedId='';
const sheet={getName:()=> 'TAXIAPP_印刷操作',getParent:()=>({getId:()=> 'synthetic-sheet'}),
 getRange:key=>({getValue:()=>cell[key]||'',getDisplayValue:()=>cell[key]||'',
 setValue:x=>{cell[key]=x;},getFormula:()=>''})};
const ctx={Date,JSON,Number,String,Object,Array,Error,RegExp,console,
 TAXIAPP_SHEET_ID:'synthetic-sheet',
 SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet,toast:()=>{events++}}),
 getUi:()=>{dialogs++;throw Error('noninteractive trigger should not open UI')}}};
vm.createContext(ctx);vm.runInContext(script,ctx);
ctx.firestoreSheetOwner_=()=>{};
ctx.firestoreSheetFirebaseToken_=()=> 'synthetic-authorized';
let candidates=[{id:'shift-1792665840000-a',date:'2026-10-22',revision:2}];
ctx.firestoreSheetCandidates_=()=>candidates;
ctx.firestoreSheetCommitSelected_=(picked,date)=>{commits++;selectedId=picked.id;
 assert.equal(date,'2026-10-22');return {id:picked.id,date,revision:picked.revision}};
const event={value:'TRUE',user:{getEmail:()=> 'synthetic@example.com'},range:{
 getA1Notation:()=> 'B20',getSheet:()=> sheet,setValue:x=>{events++;assert.equal(x,false)}}};
const first=ctx.firestoreSheetImportCheckboxEdit_(event);
assert.equal(first.id,'shift-1792665840000-a');
assert.equal(commits,1);
assert.match(cell.B32,/転送確認/);
assert.equal(dialogs,0);
candidates.push({id:'shift-1792665840001-b',date:'2026-10-22',revision:2});
assert.throws(()=>ctx.firestoreSheetCheckboxImport_('synthetic@example.com'),/複数/);
assert.equal(commits,1);
cell.B31='shift-1792665840001-b';
ctx.firestoreSheetCheckboxImport_('synthetic@example.com');
assert.equal(commits,2);
assert.equal(selectedId,'shift-1792665840001-b');
cell.B30='invalid';
assert.throws(()=>ctx.firestoreSheetCheckboxImport_('synthetic@example.com'),/B30/);
assert.equal(commits,2);
assert.equal(dialogs,0);
console.log('Firestore取得：チェック→日付照合、同日複数の無断選択禁止、原本保護を確認');
