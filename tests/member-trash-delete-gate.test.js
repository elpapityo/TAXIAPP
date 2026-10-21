'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('function renderDataManagement(){');
const end=html.indexOf('// This preview reads ONLY',start);
assert.ok(start>0&&end>start,'data-management UI exists');
const shift={id:'shift-100-a',date:'2026-10-21',startedAt:'08:00',endedAt:'16:00',
 records:[{raw:{K:9000}}],settings:{}};
const model={shifts:[shift],prefs:{},activeId:null};
const mock={
 model,role:'member',
 memberDiary:()=>mock.role==='member',
 legacyDiary:()=>mock.role==='legacy',
 renderAdminCutoverSelectionPanel:()=>'',renderMemberTrashPanel:()=>'<section>本人Firebaseの日報</section>',
 totals:()=>({meter:9000}),money:n=>n+'円',
 shortTime:s=>s,safeText:s=>String(s??'')
};
vm.createContext(mock);
vm.runInContext(html.slice(start,end),mock);
const member=vm.runInContext('renderDataManagement()',mock);
assert.match(member,/本人Firebaseの日報/);
assert.match(member,/端末だけの削除は同期で元に戻る/);
assert.match(member,/クラウドでの削除は未接続/);
assert.doesNotMatch(member,/data-action="deleteShift"/,'ordinary member must not have local-only delete button');
mock.role='legacy';
const manager=vm.runInContext('renderDataManagement()',mock);
assert.match(manager,/data-action="deleteShift"/,'existing legacy admin delete path remains unchanged');
assert.match(manager,/Googleスプレッドシートに送信済みのデータは消しません/);
const actionStart=html.indexOf('function deleteWholeShift(shiftId){');
assert.ok(actionStart>0);
assert.match(html.slice(actionStart,actionStart+240),/if\(memberDiary\(\)\)/,
 'even programmatic dispatch cannot delete a member duty without server trash');
console.log('Member local-only delete stopped; legacy admin workflow preserved');
