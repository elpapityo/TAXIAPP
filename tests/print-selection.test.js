'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','google-apps-script','Code.gs'),'utf8');
const start=source.indexOf('function resolvePrintShiftId_(ss,operation) {');
const end=source.indexOf('function applySelectedPrintShift()',start);
assert.ok(start>=0&&end>start,'selection resolver exists');
const sandbox={Set,Math,String};
vm.runInNewContext(source.slice(start,end),sandbox);
const older='shift-1792103640000',newer='shift-1792124520000';
const olderLabel='10/16 07:34出庫・営業3件（640000）';
const newerLabel='10/16 13:22出庫・営業4件・乗務員（520000）';
function fixture({follow=true,choice=newerLabel,derived=newer,latest=newerLabel,stored=[older,newer]}={}){
 const rows=[[older,...Array(19).fill(''),olderLabel],[newer,...Array(19).fill(''),newerLabel]];
 assert.equal(rows[0].length,21);
 const index={
  getLastRow:()=>3,
  getRange:(...args)=>args[0]==='T2'?{getDisplayValue:()=>latest}:
   {getDisplayValues:()=>rows}
 };
 const originals={
  getLastRow:()=>stored.length+1,
  getRange:()=>({getDisplayValues:()=>stored.map(id=>[id])})
 };
 const op={
  getRange:a=>({getValue:()=>a==='B15'?follow:false,
   getDisplayValue:()=>a==='B17'?choice:a==='C17'?derived:''})
 };
 const sheet={getSheetByName:a=>a==='TAXIAPP_乗務一覧'?index:a==='TAXIAPP_同期原本'?originals:null};
 return {sheet,op};
}
function choose(opts){const f=fixture(opts);return sandbox.resolvePrintShiftId_(f.sheet,f.op);}
assert.equal(choose(),newer,'follow latest must use latest sorted label T2, not A2');
assert.equal(choose({follow:false,choice:olderLabel,derived:newer}),older,
 'manual choice must win over stale C17');
assert.equal(choose({follow:false,choice:older}),older,'raw legacy shift ID accepted');
assert.equal(choose({follow:false,choice:newerLabel,derived:''}),newer,'stale C17 is recoverable');
assert.equal(choose({follow:false,choice:'wrong-duty',derived:newer}),'',
 'stale valid C17 cannot silently select a different duty');
assert.equal(choose({stored:[older]}),'',
 'do not print an unsynced duty even if it appears in sorted list');
assert.equal(choose({latest:'',choice:newerLabel}),'',
 'do not select a different duty if latest selection is unavailable');
console.log('Print selection tests passed: sorted latest vs A2, manual choice, legacy IDs, stale C17 and missing originals.');
