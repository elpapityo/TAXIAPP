'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','google-apps-script','Code.gs'),'utf8');
const a=source.indexOf('function taxiappOpenMenu() {');
const b=source.indexOf('function setupTAXIAPP()',a);
assert.ok(a>0&&b>a);
const snippet=source.slice(a,b);
const removed=[];
const names=['checkNewRowAndNotify','taxiappOpenMenu','doPost','myOtherTrigger','applySelectedPrintShift'];
const triggers=names.map((n,i)=>({name:n,index:i,getHandlerFunction(){return n;}}));
const ctx={
 ScriptApp:{
  getProjectTriggers:()=>triggers,
  deleteTrigger:x=>removed.push(x.name),
  newTrigger:()=>{throw Error('Unexpected trigger reinstallation');}
 },
 SpreadsheetApp:{getUi:()=>{throw Error('Obsolete menu should never be recreated');}},
 Logger:{log:()=>{}},
 String
};
vm.createContext(ctx);vm.runInContext(snippet,ctx);
ctx.taxiappOpenMenu();
const removedList=ctx.cleanupTAXIAPPObsoleteTriggers();
assert.deepEqual(removed,['checkNewRowAndNotify','taxiappOpenMenu']);
assert.equal(removedList.length,2);
assert.equal(removedList[0],'checkNewRowAndNotify');
assert.equal(removedList[1],'taxiappOpenMenu');
assert.ok(source.includes('function setupTAXIAPP()'));
assert.doesNotMatch(source,/createMenu\('TAXIAPP 印刷/);
assert.doesNotMatch(source,/newTrigger\('taxiappOpenMenu'\)/);
assert.match(source,/function doPost\(/);
assert.match(source,/function applySelectedPrintShift\(/);
console.log('Obsolete menu and trigger test passed: old menu suppressed and unrelated sync/print triggers preserved.');
