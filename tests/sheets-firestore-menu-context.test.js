'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const code=fs.readFileSync('google-apps-script/FirestoreSheetDirectImport.gs','utf8');
let removed=[],writes=0;
const dummy=(handler)=>({getHandlerFunction:()=>handler});
const contexts={
 ScriptApp:{
  getProjectTriggers:()=>[
   dummy('firestoreSheetImportCheckboxEdit_'),
   dummy('firestoreSheetImportMenuCreate_'),
   dummy('taxiappOpenMenu'),
  ],
  deleteTrigger:(trigger)=>removed.push(trigger.getHandlerFunction())
 },
 Logger:{log(){}},
 SpreadsheetApp:{getUi(){throw Error('getUi unsupported on standalone')}}
};
vm.createContext(contexts);vm.runInContext(code,contexts);
assert.doesNotThrow(()=>contexts.firestoreSheetImportMenuCreate_());
assert.equal(contexts.cleanupFirestoreSheetMenuTrigger(),1);
assert.deepEqual(removed,['firestoreSheetImportMenuCreate_']);
assert.ok(!code.includes("newTrigger('firestoreSheetImportMenuCreate_')"));
assert.ok(!code.includes(" firestoreSheetImportMenuCreate_();"));
console.log('単独GASの取得チェックは維持・誤ったメニューだけ安全に削除');
